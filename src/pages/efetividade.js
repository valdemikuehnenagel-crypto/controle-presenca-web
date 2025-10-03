import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';


let ui;
let pageStyle = null;
const state = {
    turnoAtual: 'GERAL',
    detailedResults: new Map(),
};


function showLoading(on = true) {
    if (ui.loader) ui.loader.style.display = on ? 'flex' : 'none';
}

function weekdayPT(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dias = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
    return dias[d.getDay()];
}

function listDates(startISO, endISO) {
    let start = new Date(startISO + 'T00:00:00');
    let end = new Date(endISO + 'T00:00:00');
    if (start > end) [start, end] = [end, start];
    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}


async function fetchAllPages(query) {
    const pageSize = 1000;
    let allData = [];
    let page = 0;
    let keepFetching = true;

    while (keepFetching) {
        const {data, error} = await query.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            keepFetching = false;
        }
        if (data && data.length < pageSize) {
            keepFetching = false;
        }
    }
    return allData;
}

async function fetchData(startDate, endDate, turno) {
    const matrizesPermitidas = await getMatrizesPermitidas();
    let colabQuery = supabase
        .from('Colaboradores')
        .select('Nome, SVC, DSR, Ferias, MATRIZ, Escala')
        .eq('Ativo', 'SIM');

    if (matrizesPermitidas && matrizesPermitidas.length) {
        colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
    }
    if (turno === 'GERAL') {
        colabQuery = colabQuery.in('Escala', ['T1', 'T2', 'T3']);
    } else if (turno) {
        colabQuery = colabQuery.eq('Escala', turno);
    }
    const colaboradores = await fetchAllPages(colabQuery);

    const preenchimentosQuery = supabase
        .from('ControleDiario')
        .select('Nome, Data')
        .gte('Data', startDate)
        .lte('Data', endDate);
    const preenchimentos = await fetchAllPages(preenchimentosQuery);

    return {colaboradores, preenchimentos};
}

function processEfetividade(colaboradores, preenchimentos, dates) {
    state.detailedResults.clear();
    const preenchidosPorData = new Map();
    for (const p of preenchimentos) {
        if (!preenchidosPorData.has(p.Data)) {
            preenchidosPorData.set(p.Data, new Set());
        }
        preenchidosPorData.get(p.Data).add((p.Nome || '').trim().toUpperCase());
    }
    const svcs = [...new Set(colaboradores.map(c => c.SVC).filter(Boolean))].sort();
    const results = {};
    const todayISO = new Date().toISOString().slice(0, 10);

    for (const svc of svcs) {
        results[svc] = {};
        state.detailedResults.set(svc, new Map());
        const colaboradoresSVC = colaboradores.filter(c => c.SVC === svc);
        for (const date of dates) {
            let status = 'EMPTY';
            const elegiveis = colaboradoresSVC.filter(c => (c.Ferias || 'NAO').toUpperCase() !== 'SIM' && (c.DSR || '').toUpperCase() !== weekdayPT(date));
            const nomesPreenchidos = preenchidosPorData.get(date) || new Set();
            const pendentes = elegiveis.filter(c => !nomesPreenchidos.has((c.Nome || '').trim().toUpperCase()));
            state.detailedResults.get(svc).set(date, {elegiveis, pendentes});
            if (date <= todayISO) {
                if (elegiveis.length === 0) {
                    status = 'N/A';
                } else if (pendentes.length === 0) {
                    status = 'OK';
                } else if (pendentes.length < elegiveis.length) {
                    status = 'PENDENTE';
                } else {
                    status = 'NOK';
                }
            }
            results[svc][date] = status;
        }
    }
    return {svcs, results};
}


