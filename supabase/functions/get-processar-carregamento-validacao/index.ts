// /supabase/functions/get-processar-carregamento-validacao/index.ts

import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

// <-- Helper que você já tinha no frontend -->
const extractElevenDigits = (str: unknown): string | null => {
    if (str == null) return null;
    const digits = String(str).replace(/\D+/g, '');
    if (digits.length >= 11) return digits.slice(-11);
    return null;
};

serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };

    if (req.method === "OPTIONS") {
        return new Response("ok", {headers: corsHeaders});
    }

    if (req.method !== "POST") {
        return new Response(
            JSON.stringify({error: "Método não permitido. Use POST."}),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 405},
        );
    }

    try {
        const {id_pacote, rota_selecionada, usuario_saida, doca} = await req.json();

        if (!id_pacote) throw new Error("ID do pacote/manga não fornecido.");
        if (!rota_selecionada) throw new Error("Rota (ilha) não selecionada.");
        if (!usuario_saida) {
            throw new Error("Usuário de saída (usuario_saida) não fornecido.");
        }

        // --- Normalizações ---
        const scannedIdStr = String(id_pacote).trim().toUpperCase();
        const normalizedPacoteId = extractElevenDigits(scannedIdStr); // Tenta extrair 11 dígitos
        const rotaSelecionadaStr = String(rota_selecionada).trim().toUpperCase();
        const usuarioSaidaStr = String(usuario_saida).trim();

        const normalizeDock = (raw: unknown): string | null => {
            if (raw == null) return null;
            const s = String(raw).trim().toUpperCase();
            if (!s) return null;
            const m = s.match(/(\d{1,2})$/);
            if (!m) return null;
            const n = parseInt(m[1], 10);
            if (Number.isNaN(n) || n < 1 || n > 12) return null;
            return `DOCA ${String(n).padStart(2, "0")}`;
        };
        const docaStr = normalizeDock(doca);

        const utcDate = new Date();
        const brasiliaFormatter = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "America/Sao_Paulo",
            year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
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

        // --- MUDANÇA CENTRAL: Lógica de Busca ---
        // 1) Encontra o registro. O ID bipado pode ser a NUMERACAO ou o ID PACOTE.

        let orFilter: string;
        if (normalizedPacoteId) {
            // Se for um ID numérico (ex: 458...), busca na "ID PACOTE" E "NUMERACAO"
            orFilter = `or(NUMERACAO.eq.${scannedIdStr},"ID PACOTE".eq.${normalizedPacoteId})`;
        } else {
            // Se não for (ex: "L_4368"), só pode ser a "NUMERACAO"
            orFilter = `NUMERACAO.eq.${scannedIdStr}`;
        }

        const {data: found, error: selErr} = await supabase
            .from("Carregamento")
            .select("*")
            .or(orFilter)
            .limit(1);

        if (selErr) {
            console.error("Erro ao selecionar:", selErr);
            throw new Error("Erro ao consultar banco de dados.");
        }

        // ######################################################
        // ### INÍCIO DA LÓGICA DE ALTERAÇÃO (WATERFALL) ###
        // ######################################################

        if (!found || found.length === 0) {
            // NÃO ACHOU NA TABELA 'Carregamento'.
            // VAMOS TENTAR ACHAR NO 'Consolidado SBA7' (Lógica do Pacote Solto)

            // Se o ID bipado não for um pacote de 11 dígitos, não há o que buscar no consolidado.
            if (!normalizedPacoteId) {
                return new Response(
                    JSON.stringify({error: `Manga/Pacote ${scannedIdStr} não encontrado.`}),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
                );
            }

            // Busca na tabela Consolidado SBA7
            const {data: consFound, error: consErr} = await supabase
                .from("Consolidado SBA7")
                .select(`"Rota Otimizada"`) // Só precisamos da rota otimizada
                .eq("ID", normalizedPacoteId)
                .limit(1);

            if (consErr) {
                console.error("Erro ao buscar no Consolidado:", consErr);
                throw new Error("Erro ao consultar base consolidada.");
            }

            if (!consFound || consFound.length === 0) {
                // Não achou em NENHUMA das tabelas
                return new Response(
                    JSON.stringify({error: `Pacote ${normalizedPacoteId} não encontrado em nenhuma base.`}),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
                );
            }

            // Achou no Consolidado! Agora valida a rota.
            const consolidadoRecord = consFound[0];
            const consolidadoRotaOtimizada = String(consolidadoRecord["Rota Otimizada"] || '').trim().toUpperCase();

            // A rota selecionada (ex: "H5_PM1") deve ser otimizada (primeira letra)
            const rotaSelecionadaOtimizada = rotaSelecionadaStr.charAt(0).toUpperCase();

            if (consolidadoRotaOtimizada !== rotaSelecionadaOtimizada) {
                // Rota errada
                return new Response(
                    JSON.stringify({
                        error: `Erro: Pacote ${normalizedPacoteId} pertence à Rota ${consolidadoRotaOtimizada}, não à Rota ${rotaSelecionadaOtimizada}.`
                    }),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 400},
                );
            }

            // SUCESSO! Rota bateu com o consolidado.
            // Retornamos um tipo de sucesso diferente, que o frontend vai precisar entender.
            return new Response(
                JSON.stringify({
                    consolidadoSuccess: true, // Flag para o frontend
                    message: `OK! Pacote ${normalizedPacoteId} validado (Rota ${consolidadoRotaOtimizada}).`,
                }),
                {
                    headers: {...corsHeaders, "Content-Type": "application/json"},
                    status: 200,
                },
            );
        }

        // ####################################################
        // ### FIM DA LÓGICA DE ALTERAÇÃO (WATERFALL) ###
        // ####################################################

        // --- LÓGICA ANTIGA (se ACHOU na tabela 'Carregamento') ---

        const record = found[0];
        const recordRota = String(record.ROTA || '').trim().toUpperCase();
        const recordNumeracao = String(record.NUMERACAO || '').trim();

        // 2) Valida a Rota
        if (recordRota !== rotaSelecionadaStr) {
            return new Response(
                JSON.stringify({
                    error: `Erro: Manga/Pacote pertence à Rota ${recordRota}, não à Rota ${rotaSelecionadaStr}.`
                }),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 400},
            );
        }

        // 3) Verifica se já foi bipado (Idempotência)
        if (record.VALIDACAO === "BIPADO") {
            let updatedRecord = record;

            if (docaStr && record.DOCA !== docaStr) {
                const {data: updIdem, error: updIdemErr} = await supabase
                    .from("Carregamento")
                    .update({DOCA: docaStr})
                    .eq("NUMERACAO", recordNumeracao)
                    .select()
                    .limit(1);

                if (updIdemErr) {
                    console.error("Erro ao atualizar DOCA (idempotente):", updIdemErr);
                    // Não é um erro fatal, apenas um aviso
                }
                if (updIdem && updIdem.length > 0) updatedRecord = updIdem[0];
            }

            return new Response(
                JSON.stringify({
                    message: `Manga ${recordNumeracao} já estava validada.`,
                    updatedData: updatedRecord,
                    idempotent: true,
                }),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
            );
        }

        // 4) Faz o UPDATE na manga correta
        const updatePayload: Record<string, unknown> = {
            "BIPADO SAIDA": usuarioSaidaStr,
            "DATA SAIDA": dataSaidaBrasilia,
            VALIDACAO: "BIPADO",
        };
        if (docaStr) updatePayload.DOCA = docaStr;

        const {data: updatedRows, error: updErr} = await supabase
            .from("Carregamento")
            .update(updatePayload)
            .eq("NUMERACAO", recordNumeracao)
            .select()
            .limit(1);

        if (updErr) {
            console.error("Erro ao atualizar:", updErr);
            throw new Error(`Erro ao atualizar no banco: ${updErr.message}`);
        }

        if (!updatedRows || updatedRows.length === 0) {
            throw new Error(`Manga ${recordNumeracao} não pôde ser atualizada (nenhuma linha afetada).`);
        }

        // 5) Retorna a linha atualizada
        return new Response(
            JSON.stringify({
                message: "Manga validada com sucesso!",
                updatedData: updatedRows[0],
            }),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
        );
    } catch (error) {
        console.error("Erro geral:", (error as Error)?.message, (error as Error)?.stack);
        return new Response(
            JSON.stringify({error: (error as Error)?.message || "Erro interno"}),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 500},
        );
    }
});