import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

let ui;
const state = {
    turnoAtual: 'GERAL',
    detailedResults: new Map(),
    period: {start: '', end: ''},
    allMatrizes: [],
    selectedMatriz: '',
    _inited: false,
    _handlers: null,
    _runId: 0,
};

/* ======================
   Utils básicos
====================== */
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

/* ======================
   Export de PNG do modal
====================== */
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

/* ======================
   Estilos do modal
====================== */
function ensureEfetividadeModalStyles() {
    if (document.getElementById('efetividade-details-modal-style')) return;
    const css = `
  .filter-bar.efetividade-filters { display:flex; justify-content:space-between; align-items:center; width:100%; }
  .efetividade-actions { display:flex; gap:8px; align-items:center; }
  #efet-matriz-filter {
    padding:8px 12px; padding-right:2.5em; border:1px solid #ddd; border-radius:20px;
    background-color:#fff; color:#333; font-weight:600; font-size:12px; cursor:pointer;
    -webkit-appearance:none; appearance:none;
    background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e");
    background-repeat:no-repeat; background-position:right 0.7em top 50%; background-size:0.65em auto;
    transition:background-color .2s;
  }
  #efet-matriz-filter:hover { background-color:#f5f5f5; }
  #efet-period-btn { border-radius:20px !important; }
  .subtabs { flex-grow:1; display:flex; justify-content:center; }
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

/* ======================
   Modal de detalhes
====================== */
function showDetailsModal(groupKey, date) {
    ensureEfetividadeModalStyles();
    const details = state.detailedResults.get(groupKey)?.get(date);
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
    const modalTitle = `${titlePrefix} ${groupKey} - ${dateFormatted} (${dayOfWeek})`;

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

/* ======================
   Feedback de carregamento
====================== */
function showLoading(on = true) {
    if (ui?.loader) ui.loader.style.display = on ? 'flex' : 'none';
}

/* ======================
   Datas e período
====================== */
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

/* ================
   Modal do Período
=================== */
function openPeriodModal() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';
    overlay.innerHTML = `
    <div class="container !h-auto !w-auto max-w-md" style="background:#fff;border-radius:12px;padding:16px 18px 18px;box-shadow:0 12px 28px rgba(0,0,0,.18);">
      <h3 style="font-weight:800;color:#003369;margin:0 0 10px;">Selecionar Período</h3>
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

    overlay.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (e.target === overlay || action === 'cancel') {
            document.body.removeChild(overlay);
        } else if (action === 'apply') {
            const startInput = document.getElementById('modal-start-date');
            const endInput = document.getElementById('modal-end-date');
            if (!startInput.value || !endInput.value) {
                alert('Por favor, selecione as duas datas.');
                return;
            }
            state.period.start = startInput.value;
            state.period.end = endInput.value;
            updatePeriodLabel();
            document.body.removeChild(overlay);
            generateReport();
        }
    });
}

/* ======================
   Helpers de paginação
====================== */
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

/* ============================================
   Busca LogDSR para muitos nomes, em lotes
============================================ */
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

    // de-dup
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

/* ============================================
   Fim-do-dia local (America/Bahia, UTC-3)
============================================ */
function endOfLocalDayISO(dateYMD) {
    return new Date(`${dateYMD}T23:59:59-03:00`);
}

/* ======================
   Fetch dos datasets
====================== */
async function fetchData(startDate, endDate, turno) {
    const matrizesPermitidas = getMatrizesPermitidas();

    const [y, m, d] = endDate.split('-').map(Number);
    const endDateObj = new Date(y, m - 1, d);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const endISONextDay = _ymdLocal(endDateObj);

    // 1) Colaboradores
    let colabQuery = supabase
        .from('Colaboradores')
        .select('Nome, SVC, DSR, MATRIZ, Escala, "Data de admissão", Gestor')
        .eq('Ativo', 'SIM')
        .order('Nome', {ascending: true});

    if (matrizesPermitidas && matrizesPermitidas.length) colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
    if (state.selectedMatriz) colabQuery = colabQuery.eq('MATRIZ', state.selectedMatriz);

    if (turno === 'GERAL' || turno === 'COORDENACAO') {
        colabQuery = colabQuery.in('Escala', ['T1', 'T2', 'T3']);
    } else if (turno && ['T1', 'T2', 'T3'].includes(turno)) {
        colabQuery = colabQuery.eq('Escala', turno);
    }

    const colaboradores = await fetchAllPages(colabQuery);
    const nomesColabs = [...new Set(colaboradores.map(c => c.Nome).filter(Boolean))];

    // 2) Demais datasets
    const preenchimentosQuery = supabase
        .from('ControleDiario')
        .select('Nome, Data')
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

    // 3) LogDSR em lotes (evita 400)
    const [preenchimentos, ferias, afastamentos, dsrLogs] = await Promise.all([
        fetchAllPages(preenchimentosQuery),
        fetchAllPages(feriasQuery),
        fetchAllPages(afastamentosQuery),
        fetchDSRLogsByNames(nomesColabs, {chunkSize: 80}),
    ]);

    return {colaboradores, preenchimentos, ferias, dsrLogs, afastamentos};
}

