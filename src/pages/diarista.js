import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

/* ========= Sessão / Matrizes ========= */
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

function getSessionMatriz() {
    const sess = readCurrentSession();
    const m = String(sess?.matriz || 'TODOS').trim();
    return m ? m.toUpperCase() : 'TODOS';
}

/* ======== Datas ======== */
function diaristaToISO(s) {
    const str = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(str);
    if (!Number.isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${yyyy}-${mm}-${dd}`;
    }
    return null;
}

function diaristaFmtBR(val) {
    if (!val) return '';
    const s = String(val).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    const m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
    }
    return s;
}

/* ======== Helpers ======== */
const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const safeTime = (dateLike) => {
    const t = (dateLike instanceof Date) ? dateLike.getTime() : new Date(dateLike).getTime();
    return Number.isFinite(t) ? t : NaN;
};
const formatNomeComId = (nome, id) => {
    const n = String(nome || '').trim();
    const g = String(id || '').trim();
    return g ? `${n} (${g})` : n;
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]
));

/* ======== Estado ======== */
const state = {
    mounted: false,
    svcToMatriz: new Map(),
    records: [],
    filters: {start: '', end: '', svc: '', matriz: '', turno: ''},
    _listeners: [],
    _popover: null
};

/* ======== DOM utils ======== */
function on(el, ev, cb) {
    if (!el) return;
    el.addEventListener(ev, cb);
    state._listeners.push(() => el.removeEventListener(ev, cb));
}

function setText(id, v) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(v);
}

/* ======== UI / Boot ======== */
function wireUI() {
    const d0 = new Date();
    d0.setDate(1);
    const start = `${d0.getFullYear()}-${pad2(d0.getMonth() + 1)}-${pad2(d0.getDate())}`;
    const end = todayISO();
    state.filters.start = start;
    state.filters.end = end;

    const elStart = document.getElementById('flt-start');
    const elEnd = document.getElementById('flt-end');
    if (elStart) elStart.value = start;
    if (elEnd) elEnd.value = end;

    const $svc = document.getElementById('flt-svc');
    const $mtz = document.getElementById('flt-matriz');
    const $turno = document.getElementById('flt-turno');

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

    on(elStart, 'change', e => {
        state.filters.start = e.target.value || start;
        renderKPIs();
        renderTable();
    });
    on(elEnd, 'change', e => {
        state.filters.end = e.target.value || end;
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
    });

    on(document.getElementById('diarista-form'), 'submit', onSubmitForm);


    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeNamesPopover();
    });
    document.addEventListener('click', (e) => {
        if (state._popover && !state._popover.contains(e.target) && !e.target.closest('.btn-nomes')) closeNamesPopover();
    });
    window.addEventListener('scroll', closeNamesPopover, {passive: true});
}

export async function init() {
    if (state.mounted) return;
    state.mounted = true;

    wireUI();
    await loadSvcMatrizMap();
    await loadDiaristas();


    state.records = (state.records || []).map(r => ({...r, Data: diaristaFmtBR(r.Data)}));
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
}

/* ======== Popover Nomes (ícone 🗒️) ======== */
function ensurePopoverStyles() {
    if (document.getElementById('diaristas-names-popover-style')) return;
    const css = `
    #diaristas-names-popover {
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
      width: min(520px, 96vw);
      max-width: 96vw;
      animation: diaristas-popin .12s ease-out;
    }
    @keyframes diaristas-popin {
      from { transform: translate(-50%, -50%) scale(.98); opacity:.0 }
      to   { transform: translate(-50%, -50%) scale(1);   opacity:1 }
    }
    #diaristas-names-popover .pop-title {
      font-size: 14px; font-weight: 800; color: #003369;
      margin: 0 0 10px; text-align: center;
    }
    #diaristas-names-popover .pop-close {
      position: absolute; top: 8px; right: 10px; border: none;
      background: transparent; font-size: 18px; cursor: pointer; color: #56607f; line-height: 1;
    }
    #diaristas-names-popover .pop-scroll {
      max-height: 360px; overflow: auto; border: 1px solid #f1f3f8; border-radius: 10px;
    }
    #diaristas-names-popover table { width: 100%; border-collapse: collapse; }
    #diaristas-names-popover thead th {
      text-align:center; font-size:12px; color:#56607f; border-bottom:1px solid #e7ebf4;
      padding:8px 10px; font-weight:700; background:#f9fbff;
    }
    #diaristas-names-popover tbody td {
      font-size:13px; color:#242c4c; padding:8px 10px; border-bottom:1px solid #f1f3f8;
      vertical-align: top; text-align:center; word-break: break-word; background:#fff;
    }
    #diaristas-names-popover tbody tr:last-child td { border-bottom:none; }
  `.trim();
    const style = document.createElement('style');
    style.id = 'diaristas-names-popover-style';
    style.textContent = css;
    document.head.appendChild(style);
}

function buildNamesTable(entries) {
    const rows = entries.map(e => `
    <tr><td>${escapeHtml(e.nome || '')}</td><td>${escapeHtml(e.id || '')}</td></tr>
  `).join('');
    return `
    <div class="pop-title">Diaristas lançados</div>
    <div class="pop-scroll">
      <table>
        <thead><tr><th>DIARISTAS</th><th>ID GROOT</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="2">Sem nomes.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

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

