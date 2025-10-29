import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import * as djwt from "https://deno.land/x/djwt@v2.8/mod.ts";


const SPREADSHEET_ID = "1SialDvwRRDfuJwdUAn4tXFVgbR6CYqdXtKD5xJFuG1A";


const MAIN_RANGE = "Ext. Daily!A:L";

const ACURACIDADE_RANGE = "Ext. Acurac Daily!A:H";

const KPI_ACURACIDADE_NAME = "Acuracidade de Inventário";
const KPI_ACURACIDADE_NORMALIZED = normalize(KPI_ACURACIDADE_NAME);


const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];


const BRT_OFFSET_MS = -3 * 60 * 60 * 1000;
const now = new Date(Date.now() + BRT_OFFSET_MS);
const CURRENT_YEAR = now.getUTCFullYear();
const CURRENT_MONTH = now.getUTCMonth() + 1;
const CURRENT_MONTH_KEY = `${CURRENT_YEAR}-${String(CURRENT_MONTH).padStart(2, "0")}`;


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


function getDateKeyFromDateString(dateStr: string): { dateKey: string; monthKey: string } | null {
    if (!dateStr) return null;
    const s = String(dateStr).trim();

    let y: number, mo: number, d: number;


    let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        y = parseInt(m[3], 10);
        mo = parseInt(m[2], 10);
        d = parseInt(m[1], 10);
    } else {

        m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) {
            y = parseInt(m[1], 10);
            mo = parseInt(m[2], 10);
            d = parseInt(m[3], 10);
        } else {

            const dt = new Date(s);
            if (!isNaN(dt.getTime())) {
                y = dt.getFullYear();
                mo = dt.getMonth() + 1;
                d = dt.getDate();
            } else {

                const excel = Number(s);
                if (!isNaN(excel) && excel > 60) {
                    const base = new Date(1899, 11, 30);
                    const d2 = new Date(base.getTime() + excel * 86400000);
                    y = d2.getFullYear();
                    mo = d2.getMonth() + 1;
                    d = d2.getDate();
                } else {
                    return null;
                }
            }
        }
    }

    if (!isNaN(y) && !isNaN(mo) && !isNaN(d) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        const monthKey = `${y}-${String(mo).padStart(2, "0")}`;
        const dateKey = `${monthKey}-${String(d).padStart(2, "0")}`;
        return {dateKey, monthKey};
    }
    return null;
}


