// ========================================================================
// separacao.js — Auditoria de Mangas (Validação contínua + DOCA + Massa + Print Fix + UI reorder)
// 
// V8: Câmera Traseira Forçada (Html5Qrcode) + Impressão Rápida (manual)
// ========================================================================

// IMPORTANTE: Você precisa instalar a biblioteca 'html5-qrcode'
// Ex: npm install html5-qrcode
import {Html5Qrcode} from 'html5-qrcode'; // Mudança: de Html5QrcodeScanner para Html5Qrcode (core)
import qrcode from 'qrcode-generator';

// -------------------------------
// Configurações e Constantes
// -------------------------------

const SUPABASE_URL = 'https://tzbqdjwgbisntzljwbqp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6YnFkandnYmlzbnR6bGp3YnFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0MTQyNTUsImV4cCI6MjA3MTk5MDI1NX0.fl0GBdHF_Pc56FSCVkKmCrCQANMVGvQ8sKLDoqK7eAQ';

const FUNC_SEPARACAO_URL = `${SUPABASE_URL}/functions/v1/get-processar-manga-separacao`;
const FUNC_CARREGAMENTO_URL = `${SUPABASE_URL}/functions/v1/get-processar-carregamento-validacao`;

// -------------------------------
// Estado
// -------------------------------
let state = {
    cacheData: [],
    isSeparaçãoProcessing: false,
    isCarregamentoProcessing: false,
    selectedDock: null,
    globalScannerInstance: null, // Guarda a instância do scanner
    currentScannerTarget: null, // 'separacao' ou 'carregamento'
};

// -------------------------------
// DOM refs
// -------------------------------
let dom = {
    dashboard: null,
    btnSeparação: null,
    btnCarregamento: null,

    // Modal Separação
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

    // Modal Carregamento
    modalCarregamento: null,
    modalCarClose: null,
    carUser: null,
    carDockSelect: null,
    carScan: null,
    carStatus: null,
    carCamBtn: null,

    // Modal Scanner
    scannerModal: null,
    scannerContainer: null,
    scannerCancelBtn: null,
};

// -------------------------------
// HTTP headers
// -------------------------------
function buildFunctionHeaders() {
    return {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
}

function buildSelectHeaders() {
    return {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Range: '0-1000',
    };
}

// -------------------------------
// Helper Formatação
// -------------------------------
function formatarDataHora(isoString) {
    if (!isoString) return '---';
    try {
        const dt = new Date(isoString);
        return dt.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return isoString; // fallback
    }
}

// -------------------------------
// Print helpers
// -------------------------------
function waitForPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
}

// A função de imprimir ainda existe, mas não será chamada automaticamente
async function printEtiqueta() {
    if (dom.sepQrArea) dom.sepQrArea.style.display = 'block';
    // força reflow
    // eslint-disable-next-line no-unused-expressions
    dom.sepQrArea && dom.sepQrArea.offsetHeight;
    await waitForPaint();
    await waitForPaint();
    window.print();
}

// -------------------------------
// Modal helpers
// -------------------------------
function openModal(modal) {
    if (!modal) return;
    if (!modal.classList.contains('hidden')) return;

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    dom._currentModal = modal;

    if (!modal._bound) modal._bound = {};

    modal._bound.onKeyDown ??= (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (state.globalScannerInstance) {
                stopGlobalScanner(); // 'Esc' fecha o scanner
            } else {
                closeModal(modal); // 'Esc' fecha o modal
            }
        }
    };

    modal._bound.onOverlayClick ??= (e) => {
        const content = modal.querySelector('.modal-content');
        if (!content) return;
        if (!content.contains(e.target)) {
            e.preventDefault();
            e.stopPropagation();
            closeModal(modal);
        }
    };

    document.addEventListener('keydown', modal._bound.onKeyDown);
    modal.addEventListener('click', modal._bound.onOverlayClick, true);

    const first = modal.querySelector('input, button, [tabindex]:not([tabindex="-1"])');
    if (first) setTimeout(() => first.focus(), 50);
}

