import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

let ui;
const state = {
    turnoAtual: 'GERAL',
    detailedResults: new Map(),
    totalGeralDetailedResults: new Map(),
    period: {start: '', end: ''},
    allMatrizes: [],
    selectedMatriz: '',
    allGerentes: [],
    selectedGerente: '',
    matrizGerenteMap: new Map(),
    _inited: false,
    _handlers: null,
    _runId: 0,
    // CACHE ROBUSTO: Guarda os dados brutos baseados na chave de data
    cache: {
        key: '',
        data: null
    }
};

const normalizeString = (str) => {
    if (!str) return '';
    return str.toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().trim();
};

function _ymdLocal(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// --- Funções Auxiliares de UI (Cópia, Exportação) ---

async function copyTableToClipboard(tableElement) {
    if (!tableElement) {
        console.warn('Função copyTableToClipboard chamada sem um elemento de tabela.');
        return;
    }
    try {
        let text = '';
        tableElement.querySelectorAll('thead tr').forEach(row => {
            const headers = [...row.querySelectorAll('th')].map(th => `"${th.textContent.trim().replace(/"/g, '""')}"`);
            text += headers.join('\t') + '\n';
        });
        tableElement.querySelectorAll('tbody tr').forEach(row => {
            const cells = [...row.querySelectorAll('td')].map(td => `"${td.textContent.trim().replace(/"/g, '""')}"`);
            text += cells.join('\t') + '\n';
        });
        if (text.trim() === '') {
            alert('A tabela parece estar vazia. Nenhum dado foi copiado.');
            return;
        }
        await navigator.clipboard.writeText(text);
        alert('Tabela (texto) copiada para a área de transferência!');
    } catch (err) {
        console.error('Falha ao copiar tabela: ', err);
        alert('FALHA AO COPIAR TEXTO:\n\nErro: ' + err.message);
    }
}

async function exportModalAsPNG(fileName) {
    const modalContent = document.getElementById('efetividade-details-modal');
    if (!modalContent) return;
    const exportButton = document.getElementById('export-png-btn');
    const scrollableContent = modalContent.querySelector('.pop-scroll');
    const originalStyles = {
        maxHeight: scrollableContent?.style.maxHeight,
        overflow: scrollableContent?.style.overflow,
        height: scrollableContent?.style.height,
        border: scrollableContent?.style.border,
    };
    if (exportButton) exportButton.textContent = 'Exportando...';
    try {
        if (scrollableContent) {
            scrollableContent.style.maxHeight = 'none';
            scrollableContent.style.overflow = 'visible';
            scrollableContent.style.height = `${scrollableContent.scrollHeight}px`;
            scrollableContent.style.border = 'none';
        }
        const canvas = await html2canvas(modalContent, {scrollY: -window.scrollY, useCORS: true});
        const link = document.createElement('a');
        link.download = `${fileName}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    } catch (error) {
        console.error('Erro ao exportar PNG:', error);
        alert('Ocorreu um erro ao tentar exportar a imagem.');
    } finally {
        if (exportButton) exportButton.textContent = 'Exportar PNG';
        if (scrollableContent) {
            scrollableContent.style.maxHeight = originalStyles.maxHeight || '';
            scrollableContent.style.overflow = originalStyles.overflow || '';
            scrollableContent.style.height = originalStyles.height || '';
            scrollableContent.style.border = originalStyles.border || '';
        }
    }
}

async function copyTableAsImage() {
    const resultContainer = document.getElementById('efet-result');
    if (!resultContainer) return;
    const tableElement = resultContainer.querySelector('.main-table');
    if (!tableElement) {
        alert('Nenhuma tabela encontrada para copiar.');
        return;
    }
    showLoading(true);
    try {
        const canvas = await html2canvas(tableElement, {
            useCORS: true,
            logging: false,
            scale: 1.5,
        });
        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/png');
        });
        await navigator.clipboard.write([
            new ClipboardItem({
                'image/png': blob
            })
        ]);
        alert('Imagem da tabela copiada!\nVocê pode colar no WhatsApp, Paint, Teams, etc.');
    } catch (err) {
        console.error('Erro ao copiar imagem da tabela:', err);
        alert('FALHA AO COPIAR IMAGEM.\n\nO seu navegador pode não suportar esta ação, ou a permissão foi negada.\n\nErro: ' + err.message);
    } finally {
        showLoading(false);
    }
}

function ensureEfetividadeModalStyles() {
    if (document.getElementById('efetividade-details-modal-style')) return;
    const css = `
 #efetividade-details-modal {
  position:fixed; z-index:2000; top:50%; left:50%; transform:translate(-50%,-50%);
  background:#fff; border:1px solid #e7ebf4; border-radius:12px; box-shadow:0 12px 28px rgba(0,0,0,.18);
  padding:16px 18px 18px; width:min(720px,96vw); max-width:96vw; animation:efetividade-popin .12s ease-out;
 }
 @keyframes efetividade-popin { from { transform:translate(-50%,-50%) scale(.98); opacity:.0 } to { transform:translate(-50%,-50%) scale(1); opacity:1 } }
 #efetividade-details-modal .pop-title { font-size:14px; font-weight:800; color:#003369; margin:0 0 10px; text-align:center; }
 #efetividade-details-modal .pop-close { position:absolute; top:8px; right:10px; border:none; background:transparent; font-size:22px; cursor:pointer; color:#56607f; line-height:1; }
 #efetividade-details-modal .pop-summary { text-align:center; font-size:13px; color:#6b7280; margin-bottom:12px; }
 #efetividade-details-modal .pop-scroll { max-height:400px; overflow:auto; border:1px solid #f1f3f8; border-radius:10px; }
 #efetividade-details-modal table { width:100%; border-collapse:collapse; }
 #efetividade-details-modal thead th { text-align:left; font-size:12px; color:#56607f; border-bottom:1px solid #e7ebf4; padding:8px 10px; font-weight:700; background:#f9fbff; }
 #efetividade-details-modal tbody td { font-size:13px; color:#242c4c; padding:8px 10px; border-bottom:1px solid #f1f3f8; vertical-align:top; text-align:left; word-break:break-word; background:#fff; }
 #efetividade-details-modal .pop-actions { margin-top:16px; display:flex; justify-content:flex-end; border-top:1px solid #f1f3f8; padding-top:12px; }
 #efetividade-details-modal .btn-export { background-color:#003369; color:#fff; padding:8px 16px; border:none; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; transition:background-color .2s; }
 #efetividade-details-modal .btn-export:hover { background-color:#002244; }
 `.trim();
    const style = document.createElement('style');
    style.id = 'efetividade-details-modal-style';
    style.textContent = css;
    document.head.appendChild(style);
}

function showDetailsModal(groupKey, date) {
    ensureEfetividadeModalStyles();
    const details = (groupKey === 'TODAS')
        ? state.totalGeralDetailedResults.get(date)
        : state.detailedResults.get(groupKey)?.get(date);
    if (!details) return;
    const oldModal = document.querySelector('.efetividade-modal-overlay');
    if (oldModal) oldModal.remove();
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[99] efetividade-modal-overlay';
    const dayOfWeek = weekdayPT(date);
    const dateFormatted = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
    let contentHtml = '';
    if (details.pendentes.length === 0) {
        contentHtml = '<p style="text-align:center; padding: 2rem 0;">Nenhum colaborador pendente encontrado.</p>';
    } else {
        contentHtml = `
      <table>
        <thead>
          <tr><th>Nome</th><th>Gestor</th><th>Turno</th><th>DSR</th></tr>
        </thead>
        <tbody>
          ${details.pendentes.map(p => `
            <tr>
              <td>${p.Nome || 'N/D'}</td>
              <td>${p.Gestor || 'N/D'}</td>
              <td>${p.Escala || 'N/D'}</td>
              <td>${p.DSR_do_dia || 'N/D'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
    }
    const titlePrefix = state.turnoAtual === 'COORDENACAO' ? 'Pendentes de' : 'Pendentes em';
    const modalTitle = `${titlePrefix} ${groupKey === 'TODAS' ? 'TODAS AS OPERAÇÕES' : groupKey} - ${dateFormatted} (${dayOfWeek})`;
    overlay.innerHTML = `
    <div id="efetividade-details-modal">
      <h3 class="pop-title">${modalTitle}</h3>
      <button class="pop-close" data-close-modal>×</button>
      <div class="pop-summary">
        Elegíveis: <strong>${details.elegiveis.length}</strong> |
        Pendentes: <strong>${details.pendentes.length}</strong>
      </div>
      <div class="pop-scroll">${contentHtml}</div>
      <div class="pop-actions"><button id="export-png-btn" class="btn-export">Exportar PNG</button></div>
    </div>`;
    document.body.appendChild(overlay);
    const closeModal = () => {
        const modalEl = overlay.querySelector('#efetividade-details-modal');
        if (modalEl) modalEl.style.animation = 'efetividade-popin .1s reverse ease-in';
        setTimeout(() => overlay.remove(), 100);
    };
    overlay.querySelector('[data-close-modal]')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
    document.getElementById('export-png-btn')?.addEventListener('click', () => {
        const fileName = `pendentes_${groupKey.replace(/\s+/g, '_')}_${date.replace(/-/g, '')}`;
        exportModalAsPNG(fileName);
    });
}

function showLoading(on = true) {
    if (ui?.loader) ui.loader.style.display = on ? 'flex' : 'none';
}

function weekdayPT(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dias = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
    return dias[d.getDay()];
}

function listDates(startISO, endISO) {
    const [y1, m1, d1] = startISO.split('-').map(Number);
    const [y2, m2, d2] = endISO.split('-').map(Number);
    let start = new Date(y1, m1 - 1, d1);
    let end = new Date(y2, m2 - 1, d2);
    if (start > end) [start, end] = [end, start];
    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) out.push(_ymdLocal(d));
    return out;
}

function updatePeriodLabel() {
    if (ui?.periodBtn) ui.periodBtn.textContent = 'Selecionar Período';
}

function openPeriodModal() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';
    overlay.innerHTML = `
    <div class="container !h-auto !w-auto max-w-md" style="background:#fff;border-radius:12px;padding:16px 18px 18px;box-shadow:0 12px 28px rgba(0,0,0,.18);">
      <h3 style="font-weight:800;color:#003369;margin:0 0 10px;">Selecionar Período</h3>
      <div style="display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
        <button type="button" data-action="ontem" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Ontem</button>
        <button type="button" data-action="mes_anterior" style="padding:6px 10px; border-radius:8px; border:1px solid #ddd; background:#f9f9f9; font-size:13px; cursor:pointer;">Mês Anterior</button>
      </div>
      <div class="grid grid-cols-2 gap-4 my-4">
        <div>
          <label for="modal-start-date" class="block mb-1 font-semibold text-sm">Início</label>
          <input type="date" id="modal-start-date" class="w-full p-2 border rounded-md" value="${state.period.start || ''}">
        </div>
        <div>
          <label for="modal-end-date" class="block mb-1 font-semibold text-sm">Fim</label>
          <input type="date" id="modal-end-date" class="w-full p-2 border rounded-md" value="${state.period.end || ''}">
        </div>
      </div>
      <div class="form-actions" style="display:flex;gap:8px;justify-content:flex-end;">
        <button type="button" class="btn-cancelar" data-action="cancel" style="padding:8px 12px;border-radius:8px;border:1px solid #e7ebf4;background:#fff;">Cancelar</button>
        <button type="button" class="btn-salvar" data-action="apply" style="padding:8px 12px;border-radius:8px;border:1px solid #003369;background:#003369;color:#fff;">Aplicar</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    const startInput = overlay.querySelector('#modal-start-date');
    const endInput = overlay.querySelector('#modal-end-date');
    overlay.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (e.target === overlay || action === 'cancel') {
            document.body.removeChild(overlay);
        } else if (action === 'apply') {
            if (!startInput.value || !endInput.value) {
                alert('Por favor, selecione as duas datas.');
                return;
            }
            state.period.start = startInput.value;
            state.period.end = endInput.value;
            updatePeriodLabel();
            document.body.removeChild(overlay);
            generateReport();
        } else if (action === 'ontem') {
            const today = new Date();
            const ontem = new Date(today);
            ontem.setDate(today.getDate() - 1);
            const ontemStr = _ymdLocal(ontem);
            startInput.value = ontemStr;
            endInput.value = ontemStr;
        } else if (action === 'mes_anterior') {
            const today = new Date();
            const primeiroDiaMesAnterior = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const ultimoDiaMesAnterior = new Date(today.getFullYear(), today.getMonth(), 0);
            startInput.value = _ymdLocal(primeiroDiaMesAnterior);
            endInput.value = _ymdLocal(ultimoDiaMesAnterior);
        }
    });
}

function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

async function fetchAllPages(query) {
    const pageSize = 1000;
    let allData = [];
    let page = 0;
    let keep = true;
    while (keep) {
        const {data, error} = await query.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            keep = false;
        }
        if (data && data.length < pageSize) keep = false;
    }
    return allData;
}

