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

        const {id_pacote, data_scan, usuario_entrada} = reqBody;

        if (!id_pacote) throw new Error("ID do pacote não fornecido.");
        if (!data_scan) throw new Error("Data da bipagem (data_scan) não fornecida.");
        if (!usuario_entrada) throw new Error("Usuário (usuario_entrada) não fornecido.");

        idPacoteStr = String(id_pacote).trim();
        const usuarioEntradaStr = String(usuario_entrada).trim();

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

        // --- 3. Buscar a Rota ---
        const {data: rotaData, error: rotaError} = await supabase
            .from("Consolidado SBA7")
            .select("Rota, \"Rota Otimizada\"") // <-- MUDANÇA 1: Selecionar as duas colunas
            .eq("ID", idPacoteStr)
            .single();

        if (rotaError || !rotaData) {
            console.error("Erro ao buscar rota no 'Consolidado SBA7':", rotaError);
            return new Response(
                JSON.stringify({error: `Pacote ${idPacoteStr} não encontrado na tabela 'Consolidado SBA7'.`}),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
            );
        }

        // <-- MUDANÇA 2: Atribuir as duas rotas a variáveis separadas
        const rotaCompleta: string = rotaData.Rota;         // Ex: "B19_PM1"
        const rotaOtimizada: string = rotaData["Rota Otimizada"]; // Ex: "B"

        // --- 4. Gerar o novo ID da Manga ---
        const lastFourDigits = idPacoteStr.slice(-4);
        // Usamos a rota *completa* para a numeração da manga
        const numeracaoManga = `${rotaCompleta}_${lastFourDigits}`; // Ex: "B19_PM1_1574"

        // --- 5. Salvar na tabela "Carregamento" ---
        const {data, error} = await supabase
            .from("Carregamento")
            .insert({
                "ID PACOTE": idPacoteStr,
                "DATA": dataBrasiliaComMs,
                "ROTA": rotaOtimizada, // <-- MUDANÇA 3: Salvar a rota otimizada ("B")
                "NUMERACAO": numeracaoManga,
                "QTD MANGA": 1,
                "BIPADO ENTRADA": usuarioEntradaStr
            })
            .select();

        // --- 6. Lidar com Duplicidade (Reimpressão) ---
        if (error) {
            if (error.code === "23505") {
                // Busca os dados existentes para reimpressão
                // Aqui também buscamos a "Rota" completa original para a impressão
                const {data: existingData, error: findError} = await supabase
                    .from("Carregamento")
                    .select("NUMERACAO, ROTA, \"ID PACOTE\"")
                    .eq("ID PACOTE", idPacoteStr)
                    .single();

                if (findError || !existingData) {
                    throw new Error(`Duplicidade detectada, mas falha ao buscar dados existentes: ${findError?.message}`);
                }

                // Precisamos achar a Rota Completa (B19_PM1) para a impressão funcionar
                // (A ROTA salva no banco é só "B", o que não ajuda a impressão)
                // Vamos buscar de novo no Consolidado (rápido)
                const {data: rotaOriginal} = await supabase
                    .from("Consolidado SBA7")
                    .select("Rota")
                    .eq("ID", idPacoteStr)
                    .single();

                return new Response(
                    JSON.stringify({
                        message: "Pacote já bipado. Reimpressão permitida.",
                        numeracao: existingData.NUMERACAO,
                        // A impressão precisa da rota completa (B19_PM1), não da otimizada (B)
                        ilha: rotaOriginal?.Rota || existingData.ROTA, // Usa a rota completa do Consolidado
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

        // --- 7. Retornar sucesso (Pacote Novo) ---
        return new Response(
            JSON.stringify({
                message: "Manga registrada com sucesso!",
                numeracao: numeracaoManga,
                // O frontend (impressão) espera a rota completa ("B19_PM1") no campo 'ilha'
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