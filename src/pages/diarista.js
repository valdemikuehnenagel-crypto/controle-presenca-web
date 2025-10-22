
import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

/* ============ Util / Datas (fuso BR) ============ */
const TZ = 'America/Sao_Paulo';
const pad2 = n => String(n).padStart(2, '0');

function todayISO_BR() {
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'})
        .formatToParts(new Date())
        .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateToISO_BR(d) {

    const dt = (d instanceof Date) ? d : new Date(d);
    if (!Number.isFinite(dt.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'})
        .formatToParts(dt)
        .reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function diaristaToISO(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const iso = dateToISO_BR(s);
    return iso || null;
}

function diaristaFmtBR(val) {
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const iso = diaristaToISO(s);
    if (iso) {
        const [y, mm, dd] = iso.split('-');
        return `${dd}/${mm}/${y}`;
    }
    return s;
}

const safeTime = (dLike) => {
    const iso = diaristaToISO(dLike);
    if (!iso) return NaN;

    const [y, m, d] = iso.split('-').map(Number);
    return new Date(`${y}-${pad2(m)}-${pad2(d)}T12:00:00`).getTime();
};

/* ============ Util / Texto & Sessão ============ */
function readCurrentSession() {
    try {
        if (window.currentSession && typeof window.currentSession === 'object') return window.currentSession;
    } catch {
    }
    try {
        const raw = localStorage.getItem('kn.session');
        if (raw) return JSON.parse(raw);
    } catch {
    }
    return {matriz: 'TODOS'};
}

const getSessionMatriz = () => String(readCurrentSession()?.matriz || 'TODOS').trim().toUpperCase();
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
}[c]));
const removeDiacriticsBrowser = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizeNameForMatch = s =>
    removeDiacriticsBrowser(String(s || '')).toUpperCase().replace(/\s+/g, ' ').trim();
const formatNomeComId = (nome, id) => {
    const n = String(nome || '').trim(), g = String(id || '').trim();
    return g ? `${n} (${g})` : n;
};

/* ============ Estado ============ */
const state = {
    mounted: false,
    svcToMatriz: new Map(),
    matrizInfoMap: new Map(),
    matrizesList: [],
    records: [],
    baseByMatriz: new Map(),
    baseLoaded: false,
    filters: {start: '', end: '', svc: '', matriz: '', turno: ''},
    gerenciar: {loaded: false, all: [], filtered: [], searchRaw: '', editing: null, selectedNames: new Set()},
    _listeners: [],
    _popover: null
};
const on = (el, ev, cb) => {
    if (el) {
        el.addEventListener(ev, cb);
        state._listeners.push(() => el.removeEventListener(ev, cb));
    }
};
const setText = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
};
const isGerenciarOpen = () => {
    const o = document.getElementById('gerenciar-modal');
    return o && !o.classList.contains('hidden');
};

/* ============ Base (BancoDiaristas) ============ */
async function loadBaseDiaristas() {
    if (state.baseLoaded) return;
    const matrizesPermitidas = getMatrizesPermitidas();
    const sessMtz = getSessionMatriz();
    try {
        let q = supabase
            .from('BancoDiaristas')
            .select('NOME, "ID GROOT", LDAP, MATRIZ')
            .not('NOME', 'is', null)
            .not('MATRIZ', 'is', null)
            .order('MATRIZ', {ascending: true})
            .order('NOME', {ascending: true})
            .limit(50000);
        if (matrizesPermitidas?.length) q = q.in('MATRIZ', matrizesPermitidas);
        if (sessMtz && sessMtz !== 'TODOS') q = q.eq('MATRIZ', sessMtz);
        const {data, error} = await q;
        if (error) throw error;
        state.baseByMatriz.clear();
        for (const r of (data || [])) {
            const m = String(r.MATRIZ || '').trim().toUpperCase();
            const item = {
                NOME: String(r.NOME || '').trim().toUpperCase(),
                IDGROOT: String(r['ID GROOT'] || '').trim(),
                LDAP: String(r.LDAP || '').trim().toUpperCase()
            };
            if (!m || !item.NOME) continue;
            if (!state.baseByMatriz.has(m)) state.baseByMatriz.set(m, []);
            state.baseByMatriz.get(m).push(item);
        }
    } catch (e) {
        console.error('Erro carregando BancoDiaristas:', e);
        state.baseByMatriz.clear();
    } finally {
        state.baseLoaded = true;
    }
}

const getBaseListForCurrentMatriz = () => {
    const mtz = String(document.getElementById('f-matriz')?.value || '').trim().toUpperCase();
    return state.baseByMatriz.get(mtz) || [];
};

/* ============ Matrizes & Combos ============ */
async function loadMatrizInfo() {
    state.svcToMatriz.clear();
    state.matrizInfoMap.clear();
    state.matrizesList = [];
    const matrizesPermitidas = getMatrizesPermitidas();
    try {
        let q = supabase
            .from('Matrizes')
            .select('SERVICE, MATRIZ, REGIAO')
            .not('SERVICE', 'is', null)
            .not('MATRIZ', 'is', null)
            .order('SERVICE', {ascending: true})
            .limit(10000);
        if (matrizesPermitidas?.length) q = q.in('MATRIZ', matrizesPermitidas);
        const {data, error} = await q;
        if (error) throw error;

        const all = (data || []).map(r => ({
            SERVICE: String(r.SERVICE || '').trim(),
            MATRIZ: String(r.MATRIZ || '').trim(),
            REGIAO: String(r.REGIAO || '').trim()
        })).filter(r => r.SERVICE && r.MATRIZ);

        const matrizesSet = new Set();
        for (const r of all) {
            if (!state.svcToMatriz.has(r.SERVICE)) state.svcToMatriz.set(r.SERVICE, r.MATRIZ);
            if (r.MATRIZ) {
                matrizesSet.add(r.MATRIZ);
                if (!state.matrizInfoMap.has(r.MATRIZ)) {
                    state.matrizInfoMap.set(r.MATRIZ, {service: r.SERVICE, regiao: r.REGIAO});
                }
            }
        }
        state.matrizesList = [...matrizesSet].sort((a, b) => a.localeCompare(b));


        const uniqueSvcs = [...new Set(all.map(r => r.SERVICE))].sort();
        for (const id of ['f-svc', 'flt-svc']) {
            const el = document.getElementById(id);
            if (!el) continue;
            el.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
            uniqueSvcs.forEach(s => {
                const o = document.createElement('option');
                o.value = s;
                o.textContent = s;
                el.appendChild(o);
            });
        }


        const fltMtz = document.getElementById('flt-matriz');
        if (fltMtz) {
            fltMtz.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
            const sessMtz = getSessionMatriz();
            if (sessMtz && sessMtz !== 'TODOS') {
                const has = [...fltMtz.options].some(o => o.value === sessMtz);
                if (!has) {
                    const opt = document.createElement('option');
                    opt.value = sessMtz;
                    opt.textContent = sessMtz;
                    fltMtz.appendChild(opt);
                }
                fltMtz.value = sessMtz;
                fltMtz.disabled = true;
                state.filters.matriz = sessMtz;
            } else {
                state.matrizesList.forEach(m => {
                    const o = document.createElement('option');
                    o.value = m;
                    o.textContent = m;
                    fltMtz.appendChild(o);
                });
                fltMtz.disabled = false;
            }
        }


        const formMtz = document.getElementById('f-matriz');
        if (formMtz) {
            formMtz.querySelectorAll('option:not([value=""])').forEach(o => o.remove());
            state.matrizesList.forEach(m => {
                const o = document.createElement('option');
                o.value = m;
                o.textContent = m;
                formMtz.appendChild(o);
            });
        }
    } catch (e) {
        console.error('Erro loadMatrizInfo:', e);
    }
}