function getStatusClass(status) {
    switch (status) {
        case 'OK':
            return 'status-ok';
        case 'PENDENTE':
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

function showDetailsModal(svc, date) {
    const details = state.detailedResults.get(svc)?.get(date);
    if (!details) return;
    const oldModal = document.getElementById('efet-details-modal');
    if (oldModal) oldModal.remove();
    const modal = document.createElement('div');
    modal.id = 'efet-details-modal';
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';
    const dateFormatted = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
    let contentHtml = '';
    if (details.pendentes.length === 0) {
        contentHtml = '<p>Nenhum colaborador pendente encontrado para esta seleção.</p><p>Total de Elegíveis: ' + details.elegiveis.length + '</p>';
    } else {
        contentHtml = `
            <p class="mb-2">Total de Elegíveis: <strong>${details.elegiveis.length}</strong> | Pendentes: <strong>${details.pendentes.length}</strong></p>
            <ul class="details-list">
                ${details.pendentes.map(p => `<li><strong>${p.Nome}</strong> (Turno: ${p.Escala || 'N/D'})</li>`).join('')}
            </ul>
        `;
    }
    modal.innerHTML = `
        <div class="container !h-auto !w-auto max-w-lg">
            <h3 class="mb-4">Pendentes em ${svc} - ${dateFormatted} (Turno: ${state.turnoAtual})</h3>
            <div class="max-h-[60vh] overflow-y-auto pr-2">
                ${contentHtml}
            </div>
            <div class="form-actions" style="justify-content:flex-end;">
                <button type="button" class="btn-cancelar" data-close-modal>Fechar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function renderTable(svcs, dates, results) {
    if (!ui.resultContainer) return;
    const formattedDates = dates.map(d => `${d.slice(8, 10)}/${d.slice(5, 7)}`);
    const headerHtml = `<tr><th>SVC</th>${formattedDates.map(d => `<th>${d}</th>`).join('')}</tr>`;
    const bodyHtml = svcs.map(svc => `
        <tr>
            <td>${svc}</td>
            ${dates.map(date => {
        const status = results[svc]?.[date] || 'N/A';
        const statusClass = getStatusClass(status);
        const statusText = status === 'EMPTY' ? '' : status;
        const title = status === 'PENDENTE' || status === 'NOK' ? 'Duplo clique para ver detalhes' : status;
        return `<td data-svc="${svc}" data-date="${date}" class="${statusClass}" title="${title}">${statusText}</td>`;
    }).join('')}
        </tr>
    `).join('');
    ui.resultContainer.innerHTML = `<div class="table-container"><table class="main-table"><thead>${headerHtml}</thead><tbody>${bodyHtml}</tbody></table></div>`;
    const table = ui.resultContainer.querySelector('.main-table');
    if (table) {
        table.addEventListener('dblclick', (event) => {
            const cell = event.target.closest('td[data-svc]');
            if (!cell) return;
            showDetailsModal(cell.dataset.svc, cell.dataset.date);
        });
    }
}

async function generateReport() {
    const startDate = ui.startDateInput.value;
    const endDate = ui.endDateInput.value;
    if (!startDate || !endDate) {
        ui.resultContainer.innerHTML = '<p>Por favor, selecione as datas de início e fim.</p>';
        return;
    }
    showLoading(true);
    ui.resultContainer.innerHTML = `<p>Gerando relatório para o turno ${state.turnoAtual}...</p>`;
    try {
        const dates = listDates(startDate, endDate);
        if (dates.length > 31) throw new Error("O período selecionado não pode exceder 31 dias.");
        const {colaboradores, preenchimentos} = await fetchData(startDate, endDate, state.turnoAtual);
        const {svcs, results} = processEfetividade(colaboradores, preenchimentos, dates);
        if (svcs.length > 0) {
            svcs.sort((svcA, svcB) => {
                const statusesA = Object.values(results[svcA]);
                const statusesB = Object.values(results[svcB]);
                const okCountB = statusesB.filter(s => s === 'OK').length;
                const okCountA = statusesA.filter(s => s === 'OK').length;
                if (okCountA !== okCountB) return okCountB - okCountA;
                const nokCountA = statusesA.filter(s => s === 'NOK').length;
                const nokCountB = statusesB.filter(s => s === 'NOK').length;
                if (nokCountA !== nokCountB) return nokCountA - nokCountB;
                const pendenteCountA = statusesA.filter(s => s === 'PENDENTE').length;
                const pendenteCountB = statusesB.filter(s => s === 'PENDENTE').length;
                if (pendenteCountA !== pendenteCountB) return pendenteCountA - pendenteCountB;
                return svcA.localeCompare(svcB);
            });
        }
        if (svcs.length === 0) ui.resultContainer.innerHTML = '<p>Nenhum colaborador encontrado para o período e turno selecionados.</p>';
        else renderTable(svcs, dates, results);
    } catch (error) {
        console.error('Erro ao gerar relatório de efetividade:', error);
        ui.resultContainer.innerHTML = `<p class="text-red-500">Falha ao gerar relatório: ${error.message}</p>`;
    } finally {
        showLoading(false);
    }
}

function injectCSS() {
    if (document.getElementById('efetividade-style')) return;


    const css = `
        /* Estrutura principal do novo cabeçalho */
        #efetividade-page .efetividade-header {
            display: flex;
            flex-direction: column; /* Organiza as barras em linhas */
            gap: 1rem; /* Espaço entre a linha de filtros e a de ações */
            margin-bottom: 1rem;
        }

        /* Linha 1: Barra de Filtros */
        #efetividade-page .filter-bar {
            display: flex;
            align-items: center;
            flex-wrap: wrap; /* Permite quebrar linha em telas menores */
            gap: 2rem; /* Espaço entre os grupos de filtros */
        }
        #efetividade-page .date-filters {
            display: flex;
            align-items: center;
            gap: 1rem;
            flex-wrap: wrap;
        }
        
        /* Linha 2: Barra de Ações e Legenda */
        #efetividade-page .action-bar {
            display: flex;
            justify-content: space-between; /* Empurra a legenda para a esquerda e o botão para a direita */
            align-items: center;
            flex-wrap: wrap;
            gap: 1rem;
        }

        /* Estilos da Legenda */
        #efetividade-page .legend-container { display: flex; gap: 1.5rem; font-size: 0.8rem; color: black; font-weight: bold; }
        #efetividade-page .legend-item { display: flex; align-items: center; gap: 0.4rem; }
        #efetividade-page .legend-dot { width: 12px; height: 12px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.1); }
        #efetividade-page .legend-dot.status-ok { background-color: #d4edda; }
        #efetividade-page .legend-dot.status-pendente { background-color: #fff3cd; }
        #efetividade-page .legend-dot.status-nok { background-color: #f8d7da; }

        /* Cores da Tabela (com alta especificidade) */
        #efet-result .main-table td.status-ok { background-color: #d4edda !important; color: #155724 !important; }
        #efet-result .main-table td.status-pendente { background-color: #fff3cd !important; color: #856404 !important; }
        #efet-result .main-table td.status-nok { background-color: #f8d7da !important; color: #721c24 !important; }
        #efet-result .main-table td.status-na { background-color: #e9ecef !important; color: #495057 !important; }
        #efet-result .main-table td.status-empty { background-color: #fff !important; }

        /* Estilos gerais */
        .status-pendente, .status-nok { cursor: pointer; }
        .details-list { list-style: disc; padding-left: 20px; }
        .details-list li { margin-bottom: 4px; }
        #efet-result .table-container { max-height: calc(100vh - 300px); }
        #efet-result .main-table th, #efet-result .main-table td { text-align: center; padding: 8px 6px; font-size: 0.8rem; border: 1px solid #dee2e6; }
        #efet-result .main-table th:first-child, #efet-result .main-table td:first-child { text-align: left; font-weight: bold; position: sticky; left: 0; background-color: #f8f9fa; z-index: 1; }
    `;
    pageStyle = document.createElement('style');
    pageStyle.id = 'efetividade-style';
    pageStyle.textContent = css;
    document.head.appendChild(pageStyle);
}

export function init() {
    injectCSS();
    ui = {
        startDateInput: document.getElementById('efet-start-date'),
        endDateInput: document.getElementById('efet-end-date'),
        generateBtn: document.getElementById('efet-generate-btn'),
        resultContainer: document.getElementById('efet-result'),
        loader: document.getElementById('efet-loader'),
        subtabButtons: document.querySelectorAll('#efetividade-page .subtab-btn'),
    };
    if (!ui.startDateInput.value || !ui.endDateInput.value) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
        ui.startDateInput.value = firstDay;
        ui.endDateInput.value = lastDay;
    }
    ui.generateBtn.addEventListener('click', generateReport);
    ui.subtabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            ui.subtabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.turnoAtual = btn.dataset.turno;
            generateReport();
        });
    });
    generateReport();
}

export function destroy() {
    if (ui && ui.generateBtn) {
        ui.generateBtn.removeEventListener('click', generateReport);
    }
    if (pageStyle) {
        pageStyle.remove();
        pageStyle = null;
    }
    const modal = document.getElementById('efet-details-modal');
    if (modal) modal.remove();
}