function closeModal(modal) {
    if (!modal || modal.classList.contains('hidden')) return;

    if (state.globalScannerInstance) {
        stopGlobalScanner();
    }

    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    if (modal._bound?.onKeyDown) document.removeEventListener('keydown', modal._bound.onKeyDown);
    if (modal._bound?.onOverlayClick) modal.removeEventListener('click', modal._bound.onOverlayClick, true);
    dom._currentModal = null;
}

// -------------------------------
/** Resets rápidos */
function resetSeparacaoModal() {
    if (state.globalScannerInstance) stopGlobalScanner();
    if (dom.sepUser) dom.sepUser.value = '';
    if (dom.sepScan) dom.sepScan.value = '';
    setSepStatus('');
    clearSepQrCanvas();
}

function resetCarregamentoModal({preserveUser = true, preserveDock = true} = {}) {
    if (state.globalScannerInstance) stopGlobalScanner();
    if (!preserveUser && dom.carUser) dom.carUser.value = '';
    if (!preserveDock) {
        state.selectedDock = null;
        if (dom.carDockSelect) dom.carDockSelect.value = '';
    }
    if (dom.carScan) dom.carScan.value = '';
    setCarStatus('');
}

// -------------------------------
// Scanner de Câmera (AJUSTE V8)
// -------------------------------

