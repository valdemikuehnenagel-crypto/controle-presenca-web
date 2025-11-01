// index.ts - Supabase Edge Function (V3 - Suporte a Reimpressão e Pré-Cache)

import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import * as djwt from "https://deno.land/x/djwt@v2.8/mod.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

// --- Configuração do Google Sheets ---
const SPREADSHEET_ID = "1SialDvwRRDfuJwdUAn4tXFVgbR6CYqdXtKD5xJFuG1A";
const SHEET_RANGE = "'Consolidado CONQUISTA'!A:C"; // ID, Rota, Rotas
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const CACHE_TTL_SECONDS = 300; // 5 minutos para o cache da planilha

// --- Definição do Cache Global ---
interface CacheState {
    googleAccessToken: string | null;
    tokenExpiry: number | null; // UNIX timestamp em segundos
    packageMap: Map<string, string> | null;
    sheetEtag: string | null;
    mapLastFetched: number | null; // UNIX timestamp em segundos
}

const globalCache: CacheState = {
    googleAccessToken: null,
    tokenExpiry: null,
    packageMap: null,
    sheetEtag: null,
    mapLastFetched: null,
};

// --- Fim da Definição do Cache ---


function pemToBinary(pem: string): ArrayBuffer {
    const base64 = pem
        .replace(/-----BEGIN PRIVATE KEY-----/g, "")
        .replace(/-----END PRIVATE KEY-----/g, "")
        .replace(/\s/g, "");
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes.buffer;
}

// --- getGoogleAccessToken (com cache) ---
async function getGoogleAccessToken(
    clientEmail: string,
    privateKey: string,
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Verifica o cache primeiro
    if (globalCache.googleAccessToken && globalCache.tokenExpiry && globalCache.tokenExpiry > (now + 60)) {
        return globalCache.googleAccessToken;
    }

    // 2. Se o cache falhar, busca um novo token
    try {
        const formattedPrivateKey = privateKey.replace(/\\n/g, "\n");

        const cryptoKey = await crypto.subtle.importKey(
            "pkcs8",
            pemToBinary(formattedPrivateKey),
            {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"},
            true,
            ["sign"],
        );

        const header: djwt.Header = {alg: "RS256", typ: "JWT"};
        const expiration = now + 3540; // 59 minutos

        const payload: djwt.Payload = {
            iss: clientEmail,
            scope: SCOPES.join(" "),
            aud: GOOGLE_TOKEN_URI,
            exp: expiration,
            iat: now,
        };

        const jwt = await djwt.create(header, payload, cryptoKey);

        const tokenResponse = await fetch(GOOGLE_TOKEN_URI, {
            method: "POST",
            headers: {"Content-Type": "application/x-www-form-urlencoded"},
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: jwt,
            }),
        });

        if (!tokenResponse.ok) {
            const errorBody = await tokenResponse.text();
            console.error("Erro token:", tokenResponse.status, errorBody);
            throw new Error(`Falha token: ${tokenResponse.statusText}`);
        }

        const tokenData = await tokenResponse.json();

        // 3. Salva o novo token no cache
        globalCache.googleAccessToken = tokenData.access_token;
        globalCache.tokenExpiry = now + (tokenData.expires_in || 3540);

        return tokenData.access_token;
    } catch (error) {
        console.error("Erro getGoogleAccessToken:", error);
        throw error;
    }
}