function normalize(s: string) {
    if (typeof s !== 'string') return '';
    return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function findCol(header: string[], candidates: string[]) {
    const H = header.map(normalize);
    for (const c of candidates) {
        const i = H.indexOf(normalize(c));
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
        if (!clientEmail || !privateKey) throw new Error("Credenciais não configuradas.");

        const accessToken = await getGoogleAccessToken(clientEmail, privateKey);


        const mainEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(
            MAIN_RANGE,
        )}`;
        const acuracidadeEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(
            ACURACIDADE_RANGE,
        )}`;


        const [mainResponse, acuracidadeResponse] = await Promise.all([
            fetch(mainEndpoint, {
                headers: {Authorization: `Bearer ${accessToken}`},
            }),
            fetch(acuracidadeEndpoint, {
                headers: {Authorization: `Bearer ${accessToken}`},
            }),
        ]);


        if (!mainResponse.ok) {
            throw new Error(
                `Erro API Sheets (Main) (${mainResponse.status}): ${await mainResponse.text()}`,
            );
        }
        if (!acuracidadeResponse.ok) {
            throw new Error(
                `Erro API Sheets (Acuracidade) (${acuracidadeResponse.status}): ${await acuracidadeResponse.text()}`,
            );
        }

        const mainSheetData = await mainResponse.json();
        const acuracidadeSheetData = await acuracidadeResponse.json();

        const mainRows: string[][] = mainSheetData.values || [];
        const acuracidadeRows: string[][] = acuracidadeSheetData.values || [];


        const emptyResponse = {
            days: [],
            kpis: [],
            codigosByKpi: {},
            data: {},
            gerentes: [],
            codigoToGerente: {},
            macros: [],
            codigoToMacro: {},
            months: [],
            dayToMonth: {},
        };


        if ((mainRows.length < 2) && (acuracidadeRows.length < 2)) {

            return new Response(
                JSON.stringify(emptyResponse),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
            );
        }


        const processedData: Record<string, Record<string, Record<string, any>>> = {};
        const uniqueDays = new Set<string>();
        const uniqueKpis = new Set<string>();
        const kpiCodigoMap: Record<string, Set<string>> = {};
        const codigoToGerente: Record<string, string> = {};
        const gerentesSet = new Set<string>();
        const codigoToMacro: Record<string, string> = {};
        const macrosSet = new Set<string>();
        const dayToMonth: Record<string, string> = {};
        const monthsSet = new Set<string>();


        const toNum = (s: string) => {
            if (!s) return null;
            const isPercent = s.includes("%");
            const num = parseFloat(s.replace("%", "").replace(",", "."));
            if (isNaN(num)) return null;
            return isPercent ? num / 100 : num;
        };


        if (mainRows.length >= 2) {
            const header = mainRows[0];
            const dataRows = mainRows.slice(1);

            const colIndex = {
                DATA: findCol(header, ["DATA", "Data", "Dia", "SEMANA"]),
                KPI: findCol(header, ["KPI"]),
                CODIGO: findCol(header, ["CODIGO", "Código", "SERVICE", "Svc"]),
                RESULTADO: findCol(header, ["RESULTADO", "Resultado"]),
                META: findCol(header, ["META", "Meta"]),
                GERENCIA: findCol(header, ["Gerencia", "Gerência", "Gerente"]),
                MACRO: findCol(header, ["MACRO_REGIONAL", "Macro_Regional", "Macro"]),
            };

            if (
                colIndex.DATA === -1 || colIndex.KPI === -1 || colIndex.CODIGO === -1
            ) {
                console.error("Cabeçalho (Main) lido:", header);
                throw new Error(
                    "Colunas essenciais (DATA, KPI, CODIGO) não encontradas na aba Main.",
                );
            }

            dataRows.forEach((row, idx) => {
                const kpi = row[colIndex.KPI];


                if (normalize(kpi) === KPI_ACURACIDADE_NORMALIZED) {
                    return;
                }

                const dataValue = row[colIndex.DATA];
                const codigo = row[colIndex.CODIGO];

                const dateKeys = getDateKeyFromDateString(dataValue);
                if (!dateKeys) return;

                const {dateKey, monthKey} = dateKeys;


                if (monthKey !== CURRENT_MONTH_KEY) return;

                if (!kpi || !codigo) return;

                const gerente =
                    colIndex.GERENCIA >= 0 ? (row[colIndex.GERENCIA] || "").trim() : "";
                const macro =
                    colIndex.MACRO >= 0 ? (row[colIndex.MACRO] || "").trim() : "";

                const resultadoStr = String(row[colIndex.RESULTADO] || "").trim();
                const metaStr = String(row[colIndex.META] || "").trim();

                const resultadoNum = toNum(resultadoStr);
                const metaNum = toNum(metaStr);

                uniqueDays.add(dateKey);
                if (monthKey) {
                    monthsSet.add(monthKey);
                    dayToMonth[dateKey] = monthKey;
                }
                uniqueKpis.add(kpi);

                processedData[dateKey] ??= {};
                processedData[dateKey][kpi] ??= {};
                kpiCodigoMap[kpi] ??= new Set();
                kpiCodigoMap[kpi].add(codigo);

                processedData[dateKey][kpi][codigo] = {
                    resultado: resultadoNum,
                    meta: metaNum,
                    resultadoRaw: resultadoStr || "-",
                    metaRaw: metaStr || "-",
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
        }


        if (acuracidadeRows.length >= 2) {
            const header = acuracidadeRows[0];
            const dataRows = acuracidadeRows.slice(1);


            const colIndexAcurac = {
                DATA: findCol(header, ["DIA", "Data"]),
                CODIGO: findCol(header, ["CODIGO", "Código", "SERVICE", "Svc"]),
                RESULTADO: findCol(header, ["Com Poc", "Com poc"]),
                META: findCol(header, ["Sem poc", "S/POC", "Sem Poc"]),
                GERENCIA: findCol(header, ["Gerencia", "Gerência", "Gerente"]),
                MACRO: findCol(header, ["MACRO_REGIONAL", "Macro_Regional", "Macro"]),
            };

            if (
                colIndexAcurac.DATA === -1 || colIndexAcurac.CODIGO === -1 ||
                colIndexAcurac.RESULTADO === -1 || colIndexAcurac.META === -1
            ) {
                console.error("Cabeçalho (Acuracidade) lido:", header);
                throw new Error(
                    "Colunas essenciais (DIA, CODIGO, Com Poc, Sem poc) não encontradas na aba Acuracidade.",
                );
            }

            dataRows.forEach((row) => {

                const kpi = KPI_ACURACIDADE_NAME;

                const dataValue = row[colIndexAcurac.DATA];
                const codigo = row[colIndexAcurac.CODIGO];


                const dateKeys = getDateKeyFromDateString(dataValue);
                if (!dateKeys) return;

                const {dateKey, monthKey} = dateKeys;


                if (monthKey !== CURRENT_MONTH_KEY) return;

                if (!kpi || !codigo) return;

                const gerente = colIndexAcurac.GERENCIA >= 0 ? (row[colIndexAcurac.GERENCIA] || "").trim() : "";
                const macro = colIndexAcurac.MACRO >= 0 ? (row[colIndexAcurac.MACRO] || "").trim() : "";


                const resultadoStr = String(row[colIndexAcurac.RESULTADO] || "").trim();
                const metaStr = String(row[colIndexAcurac.META] || "").trim();

                const resultadoNum = toNum(resultadoStr);
                const metaNum = toNum(metaStr);


                uniqueDays.add(dateKey);
                if (monthKey) {
                    monthsSet.add(monthKey);
                    dayToMonth[dateKey] = monthKey;
                }
                uniqueKpis.add(kpi);

                processedData[dateKey] ??= {};
                processedData[dateKey][kpi] ??= {};
                kpiCodigoMap[kpi] ??= new Set();
                kpiCodigoMap[kpi].add(codigo);



                processedData[dateKey][kpi][codigo] = {
                    com_poc: resultadoNum,
                    sem_poc: metaNum,
                    com_pocRaw: resultadoStr || "-",
                    sem_pocRaw: metaStr || "-",
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
        }


        if (uniqueDays.size === 0) {

            return new Response(
                JSON.stringify(emptyResponse),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
            );
        }


        const days = Array.from(uniqueDays).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

        const kpis = Array.from(uniqueKpis).sort();
        const codigosByKpi: Record<string, string[]> = {};
        for (const k of Object.keys(kpiCodigoMap)) {
            codigosByKpi[k] = Array.from(kpiCodigoMap[k]).sort();
        }


        const months = Array.from(monthsSet).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
        const gerentes = Array.from(gerentesSet).sort();
        const macros = Array.from(macrosSet).sort();


        return new Response(
            JSON.stringify({
                days,
                kpis,
                codigosByKpi,
                data: processedData,
                gerentes,
                codigoToGerente,
                macros,
                codigoToMacro,
                months,
                dayToMonth,
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