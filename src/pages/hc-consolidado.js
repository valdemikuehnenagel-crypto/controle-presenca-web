import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';
import './hc-diario.js';
import './relatorio-abs.js';
import './hc-analise-abs.js';
import './indice.js';

const WEEK_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
const WEEK_KEYS = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];

const norm = v => String(v ?? '').trim().toUpperCase();
const normalizeWeekdayPT = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Ç/g, 'C');

const escapeHtml = s => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');


const isActive = c => norm(c.Ativo || 'SIM') === 'SIM';
const onlyActiveAux = a => (a || []).filter(c => isActive(c) && norm(c.Cargo) === 'AUXILIAR');
const onlyActiveConf = a => (a || []).filter(c => isActive(c) && norm(c.Cargo) === 'CONFERENTE');

const splitByTurno = a => ({
    T1: a.filter(c => norm(c.Escala) === 'T1'),
    T2: a.filter(c => norm(c.Escala) === 'T2'),
    T3: a.filter(c => norm(c.Escala) === 'T3'),
});

const uniqueNonEmptySorted = v =>
    Array.from(new Set((v || []).map(x => String(x ?? '')).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));

const toISO = v => String(v || '').slice(0, 10);
const fmtBR = iso => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

let _allColabsCache = [];
const _filters = {matriz: '', svc: ''};

const _deslState = {loaded: false, rows: [], search: '', escala: '', motivo: ''};
const _feriasState = {loaded: false, rows: [], search: '', escala: '', status: ''};

export function destroy() {
    const buildFns = [
        window.buildHCIndice,
        window.buildHCAnaliseABS,
        window.buildHCRelatorio,
        window.buildHCDiario
    ];
    buildFns.forEach(fn => {
        if (fn && typeof fn.resetState === 'function') {
            fn.resetState();
        }
    });
    console.log('Estado do HC Consolidado destruído, pronto para recarregar.');
}


function buildWeeklyRowsForCargo(arr) {
    const feriasConst = (arr || []).filter(c => norm(c.Ferias) === 'SIM').length;

    const dsrByDay = {};
    WEEK_KEYS.forEach(d => dsrByDay[d] = 0);
    (arr || []).forEach(c => {
        const d = normalizeWeekdayPT(c.DSR);
        if (WEEK_KEYS.includes(d)) dsrByDay[d]++;
    });

    const presentesByDay = {};
    const total = (arr || []).length;
    WEEK_KEYS.forEach(d => {
        presentesByDay[d] = Math.max(0, total - dsrByDay[d] - feriasConst);
    });

    return {feriasConst, dsrByDay, presentesByDay};
}


function composeTableDataForTurn(auxArr, confArr) {
    const aux = buildWeeklyRowsForCargo(auxArr);
    const conf = buildWeeklyRowsForCargo(confArr);

    const totalQuadroByDay = {};
    WEEK_KEYS.forEach(k => {
        totalQuadroByDay[k] =
            (aux.presentesByDay[k] || 0) +
            (conf.presentesByDay[k] || 0) +
            (aux.dsrByDay[k] || 0) +
            (conf.dsrByDay[k] || 0) +
            (aux.feriasConst || 0) +
            (conf.feriasConst || 0);
    });

    const dsrTotal = {};
    WEEK_KEYS.forEach(k => {
        dsrTotal[k] = (aux.dsrByDay[k] || 0) + (conf.dsrByDay[k] || 0);
    });

    const feriasTotal = aux.feriasConst + conf.feriasConst;

    return [
        {label: 'TOTAL QUADRO', values: totalQuadroByDay},
        {label: 'PRESENTE', values: aux.presentesByDay},
        {label: 'CONFERENTE', values: conf.presentesByDay},
        {label: 'DSR', values: dsrTotal}, // <-- Usando o total de DSR
        {label: 'FÉRIAS', values: WEEK_KEYS.reduce((a, d) => (a[d] = feriasTotal, a), {})}, // <-- Usando o total de Férias
    ];
}


function sumRows(a, b) {
    const mb = new Map(b.map(r => [r.label, r]));
    return a.map(r => {
        const rb = mb.get(r.label), vals = {};
        WEEK_KEYS.forEach(k => vals[k] = Number(r.values[k] || 0) + Number(rb?.values[k] || 0));
        return {label: r.label, values: vals};
    });
}

