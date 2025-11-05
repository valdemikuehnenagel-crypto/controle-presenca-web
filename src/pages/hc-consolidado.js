import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';
import './hc-diario.js';
import './relatorio-abs.js';
import './hc-analise-abs.js';const WEEK_LABELS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
const WEEK_KEYS = ['DOMINGO', 'SEGUNDA', 'TERCA', 'QUARTA', 'QUINTA', 'SEXTA', 'SABADO'];const norm = v => String(v ?? '').trim().toUpperCase();
const normalizeWeekdayPT = s => norm(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Ç/g, 'C');
const escapeHtml = s => String(s)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};const isActive = c => norm(c.Ativo || 'SIM') === 'SIM';
const onlyActiveAux = a => (a || []).filter(c => isActive(c) && norm(c.Cargo) === 'AUXILIAR');
const onlyActiveConf = a => (a || []).filter(c => isActive(c) && norm(c.Cargo) === 'CONFERENTE');
const splitByTurno = a => ({
    T1: a.filter(c => norm(c.Escala) === 'T1'),
    T2: a.filter(c => norm(c.Escala) === 'T2'),
    T3: a.filter(c => norm(c.Escala) === 'T3')
});
const uniqueNonEmptySorted = v => Array.from(new Set((v || []).map(x => String(x ?? '')).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));const toISO = v => String(v || '').slice(0, 10);
const fmtBR = iso => {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => {
    const t = new Date();
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};function coerceDateUTC(isoYMD) {
    if (!isoYMD) return null;
    const s = String(isoYMD).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0));
}function makeBoundUTC(isoYMD, end = false) {
    const d = coerceDateUTC(isoYMD);
    if (!d) return null;
    if (end) d.setUTCHours(23, 59, 59, 999);
    return d;
}function clampEndToToday(startISO, endISO) {
    if (!startISO || !endISO) return [startISO, endISO];
    const t = todayISO();
    return [startISO, endISO > t ? t : endISO];
}function defaultPeriod() {
    const t = new Date();
    const start = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 2, 1));
    const end = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    const sISO = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
    const eISO = `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
    return [sISO, eISO];
}function showPeriodOverlay({curStart, curEnd, onApply}) {
    const toISOstr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);    const overlay = document.createElement('div');
    overlay.id = 'cd-period-overlay';
    overlay.innerHTML = `
    <div class="cdp-card">
      <h3>Selecionar Período</h3>
      <div class="cdp-shortcuts">
        <button id="cdp-today"   class="btn-salvar">Hoje</button>
        <button id="cdp-yday"    class="btn-salvar">Ontem</button>
        <button id="cdp-prevmo" class="btn-salvar">Mês anterior</button>
      </div>
      <div class="dates-grid">
        <div><label>Início</label><input id="cdp-period-start" type="date" value="${curStart}"></div>
        <div><label>Fim</label><input id="cdp-period-end"   type="date" value="${curEnd}"></div>
      </div>
      <div class="form-actions">
        <button id="cdp-cancel" class="btn">Cancelar</button>
        <button id="cdp-apply"  class="btn-add">Aplicar</button>
      </div>
    </div>`;    const cssId = 'cdp-style';
    if (!document.getElementById(cssId)) {
        const st = document.createElement('style');
        st.id = cssId;
        st.textContent = `
      #cd-period-overlay, #cd-period-overlay * { box-sizing: border-box; }
      #cd-period-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 9999; }
      #cd-period-overlay .cdp-card { background: #fff; border-radius: 12px; padding: 16px; min-width: 480px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
      #cd-period-overlay h3 { margin: 0 0 12px; text-align: center; color: #003369; }
      #cd-period-overlay .cdp-shortcuts { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-bottom: 12px; }
      #cd-period-overlay .dates-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
      #cd-period-overlay .form-actions { display: flex; justify-content: flex-end; gap: 8px; }
    `;
        document.head.appendChild(st);
    }
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', ev => {
        if (ev.target === overlay) close();
    });
    overlay.querySelector('#cdp-cancel').onclick = close;    overlay.querySelector('#cdp-today').onclick = () => {
        const iso = toISOstr(today);
        onApply(iso, iso);
        close();
    };
    overlay.querySelector('#cdp-yday').onclick = () => {
        const iso = toISOstr(yesterday);
        onApply(iso, iso);
        close();
    };
    overlay.querySelector('#cdp-prevmo').onclick = () => {
        let s = toISOstr(prevStart), e = toISOstr(prevEnd);
        [s, e] = clampEndToToday(s, e);
        onApply(s, e);
        close();
    };    overlay.querySelector('#cdp-apply').onclick = () => {
        let sVal = String(overlay.querySelector('#cdp-period-start')?.value || '').slice(0, 10);
        let eVal = String(overlay.querySelector('#cdp-period-end')?.value || '').slice(0, 10);
        if (!sVal || !eVal) {
            alert('Selecione as duas datas.');
            return;
        }
        [sVal, eVal] = clampEndToToday(sVal, eVal);
        onApply(sVal, eVal);
        close();
    };
}let _allColabsCache = [];
const _filters = {svc: '', matriz: '', regiao: '', gerencia: ''};const _deslState = {
    loaded: false, rows: [], search: '', escala: '', motivo: '', cargo: '',
    startISO: null, endISO: null
};
const _feriasState = {
    loaded: false, rows: [], search: '', escala: '', status: '', cargo: '',
    startISO: null, endISO: null
};let _wiredSubtabs = false;let _cache = {ts: 0, key: '', rows: null};
const CACHE_MS = 5 * 60 * 1000;let _matrizesCache = {ts: 0, key: '', map: null};
const MATRIZES_CACHE_MS = 15 * 60 * 1000; export function destroy() {
    const buildFns = [window.buildHCAnaliseABS, window.buildHCRelatorio, window.buildHCDiario];
    buildFns.forEach(fn => {
        try {
            if (fn && typeof fn.resetState === 'function') fn.resetState();
        } catch {
        }
    });    _allColabsCache = [];
    _filters.svc = '';
    _filters.matriz = '';
    _filters.regiao = '';
    _filters.gerencia = '';    _deslState.loaded = false;
    _deslState.rows = [];
    _deslState.search = '';
    _deslState.escala = '';
    _deslState.motivo = '';
    _deslState.cargo = '';
    _deslState.startISO = null;
    _deslState.endISO = null;    _feriasState.loaded = false;
    _feriasState.rows = [];
    _feriasState.search = '';
    _feriasState.escala = '';
    _feriasState.status = '';
    _feriasState.cargo = '';
    _feriasState.startISO = null;
    _feriasState.endISO = null;    _cache.rows = null;
    _cache.ts = 0;
    _cache.key = '';
    _matrizesCache.map = null;
    _matrizesCache.ts = 0;
    _matrizesCache.key = '';    _wiredSubtabs = false;    console.log('Estado do HC Consolidado destruído, pronto para recarregar.');
}function calcularPeriodoTrabalhado(dtAdmISO, dtDesISO) {
    if (!dtAdmISO) return '';
    const dtAdm = new Date(dtAdmISO + 'T00:00:00Z');
    const dtDes = new Date(dtDesISO + 'T00:00:00Z');
    if (isNaN(dtAdm.getTime()) || isNaN(dtDes.getTime())) return '';
    if (dtAdm.getTime() === dtDes.getTime()) return '0';
    const diffTime = dtDes.getTime() - dtAdm.getTime();
    if (diffTime < 0) return '';
    const diffDays = Math.round(diffTime / 86400000);
    let anos = dtDes.getUTCFullYear() - dtAdm.getUTCFullYear();
    let meses = dtDes.getUTCMonth() - dtAdm.getUTCMonth();
    let dias = dtDes.getUTCDate() - dtAdm.getUTCDate();
    if (dias < 0) {
        meses--;
        const prevMonthLastDay = new Date(dtDes.getUTCFullYear(), dtDes.getUTCMonth(), 0).getUTCDate();
        dias += prevMonthLastDay;
    }
    if (meses < 0) {
        anos--;
        meses += 12;
    }
    if (dias >= 15) {
        meses++;
        if (meses === 12) {
            anos++;
            meses = 0;
        }
    }
    if (diffDays < 30) return `${diffDays} ${diffDays === 1 ? 'DIA' : 'DIAS'}`;
    const parts = [];
    if (anos > 0) parts.push(`${anos} ${anos === 1 ? 'ANO' : 'ANOS'}`);
    if (meses > 0) parts.push(`${meses} ${meses === 1 ? 'MES' : 'MESES'}`);
    if (parts.length > 0) return parts.join(' E ');
    if (diffDays >= 30 && anos === 0 && meses === 0) return '1 MES';
    return '0';
}function formatPeriodoTrabalhado(v) {
    const s0 = String(v || '').trim();
    if (!s0) return '';
    const s = s0.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
    const rules = [
        {re: /(\d+)\s*DIA\(S\)/g, one: 'DIA', many: 'DIAS'},
        {re: /(\d+)\s*MES\(ES\)/g, one: 'MES', many: 'MESES'},
        {re: /(\d+)\s*ANO\(S\)/g, one: 'ANO', many: 'ANOS'},
    ];
    let out = s;
    for (const {re, one, many} of rules) {
        out = out.replace(re, (_, nStr) => {
            const n = parseInt(nStr, 10);
            return `${n} ${n === 1 ? one : many}`;
        });
    }
    return out.replace(/\s+/g, ' ').trim();
}function buildWeeklyRowsForCargo(arr) {
    const feriasConst = (arr || []).filter(c => norm(c.Ferias) === 'SIM').length;
    const dsrByDay = {};
    WEEK_KEYS.forEach(d => dsrByDay[d] = 0);
    (arr || []).forEach(c => {
        const dsrString = c.DSR || '';
        if (!dsrString) return;
        dsrString.split(',').map(day => day.trim()).forEach(singleDay => {
            const d = normalizeWeekdayPT(singleDay);
            if (WEEK_KEYS.includes(d)) dsrByDay[d]++;
        });
    });
    const presentesByDay = {};
    const total = (arr || []).length;
    WEEK_KEYS.forEach(d => presentesByDay[d] = Math.max(0, total - dsrByDay[d] - feriasConst));
    return {feriasConst, dsrByDay, presentesByDay};
}function createTableDataForCargo(cargoArr) {
    const {feriasConst, dsrByDay, presentesByDay} = buildWeeklyRowsForCargo(cargoArr);
    const totalQuadroByDay = {};
    WEEK_KEYS.forEach(k => {
        totalQuadroByDay[k] = (presentesByDay[k] || 0) + (dsrByDay[k] || 0) + (feriasConst || 0);
    });
    return [
        {label: 'TOTAL QUADRO', values: totalQuadroByDay},
        {label: 'PRESENTES', values: presentesByDay},
        {label: 'DSR', values: dsrByDay},
        {label: 'FÉRIAS', values: WEEK_KEYS.reduce((a, d) => (a[d] = feriasConst, a), {})}
    ];
}function sumRows(a, b) {
    const labels = new Set([...(a || []).map(r => r.label), ...(b || []).map(r => r.label)]);
    const mb = new Map((b || []).map(r => [r.label, r]));
    const ma = new Map((a || []).map(r => [r.label, r]));
    return Array.from(labels).map(label => {
        const ra = ma.get(label);
        const rb = mb.get(label);
        const vals = {};
        WEEK_KEYS.forEach(k => {
            vals[k] = Number(ra?.values?.[k] || 0) + Number(rb?.values?.[k] || 0);
        });
        return {label, values: vals};
    });
}function toTableHTML(title, rows) {
    const thead = `
    <thead>
      <tr>
        <th class="align-left">${escapeHtml(title)}</th>
        ${WEEK_LABELS.map(l => `<th>${l}</th>`).join('')}
      </tr>
    </thead>`;
    const tbody = `
    <tbody>
      ${(rows || []).map(r => `
        <tr class="${r.label === 'TOTAL QUADRO' || r.label === 'TOTAL GERAL' ? 'hc-total-row' : ''}">
          <td class="align-left">${escapeHtml(r.label)}</td>
          ${WEEK_KEYS.map(k => `<td>${r.values[k]}</td>`).join('')}
        </tr>
      `).join('')}
    </tbody>`;
    return thead + tbody;
}function composeTotalTableData(auxData, confData) {
    const totalRows = sumRows(auxData, confData);
    const totalGeralRow = {label: 'TOTAL GERAL', values: {}};
    WEEK_KEYS.forEach(k => {
        const auxTotal = (auxData.find(r => r.label === 'TOTAL QUADRO')?.values[k] || 0);
        const confTotal = (confData.find(r => r.label === 'TOTAL QUADRO')?.values[k] || 0);
        totalGeralRow.values[k] = auxTotal + confTotal;
    });
    const pickOrZeros = (label) => {
        const sa = (auxData.find(r => r.label === label) ? [auxData.find(r => r.label === label)] : []);
        const sb = (confData.find(r => r.label === label) ? [confData.find(r => r.label === label)] : []);
        const s = sumRows(sa, sb)[0];
        return s || {label, values: WEEK_KEYS.reduce((a, d) => (a[d] = 0, a), {})};
    };
    return [totalGeralRow, pickOrZeros('PRESENTES'), pickOrZeros('DSR'), pickOrZeros('FÉRIAS')];
}function renderWeeklyTables(all) {
    const filtered = all.filter(c => {
        if (_filters.svc && norm(c.SVC) !== norm(_filters.svc)) return false;
        if (_filters.matriz && norm(c.MATRIZ) !== norm(_filters.matriz)) return false;
        if (_filters.regiao && norm(c.REGIAO) !== norm(_filters.regiao)) return false;
        if (_filters.gerencia && norm(c.GERENCIA) !== norm(_filters.gerencia)) return false;
        return true;
    });    const aux = onlyActiveAux(filtered);
    const conf = onlyActiveConf(filtered);    const byAux = splitByTurno(aux);
    const aux_t1 = createTableDataForCargo(byAux.T1);
    const aux_t2 = createTableDataForCargo(byAux.T2);
    const aux_t3 = createTableDataForCargo(byAux.T3);
    const aux_geral = sumRows(sumRows(aux_t1, aux_t2), aux_t3);    const auxT1El = document.getElementById('hc-aux-t1');
    const auxT2El = document.getElementById('hc-aux-t2');
    const auxT3El = document.getElementById('hc-aux-t3');
    const auxGeralEl = document.getElementById('hc-aux-geral');
    if (auxT1El) auxT1El.innerHTML = toTableHTML('TURNO 1', aux_t1);
    if (auxT2El) auxT2El.innerHTML = toTableHTML('TURNO 2', aux_t2);
    if (auxT3El) auxT3El.innerHTML = toTableHTML('TURNO 3', aux_t3);
    if (auxGeralEl) auxGeralEl.innerHTML = toTableHTML('QUADRO GERAL', aux_geral);    const byConf = splitByTurno(conf);
    const conf_t1 = createTableDataForCargo(byConf.T1);
    const conf_t2 = createTableDataForCargo(byConf.T2);
    const conf_t3 = createTableDataForCargo(byConf.T3);
    const conf_geral = sumRows(sumRows(conf_t1, conf_t2), conf_t3);    const confT1El = document.getElementById('hc-conf-t1');
    const confT2El = document.getElementById('hc-conf-t2');
    const confT3El = document.getElementById('hc-conf-t3');
    const confGeralEl = document.getElementById('hc-conf-geral');
    if (confT1El) confT1El.innerHTML = toTableHTML('TURNO 1', conf_t1);
    if (confT2El) confT2El.innerHTML = toTableHTML('TURNO 2', conf_t2);
    if (confT3El) confT3El.innerHTML = toTableHTML('TURNO 3', conf_t3);
    if (confGeralEl) confGeralEl.innerHTML = toTableHTML('QUADRO GERAL', conf_geral);    const total_geral_consolidado = composeTotalTableData(aux_geral, conf_geral);
    const totalGeralConsolidadoEl = document.getElementById('hc-total-geral-quadro');
    if (totalGeralConsolidadoEl) totalGeralConsolidadoEl.innerHTML = toTableHTML('TOTAL GERAL', total_geral_consolidado);
}function populateFilterSelects(colabs) {
    const selS = document.getElementById('hc-filter-svc');
    const selM = document.getElementById('hc-filter-matriz');
    const selR = document.getElementById('hc-filter-regiao');
    const selG = document.getElementById('hc-filter-gerencia');
    if (!selS || !selM || !selR || !selG) return;    if (window.__HC_GLOBAL_FILTERS) {
        _filters.svc = window.__HC_GLOBAL_FILTERS.svc || '';
        _filters.matriz = window.__HC_GLOBAL_FILTERS.matriz || '';
        _filters.regiao = window.__HC_GLOBAL_FILTERS.regiao || '';
        _filters.gerencia = window.__HC_GLOBAL_FILTERS.gerencia || '';
    }    const prevS = _filters.svc, prevM = _filters.matriz, prevR = _filters.regiao, prevG = _filters.gerencia;
    const svcs = uniqueNonEmptySorted(colabs.map(c => c.SVC));
    const matrizes = uniqueNonEmptySorted(colabs.map(c => c.MATRIZ));
    const regioes = uniqueNonEmptySorted(colabs.map(c => c.REGIAO));
    const gerencias = uniqueNonEmptySorted(colabs.map(c => c.GERENCIA));    selS.innerHTML = `<option value="">SVC</option>` + svcs.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    selM.innerHTML = `<option value="">Matriz</option>` + matrizes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    selR.innerHTML = `<option value="">Região</option>` + regioes.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    selG.innerHTML = `<option value="">Gerência</option>` + gerencias.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');    if (prevS) selS.value = prevS;
    if (prevM) selM.value = prevM;
    if (prevR) selR.value = prevR;
    if (prevG) selG.value = prevG;    const handleFilterChange = () => {
        _filters.svc = selS.value;
        _filters.matriz = selM.value;
        _filters.regiao = selR.value;
        _filters.gerencia = selG.value;
        persistFilters();
        renderWeeklyTables(_allColabsCache);
        pushFiltersToSubtabs();
    };
    selS.onchange = handleFilterChange;
    selM.onchange = handleFilterChange;
    selR.onchange = handleFilterChange;
    selG.onchange = handleFilterChange;
}function persistFilters() {
    window.__HC_GLOBAL_FILTERS = {..._filters};
    window.dispatchEvent(new CustomEvent('hc-filters-changed', {detail: {..._filters}}));
}async function fetchAllWithPagination(queryBuilder) {
    let allData = [], page = 0;
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
}function makeCacheKey() {
    const m = getMatrizesPermitidas();
    return Array.isArray(m) ? m.slice().sort().join('|') : 'ALL';
}async function loadColabsWeekly() {
    const key = makeCacheKey();
    const now = Date.now();
    if (_cache.rows && _cache.key === key && (now - _cache.ts) < CACHE_MS) {
        return _cache.rows;
    }
    let query = supabase
        .from('Colaboradores')
        .select('Nome, SVC, Cargo, MATRIZ, Ativo, Ferias, Escala, DSR')
        .order('Nome');
    const matrizesPermitidas = getMatrizesPermitidas();
    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }
    const data = await fetchAllWithPagination(query);
    _cache.rows = data || [];
    _cache.ts = now;
    _cache.key = key;
    return _cache.rows;
}async function loadMatrizesMapping() {
    const key = makeCacheKey();
    const now = Date.now();
    if (_matrizesCache.map && _matrizesCache.key === key && (now - _matrizesCache.ts) < MATRIZES_CACHE_MS) {
        return _matrizesCache.map;
    }
    let query = supabase.from('Matrizes').select('MATRIZ, GERENCIA, REGIAO');
    const matrizesPermitidas = getMatrizesPermitidas();
    if (matrizesPermitidas !== null) query = query.in('MATRIZ', matrizesPermitidas);
    const {data, error} = await query;
    if (error) {
        console.error("Erro ao carregar tabela 'Matrizes'", error);
        throw error;
    }
    const map = new Map();
    if (data) {
        data.forEach(item => {
            const matrizNorm = norm(item.MATRIZ);
            if (matrizNorm) {
                map.set(matrizNorm, {gerencia: item.GERENCIA || '', regiao: item.REGIAO || ''});
            }
        });
    }
    _matrizesCache.map = map;
    _matrizesCache.ts = now;
    _matrizesCache.key = key;
    return _matrizesCache.map;
}async function buildHCWeekly() {
    try {
        const [colabData, matrizesMap] = await Promise.all([loadColabsWeekly(), loadMatrizesMapping()]);
        _allColabsCache = (colabData || []).map(c => {
            const mapping = matrizesMap.get(norm(c.MATRIZ));
            return {...c, REGIAO: mapping?.regiao || '', GERENCIA: mapping?.gerencia || ''};
        });
        populateFilterSelects(_allColabsCache);
        renderWeeklyTables(_allColabsCache);
        pushFiltersToSubtabs();
    } catch (error) {
        console.error("Erro ao construir HC Weekly:", error);
    }
}async function ensureDiarioDOM() {
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
}async function ensureRelatorioABSDOM() {
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
}function pushFiltersToSubtabs() {
    window.__HC_GLOBAL_FILTERS = {..._filters};
    window.dispatchEvent(new CustomEvent('hc-filters-changed', {detail: {..._filters}}));
}function wireSubtabs() {
    if (_wiredSubtabs) return;
    _wiredSubtabs = true;    const host = document.querySelector('.hc-root');
    if (!host) return;
    const subButtons = host.querySelectorAll('.hc-subtab-btn');
    let isTransitioning = false;    subButtons.forEach(btn => {
        btn.addEventListener('click', async () => {
            if (isTransitioning) return;
            const currentView = host.querySelector('.hc-view.active');
            const viewName = btn.dataset.view;
            const nextView = host.querySelector(`#hc-${viewName}`);
            if (currentView === nextView) return;            isTransitioning = true;
            subButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');            if (currentView) currentView.style.opacity = 0;            setTimeout(async () => {
                if (currentView) {
                    currentView.classList.remove('active');
                    currentView.style.opacity = 1;
                }
                if (nextView) {
                    nextView.style.opacity = 0;
                    nextView.classList.add('active');                    try {
                        if (viewName !== 'analise-abs' && typeof window.destroyHCAnaliseABS === 'function') window.destroyHCAnaliseABS();                        if (viewName === 'diario') {
                            if (typeof window.buildHCDiario === 'function') await window.buildHCDiario();
                        } else if (viewName === 'relatorio-abs') {
                            if (typeof window.buildHCRelatorio === 'function') await window.buildHCRelatorio();
                        } else if (viewName === 'analise-abs') {
                            if (typeof window.buildHCAnaliseABS === 'function') await window.buildHCAnaliseABS();
                        } else if (viewName === 'desligamentos') {
                            ensureDesligamentosMounted();
                        } else if (viewName === 'ferias') {
                            ensureFeriasMounted();
                        }                        window.dispatchEvent(new CustomEvent('hc-activated', {detail: {view: viewName}}));
                    } catch (e) {
                        console.error('Erro ao trocar sub-aba:', e);
                    }                    requestAnimationFrame(() => {
                        nextView.style.opacity = 1;
                    });
                }
                isTransitioning = false;
            }, 200);
        });
    });    const refreshBtn = host.querySelector('#hc-refresh');
    refreshBtn?.addEventListener('click', async () => {
        try {
            _cache.rows = null;
            _cache.ts = 0;
            _matrizesCache.map = null;
            _matrizesCache.ts = 0;            await buildHCWeekly();
            const active = host.querySelector('.hc-view.active');
            if (active?.id === 'hc-diario') {
                await ensureDiarioDOM();
                if (typeof window.buildHCDiario === 'function') queueMicrotask(() => window.buildHCDiario());
            } else if (active?.id === 'hc-relatorio-abs') {
                await ensureRelatorioABSDOM();
                if (typeof window.buildHCRelatorio === 'function') queueMicrotask(() => window.buildHCRelatorio());
            } else if (active?.id === 'hc-analise-abs' && typeof window.buildHCAnaliseABS === 'function') {
                queueMicrotask(() => window.buildHCAnaliseABS());
            } else if (active?.id === 'hc-desligamentos') {
                fetchDesligados();
            } else if (active?.id === 'hc-ferias') {
                fetchFerias();
            }            window.dispatchEvent(new Event('hc-refresh'));
        } catch (e) {
            console.error('Refresh HC erro:', e);
        }
    });
}async function loadSheetJS() {
    if (window.XLSX) return;
    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    } catch (error) {
        console.error("Falha ao carregar a biblioteca XLSX:", error);
        alert("Erro ao carregar a biblioteca de exportação de Excel. Tente recarregar a página.");
    }
}async function fetchAndDownloadHistorico(colaboradorNome, targetButton) {
    if (!colaboradorNome) return;    targetButton.disabled = true;
    targetButton.textContent = '...';    try {        await loadSheetJS();
        if (!window.XLSX) {
            throw new Error("Biblioteca XLSX não carregou.");
        }        const headers = [
            'Nome', 'Presença', 'Falta', 'Atestado', 'Folga Especial',
            'Suspensao', 'Feriado', 'Data', 'Turno', 'Entrevista',
            'Acao', 'TipoAtestado', 'Observacao', 'CID'
        ];        const selectString = 'Nome,Presença,Falta,Atestado,"Folga Especial",Suspensao,Feriado,Data,Turno,Entrevista,Acao,TipoAtestado,Observacao,CID';        let query = supabase
            .from('ControleDiario')
            .select(selectString)
            .eq('Nome', colaboradorNome)
            .order('Data', {ascending: false});        const data = await fetchAllWithPagination(query);        if (!data || data.length === 0) {
            alert('Nenhum histórico de presença encontrado para este colaborador.');
            return;
        }        const sheetData = [
            headers,
            ...data.map(row => headers.map(header => row[header]))
        ];        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(wb, ws, 'Histórico');        const safeName = colaboradorNome.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        XLSX.writeFile(wb, `historico_${safeName}.xlsx`);    } catch (error) {
        console.error("Erro ao gerar histórico:", error);
        alert(`Falha ao gerar histórico: ${error.message}`);
    } finally {        targetButton.disabled = false;
        targetButton.textContent = '💾';
    }
}function ensureDesligamentosMounted() {
    const host = document.getElementById('hc-desligamentos');
    if (!host || host.dataset.mounted === '1') return;
    if (typeof _deslState.cargo !== 'string') _deslState.cargo = '';    if (!_deslState.startISO || !_deslState.endISO) {
        [_deslState.startISO, _deslState.endISO] = defaultPeriod();
    }    host.innerHTML = `
    <div class="hcdesl-toolbar">
      <div class="hcdesl-left">
        <input id="hcdesl-search" type="search" placeholder="Pesquisar por nome..." />
        <select id="hcdesl-escala">
          <option value="">Escala: Todas</option>
          <option value="T1">T1</option><option value="T2">T2</option><option value="T3">T3</option>
        </select>
        <select id="hcdesl-cargo">
          <option value="">Cargo</option>
          <option value="AUXILIAR">AUXILIAR</option>
          <option value="CONFERENTE">CONFERENTE</option>
        </select>
        <select id="hcdesl-motivo">
          <option value="">Motivo</option>
        </select>
      </div>
      <div class="hcdesl-right">
        <button id="hcdesl-period" class="btn-add">Selecionar Período</button>
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
            <th>Relatório</th>
          </tr>
        </thead>
        <tbody id="hcdesl-tbody">
          <tr><td colspan="8" class="muted">Carregando…</td></tr>
        </tbody>
      </table>
    </div>
  `;
    host.dataset.mounted = '1';    document.getElementById('hcdesl-period')?.addEventListener('click', () => {
        const [cs, ce] = [_deslState.startISO, _deslState.endISO];
        showPeriodOverlay({
            curStart: cs, curEnd: ce,
            onApply: (s, e) => {
                _deslState.startISO = s;
                _deslState.endISO = e;
                renderDesligamentosTable();
            }
        });
    });    document.getElementById('hcdesl-search')?.addEventListener('input', (e) => {
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
    document.getElementById('hcdesl-export')?.addEventListener('click', () => exportDesligamentos());    document.getElementById('hcdesl-tbody').addEventListener('click', e => {
        const button = e.target.closest('.btn-download-historico');
        if (button) {
            e.preventDefault();
            const nome = button.dataset.nome;
            fetchAndDownloadHistorico(nome, button);
        }
    });    fetchDesligados();
}function getDeslFilters() {
    return {
        search: _deslState.search || '',
        escala: _deslState.escala || '',
        cargo: _deslState.cargo || '',
        motivo: _deslState.motivo || '',
        svc: _filters.svc || '',
        matriz: _filters.matriz || '',
        regiao: _filters.regiao || '',
        gerencia: _filters.gerencia || '',
        startISO: _deslState.startISO || null,
        endISO: _deslState.endISO || null,
    };
}async function fetchDesligados() {    const tbody = document.getElementById('hcdesl-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="muted">Carregando…</td></tr>`;    try {
        const matrizesMap = await loadMatrizesMapping();
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase
            .from('Desligados')
            .select('Nome, Contrato, Cargo, "Data de Admissão", "Data de Desligamento", "Período Trabalhado", Motivo, SVC, MATRIZ, Escala')
            .order('Data de Desligamento', {ascending: false});
        if (matrizesPermitidas !== null) query = query.in('MATRIZ', matrizesPermitidas);        const {data, error} = await query;
        if (error) throw error;        const enrichedData = (Array.isArray(data) ? data : []).map(r => {
            const mapping = matrizesMap.get(norm(r.MATRIZ));
            return {...r, REGIAO: mapping?.regiao || '', GERENCIA: mapping?.gerencia || ''};
        });        _deslState.rows = enrichedData;
        _deslState.loaded = true;        const motivos = Array.from(new Set(_deslState.rows.map(r => String(r.Motivo || '')).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));
        const elMotivo = document.getElementById('hcdesl-motivo');
        if (elMotivo) {
            const prev = _deslState.motivo;
            elMotivo.innerHTML = `<option value="">Motivo</option>` + motivos.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
            if (prev) elMotivo.value = prev;
        }        renderDesligamentosTable();
    } catch (e) {
        console.error('Desligamentos: erro', e);        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="muted">Erro ao carregar.</td></tr>`;
    }
}function renderDesligamentosTable() {
    const tbody = document.getElementById('hcdesl-tbody');
    if (!tbody) return;
    if (!_deslState.loaded) {        tbody.innerHTML = `<tr><td colspan="8" class="muted">Carregando…</td></tr>`;
        return;
    }    const {search, escala, cargo, motivo, svc, matriz, regiao, gerencia, startISO, endISO} = getDeslFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();    const startUtc = makeBoundUTC(startISO, false);
    const endUtc = makeBoundUTC(endISO, true);    const filtered = _deslState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || '') !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (motivo && String(r.Motivo || '') !== motivo) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (regiao && norm(r.REGIAO) !== norm(regiao)) return false;
        if (gerencia && norm(r.GERENCIA) !== norm(gerencia)) return false;        if (startUtc && endUtc) {
            const d = makeBoundUTC(r['Data de Desligamento'], false);
            if (!d) return false;
            if (d < startUtc || d > endUtc) return false;
        }
        return true;
    });    if (!filtered.length) {        tbody.innerHTML = `<tr><td colspan="8" class="muted">Sem registros nos filtros aplicados.</td></tr>`;
        return;
    }    const frag = document.createDocumentFragment();
    filtered.forEach(r => {
        const dtAdm = r['Data de Admissão'] ?? '';
        const dtDes = r['Data de Desligamento'] ?? '';
        const periodo = calcularPeriodoTrabalhado(dtAdm, dtDes);
        const tr = document.createElement('tr');        tr.innerHTML = `
      <td class="cell-name">${escapeHtml(r.Nome || '')}</td>
      <td>${escapeHtml(r.Contrato || '')}</td>
      <td>${escapeHtml(r.Cargo || '')}</td>
      <td>${escapeHtml(fmtBR(dtAdm))}</td>
      <td>${escapeHtml(fmtBR(dtDes))}</td>
      <td>${escapeHtml(periodo)}</td>
      <td>${escapeHtml(r.Motivo || '')}</td>
      <td style="text-align: center;">
        <button class="btn-download-historico" data-nome="${escapeHtml(r.Nome || '')}" style="background:none; border:none; cursor:pointer; font-size: 1.2rem;" title="Baixar Histórico de Presença">💾</button>
      </td>`;
        frag.appendChild(tr);
    });
    tbody.replaceChildren(frag);
}function getVisibleDesligadosRows() {
    const {search, escala, cargo, motivo, svc, matriz, regiao, gerencia, startISO, endISO} = getDeslFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const startUtc = makeBoundUTC(startISO, false);
    const endUtc = makeBoundUTC(endISO, true);    const filtered = _deslState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || '') !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (motivo && String(r.Motivo || '') !== motivo) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (regiao && norm(r.REGIAO) !== norm(regiao)) return false;
        if (gerencia && norm(r.GERENCIA) !== norm(gerencia)) return false;
        if (startUtc && endUtc) {
            const d = makeBoundUTC(r['Data de Desligamento'], false);
            if (!d || d < startUtc || d > endUtc) return false;
        }
        return true;
    });    return filtered.map(r => ({
        Nome: r.Nome || '',
        Contrato: r.Contrato || '',
        Cargo: r.Cargo || '',
        'Data de Admissão': fmtBR(r['Data de Admissão'] ?? ''),
        'Data de Desligamento': fmtBR(r['Data de Desligamento'] ?? ''),
        'Período Trabalhado': calcularPeriodoTrabalhado(r['Data de Admissão'] ?? '', r['Data de Desligamento'] ?? ''),
        Motivo: r.Motivo || '',
        SVC: r.SVC || '',
        MATRIZ: r.MATRIZ || '',
        Escala: r.Escala || '',
        REGIAO: r.REGIAO || '',
        GERENCIA: r.GERENCIA || '',
    }));
}function exportDesligamentos() {
    const rows = getVisibleDesligadosRows();
    if (!rows.length) {
        alert('Nada para exportar com os filtros atuais.');
        return;
    }
    const keys = Object.keys(rows[0] || {});    const csv = [keys.join(',')].concat(rows.map(r => keys.map(k => esc(r[k])).join(','))).join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `desligamentos_export_${toISO(new Date().toISOString())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}function ensureFeriasMounted() {
    const host = document.getElementById('hc-ferias');
    if (!host || host.dataset.mounted === '1') return;
    if (typeof _feriasState.cargo !== 'string') _feriasState.cargo = '';    if (!_feriasState.startISO || !_feriasState.endISO) {
        [_feriasState.startISO, _feriasState.endISO] = defaultPeriod();
    }    host.innerHTML = `
    <div class="hcf-toolbar">
      <div class="hcf-left">
        <input id="hcf-search" type="search" placeholder="Pesquisar por nome..." />
        <select id="hcf-escala">
          <option value="">Escala: Todas</option>
          <option value="T1">T1</option><option value="T2">T2</option><option value="T3">T3</option>
        </select>
        <select id="hcf-cargo">
          <option value="">Cargo</option>
          <option value="AUXILIAR">AUXILIAR</option>
          <option value="CONFERENTE">CONFERENTE</option>
        </select>
        <select id="hcf-status">
          <option value="">Status</option>
        </select>
      </div>
      <div class="hcf-right">
        <button id="hcf-period" class="btn-add">Selecionar Período</button>
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
    host.dataset.mounted = '1';    document.getElementById('hcf-period')?.addEventListener('click', () => {
        const [cs, ce] = [_feriasState.startISO, _feriasState.endISO];
        showPeriodOverlay({
            curStart: cs, curEnd: ce,
            onApply: (s, e) => {
                _feriasState.startISO = s;
                _feriasState.endISO = e;
                renderFeriasTable();
            }
        });
    });    document.getElementById('hcf-search')?.addEventListener('input', (e) => {
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
    document.getElementById('hcf-export')?.addEventListener('click', () => exportFerias());    window.addEventListener('hc-filters-changed', () => {
        if (_feriasState.loaded) renderFeriasTable();
    });    fetchFerias();
}function getFeriasFilters() {
    return {
        search: _feriasState.search || '',
        escala: _feriasState.escala || '',
        cargo: _feriasState.cargo || '',
        status: _feriasState.status || '',
        svc: _filters.svc || '',
        matriz: _filters.matriz || '',
        regiao: _filters.regiao || '',
        gerencia: _filters.gerencia || '',
        startISO: _feriasState.startISO || null,
        endISO: _feriasState.endISO || null,
    };
}function calcDiasParaFinalizar(row) {
    const status = norm(row.Status);
    if (status === 'A INICIAR') return '';
    if (status === 'FINALIZADO') return 0;
    const provided = row['Dias para Finalizar'];
    if (provided != null && provided !== '') return provided;
    const df = row['Data Final'];
    const d = df ? new Date(df) : null;
    if (!d || isNaN(d)) return '';
    const today = new Date();
    d.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diff = Math.ceil((d - today) / 86400000);
    return Math.max(0, diff);
}async function fetchFerias() {
    const tbody = document.getElementById('hcf-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="muted">Carregando…</td></tr>`;    try {
        const matrizesMap = await loadMatrizesMapping();
        const matrizesPermitidas = getMatrizesPermitidas();
        let qFerias = supabase
            .from('Ferias')
            .select('"Numero", "Nome", "Cargo", "Escala", "SVC", "MATRIZ", "Data Inicio", "Data Final", "Status", "Dias para finalizar"')
            .order('Data Inicio', {ascending: false})
            .order('Data Final', {ascending: false});
        if (matrizesPermitidas !== null) qFerias = qFerias.in('MATRIZ', matrizesPermitidas);        const {data: feriasData, error: feriasErr} = await qFerias;
        if (feriasErr) throw feriasErr;        _feriasState.rows = (Array.isArray(feriasData) ? feriasData : []).map(r => {
            const mapping = matrizesMap.get(norm(r.MATRIZ));
            return {
                ...r,
                MATRIZ: r.MATRIZ || '',
                SVC: r.SVC || '',
                Escala: r.Escala || '',
                Cargo: r.Cargo || '',
                REGIAO: mapping?.regiao || '',
                GERENCIA: mapping?.gerencia || '',
                'Dias para Finalizar': r['Dias para Finalizar'] ?? r['Dias para finalizar'] ?? ''
            };
        });
        _feriasState.loaded = true;        const statusList = Array.from(new Set(_feriasState.rows.map(r => String(r.Status || '')).filter(Boolean)))
            .sort((a, b) => a.localeCompare(b, 'pt-BR', {sensitivity: 'base'}));
        const elStatus = document.getElementById('hcf-status');
        if (elStatus) {
            const prev = _feriasState.status;
            elStatus.innerHTML = `<option value="">Status</option>` + statusList.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
            if (prev) elStatus.value = prev;
        }        renderFeriasTable();
    } catch (e) {
        console.error('Férias: erro', e);
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="muted">Erro ao carregar.</td></tr>`;
    }
}function renderFeriasTable() {
    const tbody = document.getElementById('hcf-tbody');
    if (!tbody) return;
    if (!_feriasState.loaded) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted">Carregando…</td></tr>`;
        return;
    }    const {search, escala, cargo, status, svc, matriz, regiao, gerencia, startISO, endISO} = getFeriasFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();    const startUtc = makeBoundUTC(startISO, false);
    const endUtc = makeBoundUTC(endISO, true);    const filtered = _feriasState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || '') !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (status && String(r.Status || '') !== status) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (regiao && norm(r.REGIAO) !== norm(regiao)) return false;
        if (gerencia && norm(r.GERENCIA) !== norm(gerencia)) return false;        if (startUtc && endUtc) {
            const di = makeBoundUTC(r['Data Inicio'], false);
            const df = makeBoundUTC(r['Data Final'], true) || di;
            if (!di && !df) return false;            const rowStart = di || df;
            const rowEnd = df || di;
            if (rowEnd < startUtc || rowStart > endUtc) return false;
        }        return true;
    });    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="muted">Sem registros nos filtros aplicados.</td></tr>`;
        return;
    }    const frag = document.createDocumentFragment();
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
}function getVisibleFeriasRows() {
    const {search, escala, cargo, status, svc, matriz, regiao, gerencia, startISO, endISO} = getFeriasFilters();
    const s = (search || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const startUtc = makeBoundUTC(startISO, false);
    const endUtc = makeBoundUTC(endISO, true);    const filtered = _feriasState.rows.filter(r => {
        if (s && !String(r.Nome || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().includes(s)) return false;
        if (escala && String(r.Escala || '') !== escala) return false;
        if (cargo && norm(r.Cargo) !== norm(cargo)) return false;
        if (status && String(r.Status || '') !== status) return false;
        if (svc && norm(r.SVC) !== norm(svc)) return false;
        if (matriz && norm(r.MATRIZ) !== norm(matriz)) return false;
        if (regiao && norm(r.REGIAO) !== norm(regiao)) return false;
        if (gerencia && norm(r.GERENCIA) !== norm(gerencia)) return false;
        if (startUtc && endUtc) {
            const di = makeBoundUTC(r['Data Inicio'], false);
            const df = makeBoundUTC(r['Data Final'], true) || di;
            if (!di && !df) return false;
            const rowStart = di || df;
            const rowEnd = df || di;
            if (rowEnd < startUtc || rowStart > endUtc) return false;
        }
        return true;
    });    return filtered.map(r => ({
        Nome: r.Nome || '',
        'Data Início': fmtBR(r['Data Inicio'] ?? ''),
        'Data Final': fmtBR(r['Data Final'] ?? ''),
        Status: r.Status || '',
        'Dias para Finalizar': calcDiasParaFinalizar(r),
        Escala: r.Escala || '',
        Cargo: r.Cargo || '',
        SVC: r.SVC || '',
        MATRIZ: r.MATRIZ || '',
        REGIAO: r.REGIAO || '',
        GERENCIA: r.GERENCIA || '',
    }));
}function exportFerias() {
    const rows = getVisibleFeriasRows();
    if (!rows.length) {
        alert('Nada para exportar com os filtros atuais.');
        return;
    }
    const keys = Object.keys(rows[0] || {});    const csv = [keys.join(',')].concat(rows.map(r => keys.map(k => esc(r[k])).join(','))).join('\n');
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ferias_export_${toISO(new Date().toISOString())}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}export async function init() {
    try {
        const tableIds = [
            'hc-aux-t1', 'hc-aux-t2', 'hc-aux-t3', 'hc-aux-geral',
            'hc-conf-t1', 'hc-conf-t2', 'hc-conf-t3', 'hc-conf-geral',
            'hc-total-geral-quadro'
        ];
        const loadingHTML = `<thead>
        <tr><th class="align-left">Carregando…</th>${WEEK_KEYS.map(() => '<th>—</th>').join('')}</tr>
      </thead><tbody></tbody>`;
        tableIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = loadingHTML;
        });        wireSubtabs();
        await buildHCWeekly();
        await ensureDiarioDOM();        window.addEventListener('hc-filters-changed', () => {
            const active = document.querySelector('.hc-view.active')?.id || '';
            if (active === 'hc-ferias' && _feriasState.loaded) renderFeriasTable();
            if (active === 'hc-desligamentos' && _deslState.loaded) renderDesligamentosTable();
        });
    } catch (e) {
        console.error('HC Consolidado init erro:', e);
        const gEl = document.getElementById('hc-aux-geral');
        if (gEl) gEl.innerHTML = `<tbody><tr><td>Erro ao carregar</td>${WEEK_KEYS.map(() => '<td>—</td>').join('')}</tr></tbody>`;
    }
}