/* ======== SVC/MATRIZ (respeitando matrizes permitidas) ======== */
async function loadSvcMatrizMap() {
    state.svcToMatriz.clear();

    const matrizesPermitidas = getMatrizesPermitidas();
    try {
        let q = supabase.from('Matrizes')
            .select('SERVICE, MATRIZ')
            .not('SERVICE', 'is', null)
            .not('MATRIZ', 'is', null)
            .order('SERVICE', {ascending: true})
            .limit(10000);

        if (matrizesPermitidas !== null && Array.isArray(matrizesPermitidas) && matrizesPermitidas.length > 0) {
            q = q.in('MATRIZ', matrizesPermitidas);
        }

        const {data, error} = await q;
        if (error) throw error;

        const all = (data || [])
            .map(r => ({SERVICE: String(r.SERVICE || '').trim(), MATRIZ: String(r.MATRIZ || '').trim()}))
            .filter(r => r.SERVICE && r.MATRIZ);

        for (const r of all) if (!state.svcToMatriz.has(r.SERVICE)) state.svcToMatriz.set(r.SERVICE, r.MATRIZ);

        const uniqueSvcs = [...new Set(all.map(r => r.SERVICE))].sort((a, b) => a.localeCompare(b));
        const uniqueMtzs = [...new Set(all.map(r => r.MATRIZ))].sort((a, b) => a.localeCompare(b));


        const formSvc = document.getElementById('f-svc');
        if (formSvc) {
            formSvc.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
            uniqueSvcs.forEach(s => {
                const o = document.createElement('option');
                o.value = s;
                o.textContent = s;
                formSvc.appendChild(o);
            });
        }


        const fltSvc = document.getElementById('flt-svc');
        const fltMtz = document.getElementById('flt-matriz');

        if (fltSvc) {
            fltSvc.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
            uniqueSvcs.forEach(s => {
                const o = document.createElement('option');
                o.value = s;
                o.textContent = s;
                fltSvc.appendChild(o);
            });
        }

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
                uniqueMtzs.forEach(m => {
                    const o = document.createElement('option');
                    o.value = m;
                    o.textContent = m;
                    fltMtz.appendChild(o);
                });
                fltMtz.disabled = false;
            }
        }
    } catch (e) {
        console.error('Erro ao carregar SERVICES/MATRIZES (com permissão)', e);
    }
}