function toTableHTML(title, rows) {
    const thead = `
        <thead>
            <tr>
                <th class="align-left">${title}</th> 
                ${WEEK_LABELS.map(l => `<th>${l}</th>`).join('')}
            </tr>
        </thead>`;

    const tbody = `
        <tbody>
            ${rows.map(r => `
                <tr class="${r.label === 'TOTAL QUADRO' ? 'hc-total-row' : ''}">
                    <td class="align-left">${r.label}</td> 
                    ${WEEK_KEYS.map(k => `<td>${r.values[k]}</td>`).join('')}
                </tr>
            `).join('')}
        </tbody>`;

    return thead + tbody;
}


function renderWeeklyTables(all) {
    const filtered = all.filter(c => {
        if (_filters.matriz && norm(c.MATRIZ) !== norm(_filters.matriz)) return false;
        if (_filters.svc && norm(c.SVC) !== norm(_filters.svc)) return false;
        return true;
    });

    const aux = onlyActiveAux(filtered);
    const conf = onlyActiveConf(filtered);

    const byAux = splitByTurno(aux);
    const byConf = splitByTurno(conf);

    const t1 = composeTableDataForTurn(byAux.T1, byConf.T1);
    const t2 = composeTableDataForTurn(byAux.T2, byConf.T2);
    const t3 = composeTableDataForTurn(byAux.T3, byConf.T3);
    const geral = sumRows(sumRows(t1, t2), t3);

    const t1El = document.getElementById('hc-t1');
    const t2El = document.getElementById('hc-t2');
    const t3El = document.getElementById('hc-t3');
    const gEl = document.getElementById('hc-geral');

    if (t1El) t1El.innerHTML = toTableHTML('TURNO 1', t1);
    if (t2El) t2El.innerHTML = toTableHTML('TURNO 2', t2);
    if (t3El) t3El.innerHTML = toTableHTML('TURNO 3', t3);
    if (gEl) gEl.innerHTML = toTableHTML('QUADRO GERAL', geral);
}

function populateFilterSelects(colabs) {
    const selM = document.getElementById('hc-filter-matriz');
    const selS = document.getElementById('hc-filter-svc');
    if (!selM || !selS) return;

    if (window.__HC_GLOBAL_FILTERS) {
        _filters.matriz = window.__HC_GLOBAL_FILTERS.matriz || '';
        _filters.svc = window.__HC_GLOBAL_FILTERS.svc || '';
    }

    const prevM = _filters.matriz, prevS = _filters.svc;
    const matrizes = uniqueNonEmptySorted(colabs.map(c => c.MATRIZ));
    const svcs = uniqueNonEmptySorted(colabs.map(c => c.SVC));

    selM.innerHTML = `<option value="">Matriz: Todos</option>` + matrizes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    selS.innerHTML = `<option value="">SVC: Todos</option>` + svcs.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');

    if (prevM) selM.value = prevM;
    if (prevS) selS.value = prevS;

    selM.onchange = () => {
        _filters.matriz = selM.value;
        persistFilters();
        renderWeeklyTables(_allColabsCache);
        pushFiltersToSubtabs();
    };
    selS.onchange = () => {
        _filters.svc = selS.value;
        persistFilters();
        renderWeeklyTables(_allColabsCache);
        pushFiltersToSubtabs();
    };
}

function persistFilters() {
    window.__HC_GLOBAL_FILTERS = {..._filters};
    window.dispatchEvent(new CustomEvent('hc-filters-changed', {detail: {..._filters}}));
}

async function fetchAllWithPagination(queryBuilder) {
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let moreData = true;

    while (moreData) {
        const {data, error} = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) throw error;
        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            moreData = false;
        }
    }
    return allData;
}

async function buildHCWeekly() {
    const matrizesPermitidas = getMatrizesPermitidas();

    let query = supabase
        .from('Colaboradores')
        .select('Nome, SVC, Cargo, MATRIZ, Ativo, Ferias, Escala, DSR');

    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }

    try {
        const data = await fetchAllWithPagination(query);
        _allColabsCache = data || [];
        populateFilterSelects(_allColabsCache);
        renderWeeklyTables(_allColabsCache);
        pushFiltersToSubtabs();
    } catch (error) {
        console.error("Erro ao construir HC Weekly:", error);
    }
}

