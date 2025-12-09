import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response("ok", {headers: corsHeaders});

    let idPacoteStr = "";

    try {
        const reqBody = await req.json();

        if (reqBody.action === 'preload') {
            return new Response(
                JSON.stringify({success: true, message: "Cache não é mais necessário."}),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200}
            );
        }

        const {id_pacote, data_scan, usuario_entrada, svc} = reqBody;

        if (!id_pacote) throw new Error("ID do pacote não fornecido.");
        if (!data_scan) throw new Error("Data da bipagem (data_scan) não fornecida.");
        if (!usuario_entrada) throw new Error("Usuário (usuario_entrada) não fornecido.");

        idPacoteStr = String(id_pacote).trim();
        const usuarioEntradaStr = String(usuario_entrada).trim();

        // 1. Define o SVC padrão e a Tabela correta
        const svcStr = svc ? String(svc).trim() : "SBA7";
        const tabelaConsolidado = svcStr === "SBA3" ? "Consolidado SBA3" : "Consolidado SBA7";

        const utcDate = new Date(data_scan);
        const brasiliaFormatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: "America/Sao_Paulo",
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false
        });
        const dataFormatada = brasiliaFormatter.format(utcDate);
        const milissegundos = utcDate.getMilliseconds().toString().padStart(3, '0');
        const dataBrasiliaComMs = `${dataFormatada}.${milissegundos}`;

        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Credenciais Supabase não configuradas.");
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 2. Busca na tabela dinâmica (SBA7 ou SBA3)
        const {data: rotaData, error: rotaError} = await supabase
            .from(tabelaConsolidado) // <--- MUDANÇA AQUI
            .select("Rota, \"Rota Otimizada\"")
            .eq("ID", idPacoteStr)
            .single();

        if (rotaError || !rotaData) {
            console.error(`Erro ao buscar rota no '${tabelaConsolidado}':`, rotaError);
            return new Response(
                JSON.stringify({error: `Pacote ${idPacoteStr} não encontrado na tabela '${tabelaConsolidado}'.`}),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
            );
        }

        const rotaCompleta: string = rotaData.Rota;
        const rotaOtimizada: string = rotaData["Rota Otimizada"];

        const lastFourDigits = idPacoteStr.slice(-4);
        const numeracaoManga = `${rotaCompleta}_${lastFourDigits}`;

        // 3. Insere no Carregamento (Registrando qual SVC foi usado)
        const {data, error} = await supabase
            .from("Carregamento")
            .insert({
                "ID PACOTE": idPacoteStr,
                "DATA": dataBrasiliaComMs,
                "ROTA": rotaOtimizada,
                "NUMERACAO": numeracaoManga,
                "QTD MANGA": 1,
                "BIPADO ENTRADA": usuarioEntradaStr,
                "SVC": svcStr
            })
            .select();

        if (error) {
            if (error.code === "23505") {
                const {data: existingData, error: findError} = await supabase
                    .from("Carregamento")
                    .select("NUMERACAO, ROTA, \"ID PACOTE\"")
                    .eq("ID PACOTE", idPacoteStr)
                    .single();

                if (findError || !existingData) {
                    throw new Error(`Duplicidade detectada, mas falha ao buscar dados existentes: ${findError?.message}`);
                }

                // 4. Busca rota original na tabela certa para reimpressão
                const {data: rotaOriginal} = await supabase
                    .from(tabelaConsolidado) // <--- MUDANÇA AQUI TAMBÉM
                    .select("Rota")
                    .eq("ID", idPacoteStr)
                    .single();

                return new Response(
                    JSON.stringify({
                        message: "Pacote já bipado. Reimpressão permitida.",
                        numeracao: existingData.NUMERACAO,
                        ilha: rotaOriginal?.Rota || existingData.ROTA,
                        pacote: existingData["ID PACOTE"],
                        isDuplicate: true,
                        insertedData: null
                    }),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200}
                );
            }
            console.error("Erro Supabase (insert):", error);
            throw new Error(`Erro ao salvar no banco: ${error.message}`);
        }

        return new Response(
            JSON.stringify({
                message: "Manga registrada com sucesso!",
                numeracao: numeracaoManga,
                ilha: rotaCompleta,
                pacote: idPacoteStr,
                isDuplicate: false,
                insertedData: data
            }),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
        );

    } catch (error) {
        console.error("Erro geral na function:", error?.message, error?.stack);
        return new Response(
            JSON.stringify({error: (error as Error)?.message || "Erro interno"}),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 500},
        );
    }
});