/* ======================
   Processa Efetividade
====================== */
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

    // histórico por nome normalizado
    const dsrHistoryMap = new Map();
    for (const log of dsrLogs) {
        const name = normalizeString(log.Name);
        if (!dsrHistoryMap.has(name)) dsrHistoryMap.set(name, []);
        dsrHistoryMap.get(name).push(log);
    }
    for (const history of dsrHistoryMap.values()) {
        history.sort((a, b) => new Date(a.DataAlteracao) - new Date(b.DataAlteracao));
    }

    // DSR válida para o dia (fim do dia local)
    function getDSRForDate(colaborador, dateYMD, historyMap) {
        const name = normalizeString(colaborador.Nome);
        const history = historyMap.get(name);

        const fallbackCadastro = (colaborador.DSR && String(colaborador.DSR).trim()) || null;
        if (!history || history.length === 0) return fallbackCadastro;

        const cutoff = endOfLocalDayISO(dateYMD); // 23:59:59 -03
        // varrer de trás pra frente até achar a última alteração <= cutoff
        for (let i = history.length - 1; i >= 0; i--) {
            const h = history[i];
            const when = new Date(h.DataAlteracao); // DataAlteracao com offset (+00)
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
        // Nenhum log <= cutoff: usar estado anterior ao primeiro log
        const first = history[0];
        if (first?.DsrAnterior && String(first.DsrAnterior).trim()) return first.DsrAnterior;
        return fallbackCadastro;
    }

    // Índices por dia para férias e afastamentos
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

    // Preenchidos por data
    const preenchidosPorData = new Map();
    for (const p of preenchimentos) {
        if (!preenchidosPorData.has(p.Data)) preenchidosPorData.set(p.Data, new Set());
        preenchidosPorData.get(p.Data).add(normalizeString(p.Nome));
    }

    const groupKeys = [...new Set(colaboradores.map((c) => c[groupBy]).filter(Boolean))].sort();
    const results = {};
    const todayISO = _ymdLocal(new Date());

    for (const key of groupKeys) {
        results[key] = {};
        detailedResults.set(key, new Map());
        const colaboradoresDoGrupo = colaboradores.filter((c) => c[groupBy] === key);

        for (const date of dates) {
            let status = 'EMPTY';

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

            if (date <= todayISO) {
                if (elegiveis.length === 0) status = 'N/A';
                else if (pendentes.length === 0) status = 'OK';
                else if (pendentes.length < elegiveis.length) status = 'PEN';
                else status = 'NOK';
            }
            results[key][date] = status;
        }
    }

    return {groupKeys, results, detailedResults};
}

/* ======================
   Renderização da tabela
====================== */
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

function renderTable(groupKeys, dates, results, groupHeader) {
    if (!ui?.resultContainer) return;
    const formattedDates = dates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
    const headerHtml = `<tr><th>${groupHeader}</th>${formattedDates.map((d) => `<th>${d}</th>`).join('')}</tr>`;
    const bodyHtml = groupKeys.map((key) => `
    <tr>
      <td>${key}</td>
      ${dates.map((date) => {
        const status = results[key]?.[date] || 'N/A';
        const statusClass = getStatusClass(status);
        const statusText = status === 'EMPTY' ? '' : status;
        const title = (status === 'PEN' || status === 'NOK') ? 'Duplo clique para ver detalhes' : status;
        return `<td data-group-key="${key}" data-date="${date}" class="${statusClass}" title="${title}">${statusText}</td>`;
    }).join('')}
    </tr>`).join('');
    ui.resultContainer.innerHTML = `<div class="table-container"><table class="main-table"><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table></div>`;
    const table = ui.resultContainer.querySelector('.main-table');
    if (table) {
        table.addEventListener('dblclick', (event) => {
            const cell = event.target.closest('td[data-group-key]');
            if (!cell) return;
            showDetailsModal(cell.dataset.groupKey, cell.dataset.date);
        });
    }
}

