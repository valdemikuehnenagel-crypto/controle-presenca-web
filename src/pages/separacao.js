import {Html5Qrcode, Html5QrcodeSupportedFormats} from "html5-qrcode";
import qrcode from "qrcode-generator";
import {createClient} from "@supabase/supabase-js";

const SUPABASE_URL = "https://tzbqdjwgbisntzljwbqp.supabase.co";
const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6YnFkandnYmlzbnR6bGp3YnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MTQyNTUsImV4cCI6MjA3MTk5MDI1NX0.fl0GBdHF_Pc56FSCVkKmCrCQANMVGvQ8sKLDoqK7eAQ";
const FUNC_SEPARACAO_URL = `${SUPABASE_URL}/functions/v1/get-processar-manga-separacao`;
const FUNC_CARREGAMENTO_URL = `${SUPABASE_URL}/functions/v1/get-processar-carregamento-validacao`;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const SUPPORTED_FORMATS = [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.UPC_A,
];
const BRASILIA_TIMEZONE = "America/Sao_Paulo";
let state = {
    cacheData: [],
    idPacoteMap: new Map(),
    isSeparaçãoProcessing: false,
    isCarregamentoProcessing: false,
    selectedDock: null,
    selectedIlha: null,
    globalScannerInstance: null,
    currentScannerTarget: null,
    pendingDecodedText: null,
    lastPrintData: null,
    period: {
        start: null,
        end: null
    },
    isImporting: false,
    charts: {
        topRoutes: null,
        timeline: null,
        pendingRoutes: null,
        dockIssues: null,
    },
};
let dom = {
    summaryContainer: null,
    routesContainer: null,
    btnSeparação: null,
    btnCarregamento: null,
    periodBtn: null,
    btnImportarConsolidado: null,
    modalSeparação: null,
    modalSepClose: null,
    sepUser: null,
    sepScan: null,
    sepStatus: null,
    sepQrArea: null,
    sepQrTitle: null,
    sepQrCanvas: null,
    sepPrintBtn: null,
    sepCamBtn: null,
    modalCarregamento: null,
    modalCarClose: null,
    carUser: null,
    carDockSelect: null,
    carIlhaSelect: null,
    carScan: null,
    carStatus: null,
    carCamBtn: null,
    scannerModal: null,
    scannerContainer: null,
    scannerCancelBtn: null,
    scannerFeedbackOverlay: null,
    scannerFeedbackCloseBtn: null,
    scannerConfirmOverlay: null,
    scannerConfirmText: null,
    scannerConfirmYesBtn: null,
    scannerConfirmNoBtn: null,
    relatorioModal: null,
    relatorioModalClose: null,
    relatorioTitle: null,
    relatorioBody: null,
    modalImportar: null,
    importCloseBtn: null,
    importTextarea: null,
    importSubmitBtn: null,
    importStatus: null,
    netBanner: null,
    netMsg: null,
    netForceBtn: null,
    netCloseBtn: null,
    tabBtnSeparacao: null,
    tabBtnAnalise: null,
    subtabSeparacao: null,
    subtabAnalise: null,
};
let eventHandlers = {
    onOnline: null,
    onSepSuccess: null,
    onCarSuccess: null,
};
const NET_TIMEOUT_MS = 8000;
const OUTBOX_KEY = "auditoriaOutboxV1";
let outbox = {
    queue: [],
    sending: false
};

async function ensureApexCharts() {
    if (window.ApexCharts) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/apexcharts";
        s.onload = resolve;
        s.onerror = () => reject(new Error("Falha ao carregar ApexCharts"));
        document.head.appendChild(s);
    });
}

function getBrazilDateKey(isoString) {
    if (!isoString) return null;
    try {
        let dateToParse = isoString;
        if (!isoString.endsWith("Z") && !isoString.includes("+")) {
            dateToParse += "Z";
        }
        const dateObj = new Date(dateToParse);
        const formatter = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "America/Sao_Paulo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        return formatter.format(dateObj);
    } catch (e) {
        return isoString ? isoString.split("T")[0] : null;
    }
}

function switchTab(tabName) {
    if (!dom.subtabSeparacao || !dom.subtabAnalise) return;
    const activeBtnClass = ["bg-white", "text-blue-700", "shadow"];
    const inactiveBtnClass = [
        "text-gray-500",
        "hover:text-gray-700",
        "bg-transparent",
        "shadow-none",
    ];
    if (tabName === "separacao") {
        dom.subtabSeparacao.classList.remove("hidden");
        dom.subtabAnalise.classList.add("hidden");
        if (dom.tabBtnSeparacao) {
            dom.tabBtnSeparacao.classList.add(...activeBtnClass);
            dom.tabBtnSeparacao.classList.remove(...inactiveBtnClass);
        }
        if (dom.tabBtnAnalise) {
            dom.tabBtnAnalise.classList.remove(...activeBtnClass);
            dom.tabBtnAnalise.classList.add(...inactiveBtnClass);
        }
    } else {
        dom.subtabSeparacao.classList.add("hidden");
        dom.subtabAnalise.classList.remove("hidden");
        if (dom.tabBtnAnalise) {
            dom.tabBtnAnalise.classList.add(...activeBtnClass);
            dom.tabBtnAnalise.classList.remove(...inactiveBtnClass);
        }
        if (dom.tabBtnSeparacao) {
            dom.tabBtnSeparacao.classList.remove(...activeBtnClass);
            dom.tabBtnSeparacao.classList.add(...inactiveBtnClass);
        }
        renderAnalysisTab();
    }
}

async function renderAnalysisTab() {
    await ensureApexCharts();
    const data = state.cacheData;
    if (!data) return;
    const rotasMap = new Map();
    const docasMap = new Map();
    const timeMap = new Map();
    const bipadorMap = new Map();
    data.forEach((item) => {
        const r = item.ROTA || "N/A";
        if (!rotasMap.has(r)) rotasMap.set(r, {
            total: 0,
            ok: 0,
            pending: 0
        });
        const rStats = rotasMap.get(r);
        rStats.total++;
        if (item.VALIDACAO === "BIPADO") rStats.ok++;
        else rStats.pending++;
        const d = item.DOCA ? String(item.DOCA).trim() : null;
        const labelDoca = d || "S/D";
        if (!docasMap.has(labelDoca))
            docasMap.set(labelDoca, {
                total: 0,
                pending: 0
            });
        const dStats = docasMap.get(labelDoca);
        dStats.total++;
        if (item.VALIDACAO !== "BIPADO") dStats.pending++;
        const dateKey = getBrazilDateKey(item.DATA);
        if (dateKey) {
            if (!timeMap.has(dateKey)) timeMap.set(dateKey, {
                total: 0,
                ok: 0
            });
            const tStats = timeMap.get(dateKey);
            tStats.total++;
            if (item.VALIDACAO === "BIPADO") tStats.ok++;
        }
        if (item.VALIDACAO === "BIPADO" && item["BIPADO SAIDA"]) {
            const nome = item["BIPADO SAIDA"].trim();
            if (nome) {
                bipadorMap.set(nome, (bipadorMap.get(nome) || 0) + 1);
            }
        }
    });
    const rotasArr = Array.from(rotasMap.entries()).map(([rota, st]) => ({
        rota,
        ...st,
        assertividade: st.total > 0 ? (st.ok / st.total) * 100 : 0,
    }));
    const timeArr = Array.from(timeMap.entries()).sort((a, b) =>
        a[0].localeCompare(b[0]),
    );
    const totalGeral = rotasArr.reduce((acc, r) => acc + r.total, 0);
    const totalOk = rotasArr.reduce((acc, r) => acc + r.ok, 0);
    const percentualGeral =
        totalGeral > 0 ? ((totalOk / totalGeral) * 100).toFixed(1) : 0;
    const elKpiPerc = document.getElementById("kpi-percentual");
    const elKpiBar = document.getElementById("kpi-percentual-bar");
    if (elKpiPerc) elKpiPerc.innerText = `${percentualGeral}%`;
    if (elKpiBar) elKpiBar.style.width = `${percentualGeral}%`;
    const sortedByAssert = [...rotasArr]
        .filter((r) => r.total > 5)
        .sort((a, b) => b.assertividade - a.assertividade);
    const bestRoute =
        sortedByAssert.length > 0 ?
            sortedByAssert[0] :
            rotasArr[0] || {
                rota: "---"
            };
    const elKpiBest = document.getElementById("kpi-best-route");
    if (elKpiBest) elKpiBest.innerText = `Rota ${bestRoute.rota}`;
    const sortedByPending = [...rotasArr]
        .filter((r) => r.pending > 0)
        .sort((a, b) => b.pending - a.pending);
    const worstRoute = sortedByPending.length > 0 ? sortedByPending[0] : null;
    const elKpiWorst = document.getElementById("kpi-worst-route");
    if (elKpiWorst) {
        elKpiWorst.innerText = worstRoute ? `Rota ${worstRoute.rota}` : "100% OK";
        elKpiWorst.className = worstRoute ?
            "text-xl font-bold text-red-600 truncate mt-0.5" :
            "text-xl font-bold text-green-600 truncate mt-0.5";
    }
    const validDockIssues = Array.from(docasMap.entries())
        .map(([doca, st]) => ({
            doca,
            ...st
        }))
        .filter((d) => d.doca !== "S/D" && d.doca !== "---" && d.pending > 0)
        .sort((a, b) => b.pending - a.pending);
    const worstDock = validDockIssues.length > 0 ? validDockIssues[0] : null;
    const elKpiDock = document.getElementById("kpi-worst-dock");
    if (elKpiDock) {
        elKpiDock.innerText = worstDock ? `${worstDock.doca}` : "100% OK";
        elKpiDock.className = worstDock ?
            "text-xl font-bold text-red-600 truncate mt-0.5" :
            "text-xl font-bold text-green-600 truncate mt-0.5";
    }
    let bestBipadorName = "---";
    let bestBipadorCount = 0;
    const bipadoresArr = Array.from(bipadorMap.entries()).map(
        ([nome, count]) => ({
            nome,
            count
        }),
    );
    bipadoresArr.sort((a, b) => b.count - a.count);
    if (bipadoresArr.length > 0) {
        bestBipadorName = bipadoresArr[0].nome;
        bestBipadorCount = bipadoresArr[0].count;
    }
    const elKpiBipador = document.getElementById("kpi-best-bipador");
    if (elKpiBipador)
        elKpiBipador.innerText =
            bestBipadorName !== "---" ?
                `${bestBipadorName} (${bestBipadorCount})` :
                "---";
    renderChart("chart-timeline", "timeline", {
        series: [{
            name: "Volume",
            type: "column",
            data: timeArr.map((t) => t[1].total)
        },
            {
                name: "Assertividade (%)",
                type: "line",
                data: timeArr.map((t) => {
                    const total = t[1].total;
                    const ok = t[1].ok;
                    return total > 0 ? ((ok / total) * 100).toFixed(1) : 0;
                }),
            },
        ],
        xaxis: {
            categories: timeArr.map((t) => {
                const parts = t[0].split("-");
                return `${parts[2]}/${parts[1]}`;
            }),
        },
        chart: {
            type: "line",
            height: 250
        },
        dataLabels: {
            enabled: true,
            enabledOnSeries: [1],
            formatter: (val) => val + "%",
        },
        colors: ["#e5e7eb", "#16a34a"],
        stroke: {
            width: [0, 4]
        },
        yaxis: [{
            title: {
                text: "Volume"
            }
        },
            {
                opposite: true,
                title: {
                    text: "Assertividade"
                },
                max: 100
            },
        ],
    });
    const top5Assert = sortedByAssert.slice(0, 5);
    renderChart("chart-top-routes", "topRoutes", {
        series: [{
            name: "Assertividade (%)",
            data: top5Assert.map((r) => r.assertividade.toFixed(1)),
        },],
        xaxis: {
            categories: top5Assert.map((r) => r.rota)
        },
        chart: {
            type: "bar",
            height: 220
        },
        colors: ["#2563eb"],
        dataLabels: {
            enabled: true,
            formatter: (val) => val + "%",
            style: {
                colors: ["#fff"]
            },
        },
        plotOptions: {
            bar: {
                borderRadius: 4,
                horizontal: true
            }
        },
    });
    const top5Pending = sortedByPending.slice(0, 5);
    renderChart("chart-pending-routes", "pendingRoutes", {
        series: [{
            name: "Pendentes",
            data: top5Pending.map((r) => r.pending)
        }],
        xaxis: {
            categories: top5Pending.map((r) => r.rota)
        },
        chart: {
            type: "bar",
            height: 220
        },
        dataLabels: {
            enabled: true,
            style: {
                colors: ["#fff"]
            }
        },
        colors: ["#ef4444"],
        plotOptions: {
            bar: {
                borderRadius: 4,
                horizontal: false
            }
        },
    });
    const top5Bipadores = bipadoresArr.slice(0, 5);
    renderChart("chart-top-bipadores", "dockIssues", {
        series: [{
            name: "Volume Saída",
            data: top5Bipadores.map((b) => b.count)
        }],
        xaxis: {
            categories: top5Bipadores.map((b) => {
                const parts = b.nome.split(" ");
                return parts[0];
            }),
        },
        chart: {
            type: "bar",
            height: 220
        },
        dataLabels: {
            enabled: true,
            style: {
                colors: ["#fff"]
            }
        },
        colors: ["#8b5cf6"],
        plotOptions: {
            bar: {
                borderRadius: 4,
                horizontal: false
            }
        },
        tooltip: {
            y: {
                formatter: (val) => val + " bipagens"
            },
        },
    });
}

