import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';let ui;
const state = {
    turnoAtual: 'GERAL',
    detailedResults: new Map(),
    period: {start: '', end: ''},
    allMatrizes: [],
    selectedMatriz: '',
    _inited: false,
    _handlers: null,
    _runId: 0,
};const normalizeString = (str) => {
    if (!str) return '';
    return str
        .toString()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toUpperCase()
        .trim();
};function _ymdLocal(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}async function exportModalAsPNG(fileName) {
    const modalContent = document.getElementById('efetividade-details-modal');
    if (!modalContent) return;    const exportButton = document.getElementById('export-png-btn');
    const scrollableContent = modalContent.querySelector('.pop-scroll');
    const originalStyles = {
        maxHeight: scrollableContent?.style.maxHeight,
        overflow: scrollableContent?.style.overflow,
        height: scrollableContent?.style.height,
        border: scrollableContent?.style.border,
    };    if (exportButton) exportButton.textContent = 'Exportando...';    try {
        if (scrollableContent) {
            scrollableContent.style.maxHeight = 'none';
            scrollableContent.style.overflow = 'visible';
            scrollableContent.style.height = `${scrollableContent.scrollHeight}px`;
            scrollableContent.style.border = 'none';
        }        const canvas = await html2canvas(modalContent, {
            scrollY: -window.scrollY,
            useCORS: true,
        });        const link = document.createElement('a');
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
}function ensureEfetividadeModalStyles() {
    if (document.getElementById('efetividade-details-modal-style')) return;
    const css = `
    /* =========================
       Layout da Barra de Filtros
       ========================= */
    .filter-bar.efetividade-filters {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%;
    }
    .efetividade-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }
    /* * ESTILO CORRIGIDO PARA O FILTRO DE MATRIZ */
    #efet-matriz-filter {
        padding: 8px 12px;
        padding-right: 2.5em;
        border: 1px solid #ddd;
        border-radius: 20px;
        background-color: #ffffff;
        color: #333;
        font-weight: 600;
        font-size: 12px;
        cursor: pointer;
        -webkit-appearance: none;
        appearance: none;
        background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M2 5l6 6 6-6'/%3e%3c/svg%3e");
        background-repeat: no-repeat;
        background-position: right 0.7em top 50%;
        background-size: 0.65em auto;
        transition: background-color 0.2s;
    }
    #efet-matriz-filter:hover { background-color: #f5f5f5; }
    #efet-period-btn { border-radius: 20px !important; }
    .subtabs { flex-grow: 1; display: flex; justify-content: center; }    /* =========================
       Estilos do modal de detalhes
       ========================= */
    #efetividade-details-modal {
        position: fixed; z-index: 2000; top: 50%; left: 50%;
        transform: translate(-50%, -50%); background: #fff;
        border: 1px solid #e7ebf4; border-radius: 12px;
        box-shadow: 0 12px 28px rgba(0,0,0,.18); padding: 16px 18px 18px;
        width: min(720px, 96vw); max-width: 96vw;
        animation: efetividade-popin .12s ease-out;
    }
    @keyframes efetividade-popin { from { transform: translate(-50%, -50%) scale(.98); opacity:.0 } to { transform: translate(-50%, -50%) scale(1); opacity:1 } }
    #efetividade-details-modal .pop-title { font-size: 14px; font-weight: 800; color: #003369; margin: 0 0 10px; text-align: center; }
    #efetividade-details-modal .pop-close { position: absolute; top: 8px; right: 10px; border: none; background: transparent; font-size: 22px; cursor: pointer; color: #56607f; line-height: 1; }
    #efetividade-details-modal .pop-summary { text-align: center; font-size: 13px; color: #6b7280; margin-bottom: 12px; }
    #efetividade-details-modal .pop-scroll { max-height: 400px; overflow: auto; border: 1px solid #f1f3f8; border-radius: 10px; }
    #efetividade-details-modal table { width: 100%; border-collapse: collapse; }
    #efetividade-details-modal thead th { text-align: left; font-size:12px; color:#56607f; border-bottom:1px solid #e7ebf4; padding:8px 10px; font-weight:700; background:#f9fbff; }
    #efetividade-details-modal tbody td { font-size:13px; color:#242c4c; padding:8px 10px; border-bottom:1px solid #f1f3f8; vertical-align: top; text-align: left; word-break: break-word; background:#fff; }
    #efetividade-details-modal .pop-actions { margin-top: 16px; display: flex; justify-content: flex-end; border-top: 1px solid #f1f3f8; padding-top: 12px; }
    #efetividade-details-modal .btn-export { background-color: #003369; color: white; padding: 8px 16px; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background-color 0.2s; }
    #efetividade-details-modal .btn-export:hover { background-color: #002244; }
  `.trim();    const style = document.createElement('style');
    style.id = 'efetividade-details-modal-style';
    style.textContent = css;
    document.head.appendChild(style);
}function showDetailsModal(groupKey, date) {
    ensureEfetividadeModalStyles();
    const details = state.detailedResults.get(groupKey)?.get(date);
    if (!details) return;    const oldModal = document.querySelector('.efetividade-modal-overlay');
    if (oldModal) oldModal.remove();    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[99] efetividade-modal-overlay';    const dayOfWeek = weekdayPT(date);
    const dateFormatted = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;    let contentHtml = '';
    if (details.pendentes.length === 0) {
        contentHtml = '<p style="text-align:center; padding: 2rem 0;">Nenhum colaborador pendente encontrado.</p>';
    } else {
        contentHtml = `
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Gestor</th>
            <th>Turno</th>
            <th>DSR</th>
          </tr>
        </thead>
        <tbody>
          ${
            details.pendentes
                .map(
                    (p) => `
              <tr>
                <td>${p.Nome || 'N/D'}</td>
                <td>${p.Gestor || 'N/D'}</td>
                <td>${p.Escala || 'N/D'}</td>
                <td>${p.DSR_do_dia || 'N/D'}</td>
              </tr>`
                )
                .join('')
        }
        </tbody>
      </table>`;
    }    const titlePrefix = state.turnoAtual === 'COORDENACAO' ? 'Pendentes de' : 'Pendentes em';
    const modalTitle = `${titlePrefix} ${groupKey} - ${dateFormatted} (${dayOfWeek})`;    overlay.innerHTML = `
    <div id="efetividade-details-modal">
      <h3 class="pop-title">${modalTitle}</h3>
      <button class="pop-close" data-close-modal>×</button>
      <div class="pop-summary">
        Elegíveis: <strong>${details.elegiveis.length}</strong> |
        Pendentes: <strong>${details.pendentes.length}</strong>
      </div>
      <div class="pop-scroll">${contentHtml}</div>
      <div class="pop-actions"><button id="export-png-btn" class="btn-export">Exportar PNG</button></div>
    </div>`;    document.body.appendChild(overlay);    const closeModal = () => {
        const modalEl = overlay.querySelector('#efetividade-details-modal');
        if (modalEl) {
            modalEl.style.animation = 'efetividade-popin .1s reverse ease-in';
        }
        setTimeout(() => overlay.remove(), 100);
    };    overlay.querySelector('[data-close-modal]')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });    document.getElementById('export-png-btn')?.addEventListener('click', () => {
        const fileName = `pendentes_${groupKey.replace(/\s+/g, '_')}_${date.replace(/-/g, '')}`;
        exportModalAsPNG(fileName);
    });
}function showLoading(on = true) {
    if (ui?.loader) ui.loader.style.display = on ? 'flex' : 'none';
}function weekdayPT(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dias = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
    return dias[d.getDay()];
}function listDates(startISO, endISO) {
    const [y1, m1, d1] = startISO.split('-').map(Number);
    const [y2, m2, d2] = endISO.split('-').map(Number);
    let start = new Date(y1, m1 - 1, d1);
    let end = new Date(y2, m2 - 1, d2);
    if (start > end) [start, end] = [end, start];    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        out.push(_ymdLocal(d));
    }
    return out;
}function updatePeriodLabel() {
    if (ui?.periodBtn) ui.periodBtn.textContent = 'Selecionar Período';
}function openPeriodModal() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';    overlay.innerHTML = `
    <div class="container !h-auto !w-auto max-w-md">
      <h3>Selecionar Período</h3>
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
      <div class="form-actions" style="justify-content:flex-end;">
        <button type="button" class="btn-cancelar" data-action="cancel">Cancelar</button>
        <button type="button" class="btn-salvar" data-action="apply">Aplicar</button>
      </div>
    </div>`;    document.body.appendChild(overlay);    overlay.addEventListener('click', (e) => {
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
}async function fetchAllPages(query) {
    const pageSize = 1000;
    let allData = [];
    let page = 0;
    let keepFetching = true;    while (keepFetching) {
        const {data, error} = await query.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            keepFetching = false;
        }        if (data && data.length < pageSize) {
            keepFetching = false;
        }
    }
    return allData;
}async function fetchData(startDate, endDate, turno) {
    const matrizesPermitidas = getMatrizesPermitidas();    let colabQuery = supabase
        .from('Colaboradores')
        .select('Nome, SVC, DSR, MATRIZ, Escala, "Data de admissão", Gestor')
        .eq('Ativo', 'SIM')
        .order('Nome', {ascending: true});    if (matrizesPermitidas && matrizesPermitidas.length) {
        colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
    }
    if (state.selectedMatriz) {
        colabQuery = colabQuery.eq('MATRIZ', state.selectedMatriz);
    }
    if (turno === 'GERAL' || turno === 'COORDENACAO') {
        colabQuery = colabQuery.in('Escala', ['T1', 'T2', 'T3']);
    } else if (turno && ['T1', 'T2', 'T3'].includes(turno)) {
        colabQuery = colabQuery.eq('Escala', turno);
    }    const preenchimentosQuery = supabase
        .from('ControleDiario')
        .select('Nome, Data')
        .gte('Data', startDate)
        .lte('Data', endDate)
        .order('Data', {ascending: true})
        .order('Nome', {ascending: true});    const feriasQuery = supabase
        .from('Ferias')
        .select('Nome, "Data Inicio", "Data Final"')
        .lte('"Data Inicio"', endDate)
        .gte('"Data Final"', startDate)
        .order('"Data Inicio"', {ascending: true})
        .order('Nome', {ascending: true});    const dsrLogQuery = supabase
        .from('LogDSR')
        .select('*')
        .lte('DataAlteracao', endDate)
        .order('DataAlteracao', {ascending: true})
        .order('Name', {ascending: true});    const afastamentosQuery = supabase
        .from('Afastamentos')
        .select('NOME, "DATA INICIO", "DATA RETORNO"')
        .lte('"DATA INICIO"', endDate)
        .gt('"DATA RETORNO"', startDate)
        .order('"DATA INICIO"', {ascending: true})
        .order('NOME', {ascending: true});    const [colaboradores, preenchimentos, ferias, dsrLogs, afastamentos] = await Promise.all([
        fetchAllPages(colabQuery),
        fetchAllPages(preenchimentosQuery),
        fetchAllPages(feriasQuery),
        fetchAllPages(dsrLogQuery),
        fetchAllPages(afastamentosQuery),
    ]);    return {colaboradores, preenchimentos, ferias, dsrLogs, afastamentos};
}function processEfetividade(
    colaboradores,
    preenchimentos,
    dates,
    ferias,
    dsrLogs,
    afastamentos,
    groupBy
) {
    const detailedResults = new Map();    const dsrHistoryMap = new Map();
    for (const log of dsrLogs) {
        const name = normalizeString(log.Name);
        if (!dsrHistoryMap.has(name)) dsrHistoryMap.set(name, []);
        dsrHistoryMap.get(name).push(log);
    }
    for (const history of dsrHistoryMap.values()) {
        history.sort((a, b) => new Date(a.DataAlteracao) - new Date(b.DataAlteracao));
    }    function getDSRForDate(colaborador, date, historyMap) {
        const name = normalizeString(colaborador.Nome);
        const history = historyMap.get(name);
        if (!history || history.length === 0) return colaborador.DSR;        let applicableDSR = null;
        for (let i = history.length - 1; i >= 0; i--) {
            if (history[i].DataAlteracao.slice(0, 10) <= date) {
                applicableDSR = history[i].DsrAtual;
                break;
            }
        }
        if (applicableDSR === null) applicableDSR = history[0].DsrAnterior;
        return applicableDSR;
    }    const feriasPorDia = new Map();
    for (const registro of ferias) {
        if (registro.Nome && registro['Data Inicio'] && registro['Data Final']) {
            const periodoFerias = listDates(registro['Data Inicio'], registro['Data Final']);
            for (const dia of periodoFerias) {
                if (!feriasPorDia.has(dia)) feriasPorDia.set(dia, new Set());
                feriasPorDia.get(dia).add(normalizeString(registro.Nome));
            }
        }
    }    const afastadosPorDia = new Map();
    for (const registro of afastamentos) {
        if (registro.NOME && registro['DATA INICIO'] && registro['DATA RETORNO']) {
            const dataInicio = registro['DATA INICIO'];
            const dataRetornoObj = new Date(registro['DATA RETORNO'] + 'T00:00:00');
            dataRetornoObj.setDate(dataRetornoObj.getDate() - 1);
            const dataFimAfastamento = _ymdLocal(dataRetornoObj);            if (dataFimAfastamento >= dataInicio) {
                const periodoAfastamento = listDates(dataInicio, dataFimAfastamento);
                for (const dia of periodoAfastamento) {
                    if (!afastadosPorDia.has(dia)) afastadosPorDia.set(dia, new Set());
                    afastadosPorDia.get(dia).add(normalizeString(registro.NOME));
                }
            }
        }
    }    const preenchidosPorData = new Map();
    for (const p of preenchimentos) {
        if (!preenchidosPorData.has(p.Data)) preenchidosPorData.set(p.Data, new Set());
        preenchidosPorData.get(p.Data).add(normalizeString(p.Nome));
    }    const groupKeys = [...new Set(colaboradores.map((c) => c[groupBy]).filter(Boolean))].sort();
    const results = {};    const todayISO = _ymdLocal(new Date());    for (const key of groupKeys) {
        results[key] = {};
        detailedResults.set(key, new Map());
        const colaboradoresDoGrupo = colaboradores.filter((c) => c[groupBy] === key);        for (const date of dates) {
            let status = 'EMPTY';            const nomesEmFerias = feriasPorDia.get(date) || new Set();
            const nomesAfastados = afastadosPorDia.get(date) || new Set();            const elegiveis = colaboradoresDoGrupo.reduce((acc, c) => {
                const nomeColaborador = normalizeString(c.Nome);
                const dataAdmissao = c['Data de admissão'];                if (!dataAdmissao || dataAdmissao > date) return acc;
                if (nomesEmFerias.has(nomeColaborador)) return acc;
                if (nomesAfastados.has(nomeColaborador)) return acc;                const historicalDSR = getDSRForDate(c, date, dsrHistoryMap);
                const isDSR = normalizeString(historicalDSR).includes(normalizeString(weekdayPT(date)));                if (!isDSR) acc.push({...c, DSR_do_dia: historicalDSR});
                return acc;
            }, []);            const nomesPreenchidos = preenchidosPorData.get(date) || new Set();
            const pendentes = elegiveis.filter((c) => !nomesPreenchidos.has(normalizeString(c.Nome)));            detailedResults.get(key).set(date, {elegiveis, pendentes});            if (date <= todayISO) {
                if (elegiveis.length === 0) status = 'N/A';
                else if (pendentes.length === 0) status = 'OK';
                else if (pendentes.length < elegiveis.length) status = 'PEN';
                else status = 'NOK';
            }
            results[key][date] = status;
        }
    }    return {groupKeys, results, detailedResults};
}function getStatusClass(status) {
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
}function renderTable(groupKeys, dates, results, groupHeader) {
    if (!ui?.resultContainer) return;    const formattedDates = dates.map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
    const headerHtml = `<tr><th>${groupHeader}</th>${formattedDates.map((d) => `<th>${d}</th>`).join('')}</tr>`;    const bodyHtml = groupKeys
        .map(
            (key) => `<tr>
      <td>${key}</td>
      ${dates
                .map((date) => {
                    const status = results[key]?.[date] || 'N/A';
                    const statusClass = getStatusClass(status);
                    const statusText = status === 'EMPTY' ? '' : status;
                    const title = status === 'PEN' || status === 'NOK' ? 'Duplo clique para ver detalhes' : status;
                    return `<td data-group-key="${key}" data-date="${date}" class="${statusClass}" title="${title}">${statusText}</td>`;
                })
                .join('')}
    </tr>`
        )
        .join('');    ui.resultContainer.innerHTML = `<div class="table-container"><table class="main-table"><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table></div>`;    const table = ui.resultContainer.querySelector('.main-table');
    if (table) {
        table.addEventListener('dblclick', (event) => {
            const cell = event.target.closest('td[data-group-key]');
            if (!cell) return;
            showDetailsModal(cell.dataset.groupKey, cell.dataset.date);
        });
    }
}async function generateReport() {
    const myRun = (state._runId = (state._runId || 0) + 1);    const startDate = state.period.start;
    const endDate = state.period.end;
    if (!startDate || !endDate) {
        if (ui?.resultContainer)
            ui.resultContainer.innerHTML = '<p class="p-4 text-center">Por favor, selecione o período desejado.</p>';
        return;
    }    showLoading(true);
    if (ui?.resultContainer)
        ui.resultContainer.innerHTML = `<p class="p-4 text-center">Gerando relatório para ${state.turnoAtual}...</p>`;    try {
        const dates = listDates(startDate, endDate);
        if (dates.length > 31) throw new Error('O período selecionado não pode exceder 31 dias.');        const {colaboradores, preenchimentos, ferias, dsrLogs, afastamentos} = await fetchData(
            startDate,
            endDate,
            state.turnoAtual
        );        if (myRun !== state._runId) return;        const isCoordView = state.turnoAtual === 'COORDENACAO';
        const groupBy = isCoordView ? 'Gestor' : 'SVC';
        const groupHeader = isCoordView ? 'Coordenador' : 'SVC';        const {groupKeys, results, detailedResults} = processEfetividade(
            colaboradores,
            preenchimentos,
            dates,
            ferias,
            dsrLogs,
            afastamentos,
            groupBy
        );        if (myRun !== state._runId) return;        state.detailedResults = detailedResults;        if (groupKeys.length > 0) {
            groupKeys.sort((keyA, keyB) => {
                const statusesA = Object.values(results[keyA]);
                const statusesB = Object.values(results[keyB]);                const okCountB = statusesB.filter((s) => s === 'OK').length;
                const okCountA = statusesA.filter((s) => s === 'OK').length;
                if (okCountA !== okCountB) return okCountB - okCountA;                const nokCountA = statusesA.filter((s) => s === 'NOK').length;
                const nokCountB = statusesB.filter((s) => s === 'NOK').length;
                if (nokCountA !== nokCountB) return nokCountA - nokCountB;                const pendenteCountA = statusesA.filter((s) => s === 'PEN').length;
                const pendenteCountB = statusesB.filter((s) => s === 'PEN').length;
                if (pendenteCountA !== pendenteCountB) return pendenteCountA - pendenteCountB;                return keyA.localeCompare(keyB);
            });
        }        if (groupKeys.length === 0) {
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
}async function fetchAllMatrizes() {
    try {
        const {data, error} = await supabase.from('Colaboradores').select('MATRIZ').order('MATRIZ', {ascending: true});
        if (error) throw error;
        const matrizesUnicas = [...new Set(data.map((item) => item.MATRIZ).filter(Boolean))].sort();
        state.allMatrizes = matrizesUnicas;
    } catch (error) {
        console.error('Erro ao buscar lista de matrizes:', error);
    }
}function populateMatrizFilter() {
    if (!ui?.matrizFilterSelect) return;
    while (ui.matrizFilterSelect.options.length > 1) {
        ui.matrizFilterSelect.remove(1);
    }
    state.allMatrizes.forEach((matriz) => {
        const option = document.createElement('option');
        option.value = matriz;
        option.textContent = matriz;
        ui.matrizFilterSelect.appendChild(option);
    });
}export async function init() {
    if (state._inited) return;
    state._inited = true;    ui = {
        periodBtn: document.getElementById('efet-period-btn'),
        matrizFilterSelect: document.getElementById('efet-matriz-filter'),
        resultContainer: document.getElementById('efet-result'),
        loader: document.getElementById('efet-loader'),
        subtabButtons: document.querySelectorAll('#efetividade-page .subtab-btn'),
    };    if (!state.period.start || !state.period.end) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        state.period.start = _ymdLocal(firstDay);
        state.period.end = _ymdLocal(lastDay);
    }    state._handlers = state._handlers || {};
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
    };    ui.periodBtn?.addEventListener('click', state._handlers.onPeriodClick);
    ui.matrizFilterSelect?.addEventListener('change', state._handlers.onMatrizChange);
    ui.subtabButtons.forEach((btn) => btn.addEventListener('click', state._handlers.onSubtabClick));    await fetchAllMatrizes();
    populateMatrizFilter();
    updatePeriodLabel();
    generateReport();
}export function destroy() {    state._runId = (state._runId || 0) + 1;    try {
        ui?.periodBtn?.removeEventListener('click', state._handlers?.onPeriodClick);
        ui?.matrizFilterSelect?.removeEventListener('change', state._handlers?.onMatrizChange);
        ui?.subtabButtons?.forEach((btn) => btn.removeEventListener('click', state._handlers?.onSubtabClick));
    } catch (e) {
        console.warn('Destroy listeners:', e);
    }    state._handlers = null;
    state._inited = false;    document.querySelector('.efetividade-modal-overlay')?.remove();
}