/** Cria o modal do scanner e o anexa ao body (só roda 1 vez) */
function createGlobalScannerModal() {
    if (document.getElementById('auditoria-scanner-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'auditoria-scanner-modal';
    modal.className = 'modal-overlay hidden';
    modal.style.zIndex = '1100';

    const content = document.createElement('div');
    content.className = 'modal-content';
    content.style.width = '90vw';
    content.style.maxWidth = '600px';

    // HTML alterado para não ter botão de "start"
    content.innerHTML = `
        <div class="flex justify-between items-center mb-4 border-b pb-2">
            <h3 class="text-xl font-semibold">Escanear QR Code</h3>
        </div>
        <div id="auditoria-scanner-container" style="width: 100%; overflow: hidden; border-radius: 8px;"></div>
        <button id="auditoria-scanner-cancel" type="button" class="w-full mt-4 px-4 py-2 bg-gray-600 text-white font-semibold rounded-md shadow hover:bg-gray-700">
            Cancelar
        </button>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    dom.scannerModal = modal;
    dom.scannerContainer = modal.querySelector('#auditoria-scanner-container');
    dom.scannerCancelBtn = modal.querySelector('#auditoria-scanner-cancel');

    dom.scannerCancelBtn.addEventListener('click', stopGlobalScanner);
}

/** Adiciona botões de câmera aos inputs de scan */
function injectScannerButtons() {
    const cameraIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5"><path d="M12 9a3.75 3.75 0 100 7.5A3.75 3.75 0 0012 9z" /><path fill-rule="evenodd" d="M9.344 3.071a.75.75 0 015.312 0l1.173 1.173a.75.75 0 00.53.22h2.172a3 3 0 013 3v10.5a3 3 0 01-3 3H5.47a3 3 0 01-3-3V7.464a3 3 0 013-3h2.172a.75.75 0 00.53-.22L9.344 3.071zM12 18a6 6 0 100-12 6 6 0 000 12z" clip-rule="evenodd" /></svg>`;

    [
        {input: dom.sepScan, id: 'sep-cam-btn'},
        {input: dom.carScan, id: 'car-cam-btn'}
    ].forEach(({input, id}) => {
        if (!input) return;
        const parent = input.parentElement;
        if (!parent) return;
        parent.style.position = 'relative';
        const button = document.createElement('button');
        button.id = id;
        button.type = 'button';
        button.className = 'absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 p-1';
        button.innerHTML = cameraIcon;
        parent.appendChild(button);
        if (id === 'sep-cam-btn') dom.sepCamBtn = button;
        else dom.carCamBtn = button;
    });

    dom.sepCamBtn?.addEventListener('click', () => startGlobalScanner('separacao'));
    dom.carCamBtn?.addEventListener('click', () => startGlobalScanner('carregamento'));
}

/** Inicia o scanner global (LÓGICA V8 - SEM SELEÇÃO) */
function startGlobalScanner(targetModal) {
    if (state.globalScannerInstance || !dom.scannerModal) return;

    state.currentScannerTarget = targetModal;

    if (dom._currentModal) {
        dom._currentModal.classList.add('hidden');
        dom._currentModal.setAttribute('aria-hidden', 'true');
    }

    dom.scannerModal.classList.remove('hidden');

    try {
        // Usa a classe 'core' Html5Qrcode
        const scanner = new Html5Qrcode('auditoria-scanner-container');
        state.globalScannerInstance = scanner; // Salva a instância

        Html5Qrcode.getCameras().then(devices => {
            if (devices && devices.length) {
                let deviceId = null;
                const backCamera = devices.find(d => d.facingMode === 'environment');
                if (backCamera) {
                    deviceId = backCamera.id;
                } else {
                    const backCameraByLabel = devices.find(d => /back/i.test(d.label));
                    if (backCameraByLabel) {
                        deviceId = backCameraByLabel.id;
                    } else {
                        deviceId = devices[devices.length - 1].id;
                    }
                }

                if (deviceId) {
                    // Inicia o scanner FORÇANDO o deviceId (sem seleção, sem "start")
                    scanner.start(
                        deviceId,
                        {fps: 10, qrbox: {width: 250, height: 250}},
                        onGlobalScanSuccess,
                        onGlobalScanError
                    ).catch(err => {
                        console.error("Erro ao INICIAR scanner:", err);
                        setSepStatus("Câmera falhou. Tente novamente.", {error: true});
                        setCarStatus("Câmera falhou. Tente novamente.", {error: true});
                        stopGlobalScanner();
                    });
                } else {
                    throw new Error("Nenhuma câmera encontrada.");
                }
            } else {
                throw new Error("Nenhuma câmera detectada.");
            }
        }).catch(err => {
            console.error("Erro ao listar câmeras:", err);
            setSepStatus("Não foi possível listar câmeras.", {error: true});
            setCarStatus("Não foi possível listar câmeras.", {error: true});
            stopGlobalScanner();
        });

    } catch (err) {
        console.error("Erro ao instanciar Html5Qrcode:", err);
        setSepStatus("Erro ao iniciar câmera.", {error: true});
        setCarStatus("Erro ao iniciar câmera.", {error: true});
        stopGlobalScanner();
    }
}

/** Para o scanner global e reexibe o modal de input (LÓGICA V8) */
function stopGlobalScanner() {
    if (!state.globalScannerInstance) return;

    const scanner = state.globalScannerInstance;
    state.globalScannerInstance = null;

    scanner.stop()
        .then(() => { /* Sucesso */
        })
        .catch(err => {
            if (!/already stopped/i.test(String(err))) {
                console.error("Erro ao parar scanner:", err);
            }
        })
        .finally(() => {
            if (dom.scannerContainer) dom.scannerContainer.innerHTML = "";
            dom.scannerModal.classList.add('hidden');
            if (dom._currentModal) {
                dom._currentModal.classList.remove('hidden');
                dom._currentModal.setAttribute('aria-hidden', 'false');
            }
            state.currentScannerTarget = null;
        });
}


/** Chamado no sucesso da leitura da câmera */
function onGlobalScanSuccess(decodedText) {
    const target = state.currentScannerTarget;
    if (!target) {
        stopGlobalScanner();
        return;
    }
    const input = (target === 'separacao') ? dom.sepScan : dom.carScan;
    if (input) {
        input.value = decodedText;
        stopGlobalScanner();
        const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true, cancelable: true
        });
        input.dispatchEvent(enterEvent);
    }
}

/** Chamado em falhas de leitura (ex: não achou QR) */
function onGlobalScanError(error) {
    // Ignora erros de "QR code não encontrado"
}

// -------------------------------
// Dashboard
// -------------------------------
async function fetchDashboardData() {
    const now = new Date();
    now.setHours(now.getHours() - 24);
    const yesterday = now.toISOString();

    const query = new URLSearchParams({
        select: '*',
        DATA: `gte.${yesterday}`,
        order: 'DATA.desc',
    });
    const url = `${SUPABASE_URL}/rest/v1/Carregamento?${query.toString()}`;

    try {
        const response = await fetch(url, {headers: buildSelectHeaders()});
        if (!response.ok) throw new Error(`Erro ao buscar dados: ${response.statusText}`);
        const data = await response.json();
        state.cacheData = data;
    } catch (err) {
        console.error('Falha ao carregar placar:', err);
        if (dom.dashboard) dom.dashboard.innerHTML = `<p class="text-red-500">Erro ao carregar dados.</p>`;
    }
}

