import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    // Pré-voo CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", {headers: corsHeaders});
    }

    // Só aceitamos POST
    if (req.method !== "POST") {
        return new Response(
            JSON.stringify({error: "Método não permitido. Use POST."}),
            {
                headers: {...corsHeaders, "Content-Type": "application/json"},
                status: 405,
            },
        );
    }

    try {
        // Agora também recebemos "doca"
        const {numeracao, usuario_saida, doca} = await req.json();

        if (!numeracao) throw new Error("Numeração da manga não fornecida.");
        if (!usuario_saida) {
            throw new Error("Usuário de saída (usuario_saida) não fornecido.");
        }

        // Normalizações
        const numeracaoStr = String(numeracao).trim();
        const usuarioSaidaStr = String(usuario_saida).trim();

        // Normaliza DOCA: "1" | "DOCA 1" | "01" -> "DOCA 01"
        const normalizeDock = (raw: unknown): string | null => {
            if (raw == null) return null;
            const s = String(raw).trim().toUpperCase();
            if (!s) return null;

            // Extrai número (1..12) aceitando formatos "DOCA 1", "1", "01", "DOCA 01"
            const m = s.match(/(\d{1,2})$/);
            if (!m) return null;
            const n = parseInt(m[1], 10);
            if (Number.isNaN(n) || n < 1 || n > 12) return null;
            return `DOCA ${String(n).padStart(2, "0")}`;
        };

        const docaStr = normalizeDock(doca); // pode ser null se não vier/for inválida

        // Timestamp em fuso de Brasília (sv-SE -> ISO-like: yyyy-mm-dd HH:mm:ss)
        const utcDate = new Date();
        const brasiliaFormatter = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "America/Sao_Paulo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        });
        const dataFormatada = brasiliaFormatter.format(utcDate);
        const milissegundos = utcDate.getMilliseconds().toString().padStart(3, "0");
        const dataSaidaBrasilia = `${dataFormatada}.${milissegundos}`;

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Credenciais Supabase não configuradas.");
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 1) Verifica existência
        const {data: found, error: selErr} = await supabase
            .from("Carregamento")
            .select("*")
            .eq("NUMERACAO", numeracaoStr)
            .limit(1);

        if (selErr) {
            console.error("Erro ao selecionar:", selErr);
            throw new Error("Erro ao consultar banco de dados.");
        }

        if (!found || found.length === 0) {
            return new Response(
                JSON.stringify({error: `Manga ${numeracaoStr} não encontrada.`}),
                {
                    headers: {...corsHeaders, "Content-Type": "application/json"},
                    status: 404,
                },
            );
        }

        const record = found[0];

        // Se já estava validada, ainda assim podemos atualizar DOCA (se veio e for diferente/vazia no banco)
        if (record.VALIDACAO === "BIPADO") {
            let updatedRecord = record;

            if (docaStr && record.DOCA !== docaStr) {
                const {data: updIdem, error: updIdemErr} = await supabase
                    .from("Carregamento")
                    .update({DOCA: docaStr})
                    .eq("NUMERACAO", numeracaoStr)
                    .select()
                    .limit(1);

                if (updIdemErr) {
                    console.error("Erro ao atualizar DOCA (idempotente):", updIdemErr);
                    // ainda assim retornamos 200, mas com aviso
                    return new Response(
                        JSON.stringify({
                            message:
                                `Manga ${numeracaoStr} já estava validada. Falha ao atualizar DOCA: ${updIdemErr.message}`,
                            updatedData: updatedRecord,
                            idempotent: true,
                        }),
                        {
                            headers: {...corsHeaders, "Content-Type": "application/json"},
                            status: 200,
                        },
                    );
                }

                if (updIdem && updIdem.length > 0) {
                    updatedRecord = updIdem[0];
                }
            }

            return new Response(
                JSON.stringify({
                    message: `Manga ${numeracaoStr} já estava validada.`,
                    updatedData: updatedRecord,
                    idempotent: true,
                }),
                {
                    headers: {...corsHeaders, "Content-Type": "application/json"},
                    status: 200,
                },
            );
        }

        // 2) Faz o UPDATE e retorna a linha atualizada (inclui DOCA quando fornecida)
        const updatePayload: Record<string, unknown> = {
            "BIPADO SAIDA": usuarioSaidaStr,
            "DATA SAIDA": dataSaidaBrasilia,
            VALIDACAO: "BIPADO",
        };
        if (docaStr) updatePayload.DOCA = docaStr;

        const {data: updatedRows, error: updErr} = await supabase
            .from("Carregamento")
            .update(updatePayload)
            .eq("NUMERACAO", numeracaoStr)
            .select()
            .limit(1);

        if (updErr) {
            console.error("Erro ao atualizar:", updErr);
            throw new Error(`Erro ao atualizar no banco: ${updErr.message}`);
        }

        if (!updatedRows || updatedRows.length === 0) {
            // Situação rara — ninguém foi atualizado (possível corrida)
            return new Response(
                JSON.stringify({
                    error:
                        `Manga ${numeracaoStr} não pôde ser atualizada (nenhuma linha afetada).`,
                }),
                {
                    headers: {...corsHeaders, "Content-Type": "application/json"},
                    status: 404,
                },
            );
        }

        // Retorna a linha atualizada
        return new Response(
            JSON.stringify({
                message: "Manga validada com sucesso!",
                updatedData: updatedRows[0],
            }),
            {
                headers: {...corsHeaders, "Content-Type": "application/json"},
                status: 200,
            },
        );
    } catch (error) {
        console.error(
            "Erro geral:",
            (error as Error)?.message,
            (error as Error)?.stack,
        );
        return new Response(
            JSON.stringify({error: (error as Error)?.message || "Erro interno"}),
            {
                headers: {...corsHeaders, "Content-Type": "application/json"},
                status: 500,
            },
        );
    }
});