/* ======== Dados Diarista (com filtro de permissão) ======== */
async function loadDiaristas() {
    const CHUNK = 1000;
    let from = 0, all = [];
    const sessMtz = getSessionMatriz();
    const matrizesPermitidas = getMatrizesPermitidas();

    try {
        while (true) {
            let q = supabase.from('Diarista')
                .select('Numero, Quantidade, Empresa, Data, "Solicitado Por", "Autorizado Por", Turno, "Nome Diarista", SVC, MATRIZ')
                .order('Numero', {ascending: true})
                .range(from, from + CHUNK - 1);


            if (matrizesPermitidas !== null && Array.isArray(matrizesPermitidas) && matrizesPermitidas.length > 0) {
                q = q.in('MATRIZ', matrizesPermitidas);
            }


            if (sessMtz && sessMtz !== 'TODOS') {
                q = q.eq('MATRIZ', sessMtz);
            }

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

        console.log('[Diarista] carregados (total):', state.records.length, 'registros (com permissão)');
    } catch (e) {
        console.warn('Falha ao obter registros Diarista', e);
        state.records = [];
    }
}

/* ======== Filtro / Render ======== */
function filteredRows() {
    const s = state.filters;
    const tStart = safeTime(new Date(s.start));
    const tEnd = safeTime(new Date(s.end));
    return (state.records || [])
        .filter(r => {
            const iso = diaristaToISO(r.Data);
            const tRow = safeTime(new Date(iso));
            if (Number.isFinite(tStart) && Number.isFinite(tEnd)) {
                if (!Number.isFinite(tRow)) return false;
                if (tRow < tStart || tRow > tEnd) return false;
            }
            if (s.svc && String(r.SVC || '') !== s.svc) return false;
            if (s.matriz && String(r.MATRIZ || '') !== s.matriz) return false;
            if (s.turno && String(r.Turno || '') !== s.turno) return false;
            return true;
        })
        .sort((a, b) => {
            const ta = safeTime(new Date(diaristaToISO(a.Data)));
            const tb = safeTime(new Date(diaristaToISO(b.Data)));
            if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
            if (Number.isFinite(tb) && !Number.isFinite(ta)) return -1;
            if (!Number.isFinite(tb) && Number.isFinite(ta)) return 1;
            return Number(b.Numero || 0) - Number(a.Numero || 0);
        });
}

function fillFilterCombos() {
    if (document.getElementById('flt-svc')?.options.length <= 1 ||
        document.getElementById('flt-matriz')?.options.length <= 1) {
        loadSvcMatrizMap();
    }
}

function renderKPIs() {
    const rows = filteredRows();
    const has = (txt, needle) => new RegExp(needle, 'i').test(String(txt || ''));
    const sumBy = (authPred, turno) => rows
        .filter(r => authPred(r['Autorizado Por']) && (!turno || r.Turno === turno))
        .reduce((acc, r) => acc + Number(r.Quantidade || 0), 0);

    const knT1 = sumBy(v => has(v, 'KN'), 'T1'), knT2 = sumBy(v => has(v, 'KN'), 'T2'),
        knT3 = sumBy(v => has(v, 'KN'), 'T3');
    setText('kpiTOP-kn-t1', knT1);
    setText('kpiTOP-kn-t2', knT2);
    setText('kpiTOP-kn-t3', knT3);
    setText('kpiTOP-kn-total', knT1 + knT2 + knT3);

    const mlT1 = sumBy(v => has(v, 'MELI'), 'T1'), mlT2 = sumBy(v => has(v, 'MELI'), 'T2'),
        mlT3 = sumBy(v => has(v, 'MELI'), 'T3');
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
    tbody.innerHTML = '';
    const rows = filteredRows();
    for (const r of rows) {
        const entries = parseNomeDiaristaField(r['Nome Diarista']);
        const tr = document.createElement('tr');
        tr.innerHTML = `
      <td>${r.Quantidade ?? ''}</td>
      <td>${r.Empresa ?? ''}</td>
      <td>${diaristaFmtBR(r.Data)}</td>
      <td>${r['Solicitado Por'] ?? ''}</td>
      <td>${r['Autorizado Por'] ?? ''}</td>
      <td>${r.Turno ?? ''}</td>
      <td>${r.SVC ?? ''}</td>
      <td>${r.MATRIZ ?? ''}</td>
      <td><button type="button" class="btn-nomes" title="Ver nomes">🗒️</button></td>
    `;
        const btn = tr.querySelector('.btn-nomes');
        btn?.addEventListener('click', () => openNamesPopover(entries));
        tbody.appendChild(tr);
    }
}

/* ======== Modal / Insert ======== */
function openModal() {
    document.getElementById('f-quantidade').value = 1;
    document.getElementById('f-empresa').value = '';
    document.getElementById('f-solicitado').value = '';
    document.getElementById('f-autorizado').value = '';
    document.getElementById('f-turno').value = '';

    const fSvc = document.getElementById('f-svc');
    const fMtz = document.getElementById('f-matriz');
    if (fSvc) fSvc.value = '';
    const sessMtz = getSessionMatriz();
    if (fMtz) fMtz.value = (sessMtz && sessMtz !== 'TODOS') ? sessMtz : '';

    document.getElementById('f-data').value = todayISO();
    updateNameInputs(false);
    document.getElementById('diarista-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('diarista-modal').classList.add('hidden');
}

function updateNameInputs(preserve = true) {
    const raw = document.getElementById('f-quantidade').value;
    const qty = Math.max(1, parseInt(raw, 10) || 1);
    const box = document.getElementById('names-list');

    let prevNomes = [], prevIds = [];
    if (preserve) {
        prevNomes = Array.from(box.querySelectorAll('.f-nome')).map(inp => String(inp.value || ''));
        prevIds = Array.from(box.querySelectorAll('.f-groot')).map(inp => String(inp.value || ''));
    }
    box.innerHTML = '';
    for (let i = 1; i <= qty; i++) {
        const nomeVal = preserve ? (prevNomes[i - 1] || '') : '';
        const idVal = preserve ? (prevIds[i - 1] || '') : '';
        const wrapNome = document.createElement('div');
        wrapNome.className = 'form-group';
        wrapNome.style.gridColumn = 'span 2';
        wrapNome.innerHTML = `
      <label for="f-nome-${i}">Nome ${i}</label>
      <input id="f-nome-${i}" type="text" class="f-nome" placeholder="Nome do diarista ${i}" required
             value="${nomeVal.replace(/"/g, '&quot;')}">
    `;
        const wrapId = document.createElement('div');
        wrapId.className = 'form-group';
        wrapId.innerHTML = `
      <label for="f-groot-${i}">ID GROOT ${i}</label>
      <input id="f-groot-${i}" type="text" class="f-groot" placeholder="Ex.: 12345"
             value="${idVal.replace(/"/g, '&quot;')}">
    `;
        box.appendChild(wrapNome);
        box.appendChild(wrapId);
    }
}

async function onSubmitForm(ev) {
    ev.preventDefault();
    const qtd = Math.max(1, parseInt(document.getElementById('f-quantidade').value, 10) || 1);
    const empresa = String(document.getElementById('f-empresa').value || '').trim();
    const solicitado = String(document.getElementById('f-solicitado').value || '').trim();
    const autorizado = String(document.getElementById('f-autorizado').value || '').trim();
    const turno = String(document.getElementById('f-turno').value || '').trim();
    const svc = String(document.getElementById('f-svc').value || '').trim();
    const matriz = String(document.getElementById('f-matriz').value || '').trim();
    const dataISO = document.getElementById('f-data').value;


    const nomesInputs = Array.from(document.querySelectorAll('.f-nome'));
    const idsInputs = Array.from(document.querySelectorAll('.f-groot'));
    const nomes = nomesInputs.map(i => String(i.value || '').trim()).filter(Boolean);
    const ids = idsInputs.map(i => String(i.value || '').trim());
    if (nomes.length !== qtd || nomesInputs.length !== idsInputs.length) {
        alert('Quantidade e quantidade de pares (Nome/ID) não conferem.');
        return;
    }


    let numero = 1;
    try {
        const {data: maxData, error: maxErr} = await supabase
            .from('Diarista').select('Numero').order('Numero', {ascending: false}).limit(1);
        if (maxErr) throw maxErr;
        numero = (maxData && maxData[0] && Number(maxData[0].Numero)) ? (Number(maxData[0].Numero) + 1) : 1;
    } catch {
        const curMax = Math.max(0, ...state.records.map(r => Number(r.Numero || 0)));
        numero = curMax + 1;
    }

    const isoDate = diaristaToISO(dataISO);
    if (!isoDate) {
        alert('Data inválida');
        return;
    }

    const nomeDiarista = nomes.map((n, idx) => formatNomeComId(n, ids[idx])).join(', ');
    const payload = {
        Numero: numero,
        Quantidade: Number(qtd),
        Empresa: empresa,
        Data: isoDate,
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
        console.error('Erro ao salvar Diarista', e);
        alert('Falha ao salvar. Veja o console.');
    }
}

/* ======== Export ======== */
function exportXLSX() {
    const rows = filteredRows();
    if (!rows.length) {
        alert('Não há dados para exportar.');
        return;
    }

    const headerOrder = [
        'Quantidade', 'Empresa', 'Data', 'Solicitado Por',
        'Autorizado Por', 'Turno', 'SVC', 'MATRIZ', 'Nome Diarista'
    ];

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
        const csv = [header.join(';')].concat(
            data.map(r => header.map(k => String(r[k] ?? '').replace(/;/g, ',')).join(';'))
        ).join('\n');
        const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `diaristas_${state.filters.start}_a_${state.filters.end}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
}