/* ======================
   Geração do relatório
====================== */
async function generateReport() {
    const myRun = (state._runId = (state._runId || 0) + 1);
    const startDate = state.period.start;
    const endDate = state.period.end;

    if (!startDate || !endDate) {
        if (ui?.resultContainer) ui.resultContainer.innerHTML = '<p class="p-4 text-center">Por favor, selecione o período desejado.</p>';
        return;
    }

    showLoading(true);
    if (ui?.resultContainer) ui.resultContainer.innerHTML = `<p class="p-4 text-center">Gerando relatório para ${state.turnoAtual}...</p>`;

    try {
        const dates = listDates(startDate, endDate);
        if (dates.length > 31) throw new Error('O período selecionado não pode exceder 31 dias.');

        const {
            colaboradores,
            preenchimentos,
            ferias,
            dsrLogs,
            afastamentos
        } = await fetchData(startDate, endDate, state.turnoAtual);
        if (myRun !== state._runId) return;

        const isCoordView = state.turnoAtual === 'COORDENACAO';
        const groupBy = isCoordView ? 'Gestor' : 'SVC';
        const groupHeader = isCoordView ? 'Coordenador' : 'SVC';

        const {groupKeys, results, detailedResults} = processEfetividade(
            colaboradores, preenchimentos, dates, ferias, dsrLogs, afastamentos, groupBy
        );
        if (myRun !== state._runId) return;

        state.detailedResults = detailedResults;

        if (groupKeys.length > 0) {
            groupKeys.sort((keyA, keyB) => {
                const statusesA = Object.values(results[keyA]);
                const statusesB = Object.values(results[keyB]);
                const okCountB = statusesB.filter((s) => s === 'OK').length;
                const okCountA = statusesA.filter((s) => s === 'OK').length;
                if (okCountA !== okCountB) return okCountB - okCountA;
                const nokCountA = statusesA.filter((s) => s === 'NOK').length;
                const nokCountB = statusesB.filter((s) => s === 'NOK').length;
                if (nokCountA !== nokCountB) return nokCountA - nokCountB;
                const penA = statusesA.filter((s) => s === 'PEN').length;
                const penB = statusesB.filter((s) => s === 'PEN').length;
                if (penA !== penB) return penA - penB;
                return keyA.localeCompare(keyB);
            });
        }

        if (groupKeys.length === 0) {
            ui.resultContainer.innerHTML = '<p class="p-4 text-center">Nenhum dado encontrado para a seleção atual.</p>';
        } else {
            renderTable(groupKeys, dates, results, groupHeader);
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

/* ======================
   Matrizes (filtro)
====================== */
async function fetchAllMatrizes() {
    try {
        const {data, error} = await supabase.from('Colaboradores').select('MATRIZ').order('MATRIZ', {ascending: true});
        if (error) throw error;
        const matrizesUnicas = [...new Set(data.map((i) => i.MATRIZ).filter(Boolean))].sort();
        state.allMatrizes = matrizesUnicas;
    } catch (error) {
        console.error('Erro ao buscar lista de matrizes:', error);
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

/* ======================
   Ciclo de vida da página
====================== */
export async function init() {
    if (state._inited) return;
    state._inited = true;

    ui = {
        periodBtn: document.getElementById('efet-period-btn'),
        matrizFilterSelect: document.getElementById('efet-matriz-filter'),
        resultContainer: document.getElementById('efet-result'),
        loader: document.getElementById('efet-loader'),
        subtabButtons: document.querySelectorAll('#efetividade-page .subtab-btn'),
    };

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
    state._handlers.onSubtabClick = (e) => {
        const btn = e.currentTarget;
        ui.subtabButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        state.turnoAtual = btn.dataset.turno;
        generateReport();
    };

    ui.periodBtn?.addEventListener('click', state._handlers.onPeriodClick);
    ui.matrizFilterSelect?.addEventListener('change', state._handlers.onMatrizChange);
    ui.subtabButtons.forEach((btn) => btn.addEventListener('click', state._handlers.onSubtabClick));

    await fetchAllMatrizes();
    populateMatrizFilter();
    updatePeriodLabel();
    generateReport();
}

export function destroy() {
    state._runId = (state._runId || 0) + 1;
    try {
        ui?.periodBtn?.removeEventListener('click', state._handlers?.onPeriodClick);
        ui?.matrizFilterSelect?.removeEventListener('change', state._handlers?.onMatrizChange);
        ui?.subtabButtons?.forEach((btn) => btn.removeEventListener('click', state._handlers?.onSubtabClick));
    } catch (e) {
        console.warn('Destroy listeners:', e);
    }
    state._handlers = null;
    state._inited = false;
    document.querySelector('.efetividade-modal-overlay')?.remove();
}
