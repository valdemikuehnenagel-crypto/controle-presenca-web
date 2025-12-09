import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';
import {garantirModalEdicaoAtivo} from './colaboradores.js';let ui;
const CACHE_TTL_MS = 10 * 60_000;
const _cache = new Map();
const _inflight = new Map();
const _listeners = [];function keyFromMatrizes(mp) {
    const part = Array.isArray(mp) && mp.length ? [...mp].sort().join('|') : 'ALL';
    return `dados-op:colaboradores:${part}:ativos`;
}function fetchOnce(key, loader, ttl = CACHE_TTL_MS) {
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && (now - hit.ts) < hit.ttl) return Promise.resolve(hit.value);
    if (_inflight.has(key)) return _inflight.get(key);
    const p = (async () => {
        try {
            const val = await loader();
            _cache.set(key, {ts: Date.now(), ttl, value: val});
            return val;
        } finally {
            _inflight.delete(key);
        }
    })();
    _inflight.set(key, p);
    return p;
}function invalidateCache(keys) {
    if (!keys || !keys.length) {
        _cache.clear();
        return;
    }
    keys.forEach(k => _cache.delete(k));
}const state = {
    mounted: false,
    detailedResults: new Map(),
    totalGeralResults: {},
    filters: {matriz: '', gerente: '', svc: ''},
    universe: {svcs: [], matrizes: [], gerentes: []},
    mappings: {svcToGerente: new Map(), svcToMatriz: new Map()},
};async function fetchAllPages(query) {
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
        if (!data || data.length < pageSize) keepFetching = false;
    }
    return allData;
}async function fetchMatrizesMappings() {
    const matrizesPermitidas = getMatrizesPermitidas();
    let q = supabase.from('Matrizes').select('SERVICE, MATRIZ, GERENCIA, REGIAO');
    if (matrizesPermitidas && matrizesPermitidas.length) q = q.in('MATRIZ', matrizesPermitidas);
    const rows = await fetchAllPages(q);
    const svcToGerente = new Map();
    const svcToMatriz = new Map();
    const optMatrizes = new Set();
    const optGerentes = new Set();
    const optSvcs = new Set();
    (rows || []).forEach(r => {
        const svc = String(r.SERVICE || '').trim();
        const matriz = String(r.MATRIZ || '').trim();
        const gerente = String(r.GERENCIA || '').trim();
        if (!svc) return;
        svcToGerente.set(svc, gerente || '');
        svcToMatriz.set(svc, matriz || '');
        optSvcs.add(svc);
        if (matriz) optMatrizes.add(matriz);
        if (gerente) optGerentes.add(gerente);
    });
    return {
        svcToGerente,
        svcToMatriz,
        matrizes: [...optMatrizes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        gerentes: [...optGerentes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        svcs: [...optSvcs].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
}async function fetchDataCached() {
    const matrizesPermitidas = getMatrizesPermitidas();
    const key = keyFromMatrizes(matrizesPermitidas);
    return fetchOnce(key, async () => {
        let colabQuery = supabase
            .from('Colaboradores')
            .select('Nome, SVC, "Data de admissão", "Data de nascimento", LDAP, "ID GROOT", Gestor, MATRIZ, Cargo, Escala, DSR, Genero, MatriculaKN, Contrato')
            .eq('Ativo', 'SIM');        if (matrizesPermitidas && matrizesPermitidas.length) {
            colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
        }        const todosColaboradores = await fetchAllPages(colabQuery);        const colaboradores = todosColaboradores.filter(c => {
            const cargo = c.Cargo ? String(c.Cargo).toUpperCase().trim() : '';
            return cargo === 'AUXILIAR';
        });        colaboradores.sort((a, b) => String(a?.Nome || '').localeCompare(String(b?.Nome || ''), 'pt-BR'));        const maps = await fetchMatrizesMappings();
        return {colaboradores, ...maps};
    });
}function computeCascadingOptions(current, universe, mappings) {
    const selMatriz = String(current.matriz || '').trim();
    const selGerente = String(current.gerente || '').trim();
    const selSvc = String(current.svc || '').trim();
    const {svcs} = universe;
    const {svcToGerente, svcToMatriz} = mappings;
    const allowedSvcs = svcs.filter(svc => {
        const m = String(svcToMatriz.get(svc) || '').trim();
        const g = String(svcToGerente.get(svc) || '').trim();
        if (selMatriz && m !== selMatriz) return false;
        if (selGerente && g !== selGerente) return false;
        if (selSvc && svc !== selSvc) return false;
        return true;
    });
    const allowedMatrizes = new Set();
    const allowedGerentes = new Set();
    allowedSvcs.forEach(svc => {
        const m = String(svcToMatriz.get(svc) || '').trim();
        const g = String(svcToGerente.get(svc) || '').trim();
        if (m) allowedMatrizes.add(m);
        if (g) allowedGerentes.add(g);
    });
    return {
        svcs: allowedSvcs,
        matrizes: [...allowedMatrizes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        gerentes: [...allowedGerentes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
}function applyUserFilters(colaboradores, filters, mappings) {
    const fMatriz = String(filters.matriz || '').trim().toUpperCase();
    const fGerente = String(filters.gerente || '').trim().toUpperCase();
    const fSvc = String(filters.svc || '').trim().toUpperCase();
    const {svcToGerente, svcToMatriz} = mappings;
    return colaboradores.filter(c => {
        const svc = String(c.SVC || '').trim();
        const matrizDoSvc = String(svcToMatriz.get(svc) || '').trim().toUpperCase();
        const gerenteDoSvc = String(svcToGerente.get(svc) || '').trim().toUpperCase();
        if (fMatriz && matrizDoSvc !== fMatriz) return false;
        if (fGerente && gerenteDoSvc !== fGerente) return false;
        if (fSvc && svc.toUpperCase() !== fSvc) return false;
        return true;
    });
}function processDataQuality(colaboradores) {
    state.detailedResults.clear();
    state.totalGeralResults = {};
    const svcs = [...new Set(colaboradores.map(c => c.SVC).filter(Boolean))].sort();    const colunasParaVerificar = [
        'Gestor', 'DSR', 'Escala', 'Cargo', 'Data de admissão',
        'MatriculaKN', 'ID GROOT', 'LDAP', 'Data de nascimento', 'Genero'
    ];    const totalGeralColaboradores = colaboradores.length;
    const totalGeralResults = {};
    let totalGeralPercentualSoma = 0;    if (totalGeralColaboradores > 0) {
        for (const coluna of colunasParaVerificar) {
            const pendentesGeral = colaboradores.filter(c => {
                const valor = c[coluna];
                const isEmpty = valor === null || valor === undefined || String(valor).trim() === '';
                if (coluna === 'MatriculaKN') {
                    const contrato = String(c.Contrato || '').trim().toUpperCase();
                    if (contrato !== 'KN') return false;
                }
                return isEmpty;
            });
            const preenchidosCountGeral = totalGeralColaboradores - pendentesGeral.length;
            const percentualGeral = (preenchidosCountGeral / totalGeralColaboradores) * 100;
            totalGeralResults[coluna] = {
                percentual: percentualGeral,
                pendentes: pendentesGeral,
                total: totalGeralColaboradores
            };
            totalGeralPercentualSoma += percentualGeral;
        }
        totalGeralResults.totalGeral = totalGeralPercentualSoma / colunasParaVerificar.length;
    }
    state.totalGeralResults = totalGeralResults;    const results = {};
    for (const svc of svcs) {
        results[svc] = {};
        state.detailedResults.set(svc, new Map());
        const colaboradoresSVC = colaboradores.filter(c => c.SVC === svc);
        const totalColabsSVC = colaboradoresSVC.length;
        if (totalColabsSVC === 0) continue;
        let percentualTotalSoma = 0;        for (const coluna of colunasParaVerificar) {
            const pendentes = colaboradoresSVC.filter(c => {
                const valor = c[coluna];
                const isEmpty = valor === null || valor === undefined || String(valor).trim() === '';
                if (coluna === 'MatriculaKN') {
                    const contrato = String(c.Contrato || '').trim().toUpperCase();
                    if (contrato !== 'KN') return false;
                }
                return isEmpty;
            });
            const preenchidosCount = totalColabsSVC - pendentes.length;
            const percentual = (totalColabsSVC === 0) ? 0 : (preenchidosCount / totalColabsSVC) * 100;
            results[svc][coluna] = {percentual, pendentes};
            percentualTotalSoma += percentual;
            if (!state.detailedResults.get(svc).has(coluna)) {
                state.detailedResults.get(svc).set(coluna, {pendentes, total: totalColabsSVC});
            }
        }
        results[svc].totalGeral = (colunasParaVerificar.length === 0) ? 0 : percentualTotalSoma / colunasParaVerificar.length;
    }
    return {svcs, results, colunas: colunasParaVerificar, totalGeralResults};
}function getStatusClass(percentual) {
    if (percentual === 100) return 'status-ok';
    if (percentual > 0) return 'status-pendente';
    if (percentual === 0) return 'status-nok';
    return 'status-na';
}function getTotalStatusClass(percentual) {
    if (percentual === 100) return 'status-ok';
    if (percentual >= 90) return 'status-pendente';
    return 'status-nok';
}function ensureFiltersBar() {    ui.matrizSelect = document.getElementById('dados-op-matriz-filter') || document.getElementById('dados-op-filter-matriz');
    ui.gerenteSelect = document.getElementById('dados-op-gerente-filter') || document.getElementById('dados-op-filter-gerente');
    ui.svcSelect = document.getElementById('dados-op-svc-filter') || document.getElementById('dados-op-filter-svc');
    ui.clearBtn = document.getElementById('dados-op-clear-filters');    if (!ui.matrizSelect) {
        let bar = document.getElementById('dados-op-filters');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'dados-op-filters';
            bar.className = 'dados-op-filters';
            bar.style.display = 'block';
            bar.style.width = '100%';
            bar.style.margin = '0 0 12px 0';
            bar.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <select id="dados-op-filter-matriz" class="dados-op-filter"><option value="">Matriz</option></select>
            <select id="dados-op-filter-gerente" class="dados-op-filter"><option value="">Gerente</option></select>
            <select id="dados-op-filter-svc" class="dados-op-filter"><option value="">SVC</option></select>
            <button id="dados-op-clear-filters" class="btn" style="padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fafafa;">Limpar</button>
          </div>`;
        }        const page = document.getElementById('dados-op-page');
        if (page) {
            if (bar.parentNode !== page) page.prepend(bar);
        } else if (ui.resultContainer && ui.resultContainer.parentNode) {
            ui.resultContainer.parentNode.insertBefore(bar, ui.resultContainer);
        }        ui.matrizSelect = document.getElementById('dados-op-filter-matriz');
        ui.gerenteSelect = document.getElementById('dados-op-filter-gerente');
        ui.svcSelect = document.getElementById('dados-op-filter-svc');
        ui.clearBtn = document.getElementById('dados-op-clear-filters');
    }    if (ui.matrizSelect) ui.matrizSelect.onchange = () => {
        state.filters.matriz = ui.matrizSelect.value || '';
        recomputeAndSyncFilterOptions();
        generateReport();
    };
    if (ui.gerenteSelect) ui.gerenteSelect.onchange = () => {
        state.filters.gerente = ui.gerenteSelect.value || '';
        recomputeAndSyncFilterOptions();
        generateReport();
    };
    if (ui.svcSelect) ui.svcSelect.onchange = () => {
        state.filters.svc = ui.svcSelect.value || '';
        recomputeAndSyncFilterOptions();
        generateReport();
    };
    if (ui.clearBtn) ui.clearBtn.onclick = () => {
        state.filters = {matriz: '', gerente: '', svc: ''};
        recomputeAndSyncFilterOptions();
        generateReport();
    };
}function populateSelect(select, items, placeholder, keepValue) {
    if (!select) return;
    const prev = keepValue ? select.value : '';
    select.innerHTML = '';
    const base = document.createElement('option');
    base.value = '';
    base.textContent = placeholder;
    select.appendChild(base);
    items.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
    });
    if (prev && items.includes(prev)) select.value = prev; else select.value = '';
}function recomputeAndSyncFilterOptions() {
    const allowed = computeCascadingOptions(state.filters, state.universe, state.mappings);
    populateSelect(ui.matrizSelect, allowed.matrizes, 'Matriz', true);
    populateSelect(ui.gerenteSelect, allowed.gerentes, 'Gerentes', true);
    populateSelect(ui.svcSelect, allowed.svcs, 'SVC', true);
    if (state.filters.matriz && !allowed.matrizes.includes(state.filters.matriz)) {
        state.filters.matriz = '';
        ui.matrizSelect.value = '';
    }
    if (state.filters.gerente && !allowed.gerentes.includes(state.filters.gerente)) {
        state.filters.gerente = '';
        ui.gerenteSelect.value = '';
    }
    if (state.filters.svc && !allowed.svcs.includes(state.filters.svc)) {
        state.filters.svc = '';
        ui.svcSelect.value = '';
    }
}function showDetailsModal(svc, coluna) {
    const details = (svc === 'TODAS')
        ? state.totalGeralResults?.[coluna]
        : state.detailedResults.get(svc)?.get(coluna);    if (!details) return;    const old = document.getElementById('dados-op-details-modal');
    if (old) old.remove();    const modal = document.createElement('div');
    modal.id = 'dados-op-details-modal';    modal.style.cssText = `
        position: fixed; 
        inset: 0; 
        background: rgba(0, 0, 0, .35); 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        z-index: 10000;
        font-family: sans-serif;
    `;    const contentHtml = (details.pendentes.length === 0)
        ? '<p style="text-align:center; color:#6b7280; padding:20px; font-size:13px;">Nenhum colaborador com pendência neste campo.</p>'
        : `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding: 0 4px;">
         <span style="font-size:12px; color:#56607f; font-weight:600;">Total: <strong style="color:#003369;">${details.total}</strong></span>
         <span style="font-size:12px; color:#56607f; font-weight:600;">Pendentes: <strong style="color:#e55353;">${details.pendentes.length}</strong></span>
      </div>
      <div style="margin-bottom:12px; background:#e8f7ff; border:1px solid #bae6fd; border-radius:8px; padding:10px; display:flex; gap:8px; align-items:center;">
        <span style="font-size:16px;">ℹ️</span>
        <span style="font-size:12px; color:#003369; font-weight:600;">Dê <b>dois cliques</b> no nome ou clique em <b>Editar</b> para corrigir.</span>
      </div>
      <ul id="lista-pendencias" class="names-list" style="
          list-style:none; padding:0; margin:0; 
          max-height:300px; overflow-y:auto; 
          display:flex; flex-direction:column; gap:6px;
          border: 1px solid #e7ebf4; border-radius: 8px; padding: 8px; background: #fafbff;
      ">
        ${details.pendentes.map(p => `
            <li class="pendencia-item" 
                data-nome="${p.Nome}" 
                style="
                    padding: 8px 12px; 
                    background: #fff; 
                    border: 1px solid #e8ecf3; 
                    border-radius: 8px; 
                    display: flex; justify-content: space-between; align-items: center;
                    cursor: pointer; transition: all 0.2s; user-select: none; /* Evita seleção de texto no duplo clique */
                "
                onmouseover="this.style.borderColor='#02B1EE'; this.style.boxShadow='0 2px 5px rgba(2,177,238,0.1)'"
                onmouseout="this.style.borderColor='#e8ecf3'; this.style.boxShadow='none'"
            >
                <span style="font-weight:600; color:#242c4c; font-size:13px;">${p.Nome}</span>
                <button type="button" class="btn-editar-item" style="
                    background: #f0f7ff; color: #02B1EE; border: none; 
                    padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;
                    cursor: pointer; transition: background 0.2s;
                " onmouseover="this.style.background='#02B1EE'; this.style.color='#fff'" onmouseout="this.style.background='#f0f7ff'; this.style.color='#02B1EE'">
                    Editar ✏️
                </button>
            </li>
        `).join('')}
      </ul>
    `;    modal.innerHTML = `
    <div class="modal-card" style="
        background: #fff; 
        border-radius: 12px; 
        box-shadow: 0 14px 36px rgba(0, 0, 0, .18); 
        padding: 20px 24px; 
        width: 100%; 
        max-width: 600px; 
        border: 1px solid #e7ebf4;
        display: flex; flex-direction: column;
    ">
      <h3 style="
        color: #003369; 
        font-weight: 700; 
        border-bottom: 1px solid #e7ebf4; 
        padding-bottom: 8px; 
        margin: 0 0 12px 0; 
        font-size: 16px; 
        display: flex; justify-content: space-between; align-items: center;
      ">
        <span>Pendências: "${coluna}"</span>
        <button data-close-modal style="background:none; border:none; color:#6b7280; font-size:20px; cursor:pointer;">&times;</button>
      </h3>      <div style="flex:1; overflow:hidden;">
        ${contentHtml}
      </div>      <div class="form-actions" style="
        margin-top: 16px; 
        display: flex; 
        justify-content: flex-end; 
        gap: 10px; 
        padding-top: 12px; 
        border-top: 1px solid #e7ebf4;
      ">
        <button type="button" data-close-modal style="
            padding: 8px 16px; 
            border: none; 
            border-radius: 26px; 
            font-size: 13px; 
            font-weight: 700; 
            cursor: pointer; 
            background-color: #e4e6eb; 
            color: #4b4f56;
            transition: all 0.2s ease;
        " onmouseover="this.style.backgroundColor='#d8dadf'" onmouseout="this.style.backgroundColor='#e4e6eb'">
            Fechar
        </button>
      </div>
    </div>
  `;    document.body.appendChild(modal);    const triggerEdit = (nome) => {
        if (!nome) return;        if (typeof garantirModalEdicaoAtivo === 'function') {
            garantirModalEdicaoAtivo();
        }        document.dispatchEvent(new CustomEvent('open-edit-modal', {detail: {nome: nome}}));        setTimeout(() => {
            const editModal = document.getElementById('editModal');
            if (editModal) {
                editModal.style.zIndex = '12000';
            }
        }, 50);
    };    const lista = modal.querySelector('#lista-pendencias');
    if (lista) {
        lista.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-editar-item');
            if (btn) {
                e.stopPropagation();
                const item = btn.closest('.pendencia-item');
                const nome = item?.dataset?.nome;
                triggerEdit(nome);
            }
        });        lista.addEventListener('dblclick', (e) => {
            const item = e.target.closest('.pendencia-item');
            if (item) {
                const nome = item.dataset.nome;
                triggerEdit(nome);
            }
        });
    }    modal.querySelectorAll('[data-close-modal]').forEach(el => {
        el.addEventListener('click', () => modal.remove());
    });
}function renderTable(svcs, colunas, results, totalGeralResults) {
    if (!ui.resultContainer) return;
    const displaySvc = (svc) => {
        const matriz = state?.mappings?.svcToMatriz?.get?.(svc) || '';
        return matriz ? `(${svc}) ${matriz}` : svc;
    };    const colunasDisplay = {
        'Gestor': 'Gestor ⚠️',
        'DSR': 'DSR ⚠️',
        'Escala': 'Escala ⚠️',
        'Cargo': 'Cargo ⚠️',
        'ID GROOT': 'ID GROOT',
        'LDAP': 'LDAP',
        'Data de admissão': 'Dt Admissão ⚠️',
        'MatriculaKN': 'Matricula KN ⚠️',
        'Data de nascimento': 'Dt Nascim.',
        'Genero': 'Gênero',
    };    const headerHtml =
        `<tr><th>SVC</th>${colunas.map(col => `<th>${colunasDisplay[col] || col}</th>`).join('')}<th>Total</th></tr>`;
    let totalRowHtml = '';
    if (totalGeralResults && Object.keys(totalGeralResults).length > 0 && totalGeralResults.totalGeral !== undefined) {
        const totalPercent = totalGeralResults.totalGeral || 0;
        const totalStatusClass = getTotalStatusClass(Math.round(totalPercent));
        const totalCellHtml = `
            <td class="${totalStatusClass}" style="font-weight:bold;font-size:14px;text-align:center;">
            ${totalPercent.toFixed(0)}%
            </td>
        `;
        totalRowHtml = `
            <tr class="total-geral-row" style="background-color: #f0f3f5; font-weight: bold; border-bottom: 2px solid #ccc;">
            <td>TODAS AS OPERAÇÕES</td>
            ${colunas.map(col => {
            const data = totalGeralResults[col];
            if (!data) return '<td class="status-na" style="text-align:center;">N/A</td>';
            const percentual = data.percentual;
            const statusClass = getStatusClass(percentual);
            const podeClicar = percentual < 100 && data.pendentes.length > 0;
            const title = podeClicar ? 'Duplo clique para ver os pendentes' : '100% preenchido';
            return `
                <td data-svc="TODAS" data-coluna="${col}" class="${statusClass}" title="${title}" style="text-align:center;">
                    ${percentual.toFixed(0)}%
                </td>`;
        }).join('')}
            ${totalCellHtml}
            </tr>
        `;
    }
    const bodyHtml = svcs.map(svc => {
        const totalPercent = results[svc]?.totalGeral || 0;
        const totalStatusClass = getTotalStatusClass(Math.round(totalPercent));
        const totalCellHtml = `
      <td class="${totalStatusClass}" style="font-weight:bold;font-size:14px;text-align:center;">
        ${totalPercent.toFixed(0)}%
      </td>
    `;
        return `
      <tr>
        <td>${displaySvc(svc)}</td>
        ${colunas.map(col => {
            const data = results[svc]?.[col];
            if (!data) return '<td class="status-na" style="text-align:center;">N/A</td>';
            const percentual = data.percentual;
            const statusClass = getStatusClass(percentual);
            const podeClicar = percentual < 100 && data.pendentes.length > 0;
            const title = podeClicar ? 'Duplo clique para ver os pendentes' : '100% preenchido';
            return `
            <td data-svc="${svc}" data-coluna="${col}" class="${statusClass}" title="${title}" style="text-align:center;">
              ${percentual.toFixed(0)}%
            </td>`;
        }).join('')}
        ${totalCellHtml}
      </tr>
    `;
    }).join('');
    ui.resultContainer.innerHTML = `
    <div class="table-container">
      <table class="main-table">
        <thead>${headerHtml}</thead>
        <tbody>${totalRowHtml}${bodyHtml}</tbody>
      </table>
    </div>
  `;
    const table = ui.resultContainer.querySelector('.main-table');
    if (table) {
        table.addEventListener('dblclick', (event) => {
            const cell = event.target.closest('td[data-svc]');
            if (!cell || !cell.dataset.coluna) return;
            showDetailsModal(cell.dataset.svc, cell.dataset.coluna);
        });
    }
}async function generateReport() {
    if (ui?.loader) ui.loader.style.display = 'flex';
    if (ui?.resultContainer) ui.resultContainer.innerHTML = `<p class="p-4 text-center">Gerando relatório...</p>`;
    try {
        const {colaboradores, svcToGerente, svcToMatriz, matrizes, gerentes, svcs} = await fetchDataCached();
        state.universe.svcs = svcs;
        state.universe.matrizes = matrizes;
        state.universe.gerentes = gerentes;
        state.mappings.svcToGerente = svcToGerente;
        state.mappings.svcToMatriz = svcToMatriz;
        ensureFiltersBar();
        recomputeAndSyncFilterOptions();
        const filtrados = applyUserFilters(colaboradores, state.filters, state.mappings);
        const {svcs: svcsGroup, results, colunas, totalGeralResults} = processDataQuality(filtrados);
        if (svcsGroup.length > 0) {
            svcsGroup.sort((a, b) => {
                const avgA = results[a]?.totalGeral || 0;
                const avgB = results[b]?.totalGeral || 0;
                if (avgA !== avgB) return avgB - avgA;
                const count100A = colunas.filter(col => (results[a][col]?.percentual || 0) === 100).length;
                const count100B = colunas.filter(col => (results[b][col]?.percentual || 0) === 100).length;
                if (count100A !== count100B) return count100B - count100A;
                return a.localeCompare(b);
            });
        }
        if (filtrados.length === 0) {
            ui.resultContainer.innerHTML = '<p class="p-4 text-center">Nenhum colaborador encontrado para o filtro selecionado.</p>';
        } else {
            renderTable(svcsGroup, colunas, results, totalGeralResults);
        }
    } catch (error) {
        console.error('Erro ao gerar relatório de dados operacionais:', error);
        if (ui?.resultContainer) {
            ui.resultContainer.innerHTML = `<p class="p-4 text-center text-red-500">Falha ao gerar relatório: ${error.message}</p>`;
        }
    } finally {
        if (ui?.loader) ui.loader.style.display = 'none';
    }
}export async function getRankingData(filters = {}) {    const {colaboradores, svcToMatriz, svcToGerente} = await fetchDataCached();    const filtersToApply = {
        matriz: filters.matriz || state.filters.matriz || '',
        gerente: filters.gerencia || filters.gerente || state.filters.gerente || '',
        svc: filters.svc || state.filters.svc || ''
    };    const mappings = { svcToMatriz, svcToGerente };    const filtrados = applyUserFilters(colaboradores, filtersToApply, mappings);    const {svcs, results} = processDataQuality(filtrados);    const ranking = [];
    svcs.forEach(svc => {        const val = results[svc]?.totalGeral || 0;        const matriz = svcToMatriz.get(svc) || '';
        const label = matriz ? `${svc} (${matriz})` : svc;        ranking.push({label, value: Math.round(val)});
    });    ranking.sort((a, b) => b.value - a.value);    return {
        labels: ranking.map(r => r.label),
        values: ranking.map(r => r.value)
    };
}export function init() {
    if (state.mounted) return;
    if (document.getElementById('editModal')) {
        garantirModalEdicaoAtivo();
    }
    ui = {
        resultContainer: document.getElementById('dados-op-result'),
        loader: document.getElementById('dados-op-loader'),
        matrizSelect: null,
        gerenteSelect: null,
        svcSelect: null,
        clearBtn: null,
    };
    const evts = ['hc-refresh', 'colaborador-added', 'colaborador-updated', 'colaborador-removed', 'dadosop-invalidate'];
    const matrizesPermitidas = getMatrizesPermitidas();
    const key = keyFromMatrizes(matrizesPermitidas);
    evts.forEach(name => {
        const handler = () => {
            invalidateCache([key]);
            generateReport();
        };
        window.addEventListener(name, handler);
        _listeners.push(() => window.removeEventListener(name, handler));
    });
    state.mounted = true;
    ensureFiltersBar();
    recomputeAndSyncFilterOptions();
    generateReport();
}export function destroy() {
    const modal = document.getElementById('dados-op-details-modal');
    if (modal) modal.remove();
    try {
        _listeners.forEach(off => off());
    } catch {
    }
    _listeners.length = 0;
    state.mounted = false;
}