async function fetchDSRLogsByNames(names, {chunkSize = 80} = {}) {
    if (!names || names.length === 0) return [];
    const chunks = chunkArray(names, chunkSize);
    const results = await Promise.all(chunks.map(async (subset, idx) => {
        try {
            const q = supabase
                .from('LogDSR')
                .select('Name, DsrAnterior, DsrAtual, DataAlteracao')
                .in('Name', subset)
                .order('DataAlteracao', {ascending: true})
                .order('Name', {ascending: true});
            const pageData = await fetchAllPages(q);
            return pageData || [];
        } catch (err) {
            console.error(`Falha ao buscar LogDSR (lote ${idx + 1}/${chunks.length}):`, err?.message || err);
            return [];
        }
    }));
    const seen = new Set();
    const merged = [];
    for (const arr of results) {
        for (const row of arr) {
            const key = `${row.Name}|${row.DsrAnterior}|${row.DsrAtual}|${row.DataAlteracao}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(row);
            }
        }
    }
    return merged;
}

function endOfLocalDayISO(dateYMD) {
    return new Date(`${dateYMD}T23:59:59-03:00`);
}

// -----------------------------------------------------------
// FETCH DATA OTIMIZADO - Busca apenas se datas mudarem
// -----------------------------------------------------------
async function fetchData(startDate, endDate) {
    const matrizesPermitidas = getMatrizesPermitidas();
    const [y, m, d] = endDate.split('-').map(Number);
    const endDateObj = new Date(y, m - 1, d);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endISONextDay = _ymdLocal(endDateObj);

    let colabQuery = supabase
        .from('Colaboradores')
        .select('Nome, SVC, DSR, MATRIZ, Escala, "Data de admissão", Gestor, Ativo')
        .eq('Ativo', 'SIM')
        .in('Escala', ['T1', 'T2', 'T3'])
        .order('Nome', {ascending: true});

    if (matrizesPermitidas && matrizesPermitidas.length) {
        colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
    }

    const colaboradores = await fetchAllPages(colabQuery);
    const colaboradoresFiltrados = colaboradores.filter(c => c.Ativo === 'SIM');
    const nomesColabs = [...new Set(colaboradoresFiltrados.map(c => c.Nome).filter(Boolean))];

    const preenchimentosQuery = supabase
        .from('ControleDiario')
        .select('Nome, Data, Falta, Atestado, Entrevista') // Inclui dados para gráfico entrevista
        .gte('Data', startDate)
        .lt('Data', endISONextDay)
        .order('Data', {ascending: true})
        .order('Nome', {ascending: true});

    const feriasQuery = supabase
        .from('Ferias')
        .select('Nome, "Data Inicio", "Data Final"')
        .lte('"Data Inicio"', endDate)
        .gte('"Data Final"', startDate)
        .order('"Data Inicio"', {ascending: true})
        .order('Nome', {ascending: true});

    const afastamentosQuery = supabase
        .from('Afastamentos')
        .select('NOME, "DATA INICIO", "DATA RETORNO"')
        .lte('"DATA INICIO"', endDate)
        .gt('"DATA RETORNO"', startDate)
        .order('"DATA INICIO"', {ascending: true})
        .order('NOME', {ascending: true});

    const [preenchimentos, ferias, afastamentos, dsrLogs] = await Promise.all([
        fetchAllPages(preenchimentosQuery),
        fetchAllPages(feriasQuery),
        fetchAllPages(afastamentosQuery),
        fetchDSRLogsByNames(nomesColabs, {chunkSize: 80}),
    ]);

    return {colaboradores: colaboradoresFiltrados, preenchimentos, ferias, dsrLogs, afastamentos};
}

function processEfetividade(
    colaboradores,
    preenchimentos,
    dates,
    ferias,
    dsrLogs,
    afastamentos,
    groupBy
) {
    const detailedResults = new Map();
    const totalGeralDetailedResults = new Map();
    const totalGeralResults = {};
    const results = {}; // Declaração movida para o topo para evitar ReferenceError

    const dsrHistoryMap = new Map();
    for (const log of dsrLogs) {
        const name = normalizeString(log.Name);
        if (!dsrHistoryMap.has(name)) dsrHistoryMap.set(name, []);
        dsrHistoryMap.get(name).push(log);
    }
    for (const history of dsrHistoryMap.values()) {
        history.sort((a, b) => new Date(a.DataAlteracao) - new Date(b.DataAlteracao));
    }

    function getDSRForDate(colaborador, dateYMD, historyMap) {
        const name = normalizeString(colaborador.Nome);
        const history = historyMap.get(name);
        const fallbackCadastro = (colaborador.DSR && String(colaborador.DSR).trim()) || null;
        if (!history || history.length === 0) return fallbackCadastro;
        const cutoff = endOfLocalDayISO(dateYMD);
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const when = new Date(h.DataAlteracao);
            if (when <= cutoff) {
                if (h.DsrAtual && String(h.DsrAtual).trim()) return h.DsrAtual;
                for (let j = i - 1; j >= 0; j--) {
                    const prev = history[j];
                    if (prev.DsrAtual && String(prev.DsrAtual).trim()) return prev.DsrAtual;
                }
                if (h.DsrAnterior && String(h.DsrAnterior).trim()) return h.DsrAnterior;
                return fallbackCadastro;
            }
        }
        const first = history[0];
        if (first?.DsrAnterior && String(first.DsrAnterior).trim()) return first.DsrAnterior;
        return fallbackCadastro;
    }

    const feriasPorDia = new Map();
    for (const r of ferias) {
        if (r.Nome && r['Data Inicio'] && r['Data Final']) {
            for (const dia of listDates(r['Data Inicio'], r['Data Final'])) {
                if (!feriasPorDia.has(dia)) feriasPorDia.set(dia, new Set());
                feriasPorDia.get(dia).add(normalizeString(r.Nome));
            }
        }
    }

    const afastadosPorDia = new Map();
    for (const r of afastamentos) {
        if (r.NOME && r['DATA INICIO'] && r['DATA RETORNO']) {
            const dataInicio = r['DATA INICIO'];
            const dataRetornoObj = new Date(r['DATA RETORNO'] + 'T00:00:00');
            dataRetornoObj.setDate(dataRetornoObj.getDate() - 1);
            const dataFim = _ymdLocal(dataRetornoObj);
            if (dataFim >= dataInicio) {
                for (const dia of listDates(dataInicio, dataFim)) {
                    if (!afastadosPorDia.has(dia)) afastadosPorDia.set(dia, new Set());
                    afastadosPorDia.get(dia).add(normalizeString(r.NOME));
                }
            }
        }
    }

    const preenchidosPorData = new Map();
    for (const p of preenchimentos) {
        if (!preenchidosPorData.has(p.Data)) preenchidosPorData.set(p.Data, new Set());
        preenchidosPorData.get(p.Data).add(normalizeString(p.Nome));
    }

    const groupKeys = [...new Set(colaboradores.map((c) => c[groupBy]).filter(Boolean))].sort();
    const todayISO = _ymdLocal(new Date());

    // Loop para o Total Geral (Linha do topo)
    for (const date of dates) {
        const nomesEmFerias = feriasPorDia.get(date) || new Set();
        const nomesAfastados = afastadosPorDia.get(date) || new Set();

        const totalElegiveis = colaboradores.reduce((acc, c) => {
            const nomeN = normalizeString(c.Nome);
            const adm = c['Data de admissão'];
            if (!adm || adm > date) return acc;
            if (nomesEmFerias.has(nomeN)) return acc;
            if (nomesAfastados.has(nomeN)) return acc;

            const historicalDSR = getDSRForDate(c, date, dsrHistoryMap);
            const effectiveDSR = historicalDSR && String(historicalDSR).trim() ? historicalDSR : 'N/D';
            const isDSR = normalizeString(effectiveDSR).includes(normalizeString(weekdayPT(date)));

            if (!isDSR) acc.push({...c, DSR_do_dia: effectiveDSR});
            return acc;
        }, []);

        const nomesPreenchidos = preenchidosPorData.get(date) || new Set();
        const totalPendentes = totalElegiveis.filter((c) => !nomesPreenchidos.has(normalizeString(c.Nome)));

        totalGeralDetailedResults.set(date, {elegiveis: totalElegiveis, pendentes: totalPendentes});

        let displayValue = null;
        let statusClassKey = 'EMPTY';

        if (date <= todayISO) {
            if (totalElegiveis.length === 0) {
                statusClassKey = 'N/A';
            } else {
                const preenchidos = totalElegiveis.length - totalPendentes.length;
                displayValue = (preenchidos / totalElegiveis.length) * 100;
                if (displayValue === 100) statusClassKey = 'OK';
                else if (displayValue > 0) statusClassKey = 'PEN';
                else statusClassKey = 'NOK';
            }
        }
        totalGeralResults[date] = {value: displayValue, status: statusClassKey};
    }

    // Loop por Grupo (Matriz/Gerente/SVC)
    for (const key of groupKeys) {
        results[key] = {}; // Inicializa o objeto para a chave atual
        detailedResults.set(key, new Map());

        const colaboradoresDoGrupo = colaboradores.filter((c) => c[groupBy] === key);

        for (const date of dates) {
            const nomesEmFerias = feriasPorDia.get(date) || new Set();
            const nomesAfastados = afastadosPorDia.get(date) || new Set();

            const elegiveis = colaboradoresDoGrupo.reduce((acc, c) => {
                const nomeN = normalizeString(c.Nome);
                const adm = c['Data de admissão'];
                if (!adm || adm > date) return acc;
                if (nomesEmFerias.has(nomeN)) return acc;
                if (nomesAfastados.has(nomeN)) return acc;

                const historicalDSR = getDSRForDate(c, date, dsrHistoryMap);
                const effectiveDSR = historicalDSR && String(historicalDSR).trim() ? historicalDSR : 'N/D';
                const isDSR = normalizeString(effectiveDSR).includes(normalizeString(weekdayPT(date)));

                if (!isDSR) acc.push({...c, DSR_do_dia: effectiveDSR});
                return acc;
            }, []);

            const nomesPreenchidos = preenchidosPorData.get(date) || new Set();
            const pendentes = elegiveis.filter((c) => !nomesPreenchidos.has(normalizeString(c.Nome)));

            detailedResults.get(key).set(date, {elegiveis, pendentes});

            const totalElegiveis = elegiveis.length;
            const totalPendentes = pendentes.length;

            let displayValue = null;
            let statusClassKey = 'EMPTY';

            if (date <= todayISO) {
                if (totalElegiveis === 0) {
                    statusClassKey = 'N/A';
                } else {
                    const preenchidos = totalElegiveis - totalPendentes;
                    displayValue = (preenchidos / totalElegiveis) * 100;
                    if (displayValue === 100) statusClassKey = 'OK';
                    else if (displayValue > 0) statusClassKey = 'PEN';
                    else statusClassKey = 'NOK';
                }
            }
            results[key][date] = {value: displayValue, status: statusClassKey};
        }
    }

    return {groupKeys, results, detailedResults, totalGeralResults, totalGeralDetailedResults};
}

function getStatusClass(status) {
    switch (status) {
        case 'OK':
            return 'status-ok';
        case 'PEN':
            return 'status-pendente';
        case 'NOK':
            return 'status-nok';
        case 'N/A':
            return 'status-na';
        case 'EMPTY':
            return 'status-empty';
        default:
            return '';
    }
}

function renderTable(groupKeys, dates, results, groupHeader, totalGeralResults) {
    if (!ui?.resultContainer) return;
    const formattedDates = dates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
    const headerHtml = `<tr><th>${groupHeader}</th>${formattedDates.map((d) => `<th>${d}</th>`).join('')}</tr>`;
    let totalRowHtml = '';
    if (totalGeralResults) {
        totalRowHtml = `
            <tr class="total-geral-row" style="background-color: #f0f3f5; font-weight: bold; border-bottom: 2px solid #ccc;">
            <td>TODAS AS OPERAÇÕES</td>
            ${dates.map((date) => {
            const data = totalGeralResults[date];
            const status = data?.status || 'EMPTY';
            const percentual = data?.value;
            const statusClass = getStatusClass(status);
            let statusText = '';
            if (status === 'EMPTY') statusText = '';
            else if (status === 'N/A') statusText = 'N/A';
            else if (percentual !== null && percentual !== undefined) {
                statusText = `${percentual.toFixed(0)}%`;
            }
            const title = (status === 'PEN' || status === 'NOK') ? 'Duplo clique para ver detalhes' : (status === 'OK' ? '100%' : status);
            return `<td data-group-key="TODAS" data-date="${date}" class="${statusClass}" title="${title}">${statusText}</td>`;
        }).join('')}
            </tr>
        `;
    }
    const bodyHtml = groupKeys.map((key) => `
    <tr>
      <td>${key}</td>
      ${dates.map((date) => {
        const data = results[key]?.[date];
        const status = data?.status || 'EMPTY';
        const percentual = data?.value;
        const statusClass = getStatusClass(status);
        let statusText = '';
        if (status === 'EMPTY') statusText = '';
        else if (status === 'N/A') statusText = 'N/A';
        else if (percentual !== null && percentual !== undefined) {
            statusText = `${percentual.toFixed(0)}%`;
        }
        const title = (status === 'PEN' || status === 'NOK') ? 'Duplo clique para ver detalhes' : (status === 'OK' ? '100%' : status);
        return `<td data-group-key="${key}" data-date="${date}" class="${statusClass}" title="${title}">${statusText}</td>`;
    }).join('')}
    </tr>`).join('');
    ui.resultContainer.innerHTML = `<div class="table-container"><table class="main-table"><thead>${headerHtml}</thead><tbody>${totalRowHtml}${bodyHtml}</tbody></table></div>`;
    const table = ui.resultContainer.querySelector('.main-table');
    if (table) {
        table.addEventListener('dblclick', (event) => {
            const cell = event.target.closest('td[data-group-key]');
            if (!cell) return;
            showDetailsModal(cell.dataset.groupKey, cell.dataset.date);
        });
    }
}

async function generateReport() {
    const myRun = (state._runId = (state._runId || 0) + 1);
    const startDate = state.period.start;
    const endDate = state.period.end;
    if (!startDate || !endDate) {
        if (ui?.resultContainer) {
            ui.resultContainer.innerHTML = '<p class="p-4 text-center">Por favor, selecione o período desejado.</p>';
        }
        return;
    }
    const coordBtn = document.getElementById('efet-view-coordenacao');
    const isCoordView =
        !!coordBtn &&
        (
            coordBtn.getAttribute('aria-pressed') === 'true' ||
            coordBtn.classList.contains('active') ||
            coordBtn.dataset.on === '1'
        );
    state._isCoordView = isCoordView;
    showLoading(true);
    if (ui?.resultContainer) {
        ui.resultContainer.innerHTML = `<p class="p-4 text-center">Gerando relatório...</p>`;
    }
    try {
        const dates = listDates(startDate, endDate);
        if (dates.length > 31) throw new Error('O período selecionado não pode exceder 31 dias.');

        // --- LÓGICA DE CACHE ---
        const periodKey = `${startDate}|${endDate}`;
        let rawData;
        if (state.cache && state.cache.key === periodKey && state.cache.data) {
            // Usa o cache se as datas forem as mesmas
            rawData = state.cache.data;
            console.log("⚡ Usando dados em cache (Efetividade)");
        } else {
            // Busca nova se mudar a data
            rawData = await fetchData(startDate, endDate);
            state.cache = {
                key: periodKey,
                data: rawData
            };
            console.log("🌐 Buscando dados do Supabase (Efetividade)");
        }

        if (myRun !== state._runId) return;

        // FILTRAGEM LOCAL (Rápida, sem bater no banco)
        let filteredColaboradores = rawData.colaboradores;
        const turno = state.turnoAtual || 'GERAL';
        if (turno !== 'GERAL' && turno !== 'COORDENACAO') {
            filteredColaboradores = filteredColaboradores.filter(c => c.Escala === turno);
        }
        if (state.selectedMatriz) {
            filteredColaboradores = filteredColaboradores.filter(c => c.MATRIZ === state.selectedMatriz);
        }
        if (state.selectedGerente && state.matrizGerenteMap.size > 0) {
            const normGerente = normalizeString(state.selectedGerente);
            filteredColaboradores = filteredColaboradores.filter(c => {
                if (!c.MATRIZ) return false;
                const cMatriz = normalizeString(c.MATRIZ);
                const cGerente = state.matrizGerenteMap.get(cMatriz);
                return cGerente === normGerente;
            });
        }

        const groupBy = isCoordView ? 'Gestor' : 'SVC';
        const groupHeader = isCoordView ? 'Coordenador' : 'SVC';

        // Processamento (Cálculo da tabela)
        const {groupKeys, results, detailedResults, totalGeralResults, totalGeralDetailedResults} = processEfetividade(
            filteredColaboradores,
            rawData.preenchimentos,
            dates,
            rawData.ferias,
            rawData.dsrLogs,
            rawData.afastamentos,
            groupBy
        );

        if (myRun !== state._runId) return;
        state.detailedResults = detailedResults;
        state.totalGeralDetailedResults = totalGeralDetailedResults;

        if (groupKeys.length > 0) {
            groupKeys.sort((keyA, keyB) => {
                const statusesA = Object.values(results[keyA] || {});
                const statusesB = Object.values(results[keyB] || {});
                const okA = statusesA.filter(s => s.status === 'OK').length;
                const okB = statusesB.filter(s => s.status === 'OK').length;
                if (okA !== okB) return okB - okA;
                const nokA = statusesA.filter(s => s.status === 'NOK').length;
                const nokB = statusesB.filter(s => s.status === 'NOK').length;
                if (nokA !== nokB) return nokA - nokB;
                const penA = statusesA.filter(s => s.status === 'PEN').length;
                const penB = statusesB.filter(s => s.status === 'PEN').length;
                if (penA !== penB) return penA - penB;
                return String(keyA || '').localeCompare(String(keyB || ''));
            });
        }
        if (!groupKeys.length) {
            ui.resultContainer.innerHTML = '<p class="p-4 text-center">Nenhum dado encontrado para a seleção atual.</p>';
        } else {
            renderTable(groupKeys, dates, results, groupHeader, totalGeralResults);
        }
    } catch (error) {
        if (myRun !== state._runId) return;
        console.error('Erro ao gerar relatório de efetividade:', error);
        ui.resultContainer.innerHTML = `<p class="p-4 text-center text-red-500">Falha: ${error.message}</p>`;
    } finally {
        if (myRun !== state._runId) return;
        showLoading(false);
    }
}

async function fetchFilterData() {
    // Cache de filtros: só busca se as listas estiverem vazias
    if (state.allMatrizes.length > 0 && state.allGerentes.length > 0) return;

    try {
        const {data: colabMatrizes, error: colabError} = await supabase
            .from('Colaboradores')
            .select('MATRIZ')
            .order('MATRIZ', {ascending: true});
        if (colabError) throw colabError;
        state.allMatrizes = [...new Set(colabMatrizes.map((i) => i.MATRIZ).filter(Boolean))].sort();
        const {data: gerenteData, error: gerenteError} = await supabase
            .from('Matrizes')
            .select('MATRIZ, GERENCIA');
        if (gerenteError) throw gerenteError;
        const gerentes = new Set();
        state.matrizGerenteMap.clear();
        gerenteData.forEach(item => {
            if (item.MATRIZ && item.GERENCIA) {
                state.matrizGerenteMap.set(normalizeString(item.MATRIZ), normalizeString(item.GERENCIA));
                gerentes.add(item.GERENCIA);
            }
        });
        state.allGerentes = [...gerentes].sort();
    } catch (error) {
        console.error('Erro ao buscar dados de filtro (matrizes/gerentes):', error);
        state.allMatrizes = [];
        state.allGerentes = [];
    }
}

function populateMatrizFilter() {
    if (!ui?.matrizFilterSelect) return;
    while (ui.matrizFilterSelect.options.length > 1) ui.matrizFilterSelect.remove(1);
    state.allMatrizes.forEach((matriz) => {
        const option = document.createElement('option');
        option.value = matriz;
        option.textContent = matriz;
        ui.matrizFilterSelect.appendChild(option);
    });
}

function populateGerenteFilter() {
    if (!ui?.gerenteFilterSelect) {
        // console.warn('Elemento #efet-gerente-filter não encontrado.');
        return;
    }
    while (ui.gerenteFilterSelect.options.length > 1) ui.gerenteFilterSelect.remove(1);
    state.allGerentes.forEach((gerente) => {
        const option = document.createElement('option');
        option.value = gerente;
        option.textContent = gerente;
        ui.gerenteFilterSelect.appendChild(option);
    });
}

export async function getRankingData(filters = {}) {
    let start, end;
    if (filters.start && filters.end) {
        start = filters.start;
        end = filters.end;
    } else {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        if (yesterday < firstDay) {
            return {labels: [], values: []};
        }
        start = _ymdLocal(firstDay);
        end = _ymdLocal(yesterday);
    }
    if (state.matrizGerenteMap.size === 0) {
        await fetchFilterData();
    }
    const periodKey = `${start}|${end}`;
    let rawData;
    if (state.cache && state.cache.key === periodKey && state.cache.data) {
        rawData = state.cache.data;
    } else {
        rawData = await fetchData(start, end);
        state.cache = {
            key: periodKey,
            data: rawData
        };
    }
    const dates = listDates(start, end);
    let filteredColaboradores = rawData.colaboradores;
    if (filters.matriz) {
        filteredColaboradores = filteredColaboradores.filter(c => c.MATRIZ === filters.matriz);
    }
    if (filters.gerencia) {
        const targetGerencia = normalizeString(filters.gerencia);
        filteredColaboradores = filteredColaboradores.filter(c => {
            if (!c.MATRIZ) return false;
            const matrizNorm = normalizeString(c.MATRIZ);
            const gerenteDaMatriz = state.matrizGerenteMap.get(matrizNorm);
            return gerenteDaMatriz === targetGerencia;
        });
    }
    const {groupKeys, detailedResults} = processEfetividade(
        filteredColaboradores,
        rawData.preenchimentos,
        dates,
        rawData.ferias,
        rawData.dsrLogs,
        rawData.afastamentos,
        'SVC'
    );
    const todayISO = _ymdLocal(new Date());
    const ranking = groupKeys.map(svc => {
        const dataMap = detailedResults.get(svc);
        let totalElegiveis = 0;
        let totalPendentes = 0;
        dates.forEach(date => {
            if (date > todayISO) return;
            const dayData = dataMap.get(date);
            if (dayData) {
                totalElegiveis += dayData.elegiveis.length;
                totalPendentes += dayData.pendentes.length;
            }
        });
        let percent = 0;
        if (totalElegiveis > 0) {
            percent = ((totalElegiveis - totalPendentes) / totalElegiveis) * 100;
        }
        return {
            label: svc,
            value: Number(percent.toFixed(2))
        };
    });
    ranking.sort((a, b) => b.value - a.value);
    return {
        labels: ranking.map(r => r.label),
        values: ranking.map(r => r.value)
    };
}

// ----------------------------------------------------------------------
// NOVA FUNÇÃO EXPORTADA PARA O GRÁFICO DE ENTREVISTA (SÓ PENDENTES, AGRUPADO, SEM N/D)
// ----------------------------------------------------------------------
export async function getInterviewData(filters = {}) {
    let start, end;
    if (filters.start && filters.end) {
        start = filters.start;
        end = filters.end;
    } else {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        start = _ymdLocal(firstDay);
        end = _ymdLocal(today);
    }

    // Garante que o mapa de gerentes/matrizes esteja carregado
    if (state.matrizGerenteMap.size === 0) {
        await fetchFilterData();
    }

    // --- USO DO CACHE ---
    const periodKey = `${start}|${end}`;
    let rawData;
    if (state.cache && state.cache.key === periodKey && state.cache.data) {
        rawData = state.cache.data;
    } else {
        rawData = await fetchData(start, end);
        state.cache = {key: periodKey, data: rawData};
    }

    // Mapa auxiliar para busca rápida de info do colaborador
    const colabMap = new Map();
    rawData.colaboradores.forEach(c => {
        colabMap.set(normalizeString(c.Nome), {
            matriz: c.MATRIZ,
            gerente: state.matrizGerenteMap.get(normalizeString(c.MATRIZ))
        });
    });

    // Filtra preenchimentos que são ABS (Falta ou Atestado)
    // Isso é rápido (in-memory)
    let absRecords = rawData.preenchimentos.filter(p => p.Falta > 0 || p.Atestado > 0);

    // Aplica Filtros de UI
    if (filters.matriz) {
        absRecords = absRecords.filter(p => {
            const info = colabMap.get(normalizeString(p.Nome));
            return info && info.matriz === filters.matriz;
        });
    }

    if (filters.gerencia) {
        const targetGerente = normalizeString(filters.gerencia);
        absRecords = absRecords.filter(p => {
            const info = colabMap.get(normalizeString(p.Nome));
            return info && info.gerente === targetGerente;
        });
    }

    const matrixStats = new Map();

    absRecords.forEach(rec => {
        const info = colabMap.get(normalizeString(rec.Nome));

        // Se não encontrar o colaborador (info for undefined/null) ou não tiver matriz, ignora (remove N/D)
        if (!info || !info.matriz) return;

        let matrizName = info.matriz;

        // AGRUPAMENTO MANUAL: SLZ AIR -> SAO LUIS
        if (matrizName === 'SLZ AIR') {
            matrizName = 'SAO LUIS';
        }

        if (!matrixStats.has(matrizName)) {
            matrixStats.set(matrizName, {pending: 0});
        }

        const stat = matrixStats.get(matrizName);

        const interviewStatus = String(rec.Entrevista || '').toUpperCase();
        if (interviewStatus !== 'SIM') {
            stat.pending++;
        }
    });

    // Ordenar DECRESCENTE por quantidade de pendentes
    // Filtra apenas quem tem pendências > 0 para limpar o gráfico
    const sortedStats = [...matrixStats.entries()]
        .filter(entry => entry[1].pending > 0)
        .sort((a, b) => b[1].pending - a[1].pending);

    return {
        labels: sortedStats.map(s => s[0]),
        pendentes: sortedStats.map(s => s[1].pending)
    };
}

export async function init() {
    if (state._inited) return;
    state._inited = true;
    ui = {
        periodBtn: document.getElementById('efet-period-btn'),
        matrizFilterSelect: document.getElementById('efet-matriz-filter'),
        gerenteFilterSelect: document.getElementById('efet-gerente-filter'),
        resultContainer: document.getElementById('efet-result'),
        loader: document.getElementById('efet-loader'),
        subtabButtons: document.querySelectorAll('#efetividade-page .subtab-btn'),
        coordBtn: document.getElementById('efet-view-coordenacao'),
        clearBtn: null,
    };
    const actions = document.querySelector('#efetividade-page .hc-actions');
    if (actions && !document.getElementById('efet-clear-filters')) {
        const clear = document.createElement('button');
        clear.id = 'efet-clear-filters';
        clear.textContent = 'Limpar';
        clear.className = 'btn-action-main';
        clear.style.backgroundColor = '#6c757d';
        clear.addEventListener('mouseenter', () => {
            clear.style.backgroundColor = '#5a6268';
            clear.style.transform = 'translateY(-2px)';
        });
        clear.addEventListener('mouseleave', () => {
            clear.style.backgroundColor = '#6c757d';
            clear.style.transform = 'translateY(0)';
        });
        if (ui.periodBtn) actions.insertBefore(clear, ui.periodBtn);
        else actions.appendChild(clear);
        ui.clearBtn = clear;
    }
    if (!state.period.start || !state.period.end) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        state.period.start = _ymdLocal(firstDay);
        state.period.end = _ymdLocal(lastDay);
    }
    state._handlers = state._handlers || {};
    state._handlers.onPeriodClick = openPeriodModal;
    state._handlers.onMatrizChange = () => {
        state.selectedMatriz = ui.matrizFilterSelect.value;
        generateReport();
    };
    state._handlers.onGerenteChange = () => {
        state.selectedGerente = ui.gerenteFilterSelect.value;
        generateReport();
    };
    state._handlers.onClearFilters = () => {
        state.selectedMatriz = '';
        state.selectedGerente = '';
        if (ui.matrizFilterSelect) ui.matrizFilterSelect.value = '';
        if (ui.gerenteFilterSelect) ui.gerenteFilterSelect.value = '';
        generateReport();
    };
    state._handlers.onSubtabClick = (e) => {
        const btn = e.currentTarget;
        ui.subtabButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.turnoAtual = btn.dataset.turno;
        generateReport();
    };
    state._handlers.onCopyKey = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
            if (document.getElementById('efetividade-details-modal')) return;
            const table = ui?.resultContainer?.querySelector('.main-table');
            if (table) {
                e.preventDefault();
                copyTableAsImage();
            }
        }
    };
    const applyCoordVisual = (on) => {
        if (!ui.coordBtn) return;
        ui.coordBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        ui.coordBtn.dataset.on = on ? '1' : '0';
        if (on) {
            ui.coordBtn.classList.add('active');
            ui.coordBtn.style.background = '';
            ui.coordBtn.style.color = '';
            ui.coordBtn.style.boxShadow = '';
        } else {
            ui.coordBtn.classList.remove('active');
            ui.coordBtn.style.background = '';
            ui.coordBtn.style.color = '';
            ui.coordBtn.style.boxShadow = '';
        }
    };
    applyCoordVisual(false);
    state._handlers.onCoordToggle = () => {
        const isOn = ui.coordBtn.getAttribute('aria-pressed') === 'true';
        applyCoordVisual(!isOn);
        generateReport();
    };
    ui.periodBtn?.addEventListener('click', state._handlers.onPeriodClick);
    ui.matrizFilterSelect?.addEventListener('change', state._handlers.onMatrizChange);
    ui.gerenteFilterSelect?.addEventListener('change', state._handlers.onGerenteChange);
    ui.clearBtn?.addEventListener('click', state._handlers.onClearFilters);
    ui.subtabButtons.forEach((btn) => btn.addEventListener('click', state._handlers.onSubtabClick));
    document.addEventListener('keydown', state._handlers.onCopyKey);
    ui.coordBtn?.addEventListener('click', state._handlers.onCoordToggle);
    await fetchFilterData();
    populateMatrizFilter();
    populateGerenteFilter();
    updatePeriodLabel();
    generateReport();
}

export function destroy() {
    state._runId = (state._runId || 0) + 1;
    try {
        ui?.periodBtn?.removeEventListener('click', state._handlers?.onPeriodClick);
        ui?.matrizFilterSelect?.removeEventListener('change', state._handlers?.onMatrizChange);
        ui?.gerenteFilterSelect?.removeEventListener('change', state._handlers?.onGerenteChange);
        ui?.subtabButtons?.forEach((btn) => btn.removeEventListener('click', state._handlers?.onSubtabClick));
        document.removeEventListener('keydown', state._handlers?.onCopyKey);
    } catch (e) {
        console.warn('Destroy listeners:', e);
    }
    state._handlers = null;
    state._inited = false;
    document.querySelector('.efetividade-modal-overlay')?.remove();
}