/* ============ Carrega lançamentos Diarista ============ */
async function loadDiaristas() {
    const CHUNK = 1000;
    let from = 0, all = [];
    const sessMtz = getSessionMatriz();
    const matrizesPermitidas = getMatrizesPermitidas();
    try {
        while (true) {
            let q = supabase
                .from('Diarista')
                .select('Numero, Quantidade, Empresa, Data, "Solicitado Por", "Autorizado Por", Turno, "Nome Diarista", SVC, MATRIZ')
                .order('Numero', {ascending: true})
                .range(from, from + CHUNK - 1);
            if (matrizesPermitidas?.length) q = q.in('MATRIZ', matrizesPermitidas);
            if (sessMtz && sessMtz !== 'TODOS') q = q.eq('MATRIZ', sessMtz);
            const {data, error} = await q;
            if (error) throw error;
            const rows = data || [];
            all = all.concat(rows);
            if (rows.length < CHUNK) break;
            from += CHUNK;
        }
        state.records = all.map(r => ({
            Numero: r.Numero ?? null,
            Quantidade: r.Quantidade ?? null,
            Empresa: r.Empresa ?? '',
            Data: r.Data ?? '',
            'Solicitado Por': r['Solicitado Por'] ?? '',
            'Autorizado Por': r['Autorizado Por'] ?? '',
            Turno: r.Turno ?? '',
            'Nome Diarista': r['Nome Diarista'] ?? '',
            SVC: r.SVC ?? '',
            MATRIZ: r.MATRIZ ?? ''
        }));

        state.records = state.records.map(r => ({...r, Data: diaristaFmtBR(r.Data)}));
        console.log('[Diarista] Carregados:', state.records.length);
    } catch (e) {
        console.warn('Falha loadDiaristas', e);
        state.records = [];
    }
}

/* ============ Filtros & Render ============ */
function filteredRows() {
    const s = state.filters;
    const tStart = safeTime(s.start);
    const tEnd = safeTime(s.end);
    const hasStartEnd = Number.isFinite(tStart) && Number.isFinite(tEnd);

    return (state.records || [])
        .filter(r => {
            const iso = diaristaToISO(r.Data);
            const tRow = safeTime(iso);
            if (hasStartEnd) {
                if (!Number.isFinite(tRow) || tRow < tStart || tRow > tEnd) return false;
            }
            if (s.svc && String(r.SVC || '') !== s.svc) return false;
            if (s.matriz && String(r.MATRIZ || '') !== s.matriz) return false;
            if (s.turno && String(r.Turno || '') !== s.turno) return false;
            return true;
        })
        .sort((a, b) => {
            const ta = safeTime(a.Data), tb = safeTime(b.Data);
            if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
            if (Number.isFinite(tb) && !Number.isFinite(ta)) return -1;
            if (!Number.isFinite(tb) && Number.isFinite(ta)) return 1;
            return Number(b.Numero || 0) - Number(a.Numero || 0);
        });
}

function fillFilterCombos() {
    if (document.getElementById('flt-svc')?.options.length <= 1 || document.getElementById('flt-matriz')?.options.length <= 1) {
        loadMatrizInfo();
    }
}

function renderKPIs() {
    const rows = filteredRows();
    const has = (txt, needle) => new RegExp(needle, 'i').test(String(txt || ''));
    const sumBy = (authPred, turno) => rows
        .filter(r => authPred(r['Autorizado Por']) && (!turno || r.Turno === turno))
        .reduce((acc, r) => acc + Number(r.Quantidade || 0), 0);
    const knT1 = sumBy(v => has(v, 'KN'), 'T1');
    const knT2 = sumBy(v => has(v, 'KN'), 'T2');
    const knT3 = sumBy(v => has(v, 'KN'), 'T3');
    setText('kpiTOP-kn-t1', knT1);
    setText('kpiTOP-kn-t2', knT2);
    setText('kpiTOP-kn-t3', knT3);
    setText('kpiTOP-kn-total', knT1 + knT2 + knT3);
    const mlT1 = sumBy(v => has(v, 'MELI'), 'T1');
    const mlT2 = sumBy(v => has(v, 'MELI'), 'T2');
    const mlT3 = sumBy(v => has(v, 'MELI'), 'T3');
    setText('kpiTOP-meli-t1', mlT1);
    setText('kpiTOP-meli-t2', mlT2);
    setText('kpiTOP-meli-t3', mlT3);
    setText('kpiTOP-meli-total', mlT1 + mlT2 + mlT3);
    setText('kpiTOP-all-t1', knT1 + mlT1);
    setText('kpiTOP-all-t2', knT2 + mlT2);
    setText('kpiTOP-all-t3', knT3 + mlT3);
    setText('kpiTOP-all-total', knT1 + knT2 + knT3 + mlT1 + mlT2 + mlT3);
}

function parseNomeDiaristaField(str) {
    const s = String(str || '').trim();
    if (!s) return [];
    return s.split(/\s*,\s*/).map(pair => {
        const m = /(.*?)(?:\s*\(([^()]*)\))?$/.exec(pair);
        return {nome: (m?.[1] || '').trim(), id: (m?.[2] || '').trim()};
    }).filter(p => p.nome);
}

