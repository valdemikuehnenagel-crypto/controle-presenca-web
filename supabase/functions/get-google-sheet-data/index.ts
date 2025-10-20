import {serve} from "https://deno.land/std@0.177.0/http/server.ts";
import * as djwt from "https://deno.land/x/djwt@v2.8/mod.ts";


const SPREADSHEET_ID = "1SialDvwRRDfuJwdUAn4tXFVgbR6CYqdXtKD5xJFuG1A";


const MAIN_RANGE = "Ext. Weekly!A:L";
const ACURACIDADE_RANGE = "Ext. Acurac Week!A:H";


const TA_RANGE = "Ext. T&A!A:L";

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


function getYearFromDateString(dateStr: string): number | null {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    try {

        const m1 = s.match(/\d{1,2}\/\d{1,2}\/(\d{4})/);
        if (m1?.[1]) {
            const y = parseInt(m1[1], 10);
            return y > 1900 && y < 2100 ? y : null;
        }

        const m2 = s.match(/(\d{4})-\d{1,2}-\d{1,2}/);
        if (m2?.[1]) {
            const y = parseInt(m2[1], 10);
            return y > 1900 && y < 2100 ? y : null;
        }

        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            return y > 1900 && y < 2100 ? y : null;
        }

        const excel = Number(s);
        if (!isNaN(excel) && excel > 60) {

            const approxYear = 1900 + Math.floor((excel - 1) / 365.2425);
            return approxYear > 1900 && approxYear < 2100 ? approxYear : null;
        }
        return null;
    } catch {
        return null;
    }
}