async function ensureDiarioDOM() {
    const host = document.querySelector('#hc-diario');
    if (!host) return;
    if (host.querySelector('.hcd-root')) return;

    try {
        const r = await fetch('/pages/hc-diario.html', {cache: 'no-cache'});
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        host.innerHTML = await r.text();
    } catch {
        host.innerHTML = `
      <div class="hcd-root">
        <div class="hcd-bar">
          <div class="hcd-filters">
            <input type="date" id="hcd-start"/><input type="date" id="hcd-end"/>
          </div>
        </div>
        <div class="hcd-grid">
          <div class="hcd-card"><table class="hcd-table" id="hcd-t1"></table></div>
          <div class="hcd-card"><table class="hcd-table" id="hcd-t2"></table></div>
          <div class="hcd-card"><table class="hcd-table" id="hcd-t3"></table></div>
          <div class="hcd-card hcd-card--full"><table class="hcd-table" id="hcd-geral"></table></div>
        </div>
      </div>`;
    }
    host.querySelector('#hcd-refresh')?.remove();
}

async function ensureRelatorioABSDOM() {
    const host = document.querySelector('#hc-relatorio-abs');
    if (!host) return;

    if (host.querySelector('.abs-toolbar')) return;

    try {
        const r = await fetch('/pages/relatorio-abs.html', {cache: 'no-cache'});
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        host.innerHTML = await r.text();
    } catch {
        host.innerHTML = `
            <div class="abs-toolbar">
                <div class="abs-left">
                    <button id="abs-period" class="btn-add">Selecionar período</button>
                    <input id="abs-search" type="search" placeholder="Pesquisar por nome..." />
                    <select id="abs-filter-escala">
                        <option value="">Escala: Todas</option>
                        <option value="T1">T1</option>
                        <option value="T2">T2</option>
                        <option value="T3">T3</option>
                    </select>
                </div>
                <div class="abs-right">
                    <button id="abs-export" class="btn-add">Exportar Dados</button>
                </div>
            </div>
            <div class="abs-table-wrap">
                <table class="abs-table">
                    <thead>
                        <tr>
                            <th style="min-width:220px;text-align:left;">Nome</th>
                            <th>Data</th>
                            <th>Abs</th>
                            <th>Escala</th>
                            <th>Entrevista</th>
                            <th>Ação</th>
                            <th>SVC</th>
                            <th>MATRIZ</th>
                        </tr>
                    </thead>
                    <tbody id="abs-tbody">
                        <tr><td colspan="8" class="muted">Carregando…</td></tr>
                    </tbody>
                </table>
            </div>
        `;
    }
}

function pushFiltersToSubtabs() {
    window.__HC_GLOBAL_FILTERS = {..._filters};
    window.dispatchEvent(new CustomEvent('hc-filters-changed', {detail: {..._filters}}));
}