function renderTable() {
    const tbody = document.getElementById('diaristas-tbody');
    if (!tbody) return;
    const rows = filteredRows();


    const frag = document.createDocumentFragment();
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td>${r.Quantidade ?? ''}</td>
      <td>${escapeHtml(r.Empresa)}</td>
      <td>${escapeHtml(diaristaFmtBR(r.Data))}</td>
      <td>${escapeHtml(r['Solicitado Por'])}</td>
      <td>${escapeHtml(r['Autorizado Por'])}</td>
      <td>${escapeHtml(r.Turno)}</td>
      <td>${escapeHtml(r.SVC)}</td>
      <td>${escapeHtml(r.MATRIZ)}</td>
      <td><button type="button" class="btn-nomes" title="Ver nomes">🗒️</button></td>
    `;
        const btn = tr.querySelector('.btn-nomes');
        if (btn) btn.addEventListener('click', () => openNamesPopover(parseNomeDiaristaField(r['Nome Diarista'])));
        frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
}

/* ============ Popover de nomes ============ */
function ensurePopoverStyles() {
    if (document.getElementById('diaristas-names-popover-style')) return;
    const css = `
  #diaristas-names-popover{position:fixed;z-index:2000;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid #e7ebf4;border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.18);padding:16px 18px 18px;width:min(520px,96vw);max-width:96vw;animation:diaristas-popin .12s ease-out}
  @keyframes diaristas-popin{from{transform:translate(-50%,-50%) scale(.98);opacity:0}to{transform:translate(-50%,-50%) scale(1);opacity:1}}
  #diaristas-names-popover .pop-title{font-size:14px;font-weight:800;color:#003369;margin:0 0 10px;text-align:center}
  #diaristas-names-popover .pop-close{position:absolute;top:8px;right:10px;border:none;background:transparent;font-size:18px;cursor:pointer;color:#56607f;line-height:1}
  #diaristas-names-popover .pop-scroll{max-height:360px;overflow:auto;border:1px solid #f1f3f8;border-radius:10px}
  #diaristas-names-popover table{width:100%;border-collapse:collapse}
  #diaristas-names-popover thead th{text-align:center;font-size:12px;color:#56607f;border-bottom:1px solid #e7ebf4;padding:8px 10px;font-weight:700;background:#f9fbff}
  #diaristas-names-popover tbody td{font-size:13px;color:#242c4c;padding:8px 10px;border-bottom:1px solid #f1f3f8;vertical-align:top;text-align:center;word-break:break-word;background:#fff}
  #diaristas-names-popover tbody tr:last-child td{border-bottom:none}
  `.trim();
    const style = document.createElement('style');
    style.id = 'diaristas-names-popover-style';
    style.textContent = css;
    document.head.appendChild(style);
}

const buildNamesTable = (entries) => {
    const rows = entries.map(e => `<tr><td>${escapeHtml(e.nome || '')}</td><td>${escapeHtml(e.id || '')}</td></tr>`).join('');
    return `<div class="pop-title">Diaristas lançados</div><div class="pop-scroll"><table><thead><tr><th>DIARISTAS</th><th>ID GROOT</th></tr></thead><tbody>${rows || '<tr><td colspan="2">Sem nomes.</td></tr>'}</tbody></table></div>`;
};

function closeNamesPopover() {
    if (state._popover) {
        try {
            state._popover.remove();
        } catch {
        }
        state._popover = null;
    }
}

function openNamesPopover(entries) {
    ensurePopoverStyles();
    closeNamesPopover();
    const pop = document.createElement('div');
    pop.id = 'diaristas-names-popover';
    pop.innerHTML = `<button class="pop-close" title="Fechar" aria-label="Fechar">&times;</button>${buildNamesTable(entries)}`;
    document.body.appendChild(pop);
    state._popover = pop;
    pop.querySelector('.pop-close')?.addEventListener('click', closeNamesPopover);
}

/* ============ UI (wire) ============ */
function openPeriodModalDiarista() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '9997'
    });
    const modal = document.createElement('div');
    Object.assign(modal.style, {
        background: '#fff',
        borderRadius: '12px',
        padding: '16px',
        minWidth: '420px',
        boxShadow: '0 10px 30px rgba(0,0,0,.25)'
    });
    const h3 = document.createElement('h3');
    h3.textContent = 'Selecionar Período';
    h3.style.margin = '0 0 12px 0';
    const grid = document.createElement('div');
    Object.assign(grid.style, {display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px'});

    const l1 = document.createElement('label');
    l1.textContent = 'Início';
    l1.style.display = 'block';
    const i1 = document.createElement('input');
    i1.type = 'date';
    i1.value = state.filters.start || '';
    const l2 = document.createElement('label');
    l2.textContent = 'Fim';
    l2.style.display = 'block';
    const i2 = document.createElement('input');
    i2.type = 'date';
    i2.value = state.filters.end || '';
    grid.append(Object.assign(document.createElement('div'), {
        append: () => {
        }
    }));

    const left = document.createElement('div');
    left.append(l1, i1);
    const right = document.createElement('div');
    right.append(l2, i2);
    grid.append(left, right);

    const actions = document.createElement('div');
    Object.assign(actions.style, {display: 'flex', justifyContent: 'flex-end', gap: '8px'});
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancelar';
    cancel.className = 'btn-cancelar';
    const ok = document.createElement('button');
    ok.textContent = 'Aplicar';
    ok.className = 'btn-salvar';
    actions.append(cancel, ok);

    modal.append(h3, grid, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => i1.focus(), 0);
    cancel.addEventListener('click', () => document.body.removeChild(overlay));
    ok.addEventListener('click', () => {
        if (!i1.value || !i2.value) return alert('Selecione as duas datas.');
        state.filters.start = i1.value;
        state.filters.end = i2.value;
        renderKPIs();
        renderTable();
        document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', e => {
        if (e.target === overlay) document.body.removeChild(overlay);
    });
}

function buildNomeSelect(index, selectedName = '') {
    const list = getBaseListForCurrentMatriz();
    const sel = document.createElement('select');
    sel.className = 'f-nome-sel';
    sel.id = `f-nome-${index}`;
    sel.required = true;
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Selecione o diarista...';
    sel.appendChild(opt0);
    const selectedNorm = normalizeNameForMatch(selectedName);
    list.forEach(p => {
        const o = document.createElement('option');
        o.value = p.NOME;
        o.textContent = p.NOME;
        o.dataset.idgroot = p.IDGROOT || '';
        o.dataset.ldap = p.LDAP || '';
        if (selectedName && normalizeNameForMatch(p.NOME) === selectedNorm) o.selected = true;
        sel.appendChild(o);
    });
    return sel;
}

function updateNameInputs(preserve = true) {
    const raw = document.getElementById('f-quantidade').value;
    const qty = Math.max(1, parseInt(raw, 10) || 1);
    const box = document.getElementById('names-list');
    let prevSelected = [];
    if (preserve) prevSelected = Array.from(box.querySelectorAll('.f-nome-sel,.f-nome')).map(el => String(el.value || ''));
    box.innerHTML = '';

    const baseList = getBaseListForCurrentMatriz();
    const hasBase = baseList.length > 0;

    for (let i = 1; i <= qty; i++) {
        const wrapNome = document.createElement('div');
        wrapNome.className = 'form-group';
        wrapNome.style.gridColumn = 'span 2';
        const labelNome = document.createElement('label');
        labelNome.setAttribute('for', `f-nome-${i}`);
        labelNome.textContent = `Nome ${i}`;
        wrapNome.appendChild(labelNome);
        let nomeControl;

        if (hasBase) {
            nomeControl = buildNomeSelect(i, preserve ? (prevSelected[i - 1] || '') : '');
        } else {
            nomeControl = document.createElement('input');
            nomeControl.type = 'text';
            nomeControl.id = `f-nome-${i}`;
            nomeControl.className = 'f-nome';
            nomeControl.placeholder = `Nome ${i}`;
            nomeControl.required = true;
            if (preserve) nomeControl.value = prevSelected[i - 1] || '';
        }
        wrapNome.appendChild(nomeControl);

        const wrapId = document.createElement('div');
        wrapId.className = 'form-group';
        const labelId = document.createElement('label');
        labelId.setAttribute('for', `f-groot-${i}`);
        labelId.textContent = `ID GROOT ${i}`;
        const idInput = document.createElement('input');
        idInput.type = 'text';
        idInput.id = `f-groot-${i}`;
        idInput.className = 'f-groot';
        idInput.placeholder = `ID ${i}`;
        if (hasBase) {
            idInput.readOnly = true;
            idInput.style.background = '#f5f7fb';
            idInput.style.cursor = 'not-allowed';
        }
        if (hasBase && nomeControl.tagName === 'SELECT') {
            nomeControl.addEventListener('change', () => {
                const opt = nomeControl.options[nomeControl.selectedIndex];
                idInput.value = opt?.dataset?.idgroot || '';
            });
            setTimeout(() => {
                const opt = nomeControl.options[nomeControl.selectedIndex];
                idInput.value = opt?.dataset?.idgroot || '';
            }, 0);
        }
        wrapId.append(labelId, idInput);
        box.append(wrapNome, wrapId);
    }
}

function wireUI() {

    const d0 = new Date();
    d0.setDate(1);
    state.filters.start = dateToISO_BR(d0);
    state.filters.end = todayISO_BR();

    const $svc = document.getElementById('flt-svc');
    const $mtz = document.getElementById('flt-matriz');
    const $turno = document.getElementById('flt-turno');
    on(document.getElementById('btn-period-select'), 'click', openPeriodModalDiarista);
    on($svc, 'change', e => {
        state.filters.svc = e.target.value;
        renderKPIs();
        renderTable();
    });
    on($mtz, 'change', e => {
        state.filters.matriz = e.target.value;
        renderKPIs();
        renderTable();
    });
    on($turno, 'change', e => {
        state.filters.turno = e.target.value;
        renderKPIs();
        renderTable();
    });
    on(document.getElementById('btn-export-xlsx'), 'click', exportXLSX);
    on(document.getElementById('btn-add-diarista'), 'click', openModal);
    on(document.getElementById('btn-cancel-modal'), 'click', closeModal);
    on(document.getElementById('f-quantidade'), 'input', () => updateNameInputs(true));
    on(document.getElementById('f-quantidade'), 'change', () => updateNameInputs(true));
    on(document.getElementById('f-svc'), 'change', (e) => {
        const svc = e.target.value;
        const mtzEl = document.getElementById('f-matriz');
        if (mtzEl) mtzEl.value = state.svcToMatriz.get(svc) || '';
        updateNameInputs(true);
    });
    on(document.getElementById('diarista-form'), 'submit', onSubmitForm);
    on(document.getElementById('f-matriz'), 'change', () => updateNameInputs(true));
    on(document.getElementById('reg-cancel-modal'), 'click', closeRegistrarModal);
    on(document.getElementById('registrar-diarista-form'), 'submit', onSubmitRegistrarForm);
    on(document.getElementById('reg-matriz'), 'change', onRegistrarMatrizChange);
    on(document.getElementById('btn-gerenciar'), 'click', openGerenciarModal);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeNamesPopover();
            closeModal();
            closeRegistrarModal();
            closeGerenciarModal();
        }
    });
    document.addEventListener('click', (e) => {
        if (state._popover && !state._popover.contains(e.target) && !e.target.closest('.btn-nomes')) closeNamesPopover();
    }, {passive: true});
    window.addEventListener('scroll', closeNamesPopover, {passive: true});
}

/* ============ Lifecycle ============
   init/destroy expostos
==================================== */
export async function init() {
    if (state.mounted) return;
    state.mounted = true;
    wireUI();
    await loadMatrizInfo();
    await loadBaseDiaristas();
    await loadDiaristas();
    fillFilterCombos();
    renderKPIs();
    renderTable();
}

export async function destroy() {
    try {
        state._listeners.forEach(off => off());
    } catch {
    }
    state._listeners = [];
    state.mounted = false;
    closeNamesPopover();
}

/* ============ Modal de Lançamento ============ */
function openModal() {
    if (document.body.classList.contains('user-level-visitante')) return;
    document.getElementById('f-quantidade').value = 1;
    document.getElementById('f-empresa').value = '';
    document.getElementById('f-solicitado').value = '';
    document.getElementById('f-autorizado').value = '';
    document.getElementById('f-turno').value = '';
    const fSvc = document.getElementById('f-svc');
    if (fSvc) fSvc.value = '';
    const fMtz = document.getElementById('f-matriz');
    const sessMtz = getSessionMatriz();
    if (fMtz) {
        if (sessMtz && sessMtz !== 'TODOS') {
            fMtz.value = sessMtz;
            fMtz.disabled = true;
        } else {
            fMtz.value = '';
            fMtz.disabled = false;
        }
    }
    document.getElementById('f-data').value = todayISO_BR();
    updateNameInputs(false);
    document.getElementById('diarista-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('f-empresa')?.focus(), 0);
}

function closeModal() {
    document.getElementById('diarista-modal').classList.add('hidden');
    const fMtz = document.getElementById('f-matriz');
    if (fMtz) fMtz.disabled = false;
}

/* ============ Submit Lançamento ============ */
async function onSubmitForm(ev) {
    ev.preventDefault();
    if (document.body.classList.contains('user-level-visitante')) return alert('Ação não permitida. Você está em modo de visualização.');

    const qtd = Math.max(1, parseInt(document.getElementById('f-quantidade').value, 10) || 1);
    const empresa = String(document.getElementById('f-empresa').value || '').trim();
    const solicitado = String(document.getElementById('f-solicitado').value || '').trim();
    const autorizado = String(document.getElementById('f-autorizado').value || '').trim();
    const turno = String(document.getElementById('f-turno').value || '').trim();
    const svc = String(document.getElementById('f-svc').value || '').trim();
    const matriz = String(document.getElementById('f-matriz').value || '').trim();
    const dataISO = diaristaToISO(document.getElementById('f-data').value);

    const nomeSelects = Array.from(document.querySelectorAll('.f-nome-sel'));
    const nomeInputs = Array.from(document.querySelectorAll('.f-nome'));
    const idsInputs = Array.from(document.querySelectorAll('.f-groot'));

    let nomes = nomeSelects.length
        ? nomeSelects.map(s => String(s.value || '').trim()).filter(Boolean)
        : nomeInputs.map(i => String(i.value || '').trim()).filter(Boolean);
    const ids = idsInputs.map(i => String(i.value || '').trim());

    if (!dataISO) return alert('Data inválida.');
    if (nomes.length !== qtd || idsInputs.length !== qtd) return alert('Quantidade e nomes/IDs não conferem.');


    let numero = 1;
    try {
        const {
            data: maxData,
            error: maxErr
        } = await supabase.from('Diarista').select('Numero').order('Numero', {ascending: false}).limit(1);
        if (maxErr) throw maxErr;
        numero = (maxData?.[0]?.Numero) ? (Number(maxData[0].Numero) + 1) : 1;
    } catch {
        const curMax = Math.max(0, ...state.records.map(r => Number(r.Numero || 0)));
        numero = curMax + 1;
    }

    const nomeDiarista = nomes.map((n, idx) => formatNomeComId(n, ids[idx])).join(', ');
    const payload = {
        Numero: numero,
        Quantidade: Number(qtd),
        Empresa: empresa,
        Data: dataISO,
        'Solicitado Por': solicitado,
        'Autorizado Por': autorizado,
        Turno: turno,
        'Nome Diarista': nomeDiarista,
        SVC: svc,
        MATRIZ: matriz
    };

    try {
        const {error} = await supabase.from('Diarista').insert(payload);
        if (error) throw error;
        state.records.push({...payload, Data: diaristaFmtBR(payload.Data)});
        closeModal();
        renderKPIs();
        renderTable();
    } catch (e) {
        console.error('Erro onSubmitForm', e);
        alert('Falha ao salvar. Veja o console.');
    }
}

/* ============ Registrar Diarista (Base) ============ */
function openRegistrarModal() {
    if (document.body.classList.contains('user-level-visitante')) return;
    const regOverlay = document.getElementById('registrar-diarista-modal');
    if (regOverlay && regOverlay.parentNode !== document.body) document.body.appendChild(regOverlay);
    regOverlay.style.zIndex = '11000';
    for (const id of ['reg-nome', 'reg-id-groot', 'reg-ldap', 'reg-svc', 'reg-regiao']) document.getElementById(id).value = '';
    const selMatriz = document.getElementById('reg-matriz');
    selMatriz.innerHTML = '<option value="" disabled selected>Selecione a Matriz...</option>';
    state.matrizesList.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        selMatriz.appendChild(opt);
    });
    regOverlay.classList.remove('hidden');
    setTimeout(() => document.getElementById('reg-nome')?.focus(), 0);
}

function closeRegistrarModal() {
    document.getElementById('registrar-diarista-modal').classList.add('hidden');
}

function onRegistrarMatrizChange(ev) {
    const matriz = ev.target.value;
    const info = state.matrizInfoMap.get(matriz);
    document.getElementById('reg-svc').value = info?.service || '';
    document.getElementById('reg-regiao').value = info?.regiao || '';
}

async function onSubmitRegistrarForm(ev) {
    ev.preventDefault();
    if (document.body.classList.contains('user-level-visitante')) return alert('Ação não permitida. Você está em modo de visualização.');

    const nome = String(document.getElementById('reg-nome').value || '').trim().toUpperCase();
    const idG = String(document.getElementById('reg-id-groot').value || '').trim().toUpperCase();
    const ldap = String(document.getElementById('reg-ldap').value || '').trim().toUpperCase();
    const matriz = String(document.getElementById('reg-matriz').value || '').trim().toUpperCase();
    const svc = String(document.getElementById('reg-svc').value || '').trim().toUpperCase();
    const reg = String(document.getElementById('reg-regiao').value || '').trim().toUpperCase();

    if (!nome || !matriz) return alert('Preencha Nome e Matriz.');
    if (!idG && !ldap) return alert('Preencha ID GROOT ou LDAP.');

    try {
        const orConds = [];
        if (idG) orConds.push(`"ID GROOT".eq.${idG}`);
        if (ldap) orConds.push(`LDAP.eq.${ldap}`);
        const {data: existing, error: checkError} = await supabase
            .from('BancoDiaristas').select('"ID GROOT", LDAP').eq('MATRIZ', matriz).or(orConds.join(','));
        if (checkError) throw new Error(`Erro check duplicidade: ${checkError.message}`);
        if (existing?.length) {
            if (idG && existing.some(r => r['ID GROOT'] === idG)) return alert(`Erro: ID GROOT "${idG}" já existe para MATRIZ "${matriz}".`);
            if (ldap && existing.some(r => r.LDAP === ldap)) return alert(`Erro: LDAP "${ldap}" já existe para MATRIZ "${matriz}".`);
        }

        const {
            data: maxData,
            error: maxErr
        } = await supabase.from('BancoDiaristas').select('ID').order('ID', {ascending: false}).limit(1);
        if (maxErr) throw new Error(`Erro busca ID: ${maxErr.message}`);
        const nextId = (maxData?.[0]?.ID) ? (Number(maxData[0].ID) + 1) : 1;

        const payload = {
            ID: nextId,
            NOME: nome,
            'ID GROOT': idG || null,
            LDAP: ldap || null,
            MATRIZ: matriz,
            SVC: svc,
            REGIAO: reg
        };
        const {error: insertError} = await supabase.from('BancoDiaristas').insert(payload);
        if (insertError) throw new Error(`Erro ao salvar: ${insertError.message}`);
        alert(`Diarista "${nome}" registrado!\nID: ${nextId}`);
        closeRegistrarModal();


        const matrizesPermitidas = getMatrizesPermitidas();
        const sessMtz = getSessionMatriz();
        const permitido = (!matrizesPermitidas?.length || matrizesPermitidas.includes(matriz)) &&
            (!sessMtz || sessMtz === 'TODOS' || sessMtz === matriz);
        if (permitido) {
            const newRow = {
                ID: nextId,
                NOME: nome,
                IDGROOT: idG || '',
                LDAP: ldap || '',
                SVC: svc,
                MATRIZ: matriz,
                REGIAO: reg
            };
            state.gerenciar.all.push(newRow);
            state.gerenciar.all.sort((a, b) => (a.ID || 0) - (b.ID || 0));
            if (isGerenciarOpen()) {
                applyGerenciarFilters();
            }
        }
    } catch (e) {
        console.error('Falha onSubmitRegistrarForm:', e);
        alert(`Erro: ${e.message}`);
    }
}

/* ============ Export ============ */
function exportXLSX() {
    const rows = filteredRows();
    if (!rows.length) return alert('Não há dados para exportar.');
    const headerOrder = ['Quantidade', 'Empresa', 'Data', 'Solicitado Por', 'Autorizado Por', 'Turno', 'SVC', 'MATRIZ', 'Nome Diarista'];
    const data = rows.map(r => ({
        Quantidade: r.Quantidade ?? '',
        Empresa: r.Empresa ?? '',
        Data: diaristaFmtBR(r.Data) ?? '',
        'Solicitado Por': r['Solicitado Por'] ?? '',
        'Autorizado Por': r['Autorizado Por'] ?? '',
        Turno: r.Turno ?? '',
        SVC: r.SVC ?? '',
        MATRIZ: r.MATRIZ ?? '',
        'Nome Diarista': r['Nome Diarista'] ?? ''
    }));
    if (window.XLSX) {
        const ws = XLSX.utils.json_to_sheet([], {header: headerOrder});
        XLSX.utils.sheet_add_aoa(ws, [headerOrder], {origin: 'A1'});
        const rowsAOA = data.map(obj => headerOrder.map(k => obj[k]));
        XLSX.utils.sheet_add_aoa(ws, rowsAOA, {origin: 'A2'});
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Diaristas');
        XLSX.writeFile(wb, `diaristas_${state.filters.start}_a_${state.filters.end}.xlsx`);
    } else {
        const header = headerOrder;
        const csv = [header.join(';')].concat(data.map(r => header.map(k => String(r[k] ?? '').replace(/;/g, ',')).join(';'))).join('\n');
        const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `diaristas_${state.filters.start}_a_${state.filters.end}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}