function getMonthKeyFromDateString(dateStr: string): string | null {
    if (!dateStr) return null;
    const s = String(dateStr).trim();


    let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) {
        const y = parseInt(m[3], 10);
        const mo = parseInt(m[2], 10);
        if (!isNaN(y) && !isNaN(mo) && mo >= 1 && mo <= 12) {
            return `${y}-${String(mo).padStart(2, "0")}`;
        }
    }

    m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
        const y = parseInt(m[1], 10);
        const mo = parseInt(m[2], 10);
        if (!isNaN(y) && !isNaN(mo) && mo >= 1 && mo <= 12) {
            return `${y}-${String(mo).padStart(2, "0")}`;
        }
    }

    const d = new Date(s);
    if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const mo = d.getMonth() + 1;
        return `${y}-${String(mo).padStart(2, "0")}`;
    }

    const excel = Number(s);
    if (!isNaN(excel) && excel > 60) {
        const base = new Date(1899, 11, 30);
        const d2 = new Date(base.getTime() + excel * 86400000);
        const y = d2.getFullYear();
        const mo = d2.getMonth() + 1;
        return `${y}-${String(mo).padStart(2, "0")}`;
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
        const taEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(
            TA_RANGE,
        )}`;


        const [mainResponse, acuracidadeResponse, taResponse] = await Promise.all([
            fetch(mainEndpoint, {
                headers: {Authorization: `Bearer ${accessToken}`},
            }),
            fetch(acuracidadeEndpoint, {
                headers: {Authorization: `Bearer ${accessToken}`},
            }),
            fetch(taEndpoint, {
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
        if (!taResponse.ok) {
            throw new Error(
                `Erro API Sheets (T&A) (${taResponse.status}): ${await taResponse.text()}`,
            );
        }

        const mainSheetData = await mainResponse.json();
        const acuracidadeSheetData = await acuracidadeResponse.json();
        const taSheetData = await taResponse.json();

        const mainRows: string[][] = mainSheetData.values || [];
        const acuracidadeRows: string[][] = acuracidadeSheetData.values || [];
        const taRows: string[][] = taSheetData.values || [];


        if ((mainRows.length < 2) && (acuracidadeRows.length < 2) && (taRows.length < 2)) {

            return new Response(
                JSON.stringify({
                    weeks: [], kpis: [], codigosByKpi: {}, data: {},
                    gerentes: [], codigoToGerente: {}, macros: [],
                    codigoToMacro: {}, months: [], weekToMonth: {},
                }),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
            );
        }


        const processedData: Record<string, Record<string, Record<string, any>>> = {};
        const uniqueYearWeeks = new Set<string>();
        const uniqueKpis = new Set<string>();
        const kpiCodigoMap: Record<string, Set<string>> = {};
        const codigoToGerente: Record<string, string> = {};
        const gerentesSet = new Set<string>();
        const codigoToMacro: Record<string, string> = {};
        const macrosSet = new Set<string>();
        const weekToMonth: Record<string, string> = {};
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
                SEMANA: findCol(header, ["SEMANA", "Semana", "Data", "DATA"]),
                NumeroWeek: findCol(header, ["NumeroWeek", "Numero_Week", "Week", "NroWeek"]),
                KPI: findCol(header, ["KPI"]),
                CODIGO: findCol(header, ["CODIGO", "Código", "SERVICE", "Svc"]),
                RESULTADO: findCol(header, ["RESULTADO", "Resultado"]),
                META: findCol(header, ["META", "Meta"]),
                GERENCIA: findCol(header, ["Gerencia", "Gerência", "Gerente"]),
                MACRO: findCol(header, ["MACRO_REGIONAL", "Macro_Regional", "Macro"]),
            };

            if (
                colIndex.SEMANA === -1 || colIndex.NumeroWeek === -1 ||
                colIndex.KPI === -1 || colIndex.CODIGO === -1
            ) {
                console.error("Cabeçalho (Main) lido:", header);
                throw new Error(
                    "Colunas essenciais (SEMANA, NumeroWeek, KPI, CODIGO) não encontradas na aba Main.",
                );
            }

            dataRows.forEach((row) => {
                const kpi = row[colIndex.KPI];
                const kpiNorm = normalize(kpi);


                if (kpiNorm === KPI_ACURACIDADE_NORMALIZED || kpiNorm === KPI_TA_NORMALIZED) {
                    return;
                }

                const semanaValue = row[colIndex.SEMANA];
                const numeroWeekValue = row[colIndex.NumeroWeek];
                const codigo = row[colIndex.CODIGO];


                let weekNum: number | null = null;
                if (numeroWeekValue) {
                    const n = parseInt(String(numeroWeekValue).trim(), 10);
                    if (!isNaN(n) && n >= 1 && n <= 53) weekNum = n;
                }
                const year = getYearFromDateString(semanaValue);
                const monthKey = getMonthKeyFromDateString(semanaValue);
                const yearWeekKey =
                    year !== null && weekNum !== null
                        ? `${year}-W${String(weekNum).padStart(2, "0")}`
                        : null;
                if (!yearWeekKey || !kpi || !codigo) return;
                const gerente = colIndex.GERENCIA >= 0 ? (row[colIndex.GERENCIA] || "").trim() : "";
                const macro = colIndex.MACRO >= 0 ? (row[colIndex.MACRO] || "").trim() : "";
                const resultadoStr = String(row[colIndex.RESULTADO] || "").trim();
                const metaStr = String(row[colIndex.META] || "").trim();
                const resultadoNum = toNum(resultadoStr);
                const metaNum = toNum(metaStr);
                uniqueYearWeeks.add(yearWeekKey);
                if (monthKey) {
                    monthsSet.add(monthKey);
                    weekToMonth[yearWeekKey] = monthKey;
                }
                uniqueKpis.add(kpi);
                processedData[yearWeekKey] ??= {};
                processedData[yearWeekKey][kpi] ??= {};
                kpiCodigoMap[kpi] ??= new Set();
                kpiCodigoMap[kpi].add(codigo);
                processedData[yearWeekKey][kpi][codigo] = {
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
                SEMANA: findCol(header, ["DIA", "Data"]),
                NumeroWeek: findCol(header, ["NumeroWeek", "Numero_Week", "Week", "NroWeek"]),
                CODIGO: findCol(header, ["CODIGO", "Código", "SERVICE", "Svc"]),
                RESULTADO: findCol(header, ["Com Poc", "Com poc"]),
                META: findCol(header, ["Sem poc", "S/POC", "Sem Poc"]),
                GERENCIA: findCol(header, ["Gerencia", "Gerência", "Gerente"]),
                MACRO: findCol(header, ["MACRO_REGIONAL", "Macro_Regional", "Macro"]),
            };

            if (
                colIndexAcurac.SEMANA === -1 || colIndexAcurac.NumeroWeek === -1 ||
                colIndexAcurac.CODIGO === -1 || colIndexAcurac.RESULTADO === -1 ||
                colIndexAcurac.META === -1
            ) {
                console.error("Cabeçalho (Acuracidade) lido:", header);
                throw new Error(
                    "Colunas essenciais (DIA, NumeroWeek, CODIGO, Com Poc, Sem poc) não encontradas na aba Acuracidade.",
                );
            }

            dataRows.forEach((row) => {

                const kpi = KPI_ACURACIDADE_NAME;

                const semanaValue = row[colIndexAcurac.SEMANA];
                const numeroWeekValue = row[colIndexAcurac.NumeroWeek];
                const codigo = row[colIndexAcurac.CODIGO];

                let weekNum: number | null = null;
                if (numeroWeekValue) {
                    const n = parseInt(String(numeroWeekValue).trim(), 10);
                    if (!isNaN(n) && n >= 1 && n <= 53) weekNum = n;
                }
                const year = getYearFromDateString(semanaValue);
                const monthKey = getMonthKeyFromDateString(semanaValue);
                const yearWeekKey =
                    year !== null && weekNum !== null
                        ? `${year}-W${String(weekNum).padStart(2, "0")}`
                        : null;

                if (!yearWeekKey || !kpi || !codigo) return;

                const gerente = colIndexAcurac.GERENCIA >= 0 ? (row[colIndexAcurac.GERENCIA] || "").trim() : "";
                const macro = colIndexAcurac.MACRO >= 0 ? (row[colIndexAcurac.MACRO] || "").trim() : "";


                const resultadoStr = String(row[colIndexAcurac.RESULTADO] || "").trim();
                const metaStr = String(row[colIndexAcurac.META] || "").trim();

                const resultadoNum = toNum(resultadoStr);
                const metaNum = toNum(metaStr);


                uniqueYearWeeks.add(yearWeekKey);
                if (monthKey) {
                    monthsSet.add(monthKey);
                    weekToMonth[yearWeekKey] = monthKey;
                }
                uniqueKpis.add(kpi);
                processedData[yearWeekKey] ??= {};
                processedData[yearWeekKey][kpi] ??= {};
                kpiCodigoMap[kpi] ??= new Set();
                kpiCodigoMap[kpi].add(codigo);

                processedData[yearWeekKey][kpi][codigo] = {
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


        if (taRows.length >= 2) {
            const header = taRows[0];
            const dataRows = taRows.slice(1);


            const colIndexTA = {
                SEMANA: findCol(header, ["Inicio_Semana", "Inicio Semana", "Data"]),
                NumeroWeek: findCol(header, ["Week_Numero", "Week Numero", "NumeroWeek"]),
                CODIGO: findCol(header, ["CODIGO", "Código", "SERVICE", "Svc"]),
                DECIMAL_OK: findCol(header, ["Decimal_OK", "Decimal OK"]),
                DECIMAL_NOK: findCol(header, ["Decimal_NOK", "Decimal NOK"]),
                DECIMAL_PENDENTE: findCol(header, ["Decimal_PENDENTE", "Decimal Pendente"]),
                GERENCIA: findCol(header, ["Gerencia", "Gerência", "Gerente"]),
                MACRO: findCol(header, ["MACRO_REGIONAL", "Macro_Regional", "Macro"]),
            };

            if (
                colIndexTA.SEMANA === -1 || colIndexTA.NumeroWeek === -1 ||
                colIndexTA.CODIGO === -1 || colIndexTA.DECIMAL_OK === -1 ||
                colIndexTA.DECIMAL_NOK === -1 || colIndexTA.DECIMAL_PENDENTE === -1
            ) {
                console.error("Cabeçalho (T&A) lido:", header);
                throw new Error(
                    "Colunas essenciais (Inicio_Semana, Week_Numero, CODIGO, Decimal_OK, Decimal_NOK, Decimal_PENDENTE) não encontradas na aba T&A.",
                );
            }

            dataRows.forEach((row) => {

                const kpi = KPI_TA_NAME;

                const semanaValue = row[colIndexTA.SEMANA];
                const numeroWeekValue = row[colIndexTA.NumeroWeek];
                const codigo = row[colIndexTA.CODIGO];

                let weekNum: number | null = null;
                if (numeroWeekValue) {
                    const n = parseInt(String(numeroWeekValue).trim(), 10);
                    if (!isNaN(n) && n >= 1 && n <= 53) weekNum = n;
                }
                const year = getYearFromDateString(semanaValue);
                const monthKey = getMonthKeyFromDateString(semanaValue);
                const yearWeekKey =
                    year !== null && weekNum !== null
                        ? `${year}-W${String(weekNum).padStart(2, "0")}`
                        : null;

                if (!yearWeekKey || !kpi || !codigo) return;

                const gerente = colIndexTA.GERENCIA >= 0 ? (row[colIndexTA.GERENCIA] || "").trim() : "";
                const macro = colIndexTA.MACRO >= 0 ? (row[colIndexTA.MACRO] || "").trim() : "";


                const okStr = String(row[colIndexTA.DECIMAL_OK] || "").trim();
                const nokStr = String(row[colIndexTA.DECIMAL_NOK] || "").trim();
                const pendenteStr = String(row[colIndexTA.DECIMAL_PENDENTE] || "").trim();

                const okNum = toNum(okStr);
                const nokNum = toNum(nokStr);
                const pendenteNum = toNum(pendenteStr);


                uniqueYearWeeks.add(yearWeekKey);
                if (monthKey) {
                    monthsSet.add(monthKey);
                    weekToMonth[yearWeekKey] = monthKey;
                }
                uniqueKpis.add(kpi);
                processedData[yearWeekKey] ??= {};
                processedData[yearWeekKey][kpi] ??= {};
                kpiCodigoMap[kpi] ??= new Set();
                kpiCodigoMap[kpi].add(codigo);


                processedData[yearWeekKey][kpi][codigo] = {
                    ok: okNum,
                    nok: nokNum,
                    pendente: pendenteNum,
                    okRaw: okStr || "-",
                    nokRaw: nokStr || "-",
                    pendenteRaw: pendenteStr || "-",
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


        if (uniqueYearWeeks.size === 0) {

            return new Response(
                JSON.stringify({
                    weeks: [], kpis: [], codigosByKpi: {}, data: {},
                    gerentes: [], codigoToGerente: {}, macros: [],
                    codigoToMacro: {}, months: [], weekToMonth: {},
                }),
                {headers: {...corsHeaders, "Content-Type": "application/json"}, status: 200},
            );
        }


        const weeks = Array.from(uniqueYearWeeks).sort((a, b) => {
            const [ya, wa] = a.split("-W").map(Number);
            const [yb, wb] = b.split("-W").map(Number);
            if (yb !== ya) return yb - ya;
            return wb - wa;
        });

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
                weeks,
                kpis,
                codigosByKpi,
                data: processedData,
                gerentes,
                codigoToGerente,
                macros,
                codigoToMacro,
                months,
                weekToMonth,
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