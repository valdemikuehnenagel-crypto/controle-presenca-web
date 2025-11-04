import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';let ui;const CACHE_TTL_MS = 10 * 60_000;
const _cache = new Map();
const _inflight = new Map();
const _listeners = [];function keyFromMatrizes(mp) {
    const part = Array.isArray(mp) && mp.length ? [...mp].sort().join('|') : 'ALL';
    return `dados-op:colaboradores:${part}:ativos`;
}function fetchOnce(key, loader, ttl = CACHE_TTL_MS) {
    const now = Date.now();
    const hit = _cache.get(key);
    if (hit && (now - hit.ts) < hit.ttl) return Promise.resolve(hit.value);
    if (_inflight.has(key)) return _inflight.get(key);    const p = (async () => {
        try {
            const val = await loader();
            _cache.set(key, {ts: Date.now(), ttl, value: val});
            return val;
        } finally {
            _inflight.delete(key);
        }
    })();    _inflight.set(key, p);
    return p;
}function invalidateCache(keys) {
    if (!keys || !keys.length) {
        _cache.clear();
        return;
    }
    keys.forEach(k => _cache.delete(k));
}const state = {
    mounted: false,
    detailedResults: new Map(),    filters: {
        matriz: '',
        gerente: '',
        svc: '',
    },    universe: {
        svcs: [],
        matrizes: [],
        gerentes: [],
    },    mappings: {
        svcToGerente: new Map(),
        svcToMatriz: new Map(),
    },
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
    if (matrizesPermitidas && matrizesPermitidas.length) {
        q = q.in('MATRIZ', matrizesPermitidas);
    }    const rows = await fetchAllPages(q);    const svcToGerente = new Map();
    const svcToMatriz = new Map();
    const optMatrizes = new Set();
    const optGerentes = new Set();
    const optSvcs = new Set();    (rows || []).forEach(r => {
        const svc = String(r.SERVICE || '').trim();
        const matriz = String(r.MATRIZ || '').trim();
        const gerente = String(r.GERENCIA || '').trim();
        if (!svc) return;        svcToGerente.set(svc, gerente || '');
        svcToMatriz.set(svc, matriz || '');        optSvcs.add(svc);
        if (matriz) optMatrizes.add(matriz);
        if (gerente) optGerentes.add(gerente);
    });    return {
        svcToGerente,
        svcToMatriz,
        matrizes: [...optMatrizes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        gerentes: [...optGerentes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        svcs: [...optSvcs].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
}async function fetchDataCached() {
    const matrizesPermitidas = getMatrizesPermitidas();
    const key = keyFromMatrizes(matrizesPermitidas);    return fetchOnce(key, async () => {        let colabQuery = supabase
            .from('Colaboradores')
            .select('Nome, SVC, "Data de admissão", LDAP, "ID GROOT", Gestor, MATRIZ, Cargo, Escala, DSR, Genero')
            .eq('Ativo', 'SIM');         if (matrizesPermitidas && matrizesPermitidas.length) {
            colabQuery = colabQuery.in('MATRIZ', matrizesPermitidas);
        }        const colaboradores = await fetchAllPages(colabQuery);
        colaboradores.sort((a, b) => String(a?.Nome || '').localeCompare(String(b?.Nome || ''), 'pt-BR'));        const maps = await fetchMatrizesMappings();        return {colaboradores, ...maps};
    });
}function computeCascadingOptions(current, universe, mappings) {
    const selMatriz = String(current.matriz || '').trim();
    const selGerente = String(current.gerente || '').trim();
    const selSvc = String(current.svc || '').trim();    const {svcs} = universe;
    const {svcToGerente, svcToMatriz} = mappings;    const allowedSvcs = svcs.filter(svc => {
        const m = String(svcToMatriz.get(svc) || '').trim();
        const g = String(svcToGerente.get(svc) || '').trim();
        if (selMatriz && m !== selMatriz) return false;
        if (selGerente && g !== selGerente) return false;
        if (selSvc && svc !== selSvc) return false;
        return true;
    });    const allowedMatrizes = new Set();
    const allowedGerentes = new Set();
    allowedSvcs.forEach(svc => {
        const m = String(svcToMatriz.get(svc) || '').trim();
        const g = String(svcToGerente.get(svc) || '').trim();
        if (m) allowedMatrizes.add(m);
        if (g) allowedGerentes.add(g);
    });    return {
        svcs: allowedSvcs,
        matrizes: [...allowedMatrizes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
        gerentes: [...allowedGerentes].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
}function applyUserFilters(colaboradores, filters, mappings) {
    const fMatriz = String(filters.matriz || '').trim().toUpperCase();
    const fGerente = String(filters.gerente || '').trim().toUpperCase();
    const fSvc = String(filters.svc || '').trim().toUpperCase();    const {svcToGerente, svcToMatriz} = mappings;    return colaboradores.filter(c => {
        const svc = String(c.SVC || '').trim();
        const matrizDoSvc = String(svcToMatriz.get(svc) || '').trim().toUpperCase();
        const gerenteDoSvc = String(svcToGerente.get(svc) || '').trim().toUpperCase();        if (fMatriz && matrizDoSvc !== fMatriz) return false;
        if (fGerente && gerenteDoSvc !== fGerente) return false;
        if (fSvc && svc.toUpperCase() !== fSvc) return false;        return true;
    });
}function processDataQuality(colaboradores) {
    state.detailedResults.clear();    const svcs = [...new Set(colaboradores.map(c => c.SVC).filter(Boolean))].sort();    const colunasParaVerificar = [
        'ID GROOT', 'LDAP', 'Data de admissão', 'Gestor', 'Cargo', 'DSR', 'Escala', 'Genero'
    ];    const results = {};
    for (const svc of svcs) {
        results[svc] = {};
        state.detailedResults.set(svc, new Map());        const colaboradoresSVC = colaboradores.filter(c => c.SVC === svc);
        const totalColabsSVC = colaboradoresSVC.length;
        if (totalColabsSVC === 0) continue;        let percentualTotalSoma = 0;        for (const coluna of colunasParaVerificar) {
            const pendentes = colaboradoresSVC.filter(c => {
                const valor = c[coluna];
                return valor === null || valor === undefined || String(valor).trim() === '';
            });
            const preenchidosCount = totalColabsSVC - pendentes.length;
            const percentual = (preenchidosCount / totalColabsSVC) * 100;            results[svc][coluna] = {percentual, pendentes};
            percentualTotalSoma += percentual;            if (!state.detailedResults.get(svc).has(coluna)) {
                state.detailedResults.get(svc).set(coluna, {pendentes, total: totalColabsSVC});
            }
        }        results[svc].totalGeral = percentualTotalSoma / colunasParaVerificar.length;
    }    return {svcs, results, colunas: colunasParaVerificar};
}function getStatusClass(percentual) {
    if (percentual === 100) return 'status-ok';
    if (percentual > 0) return 'status-pendente';
    if (percentual === 0) return 'status-nok';
    return 'status-na';
}function getTotalStatusClass(percentual) {
    if (percentual === 100) return 'status-ok';
    if (percentual >= 90) return 'status-pendente';
    return 'status-nok';
}function ensureFiltersBar() {
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
        <select id="dados-op-filter-matriz" class="dados-op-filter">
          <option value="">Matriz</option>
        </select>
        <select id="dados-op-filter-gerente" class="dados-op-filter">
          <option value="">Gerente</option>
        </select>
        <select id="dados-op-filter-svc" class="dados-op-filter">
          <option value="">SVC</option>
        </select>
        <button id="dados-op-clear-filters" class="btn" style="padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fafafa;">
          Limpar
        </button>
      </div>
    `;
    }    const page = document.getElementById('dados-op-page');
    if (page) {
        if (bar.parentNode !== page) page.prepend(bar);
        else if (page.firstElementChild !== bar) page.prepend(bar);
    } else if (ui?.resultContainer?.parentNode) {
        const parent = ui.resultContainer.parentNode;
        if (bar.parentNode !== parent) parent.insertBefore(bar, ui.resultContainer);
    } else {
        document.body.prepend(bar);
    }    ui.matrizSelect = document.getElementById('dados-op-filter-matriz');
    ui.gerenteSelect = document.getElementById('dados-op-filter-gerente');
    ui.svcSelect = document.getElementById('dados-op-filter-svc');
    ui.clearBtn = document.getElementById('dados-op-clear-filters');    ui.matrizSelect?.addEventListener('change', () => {
        state.filters.matriz = ui.matrizSelect.value || '';
        recomputeAndSyncFilterOptions();
        generateReport();
    });
    ui.gerenteSelect?.addEventListener('change', () => {
        state.filters.gerente = ui.gerenteSelect.value || '';
        recomputeAndSyncFilterOptions();
        generateReport();
    });
    ui.svcSelect?.addEventListener('change', () => {
        state.filters.svc = ui.svcSelect.value || '';
        recomputeAndSyncFilterOptions();
        generateReport();
    });
    ui.clearBtn?.addEventListener('click', () => {
        state.filters = {matriz: '', gerente: '', svc: ''};
        recomputeAndSyncFilterOptions();
        generateReport();
    });
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
    if (prev && items.includes(prev)) select.value = prev;
    else select.value = '';
}function recomputeAndSyncFilterOptions() {
    const allowed = computeCascadingOptions(state.filters, state.universe, state.mappings);    populateSelect(ui.matrizSelect, allowed.matrizes, 'Matriz', true);
    populateSelect(ui.gerenteSelect, allowed.gerentes, 'Gerentes', true);
    populateSelect(ui.svcSelect, allowed.svcs, 'SVC', true);    if (state.filters.matriz && !allowed.matrizes.includes(state.filters.matriz)) {
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
    const details = state.detailedResults.get(svc)?.get(coluna);
    if (!details) return;    const old = document.getElementById('dados-op-details-modal');
    if (old) old.remove();    const modal = document.createElement('div');
    modal.id = 'dados-op-details-modal';
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[99]';
    const contentHtml = (details.pendentes.length === 0)
        ? '<p>Nenhum colaborador com pendência neste campo.</p>'
        : `
      <p class="mb-2">Total de colaboradores no SVC: <strong>${details.total}</strong> | Pendentes: <strong>${details.pendentes.length}</strong></p>
      <ul class="details-list" style="list-style:none;padding-left:0;margin:0;max-height:60vh;overflow:auto;">
        ${details.pendentes.map(p => `<li style="padding:6px 0;border-bottom:1px dashed #e5e7eb;"><strong>${p.Nome}</strong></li>`).join('')}
      </ul>
    `;
    modal.innerHTML = `
    <div class="container !h-auto !w-auto max-w-lg" style="background:#fff;border-radius:12px;padding:16px;">
      <h3 class="mb-4">Pendências de "${coluna}" em ${svc}</h3>
      <div class="max-h-[60vh] overflow-y-auto pr-2">${contentHtml}</div>
      <div class="form-actions" style="display:flex;justify-content:flex-end;margin-top:12px;gap:8px;">
        <button type="button" class="btn-cancelar" data-close-modal style="padding:8px 12px;border:1px solid #ddd;border-radius:8px;background:#fafafa;">Fechar</button>
      </div>
    </div>
  `;
    document.body.appendChild(modal);
    modal.querySelector('[data-close-modal]').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}function renderTable(svcs, colunas, results) {
  if (!ui.resultContainer) return;  const displaySvc = (svc) => {
    const matriz = state?.mappings?.svcToMatriz?.get?.(svc) || '';
    return matriz ? `(${svc}) ${matriz}` : svc;
  };  const colunasDisplay = {
    'ID GROOT': 'ID GROOT',
    'LDAP': 'LDAP',
    'Data de admissão': 'Dt Admissão',
    'Gestor': 'Gestor',
    'Cargo': 'Cargo',
    'DSR': 'DSR',
    'Escala': 'Escala',
    'Genero': 'Gênero',
  };  const headerHtml =
    `<tr><th>SVC</th>${colunas.map(col => `<th>${colunasDisplay[col] || col}</th>`).join('')}<th>Total</th></tr>`;  const bodyHtml = svcs.map(svc => {
    const totalPercent = results[svc]?.totalGeral || 0;
    const totalStatusClass = getTotalStatusClass(Math.round(totalPercent));
    const totalCellHtml = `
      <td class="${totalStatusClass}" style="font-weight:bold;font-size:14px;text-align:center;">
        ${totalPercent.toFixed(0)}%
      </td>
    `;    return `
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
  }).join('');  ui.resultContainer.innerHTML = `
    <div class="table-container">
      <table class="main-table">
        <thead>${headerHtml}</thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;  const table = ui.resultContainer.querySelector('.main-table');
  if (table) {
    table.addEventListener('dblclick', (event) => {
      const cell = event.target.closest('td[data-svc]');
      if (!cell || !cell.dataset.coluna) return;
      showDetailsModal(cell.dataset.svc, cell.dataset.coluna);
    });
  }
}async function generateReport() {
    if (ui?.loader) ui.loader.style.display = 'flex';
    if (ui?.resultContainer) ui.resultContainer.innerHTML = `<p class="p-4 text-center">Gerando relatório...</p>`;    try {
        const {colaboradores, svcToGerente, svcToMatriz, matrizes, gerentes, svcs} = await fetchDataCached();        state.universe.svcs = svcs;
        state.universe.matrizes = matrizes;
        state.universe.gerentes = gerentes;
        state.mappings.svcToGerente = svcToGerente;
        state.mappings.svcToMatriz = svcToMatriz;        ensureFiltersBar();
        recomputeAndSyncFilterOptions();        const filtrados = applyUserFilters(colaboradores, state.filters, state.mappings);        const {svcs: svcsGroup, results, colunas} = processDataQuality(filtrados);        if (svcsGroup.length > 0) {
            svcsGroup.sort((a, b) => {
                const avgA = results[a]?.totalGeral || 0;
                const avgB = results[b]?.totalGeral || 0;
                if (avgA !== avgB) return avgB - avgA;                const count100A = colunas.filter(col => (results[a][col]?.percentual || 0) === 100).length;
                const count100B = colunas.filter(col => (results[b][col]?.percentual || 0) === 100).length;
                if (count100A !== count100B) return count100B - count100A;                return a.localeCompare(b);
            });
        }        if (!svcsGroup.length) {
            ui.resultContainer.innerHTML = '<p class="p-4 text-center">Nenhum SVC encontrado para o filtro selecionado.</p>';
        } else {
            renderTable(svcsGroup, colunas, results);
        }
    } catch (error) {
        console.error('Erro ao gerar relatório de dados operacionais:', error);
        if (ui?.resultContainer) {
            ui.resultContainer.innerHTML = `<p class="p-4 text-center text-red-500">Falha ao gerar relatório: ${error.message}</p>`;
        }
    } finally {
        if (ui?.loader) ui.loader.style.display = 'none';
    }
}export function init() {
    if (state.mounted) return;    ui = {
        resultContainer: document.getElementById('dados-op-result'),
        loader: document.getElementById('dados-op-loader'),
        matrizSelect: null,
        gerenteSelect: null,
        svcSelect: null,
        clearBtn: null,
    };    const sessionString = localStorage.getItem('userSession');
    let userNivel = null;
    if (sessionString) {
        try {
            const userData = JSON.parse(sessionString);
            userNivel = (userData?.Nivel || '').toLowerCase();
        } catch (e) {
            console.error('Erro ao ler userSession:', e);
        }
    }
    if (userNivel !== 'administrador') {
        console.warn(`Acesso ao Painel Gerencial bloqueado. Nível detectado: [${userNivel || 'Nenhum'}]`);
        if (ui.resultContainer) {
            ui.resultContainer.innerHTML = `
        <div style="padding: 2rem; text-align: center;">
          <h2 style="color: #dc3545; font-size: 1.5rem;">Acesso Bloqueado</h2>
          <p style="font-size: 1.1rem; margin-top: 0.5rem;">
            Apenas usuários com nível "Administrador" podem acessar esta página.
          </p>
          <p style="color: #6c757d; margin-top: 1rem;">
            (Nível detectado: <strong>${userNivel ? userNivel.charAt(0).toUpperCase() + userNivel.slice(1) : 'Nenhum'}</strong>)
          </p>
        </div>
      `;
        }
        if (ui.loader) ui.loader.style.display = 'none';
        return;
    }    const evts = ['hc-refresh', 'colaborador-added', 'colaborador-updated', 'colaborador-removed', 'dadosop-invalidate'];
    const matrizesPermitidas = getMatrizesPermitidas();
    const key = keyFromMatrizes(matrizesPermitidas);
    evts.forEach(name => {
        const handler = () => {
            invalidateCache([key]);
            generateReport();
        };
        window.addEventListener(name, handler);
        _listeners.push(() => window.removeEventListener(name, handler));
    });    state.mounted = true;    ensureFiltersBar();
    recomputeAndSyncFilterOptions();
    generateReport();
}export function destroy() {
    const modal = document.getElementById('dados-op-details-modal');
    if (modal) modal.remove();    try {
        _listeners.forEach(off => off());
    } catch {
    }
    _listeners.length = 0;    state.mounted = false;
}