// --- Função para buscar e cachear a planilha ---
async function getPacoteMap(accessToken: string): Promise<Map<string, string>> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Verifica o cache (baseado no tempo)
    if (
        globalCache.packageMap &&
        globalCache.mapLastFetched &&
        (now - globalCache.mapLastFetched < CACHE_TTL_SECONDS)
    ) {
        return globalCache.packageMap;
    }

    // 2. Cache expirou, tenta revalidar com ETag
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`;
    const headers = {Authorization: `Bearer ${accessToken}`};

    if (globalCache.sheetEtag) {
        headers["If-None-Match"] = globalCache.sheetEtag;
    }

    const sheetResponse = await fetch(endpoint, {headers});

    // 3. (Otimização) Planilha não mudou (304)
    if (sheetResponse.status === 304) {
        globalCache.mapLastFetched = now; // Atualiza o tempo do cache
        return globalCache.packageMap!; // Retorna o cache antigo
    }

    // 4. (Download) Planilha mudou
    if (!sheetResponse.ok) {
        throw new Error(`Erro ao buscar na planilha: ${await sheetResponse.text()}`);
    }

    const newEtag = sheetResponse.headers.get("etag");
    const sheetData = await sheetResponse.json();
    const rows: string[][] = (sheetData.values || []).slice(1); // Pula cabeçalho

    // 5. Constrói o novo Mapa
    const newMap = new Map<string, string>();
    for (const row of rows) {
        if (row[0] && row[0].trim() && row[2] && row[2].trim()) {
            newMap.set(row[0].trim(), row[2].trim());
        }
    }

    // 6. Salva o novo mapa e metadados no cache
    globalCache.packageMap = newMap;
    globalCache.sheetEtag = newEtag;
    globalCache.mapLastFetched = now;

    return newMap;
}


// --- Lógica Principal da Função (AJUSTADA PARA REIMPRESSÃO E PRELOAD) ---
serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response("ok", {headers: corsHeaders});

    let idPacoteStr = ""; // Definido no escopo externo para uso no catch

    try {
        const reqBody = await req.json(); // Lê o body uma única vez

        // --- MELHORIA (Pré-carregamento do Cache) ---
        if (reqBody.action === 'preload') {
            console.log('Cache warm-up requested.');
            const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL");
            const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
            if (!clientEmail || !privateKey) throw new Error("Credenciais Google não configuradas (preload).");

            const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
            await getPacoteMap(accessToken); // Força o cache

            return new Response(
                JSON.stringify({success: true, message: "Cache pre-loaded."}),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200}
            );
        }
        // --- Fim da Melhoria ---


        // --- 1. Captura e Conversão de Data ---
        const {id_pacote, data_scan, usuario_entrada} = reqBody;

        if (!id_pacote) throw new Error("ID do pacote não fornecido.");
        if (!data_scan) throw new Error("Data da bipagem (data_scan) não fornecida.");
        if (!usuario_entrada) throw new Error("Usuário (usuario_entrada) não fornecido.");

        idPacoteStr = String(id_pacote).trim(); // Armazena para o catch
        const usuarioEntradaStr = String(usuario_entrada).trim();

        const utcDate = new Date(data_scan);
        const brasiliaFormatter = new Intl.DateTimeFormat('sv-SE', {
            timeZone: "America/Sao_Paulo",
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        const dataFormatada = brasiliaFormatter.format(utcDate);
        const milissegundos = utcDate.getMilliseconds().toString().padStart(3, '0');
        const dataBrasiliaComMs = `${dataFormatada}.${milissegundos}`;

        // --- 2. Buscar dados (AGORA DO CACHE) ---
        const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL");
        const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
        if (!clientEmail || !privateKey) throw new Error("Credenciais Google não configuradas.");

        const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
        const packageMap = await getPacoteMap(accessToken);

        const ilha: string | undefined = packageMap.get(idPacoteStr);

        if (!ilha) {
            return new Response(
                JSON.stringify({error: `Pacote ${idPacoteStr} não encontrado na planilha "Consolidado CONQUISTA".`}),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
            );
        }

        // --- 3. Gerar o novo ID da Manga ---
        const lastFourDigits = idPacoteStr.slice(-4);
        const numeracaoManga = `${ilha}_${lastFourDigits}`;

        // --- 4. Salvar no Banco de Dados Supabase (Tentar Inserir) ---
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error("Credenciais Supabase não configuradas.");
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const {data, error} = await supabase
            .from("Carregamento")
            .insert({
                "ID PACOTE": idPacoteStr,
                "DATA": dataBrasiliaComMs,
                "ROTA": ilha,
                "NUMERACAO": numeracaoManga,
                "QTD MANGA": 1,
                "BIPADO ENTRADA": usuarioEntradaStr
            })
            .select();

        // --- 5. Lidar com Erro (Verificar Duplicidade) ou Sucesso ---

        if (error) {
            // Verifica se o erro é de duplicidade (PostgreSQL error code 23505)
            if (error.code === "23505") {
                // É um pacote duplicado. Busca os dados existentes para reimpressão.
                const {data: existingData, error: findError} = await supabase
                    .from("Carregamento")
                    // MELHORIA (Erro Longo): Adiciona aspas na coluna "ID PACOTE"
                    .select("NUMERACAO, ROTA, \"ID PACOTE\"")
                    .eq("ID PACOTE", idPacoteStr)
                    .single();

                if (findError || !existingData) {
                    // Se a correção acima funcionar, este erro não deve mais acontecer
                    throw new Error(`Duplicidade detectada, mas falha ao buscar dados existentes: ${findError?.message}`);
                }

                // Retorna 200 OK com a flag de duplicidade
                return new Response(
                    JSON.stringify({
                        message: "Pacote já bipado. Reimpressão permitida.",
                        numeracao: existingData.NUMERACAO,
                        ilha: existingData.ROTA,
                        pacote: existingData["ID PACOTE"],
                        isDuplicate: true, // A flag que o frontend vai usar
                        insertedData: null
                    }),
                    {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200}
                );
            }

            // Se for qualquer outro erro, lança
            console.error("Erro Supabase (insert):", error);
            throw new Error(`Erro ao salvar no banco: ${error.message}`);
        }

        // --- 6. Retornar sucesso (Pacote Novo) ---
        return new Response(
            JSON.stringify({
                message: "Manga registrada com sucesso!",
                numeracao: numeracaoManga,
                ilha: ilha,
                pacote: idPacoteStr,
                isDuplicate: false, // Flag de sucesso
                insertedData: data
            }),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
        );

    } catch (error) {
        console.error("Erro geral:", error?.message, error?.stack);
        return new Response(
            JSON.stringify({error: (error as Error)?.message || "Erro interno"}),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 500},
        );
    }
});