function calculateStats(data) {
    const stats = {
        totalSeparacao: data.length,
        totalCarregamento: 0,
        docasAtivas: new Set(),
    };

    for (const item of data) {
        if (item.VALIDACAO === 'BIPADO') {
            stats.totalCarregamento += 1;
        }
        if (item.DOCA) {
            stats.docasAtivas.add(item.DOCA);
        }
    }

    return {
        totalSeparacao: stats.totalSeparacao,
        totalCarregamento: stats.totalCarregamento,
        totalDocasAtivas: stats.docasAtivas.size,
    };
}

function renderDashboard() {
    const container = dom.dashboard;
    if (!container) return;

    if (state.cacheData.length === 0) {
        container.innerHTML = '<p class="text-gray-500">Nenhuma manga registrada nas últimas 24h.</p>';
        return;
    }

    const {totalSeparacao, totalCarregamento, totalDocasAtivas} = calculateStats(state.cacheData);

    let html = '';

    html += `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-white p-3 rounded-lg shadow border border-gray-200"> <div class="text-xs font-medium text-gray-500">Separação Total (24h)</div> <div class="mt-1 text-2xl font-semibold text-gray-900">${totalSeparacao}</div> </div>
        <div class="bg-white p-3 rounded-lg shadow border border-gray-200">
            <div class="text-xs font-medium text-gray-500">Carregamento Total (24h)</div>
            <div class="mt-1 text-2xl font-semibold text-gray-900">${totalCarregamento}</div>
        </div>
        <div class="bg-white p-3 rounded-lg shadow border border-gray-200">
            <div class="text-xs font-medium text-gray-500">Docas Ativas (24h)</div>
            <div class="mt-1 text-2xl font-semibold text-gray-900">${totalDocasAtivas}</div>
        </div>
    </div>
    `;

    html += `
    <div class="overflow-x-auto bg-white rounded-lg shadow border border-gray-200" style="max-height: 60vh; overflow-y: auto;">
        <table class="min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50" style="position: sticky; top: 0; z-index: 1;">
                <tr>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rota</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Separado Por</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Separação</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Carregado Por</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Finalizado</th>
                    <th scope="col" class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
    `;

    for (const item of state.cacheData) {
        const isBipado = item.VALIDACAO === 'BIPADO';
        const statusClass = isBipado ? 'text-green-600' : 'text-yellow-600';
        const statusText = isBipado ? 'Carregado' : 'Aguardando';

        html += `
                <tr class="text-sm text-gray-700">
                    <td class="px-4 py-3 whitespace-nowrap font-medium">${item.ROTA || 'N/A'}</td>
                    <td class="px-4 py-3 whitespace-nowrap">${item.BIPADO_ENTRADA || '---'}</td>
                    <td class="px-4 py-3 whitespace-nowrap">${formatarDataHora(item.DATA)}</td>
                    <td class="px-4 py-3 whitespace-nowrap">${item.BIPADO_SAIDA || '---'}</td>
                    <td class="px-4 py-3 whitespace-nowrap">${formatarDataHora(item.DATA_SAIDA)}</td>
                    <td class="px-4 py-3 whitespace-nowrap font-semibold ${statusClass}">${statusText}</td>
                </tr>
        `;
    }

    html += `
            </tbody>
        </table>
    </div>
    `;

    container.innerHTML = html;
}


async function fetchAndRenderDashboard() {
    await fetchDashboardData();
    renderDashboard();
}

// -------------------------------
// UI reorder: botões em cima, relatório embaixo (sem mexer no HTML)
// -------------------------------
function reorderControlsOverDashboard() {
    const root = document.getElementById('tab-auditoria-mangas');
    if (!root) return;
    const btn1 = document.getElementById('btn-iniciar-separacao');
    const btn2 = document.getElementById('btn-iniciar-carregamento');
    const dashboardBlock = document.getElementById('dashboard-stats')?.closest('.p-4');
    if (!btn1 || !btn2 || !dashboardBlock) return;

    let bar = document.getElementById('auditoria-controls-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'auditoria-controls-bar';
        bar.className = 'p-4 grid grid-cols-1 md:grid-cols-2 gap-4';
        dashboardBlock.parentElement.insertBefore(bar, dashboardBlock);
    }

    if (btn1.parentElement !== bar) bar.appendChild(btn1);
    if (btn2.parentElement !== bar) bar.appendChild(btn2);
}