function renderChart(domId, chartKey, options) {
    const defaultOpts = {
        chart: {
            toolbar: {
                show: false
            },
            fontFamily: "inherit"
        },
        dataLabels: {
            enabled: false
        },
        grid: {
            show: false,
            padding: {
                left: 0,
                right: 0
            }
        },
    };
    const finalOpts = {
        ...defaultOpts,
        ...options,
        chart: {
            ...defaultOpts.chart,
            ...options.chart
        },
        dataLabels: {
            ...defaultOpts.dataLabels,
            ...(options.dataLabels || {})
        },
        grid: {
            ...defaultOpts.grid,
            ...(options.grid || {})
        },
    };
    if (state.charts[chartKey]) {
        state.charts[chartKey].updateOptions(finalOpts);
    } else {
        const el = document.getElementById(domId);
        if (el) {
            state.charts[chartKey] = new ApexCharts(el, finalOpts);
            state.charts[chartKey].render();
        }
    }
}

function createImportarModal() {
    if (document.getElementById("modal-importar-consolidado")) return;
    const modal = document.createElement("div");
    modal.id = "modal-importar-consolidado";
    modal.className = "modal-overlay hidden";
    modal.style.zIndex = "1200";
    modal.innerHTML = `

        <div class="modal-content" style="width: 95vw; max-width: 800px;">

            <div class="flex justify-between items-center mb-4 border-b pb-2">

                <h3 class="text-xl font-semibold">Importar Consolidado SBA7</h3>

                <button id="importar-consolidado-close" class="modal-close" type="button">&times;</button>

            </div>

            <div id="importar-consolidado-body">

                <p class="text-sm text-gray-600 mb-2">Cole os dados (CTRL+V) do seu consolidado no formato <strong>ID_PACOTE [espaço/tab] ROTA</strong>, um por linha.</p>

                <p class="text-xs text-red-600 mb-4"><strong>ATENÇÃO:</strong> Isso vai apagar TODOS os dados antigos e substituir pelos novos.</p>

                <textarea id="importar-textarea" class="w-full h-64 p-2 border border-gray-300 rounded-md font-mono text-sm" placeholder="45662053071 G22_PM1\n45662604505 L21_PM1\n..."></textarea>

                <div id="importar-status" class="mt-2 text-sm font-medium text-gray-700 h-6"></div>

                <div class="mt-4 flex justify-end">

                    <button id="importar-submit-btn" class="px-4 py-2 bg-green-600 text-white font-semibold rounded-md shadow hover:bg-green-700">

                        Importar Dados

                    </button>

                </div>

            </div>

        </div>

    `;
    document.body.appendChild(modal);
    dom.modalImportar = modal;
    dom.importCloseBtn = modal.querySelector("#importar-consolidado-close");
    dom.importTextarea = modal.querySelector("#importar-textarea");
    dom.importSubmitBtn = modal.querySelector("#importar-submit-btn");
    dom.importStatus = modal.querySelector("#importar-status");
}

async function handleImportarConsolidado() {
    if (state.isImporting) return;
    const rawText = dom.importTextarea.value;
    if (!rawText || !rawText.trim()) {
        dom.importStatus.textContent = "Área de texto vazia.";
        dom.importStatus.className = "mt-2 text-sm font-medium text-red-600 h-6";
        return;
    }
    state.isImporting = true;
    dom.importSubmitBtn.disabled = true;
    dom.importSubmitBtn.textContent = "Importando...";
    dom.importStatus.className = "mt-2 text-sm font-medium text-blue-600 h-6";
    dom.importStatus.textContent = "Preparando dados...";
    const lines = rawText.trim().split("\n");
    const rows = [];
    let idx = 0;
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        const parts = trimmedLine.split(/\s+/);
        if (parts.length >= 2 && parts[0].length >= 11) {
            const id = parts[0].trim();
            const rota = parts[1].trim();
            const rotaOtimizada = rota.charAt(0).toUpperCase();
            rows.push({
                ID: id,
                Rota: rota,
                "Rota Otimizada": rotaOtimizada,
            });
            idx++;
        } else {
            console.warn("Linha ignorada (formato inválido):", line);
        }
    }
    if (rows.length === 0) {
        dom.importStatus.textContent =
            "Nenhum dado válido encontrado para importar.";
        dom.importStatus.className = "mt-2 text-sm font-medium text-red-600 h-6";
        state.isImporting = false;
        dom.importSubmitBtn.disabled = false;
        dom.importSubmitBtn.textContent = "Importar Dados";
        return;
    }
    try {
        dom.importStatus.textContent = `Encontrados ${rows.length} registros. Limpando tabela antiga...`;
        const {
            error: deleteError
        } = await supabase
            .from("Consolidado SBA7")
            .delete()
            .neq("ID", "dummy-id-que-nunca-vai-existir");
        if (deleteError) {
            console.error("Erro ao limpar tabela:", deleteError);
            throw new Error(`Falha ao limpar tabela antiga: ${deleteError.message}`);
        }
        dom.importStatus.textContent = `Tabela limpa. Inserindo ${rows.length} novos registros...`;
        const {
            error: insertError
        } = await supabase
            .from("Consolidado SBA7")
            .insert(rows);
        if (insertError) {
            console.error("Erro ao inserir dados:", insertError);
            throw new Error(`Falha ao inserir novos dados: ${insertError.message}`);
        }
        dom.importStatus.textContent = `Sucesso! ${rows.length} registros importados.`;
        dom.importStatus.className = "mt-2 text-sm font-medium text-green-600 h-6";
        dom.importTextarea.value = "";
        setTimeout(() => {
            closeModal(dom.modalImportar);
        }, 2000);
    } catch (err) {
        console.error("Erro na importação:", err);
        dom.importStatus.textContent = `Erro: ${err.message}`;
        dom.importStatus.className = "mt-2 text-sm font-medium text-red-600 h-6";
    } finally {
        state.isImporting = false;
        dom.importSubmitBtn.disabled = false;
        dom.importSubmitBtn.textContent = "Importar Dados";
    }
}

function loadOutbox() {
    try {
        const raw = localStorage.getItem(OUTBOX_KEY);
        outbox = raw ? JSON.parse(raw) : {
            queue: [],
            sending: false
        };
        if (!Array.isArray(outbox.queue)) outbox.queue = [];
    } catch {
        outbox = {
            queue: [],
            sending: false
        };
    }
}

function saveOutbox() {
    try {
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    } catch {
    }
}

function installNetworkBanner() {
    if (document.getElementById("net-banner")) return;
    const wrap = document.createElement("div");
    wrap.id = "net-banner";
    wrap.className = "fixed bottom-4 left-1/2 -translate-x-1/2 z-[1200] hidden";
    wrap.innerHTML = `

    <div class="px-4 py-3 rounded-lg shadow-lg border border-yellow-300 bg-yellow-50 text-yellow-900 flex items-center gap-3">

      <span id="net-msg" class="text-sm font-medium">Falha na conexão com a rede… Tentando registrar</span>

      <button id="net-force" class="px-3 py-1 rounded-md bg-yellow-600 text-white text-sm font-semibold hover:bg-yellow-700">Forçar envio</button>

      <button id="net-close" class="px-2 py-1 rounded-md border text-sm">Fechar</button>

    </div>`;
    document.body.appendChild(wrap);
    dom.netBanner = wrap;
    dom.netMsg = wrap.querySelector("#net-msg");
    dom.netForceBtn = wrap.querySelector("#net-force");
    dom.netCloseBtn = wrap.querySelector("#net-close");
    dom.netForceBtn.addEventListener("click", () => processOutbox(true));
    dom.netCloseBtn.addEventListener("click", () => hideNetBanner());
}

function showNetBanner(msg) {
    if (!dom.netBanner) installNetworkBanner();
    if (dom.netMsg && msg) dom.netMsg.textContent = msg;
    dom.netBanner.classList.remove("hidden");
}

function updateNetBannerCount() {
    const n = outbox.queue.length;
    showNetBanner(
        `Falha na conexão com a rede… Tentando registrar (${n} na fila)`,
    );
}

function hideNetBannerSoon(okMsg = "Tudo certo: itens enviados") {
    if (!dom.netBanner) return;
    if (dom.netMsg) dom.netMsg.textContent = okMsg;
    setTimeout(() => dom.netBanner.classList.add("hidden"), 1500);
}

function hideNetBanner() {
    dom.netBanner?.classList.add("hidden");
}

function fetchWithTimeout(url, opt = {}, timeoutMs = NET_TIMEOUT_MS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const merged = {
        ...opt,
        signal: ctrl.signal
    };
    return fetch(url, merged).finally(() => clearTimeout(t));
}

function isNetworkLikeError(err) {
    const s = String(err?.message || err || "").toLowerCase();
    return (
        s.includes("network") ||
        s.includes("failed to fetch") ||
        s.includes("abort") ||
        s.includes("timeout")
    );
}

function enqueueTask(task) {
    loadOutbox();
    outbox.queue.push(task);
    saveOutbox();
    updateNetBannerCount();
    setTimeout(() => processOutbox(), 1200);
}

async function processOutbox(force = false) {
    loadOutbox();
    if (outbox.sending) return;
    if (!force && !navigator.onLine) {
        updateNetBannerCount();
        return;
    }
    outbox.sending = true;
    saveOutbox();
    try {
        while (outbox.queue.length > 0) {
            updateNetBannerCount();
            const task = outbox.queue[0];
            try {
                const res = await fetchWithTimeout(task.url, {
                    method: "POST",
                    headers: buildFunctionHeaders(),
                    body: JSON.stringify(task.body),
                });
                const json = await res.json().catch(() => ({}));
                if (!res.ok && !json?.isDuplicate && !json?.idempotent) {
                    console.error("[Outbox] Falha definitiva:", json);
                    outbox.queue.shift();
                    saveOutbox();
                    window.dispatchEvent(
                        new CustomEvent("outbox:failure", {
                            detail: {
                                task,
                                json
                            }
                        }),
                    );
                    continue;
                }
                outbox.queue.shift();
                saveOutbox();
                window.dispatchEvent(
                    new CustomEvent("outbox:success", {
                        detail: {
                            task,
                            json
                        }
                    }),
                );
                if (task.kind === "separacao") {
                    window.dispatchEvent(
                        new CustomEvent("outbox:separacao:success", {
                            detail: {
                                task,
                                json
                            },
                        }),
                    );
                } else if (task.kind === "carregamento") {
                    window.dispatchEvent(
                        new CustomEvent("outbox:carregamento:success", {
                            detail: {
                                task,
                                json
                            },
                        }),
                    );
                }
            } catch (err) {
                if (isNetworkLikeError(err)) {
                    console.warn("[Outbox] Rede ainda indisponível, mantendo fila.");
                    updateNetBannerCount();
                    break;
                }
                console.error("[Outbox] Erro inesperado, descartando item:", err);
                outbox.queue.shift();
                saveOutbox();
            }
        }
    } finally {
        outbox.sending = false;
        saveOutbox();
        if (outbox.queue.length === 0) hideNetBannerSoon();
        else updateNetBannerCount();
    }
}

