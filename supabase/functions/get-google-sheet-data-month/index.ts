import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import * as djwt from "https://deno.land/x/djwt@v2.8/mod.ts";


const SPREADSHEET_ID = "1SialDvwRRDfuJwdUAn4tXFVgbR6CYqdXtKD5xJFuG1A";

const MAIN_RANGE = "Ext. Month!A:M";


const KPI_ACURACIDADE_NAME = "Acuracidade de Inventário";
const KPI_ACURACIDADE_NORMALIZED = normalize(KPI_ACURACIDADE_NAME);
const KPI_TA_NAME = "T & A";
const KPI_TA_NORMALIZED = normalize(KPI_TA_NAME);


const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];



async function getGoogleAccessToken(
    clientEmail: string,
    privateKey: string,
): Promise<string> {
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

function getMonthKeyFromDateString(dateStr: string): string | null {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    let y: number | undefined, mo: number | undefined;

    let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        y = parseInt(m[3], 10);
        mo = parseInt(m[2], 10);
    } else {
        m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) {
            y = parseInt(m[1], 10);
            mo = parseInt(m[2], 10);
        } else {
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) {
                y = dt.getFullYear();
                mo = dt.getMonth() + 1;
            } else {
                const excel = Number(s);
                if (!isNaN(excel) && excel > 60) {
                    const base = new Date(Date.UTC(1899, 11, 30));
                    const dateOffset = excel > 60 ? excel - 1 : excel;
                    const d2 = new Date(base.getTime() + dateOffset * 86400000);
                    y = d2.getUTCFullYear();
                    mo = d2.getUTCMonth() + 1;
                } else {
                    console.warn(`Could not parse date string: ${s}`);
                    return null;
                }
            }
        }
    }

    if (y !== undefined && mo !== undefined && !isNaN(y) && !isNaN(mo) && mo >= 1 && mo <= 12 && y > 1900 && y < 2100) {
        return `${y}-${String(mo).padStart(2, "0")}`;
    }
    console.warn(`Parsed invalid date components from string: ${s} -> Year: ${y}, Month: ${mo}`);
    return null;
}