// -------------------------------
// Separação (Passo 1)
// -------------------------------
function setSepStatus(message, {error = false} = {}) {
    if (!dom.sepStatus) return;
    dom.sepStatus.textContent = message;
    dom.sepStatus.classList.remove('text-red-600', 'text-green-600', 'text-gray-500');
    dom.sepStatus.classList.add(error ? 'text-red-600' : 'text-green-600');
}

function clearSepQrCanvas() {
    if (dom.sepQrCanvas) dom.sepQrCanvas.innerHTML = '';
    if (dom.sepQrTitle) dom.sepQrTitle.innerHTML = '';
    if (dom.sepQrArea) dom.sepQrArea.style.display = 'none';
}

function generateQRCode(numeracao, ilha = null) {
    if (!dom.sepQrCanvas || !dom.sepQrTitle || !dom.sepQrArea) return Promise.resolve();
    clearSepQrCanvas();
    const qr = qrcode(0, 'M');
    qr.addData(String(numeracao));
    qr.make();
    dom.sepQrCanvas.innerHTML = qr.createSvgTag(10, 10);
    dom.sepQrArea.style.display = 'block';
    dom.sepQrTitle.innerHTML = `<div class="qr-num">${numeracao}</div>` + (ilha ? `<div class="qr-rota">Rota ${ilha}</div>` : '');
    return Promise.resolve();
}

async function processarPacote(idPacote, dataScan, usuarioEntrada) {
    const body = {id_pacote: idPacote, data_scan: dataScan, usuario_entrada: usuarioEntrada};
    const response = await fetch(FUNC_SEPARACAO_URL, {
        method: 'POST',
        headers: buildFunctionHeaders(),
        body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json?.error || 'Erro desconhecido');
    return json;
}

function handleSepUserKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        dom.sepScan.focus();
    }
}

