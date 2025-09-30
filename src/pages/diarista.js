import {getMatrizesPermitidas} from '../session.js';
import {supabase} from '../supabaseClient.js';

/* ========= Sessão (mesmo conceito do Electron) ========= */
function readCurrentSession() {
    try {
        if (window.currentSession && typeof window.currentSession === 'object') {
            return window.currentSession;
        }
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


/* ======== Datas iguais ao back (copiadas/adaptadas) ======== */
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

/* ======== Helpers util ======== */
const pad2 = n => String(n).padStart(2, '0');
const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const safeTime = (dateLike) => {
    const t = (dateLike instanceof Date) ? dateLike.getTime() : new Date(dateLike).getTime();
    return Number.isFinite(t) ? t : NaN;
};

/* ======== Estado ======== */
const state = {
    mounted: false,
    svcToMatriz: new Map(),
    records: [],
    filters: {start: '', end: '', svc: '', matriz: '', turno: ''},
    _listeners: [],
};

/* ======== Util DOM ======== */
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

    on(document.getElementById('f-quantidade'), 'input', updateNameInputs);
    on(document.getElementById('f-quantidade'), 'change', updateNameInputs);
    on(document.getElementById('f-svc'), 'change', (e) => {
        const svc = e.target.value;
        const mtzEl = document.getElementById('f-matriz');
        if (mtzEl) mtzEl.value = state.svcToMatriz.get(svc) || '';
    });
    on(document.getElementById('diarista-form'), 'submit', onSubmitForm);
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


async function loadSvcMatrizMap() {

    state.svcToMatriz.clear();
    const svcSel = document.getElementById('f-svc');
    const fltSvc = document.getElementById('flt-svc');
    const fltMtz = document.getElementById('flt-matriz');

    const matrizesPermitidas = getMatrizesPermitidas();
    try {
        let query = supabase
            .from('Diarista')
            .select('SVC, MATRIZ')
            .not('SVC', 'is', null)
            .not('MATRIZ', 'is', null);

        if (matrizesPermitidas !== null) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }

        const {data, error} = await query.limit(5000);
        if (error) throw error;

        const svcsUnicos = new Set();
        const matrizesUnicas = new Set();

        (data || []).forEach(r => {
            const svc = String(r.SVC || '').trim();
            const mtz = String(r.MATRIZ || '').trim();

            if (svc) {
                svcsUnicos.add(svc);

                if (!state.svcToMatriz.has(svc)) {
                    state.svcToMatriz.set(svc, mtz);
                }
            }
            if (mtz) {
                matrizesUnicas.add(mtz);
            }
        });

        const svcsOrdenados = [...svcsUnicos].sort((a, b) => a.localeCompare(b));
        const matrizesOrdenadas = [...matrizesUnicas].sort((a, b) => a.localeCompare(b));

        if (svcSel) {
            svcSel.innerHTML = '<option value="">Selecione...</option>';
            svcsOrdenados.forEach(s => {
                const option = document.createElement('option');
                option.value = s;
                option.textContent = s;
                svcSel.appendChild(option);
            });
        }

        if (fltSvc) {
            fltSvc.innerHTML = '<option value="">Todos os SVCs</option>';
            svcsOrdenados.forEach(s => {
                const option = document.createElement('option');
                option.value = s;
                option.textContent = s;
                fltSvc.appendChild(option);
            });
        }
        if (fltMtz) {
            fltMtz.innerHTML = '<option value="">Todas as Matrizes</option>';
            matrizesOrdenadas.forEach(m => {
                const option = document.createElement('option');
                option.value = m;
                option.textContent = m;
                fltMtz.appendChild(option);
            });
        }

    } catch (e) {
        console.error('Erro ao carregar SVC/Matriz', e);
    }
}


async function loadDiaristas() {

    const matrizesPermitidas = getMatrizesPermitidas();
    const CHUNK = 1000;
    let from = 0;
    let all = [];

    try {
        while (true) {
            let q = supabase
                .from('Diarista')
                .select('Numero, Quantidade, Empresa, Data, "Solicitado Por", "Autorizado Por", Turno, "Nome Diarista", SVC, MATRIZ')
                .order('Numero', {ascending: true})
                .range(from, from + CHUNK - 1);

            if (matrizesPermitidas !== null) {
                q = q.in('MATRIZ', matrizesPermitidas);
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

        console.log('[Diarista] carregados (total):', state.records.length, 'registros');
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

function renderTable() {
    const tbody = document.getElementById('diaristas-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const rows = filteredRows();
    for (const r of rows) {
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
    `;
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
    document.getElementById('f-svc').value = '';
    document.getElementById('f-matriz').value = '';
    document.getElementById('f-data').value = todayISO();
    updateNameInputs();
    document.getElementById('diarista-modal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('diarista-modal').classList.add('hidden');
}

function updateNameInputs() {
    const raw = document.getElementById('f-quantidade').value;
    const qty = Math.max(1, parseInt(raw, 10) || 1);
    const box = document.getElementById('names-list');
    const prevValues = Array.from(box.querySelectorAll('.f-nome')).map(inp => String(inp.value || ''));

    box.innerHTML = '';
    for (let i = 1; i <= qty; i++) {
        const wrap = document.createElement('div');
        wrap.className = 'name-item';
        const prev = prevValues[i - 1] || '';
        wrap.innerHTML = `
      <label>Nome ${i}
        <input type="text" class="f-nome" placeholder="Nome do diarista ${i}" required value="${prev.replace(/"/g, '&quot;')}">
      </label>`;
        box.appendChild(wrap);
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

    const nomes = Array.from(document.querySelectorAll('.f-nome'))
        .map(i => String(i.value || '').trim()).filter(Boolean);
    if (nomes.length !== qtd) {
        alert('Quantidade e quantidade de nomes não conferem.');
        return;
    }

    let numero = 1;
    try {
        const {data: maxData, error: maxErr} = await supabase
            .from('Diarista')
            .select('Numero')
            .order('Numero', {ascending: false})
            .limit(1);
        if (maxErr) throw maxErr;
        numero = (maxData && maxData[0] && Number(maxData[0].Numero))
            ? (Number(maxData[0].Numero) + 1)
            : 1;
    } catch {
        const curMax = Math.max(0, ...state.records.map(r => Number(r.Numero || 0)));
        numero = curMax + 1;
    }

    const isoDate = diaristaToISO(dataISO);
    if (!isoDate) {
        alert('Data inválida');
        return;
    }

    const payload = {
        Numero: numero,
        Quantidade: Number(qtd),
        Empresa: empresa,
        Data: isoDate,
        'Solicitado Por': solicitado,
        'Autorizado Por': autorizado,
        Turno: turno,
        'Nome Diarista': nomes.join(', '),
        SVC: svc,
        MATRIZ: matriz
    };

    try {
        const {error} = await supabase.from('Diarista').insert(payload);
        if (error) throw error;

        state.records.push({
            ...payload,
            Data: diaristaFmtBR(payload.Data)
        });

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