function wireSubtabs() {
    const host = document.querySelector('.hc-root');
    if (!host) return;

    const subButtons = host.querySelectorAll('.hc-subtab-btn');
    let isTransitioning = false;

    subButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isTransitioning) return;

            const currentView = host.querySelector('.hc-view.active');
            const viewName = btn.dataset.view;
            const nextView = host.querySelector(`#hc-${viewName}`);

            if (currentView === nextView) return;

            isTransitioning = true;
            subButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (currentView) {
                currentView.style.opacity = 0;
            }

            setTimeout(async () => {
                if (currentView) {
                    currentView.classList.remove('active');
                    currentView.style.opacity = 1;
                }

                if (nextView) {
                    nextView.style.opacity = 0;
                    nextView.classList.add('active');

                    try {
                        if (viewName !== 'indice' && typeof window.destroyHCIndice === 'function') window.destroyHCIndice();
                        if (viewName !== 'analise-abs' && typeof window.destroyHCAnaliseABS === 'function') window.destroyHCAnaliseABS();

                        if (viewName === 'diario') {
                            if (typeof window.buildHCDiario === 'function') await window.buildHCDiario();
                        } else if (viewName === 'relatorio-abs') {
                            if (typeof window.buildHCRelatorio === 'function') await window.buildHCRelatorio();
                        } else if (viewName === 'analise-abs') {
                            if (typeof window.buildHCAnaliseABS === 'function') await window.buildHCAnaliseABS();
                        } else if (viewName === 'indice') {
                            if (typeof window.buildHCIndice === 'function') await window.buildHCIndice();
                        } else if (viewName === 'desligamentos') {
                            ensureDesligamentosMounted();
                        } else if (viewName === 'ferias') {
                            ensureFeriasMounted();
                        }
                        window.dispatchEvent(new CustomEvent('hc-activated', {detail: {view: viewName}}));
                    } catch (e) {
                        console.error('Erro ao trocar sub-aba:', e);
                    }

                    requestAnimationFrame(() => {
                        nextView.style.opacity = 1;
                    });
                }

                isTransitioning = false;
            }, 200);
        });
    });

    const refreshBtn = host.querySelector('#hc-refresh');
    refreshBtn?.addEventListener('click', async () => {
        try {
            await buildHCWeekly();
            const active = host.querySelector('.hc-view.active');

            if (active?.id === 'hc-diario') {
                await ensureDiarioDOM();
                if (typeof window.buildHCDiario === 'function') queueMicrotask(() => window.buildHCDiario());
            } else if (active?.id === 'hc-relatorio-abs') {
                await ensureRelatorioABSDOM();
                if (typeof window.buildHCRelatorio === 'function') queueMicrotask(() => window.buildHCRelatorio());
            } else if (active?.id === 'hc-analise-abs' && typeof window.buildHCAnaliseABS === 'function') {
                queueMicrotask(() => window.buildHCAnaliseABS());
            } else if (active?.id === 'hc-indice' && typeof window.buildHCIndice === 'function') {
                queueMicrotask(() => window.buildHCIndice());
            } else if (active?.id === 'hc-desligamentos') {
                fetchDesligados();
            } else if (active?.id === 'hc-ferias') {
                fetchFerias();
            }

            window.dispatchEvent(new Event('hc-refresh'));
        } catch (e) {
            console.error('Refresh HC erro:', e);
        }
    });
}

function ensureDesligamentosMounted() {
    const host = document.getElementById('hc-desligamentos');
    if (!host || host.dataset.mounted === '1') return;


    if (typeof _deslState.cargo !== 'string') _deslState.cargo = '';

    host.innerHTML = `
    <div class="hcdesl-toolbar">
      <div class="hcdesl-left">
        <input id="hcdesl-search" type="search" placeholder="Pesquisar por nome..." />
        <select id="hcdesl-escala">
          <option value="">Escala: Todas</option>
          <option value="T1">T1</option><option value="T2">T2</option><option value="T3">T3</option>
        </select>
        <select id="hcdesl-cargo">
          <option value="">Cargo: Todos</option>
          <option value="AUXILIAR">AUXILIAR</option>
          <option value="CONFERENTE">CONFERENTE</option>
        </select>
        <select id="hcdesl-motivo">
          <option value="">Motivo: Todos</option>
        </select>
      </div>
      <div class="hcdesl-right">
        <button id="hcdesl-export" class="btn-add">Exportar Dados</button>
      </div>
    </div>

    <div class="hcdesl-table-wrap">
      <table class="hc-table">
        <thead>
          <tr>
            <th style="min-width:220px;text-align:left;">Nome</th>
            <th>Contrato</th>
            <th>Cargo</th>
            <th>Data de Admissão</th>
            <th>Data de Desligamento</th>
            <th>Período Trabalhado</th>
            <th>Motivo</th>
            <th>SVC</th>
            <th>MATRIZ</th>
          </tr>
        </thead>
        <tbody id="hcdesl-tbody">
          <tr><td colspan="9" class="muted">Carregando…</td></tr>
        </tbody>
      </table>
    </div>
  `;
    host.dataset.mounted = '1';

    document.getElementById('hcdesl-search')?.addEventListener('input', (e) => {
        _deslState.search = e.target.value;
        renderDesligamentosTable();
    });
    document.getElementById('hcdesl-escala')?.addEventListener('change', (e) => {
        _deslState.escala = e.target.value;
        renderDesligamentosTable();
    });
    document.getElementById('hcdesl-cargo')?.addEventListener('change', (e) => {
        _deslState.cargo = e.target.value;
        renderDesligamentosTable();
    });
    document.getElementById('hcdesl-motivo')?.addEventListener('change', (e) => {
        _deslState.motivo = e.target.value;
        renderDesligamentosTable();
    });
    document.getElementById('hcdesl-export')?.addEventListener('click', () => exportDesligamentos());

    fetchDesligados();
}