function parseBulkEntries(raw) {
    if (!raw) return [];
    return String(raw)
        .split(/[,;\s\n\r\t]+/g)
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

async function processarSeparacaoEmMassa(ids, usuarioEntrada) {
    const total = ids.length;
    let ok = 0, fail = 0;

    state.isSeparaçãoProcessing = true;
    dom.sepScan.disabled = true;
    dom.sepUser.disabled = true;

    for (let i = 0; i < total; i++) {
        const idPacote = ids[i];
        setSepStatus(`Processando ${i + 1}/${total}: ${idPacote}...`);
        try {
            const dataScan = new Date().toISOString();
            const {numeracao, ilha, insertedData} = await processarPacote(idPacote, dataScan, usuarioEntrada);
            await generateQRCode(numeracao, ilha);

            // REMOVIDO: await printEtiqueta();
            // A impressão agora é manual, clicando no botão 'sepPrintBtn'

            if (insertedData && insertedData[0]) {
                state.cacheData.unshift(insertedData[0]);
            }
            ok++;
        } catch (err) {
            console.error('Erro em massa (separação):', err);
            fail++;
            setSepStatus(`Falhou ${i + 1}/${total}: ${idPacote} — ${err?.message || err}`, {error: true});
        }
    }

    renderDashboard();
    setSepStatus(`Lote concluído: ${ok} sucesso(s), ${fail} falha(s).`, {error: fail > 0});
    dom.sepScan.value = '';
    dom.sepScan.focus();

    state.isSeparaçãoProcessing = false;
    dom.sepScan.disabled = false;
    dom.sepUser.disabled = false;
}

async function handleSeparaçãoSubmit(e) {
    if (e.key !== 'Enter' || state.isSeparaçãoProcessing) return;
    e.preventDefault();

    const raw = dom.sepScan?.value ?? '';
    const usuarioEntrada = dom.sepUser?.value?.trim();

    if (!usuarioEntrada) {
        setSepStatus('Digite o nome do colaborador', {error: true});
        dom.sepUser.focus();
        return;
    }
    if (!raw || !raw.trim()) {
        setSepStatus('Digite/escaneie um código válido', {error: true});
        dom.sepScan.focus();
        return;
    }

    const ids = parseBulkEntries(raw);
    if (ids.length > 1) {
        await processarSeparacaoEmMassa(ids, usuarioEntrada);
        return;
    }

    const idPacote = ids[0];
    const dataScan = new Date().toISOString();
    state.isSeparaçãoProcessing = true;
    dom.sepScan.disabled = true;
    dom.sepUser.disabled = true;
    setSepStatus('Processando...');
    clearSepQrCanvas();

    try {
        const result = await processarPacote(idPacote, dataScan, usuarioEntrada);
        const {numeracao, ilha, insertedData} = result;
        if (!numeracao) throw new Error('Resposta não contém numeração');
        setSepStatus(`Sucesso! Manga ${numeracao} (Rota ${ilha}) registrada.`);
        await generateQRCode(numeracao, ilha); // Apenas mostra o QR na tela
        dom.sepScan.value = '';

        // REMOVIDO: await printEtiqueta();
        // A impressão não é mais automática para não travar o fluxo
        // O usuário pode clicar no botão "Imprimir" se desejar

        if (insertedData && insertedData[0]) {
            state.cacheData.unshift(insertedData[0]);
            renderDashboard();
        }
    } catch (err) {
        console.error('Erro Separação:', err);
        setSepStatus(`Erro: ${err.message}`, {error: true});
    } finally {
        state.isSeparaçãoProcessing = false;
        dom.sepScan.disabled = false;
        dom.sepUser.disabled = false;
        dom.sepScan.focus(); // Foca para a próxima bipagem IMEDIATAMENTE
    }
}

// -------------------------------
// Carregamento (Passo 2)
// -------------------------------
function setCarStatus(message, {error = false} = {}) {
    if (!dom.carStatus) return;
    dom.carStatus.textContent = message;
    dom.carStatus.classList.remove('text-red-600', 'text-green-600', 'text-gray-500');
    dom.carStatus.classList.add(error ? 'text-red-600' : 'text-green-600');
}

function formatDockLabel(n) {
    return `DOCA ${String(n).padStart(2, '0')}`;
}

function ensureDockSelect() {
    if (dom.carDockSelect && dom.carDockSelect.parentElement) return;

    dom.carDockSelect = document.getElementById('car-dock-select');
    if (!dom.carDockSelect) {
        const userInput = dom.carUser;
        if (!userInput) return;

        const wrap = document.createElement('div');
        wrap.className = 'mt-4';

        const label = document.createElement('label');
        label.setAttribute('for', 'car-dock-select');
        label.className = 'block text-sm font-medium text-gray-700';
        label.textContent = 'DOCA';

        const inner = document.createElement('div');
        inner.className = 'mt-1';

        const sel = document.createElement('select');
        sel.id = 'car-dock-select';
        sel.className = 'w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-white';

        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = 'Selecione a DOCA';
        sel.appendChild(opt0);

        for (let i = 1; i <= 12; i++) {
            const opt = document.createElement('option');
            opt.value = formatDockLabel(i);
            opt.textContent = formatDockLabel(i);
            sel.appendChild(opt);
        }

        inner.appendChild(sel);
        wrap.appendChild(label);
        wrap.appendChild(inner);

        const userBlock = userInput.closest('.mt-1');
        if (userBlock && userBlock.parentElement) {
            userBlock.parentElement.insertBefore(wrap, userBlock.nextSibling);
        } else {
            const container = dom.modalCarregamento?.querySelector('.max-w-md');
            container?.appendChild(wrap);
        }

        dom.carDockSelect = sel;
    }

    if (state.selectedDock && dom.carDockSelect) {
        dom.carDockSelect.value = state.selectedDock;
    }

    dom.carDockSelect.addEventListener('change', () => {
        state.selectedDock = dom.carDockSelect.value || null;
    });
}

async function processarValidacao(numeracao, usuarioSaida, doca) {
    const body = {numeracao, usuario_saida: usuarioSaida, doca};
    const response = await fetch(FUNC_CARREGAMENTO_URL, {
        method: 'POST',
        headers: buildFunctionHeaders(),
        body: JSON.stringify(body),
    });
    let json = null;
    try {
        json = await response.json();
    } catch (_) {
    }
    if (!response.ok) {
        const msg = json?.error || `Falha (HTTP ${response.status})`;
        throw new Error(msg);
    }
    return json || {};
}

function handleCarUserKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (!state.selectedDock && dom.carDockSelect) dom.carDockSelect.focus();
        else dom.carScan.focus();
    }
}