async function tryPostOrQueue(kind, url, body) {
    try {
        const res = await fetchWithTimeout(url, {
            method: "POST",
            headers: buildFunctionHeaders(),
            body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok && !json?.isDuplicate && !json?.idempotent) {
            const msg = json?.error || `Falha (HTTP ${res.status})`;
            throw new Error(msg);
        }
        return {
            queued: false,
            json
        };
    } catch (err) {
        if (isNetworkLikeError(err) || !navigator.onLine) {
            enqueueTask({
                id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                kind,
                url,
                body,
                createdAt: Date.now(),
            });
            showNetBanner(
                "Falha na conexão com a rede… Tentando registrar (1 na fila)",
            );
            return {
                queued: true
            };
        }
        throw err;
    }
}

function handleOutboxSepSuccess(ev) {
    const {
        json
    } = ev.detail || {};
    try {
        const {
            numeracao,
            ilha,
            insertedData,
            pacote,
            isDuplicate,
            message
        } =
        json || {};
        if (!numeracao) return;
        if (insertedData && insertedData[0]) {
            state.cacheData.unshift(insertedData[0]);
            const id = extractElevenDigits(insertedData[0]["ID PACOTE"]);
            if (id) state.idPacoteMap.set(id, insertedData[0]);
        }
        renderDashboard();
        if (pacote) {
            state.lastPrintData = {
                dataForQr: pacote,
                ilha,
                mangaLabel: numeracao
            };
        }
        const friendly = isDuplicate ?
            message || "Pacote já bipado. Reimpressão permitida." :
            `Manga ${numeracao} (Rota ${ilha}) registrada (enviada após reconexão).`;
        setSepStatus(`${friendly} — Use "Reimprimir" se precisar.`, {
            error: false,
        });
        try {
            state.globalScannerInstance?.resume();
        } catch {
        }
    } catch (e) {
        console.error("[Outbox] pós-sucesso separação falhou:", e);
    }
}

function handleOutboxCarSuccess(ev) {
    const {
        json
    } = ev.detail || {};
    try {
        const {
            updatedData,
            idempotent,
            message
        } = json || {};
        const updatedNumeracao = updatedData?.NUMERACAO;
        if (!updatedNumeracao) return;
        const idx = state.cacheData.findIndex(
            (i) => i.NUMERACAO === updatedNumeracao,
        );
        if (idx > -1) {
            state.cacheData[idx] = {
                ...state.cacheData[idx],
                ...updatedData
            };
            const id = extractElevenDigits(state.cacheData[idx]["ID PACOTE"]);
            if (id) state.idPacoteMap.set(id, state.cacheData[idx]);
        } else {
            state.cacheData.unshift(updatedData);
            const id = extractElevenDigits(updatedData["ID PACOTE"]);
            if (id) state.idPacoteMap.set(id, updatedData);
        }
        renderDashboard();
        const okMsg = idempotent ?
            message || `Manga ${updatedNumeracao} já estava validada.` :
            `OK! ${updatedNumeracao} validada (após reconexão).`;
        setCarStatus(okMsg, {
            error: false
        });
    } catch (e) {
        console.error("[Outbox] pós-sucesso carregamento falhou:", e);
    }
}

function getBrasiliaDate(asDateObject = false) {
    const date = new Date();
    const formatter = new Intl.DateTimeFormat("sv-SE", {
        timeZone: BRASILIA_TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    if (asDateObject) {
        const parts = formatter.format(date).split("-").map(Number);
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return formatter.format(date);
}

function clampEndToToday(startStr, endStr) {
    const todayISO = getBrasiliaDate(false);
    if (endStr > todayISO) endStr = todayISO;
    if (startStr > endStr) startStr = endStr;
    return [startStr, endStr];
}

function toast(message, type = "info") {
    console.warn(`TOAST (${type}):`, message);
    alert(message);
}

function buildFunctionHeaders() {
    return {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
}

function buildSelectHeaders() {
    return {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
}

function formatarDataHack(isoString, formatOptions) {
    if (!isoString) return "---";
    try {
        let dt;
        if (isoString.includes("+00") || isoString.endsWith("Z")) {
            const localIso = isoString.substring(0, 19).replace("T", " ");
            dt = new Date(localIso);
        } else {
            dt = new Date(isoString);
        }
        return dt.toLocaleString("pt-BR", formatOptions);
    } catch {
        return "---";
    }
}

function formatarDataHora(isoString) {
    const options = {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    };
    return formatarDataHack(isoString, options);
}

function formatarDataInicio(isoString) {
    if (!isoString) return "---";
    const options = {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    };
    try {
        return formatarDataHack(isoString, options).replace(",", "") + "h";
    } catch {
        return "---";
    }
}

function waitForPaint() {
    return new Promise((r) => {
        requestAnimationFrame(() => requestAnimationFrame(r));
    });
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function printCurrentQr() {
    if (!dom.sepQrArea || dom.sepQrArea.style.display === "none") {
        setSepStatus("Primeiro gere um QR Code para imprimir.", {
            error: true
        });
        return;
    }
    await waitForPaint();
    dom.sepQrArea.offsetHeight;
    await waitForPaint();
    await sleep(400);
    window.print();
}

function extractElevenDigits(str) {
    if (str == null) return null;
    const digits = String(str).replace(/\D+/g, "");
    if (digits.length >= 11) return digits.slice(-11);
    return null;
}

function normalizeScanned(input) {
    if (!input) return "";
    const s = String(input).trim();
    if (s.startsWith("{") && s.endsWith("}")) {
        try {
            const obj = JSON.parse(s);
            const idFromJson = obj?.id ?? obj?.ID ?? obj?.Id;
            const cleaned = extractElevenDigits(idFromJson);
            if (cleaned) return cleaned;
        } catch {
        }
    }
    const seq = s.match(/\d{11,}/);
    if (seq) return seq[0].slice(-11);
    const cleaned = extractElevenDigits(s);
    return cleaned || s;
}

function openModal(modal) {
    if (!modal || !modal.classList.contains("hidden")) return;
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    dom._currentModal = modal;
    if (!modal._bound) modal._bound = {};
    modal._bound.onKeyDown ??= (e) => {
        if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            if (state.globalScannerInstance) {
                stopGlobalScanner();
            } else {
                closeModal(modal);
            }
        }
    };
    modal._bound.onOverlayClick ??= (e) => {
        const content = modal.querySelector(".modal-content");
        if (!content) return;
        if (!content.contains(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            closeModal(modal);
        }
    };
    document.addEventListener("keydown", modal._bound.onKeyDown);
    modal.addEventListener("click", modal._bound.onOverlayClick, true);
    const first = modal.querySelector(
        'input, button, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (first) setTimeout(() => first.focus(), 50);
}

function closeModal(modal) {
    if (!modal || modal.classList.contains("hidden")) return;
    if (state.globalScannerInstance) stopGlobalScanner();
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    if (modal._bound?.onKeyDown)
        document.removeEventListener("keydown", modal._bound.onKeyDown);
    if (modal._bound?.onOverlayClick)
        modal.removeEventListener("click", modal._bound.onOverlayClick, true);
    dom._currentModal = null;
}

function resetSeparacaoModal() {
    if (state.globalScannerInstance) stopGlobalScanner();
    if (dom.sepScan) dom.sepScan.value = "";
    setSepStatus("");
    clearSepQrCanvas();
}

function resetCarregamentoModal({
                                    preserveUser = true,
                                    preserveDock = true,
                                } = {}) {
    if (state.globalScannerInstance) stopGlobalScanner();
    if (!preserveUser && dom.carUser) dom.carUser.value = "";
    if (!preserveDock) {
        state.selectedDock = null;
        if (dom.carDockSelect) dom.carDockSelect.value = "";
    }
    state.selectedIlha = null;
    if (dom.carIlhaSelect) dom.carIlhaSelect.value = "";
    if (dom.carScan) dom.carScan.value = "";
    setCarStatus("");
}

function showScannerFeedback(type, message, sticky = false) {
    if (!dom.scannerFeedbackOverlay) return;
    const textEl = dom.scannerFeedbackOverlay.querySelector("span");
    if (textEl) textEl.textContent = message;
    dom.scannerFeedbackOverlay.classList.remove(
        "hidden",
        "bg-green-500",
        "bg-red-500",
    );
    if (type === "success") {
        dom.scannerFeedbackOverlay.classList.add("bg-green-500");
        dom.scannerFeedbackCloseBtn.style.display = "none";
        setTimeout(() => dom.scannerFeedbackOverlay.classList.add("hidden"), 2500);
    } else {
        dom.scannerFeedbackOverlay.classList.add("bg-red-500");
        dom.scannerFeedbackCloseBtn.style.display = "block";
        if (!sticky)
            setTimeout(
                () => dom.scannerFeedbackOverlay.classList.add("hidden"),
                1500,
            );
    }
}

function showScannerConfirm(decodedText, onYes, onNo) {
    if (!dom.scannerConfirmOverlay) return;
    state.pendingDecodedText = decodedText;
    dom.scannerConfirmText.textContent = decodedText;
    dom.scannerConfirmOverlay.classList.remove("hidden");
    const yesHandler = () => {
        dom.scannerConfirmOverlay.classList.add("hidden");
        dom.scannerConfirmYesBtn.removeEventListener("click", yesHandler);
        dom.scannerConfirmNoBtn.removeEventListener("click", noHandler);
        onYes?.(decodedText);
    };
    const noHandler = () => {
        dom.scannerConfirmOverlay.classList.add("hidden");
        dom.scannerConfirmYesBtn.removeEventListener("click", yesHandler);
        dom.scannerConfirmNoBtn.removeEventListener("click", noHandler);
        onNo?.();
    };
    dom.scannerConfirmYesBtn.addEventListener("click", yesHandler);
    dom.scannerConfirmNoBtn.addEventListener("click", noHandler);
}

function createGlobalScannerModal() {
    if (document.getElementById("auditoria-scanner-modal")) return;
    const modal = document.createElement("div");
    modal.id = "auditoria-scanner-modal";
    modal.className = "modal-overlay hidden";
    modal.style.zIndex = "1100";
    const content = document.createElement("div");
    content.className = "modal-content relative";
    content.style.width = "90vw";
    content.style.maxWidth = "600px";
    content.innerHTML = `

    <div class="flex justify-between items-center mb-4 border-b pb-2">

      <h3 class="text-xl font-semibold">Escanear QR/Barra</h3>

    </div>

    <div id="auditoria-scanner-container" style="width: 100%; overflow: hidden; border-radius: 8px;"></div>

    <button id="auditoria-scanner-cancel" type="button"

      class="w-full mt-4 px-4 py-2 bg-gray-600 text-white font-semibold rounded-md shadow hover:bg-gray-700">

      Cancelar

    </button>

    <div id="scanner-feedback-overlay"

      class="hidden absolute inset-0 bg-green-500 bg-opacity-95 flex flex-col items-center justify-center p-4"

      style="z-index: 10;">

      <span class="text-white text-2xl font-bold text-center"></span>

      <button id="scanner-feedback-close" type="button"

        class="mt-4 px-4 py-2 bg-white text-red-600 font-semibold rounded shadow-lg"

        style="display: none;">

        Fechar

      </button>

    </div>

    <div id="scanner-confirm-overlay"

      class="hidden absolute inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center p-6 space-y-4"

      style="z-index: 20;">

      <div class="text-white text-center">

        <div class="text-lg opacity-80 mb-1">Confirmar código lido?</div>

        <div id="scanner-confirm-text" class="text-2xl font-bold break-all"></div>

      </div>

      <div class="flex gap-3">

        <button id="scanner-confirm-yes" type="button"

          class="px-5 py-2 rounded-md bg-green-600 text-white font-semibold shadow hover:bg-green-700">

          Confirmar (Enter)

        </button>

        <button id="scanner-confirm-no" type="button"

          class="px-5 py-2 rounded-md bg-gray-300 text-gray-800 font-semibold shadow hover:bg-gray-400">

          Reescanear (Esc)

        </button>

      </div>

    </div>

  `;
    modal.appendChild(content);
    document.body.appendChild(modal);
    dom.scannerModal = modal;
    dom.scannerContainer = modal.querySelector("#auditoria-scanner-container");
    dom.scannerCancelBtn = modal.querySelector("#auditoria-scanner-cancel");
    dom.scannerFeedbackOverlay = modal.querySelector("#scanner-feedback-overlay");
    dom.scannerFeedbackCloseBtn = modal.querySelector("#scanner-feedback-close");
    dom.scannerConfirmOverlay = modal.querySelector("#scanner-confirm-overlay");
    dom.scannerConfirmText = modal.querySelector("#scanner-confirm-text");
    dom.scannerConfirmYesBtn = modal.querySelector("#scanner-confirm-yes");
    dom.scannerConfirmNoBtn = modal.querySelector("#scanner-confirm-no");
    dom.scannerFeedbackCloseBtn.addEventListener("click", stopGlobalScanner);
    dom.scannerCancelBtn.addEventListener("click", stopGlobalScanner);
    modal.addEventListener("keydown", (e) => {
        if (
            dom.scannerConfirmOverlay &&
            !dom.scannerConfirmOverlay.classList.contains("hidden")
        ) {
            if (e.key === "Enter") {
                e.preventDefault();
                dom.scannerConfirmYesBtn.click();
            } else if (e.key === "Escape") {
                e.preventDefault();
                dom.scannerConfirmNoBtn.click();
            }
        }
    });
}

function injectScannerButtons() {
    const cameraIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M12 9a3.75 3.75 0 100 7.5A3.75 3.75 0 0012 9z" /><path fill-rule="evenodd" d="M9.344 3.071a.75.75 0 015.312 0l1.173 1.173a.75.75 0 00.53.22h2.172a3 3 0 013 3v10.5a3 3 0 01-3 3H5.47a3 3 0 01-3-3V7.464a3 3 0 013-3h2.172a.75.75 0 00.53-.22L9.344 3.071zM12 18a6 6 0 100-12 6 6 0 000 12z" clip-rule="evenodd" /></svg>`;
    [{
        input: dom.sepScan,
        id: "sep-cam-btn"
    },
        {
            input: dom.carScan,
            id: "car-cam-btn"
        },
    ].forEach(({
                   input,
                   id
               }) => {
        if (!input) return;
        const parent = input.parentElement;
        if (!parent) return;
        parent.style.position = "relative";
        const button = document.createElement("button");
        button.id = id;
        button.type = "button";
        button.className =
            "absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 p-1";
        button.innerHTML = cameraIcon;
        parent.appendChild(button);
        if (id === "sep-cam-btn") dom.sepCamBtn = button;
        else dom.carCamBtn = button;
    });
    dom.sepCamBtn?.addEventListener("click", () =>
        startGlobalScanner("separacao"),
    );
    dom.carCamBtn?.addEventListener("click", () =>
        startGlobalScanner("carregamento"),
    );
}

function startGlobalScanner(targetModal) {
    if (state.globalScannerInstance || !dom.scannerModal) return;
    state.currentScannerTarget = targetModal;
    if (dom._currentModal) {
        dom._currentModal.classList.add("hidden");
        dom._currentModal.setAttribute("aria-hidden", "true");
    }
    dom.scannerFeedbackOverlay?.classList.add("hidden");
    dom.scannerConfirmOverlay?.classList.add("hidden");
    state.pendingDecodedText = null;
    dom.scannerModal.classList.remove("hidden");
    try {
        const scanner = new Html5Qrcode("auditoria-scanner-container");
        state.globalScannerInstance = scanner;
        Html5Qrcode.getCameras()
            .then((devices) => {
                if (devices && devices.length) {
                    let deviceId = null;
                    const backCamera = devices.find(
                        (d) => d.facingMode === "environment",
                    );
                    deviceId =
                        backCamera?.id ??
                        devices.find((d) => /back/i.test(d.label))?.id ??
                        devices[devices.length - 1].id;
                    if (!deviceId) throw new Error("Nenhuma câmera encontrada.");
                    scanner
                        .start(
                            deviceId, {
                                fps: 2,
                                qrbox: {
                                    width: 280,
                                    height: 280
                                },
                                formatsToSupport: SUPPORTED_FORMATS,
                                experimentalFeatures: {
                                    useBarCodeDetectorIfSupported: true
                                },
                            },
                            onGlobalScanSuccess,
                            onGlobalScanError,
                        )
                        .catch((err) => {
                            console.error("Erro ao INICIAR scanner:", err);
                            setSepStatus("Câmera falhou. Tente novamente.", {
                                error: true
                            });
                            setCarStatus("Câmera falhou. Tente novamente.", {
                                error: true
                            });
                            stopGlobalScanner();
                        });
                } else {
                    throw new Error("Nenhuma câmera detectada.");
                }
            })
            .catch((err) => {
                console.error("Erro ao listar câmeras:", err);
                setSepStatus("Não foi possível listar câmeras.", {
                    error: true
                });
                setCarStatus("Não foi possível listar câmeras.", {
                    error: true
                });
                stopGlobalScanner();
            });
    } catch (err) {
        console.error("Erro ao instanciar Html5Qrcode:", err);
        setSepStatus("Erro ao iniciar câmera.", {
            error: true
        });
        setCarStatus("Erro ao iniciar câmera.", {
            error: true
        });
        stopGlobalScanner();
    }
}

function stopGlobalScanner() {
    if (!state.globalScannerInstance) {
        dom.scannerModal?.classList.add("hidden");
        if (dom._currentModal) {
            dom._currentModal.classList.remove("hidden");
            dom._currentModal.setAttribute("aria-hidden", "false");
        }
        state.currentScannerTarget = null;
        return;
    }
    const scanner = state.globalScannerInstance;
    state.globalScannerInstance = null;
    scanner
        .stop()
        .catch((err) => {
            if (!/already stopped/i.test(String(err))) {
                console.error("Erro ao parar scanner:", err);
            }
        })
        .finally(() => {
            if (dom.scannerContainer) dom.scannerContainer.innerHTML = "";
            dom.scannerModal.classList.add("hidden");
            if (dom._currentModal) {
                dom._currentModal.classList.remove("hidden");
                dom._currentModal.setAttribute("aria-hidden", "false");
            }
            state.currentScannerTarget = null;
            state.pendingDecodedText = null;
        });
}

async function onGlobalScanSuccess(decodedText) {
    const target = state.currentScannerTarget;
    if (!target || !state.globalScannerInstance) {
        stopGlobalScanner();
        return;
    }
    state.globalScannerInstance.pause(true);
    const normalized = normalizeScanned(decodedText);
    const labelForConfirm =
        normalized && normalized !== decodedText ?
            `${normalized} (limpo)` :
            normalized || decodedText;
    showScannerConfirm(
        labelForConfirm,
        () => {
            if (target === "separacao") {
                handleSeparacaoFromScanner(normalized || decodedText);
            } else if (target === "carregamento") {
                handleCarregamentoFromScanner(normalized || decodedText).finally(() => {
                    state.globalScannerInstance?.resume();
                });
            }
        },
        () => {
            state.pendingDecodedText = null;
            state.globalScannerInstance?.resume();
        },
    );
}

function onGlobalScanError(_) {
}

async function processarPacote(idPacote, dataScan, usuarioEntrada) {
    const body = {
        id_pacote: idPacote,
        data_scan: dataScan,
        usuario_entrada: usuarioEntrada,
    };
    const response = await fetch(FUNC_SEPARACAO_URL, {
        method: "POST",
        headers: buildFunctionHeaders(),
        body: JSON.stringify(body),
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok && !json?.isDuplicate) {
        throw new Error(json?.error || "Erro desconhecido");
    }
    return json;
}

async function handleSeparacaoFromScanner(idPacote) {
    if (state.isSeparaçãoProcessing) return;
    const usuarioEntrada = dom.sepUser?.value?.trim();
    if (!usuarioEntrada) {
        showScannerFeedback(
            "error",
            "Colaborador não definido. Feche a câmera e digite seu nome.",
            true,
        );
        stopGlobalScanner();
        setSepStatus("Digite o nome do colaborador", {
            error: true
        });
        dom.sepUser?.focus();
        return;
    }
    state.isSeparaçãoProcessing = true;
    const dataScan = new Date().toISOString();
    try {
        const body = {
            id_pacote: idPacote,
            data_scan: dataScan,
            usuario_entrada: usuarioEntrada,
        };
        const {
            queued,
            json
        } = await tryPostOrQueue(
            "separacao",
            FUNC_SEPARACAO_URL,
            body,
        );
        if (queued) {
            showScannerFeedback(
                "error",
                "Falha na conexão com a rede… Tentando registrar",
                true,
            );
            stopGlobalScanner();
            setSepStatus(
                'Sem rede. Registro colocado na fila. Use "Forçar envio" ou aguarde a reconexão.', {
                    error: true
                },
            );
            dom.sepScan.value = idPacote;
            dom.sepScan.focus();
            return;
        }
        const {
            numeracao,
            ilha,
            insertedData,
            pacote,
            isDuplicate,
            message
        } =
            json;
        if (!numeracao)
            throw new Error(json?.error || "Resposta não contém numeração");
        const idPacoteParaQr = pacote || idPacote;
        state.lastPrintData = {
            dataForQr: idPacoteParaQr,
            ilha,
            mangaLabel: numeracao,
        };
        await generateQRCode(idPacoteParaQr, ilha, numeracao);
        if (isDuplicate) {
            const friendly = message || "PACOTE JÁ BIPADO. Reimpressão solicitada.";
            showScannerFeedback("error", friendly, true);
            stopGlobalScanner();
            await sleep(50);
            await printCurrentQr();
            setSepStatus(friendly, {
                error: true
            });
            dom.sepScan.value = idPacote;
            dom.sepScan.focus();
        } else {
            if (insertedData && insertedData[0]) {
                state.cacheData.unshift(insertedData[0]);
                const id = extractElevenDigits(insertedData[0]["ID PACOTE"]);
                if (id) state.idPacoteMap.set(id, insertedData[0]);
                renderDashboard();
            }
            showScannerFeedback(
                "success",
                `Sucesso! Manga ${numeracao} (Rota ${ilha})`,
            );
            stopGlobalScanner();
            await sleep(50);
            await printCurrentQr();
        }
    } catch (err) {
        console.error("Erro Separação (Scanner):", err);
        const friendly = `ERRO: ${err.message || err}`;
        showScannerFeedback("error", friendly, true);
        stopGlobalScanner();
        setSepStatus(friendly, {
            error: true
        });
        dom.sepScan.value = idPacote;
        dom.sepScan.focus();
    } finally {
        state.isSeparaçãoProcessing = false;
    }
}

function handleSepUserKeydown(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        dom.sepScan.focus();
    }
}

function parseBulkEntries(raw) {
    if (!raw) return [];
    return String(raw)
        .split(/[,;\s\n\r\t]+/g)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

async function processarSeparacaoEmMassa(ids, usuarioEntrada) {
    const total = ids.length;
    let ok = 0,
        fail = 0,
        dup = 0,
        queued = 0;
    state.isSeparaçãoProcessing = true;
    dom.sepScan.disabled = true;
    dom.sepUser.disabled = true;
    for (let i = 0; i < total; i++) {
        const idPacote = ids[i];
        setSepStatus(`Processando ${i + 1}/${total}: ${idPacote}...`);
        try {
            const dataScan = new Date().toISOString();
            const body = {
                id_pacote: idPacote,
                data_scan: dataScan,
                usuario_entrada: usuarioEntrada,
            };
            const {
                queued: wasQueued,
                json
            } = await tryPostOrQueue(
                "separacao",
                FUNC_SEPARACAO_URL,
                body,
            );
            if (wasQueued) {
                queued++;
                setSepStatus(`Sem rede: ${i + 1}/${total}: ${idPacote} enfileirado.`, {
                    error: true,
                });
                continue;
            }
            const {
                numeracao,
                ilha,
                insertedData,
                pacote,
                isDuplicate,
                message
            } =
            json || {};
            if (!numeracao)
                throw new Error(json?.error || "Resposta não contém numeração");
            const idPacoteParaQr = pacote || idPacote;
            state.lastPrintData = {
                dataForQr: idPacoteParaQr,
                ilha,
                mangaLabel: numeracao,
            };
            await generateQRCode(idPacoteParaQr, ilha, numeracao);
            await printCurrentQr();
            if (isDuplicate) {
                dup++;
                setSepStatus(
                    `Duplicado ${i + 1}/${total}: ${idPacote} — ${message || "Pacote já bipado"}`, {
                        error: true
                    },
                );
            } else {
                if (insertedData && insertedData[0]) {
                    state.cacheData.unshift(insertedData[0]);
                    const id = extractElevenDigits(insertedData[0]["ID PACOTE"]);
                    if (id) state.idPacoteMap.set(id, insertedData[0]);
                }
                ok++;
            }
        } catch (err) {
            console.error("Erro em massa (separação):", err);
            fail++;
            setSepStatus(
                `Falhou ${i + 1}/${total}: ${idPacote} — ${err?.message || err}`, {
                    error: true
                },
            );
        }
    }
    renderDashboard();
    const resumo = [
        `${ok} sucesso(s)`,
        dup ? `${dup} duplicado(s)` : null,
        fail ? `${fail} falha(s)` : null,
        queued ? `${queued} enfileirado(s)` : null,
    ]
        .filter(Boolean)
        .join(", ");
    setSepStatus(`Lote concluído: ${resumo}.`, {
        error: fail + queued > 0
    });
    dom.sepScan.value = "";
    dom.sepScan.focus();
    state.isSeparaçãoProcessing = false;
    dom.sepScan.disabled = false;
    dom.sepUser.disabled = false;
}

async function handleSeparaçãoSubmit(e) {
    if (e.key !== "Enter") return;
    if (state.isSeparaçãoProcessing) return;
    e.preventDefault();
    const raw = dom.sepScan?.value ?? "";
    const usuarioEntrada = dom.sepUser?.value?.trim();
    if (!usuarioEntrada) {
        setSepStatus("Digite o nome do colaborador", {
            error: true
        });
        dom.sepUser.focus();
        return;
    }
    if (!raw || !raw.trim()) {
        setSepStatus("Digite/escaneie um código válido", {
            error: true
        });
        dom.sepScan.focus();
        return;
    }
    const idsRaw = parseBulkEntries(raw);
    const ids = idsRaw.map(normalizeScanned).filter(Boolean);
    if (ids.length > 1) {
        await processarSeparacaoEmMassa(ids, usuarioEntrada);
        return;
    }
    const idPacote = ids[0];
    const dataScan = new Date().toISOString();
    state.isSeparaçãoProcessing = true;
    dom.sepScan.disabled = true;
    dom.sepUser.disabled = true;
    setSepStatus("Processando...");
    clearSepQrCanvas();
    try {
        const body = {
            id_pacote: idPacote,
            data_scan: dataScan,
            usuario_entrada: usuarioEntrada,
        };
        const {
            queued,
            json
        } = await tryPostOrQueue(
            "separacao",
            FUNC_SEPARACAO_URL,
            body,
        );
        if (queued) {
            setSepStatus(
                'Sem rede. Registro colocado na fila. Use "Forçar envio" ou aguarde a reconexão.', {
                    error: true
                },
            );
            return;
        }
        const {
            numeracao,
            ilha,
            insertedData,
            pacote,
            isDuplicate,
            message
        } =
            json;
        if (!numeracao)
            throw new Error(json?.error || "Resposta não contém numeração");
        const idPacoteParaQr = pacote || idPacote;
        state.lastPrintData = {
            dataForQr: idPacoteParaQr,
            ilha,
            mangaLabel: numeracao,
        };
        await generateQRCode(idPacoteParaQr, ilha, numeracao);
        await printCurrentQr();
        dom.sepScan.value = "";
        if (isDuplicate) {
            const friendly = message || "Pacote já bipado. Reimpressão solicitada.";
            setSepStatus(friendly, {
                error: true
            });
        } else {
            setSepStatus(`Sucesso! Manga ${numeracao} (Rota ${ilha}) registrada.`);
            if (insertedData && insertedData[0]) {
                state.cacheData.unshift(insertedData[0]);
                const id = extractElevenDigits(insertedData[0]["ID PACOTE"]);
                if (id) state.idPacoteMap.set(id, insertedData[0]);
                renderDashboard();
            }
        }
    } catch (err) {
        console.error("Erro Separação:", err);
        const friendly = `Erro: ${err.message || err}`;
        setSepStatus(friendly, {
            error: true
        });
    } finally {
        state.isSeparaçãoProcessing = false;
        dom.sepScan.disabled = false;
        dom.sepUser.disabled = false;
        if (!state.globalScannerInstance) dom.sepScan.focus();
    }
}

function setCarStatus(message, {
    error = false
} = {}) {
    if (!dom.carStatus) return;
    dom.carStatus.textContent = message;
    dom.carStatus.classList.remove(
        "text-red-600",
        "text-green-600",
        "text-gray-500",
    );
    dom.carStatus.classList.add(error ? "text-red-600" : "text-green-600");
}

function formatDockLabel(n) {
    return `DOCA ${String(n).padStart(2, "0")}`;
}

function ensureDockSelect() {
    if (dom.carDockSelect && dom.carDockSelect.parentElement) return;
    dom.carDockSelect = document.getElementById("car-dock-select");
    if (!dom.carDockSelect) {
        const userInput = dom.carUser;
        if (!userInput) return;
        const wrap = document.createElement("div");
        wrap.className = "mt-4";
        wrap.innerHTML = `

    <label for="car-dock-select" class="block text-sm font-medium text-gray-700">DOCA</label>

    <div class="mt-1">

      <select id="car-dock-select" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white"></select>

    </div>

  `;
        const sel = wrap.querySelector("#car-dock-select");
        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = "Selecione a DOCA";
        sel.appendChild(opt0);
        for (let i = 1; i <= 12; i++) {
            const opt = document.createElement("option");
            opt.value = formatDockLabel(i);
            opt.textContent = formatDockLabel(i);
            sel.appendChild(opt);
        }
        const userBlock = userInput.closest(".mt-1");
        if (userBlock && userBlock.parentElement) {
            userBlock.parentElement.insertBefore(wrap, userBlock.nextSibling);
        } else {
            const container = dom.modalCarregamento?.querySelector(".max-w-md");
            container?.appendChild(wrap);
        }
        dom.carDockSelect = sel;
    }
    if (state.selectedDock && dom.carDockSelect) {
        dom.carDockSelect.value = state.selectedDock;
    }
    dom.carDockSelect.addEventListener("change", () => {
        state.selectedDock = dom.carDockSelect.value || null;
    });
}

function ensureIlhaSelect() {
    if (dom.carIlhaSelect && dom.carIlhaSelect.parentElement) return;
    dom.carIlhaSelect = document.getElementById("car-ilha-select");
    if (!dom.carIlhaSelect) {
        const dockSelect = dom.carDockSelect;
        if (!dockSelect) return;
        const wrap = document.createElement("div");
        wrap.className = "mt-4";
        wrap.innerHTML = `

    <label for="car-ilha-select" class="block text-sm font-medium text-gray-700">ILHA (ROTA)</label>

    <div class="mt-1">

      <select id="car-ilha-select" class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white">

        <option value="">Carregando ilhas...</option>

      </select>

    </div>

  `;
        const dockBlock = dockSelect.closest(".mt-4");
        if (dockBlock && dockBlock.parentElement) {
            dockBlock.parentElement.insertBefore(wrap, dockBlock.nextSibling);
        }
        dom.carIlhaSelect = wrap.querySelector("#car-ilha-select");
    }
    dom.carIlhaSelect.addEventListener("change", () => {
        state.selectedIlha = dom.carIlhaSelect.value || null;
    });
}

function populateIlhaSelect() {
    if (!dom.carIlhaSelect) return;
    const rotas = [
        ...new Set(state.cacheData.map((item) => item.ROTA).filter(Boolean)),
    ];
    rotas.sort();
    dom.carIlhaSelect.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Selecione a ILHA";
    dom.carIlhaSelect.appendChild(opt0);
    if (rotas.length === 0) {
        opt0.textContent = "Nenhuma ilha separada no período";
    }
    for (const rota of rotas) {
        const opt = document.createElement("option");
        opt.value = rota;
        opt.textContent = `ROTA ${rota}`;
        dom.carIlhaSelect.appendChild(opt);
    }
    if (state.selectedIlha) dom.carIlhaSelect.value = state.selectedIlha;
}

async function processarValidacao(
    idPacoteScaneado,
    rotaSelecionada,
    usuarioSaida,
    doca,
) {
    const body = {
        id_pacote: idPacoteScaneado,
        rota_selecionada: rotaSelecionada,
        usuario_saida: usuarioSaida,
        doca,
    };
    const response = await fetch(FUNC_CARREGAMENTO_URL, {
        method: "POST",
        headers: buildFunctionHeaders(),
        body: JSON.stringify(body),
    });
    let json = null;
    try {
        json = await response.json();
    } catch {
    }
    if (!response.ok) {
        const msg = json?.error || `Falha (HTTP ${response.status})`;
        throw new Error(msg);
    }
    return json || {};
}

function handleCarUserKeydown(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        if (!state.selectedDock && dom.carDockSelect) {
            dom.carDockSelect.focus();
        } else if (!state.selectedIlha && dom.carIlhaSelect) {
            dom.carIlhaSelect.focus();
        } else {
            dom.carScan.focus();
        }
    }
}

async function runCarregamentoValidation(
    idPacoteScaneado,
    usuarioSaida,
    doca,
    ilha,
) {
    if (!usuarioSaida)
        return {
            success: false,
            message: "Digite o nome do colaborador"
        };
    if (!doca) return {
        success: false,
        message: "Selecione a DOCA"
    };
    if (!ilha) return {
        success: false,
        message: "Selecione a ILHA"
    };
    if (!idPacoteScaneado)
        return {
            success: false,
            message: "Bipe o QR/Barra do Pacote"
        };
    try {
        const body = {
            id_pacote: idPacoteScaneado,
            rota_selecionada: ilha,
            usuario_saida: usuarioSaida,
            doca,
        };
        const {
            queued,
            json
        } = await tryPostOrQueue(
            "carregamento",
            FUNC_CARREGAMENTO_URL,
            body,
        );
        if (queued) {
            return {
                success: false,
                message: 'Falha na conexão com a rede… Tentando registrar (item na fila). Clique em "Forçar envio" ou aguarde.',
            };
        }
        const {
            updatedData,
            idempotent,
            message
        } = json || {};
        if (!updatedData) {
            throw new Error(
                json?.error || "Backend não retornou dados da manga/pacote.",
            );
        }
        const updatedNumeracao = updatedData?.NUMERACAO;
        let successMessage = message || `OK! ${updatedNumeracao} validado.`;
        if (idempotent)
            successMessage =
                message || `Manga/Pacote ${updatedNumeracao} já estava validada.`;
        const index = state.cacheData.findIndex(
            (itemCache) => itemCache.NUMERACAO === updatedNumeracao,
        );
        if (index > -1) {
            state.cacheData[index] = {
                ...state.cacheData[index],
                ...updatedData
            };
            const id = extractElevenDigits(state.cacheData[index]["ID PACOTE"]);
            if (id) state.idPacoteMap.set(id, state.cacheData[index]);
        } else {
            state.cacheData.unshift(updatedData);
            const id = extractElevenDigits(updatedData["ID PACOTE"]);
            if (id) state.idPacoteMap.set(id, updatedData);
        }
        return {
            success: true,
            message: successMessage
        };
    } catch (err) {
        console.error("Erro Carregamento (runCarregamentoValidation):", err);
        const msg = String(err?.message || err);
        return {
            success: false,
            message: `Erro: ${msg}`
        };
    }
}

async function handleCarregamentoFromScanner(decodedText) {
    if (state.isCarregamentoProcessing) return;
    const cleaned = normalizeScanned(decodedText);
    try {
        state.isCarregamentoProcessing = true;
        const usuarioSaida = dom.carUser?.value?.trim();
        const doca = state.selectedDock || dom.carDockSelect?.value || "";
        const ilha = state.selectedIlha || dom.carIlhaSelect?.value || "";
        const validation = await runCarregamentoValidation(
            cleaned,
            usuarioSaida,
            doca,
            ilha,
        );
        if (validation.success) {
            showScannerFeedback("success", validation.message);
        } else {
            showScannerFeedback("error", validation.message, true);
            dom.carScan.value = cleaned;
            dom.carScan.select();
        }
    } catch (err) {
        showScannerFeedback("error", err.message || "Erro desconhecido", true);
        setCarStatus(err.message, {
            error: true
        });
    } finally {
        state.isCarregamentoProcessing = false;
    }
}

async function handleCarregamentoSubmit(e) {
    if (e.key !== "Enter" || state.isCarregamentoProcessing) return;
    e.preventDefault();
    state.isCarregamentoProcessing = true;
    dom.carScan.disabled = true;
    dom.carUser.disabled = true;
    dom.carDockSelect && (dom.carDockSelect.disabled = true);
    dom.carIlhaSelect && (dom.carIlhaSelect.disabled = true);
    setCarStatus("Validando...");
    const idPacoteScaneado = normalizeScanned(dom.carScan?.value?.trim());
    const usuarioSaida = dom.carUser?.value?.trim();
    const doca = state.selectedDock || dom.carDockSelect?.value || "";
    const ilha = state.selectedIlha || dom.carIlhaSelect?.value || "";
    try {
        const validation = await runCarregamentoValidation(
            idPacoteScaneado,
            usuarioSaida,
            doca,
            ilha,
        );
        if (validation.success) {
            setCarStatus(validation.message, {
                error: false
            });
            dom.carScan.value = "";
            dom.carScan.focus();
        } else {
            setCarStatus(validation.message, {
                error: true
            });
            dom.carScan.select();
        }
    } catch (err) {
        setCarStatus(err.message, {
            error: true
        });
    } finally {
        state.isCarregamentoProcessing = false;
        dom.carScan.disabled = false;
        dom.carUser.disabled = false;
        dom.carDockSelect && (dom.carDockSelect.disabled = false);
        dom.carIlhaSelect && (dom.carIlhaSelect.disabled = false);
        if (
            dom.modalCarregamento &&
            !dom.modalCarregamento.classList.contains("hidden")
        ) {
            dom.carScan.focus();
        }
    }
}

async function fetchDashboardData() {
    if (!state.period.start || !state.period.end) {
        const today = new Date();
        const endISO = getBrasiliaDate(false);
        const startObj = new Date(today.getFullYear(), today.getMonth(), 1);
        const formatter = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "America/Sao_Paulo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        const startISO = formatter.format(startObj);
        state.period.start = startISO;
        state.period.end = endISO;
        updatePeriodLabel();
    }
    const startDate = `${state.period.start}T00:00:00-03:00`;
    const endDate = `${state.period.end}T23:59:59-03:00`;
    const baseParams = new URLSearchParams();
    baseParams.append("select", "*");
    baseParams.append("DATA", `gte.${startDate}`);
    baseParams.append("DATA", `lte.${endDate}`);
    baseParams.append("order", "DATA.desc");
    const pageSize = 1000;
    let offset = 0;
    let allRows = [];
    try {
        while (true) {
            const params = new URLSearchParams(baseParams);
            params.append("limit", String(pageSize));
            params.append("offset", String(offset));
            const url = `${SUPABASE_URL}/rest/v1/Carregamento?${params.toString()}`;
            const response = await fetch(url, {
                headers: buildSelectHeaders()
            });
            if (!response.ok)
                throw new Error(`Erro ao buscar dados: ${response.statusText}`);
            const page = await response.json();
            allRows = allRows.concat(page);
            if (page.length < pageSize) break;
            offset += pageSize;
            if (offset >= 50000) break;
        }
        state.cacheData = allRows;
        state.idPacoteMap.clear();
        for (const item of allRows) {
            const id = extractElevenDigits(item["ID PACOTE"]);
            if (id) state.idPacoteMap.set(id, item);
        }
    } catch (err) {
        console.error("Falha ao carregar placar:", err);
        if (dom.summaryContainer) {
            dom.summaryContainer.innerHTML = `<p class="text-red-500 text-xs p-2">Erro ao carregar dados.</p>`;
        }
    }
}

function processDashboardData(data) {
    if (!data || data.length === 0) return [];
    const rotasMap = new Map();
    for (const item of data) {
        const rota = item.ROTA;
        if (!rota) continue;
        if (!rotasMap.has(rota)) rotasMap.set(rota, []);
        rotasMap.get(rota).push(item);
    }
    const rotasConsolidadas = [];
    for (const [rota, items] of rotasMap.entries()) {
        let verificados = 0;
        let total = 0;
        let inicio = null;
        let ultimoCarregamento = null;
        let usuario = "---";
        for (const item of items) {
            total++;
            try {
                const dataInicio = new Date(item.DATA);
                if (!inicio || dataInicio < inicio) inicio = dataInicio;
            } catch {
            }
            if (item.VALIDACAO === "BIPADO") {
                verificados++;
                if (item["DATA SAIDA"]) {
                    try {
                        const dataCarregamento = new Date(item["DATA SAIDA"]);
                        if (!ultimoCarregamento || dataCarregamento > ultimoCarregamento) {
                            ultimoCarregamento = dataCarregamento;
                            usuario = item["BIPADO SAIDA"] || "---";
                        }
                    } catch {
                    }
                }
            }
        }
        const pendentes = total - verificados;
        const percentual = total > 0 ? Math.round((verificados / total) * 100) : 0;
        const inicioFormatado = inicio ?
            formatarDataInicio(inicio.toISOString()) :
            "---";
        const ultimoCarregamentoFormatado = ultimoCarregamento ?
            formatarDataInicio(ultimoCarregamento.toISOString()) :
            "---";
        rotasConsolidadas.push({
            rota,
            inicio: inicioFormatado,
            ultimoCarregamento: ultimoCarregamentoFormatado,
            usuario,
            verificados,
            pendentes,
            total,
            percentual,
            concluida: pendentes === 0 && total > 0,
        });
    }
    rotasConsolidadas.sort((a, b) => a.percentual - b.percentual);
    return rotasConsolidadas;
}

function renderDashboard() {
    const summaryContainer = dom.summaryContainer;
    const routesContainer = dom.routesContainer;
    if (!summaryContainer || !routesContainer) return;
    const todayISO = getBrasiliaDate(false);
    const todayFormatted = todayISO.split("-").reverse().join("/");
    const operacaoData = state.cacheData.filter((item) => {
        const itemDate = getBrazilDateKey(item.DATA);
        return itemDate === todayISO;
    });
    const rotasConsolidadas = processDashboardData(operacaoData);
    const totalGeralPacotes = rotasConsolidadas.reduce(
        (acc, r) => acc + r.total,
        0,
    );
    const totalGeralVerificados = rotasConsolidadas.reduce(
        (acc, r) => acc + r.verificados,
        0,
    );
    const totalGeralPendentes = totalGeralPacotes - totalGeralVerificados;
    const percVerificados =
        totalGeralPacotes > 0 ?
            (totalGeralVerificados / totalGeralPacotes) * 100 :
            0;
    const percPendentes =
        totalGeralPacotes > 0 ? (totalGeralPendentes / totalGeralPacotes) * 100 : 0;
    let resumoHtml = `

    <div class="flex items-center justify-between mb-2">

         <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">

            Visão: ${todayFormatted}

         </span>

         <span class="text-[10px] text-gray-400">${state.cacheData.length} regs</span>

    </div>

    <div class="grid grid-cols-3 gap-3 mb-2">

        <!-- Carregamentos -->

        <div class="bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center justify-center">

            <span class="text-[10px] font-bold text-gray-400 uppercase">Carregamentos</span>

            <span class="text-xl font-bold text-auditoria-primary leading-none mt-1">

                ${totalGeralVerificados}

            </span>

            <span class="text-[10px] text-gray-400">de ${totalGeralPacotes}</span>

        </div>        <!-- Concluído -->

        <div class="bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center justify-center">

            <span class="text-[10px] font-bold text-gray-400 uppercase">Concluído</span>

            <span class="text-xl font-bold text-green-600 leading-none mt-1">

                ${percVerificados.toFixed(2)}%

            </span>

            <span class="text-[10px] text-gray-400">

                (${totalGeralVerificados} concluídos)

            </span>

        </div>        <!-- Em Andamento -->

        <div class="bg-white px-3 py-2 rounded-lg shadow-sm border border-gray-200 flex flex-col items-center justify-center">

            <span class="text-[10px] font-bold text-gray-400 uppercase">Em Andamento</span>

            <span class="text-xl font-bold text-yellow-600 leading-none mt-1">

                ${percPendentes.toFixed(2)}%

            </span>

            <span class="text-[10px] text-gray-400">

                (${totalGeralPendentes} pendentes)

            </span>

        </div>

    </div>

    `;
    summaryContainer.innerHTML = resumoHtml;
    if (rotasConsolidadas.length === 0) {
        routesContainer.innerHTML = `

            <div class="text-center py-8 bg-white rounded-lg border border-dashed border-gray-200">

                <p class="text-sm text-gray-400">Sem movimentação hoje.</p>

            </div>`;
        return;
    }
    const concluidaIcon = `<svg class="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
    const emAndamentoIcon = `<svg class="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    let rotasHtml = '<div class="space-y-2">';
    for (const rota of rotasConsolidadas) {
        const statusHtml = rota.concluida ?
            `<div class="flex items-center gap-1 bg-green-50 px-2 py-0.5 rounded text-green-700 text-[10px] font-bold border border-green-100">OK</div>` :
            `<div class="flex items-center gap-1 bg-yellow-50 px-2 py-0.5 rounded text-yellow-700 text-[10px] font-bold border border-yellow-100">${rota.pendentes} pend</div>`;
        const circleColor =
            rota.percentual === 100 ? "text-green-500" : "text-blue-500";
        rotasHtml += `

        <div class="rota-card bg-white p-3 rounded-lg shadow-sm border border-gray-200 cursor-pointer hover:border-blue-300 transition-colors" data-rota="${rota.rota}">

            <div class="flex items-center justify-between">

                <div class="flex items-center gap-3">

                    <div class="bg-gray-100 h-10 w-10 rounded-full flex items-center justify-center font-bold text-gray-600 text-sm border border-gray-200">

                        ${rota.rota}

                    </div>

                    <div>

                        <div class="flex items-center gap-2">

                            <span class="text-sm font-bold text-gray-800">Rota ${rota.rota}</span>

                            ${statusHtml}

                        </div>

                        <div class="text-[10px] text-gray-400 mt-0.5 flex gap-2">

                             <span>Início: ${rota.inicio.split(" ")[1] || "--:--"}</span>

                             <span>•</span>

                             <span>Ult: ${rota.ultimoCarregamento.split(" ")[1] || "--:--"}</span>

                        </div>

                    </div>

                </div>

                <div class="flex items-center gap-3">

                    <div class="text-right hidden sm:block">

                        <div class="text-xs font-bold text-gray-700">${rota.verificados}/${rota.total}</div>

                        <div class="text-[10px] text-gray-400">Verificados</div>

                    </div>

                    <div class="relative w-10 h-10">

                         <svg class="w-full h-full" viewBox="0 0 36 36" transform="rotate(-90)">

                            <path class="text-gray-100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke-width="4" stroke="currentColor" />

                            <path class="${circleColor}" stroke-dasharray="${rota.percentual}, 100" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke-width="4" stroke-linecap="round" stroke="currentColor" />

                        </svg>

                        <div class="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-gray-600">

                            ${rota.percentual}%

                        </div>

                    </div>

                </div>

            </div>

        </div>`;
    }
    rotasHtml += "</div>";
    routesContainer.innerHTML = rotasHtml;
    routesContainer.querySelectorAll(".rota-card").forEach((card) => {
        card.addEventListener("dblclick", () => {
            const rota = card.getAttribute("data-rota");
            openRelatorioModal(rota);
        });
    });
}

async function fetchAndRenderDashboard() {
    await fetchDashboardData();
    renderDashboard();
    if (!dom.subtabAnalise.classList.contains("hidden")) {
        renderAnalysisTab();
    }
}

function reorderControlsOverDashboard() {
    const container = document.getElementById("extra-controls-container");
    if (!container) return;
    if (!dom.btnImportarConsolidado) {
        const btn3 = document.createElement("button");
        btn3.id = "btn-importar-consolidado";
        btn3.className =
            "group relative overflow-hidden bg-white border border-purple-200 hover:border-purple-400 p-3 rounded-lg shadow-sm hover:shadow-md transition-all text-left flex items-center gap-3 h-full w-full";
        btn3.innerHTML = `

            <div class="bg-purple-50 p-2 rounded-lg group-hover:bg-purple-600 transition-colors flex-shrink-0">

                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-purple-600 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">

                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />

                </svg>

            </div>

            <div class="flex-grow">

                <span class="block text-sm font-bold text-gray-800">3. Importar</span>

                <span class="block text-[10px] text-gray-500 leading-tight">Consolidado SBA7</span>

            </div>

        `;
        dom.btnImportarConsolidado = btn3;
        container.appendChild(btn3);
        btn3.addEventListener("click", () => {
            if (dom.importStatus) dom.importStatus.textContent = "";
            if (dom.importTextarea) dom.importTextarea.value = "";
            state.isImporting = false;
            if (dom.importSubmitBtn) {
                dom.importSubmitBtn.disabled = false;
                dom.importSubmitBtn.textContent = "Importar Dados";
            }
            openModal(dom.modalImportar);
        });
    }
}

function setSepStatus(message, {
    error = false
} = {}) {
    if (!dom.sepStatus) return;
    dom.sepStatus.textContent = message;
    dom.sepStatus.classList.remove(
        "text-red-600",
        "text-green-600",
        "text-gray-500",
    );
    dom.sepStatus.classList.add(error ? "text-red-600" : "text-green-600");
}

function clearSepQrCanvas() {
    if (dom.sepQrCanvas) dom.sepQrCanvas.innerHTML = "";
    if (dom.sepQrTitle) dom.sepQrTitle.innerHTML = "";
    if (dom.sepQrArea) dom.sepQrArea.style.display = "none";
    state.lastPrintData = null;
}

function generateQRCode(dataForQr, ilha = null, mangaLabel = null) {
    return new Promise((resolve, reject) => {
        if (!dom.sepQrCanvas || !dom.sepQrTitle || !dom.sepQrArea) {
            console.warn("DOM do QR Code não encontrado, pulando geração.");
            return resolve();
        }
        clearSepQrCanvas();
        let labelPrincipalFormatada = mangaLabel || dataForQr;
        let labelRotaFormatada = ilha ? `Rota ${ilha}` : "";
        if (ilha && mangaLabel) {
            try {
                const ilhaPrefix = ilha.split("_")[0];
                const mangaParts = mangaLabel.split("_");
                const mangaSuffix = mangaParts[mangaParts.length - 1];
                labelPrincipalFormatada = `${ilhaPrefix}_${mangaSuffix}`;
                const rotaOtimizada = ilhaPrefix.charAt(0).toUpperCase();
                labelRotaFormatada = `ROTA ${rotaOtimizada}`;
            } catch (e) {
                console.error("Erro ao formatar labels do QR Code:", e);
                labelPrincipalFormatada = mangaLabel;
                labelRotaFormatada = ilha ? `Rota ${ilha}` : "";
            }
        }
        try {
            const qr = qrcode(0, "M");
            qr.addData(String(dataForQr));
            qr.make();
            const svgString = qr.createSvgTag(10, 10);
            const img = new Image();
            img.onload = () => {
                dom.sepQrCanvas.appendChild(img);
                dom.sepQrTitle.innerHTML =
                    `<div class="qr-num">${labelPrincipalFormatada}</div>` +
                    (labelRotaFormatada ?
                        `<div class="qr-rota">${labelRotaFormatada}</div>` :
                        "");
                dom.sepQrArea.style.display = "block";
                resolve();
            };
            img.onerror = (err) => {
                console.error("Falha ao carregar o QR Code SVG como imagem.", err);
                reject(new Error("Falha ao renderizar QR Code"));
            };
            img.src = "data:image/svg+xml;base64," + btoa(svgString);
            img.style.width = "100%";
            img.style.height = "auto";
        } catch (err) {
            console.error("Erro durante a geração do qrcode-generator:", err);
            reject(err);
        }
    });
}

function createRelatorioModal() {
    if (document.getElementById("modal-relatorio-rota")) return;
    const modal = document.createElement("div");
    modal.id = "modal-relatorio-rota";
    modal.className = "modal-overlay hidden";
    modal.style.zIndex = "1200";
    modal.innerHTML = `

        <div class="modal-content" style="width: 95vw; max-width: 1200px;">

            <div class="flex justify-between items-center mb-4 border-b pb-2">

                <h3 id="relatorio-rota-title" class="text-xl font-semibold">Relatório - Rota</h3>

                <button id="relatorio-rota-close" class="modal-close" type="button">&times;</button>

            </div>

            <div id="relatorio-rota-body" style="max-height: 70vh; overflow-y: auto;">

                </div>

        </div>

    `;
    document.body.appendChild(modal);
    dom.relatorioModal = modal;
    dom.relatorioTitle = modal.querySelector("#relatorio-rota-title");
    dom.relatorioBody = modal.querySelector("#relatorio-rota-body");
    dom.relatorioModalClose = modal.querySelector("#relatorio-rota-close");
    dom.relatorioModalClose?.addEventListener("click", () => {
        closeModal(dom.relatorioModal);
    });
}

function openRelatorioModal(rota) {
    if (!dom.relatorioModal || !rota) return;
    const items = state.cacheData.filter((item) => item.ROTA === rota);
    dom.relatorioTitle.textContent = `Relatório - Rota ${rota} (${items.length} pacotes)`;
    let tableHtml = `

        <table class="min-w-full divide-y divide-gray-200">

            <thead class="bg-gray-50" style="position: sticky; top: 0; z-index: 1;">

                <tr>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID Pacote</th>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Numeração</th>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Separado Por</th>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data Separação</th>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Carregado Por</th>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data Carregamento</th>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Doca</th>

                    <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>

                </tr>

            </thead>

            <tbody class="bg-white divide-y divide-gray-200">

    `;
    items.sort((a, b) => new Date(a.DATA) - new Date(b.DATA));
    for (const item of items) {
        const isBipado = item.VALIDACAO === "BIPADO";
        const statusClass = isBipado ? "text-green-600" : "text-yellow-600";
        const statusText = isBipado ? "Carregado" : "Aguardando";
        tableHtml += `

            <tr class="text-sm text-gray-700">

                <td class="px-4 py-3 whitespace-nowrap">${item["ID PACOTE"] || "---"}</td>

                <td class="px-4 py-3 whitespace-nowrap font-medium">${item.NUMERACAO || "---"}</td>

                <td class="px-4 py-3 whitespace-nowrap">${item["BIPADO ENTRADA"] || "---"}</td>

                <td class="px-4 py-3 whitespace-nowrap">${formatarDataHora(item.DATA)}</td>

                <td class="px-4 py-3 whitespace-nowrap">${item["BIPADO SAIDA"] || "---"}</td>

                <td class="px-4 py-3 whitespace-nowrap">${formatarDataHora(item["DATA SAIDA"])}</td>

                <td class="px-4 py-3 whitespace-nowrap">${item.DOCA || "---"}</td>

                <td class="px-4 py-3 whitespace-nowrap font-semibold ${statusClass}">${statusText}</td>

            </tr>

        `;
    }
    tableHtml += `</tbody></table>`;
    dom.relatorioBody.innerHTML = tableHtml;
    openModal(dom.relatorioModal);
}

function updatePeriodLabel() {
    if (!dom.periodBtn) return;
    if (!state.period.start || !state.period.end) {
        dom.periodBtn.textContent = "Selecionar Período";
        return;
    }
    const format = (iso) => {
        try {
            const [y, m, d] = iso.split("-");
            return `${d}/${m}/${y}`;
        } catch (e) {
            return iso;
        }
    };
    const start = format(state.period.start);
    const end = format(state.period.end);
    dom.periodBtn.textContent =
        start === end ? `Período: ${start}` : `Período: ${start} - ${end}`;
}

function openPeriodModal() {
    const today = getBrasiliaDate(true);
    const pad2 = (n) => String(n).padStart(2, "0");
    const toISO = (d) =>
        `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const curStart = state.period.start || toISO(getBrasiliaDate(true));
    const curEnd = state.period.end || toISO(getBrasiliaDate(true));
    const yesterday = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - 1,
    );
    const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const overlay = document.createElement("div");
    overlay.id = "cd-period-overlay";
    overlay.innerHTML = `

      <div class="cdp-card">

        <h3>Selecionar Período</h3>

        <div class="cdp-shortcuts">

          <button id="cdp-today"   class="btn-salvar">Hoje</button>

          <button id="cdp-yday"    class="btn-salvar">Ontem</button>

          <button id="cdp-curmo"   class="btn-salvar">Mês Atual</button>

          <button id="cdp-prevmo"  class="btn-salvar">Mês anterior</button>

        </div>

        <div class="dates-grid">

          <div><label>Início</label><input id="cdp-period-start" type="date" value="${curStart}"></div>

          <div><label>Fim</label><input id="cdp-period-end"      type="date" value="${curEnd}"></div>

        </div>

        <div class="form-actions">

          <button id="cdp-cancel" class="btn">Cancelar</button>

          <button id="cdp-apply"  class="btn-add">Aplicar</button>

        </div>

      </div>`;
    const cssId = "cdp-style";
    if (!document.getElementById(cssId)) {
        const st = document.createElement("style");
        st.id = cssId;
        st.textContent = `

            #cd-period-overlay, #cd-period-overlay * { box-sizing: border-box; }

            #cd-period-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 9999; }

            #cd-period-overlay .cdp-card { background: #fff; border-radius: 12px; padding: 16px; min-width: 480px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }

            #cd-period-overlay h3 { margin: 0 0 12px; text-align: center; color: #003369; }

            #cd-period-overlay .cdp-shortcuts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 12px; }

            #cd-period-overlay .dates-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }

            #cd-period-overlay .form-actions { display: flex; justify-content: flex-end; gap: 8px; }

            #cd-period-overlay .btn { padding: 8px 12px; border-radius: 6px; border: 1px solid #ccc; background: #f0f0f0; cursor: pointer; }

            #cd-period-overlay .btn-salvar, #cd-period-overlay .btn-add { padding: 8px 12px; border-radius: 6px; border: none; color: white; cursor: pointer; }

            #cd-period-overlay .btn-salvar { background-color: #0284c7; }

            #cd-period-overlay .btn-add { background-color: #16a34a; }

          `;
        document.head.appendChild(st);
    }
    document.body.appendChild(overlay);
    const elStart = overlay.querySelector("#cdp-period-start");
    const elEnd = overlay.querySelector("#cdp-period-end");
    const btnCancel = overlay.querySelector("#cdp-cancel");
    const btnApply = overlay.querySelector("#cdp-apply");
    const close = () => overlay.remove();
    overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) close();
    });
    btnCancel.onclick = close;
    overlay.querySelector("#cdp-today").onclick = () => {
        const iso = toISO(getBrasiliaDate(true));
        [state.period.start, state.period.end] = [iso, iso];
        updatePeriodLabel();
        close();
        fetchAndRenderDashboard();
    };
    overlay.querySelector("#cdp-yday").onclick = () => {
        const iso = toISO(yesterday);
        [state.period.start, state.period.end] = [iso, iso];
        updatePeriodLabel();
        close();
        fetchAndRenderDashboard();
    };
    overlay.querySelector("#cdp-curmo").onclick = () => {
        const s = toISO(currentMonthStart);
        const e = toISO(today);
        const [cs, ce] = clampEndToToday(s, e);
        state.period.start = cs;
        state.period.end = ce;
        updatePeriodLabel();
        close();
        fetchAndRenderDashboard();
    };
    overlay.querySelector("#cdp-prevmo").onclick = () => {
        const s = toISO(prevStart);
        const e = toISO(prevEnd);
        const [cs, ce] = clampEndToToday(s, e);
        state.period.start = cs;
        state.period.end = ce;
        updatePeriodLabel();
        close();
        fetchAndRenderDashboard();
    };
    btnApply.onclick = () => {
        let sVal = (elStart?.value || "").slice(0, 10);
        let eVal = (elEnd?.value || "").slice(0, 10);
        if (!sVal || !eVal) {
            toast("Selecione as duas datas.", "info");
            return;
        }
        [sVal, eVal] = clampEndToToday(sVal, eVal);
        state.period.start = sVal;
        state.period.end = eVal;
        updatePeriodLabel();
        close();
        fetchAndRenderDashboard();
    };
}

function injectAuditoriaStyles() {
    if (document.getElementById("auditoria-styles")) return;
    const style = document.createElement("style");
    style.id = "auditoria-styles";
    style.textContent = `

        :root {

            --auditoria-primary: #003369;

            --auditoria-accent: #02B1EE;

            --auditoria-border: #eceff5;

            --auditoria-shadow: 0 6px 16px rgba(0, 0, 0, .08);

            --auditoria-muted: #6b7280;

        }

        .text-auditoria-accent { color: var(--auditoria-accent) !important; }

        .text-auditoria-primary { color: var(--auditoria-primary) !important; }

        #auditoria-summary-container .bg-white,

        .rota-card { border-radius: 14px !important; border: 1px solid var(--auditoria-border) !important; box-shadow: var(--auditoria-shadow) !important; }

        #auditoria-summary-container .text-blue-600 { color: var(--auditoria-primary) !important; }

        .rota-card h5 { color: var(--auditoria-primary) !important; }

        .rota-card .text-gray-500, .rota-card .text-xs, #auditoria-summary-container .text-gray-500 { color: var(--auditoria-muted) !important; }

        #auditoria-controls-bar button {

            border-radius: 12px !important; border: 1px solid var(--auditoria-border) !important; box-shadow: var(--auditoria-shadow) !important; transition: all .2s ease;

        }

        #auditoria-controls-bar button:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(0,0,0,.12) !important; }

        #btn-iniciar-separacao { background-color: var(--auditoria-primary) !important; color: white !important; }

        #btn-iniciar-carregamento { background-color: var(--auditoria-accent) !important; color: white !important; }

        #auditoria-period-btn { background-color: #fff !important; color: var(--auditoria-primary) !important; font-weight: 600; }

        #btn-importar-consolidado:hover { background-color: #5b21b6 !important; }        .auditoria-main-container { display: flex; flex-direction: column; height: 100%; }

        #auditoria-controls-bar { flex-shrink: 0; background: #f9fafb; position: sticky; top: 0; z-index: 10; }

        #auditoria-summary-container { flex-shrink: 0; padding: 0 16px; background: #f9fafb; position: sticky; top: 110px; z-index: 9; }

        #auditoria-routes-container { flex-grow: 1; overflow-y: auto; min-height: 0; }

    `;
    document.head.appendChild(style);
}

let initOnce = false;

export function init() {
    if (initOnce) return;
    initOnce = true;
    dom.dashboard = document.getElementById("dashboard-stats");
    dom.tabBtnSeparacao = document.getElementById("tab-btn-separacao");
    dom.tabBtnAnalise = document.getElementById("tab-btn-analise");
    dom.subtabSeparacao = document.getElementById("subtab-separacao");
    dom.subtabAnalise = document.getElementById("subtab-analise");
    dom.summaryContainer = document.getElementById("auditoria-summary");
    dom.routesContainer = document.getElementById("auditoria-routes");
    if (!dom.summaryContainer)
        dom.summaryContainer = document.getElementById("dashboard-stats");
    if (!dom.routesContainer)
        dom.routesContainer = document.getElementById("dashboard-stats");
    dom.btnSeparação = document.getElementById("btn-iniciar-separacao");
    dom.btnCarregamento = document.getElementById("btn-iniciar-carregamento");
    dom.periodBtn = document.getElementById("auditoria-period-btn");
    dom.modalSeparação = document.getElementById("modal-separacao");
    dom.modalSepClose = dom.modalSeparação?.querySelector(".modal-close");
    dom.sepUser = document.getElementById("sep-user-name");
    dom.sepScan = document.getElementById("sep-scan-input");
    dom.sepStatus = document.getElementById("sep-status");
    dom.sepQrArea = document.getElementById("sep-qr-area");
    dom.sepQrTitle = document.getElementById("sep-qr-title");
    dom.sepQrCanvas = document.getElementById("sep-qr-canvas");
    dom.sepPrintBtn = document.getElementById("sep-print-btn");
    dom.modalCarregamento = document.getElementById("modal-carregamento");
    dom.modalCarClose = dom.modalCarregamento?.querySelector(".modal-close");
    dom.carUser = document.getElementById("car-user-name");
    dom.carScan = document.getElementById("car-scan-input");
    dom.carStatus = document.getElementById("car-status");
    injectAuditoriaStyles();
    const todayISO = getBrasiliaDate(false);
    state.period.start = todayISO;
    state.period.end = todayISO;
    updatePeriodLabel();
    createGlobalScannerModal();
    createRelatorioModal();
    createImportarModal();
    injectScannerButtons();
    ensureDockSelect();
    ensureIlhaSelect();
    dom.tabBtnSeparacao?.addEventListener("click", () => switchTab("separacao"));
    dom.tabBtnAnalise?.addEventListener("click", () => switchTab("analise"));
    reorderControlsOverDashboard();
    dom.periodBtn?.addEventListener("click", openPeriodModal);
    dom.btnImportarConsolidado?.addEventListener("click", () => {
        if (dom.importStatus) dom.importStatus.textContent = "";
        if (dom.importTextarea) dom.importTextarea.value = "";
        state.isImporting = false;
        if (dom.importSubmitBtn) {
            dom.importSubmitBtn.disabled = false;
            dom.importSubmitBtn.textContent = "Importar Dados";
        }
        openModal(dom.modalImportar);
    });
    dom.importCloseBtn?.addEventListener("click", () =>
        closeModal(dom.modalImportar),
    );
    dom.importSubmitBtn?.addEventListener("click", handleImportarConsolidado);
    dom.btnSeparação?.addEventListener("click", () => {
        resetSeparacaoModal();
        openModal(dom.modalSeparação);
        if (dom.sepUser && !dom.sepUser.value) dom.sepUser.focus();
        else dom.sepScan?.focus();
    });
    dom.btnCarregamento?.addEventListener("click", () => {
        resetCarregamentoModal({
            preserveUser: true,
            preserveDock: true
        });
        populateIlhaSelect();
        openModal(dom.modalCarregamento);
        if (dom.carUser && !dom.carUser.value) dom.carUser.focus();
        else if (!state.selectedDock) dom.carDockSelect?.focus();
        else if (!state.selectedIlha) dom.carIlhaSelect?.focus();
        else if (dom.carScan)
            dom.carScan.value ? dom.carScan.select() : dom.carScan.focus();
    });
    dom.modalSepClose?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeModal(dom.modalSeparação);
        resetSeparacaoModal();
    });
    dom.modalCarClose?.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeModal(dom.modalCarregamento);
        resetCarregamentoModal({
            preserveUser: true,
            preserveDock: true
        });
    });
    dom.sepUser?.addEventListener("keydown", handleSepUserKeydown);
    dom.carUser?.addEventListener("keydown", handleCarUserKeydown);
    dom.sepScan?.addEventListener("keydown", handleSeparaçãoSubmit);
    dom.carScan?.addEventListener("keydown", handleCarregamentoSubmit);
    dom.sepPrintBtn?.addEventListener("click", async () => {
        try {
            if (state.lastPrintData) {
                setSepStatus("Reimprimindo...");
                await generateQRCode(
                    state.lastPrintData.dataForQr,
                    state.lastPrintData.ilha,
                    state.lastPrintData.mangaLabel,
                );
                await printCurrentQr();
                setSepStatus("Etiqueta reimpressa.");
            } else {
                setSepStatus("Gere um QR Code primeiro para reimprimir.", {
                    error: true,
                });
            }
        } catch (e) {
            console.error("Falha ao reimprimir etiqueta:", e);
            setSepStatus(`Erro ao reimprimir: ${e.message}`, {
                error: true
            });
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "F6") {
            if (dom._currentModal === dom.modalCarregamento && dom.carScan) {
                e.preventDefault();
                dom.carScan.focus();
            } else if (dom._currentModal === dom.modalSeparação && dom.sepScan) {
                e.preventDefault();
                dom.sepScan.focus();
            }
        }
    });
    [dom.sepScan, dom.carScan].forEach((inp) => {
        if (!inp) return;
        inp.addEventListener("paste", () => {
            setTimeout(() => {
                inp.value = normalizeScanned(inp.value);
            }, 0);
        });
    });
    fetchAndRenderDashboard();
    installNetworkBanner();
    loadOutbox();
    eventHandlers.onOnline = () => processOutbox(true);
    eventHandlers.onSepSuccess = (ev) => handleOutboxSepSuccess(ev);
    eventHandlers.onCarSuccess = (ev) => handleOutboxCarSuccess(ev);
    window.addEventListener("online", eventHandlers.onOnline);
    window.addEventListener(
        "outbox:separacao:success",
        eventHandlers.onSepSuccess,
    );
    window.addEventListener(
        "outbox:carregamento:success",
        eventHandlers.onCarSuccess,
    );
    if (outbox.queue.length > 0)
        showNetBanner("Itens pendentes: tentando enviar…");
    setTimeout(() => processOutbox(), 2000);
    console.log(
        "Módulo de Auditoria (Dashboard) inicializado [V30 - DataFix + Separated Containers].",
    );
}

export function destroy() {
    console.log("Módulo de Auditoria (Dashboard) destruído.");
    if (state.globalScannerInstance) stopGlobalScanner();
    const styleTag = document.getElementById("auditoria-styles");
    if (styleTag) styleTag.parentElement.removeChild(styleTag);
    const cdpStyle = document.getElementById("cdp-style");
    if (cdpStyle) cdpStyle.parentElement.removeChild(cdpStyle);
    Object.values(state.charts).forEach((chart) => {
        if (chart && typeof chart.destroy === "function") chart.destroy();
    });
    const impModal = document.getElementById("modal-importar-consolidado");
    if (impModal) impModal.parentElement.removeChild(impModal);
    if (dom.scannerModal)
        dom.scannerModal.parentElement.removeChild(dom.scannerModal);
    if (dom.relatorioModal)
        dom.relatorioModal.parentElement.removeChild(dom.relatorioModal);
    if (dom.netBanner) dom.netBanner.parentElement.removeChild(dom.netBanner);
    if (eventHandlers.onOnline)
        window.removeEventListener("online", eventHandlers.onOnline);
    if (eventHandlers.onSepSuccess)
        window.removeEventListener(
            "outbox:separacao:success",
            eventHandlers.onSepSuccess,
        );
    if (eventHandlers.onCarSuccess)
        window.removeEventListener(
            "outbox:carregamento:success",
            eventHandlers.onCarSuccess,
        );
    eventHandlers = {
        onOnline: null,
        onSepSuccess: null,
        onCarSuccess: null
    };
    state = {
        cacheData: [],
        idPacoteMap: new Map(),
        isSeparaçãoProcessing: false,
        isCarregamentoProcessing: false,
        selectedDock: null,
        selectedIlha: null,
        globalScannerInstance: null,
        currentScannerTarget: null,
        pendingDecodedText: null,
        lastPrintData: null,
        period: {
            start: null,
            end: null
        },
        isImporting: false,
        charts: {
            topRoutes: null,
            timeline: null,
            pendingRoutes: null,
            dockIssues: null,
        },
    };
    dom = {};
    initOnce = false;
}

if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            try {
                init();
            } catch (e) {
                console.error("[auditoria] init falhou:", e);
            }
        });
    } else {
        try {
            init();
        } catch (e) {
            console.error("[auditoria] init falhou:", e);
        }
    }
}