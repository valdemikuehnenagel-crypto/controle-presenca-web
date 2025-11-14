// /supabase/functions/get-processar-carregamento-validacao/index.ts

import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

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

        const scannedIdStr = String(id_pacote).trim().toUpperCase();
        const normalizedPacoteId = extractElevenDigits(scannedIdStr);
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

        // ######################################################
        // ### INÍCIO DA CORREÇÃO DE LÓGICA DE BUSCA ###
        // ######################################################

        const orFilterParts = [];

        // 1. Adiciona o ID escaneado (para NUMERACAO completa ou "pacote solto")
        orFilterParts.push(`NUMERACAO.eq.${scannedIdStr}`);

        // 2. Adiciona o ID de 11 dígitos (para QR Code ou "pacote solto")
        if (normalizedPacoteId) {
            orFilterParts.push(`"ID PACOTE".eq.${normalizedPacoteId}`);
        }

        // 3. (A CORREÇÃO) Adiciona a busca por 'LIKE' se for uma etiqueta curta (ex: "D26_3242")
        // Isso é para o caso de a NUMERACAO no DB ser "D26_PM1_3242"
        if (!normalizedPacoteId && scannedIdStr.includes('_')) {
            const parts = scannedIdStr.split('_');
            if (parts.length >= 2) {
                const scanPrefix = parts[0]; // "D26"
                const scanSuffix = parts[parts.length - 1]; // "3242"

                // Procura por "D26%3242"
                const likePattern = `${scanPrefix}%${scanSuffix}`;
                orFilterParts.push(`NUMERACAO.like.${likePattern}`);
            }
        }

        // Remove duplicados (caso scannedIdStr seja igual a normalizedPacoteId, etc.)
        const uniqueOrFilterParts = [...new Set(orFilterParts)];
        const orFilter = `or(${uniqueOrFilterParts.join(',')})`;

        // ######################################################
        // ### FIM DA CORREÇÃO DE LÓGICA DE BUSCA ###
        // ######################################################

        const {data: found, error: selErr} = await supabase
            .from("Carregamento")
            .select("*")
            .or(orFilter) // Usa o novo filtro robusto
            .limit(1);

        if (selErr) {
            console.error("Erro ao selecionar:", selErr);
            throw new Error("Erro ao consultar banco de dados.");
        }

        if (!found || found.length === 0) {
            // NÃO ACHOU NA TABELA 'Carregamento'.

            // Se não achou, SÓ PODE ser um "pacote solto".
            // E um "pacote solto" DEVE ser um ID de 11 dígitos.
            if (!normalizedPacoteId) {
                return new Response(
                    JSON.stringify({error: `Manga/Pacote ${scannedIdStr} não encontrado.`}),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
                );
            }

            // OK, é um pacote solto (ID de 11 dígitos). Vamos validar no 'Consolidado SBA7'

            const {data: consFound, error: consErr} = await supabase
                .from("Consolidado SBA7")
                .select(`"Rota", "Rota Otimizada"`)
                .eq("ID", normalizedPacoteId)
                .limit(1);

            if (consErr) {
                console.error("Erro ao buscar no Consolidado:", consErr);
                throw new Error("Erro ao consultar base consolidada.");
            }

            if (!consFound || consFound.length === 0) {
                return new Response(
                    JSON.stringify({error: `Pacote ${normalizedPacoteId} não encontrado em nenhuma base.`}),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
                );
            }

            const consolidadoRecord = consFound[0];
            const consolidadoRotaOtimizada = String(consolidadoRecord["Rota Otimizada"] || '').trim().toUpperCase();
            const consolidadoRotaCompleta = String(consolidadoRecord["Rota"] || '').trim().toUpperCase();

            // A Rota selecionada no modal (ex: "D") é a otimizada
            const rotaSelecionadaOtimizada = rotaSelecionadaStr.charAt(0).toUpperCase();

            if (consolidadoRotaOtimizada !== rotaSelecionadaOtimizada) {
                return new Response(
                    JSON.stringify({
                        error: `Erro: Pacote ${normalizedPacoteId} pertence à Rota ${consolidadoRotaOtimizada}, não à Rota ${rotaSelecionadaOtimizada}.`
                    }),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 400},
                );
            }

            // Rota válida! VAMOS INSERIR

            const insertPayload = {
                "ID PACOTE": normalizedPacoteId,
                "DATA": dataSaidaBrasilia,
                "DATA SAIDA": dataSaidaBrasilia,
                "ROTA": consolidadoRotaCompleta, // Salva a Rota *Completa* do consolidado
                "NUMERACAO": normalizedPacoteId, // Usamos o ID do pacote como "Numeração"
                "QTD MANGA": 1,
                "BIPADO ENTRADA": usuarioSaidaStr,
                "BIPADO SAIDA": usuarioSaidaStr,
                "VALIDACAO": "BIPADO",
                "DOCA": docaStr,
            };

            const {data: insertedRows, error: insertErr} = await supabase
                .from("Carregamento")
                .insert(insertPayload)
                .select();

            if (insertErr) {
                console.error("Erro ao inserir pacote solto:", insertErr);

                // Idempotência: (chave duplicada)
                if (insertErr.code === "23505") {
                    const {data: updatedRows, error: updErr} = await supabase
                        .from("Carregamento")
                        .update({
                            "BIPADO SAIDA": usuarioSaidaStr,
                            "DATA SAIDA": dataSaidaBrasilia,
                            "VALIDACAO": "BIPADO",
                            "DOCA": docaStr,
                        })
                        .eq("NUMERACAO", normalizedPacoteId)
                        .select();

                    if (updErr || !updatedRows || updatedRows.length === 0) {
                        return new Response(
                            JSON.stringify({error: `Pacote ${normalizedPacoteId} já existe, mas falhou ao re-validar.`}),
                            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 500},
                        );
                    }

                    return new Response(
                        JSON.stringify({
                            message: `Pacote ${normalizedPacoteId} já estava validado (idempotente).`,
                            updatedData: updatedRows[0],
                            idempotent: true,
                        }),
                        {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
                    );
                }

                throw new Error(`Erro ao inserir pacote no carregamento: ${insertErr.message}`);
            }

            if (!insertedRows || insertedRows.length === 0) {
                throw new Error("Falha ao inserir pacote solto: nenhum dado retornado.");
            }

            // Retorna o SUCESSO da inserção
            return new Response(
                JSON.stringify({
                    message: `OK! Pacote ${normalizedPacoteId} validado e registrado.`,
                    updatedData: insertedRows[0],
                }),
                {
                    headers: {...corsHeaders, "Content-Type": "application/json"},
                    status: 200,
                },
            );
        }

        // --- ACHOU NA TABELA 'Carregamento' ---
        // (Seja pelo QR, Numeração completa ou Numeração curta com LIKE)

        const record = found[0];
        const recordRota = String(record.ROTA || '').trim().toUpperCase();
        const recordNumeracao = String(record.NUMERACAO || '').trim();

        // VALIDAÇÃO DA ROTA:
        // O select do modal (rotaSelecionadaStr) é a Rota Otimizada (ex: "D")
        // O banco (recordRota) deve conter a Rota Otimizada (ex: "D")
        // (Seu dado de exemplo {"ROTA":"D"} está correto)
        if (recordRota !== rotaSelecionadaStr) {
            return new Response(
                JSON.stringify({
                    error: `Erro: Manga pertence à Rota ${recordRota}, não à Rota ${rotaSelecionadaStr}.`
                }),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 400},
            );
        }

        if (record.VALIDACAO === "BIPADO") {
            let updatedRecord = record;
            if (docaStr && record.DOCA !== docaStr) {
                const {data: updIdem, error: updIdemErr} = await supabase
                    .from("Carregamento")
                    .update({DOCA: docaStr})
                    .eq("NUMERACAO", recordNumeracao)
                    .select()
                    .limit(1);

                if (updIdemErr) console.error("Erro ao atualizar DOCA (idempotente):", updIdemErr);
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