/* ============ GERENCIAR (Base) ============ */
function ensureGerenciarStyles() {
    if (document.getElementById('gerenciar-style')) return;
    const css = `
  .diaristas-modal{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);z-index:9999}
  .diaristas-modal.hidden{display:none}
  .diaristas-modal .modal-card{background:#fff;border-radius:14px;width:min(1060px,96vw);max-height:86vh;display:flex;flex-direction:column;box-shadow:0 18px 40px rgba(0,0,0,.25)}
  .diaristas-modal .modal-card>h3{display:flex;align-items:center;justify-content:center;text-align:center;margin:14px 16px 8px;font-size:16px;font-weight:800;color:#003369}
  #gerenciar-header{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #eef2f7}
  #gerenciar-table{width:100%;border-collapse:collapse}
  #gerenciar-table th{position:sticky;top:0;background:#f9fbff;z-index:1}
  #gerenciar-table th,#gerenciar-table td{font-size:13px;color:#24304a;border-bottom:1px solid #eef2f7;padding:8px 10px;text-align:left}
  #gerenciar-table tbody tr.selecionado{background:#E9FBE5;outline:2px solid #B8E7B0}
  `.trim();
    const style = document.createElement('style');
    style.id = 'gerenciar-style';
    style.textContent = css;
    document.head.appendChild(style);
}

