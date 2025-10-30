// index.ts - Supabase Edge Function (V2 - Otimizada com Cache)

import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import * as djwt from "https://deno.land/x/djwt@v2.8/mod.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

// --- Configuração do Google Sheets ---
const SPREADSHEET_ID = "1SialDvwRRDfuJwdUAn4tXFVgbR6CYqdXtKD5xJFuG1A";
const SHEET_RANGE = "'Consolidado CONQUISTA'!A:C"; // ID, Rota, Rotas
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const CACHE_TTL_SECONDS = 300; // 5 minutos para o cache da planilha

// --- NOVO: Definição do Cache Global ---
interface CacheState {
    googleAccessToken: string | null;
    tokenExpiry: number | null; // UNIX timestamp em segundos
    packageMap: Map<string, string> | null;
    sheetEtag: string | null;
    mapLastFetched: number | null; // UNIX timestamp em segundos
}

// O cache global persiste entre invocações "quentes" da função
const globalCache: CacheState = {
    googleAccessToken: null,
    tokenExpiry: null,
    packageMap: null,
    sheetEtag: null,
    mapLastFetched: null,
};

// --- Fim da Definição do Cache ---


function pemToBinary(pem: string): ArrayBuffer {
    // (Nenhuma alteração nesta função)
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

// --- AJUSTADO: getGoogleAccessToken (agora com cache) ---
async function getGoogleAccessToken(
    clientEmail: string,
    privateKey: string,
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Verifica o cache primeiro
    // (Adiciona 60s de buffer de segurança)
    if (globalCache.googleAccessToken && globalCache.tokenExpiry && globalCache.tokenExpiry > (now + 60)) {
        // console.log("Cache hit: Google Access Token");
        return globalCache.googleAccessToken;
    }

    // 2. Se o cache falhar, busca um novo token
    // console.log("Cache miss: Buscando novo Google Access Token");
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

// --- NOVO: Função para buscar e cachear a planilha ---
async function getPacoteMap(accessToken: string): Promise<Map<string, string>> {
    const now = Math.floor(Date.now() / 1000);

    // 1. Verifica o cache (baseado no tempo)
    if (
        globalCache.packageMap &&
        globalCache.mapLastFetched &&
        (now - globalCache.mapLastFetched < CACHE_TTL_SECONDS)
    ) {
        // console.log("Cache hit: Mapa de Pacotes (Tempo)");
        return globalCache.packageMap;
    }

    // 2. Cache expirou, tenta revalidar com ETag
    const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`;
    const headers = {Authorization: `Bearer ${accessToken}`};

    if (globalCache.sheetEtag) {
        headers["If-None-Match"] = globalCache.sheetEtag;
    }

    // console.log("Cache miss: Buscando/Validando Planilha Google");
    const sheetResponse = await fetch(endpoint, {headers});

    // 3. (Otimização) Planilha não mudou, servidor retornou 304
    if (sheetResponse.status === 304) {
        // console.log("Cache hit: Mapa de Pacotes (ETag 304)");
        globalCache.mapLastFetched = now; // Atualiza o tempo do cache
        return globalCache.packageMap!; // Retorna o cache antigo (que ainda é válido)
    }

    // 4. (Download) Planilha mudou ou é a primeira vez
    if (!sheetResponse.ok) {
        throw new Error(`Erro ao buscar na planilha: ${await sheetResponse.text()}`);
    }

    const newEtag = sheetResponse.headers.get("etag");
    const sheetData = await sheetResponse.json();
    const rows: string[][] = (sheetData.values || []).slice(1); // Pula cabeçalho

    // 5. Constrói o novo Mapa (O(N))
    const newMap = new Map<string, string>();
    for (const row of rows) {
        // Coluna A (ID Pacote) -> Coluna C (Ilha/Rota)
        if (row[0] && row[0].trim() && row[2] && row[2].trim()) {
            newMap.set(row[0].trim(), row[2].trim());
        }
    }

    // 6. Salva o novo mapa e metadados no cache
    globalCache.packageMap = newMap;
    globalCache.sheetEtag = newEtag;
    globalCache.mapLastFetched = now;

    // console.log(`Cache refresh: Mapa de pacotes reconstruído com ${newMap.size} itens.`);
    return newMap;
}


// --- Lógica Principal da Função (AJUSTADA) ---
serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response("ok", {headers: corsHeaders});

    try {
        // --- 1. Captura e Conversão de Data ---
        // (Nenhuma alteração nesta seção)
        const {id_pacote, data_scan, usuario_entrada} = await req.json();

        if (!id_pacote) throw new Error("ID do pacote não fornecido.");
        if (!data_scan) throw new Error("Data da bipagem (data_scan) não fornecida.");
        if (!usuario_entrada) throw new Error("Usuário (usuario_entrada) não fornecido.");

        const idPacoteStr = String(id_pacote).trim();
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

        // Pega o token (do cache ou busca novo)
        const accessToken = await getGoogleAccessToken(clientEmail, privateKey);

        // Pega o mapa (do cache ou busca novo)
        const packageMap = await getPacoteMap(accessToken);

        // Busca O(1) no Mapa (em vez de O(N) no loop)
        const ilha: string | undefined = packageMap.get(idPacoteStr);

        if (!ilha) {
            return new Response(
                JSON.stringify({error: `Pacote ${idPacoteStr} não encontrado na planilha "Consolidado CONQUISTA".`}),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
            );
        }

        // --- 3. Gerar o novo ID da Manga ---
        // (Nenhuma alteração nesta seção)
        const lastFourDigits = idPacoteStr.slice(-4);
        const numeracaoManga = `${ilha}_${lastFourDigits}`;

        // --- 4. Salvar no Banco de Dados Supabase ---
        // (Nenhuma alteração nesta seção)
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
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

        if (error) {
            console.error("Erro Supabase:", error);
            throw new Error(`Erro ao salvar no banco: ${error.message}`);
        }

        // --- 5. Retornar sucesso para o Front-end ---
        // (Nenhuma alteração nesta seção)
        return new Response(
            JSON.stringify({
                message: "Manga registrada com sucesso!",
                numeracao: numeracaoManga,
                ilha: ilha,
                pacote: idPacoteStr,
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