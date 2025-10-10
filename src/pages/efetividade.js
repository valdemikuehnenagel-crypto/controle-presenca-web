import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

let ui;
const state = {
    turnoAtual: 'GERAL',
    detailedResults: new Map(),
    period: {start: '', end: ''},
};

function ensureEfetividadeModalStyles() {
    if (document.getElementById('efetividade-details-modal-style')) return;
    const css = `
    #efetividade-details-modal {
      position: fixed;
      z-index: 2000;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #fff;
      border: 1px solid #e7ebf4;
      border-radius: 12px;
      box-shadow: 0 12px 28px rgba(0,0,0,.18);
      padding: 16px 18px 18px;
      width: min(720px, 96vw); /* Aumentado para 3 colunas */
      max-width: 96vw;
      animation: efetividade-popin .12s ease-out;
    }
    @keyframes efetividade-popin {
      from { transform: translate(-50%, -50%) scale(.98); opacity:.0 }
      to   { transform: translate(-50%, -50%) scale(1);   opacity:1 }
    }
    #efetividade-details-modal .pop-title {
      font-size: 14px; font-weight: 800; color: #003369;
      margin: 0 0 10px; text-align: center;
    }
    #efetividade-details-modal .pop-close {
      position: absolute; top: 8px; right: 10px; border: none;
      background: transparent; font-size: 22px; cursor: pointer; color: #56607f; line-height: 1;
    }
    #efetividade-details-modal .pop-summary {
        text-align: center;
        font-size: 13px;
        color: #6b7280;
        margin-bottom: 12px;
    }
    #efetividade-details-modal .pop-scroll {
      max-height: 400px; overflow: auto; border: 1px solid #f1f3f8; border-radius: 10px;
    }
    #efetividade-details-modal table { width: 100%; border-collapse: collapse; }
    #efetividade-details-modal thead th {
      text-align: left; font-size:12px; color:#56607f; border-bottom:1px solid #e7ebf4;
      padding:8px 10px; font-weight:700; background:#f9fbff;
    }
    #efetividade-details-modal tbody td {
      font-size:13px; color:#242c4c; padding:8px 10px; border-bottom:1px solid #f1f3f8;
      vertical-align: top; text-align: left; word-break: break-word; background:#fff;
    }
    #efetividade-details-modal tbody td:nth-child(1) { font-weight: 500; }
    #efetividade-details-modal tbody tr:last-child td { border-bottom:none; }
  `.trim();
    const style = document.createElement('style');
    style.id = 'efetividade-details-modal-style';
    style.textContent = css;
    document.head.appendChild(style);
}