function buildGerenciarModal() {
    if (document.getElementById('gerenciar-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'gerenciar-modal';
    overlay.className = 'diaristas-modal hidden';
    overlay.innerHTML = `
    <div class="modal-card">
      <h3>Gerenciar Diaristas</h3>
      <div class="form-grid" style="grid-template-columns:1fr auto auto auto auto;align-items:end;gap:10px;padding:10px 16px;">
        <div class="form-group" style="min-width:250px;">
          <label for="gerenciar-search-input" style="font-weight:700;">Busca</label>
          <input id="gerenciar-search-input" type="text" placeholder="Nome, ID GROOT ou LDAP (vírgulas)"/>
        </div>
        <div class="form-group">
          <label for="gerenciar-filter-matriz" style="font-weight:700;">Matriz</label>
          <select id="gerenciar-filter-matriz"><option value="">Matrizes</option></select>
        </div>
        <div class="form-group"><button id="gerenciar-registrar-btn" class="btn-salvar" style="border-radius:24px;background:#003369;width:100%">Registrar</button></div>
        <div class="form-group"><button id="gerenciar-qrcode-btn" class="btn-salvar" style="border-radius:24px;background:#0b5fff;width:100%">QRCODE</button></div>
        <div class="form-group"><button id="gerenciar-clear-btn" class="btn-cancelar" style="border-radius:24px;width:100%">Limpar</button></div>
      </div>
      <div class="table-wrapper" id="gerenciar-table-wrapper">
        <table class="diaristas-table" id="gerenciar-table">
          <thead>
            <tr>
              <th style="min-width:240px;">Nome</th>
              <th style="min-width:140px;">ID GROOT</th>
              <th style="min-width:140px;">LDAP</th>
              <th style="min-width:120px;">SVC</th>
              <th style="min-width:140px;">MATRIZ</th>
              <th style="min-width:160px;">Ações</th>
            </tr>
          </thead>
          <tbody id="gerenciar-tbody"></tbody>
        </table>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeGerenciarModal();
    });
    const $input = document.getElementById('gerenciar-search-input');
    let debounce;
    $input.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(applyGerenciarFilters, 250);
    });
    $input.addEventListener('keydown', e => {
        if (e.key === 'Enter') applyGerenciarFilters();
    });
    document.getElementById('gerenciar-filter-matriz').addEventListener('change', applyGerenciarFilters);
    document.getElementById('gerenciar-registrar-btn').addEventListener('click', openRegistrarModal);
    document.getElementById('gerenciar-qrcode-btn').addEventListener('click', gerarQRCodesGerenciar);
    document.getElementById('gerenciar-clear-btn').addEventListener('click', limparGerenciar);
}

async function openGerenciarModal() {
    ensureGerenciarStyles();
    buildGerenciarModal();
    const $input = document.getElementById('gerenciar-search-input');
    if ($input) $input.value = '';
    state.gerenciar.searchRaw = '';
    state.gerenciar.selectedNames = new Set();
    const overlay = document.getElementById('gerenciar-modal');
    overlay.classList.remove('hidden');

    await ensureBancoDiaristasLoaded();


    const $matrizFilter = document.getElementById('gerenciar-filter-matriz');
    if ($matrizFilter) {
        while ($matrizFilter.options.length > 1) $matrizFilter.remove(1);
        [...new Set(state.gerenciar.all.map(r => r.MATRIZ))].filter(Boolean).sort()
            .forEach(m => {
                const o = document.createElement('option');
                o.value = m;
                o.textContent = m;
                $matrizFilter.appendChild(o);
            });
        $matrizFilter.value = '';
    }
    applyGerenciarFilters();
}

function closeGerenciarModal() {
    const o = document.getElementById('gerenciar-modal');
    if (o) o.classList.add('hidden');
    closeGerenciarEditModal();
    const $i = document.getElementById('gerenciar-search-input');
    if ($i) $i.value = '';
    state.gerenciar.searchRaw = '';
}

/* BancoDiaristas cache */
async function ensureBancoDiaristasLoaded() {
    if (state.gerenciar.loaded) return;
    const matrizesPermitidas = getMatrizesPermitidas();
    const sessMtz = getSessionMatriz();
    try {
        let q = supabase.from('BancoDiaristas').select('ID, NOME, "ID GROOT", LDAP, SVC, MATRIZ, REGIAO').order('ID', {ascending: true}).limit(20000);
        if (matrizesPermitidas?.length) q = q.in('MATRIZ', matrizesPermitidas);
        if (sessMtz && sessMtz !== 'TODOS') q = q.eq('MATRIZ', sessMtz);
        const {data, error} = await q;
        if (error) throw error;
        state.gerenciar.all = (data || []).map(r => ({
            ID: r.ID,
            NOME: String(r.NOME || '').trim().toUpperCase(),
            IDGROOT: String(r['ID GROOT'] || '').trim(),
            LDAP: String(r.LDAP || '').trim().toUpperCase(),
            SVC: String(r.SVC || '').trim().toUpperCase(),
            MATRIZ: String(r.MATRIZ || '').trim().toUpperCase(),
            REGIAO: String(r.REGIAO || '').trim().toUpperCase()
        }));
    } catch (e) {
        console.error('Falha ao carregar BancoDiaristas:', e);
        state.gerenciar.all = [];
    } finally {
        state.gerenciar.loaded = true;
    }
}

function limparGerenciar() {
    const $input = document.getElementById('gerenciar-search-input');
    const $matrizFilter = document.getElementById('gerenciar-filter-matriz');
    if ($input) $input.value = '';
    if ($matrizFilter) $matrizFilter.value = '';
    state.gerenciar.searchRaw = '';
    state.gerenciar.selectedNames = new Set();
    applyGerenciarFilters();
}

function renderGerenciarTable() {
    const tbody = document.getElementById('gerenciar-tbody');
    if (!tbody) return;
    const rows = state.gerenciar.filtered || [];
    const frag = document.createDocumentFragment();
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6">Sem resultados.</td></tr>`;
        return;
    }
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.dataset.nome = r.NOME || '';
        tr.dataset.idgroot = r.IDGROOT || '';
        tr.innerHTML = `
      <td>${escapeHtml(r.NOME)}</td>
      <td>${escapeHtml(r.IDGROOT)}</td>
      <td>${escapeHtml(r.LDAP)}</td>
      <td>${escapeHtml(r.SVC)}</td>
      <td>${escapeHtml(r.MATRIZ)}</td>
      <td>
        <button class="btn-salvar" data-act="edit" data-id="${r.ID}" style="border-radius:20px;padding:6px 10px;">Editar</button>
        <button class="btn-cancelar" data-act="del"  data-id="${r.ID}" style="border-radius:20px;padding:6px 10px;">Excluir</button>
      </td>`;
        tr.addEventListener('click', (ev) => {
            if (ev.target.closest('button')) return;
            const set = state.gerenciar.selectedNames || (state.gerenciar.selectedNames = new Set());
            if (ev.shiftKey) {
                tbody.querySelectorAll('tr').forEach(rowEl => {
                    const nm = rowEl.dataset.nome;
                    if (nm) {
                        set.add(nm);
                        rowEl.classList.add('selecionado');
                    }
                });
                return;
            }
            if (ev.ctrlKey) {
                const nome = tr.dataset.nome;
                if (!nome) return;
                if (set.has(nome)) {
                    set.delete(nome);
                    tr.classList.remove('selecionado');
                } else {
                    set.add(nome);
                    tr.classList.add('selecionado');
                }
            }
        });
        if (state.gerenciar.selectedNames && state.gerenciar.selectedNames.has(r.NOME)) tr.classList.add('selecionado');
        frag.appendChild(tr);
    });
    tbody.innerHTML = '';
    tbody.appendChild(frag);
    tbody.querySelectorAll('button[data-act="edit"]').forEach(btn => btn.addEventListener('click', () => startEditGerenciar(Number(btn.dataset.id))));
    tbody.querySelectorAll('button[data-act="del"]').forEach(btn => btn.addEventListener('click', () => deleteGerenciar(Number(btn.dataset.id))));
}