function getDeslFilters() {
    return {
        search: _deslState.search || '',
        escala: _deslState.escala || '',
        cargo: _deslState.cargo || '',
        motivo: _deslState.motivo || '',
        svc: _filters.svc || '',
        matriz: _filters.matriz || '',
    };
}

async function fetchDesligados() {
    const tbody = document.getElementById('hcdesl-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="muted">Carregando…</td></tr>`;

    try {
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase
            .from('Desligados')
            .select('Nome, Contrato, Cargo, "Data de Admissão", "Data de Desligamento", "Período Trabalhado", Motivo, SVC, MATRIZ, Escala');

        if (matrizesPermitidas !== null) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }

        query = query.order('Data de Desligamento', {ascending: false});

        const {data, error} = await query;
        if (error) throw error;

        _deslState.rows = Array.isArray(data) ? data : [];
        _deslState.loaded = true;

        const motivos = Array.from(new Set(
            _deslState.rows.map(r => String(r.Motivo || '')).filter(Boolean)
        )).sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));

        const elMotivo = document.getElementById('hcdesl-motivo');
        if (elMotivo) {
            const prev = _deslState.motivo;
            elMotivo.innerHTML = `<option value="">Motivo: Todos</option>` + motivos.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
            if (prev) elMotivo.value = prev;
        }

        renderDesligamentosTable();
    } catch (e) {
        console.error('Desligamentos: erro', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="muted">Erro ao carregar.</td></tr>`;
    }
}

function renderDesligamentosTable() {
    const tbody = document.getElementById('hcdesl-tbody');
    if (!tbody) return;

    if (!_deslState.loaded) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted">Carregando…</td></tr>`;
        return;
    }

    const {search, escala, cargo, motivo, svc, matriz} = getDeslFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

    const filtered = _deslState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || '') !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (motivo && String(r.Motivo || '') !== motivo) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        return true;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted">Sem registros nos filtros aplicados.</td></tr>`;
        return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(r => {
        const dtAdm = r['Data de Admissão'] ?? '';
        const dtDes = r['Data de Desligamento'] ?? '';
        const periodo = r['Período Trabalhado'] ?? '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td class="cell-name">${escapeHtml(r.Nome || '')}</td>
      <td>${escapeHtml(r.Contrato || '')}</td>
      <td>${escapeHtml(r.Cargo || '')}</td>
      <td>${escapeHtml(fmtBR(dtAdm))}</td>
      <td>${escapeHtml(fmtBR(dtDes))}</td>
      <td>${escapeHtml(periodo)}</td>
      <td>${escapeHtml(r.Motivo || '')}</td>
      <td>${escapeHtml(r.SVC || '')}</td>
      <td>${escapeHtml(r.MATRIZ || '')}</td>`;
        frag.appendChild(tr);
    });
    tbody.replaceChildren(frag);
}

function getVisibleDesligadosRows() {
    const {search, escala, cargo, motivo, svc, matriz} = getDeslFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

    const filtered = _deslState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || '') !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (motivo && String(r.Motivo || '') !== motivo) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        return true;
    });

    return filtered.map(r => ({
        Nome: r.Nome || '',
        Contrato: r.Contrato || '',
        Cargo: r.Cargo || '',
        'Data de Admissão': fmtBR(r['Data de Admissão'] ?? ''),
        'Data de Desligamento': fmtBR(r['Data de Desligamento'] ?? ''),
        'Período Trabalhado': r['Período Trabalhado'] ?? '',
        Motivo: r.Motivo || '',
        SVC: r.SVC || '',
        MATRIZ: r.MATRIZ || '',
        Escala: r.Escala || '',
    }));
}

function exportDesligamentos() {
    const rows = getVisibleDesligadosRows();
    if (!rows.length) {
        alert('Nada para exportar com os filtros atuais.');
        return;
    }
    const keys = Object.keys(rows[0] || {});
    const esc = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [keys.join(',')].concat(rows.map(r => keys.map(k => esc(r[k])).join(','))).join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `desligamentos_export_${toISO(new Date().toISOString())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function ensureFeriasMounted() {
    const host = document.getElementById('hc-ferias');
    if (!host || host.dataset.mounted === '1') return;


    if (typeof _feriasState.cargo !== 'string') _feriasState.cargo = '';

    host.innerHTML = `
    <div class="hcf-toolbar">
      <div class="hcf-left">
        <input id="hcf-search" type="search" placeholder="Pesquisar por nome..." />
        <select id="hcf-escala">
          <option value="">Escala: Todas</option>
          <option value="T1">T1</option><option value="T2">T2</option><option value="T3">T3</option>
        </select>
        <select id="hcf-cargo">
          <option value="">Cargo: Todos</option>
          <option value="AUXILIAR">AUXILIAR</option>
          <option value="CONFERENTE">CONFERENTE</option>
        </select>
        <select id="hcf-status">
          <option value="">Status: Todos</option>
        </select>
      </div>
      <div class="hcf-right">
        <button id="hcf-export" class="btn-add">Exportar Dados</button>
      </div>
    </div>

    <div class="hcf-table-wrap">
      <table class="hc-table">
        <thead>
          <tr>
            <th style="min-width:220px;text-align:left;">Nome</th>
            <th>Data Início</th>
            <th>Data Final</th>
            <th>Status</th>
            <th>Dias para Finalizar</th>
            <th>Escala</th>
            <th>Cargo</th>
            <th>SVC</th>
            <th>MATRIZ</th>
          </tr>
        </thead>
        <tbody id="hcf-tbody">
          <tr><td colspan="9" class="muted">Carregando…</td></tr>
        </tbody>
      </table>
    </div>
  `;
    host.dataset.mounted = '1';

    document.getElementById('hcf-search')?.addEventListener('input', (e) => {
        _feriasState.search = e.target.value;
        renderFeriasTable();
    });
    document.getElementById('hcf-escala')?.addEventListener('change', (e) => {
        _feriasState.escala = e.target.value;
        renderFeriasTable();
    });
    document.getElementById('hcf-cargo')?.addEventListener('change', (e) => {
        _feriasState.cargo = e.target.value;
        renderFeriasTable();
    });
    document.getElementById('hcf-status')?.addEventListener('change', (e) => {
        _feriasState.status = e.target.value;
        renderFeriasTable();
    });
    document.getElementById('hcf-export')?.addEventListener('click', () => exportFerias());

    window.addEventListener('hc-filters-changed', () => {
        if (_feriasState.loaded) renderFeriasTable();
    });

    fetchFerias();
}

function getFeriasFilters() {
    return {
        search: _feriasState.search || '',
        escala: _feriasState.escala || '',
        cargo: _feriasState.cargo || '',
        status: _feriasState.status || '',
        svc: _filters.svc || '',
        matriz: _filters.matriz || '',
    };
}

function calcDiasParaFinalizar(row) {
    const provided = row['Dias para Finalizar'];
    if (provided != null && provided !== '') return provided;

    const df = row['Data Final'];
    const d = df ? new Date(df) : null;
    if (!d || isNaN(d)) return '';
    const today = new Date();
    d.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d - today) / 86400000);
    return diff;
}

async function fetchFerias() {
    const tbody = document.getElementById('hcf-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="muted">Carregando…</td></tr>`;

    try {
        const matrizesPermitidas = getMatrizesPermitidas();


        let qFerias = supabase
            .from('Ferias')
            .select('"Numero", "Nome", "Escala", "SVC", "Data Inicio", "Data Final", "Status", "Dias para finalizar"')
            .order('Data Inicio', {ascending: false})
            .order('Data Final', {ascending: false});

        const {data: feriasData, error: feriasErr} = await qFerias;
        if (feriasErr) throw feriasErr;


        let qCol = supabase.from('Colaboradores').select('Nome, Cargo, MATRIZ, SVC, Escala');
        if (matrizesPermitidas !== null) qCol = qCol.in('MATRIZ', matrizesPermitidas);

        const {data: colabs, error: colErr} = await qCol;
        if (colErr) throw colErr;

        const idx = new Map();
        (colabs || []).forEach(c => idx.set(String(c.Nome || ''), c));

        _feriasState.rows = Array.isArray(feriasData)
            ? feriasData.map(r => {
                const info = idx.get(String(r.Nome || '')) || {};
                return {
                    ...r,
                    MATRIZ: info.MATRIZ || '',
                    SVC: r.SVC || info.SVC || '',
                    Escala: r.Escala || info.Escala || '',
                    Cargo: info.Cargo || '',
                    'Dias para Finalizar': r['Dias para Finalizar'] ?? r['Dias para finalizar'] ?? ''
                };
            })
            : [];

        _feriasState.loaded = true;


        const statusList = Array.from(new Set(
            _feriasState.rows.map(r => String(r.Status || '')).filter(Boolean)
        )).sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));

        const elStatus = document.getElementById('hcf-status');
        if (elStatus) {
            const prev = _feriasState.status;
            elStatus.innerHTML = `<option value="">Status: Todos</option>` +
                statusList.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
            if (prev) elStatus.value = prev;
        }

        renderFeriasTable();
    } catch (e) {
        console.error('Férias: erro', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="muted">Erro ao carregar.</td></tr>`;
    }
}

function renderFeriasTable() {
    const tbody = document.getElementById('hcf-tbody');
    if (!tbody) return;

    if (!_feriasState.loaded) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted">Carregando…</td></tr>`;
        return;
    }

    const {search, escala, cargo, status, svc, matriz} = getFeriasFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

    const filtered = _feriasState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || r.Escala) !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (status && String(r.Status || '') !== status) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        return true;
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted">Sem registros nos filtros aplicados.</td></tr>`;
        return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(r => {
        const di = r['Data Inicio'] ?? '';
        const df = r['Data Final'] ?? '';
        const dias = calcDiasParaFinalizar(r);

        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td class="cell-name">${escapeHtml(r.Nome || '')}</td>
      <td>${escapeHtml(fmtBR(di))}</td>
      <td>${escapeHtml(fmtBR(df))}</td>
      <td>${escapeHtml(r.Status || '')}</td>
      <td>${escapeHtml(dias)}</td>
      <td>${escapeHtml(r.Escala || '')}</td>
      <td>${escapeHtml(r.Cargo || '')}</td>
      <td>${escapeHtml(r.SVC || '')}</td>
      <td>${escapeHtml(r.MATRIZ || '')}</td>`;
        frag.appendChild(tr);
    });
    tbody.replaceChildren(frag);
}

function getVisibleFeriasRows() {
    const {search, escala, cargo, status, svc, matriz} = getFeriasFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

    const filtered = _feriasState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || '') !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (status && String(r.Status || '') !== status) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        return true;
    });

    return filtered.map(r => ({
        Nome: r.Nome || '',
        'Data Início': fmtBR(r['Data Inicio'] ?? ''),
        'Data Final': fmtBR(r['Data Final'] ?? ''),
        Status: r.Status || '',
        'Dias para Finalizar': calcDiasParaFinalizar(r),
        Escala: r.Escala || '',
        Cargo: r.Cargo || '',
        SVC: r.SVC || '',
        MATRIZ: r.MATRIZ || '',
    }));
}

function exportFerias() {
    const rows = getVisibleFeriasRows();
    if (!rows.length) {
        alert('Nada para exportar com os filtros atuais.');
        return;
    }
    const keys = Object.keys(rows[0] || {});
    const esc = v => {
        if (v == null) return '';
        const s = String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [keys.join(',')].concat(rows.map(r => keys.map(k => esc(r[k])).join(','))).join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ferias_export_${toISO(new Date().toISOString())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export async function init() {
    try {
        const t1 = document.getElementById('hc-t1');
        const t2 = document.getElementById('hc-t2');
        const t3 = document.getElementById('hc-t3');
        const g = document.getElementById('hc-geral');
        [t1, t2, t3, g].forEach(el =>
            el && (el.innerHTML = `<tbody><tr><td>Carregando…</td>${WEEK_KEYS.map(() => '<td>—</td>').join('')}</tr></tbody>`));

        wireSubtabs();
        await buildHCWeekly();
        await ensureDiarioDOM();

        window.addEventListener('hc-filters-changed', () => {
            const active = document.querySelector('.hc-view.active')?.id || '';
            if (active === 'hc-ferias' && _feriasState.loaded) renderFeriasTable();
            if (active === 'hc-desligamentos' && _deslState.loaded) renderDesligamentosTable();
        });

    } catch (e) {
        console.error('HC Consolidado init erro:', e);
        const gEl = document.getElementById('hc-geral');
        if (gEl) gEl.innerHTML =
            `<tbody><tr><td>Erro ao carregar</td>${WEEK_KEYS.map(() => '<td>—</td>').join('')}</tr></tbody>`;
    }
}
