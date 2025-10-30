// index.ts - Supabase Edge Function (Ajustada com Fuso Horário)

import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import * as djwt from "https://deno.land/x/djwt@v2.8/mod.ts";
import {createClient} from "https://esm.sh/@supabase/supabase-js@2";

// --- Configuração do Google Sheets ---
const SPREADSHEET_ID = "1SialDvwRRDfuJwdUAn4tXFVgbR6CYqdXtKD5xJFuG1A";
const SHEET_RANGE = "'Consolidado CONQUISTA'!A:C"; // ID, Rota, Rotas
const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

// --- Início das Funções Auxiliares (getGoogleAccessToken, pemToBinary) ---
// (Nenhuma alteração nesta seção)

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

async function getGoogleAccessToken(
    clientEmail: string,
    privateKey: string,
): Promise<string> {
    try {
        const formattedPrivateKey = privateKey.replace(/\\n/g, "\n");

        const cryptoKey = await crypto.subtle.importKey(
            "pkcs8",
            pemToBinary(formattedPrivateKey),
            {
                name: "RSASSA-PKCS1-v1_5",
                hash: "SHA-256",
            },
            true,
            ["sign"],
        );

        const header: djwt.Header = {alg: "RS256", typ: "JWT"};
        const now = Math.floor(Date.now() / 1000);
        const expiration = now + 3600;

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
        return tokenData.access_token;
    } catch (error) {
        console.error("Erro getGoogleAccessToken:", error);
        throw error;
    }
}

// --- Fim das Funções Auxiliares ---

// --- Lógica Principal da Função ---
serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response("ok", {headers: corsHeaders});

    try {
        // --- SEÇÃO AJUSTADA 1: Captura e Conversão de Data ---

        const {id_pacote, data_scan, usuario_entrada} = await req.json();

        // Validação dos campos
        if (!id_pacote) throw new Error("ID do pacote não fornecido.");
        if (!data_scan) throw new Error("Data da bipagem (data_scan) não fornecida.");
        if (!usuario_entrada) throw new Error("Usuário (usuario_entrada) não fornecido.");

        const idPacoteStr = String(id_pacote).trim();
        const usuarioEntradaStr = String(usuario_entrada).trim();

        // NOVO: Conversão de Fuso Horário
        // data_scan chega como UTC (Ex: "2025-10-30T02:10:38.487Z")
        const utcDate = new Date(data_scan);

        // Formata para uma string no fuso de Brasília (YYYY-MM-DD HH:mm:ss)
        // Usamos "sv-SE" (Sueco) porque ele tem o formato "YYYY-MM-DD" que queremos.
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

        const dataFormatada = brasiliaFormatter.format(utcDate); // Ex: "2025-10-29 23:10:38"

        // Pega os milissegundos da data UTC original
        const milissegundos = utcDate.getMilliseconds().toString().padStart(3, '0');

        // Junta a data formatada + milissegundos
        const dataBrasiliaComMs = `${dataFormatada}.${milissegundos}`; // Ex: "2025-10-29 23:10:38.487"

        // --- Fim da Seção Ajustada 1 ---


        // --- 1. Buscar dados do Google Sheets ---
        // (Nenhuma alteração nesta seção)
        const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL");
        const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
        if (!clientEmail || !privateKey) throw new Error("Credenciais Google não configuradas.");

        const accessToken = await getGoogleAccessToken(clientEmail, privateKey);
        const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}`;

        const sheetResponse = await fetch(endpoint, {
            headers: {Authorization: `Bearer ${accessToken}`},
        });
        if (!sheetResponse.ok) throw new Error(`Erro ao buscar na planilha: ${await sheetResponse.text()}`);

        const sheetData = await sheetResponse.json();
        const rows: string[][] = (sheetData.values || []).slice(1);

        let ilha: string | null = null;
        for (const row of rows) {
            if (row[0] && row[0].trim() === idPacoteStr) {
                ilha = row[2] ? row[2].trim() : null;
                break;
            }
        }

        if (!ilha) {
            return new Response(
                JSON.stringify({error: `Pacote ${idPacoteStr} não encontrado na planilha "Consolidado CONQUISTA".`}),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 404},
            );
        }

        // --- 2. Gerar o novo ID da Manga ---
        // (Nenhuma alteração nesta seção)
        const lastFourDigits = idPacoteStr.slice(-4);
        const numeracaoManga = `${ilha}_${lastFourDigits}`;

        // --- 3. Salvar no Banco de Dados Supabase ---
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
            throw new Error("Credenciais Supabase não configuradas.");
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // AJUSTE 2: Usar a nova string de data convertida
        const {data, error} = await supabase
            .from("Carregamento")
            .insert({
                "ID PACOTE": idPacoteStr,
                "DATA": dataBrasiliaComMs, // NOVO: Usando a string convertida para Brasília
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

        // --- 4. Retornar sucesso para o Front-end ---
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