function normalize(s: string): string {
    if (typeof s !== 'string') return '';
    return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function findCol(header: string[], candidates: string[]): number {
    const H = header.map(normalize);
    for (const c of candidates) {
        const normalizedCandidate = normalize(c);
        const i = H.indexOf(normalizedCandidate);
        if (i !== -1) return i;
    }
    return -1;
}


serve(async (req) => {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
            "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
    if (req.method === "OPTIONS") return new Response("ok", {headers: corsHeaders});

    try {
        const clientEmail = Deno.env.get("GOOGLE_CLIENT_EMAIL");
        const privateKey = Deno.env.get("GOOGLE_PRIVATE_KEY");
        if (!clientEmail || !privateKey) throw new Error("Credenciais Google não configuradas nas variáveis de ambiente.");
        const accessToken = await getGoogleAccessToken(clientEmail, privateKey);

        const mainEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(MAIN_RANGE)}`;
        const mainResponse = await fetch(mainEndpoint, {headers: {Authorization: `Bearer ${accessToken}`}});

        if (!mainResponse.ok) {
            const errorBody = await mainResponse.text();
            console.error(`Erro API Sheets (Month) (${mainResponse.status}): ${errorBody}`);
            throw new Error(`Erro ao buscar dados da planilha (Month): ${mainResponse.statusText}`);
        }

        const mainSheetData = await mainResponse.json();
        const mainRows: string[][] = mainSheetData.values || [];

        const emptyResponse = {
            months: [], kpis: [], codigosByKpi: {}, data: {},
            gerentes: [], codigoToGerente: {}, macros: [], codigoToMacro: {},
        };

        if (mainRows.length < 2) {
            console.log("Planilha 'Ext. Month' vazia ou sem dados após o cabeçalho.");
            return new Response(JSON.stringify(emptyResponse), {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json"
                }, status: 200
            });
        }

        const processedData: Record<string, Record<string, Record<string, any>>> = {};
        const uniqueMonths = new Set<string>();
        const uniqueKpis = new Set<string>();
        const kpiCodigoMap: Record<string, Set<string>> = {};
        const codigoToGerente: Record<string, string> = {};
        const gerentesSet = new Set<string>();
        const codigoToMacro: Record<string, string> = {};
        const macrosSet = new Set<string>();

        const toNum = (s: string): number | null => {
            if (typeof s !== 'string' || !s) return null;
            const cleanedString = s.replace("%", "").replace(",", ".");
            if (!cleanedString.trim()) return null;
            const num = parseFloat(cleanedString);
            if (isNaN(num)) return null;
            return s.includes("%") ? num / 100 : num;
        };


        const header = mainRows[0];
        const dataRows = mainRows.slice(1);


        const colIndex = {
            MES: findCol(header, ["MES", "Data", "Mês"]),
            KPI: findCol(header, ["KPI"]),
            CODIGO: findCol(header, ["CODIGO", "Código", "SERVICE", "Svc"]),
            RESULTADO: findCol(header, ["RESULTADO", "Resultado"]),

            GERENCIA: findCol(header, ["GERENTE", "Gerencia", "Gerência"]),
            MACRO: findCol(header, ["MACRO_REGIONAL", "Macro_Regional", "Macro"]),
        };


        if (
            colIndex.MES === -1 || colIndex.KPI === -1 || colIndex.CODIGO === -1 ||
            colIndex.RESULTADO === -1
        ) {
            console.error("Cabeçalho (Month) lido:", header);
            const missing = [
                colIndex.MES === -1 ? '"MES"' : null,
                colIndex.KPI === -1 ? '"KPI"' : null,
                colIndex.CODIGO === -1 ? '"CODIGO/SVC"' : null,
                colIndex.RESULTADO === -1 ? '"RESULTADO"' : null,

            ].filter(Boolean).join(', ');
            throw new Error(`Colunas essenciais (${missing}) não encontradas na aba "Ext. Month". Cabeçalho lido: [${header.join(', ')}]`);
        }


        dataRows.forEach((row, rowIndex) => {
            const kpi = row[colIndex.KPI];
            if (typeof kpi !== 'string' || !kpi) {
                return;
            }
            const kpiNorm = normalize(kpi);


            if (kpiNorm === KPI_TA_NORMALIZED) {
                return;
            }


            const mesValue = row[colIndex.MES];
            const codigo = row[colIndex.CODIGO];
            if (typeof codigo !== 'string' || !codigo) {
                return;
            }

            const monthKey = getMonthKeyFromDateString(mesValue);
            if (!monthKey) {
                return;
            }

            const gerente = colIndex.GERENCIA !== -1 ? (row[colIndex.GERENCIA] || "").trim() : "";
            const macro = colIndex.MACRO !== -1 ? (row[colIndex.MACRO] || "").trim() : "";
            const resultadoStr = String(row[colIndex.RESULTADO] || "").trim();
            const resultadoNum = toNum(resultadoStr);

            uniqueMonths.add(monthKey);
            uniqueKpis.add(kpi);

            processedData[monthKey] ??= {};
            processedData[monthKey][kpi] ??= {};
            kpiCodigoMap[kpi] ??= new Set();
            kpiCodigoMap[kpi].add(codigo);


            processedData[monthKey][kpi][codigo] = {
                resultado: resultadoNum,
                resultadoRaw: resultadoStr || "-",
            };

            if (gerente) {
                if (!codigoToGerente[codigo]) codigoToGerente[codigo] = gerente;
                gerentesSet.add(gerente);
            }
            if (macro) {
                if (!codigoToMacro[codigo]) codigoToMacro[codigo] = macro;
                macrosSet.add(macro);
            }
        });


        if (uniqueMonths.size === 0) {
            console.log("Nenhum dado válido encontrado para processar após leitura das linhas.");
            return new Response(JSON.stringify(emptyResponse), {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json"
                }, status: 200
            });
        }

        const months = Array.from(uniqueMonths).sort((a, b) => b.localeCompare(a));
        const kpis = Array.from(uniqueKpis).sort();
        const codigosByKpi: Record<string, string[]> = {};

        for (const k of kpis) {

            codigosByKpi[k] = Array.from(kpiCodigoMap[k] || []).sort();
        }
        const gerentes = Array.from(gerentesSet).sort();
        const macros = Array.from(macrosSet).sort();

        console.log(`Dados processados: ${uniqueMonths.size} meses, ${uniqueKpis.size} KPIs.`);
        return new Response(
            JSON.stringify({
                months, kpis, codigosByKpi, data: processedData,
                gerentes, codigoToGerente, macros, codigoToMacro,
            }),
            {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
        );

    } catch (error) {
        console.error("Erro geral na função Month:", error?.message, error?.stack);
        return new Response(JSON.stringify({error: (error as Error)?.message || "Erro interno desconhecido."}), {
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
            }, status: 500
        });
    }
});