async function handleCarregamentoSubmit(e) {
    if (e.key !== 'Enter' || state.isCarregamentoProcessing) return;
    e.preventDefault();

    const numeracao = dom.carScan?.value?.trim();
    const usuarioSaida = dom.carUser?.value?.trim();
    const doca = state.selectedDock || dom.carDockSelect?.value || '';

    if (!usuarioSaida) {
        setCarStatus('Digite o nome do colaborador', {error: true});
        dom.carUser.focus();
        return;
    }
    if (!doca) {
        setCarStatus('Selecione a DOCA', {error: true});
        dom.carDockSelect?.focus();
        return;
    }
    if (!numeracao) {
        setCarStatus('Bipe o QR Code da Manga', {error: true});
        dom.carScan.focus();
        return;
    }

    state.isCarregamentoProcessing = true;
    dom.carScan.disabled = true;
    dom.carUser.disabled = true;
    dom.carDockSelect && (dom.carDockSelect.disabled = true);
    setCarStatus('Validando manga...');

    try {
        const result = await processarValidacao(numeracao, usuarioSaida, doca);
        const {updatedData, idempotent, message} = result || {};

        if (idempotent) {
            setCarStatus(message || `Manga ${numeracao} já estava validada.`, {error: true});
        } else {
            setCarStatus(`OK! ${numeracao} validada. Escaneie a próxima...`, {error: false});
        }

        dom.carScan.value = '';

        if (updatedData) {
            const index = state.cacheData.findIndex(item => {
                try {
                    return String(item.NUMERACAO).trim() === String(updatedData.NUMERACAO).trim();
                } catch {
                    return false;
                }
            });
            if (index > -1) {
                state.cacheData[index] = {...state.cacheData[index], ...updatedData, DOCA: doca};
            }
            renderDashboard();
        } else if (idempotent) {
            const index = state.cacheData.findIndex(item => String(item.NUMERACAO).trim() === String(numeracao).trim());
            if (index > -1 && !state.cacheData[index].DOCA) {
                state.cacheData[index].DOCA = doca;
                renderDashboard();
            }
        }


        setTimeout(() => {
            dom.carScan.focus();
            dom.carScan.select?.();
        }, 150);

    } catch (err) {
        console.error('Erro Carregamento:', err);
        const msg = String(err?.message || err);
        if (/não encontrada/i.test(msg)) setCarStatus(`Manga ${numeracao} não encontrada.`, {error: true});
        else setCarStatus(`Erro: ${msg}`, {error: true});
    } finally {
        state.isCarregamentoProcessing = false;
        dom.carScan.disabled = false;
        dom.carUser.disabled = false;
        dom.carDockSelect && (dom.carDockSelect.disabled = false);
        if (dom.modalCarregamento && !dom.modalCarregamento.classList.contains('hidden')) {
            dom.carScan.focus();
        }
    }
}

// -------------------------------
// Ciclo de Vida
// -------------------------------
let initOnce = false;