function showDetailsModal(svc, date) {
    ensureEfetividadeModalStyles();

    const details = state.detailedResults.get(svc)?.get(date);
    if (!details) return;

    const oldModal = document.querySelector('.efetividade-modal-overlay');
    if (oldModal) oldModal.remove();

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[99] efetividade-modal-overlay';

    const dateFormatted = `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
    let contentHtml = '';

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
                    </tr>
                </thead>
                <tbody>
                    ${details.pendentes.map(p => `
                        <tr>
                            <td>${p.Nome || 'N/D'}</td>
                            <td>${p.Gestor || 'N/D'}</td>
                            <td>${p.Escala || 'N/D'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    overlay.innerHTML = `
        <div id="efetividade-details-modal">
            <h3 class="pop-title">Pendentes em ${svc} - ${dateFormatted} (Turno: ${state.turnoAtual})</h3>
            <button class="pop-close" data-close-modal>×</button>
            <div class="pop-summary">
                Elegíveis: <strong>${details.elegiveis.length}</strong> | Pendentes: <strong>${details.pendentes.length}</strong>
            </div>
            <div class="pop-scroll">
                ${contentHtml}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const closeModal = () => {
        const modalEl = overlay.querySelector('#efetividade-details-modal');
        if (modalEl) {
            modalEl.style.animation = 'efetividade-popin .1s reverse ease-in';
        }
        setTimeout(() => overlay.remove(), 100);
    };

    overlay.querySelector('[data-close-modal]').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
}



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

function updatePeriodLabel() {
    if (ui.periodBtn) {
        ui.periodBtn.textContent = 'Selecionar Período';
    }
}

function openPeriodModal() {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';
    const modalHTML = `
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
        </div>
    `;
    overlay.innerHTML = modalHTML;
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
    const matrizesPermitidas = getMatrizesPermitidas();
    let colabQuery = supabase
        .from('Colaboradores')
        .select('Nome, SVC, DSR, MATRIZ, Escala, "Data de admissão", Gestor')
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
    const feriasQuery = supabase
        .from('Ferias')
        .select('Nome, "Data Inicio", "Data Final"')
        .lte('"Data Inicio"', endDate)
        .gte('"Data Final"', startDate);
    const ferias = await fetchAllPages(feriasQuery);
    return {colaboradores, preenchimentos, ferias};
}

function processEfetividade(colaboradores, preenchimentos, dates, ferias) {
    state.detailedResults.clear();
    const feriasPorDia = new Map();
    for (const registro of ferias) {
        if (registro.Nome && registro['Data Inicio'] && registro['Data Final']) {
            const periodoFerias = listDates(registro['Data Inicio'], registro['Data Final']);
            for (const dia of periodoFerias) {
                if (!feriasPorDia.has(dia)) {
                    feriasPorDia.set(dia, new Set());
                }
                feriasPorDia.get(dia).add(registro.Nome.trim().toUpperCase());
            }
        }
    }
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
            const nomesEmFerias = feriasPorDia.get(date) || new Set();
            const elegiveis = colaboradoresSVC.filter(c => {
                const nomeColaborador = (c.Nome || '').trim().toUpperCase();
                const dataAdmissao = c['Data de admissão'];
                if (!dataAdmissao || dataAdmissao > date) return false;
                if (nomesEmFerias.has(nomeColaborador)) return false;
                const isDSR = (c.DSR || '').toUpperCase() === weekdayPT(date);
                return !isDSR;
            });
            const nomesPreenchidos = preenchidosPorData.get(date) || new Set();
            const pendentes = elegiveis.filter(c => !nomesPreenchidos.has((c.Nome || '').trim().toUpperCase()));
            state.detailedResults.get(svc).set(date, {elegiveis, pendentes});
            if (date <= todayISO) {
                if (elegiveis.length === 0) status = 'N/A';
                else if (pendentes.length === 0) status = 'OK';
                else if (pendentes.length < elegiveis.length) status = 'PENDENTE';
                else status = 'NOK';
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
    const startDate = state.period.start;
    const endDate = state.period.end;
    if (!startDate || !endDate) {
        ui.resultContainer.innerHTML = '<p class="p-4 text-center">Por favor, selecione o período desejado.</p>';
        return;
    }
    showLoading(true);
    ui.resultContainer.innerHTML = `<p class="p-4 text-center">Gerando relatório para o turno ${state.turnoAtual}...</p>`;
    try {
        const dates = listDates(startDate, endDate);
        if (dates.length > 31) throw new Error("O período selecionado não pode exceder 31 dias.");
        const {colaboradores, preenchimentos, ferias} = await fetchData(startDate, endDate, state.turnoAtual);
        const {svcs, results} = processEfetividade(colaboradores, preenchimentos, dates, ferias);
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
        if (svcs.length === 0) {
            ui.resultContainer.innerHTML = '<p class="p-4 text-center">Nenhum colaborador encontrado.</p>';
        } else {
            renderTable(svcs, dates, results);
        }
    } catch (error) {
        console.error('Erro ao gerar relatório de efetividade:', error);
        ui.resultContainer.innerHTML = `<p class="p-4 text-center text-red-500">Falha: ${error.message}</p>`;
    } finally {
        showLoading(false);
    }
}

export function init() {
    ui = {
        periodBtn: document.getElementById('efet-period-btn'),
        resultContainer: document.getElementById('efet-result'),
        loader: document.getElementById('efet-loader'),
        subtabButtons: document.querySelectorAll('#efetividade-page .subtab-btn'),
    };
    if (!state.period.start || !state.period.end) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
        state.period.start = firstDay;
        state.period.end = lastDay;
    }
    ui.periodBtn.addEventListener('click', openPeriodModal);
    ui.subtabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            ui.subtabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.turnoAtual = btn.dataset.turno;
            generateReport();
        });
    });
    updatePeriodLabel();
    generateReport();
}

export function destroy() {
    if (ui && ui.periodBtn) {
        ui.periodBtn.removeEventListener('click', openPeriodModal);
    }
    const modal = document.getElementById('efet-details-modal');
    if (modal) modal.remove();
}