function applyGerenciarFilters() {
    const input = document.getElementById('gerenciar-search-input');
    const matrizFilter = document.getElementById('gerenciar-filter-matriz');
    if (!input || !matrizFilter) return;

    const rawSearch = String(input.value || '').trim();
    const selectedMatriz = matrizFilter.value;
    state.gerenciar.searchRaw = rawSearch;

    if (!state.gerenciar.loaded) {
        ensureBancoDiaristasLoaded().then(applyGerenciarFilters);
        return;
    }

    let results = state.gerenciar.all;
    if (selectedMatriz) results = results.filter(row => row.MATRIZ === selectedMatriz);

    if (rawSearch) {
        const terms = rawSearch.split(',').map(t => t.trim()).filter(Boolean);
        const normTerms = terms.map(normalizeNameForMatch);
        results = results.filter(row => {
            const nNome = normalizeNameForMatch(row.NOME);
            const nG = normalizeNameForMatch(row.IDGROOT);
            const nL = normalizeNameForMatch(row.LDAP);
            return normTerms.some(term => nNome.includes(term) || (term && nG.includes(term)) || (term && nL.includes(term)));
        });
    }
    state.gerenciar.filtered = results.slice(0, 10000);
    renderGerenciarTable();
}

/* ============ Editar / Excluir (Gerenciar) ============ */
function openGerenciarEditModal(entity) {
    closeGerenciarEditModal();
    const overlay = document.createElement('div');
    overlay.id = 'gerenciar-edit-modal';
    overlay.className = 'diaristas-modal';
    overlay.style.zIndex = '12000';
    const regModal = document.getElementById('registrar-diarista-modal');
    if (regModal && !regModal.classList.contains('hidden')) regModal.style.zIndex = '11000';
    const matrizOptions = state.matrizesList.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    overlay.innerHTML = `
    <div class="modal-card">
      <h3>Editar Diarista</h3>
      <div class="form-grid" style="grid-template-columns: repeat(3, minmax(0,1fr));">
        <div class="form-group"><label>ID (PK)</label><input id="ger-ed-id" type="text" value="${escapeHtml(entity.ID)}" readonly></div>
        <div class="form-group" style="grid-column: span 2;"><label>Nome</label><input id="ger-ed-nome" type="text" value="${escapeHtml(entity.NOME)}" placeholder="Nome completo"></div>
        <div class="form-group"><label>ID GROOT</label><input id="ger-ed-groot" type="text" value="${escapeHtml(entity.IDGROOT)}" placeholder="ID GROOT"></div>
        <div class="form-group"><label>LDAP</label><input id="ger-ed-ldap" type="text" value="${escapeHtml(entity.LDAP)}" placeholder="LDAP"></div>
        <div class="form-group"><label>Matriz</label><select id="ger-ed-matriz">${matrizOptions}</select></div>
        <div class="form-group"><label>SVC</label><input id="ger-ed-svc" type="text" value="${escapeHtml(entity.SVC)}" placeholder="SVC"></div>
        <div class="form-group"><label>Região</label><input id="ger-ed-regiao" type="text" value="${escapeHtml(entity.REGIAO)}" placeholder="REGIÃO"></div>
      </div>
      <div class="form-actions">
        <button id="gerenciar-edit-cancel" class="btn-cancelar">Cancelar</button>
        <button id="gerenciar-edit-save"   class="btn-salvar">Salvar alterações</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#ger-ed-matriz').value = entity.MATRIZ || '';
    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeGerenciarEditModal();
    });
    overlay.querySelector('#gerenciar-edit-cancel').addEventListener('click', closeGerenciarEditModal);
    overlay.querySelector('#gerenciar-edit-save').addEventListener('click', saveGerenciarEdit);
    setTimeout(() => overlay.querySelector('#ger-ed-nome')?.focus(), 0);
}

function closeGerenciarEditModal() {
    const o = document.getElementById('gerenciar-edit-modal');
    if (o) o.remove();
}

function startEditGerenciar(id) {
    if (document.body.classList.contains('user-level-visitante')) return;
    const row = state.gerenciar.all.find(r => r.ID === id);
    if (!row) return;
    state.gerenciar.editing = {...row};
    openGerenciarEditModal(row);
}

async function substituirNomeEmDiaristaLancamentos(oldNome, newNome) {


    if (!oldNome || !newNome || oldNome === newNome) return 0;
    const alvo = normalizeNameForMatch(oldNome);
    let count = 0;
    const updates = [];
    for (const r of state.records) {
        const s = String(r['Nome Diarista'] || '').trim();
        if (!s) continue;
        const parts = s.split(/\s*,\s*/).map(p => p.trim());
        let changed = false;
        const partsNew = parts.map(p => {
            const m = /(.*?)(?:\s*\(([^()]*)\))?$/.exec(p);
            const nome = (m?.[1] || '').trim();
            const id = (m?.[2] || '').trim();
            if (normalizeNameForMatch(nome) === alvo) {
                changed = true;
                return formatNomeComId(newNome, id);
            }
            return p;
        });
        if (changed) {
            updates.push({Numero: r.Numero, Novo: partsNew.join(', ')});
        }
    }
    for (const u of updates) {
        const {error} = await supabase.from('Diarista').update({'Nome Diarista': u.Novo}).eq('Numero', u.Numero);
        if (!error) count++;
    }

    state.records.forEach(r => {
        const s = String(r['Nome Diarista'] || '').trim();
        if (!s) return;
        const alvoN = normalizeNameForMatch(oldNome);
        const parts = s.split(/\s*,\s*/).map(p => p.trim());
        const partsNew = parts.map(p => {
            const m = /(.*?)(?:\s*\(([^()]*)\))?$/.exec(p);
            const nome = (m?.[1] || '').trim();
            const id = (m?.[2] || '').trim();
            return (normalizeNameForMatch(nome) === alvoN) ? formatNomeComId(newNome, id) : p;
        });
        r['Nome Diarista'] = partsNew.join(', ');
    });
    return count;
}

async function saveGerenciarEdit() {
    if (document.body.classList.contains('user-level-visitante')) return alert('Ação não permitida. Você está em modo de visualização.');
    const ctx = state.gerenciar.editing;
    if (!ctx) return;
    const overlay = document.getElementById('gerenciar-edit-modal');
    const newNome = String(overlay.querySelector('#ger-ed-nome').value || '').trim().toUpperCase();
    const newGroot = String(overlay.querySelector('#ger-ed-groot').value || '').trim();
    const newLdap = String(overlay.querySelector('#ger-ed-ldap').value || '').trim().toUpperCase();
    const newMatriz = String(overlay.querySelector('#ger-ed-matriz').value || '').trim().toUpperCase();
    const newSvc = String(overlay.querySelector('#ger-ed-svc').value || '').trim().toUpperCase();
    const newReg = String(overlay.querySelector('#ger-ed-regiao').value || '').trim().toUpperCase();

    if (!newNome) return alert('Informe o Nome.');
    if (!newMatriz) return alert('Informe a Matriz.');


    if (newNome !== ctx.NOME) {
        try {
            const changedCount = await substituirNomeEmDiaristaLancamentos(ctx.NOME, newNome);
            console.log(`Substituições na tabela "Diarista": ${changedCount}`);
        } catch (e) {
            console.error('Falha substituindo nome na Diarista:', e);
            const cont = confirm('Falhou ao atualizar o nome na tabela Diarista. Deseja continuar assim mesmo?');
            if (!cont) return;
        }
    }

    try {
        const payload = {
            NOME: newNome,
            'ID GROOT': newGroot || null,
            LDAP: newLdap || null,
            MATRIZ: newMatriz,
            SVC: newSvc,
            REGIAO: newReg
        };
        const {error} = await supabase.from('BancoDiaristas').update(payload).eq('ID', ctx.ID);
        if (error) throw error;


        Object.assign(ctx, {
            NOME: newNome,
            IDGROOT: newGroot || '',
            LDAP: newLdap || '',
            MATRIZ: newMatriz,
            SVC: newSvc,
            REGIAO: newReg
        });
        const idxAll = state.gerenciar.all.findIndex(r => r.ID === ctx.ID);
        if (idxAll >= 0) state.gerenciar.all[idxAll] = {...ctx};
        const idxFiltered = (state.gerenciar.filtered || []).findIndex(r => r.ID === ctx.ID);
        if (idxFiltered >= 0) state.gerenciar.filtered[idxFiltered] = {...ctx};

        renderGerenciarTable();
        closeGerenciarEditModal();
        alert('Alterações salvas.');
    } catch (e) {
        console.error('Erro ao salvar edição:', e);
        alert('Falha ao salvar. Veja o console.');
    }
}

async function deleteGerenciar(id) {
    if (document.body.classList.contains('user-level-visitante')) return alert('Ação não permitida. Você está em modo de visualização.');
    const row = state.gerenciar.all.find(r => r.ID === id);
    if (!row) return;
    if (!confirm(`Excluir diarista "${row.NOME}" (ID ${row.ID})?`)) return;
    try {
        const {error} = await supabase.from('BancoDiaristas').delete().eq('ID', id);
        if (error) throw error;
        state.gerenciar.all = state.gerenciar.all.filter(r => r.ID !== id);
        state.gerenciar.filtered = (state.gerenciar.filtered || []).filter(r => r.ID !== id);
        renderGerenciarTable();
        alert('Excluído com sucesso.');
    } catch (e) {
        console.error('Erro ao excluir:', e);
        alert('Falha ao excluir. Veja o console.');
    }
}

/* ============ QR Codes (Gerenciar) ============ */
async function gerarQRCodesGerenciar() {
    const set = state.gerenciar.selectedNames || new Set();
    if (set.size === 0) return alert('Nenhum diarista selecionado. Use Ctrl+Click nas linhas para selecionar.');
    const selecionados = (state.gerenciar.all || []).filter(r => set.has(r.NOME));
    const comId = selecionados.filter(r => r.IDGROOT && String(r.IDGROOT).trim() !== '');
    const faltantes = selecionados.length - comId.length;
    if (faltantes > 0) alert(`Aviso: ${selecionados.length} selecionados, mas ${faltantes} ${faltantes > 1 ? 'diaristas não possuem' : 'diarista não possui'} ID GROOT e não puderam ser gerados.`);
    if (!comId.length) return alert('Nenhum dos diaristas selecionados possui um ID GROOT para gerar o QR Code.');

    const {data: imageData, error: imageError} = await supabase.storage.from('cards').getPublicUrl('QRCODE.png');
    if (imageError) {
        console.error('Erro ao buscar a imagem do card:', imageError);
        return alert('Não foi possível carregar o template do card.');
    }
    const urlImagemCard = imageData.publicUrl;

    const w = window.open('', '_blank');
    w.document.write(`
    <html><head><title>QR Codes - Diaristas</title>
    <script src="https://cdn.jsdelivr.net/npm/davidshimjs-qrcodejs@0.0.2/qrcode.min.js"><\/script>
    <style>
      body{font-family:sans-serif}
      .pagina{display:grid;grid-template-columns:1fr 1fr 1fr;gap:5px;page-break-after:always}
      .card-item{position:relative;width:240px;height:345px;background-image:url('${urlImagemCard}');background-size:100% 100%;background-repeat:no-repeat;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .qr-code-area{position:absolute;top:75px;left:20px;width:200px;height:200px;display:flex;align-items:center;justify-content:center}
      .info-area{position:absolute;bottom:1px;left:0;width:100%;height:60px;padding:0 3px;box-sizing:border-box;color:black;font-weight:bold;display:flex;flex-direction:column;justify-content:center;align-items:center}
      .info-area .nome{display:block;font-size:11px;line-height:1.2;margin-bottom:4px;text-align:center;max-width:230px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .info-area .id{display:block;font-size:15px}
      @media print { @page{size:A4;margin:1cm} body{margin:0} .pagina:last-of-type{page-break-after:auto} }
    </style></head><body>
  `);
    const PAGE = 9;
    let html = '';
    for (let i = 0; i < comId.length; i++) {
        if (i % PAGE === 0) {
            if (i > 0) html += '</div>';
            html += '<div class="pagina">';
        }
        const row = comId[i];
        const idFmt = String(row.IDGROOT).padStart(11, '0');
        html += `
      <div class="card-item">
        <div class="qr-code-area"><div id="qrcode-${i}"></div></div>
        <div class="info-area"><span class="nome">${escapeHtml(row.NOME)}</span><span class="id">ID: ${idFmt}</span></div>
      </div>`;
    }
    html += '</div>';
    w.document.write(html);
    w.document.write(`
    <script>
      const dados = ${JSON.stringify(comId.map(r => ({NOME: r.NOME, IDGROOT: String(r.IDGROOT)})))};
      window.onload = function(){
        for (let i=0;i<dados.length;i++){
          const el = document.getElementById('qrcode-'+i);
          if (el){
            new QRCode(el,{ text:String(dados[i].IDGROOT).padStart(11,'0'), width:180, height:180, correctLevel:QRCode.CorrectLevel.H });
          }
        }
      };
    <\/script></body></html>`);
    w.document.close();
}