export function init() {
    if (initOnce) return;
    initOnce = true;

    // Dashboard
    dom.dashboard = document.getElementById('dashboard-stats');
    dom.btnSeparação = document.getElementById('btn-iniciar-separacao');
    dom.btnCarregamento = document.getElementById('btn-iniciar-carregamento');

    // Modal Separação
    dom.modalSeparação = document.getElementById('modal-separacao');
    dom.modalSepClose = dom.modalSeparação?.querySelector('.modal-close');
    dom.sepUser = document.getElementById('sep-user-name');
    dom.sepScan = document.getElementById('sep-scan-input');
    dom.sepStatus = document.getElementById('sep-status');
    dom.sepQrArea = document.getElementById('sep-qr-area');
    dom.sepQrTitle = document.getElementById('sep-qr-title');
    dom.sepQrCanvas = document.getElementById('sep-qr-canvas');
    dom.sepPrintBtn = document.getElementById('sep-print-btn');

    // Modal Carregamento
    dom.modalCarregamento = document.getElementById('modal-carregamento');
    dom.modalCarClose = dom.modalCarregamento?.querySelector('.modal-close');
    dom.carUser = document.getElementById('car-user-name');
    dom.carScan = document.getElementById('car-scan-input');
    dom.carStatus = document.getElementById('car-status');


    // Ajustar classes dos botões (CSS via JS)
    if (dom.btnSeparação) {
        dom.btnSeparação.classList.remove('px-6', 'py-4');
        dom.btnSeparação.classList.add('px-4', 'py-3');
        const span = dom.btnSeparação.querySelector('.text-xl');
        if (span) {
            span.classList.remove('text-xl');
            span.classList.add('text-lg');
        }
    }
    if (dom.btnCarregamento) {
        dom.btnCarregamento.classList.remove('px-6', 'py-4');
        dom.btnCarregamento.classList.add('px-4', 'py-3');
        const span = dom.btnCarregamento.querySelector('.text-xl');
        if (span) {
            span.classList.remove('text-xl');
            span.classList.add('text-lg');
        }
    }

    // Prepara o leitor de câmera (Lógica V8)
    createGlobalScannerModal();
    injectScannerButtons();

    // DOCA select
    ensureDockSelect();

    // Botões → abre/reset
    dom.btnSeparação?.addEventListener('click', () => {
        resetSeparacaoModal();
        openModal(dom.modalSeparação);
        dom.sepUser?.focus();
    });
    dom.btnCarregamento?.addEventListener('click', () => {
        resetCarregamentoModal({preserveUser: true, preserveDock: true});
        openModal(dom.modalCarregamento);
        if (dom.carScan) (dom.carScan.value ? dom.carScan.select() : dom.carScan.focus());
    });

    // Fechar modais
    dom.modalSepClose?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeModal(dom.modalSeparação);
        resetSeparacaoModal();
    });
    dom.modalCarClose?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeModal(dom.modalCarregamento);
        resetCarregamentoModal({preserveUser: true, preserveDock: true});
    });

    // Handlers de entrada
    dom.sepUser?.addEventListener('keydown', handleSepUserKeydown);
    dom.carUser?.addEventListener('keydown', handleCarUserKeydown);
    dom.sepScan?.addEventListener('keydown', handleSeparaçãoSubmit);
    dom.carScan?.addEventListener('keydown', handleCarregamentoSubmit);

    // Print manual (Agora é a única forma de imprimir)
    dom.sepPrintBtn?.addEventListener('click', async () => {
        try {
            await printEtiqueta();
        } catch (e) {
            console.error('Falha ao imprimir etiqueta:', e);
        }
    });

    // Atalho F6: foca scan do modal aberto
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F6') {
            if (dom._currentModal === dom.modalCarregamento && dom.carScan) {
                e.preventDefault();
                dom.carScan.focus();
            } else if (dom._currentModal === dom.modalSeparação && dom.sepScan) {
                e.preventDefault();
                dom.sepScan.focus();
            }
        }
    });

    // Reordenar UI: botões em cima
    reorderControlsOverDashboard();

    // Dashboard
    fetchAndRenderDashboard();

    console.log('Módulo de Auditoria (Dashboard) inicializado.');
}

export function destroy() {
    console.log('Módulo de Auditoria (Dashboard) destruído.');

    if (state.globalScannerInstance) {
        stopGlobalScanner();
    }
    if (dom.scannerModal) {
        dom.scannerModal.parentElement.removeChild(dom.scannerModal);
    }

    // Limpa o cache e DOM refs
    state.cacheData = [];
    state.globalScannerInstance = null;
    state.currentScannerTarget = null;
    dom = {};
    initOnce = false;
}

// Bootstrap
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            try {
                init();
            } catch (e) {
                console.error('[auditoria] init falhou:', e);
            }
        });
    } else {
        try {
            init();
        } catch (e) {
            console.error('[auditoria] init falhou:', e);
        }
    }
}