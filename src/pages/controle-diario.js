import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';let state;
let ui;
const collator = new Intl.Collator('pt-BR', {sensitivity: 'base'});
const NORM = (s) => (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const pick = (o, ...keys) => {
    for (const k of keys) {
        const v = o && o[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
    }
    return '';
};
const getMatriz = (x) => String(pick(x, 'Matriz', 'MATRIZ')).trim();
const CACHE_DURATION_MS = 5 * 60 * 1000;
const cachedDailyData = new Map();
const cacheKey = (turno, dateISO) => `${dateISO}|${turno || 'T?'}`;function getFromCache(turno, dateISO) {
    const k = cacheKey(turno, dateISO);
    const hit = cachedDailyData.get(k);
    if (!hit) return null;
    if (Date.now() - hit.ts > CACHE_DURATION_MS) {
        cachedDailyData.delete(k);
        return null;
    }
    return hit.data;
}async function refresh() {
    state.filtered = applyFilters(state.baseList);
    repopulateFilterOptionsCascade();
    await renderRows(state.filtered);
    computeSummary(state.filtered, state.meta);
}function setCache(turno, dateISO, data) {
    cachedDailyData.set(cacheKey(turno, dateISO), {ts: Date.now(), data});
}function invalidateCacheForDate(dateISO) {
    ['T1', 'T2', 'T3', 'GERAL'].forEach(t => {
        cachedDailyData.delete(cacheKey(t, dateISO));
    });
}function showLoading(on = true) {
    const el = document.getElementById('cd-loading');
    if (!el) return;
    el.style.display = on ? 'flex' : 'none';
}function toast(msg, type = 'info', timeout = 2500) {
    const root = document.getElementById('toast-root');
    if (!root) {
        alert(msg);
        return;
    }
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = msg;
    root.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transform = 'translateY(-6px)';
        setTimeout(() => div.remove(), 180);
    }, timeout);
}function weekdayPT(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dias = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
    return dias[d.getDay()];
}function uniqSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => collator.compare(a, b));
}async function fetchAllWithPagination(queryBuilder) {
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
}async function getColaboradoresElegiveis(turno, dateISO) {
    const dia = weekdayPT(dateISO);
    let matrizesPermitidas = getMatrizesPermitidas();
    if (Array.isArray(matrizesPermitidas) && matrizesPermitidas.length === 0) {
        matrizesPermitidas = null;
    }
    let q = supabase
        .from('Colaboradores')
        .select('Nome, Escala, DSR, Cargo, MATRIZ, SVC, Gestor, Contrato, Ativo, "Data de admissão", LDAP')
        .eq('Ativo', 'SIM');
    if (!turno || turno === 'GERAL') q = q.in('Escala', ['T1', 'T2', 'T3']);
    else q = q.eq('Escala', turno);
    if (matrizesPermitidas && matrizesPermitidas.length) q = q.in('MATRIZ', matrizesPermitidas);
    q = q.order('Nome', {ascending: true});
    try {
        const cols = await fetchAllWithPagination(q);
        const all = cols || [];
        const nomesColabs = all.map(c => c.Nome);
        const {data: feriasHoje} = await supabase
            .from('Ferias')
            .select('Nome')
            .lte('"Data Inicio"', dateISO)
            .gte('"Data Final"', dateISO);
        const nomesEmFeriasHoje = new Set((feriasHoje || []).map(f => f.Nome));
        const {data: afastamentosHoje} = await supabase
            .from('Afastamentos')
            .select('NOME')
            .lte('"DATA INICIO"', dateISO)
            .gt('"DATA RETORNO"', dateISO);
        const nomesEmAfastamentoHoje = new Set((afastamentosHoje || []).map(f => NORM(f.NOME)));
        let dsrLogs = [];
        const chunkSize = 200;
        if (nomesColabs.length > 0) {
            const promises = [];
            for (let i = 0; i < nomesColabs.length; i += chunkSize) {
                const chunk = nomesColabs.slice(i, i + chunkSize);
                promises.push(
                    supabase
                        .from('LogDSR')
                        .select('Name, DsrAnterior, DsrAtual, DataAlteracao')
                        .in('Name', chunk)
                );
            }
            const results = await Promise.all(promises);
            for (const {data, error} of results) {
                if (error) throw error;
                if (data) dsrLogs = dsrLogs.concat(data);
            }
        }
        const dsrHistoryMap = new Map();
        for (const log of dsrLogs) {
            const nameNorm = NORM(log.Name);
            if (!dsrHistoryMap.has(nameNorm)) dsrHistoryMap.set(nameNorm, []);
            dsrHistoryMap.get(nameNorm).push(log);
        }
        for (const history of dsrHistoryMap.values()) {
            history.sort((a, b) => new Date(a.DataAlteracao) - new Date(b.DataAlteracao));
        }
        const getDSRForDate = (colaborador) => {
            const nameNorm = NORM(colaborador.Nome);
            const history = dsrHistoryMap.get(nameNorm);
            if (!history || history.length === 0) return colaborador.DSR;
            let applicableDSR = null;
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].DataAlteracao.slice(0, 10) <= dateISO) {
                    applicableDSR = history[i].DsrAtual;
                    break;
                }
            }
            if (applicableDSR === null) applicableDSR = history[0].DsrAnterior;
            return applicableDSR;
        };
        const checkDSR = (colaborador) => {
            const historicalDSR = getDSRForDate(colaborador);
            const colaboradorDSRs = (historicalDSR || '').toString().toUpperCase().split(',').map(d => d.trim());
            return colaboradorDSRs.includes(dia);
        };
        const dsrList = all.filter(c => checkDSR(c)).map(c => c.Nome);
        const elegiveis = all
            .filter(c => {
                const dataAdmissao = c['Data de admissão'];
                if (dataAdmissao && dataAdmissao > dateISO) return false;
                if (nomesEmFeriasHoje.has(c.Nome)) return false;
                if (nomesEmAfastamentoHoje.has(NORM(c.Nome))) return false;
                const isDSR = checkDSR(c);
                return !isDSR;
            })
            .sort((a, b) => collator.compare(a, b));
        return {elegiveis, dsrList};
    } catch (error) {
        console.error("Erro ao buscar colaboradores elegíveis com paginação:", error);
        throw error;
    }
}async function getMarksFor(dateISO, nomes) {
    if (!nomes.length) return new Map();
    const {data, error} = await supabase
        .rpc('get_marcas_para_nomes', {nomes: nomes, data_consulta: dateISO});
    if (error) throw error;
    const map = new Map();
    (data || []).forEach(m => {
        let tipo = null;
        if (m['Presença']) tipo = 'PRESENCA';
        else if (m['Falta']) tipo = 'FALTA';
        else if (m['Atestado']) tipo = 'ATESTADO';
        else if (m['Folga Especial']) tipo = 'F_ESPECIAL';
        else if (m['Feriado']) tipo = 'FERIADO';
        else if (m['Suspensao']) tipo = 'SUSPENSAO';
        map.set(m.Nome, tipo);
    });
    return map;
}async function fetchList(turno, dateISO) {
    const cacheHit = getFromCache(turno, dateISO);
    if (cacheHit) return cacheHit;
    if (turno === 'GERAL') {
        const parts = await Promise.all(['T1', 'T2', 'T3'].map(t => fetchList(t, dateISO)));
        const byName = new Map();
        const dsrSet = new Set();
        parts.forEach(p => {
            p.list.forEach(x => {
                if (!byName.has(x.Nome)) byName.set(x.Nome, x);
            });
            (p.meta.dsrList || []).forEach(n => dsrSet.add(n));
        });
        const combined = {list: Array.from(byName.values()), meta: {dsrList: Array.from(dsrSet)}};
        setCache('GERAL', dateISO, combined);
        return combined;
    }
    const {elegiveis, dsrList} = await getColaboradoresElegiveis(turno, dateISO);
    const markMap = await getMarksFor(dateISO, elegiveis.map(x => x.Nome));
    const list = elegiveis.map(c => ({
        Nome: c.Nome,
        LDAP: c.LDAP || '',
        Cargo: c.Cargo || '',
        SVC: c.SVC || '',
        Gestor: c.Gestor || '',
        Contrato: c.Contrato || '',
        Matriz: c.MATRIZ || '',
        Escala: c.Escala || '',
        Marcacao: markMap.get(c.Nome) || null
    }));
    const packed = {list, meta: {dsrList}};
    setCache(turno, dateISO, packed);
    return packed;
}async function upsertMarcacao({nome, turno, dateISO, tipo}) {
    const zeros = {'Presença': 0, 'Falta': 0, 'Atestado': 0, 'Folga Especial': 0, 'Suspensao': 0, 'Feriado': 0};
    const setOne = {...zeros};
    if (tipo === 'PRESENCA') setOne['Presença'] = 1;
    else if (tipo === 'FALTA') setOne['Falta'] = 1;
    else if (tipo === 'ATESTADO') setOne['Atestado'] = 1;
    else if (tipo === 'F_ESPECIAL') setOne['Folga Especial'] = 1;
    else if (tipo === 'FERIADO') setOne['Feriado'] = 1;
    else if (tipo === 'SUSPENSAO') setOne['Suspensao'] = 1;
    else throw new Error('Tipo inválido.');    const {data: colabInfo, error: colabErr} = await supabase
        .from('Colaboradores')
        .select('Escala, SVC, MATRIZ, Cargo')
        .eq('Nome', nome)
        .single();
    if (colabErr) throw colabErr;    const turnoToUse = turno || colabInfo.Escala || null;    const {data: existing, error: findErr} = await supabase
        .from('ControleDiario')
        .select('Numero')
        .eq('Nome', nome)
        .eq('Data', dateISO)
        .limit(1);
    if (findErr) throw findErr;    if (existing && existing.length > 0) {        const {error: updErr} = await supabase
            .from('ControleDiario')
            .update({
                ...zeros,
                ...setOne,
                Turno: turnoToUse,
                MATRIZ: colabInfo.MATRIZ,
                Cargo: colabInfo.Cargo
            })
            .eq('Nome', nome)
            .eq('Data', dateISO);
        if (updErr) throw updErr;
    } else {
        const {data: maxRow, error: maxErr} = await supabase
            .from('ControleDiario')
            .select('Numero')
            .order('Numero', {ascending: false})
            .limit(1);
        if (maxErr) throw maxErr;
        const nextNumero = ((maxRow && maxRow[0] && maxRow[0].Numero) || 0) + 1;        const row = {
            Numero: nextNumero,
            Nome: nome,
            Data: dateISO,
            Turno: turnoToUse,
            ...setOne,
            MATRIZ: colabInfo.MATRIZ,
            Cargo: colabInfo.Cargo
        };
        const {error: insErr} = await supabase.from('ControleDiario').insert(row);
        if (insErr) throw insErr;
    }    try {
        if (window.absSyncForRow) {            await window.absSyncForRow({
                Nome: nome,
                Data: dateISO,
                Falta: setOne['Falta'] || 0,
                Atestado: setOne['Atestado'] || 0,
                Escala: turnoToUse,
                SVC: colabInfo.SVC,
                MATRIZ: colabInfo.MATRIZ,
                Cargo: colabInfo.Cargo
            });
        }
    } catch (e) {
        console.warn('ABS sync (row) falhou:', e);
    }
}async function deleteMarcacao({nome, dateISO}) {
    const {error} = await supabase
        .from('ControleDiario')
        .delete()
        .eq('Nome', nome)
        .eq('Data', dateISO);
    if (error) throw error;
    try {
        if (window.absSyncForRow) {
            await window.absSyncForRow({Nome: nome, Data: dateISO, Falta: 0, Atestado: 0});
        }
    } catch (e) {
        console.warn('ABS sync (delete) falhou:', e);
    }
}function label(tipo) {
    switch (tipo) {
        case 'PRESENCA':
            return 'Presente';
        case 'FALTA':
            return 'Falta';
        case 'ATESTADO':
            return 'Atestado';
        case 'F_ESPECIAL':
            return 'Folga Especial';
        case 'FERIADO':
            return 'Feriado';
        case 'SUSPENSAO':
            return 'Suspensão';
        default:
            return '';
    }
}function btnsHTML(item) {
    const tipos = [
        {label: 'P', tipo: 'PRESENCA', className: 'status-p'},
        {label: 'F', tipo: 'FALTA', className: 'status-f'},
        {label: 'A', tipo: 'ATESTADO', className: 'status-a'},
        {label: 'F.E', tipo: 'F_ESPECIAL', className: 'status-fe'},
        {label: 'S', tipo: 'SUSPENSAO', className: 'status-s'},
        {label: 'F.D', tipo: 'FERIADO', className: 'status-fd'},
        {label: 'X', tipo: 'LIMPAR', className: 'status-x'},
    ];
    return tipos.map(b => {
        const on = item.Marcacao === b.tipo ? ' active' : '';
        return `<button class="cd-btn ${b.className}${on}" data-tipo="${b.tipo}" data-nome="${item.Nome}">${b.label}</button>`;
    }).join('');
}function applyMarkToRow(tr, tipo) {
    tr.dataset.mark = tipo || 'NONE';
    tr.className = '';
    tr.classList.add(`row-${(tipo || 'NONE').toLowerCase()}`);
    const tdNome = tr.querySelector('.nome-col');
    const ic = tdNome?.querySelector('.status-icon');
    if (ic) {
        ic.textContent = tipo ? '✅' : '⚠️';
        ic.title = tipo ? 'Marcado' : 'Pendente';
    }
    tdNome?.querySelectorAll('.cd-badge').forEach(b => b.remove());
    if (tipo) {
        const badge = document.createElement('span');
        badge.className = `cd-badge badge-${tipo.toLowerCase()}`;
        badge.textContent = label(tipo);
        tdNome?.append(' ', badge);
    }
    tr.querySelectorAll('.cd-btn').forEach(btn => {
        btn.classList.toggle('active', !!tipo && btn.dataset.tipo === tipo);
    });
}function passFilters(x) {
    const f = state.filters;
    if (f.search) {
        const searchTermNorm = NORM(f.search);
        const nomeNorm = NORM(x.Nome);
        const ldapNorm = NORM(x.LDAP);
        if (!nomeNorm.includes(searchTermNorm) && !ldapNorm.includes(searchTermNorm)) return false;
    }
    if (f.gestor && (x.Gestor || '') !== f.gestor) return false;
    if (f.cargo && (x.Cargo || '') !== f.cargo) return false;
    if (f.contrato && (x.Contrato || '') !== f.contrato) return false;
    if (f.svc && (x.SVC || '') !== f.svc) return false;
    if (f.matriz && getMatriz(x) !== f.matriz) return false;
    if (state.isPendingFilterActive && x.Marcacao) return false;
    return true;
}function applyFilters(list) {
    return list.filter(passFilters).sort((a, b) => collator.compare(a.Nome, b.Nome));
}function passFiltersExcept(x, exceptKey) {
    const f = state.filters;
    if (f.search && !NORM(x.Nome).includes(NORM(f.search))) return false;
    if (exceptKey !== 'gestor' && f.gestor && (x.Gestor || '') !== f.gestor) return false;
    if (exceptKey !== 'cargo' && f.cargo && (x.Cargo || '') !== f.cargo) return false;
    if (exceptKey !== 'contrato' && f.contrato && (x.Contrato || '') !== f.contrato) return false;
    if (exceptKey !== 'svc' && f.svc && (x.SVC || '') !== f.svc) return false;
    if (exceptKey !== 'matriz' && f.matriz && getMatriz(x) !== f.matriz) return false;
    return true;
}function recomputeOptionsFor(key) {
    const base = state.baseList.filter((x) => passFiltersExcept(x, key));
    let values = [];
    switch (key) {
        case 'gestor':
            values = base.map(x => (x.Gestor || '').trim());
            break;
        case 'cargo':
            values = base.map(x => (x.Cargo || '').trim());
            break;
        case 'contrato':
            values = base.map(x => (x.Contrato || '').trim());
            break;
        case 'svc':
            values = base.map(x => (x.SVC || '').trim());
            break;
        case 'matriz':
            values = base.map(x => getMatriz(x));
            break;
        default:
            values = [];
    }
    return uniqSorted(values.filter(Boolean));
}function fillPreserving(sel, values, placeholder, current, onInvalid) {
    if (!sel) return;
    sel.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option value="${v}">${v}</option>`).join('');
    if (current && values.includes(current)) {
        sel.value = current;
    } else {
        sel.value = '';
        if (typeof onInvalid === 'function') onInvalid();
    }
}function repopulateFilterOptionsCascade() {
    const cur = {
        gestor: state.filters.gestor,
        cargo: state.filters.cargo,
        contrato: state.filters.contrato,
        svc: state.filters.svc,
        matriz: state.filters.matriz,
    };
    const opts = {
        gestor: recomputeOptionsFor('gestor'),
        cargo: recomputeOptionsFor('cargo'),
        contrato: recomputeOptionsFor('contrato'),
        svc: recomputeOptionsFor('svc'),
        matriz: recomputeOptionsFor('matriz'),
    };
    fillPreserving(ui.selGestor, opts.gestor, 'Gestor', cur.gestor, () => (state.filters.gestor = ''));
    fillPreserving(ui.selCargo, opts.cargo, 'Cargo', cur.cargo, () => (state.filters.cargo = ''));
    fillPreserving(ui.selContrato, opts.contrato, 'Contrato', cur.contrato, () => (state.filters.contrato = ''));
    fillPreserving(ui.selSVC, opts.svc, 'SVC', cur.svc, () => (state.filters.svc = ''));
    fillPreserving(ui.selMatriz, opts.matriz, 'Matriz', cur.matriz, () => (state.filters.matriz = ''));
}async function renderRows(list) {
    ui.tbody.innerHTML = '';
    const dsrNamesRaw = (state.meta?.dsrList || []).slice();
    if (!dsrNamesRaw.length && list.length === 0) {
        ui.tbody.innerHTML = '<tr><td colspan="7">Nenhum colaborador previsto para hoje.</td></tr>';
        state.dsrInfoList = [];
        updateFooterCounts();
        return;
    }
    let dsrInfos = dsrNamesRaw.map(n => ({Nome: n}));
    try {
        if (dsrNamesRaw.length > 0) {
            const {data: info} = await supabase
                .from('Colaboradores')
                .select('Nome, Cargo, SVC, Gestor, Contrato, MATRIZ, LDAP')
                .in('Nome', dsrNamesRaw);
            if (Array.isArray(info)) {
                const byName = new Map(info.map(x => [x.Nome, x]));
                dsrInfos = dsrNamesRaw.map(n => byName.get(n) || {Nome: n});
            }
        }
    } catch {
    }
    state.dsrInfoList = dsrInfos;
    const dsrFiltered = dsrInfos
        .filter(passFilters)
        .map(x => x.Nome)
        .sort((a, b) => collator.compare(a, b));
    const maxLen = Math.max(list.length, dsrFiltered.length);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < maxLen; i++) {
        const item = list[i] || null;
        const dsrName = dsrFiltered[i] || '—';
        const tr = document.createElement('tr');
        if (item) {
            tr.dataset.nome = item.Nome;
            tr.dataset.mark = item.Marcacao || 'NONE';
            tr.classList.add(`row-${(item.Marcacao || 'NONE').toLowerCase()}`);
            const tdNome = document.createElement('td');
            tdNome.className = 'nome-col';
            const ic = document.createElement('span');
            ic.className = 'status-icon';
            ic.textContent = item.Marcacao ? '✅' : '⚠️';
            ic.title = item.Marcacao ? 'Marcado' : 'Pendente';
            tdNome.append(ic, document.createTextNode(` ${item.Nome}`));
            if (item.Marcacao) {
                const badge = document.createElement('span');
                badge.className = `cd-badge badge-${item.Marcacao.toLowerCase()}`;
                badge.textContent = label(item.Marcacao);
                tdNome.append(' ', badge);
            }
            const tdAcoes = document.createElement('td');
            tdAcoes.className = 'status-actions';
            tdAcoes.innerHTML = btnsHTML(item);
            const tdLDAP = document.createElement('td');
            tdLDAP.textContent = item.LDAP || '—';
            const tdCargo = document.createElement('td');
            tdCargo.textContent = item.Cargo || '';
            const tdSVC = document.createElement('td');
            tdSVC.textContent = item.SVC || '';
            const tdGestor = document.createElement('td');
            tdGestor.textContent = item.Gestor || '';
            const tdDSR = document.createElement('td');
            tdDSR.textContent = dsrName;
            tr.append(tdNome, tdAcoes, tdLDAP, tdCargo, tdSVC, tdGestor, tdDSR);
        } else {
            const dash = () => {
                const td = document.createElement('td');
                td.textContent = '—';
                return td;
            };
            const tdDSR = document.createElement('td');
            tdDSR.textContent = dsrName;
            tr.append(dash(), dash(), dash(), dash(), dash(), dash(), tdDSR);
        }
        frag.appendChild(tr);
    }
    ui.tbody.replaceChildren(frag);
    updateFooterCounts();
}function updateFooterCounts() {
    if (ui.footerCount) {
        const totalVisiveis = state.filtered.length;
        ui.footerCount.textContent = `${totalVisiveis} colaboradores visíveis`;
    }
    if (ui.showMoreBtn) {
        ui.showMoreBtn.style.display = 'none';
        ui.showMoreBtn.onclick = (e) => {
            e?.preventDefault?.();
            return false;
        };
    }
}function injectTableClampStyles() {
    if (document.getElementById('cd-table-scroll-style')) return;
    const st = document.createElement('style');
    st.id = 'cd-table-scroll-style';
    st.textContent = `
      table.cd-scroll-12 { border-collapse: separate; border-spacing: 0; width: 100%; }
      table.cd-scroll-12 thead, table.cd-scroll-12 tbody tr { display: table; width: 100%; table-layout: fixed; }
      table.cd-scroll-12 thead { width: 100%; }
      table.cd-scroll-12 tbody { display: block; overflow-y: auto; max-height: var(--cd-max-table-h, 520px); }
      table.cd-scroll-12 thead::-webkit-scrollbar { display: none; }
    `;
    document.head.appendChild(st);
}function enforce12RowViewport() {
    const table = ui.tbody?.closest('table');
    if (!table) return;
    injectTableClampStyles();
    table.classList.add('cd-scroll-12');
    const rows = Array.from(ui.tbody.querySelectorAll('tr'));
    const sample = rows.slice(0, 12);
    let totalH = 12 * 42;
    if (sample.length > 0) {
        totalH = sample.reduce((acc, tr) => acc + tr.getBoundingClientRect().height, 0);
        totalH = Math.ceil(totalH + 4);
    }
    table.style.setProperty('--cd-max-table-h', `${totalH}px`);
}function computeSummary(list, meta) {
    const isConf = x => String(x.Cargo || '').toUpperCase() === 'CONFERENTE';
    const hcPrevisto = list.filter(x => !isConf(x)).length;
    const hcReal = list.filter(x => !isConf(x) && x.Marcacao === 'PRESENCA').length;
    const confReal = list.filter(x => isConf(x) && x.Marcacao === 'PRESENCA').length;
    const pend = list.filter(x => !x.Marcacao).length;
    const faltas = list.filter(x => x.Marcacao === 'FALTA').length;
    const atest = list.filter(x => x.Marcacao === 'ATESTADO').length;
    const fesp = list.filter(x => x.Marcacao === 'F_ESPECIAL').length;
    const fer = list.filter(x => x.Marcacao === 'FERIADO').length;
    const susp = list.filter(x => x.Marcacao === 'SUSPENSAO').length;
    const quadroTotal = hcReal + confReal;
    let dsrCount = 0, dsrPS = 0;
    const dsrInfo = Array.isArray(state.dsrInfoList) ? state.dsrInfoList : [];
    if (dsrInfo.length) {
        const dsrFiltrados = dsrInfo.filter(passFilters);
        dsrPS = dsrFiltrados.filter(isConf).length;
        dsrCount = dsrFiltrados.length - dsrPS;
    } else if (meta?.dsrList?.length) {
        const dsrColabs = meta.dsrList.map(nome =>
            state.baseList.find(c => c.Nome === nome) ||
            state.colabMap.get(nome) || {Nome: nome}
        );
        const dsrFiltrados = dsrColabs.filter(passFilters);
        dsrPS = dsrFiltrados.filter(isConf).length;
        dsrCount = dsrFiltrados.length - dsrPS;
    }
    const pendentesClass = pend > 0 ? 'status-orange' : 'status-green';
    const mainSummaryHTML =
        `HC Previsto: ${hcPrevisto} | HC Real: ${hcReal} | ` +
        `Faltas: ${faltas} | Atestados: ${atest} | Folga Especial: ${fesp} | ` +
        `Feriado: ${fer} | Suspensão: ${susp} | DSR: ${dsrCount} | DSR PS: ${dsrPS} | ` +
        `Conferente: ${confReal} | Quadro total: ${quadroTotal}`;
    const activeClass = state.isPendingFilterActive ? 'active' : '';
    ui.summary.innerHTML = `
        <div id="cd-summary-pending-btn" class="summary-pending ${pendentesClass} ${activeClass}" title="Clique para filtrar pendentes">
            Pendentes: ${pend}
        </div>
        <div class="summary-main">
            ${mainSummaryHTML}
        </div>
    `;
}async function carregar(full = false) {
    const dateISO = ui.date.value;
    if (!dateISO) return;
    if (full) ui.summary.textContent = 'Carregando…';
    try {
        showLoading(true);
        const {list, meta} = await fetchList(state.turnoAtual, dateISO);
        state.colabMap.clear();
        list.forEach(c => state.colabMap.set(c.Nome, c));
        state.baseList = list.map(c => ({...c, Matriz: getMatriz(c)}));
        state.meta = meta;
        repopulateFilterOptionsCascade();
        await refresh();
    } catch (e) {
        console.error(e);
        toast('Erro ao carregar dados', 'error');
        ui.tbody.innerHTML = '<tr><td colspan="6">Erro ao carregar. Veja o console.</td></tr>';
        ui.summary.textContent = 'Erro ao carregar.';
    } finally {
        showLoading(false);
    }
}async function onRowClick(ev) {
    if (document.body.classList.contains('user-level-visitante')) return;
    if (state.isProcessing) {
        toast('Aguarde, processando marcação anterior...', 'info');
        return;
    }
    const btn = ev.target.closest('.cd-btn');
    if (!btn) return;
    const nome = btn.dataset.nome;
    const tipo = btn.dataset.tipo;
    const tr = btn.closest('tr');
    const dataISO = ui.date.value;
    if (!dataISO) return toast('Selecione a data.', 'info');
    const marcadoHoje = (tr?.dataset?.mark || 'NONE') !== 'NONE';
    if (marcadoHoje && tipo !== 'LIMPAR') {
        return toast('Já marcado hoje. Ajustes em Colaboradores → Reajuste de ponto.', 'info', 3500);
    }
    state.isProcessing = true;
    showLoading(true);
    try {
        const novoTipo = tipo === 'LIMPAR' ? null : tipo;
        const turno = state.turnoAtual === 'GERAL' ? null : state.turnoAtual;
        if (novoTipo) await upsertMarcacao({nome, turno, dateISO: dataISO, tipo: novoTipo});
        else await deleteMarcacao({nome, dateISO: dataISO});
        applyMarkToRow(tr, novoTipo);
        toast(novoTipo ? 'Marcação registrada' : 'Marcação removida', 'success');
        invalidateCacheForDate(dataISO);
        const updateItem = (list) => {
            const item = list.find(x => x.Nome === nome);
            if (item) item.Marcacao = novoTipo;
        };
        updateItem(state.baseList);
        updateItem(state.filtered);
        computeSummary(state.filtered, state.meta);
    } catch (e) {
        console.error(e);
        toast('Falha ao registrar marcação', 'error');
        await carregar(true);
    } finally {
        state.isProcessing = false;
        showLoading(false);
    }
}async function marcarTodosPresentes() {
    const dataISO = ui.date.value;
    if (!dataISO) return toast('Selecione a data.', 'info');
    const pendTrs = Array.from(ui.tbody.querySelectorAll('tr')).filter(tr => tr.dataset.nome && (tr.dataset.mark || 'NONE') === 'NONE');
    if (!pendTrs.length) return toast('Não há colaboradores pendentes visíveis para marcar.', 'info');
    if (!confirm(`Marcar ${pendTrs.length} colaboradores visíveis como "Presente"?`)) return;
    const nomes = pendTrs.map(tr => tr.dataset.nome);
    ui.markAllBtn.disabled = true;
    ui.clearAllBtn.disabled = true;
    ui.markAllBtn.textContent = 'Marcando...';
    showLoading(true);
    try {
        const {data: maxRow, error: maxErr} = await supabase
            .from('ControleDiario')
            .select('Numero')
            .order('Numero', {ascending: false})
            .limit(1);
        if (maxErr) throw maxErr;
        let nextNumero = ((maxRow && maxRow[0] && maxRow[0].Numero) || 0) + 1;        const {data: colabsInfo, error: colabError} = await supabase
            .from('Colaboradores')
            .select('Nome, Escala, MATRIZ, Cargo')
            .in('Nome', nomes);
        if (colabError) throw colabError;
        const colabInfoMap = new Map(colabsInfo.map(c => [c.Nome, c]));        const rowsToUpsert = nomes.map(nome => {
            const info = colabInfoMap.get(nome) || {};
            const newRow = {
                Numero: nextNumero,
                Nome: nome,
                Data: dataISO,
                Presença: 1,
                Falta: 0,
                Atestado: 0,
                'Folga Especial': 0,
                Suspensao: 0,
                Feriado: 0,
                Turno: info.Escala || state.turnoAtual,
                MATRIZ: info.MATRIZ,
                Cargo: info.Cargo
            };
            nextNumero++;
            return newRow;
        });        const {error} = await supabase
            .from('ControleDiario')
            .upsert(rowsToUpsert, {onConflict: 'Nome, Data'});
        if (error) throw error;        pendTrs.forEach(tr => {
            const nome = tr.dataset.nome;
            applyMarkToRow(tr, 'PRESENCA');
            const item = state.baseList.find(x => x.Nome === nome);
            if (item) item.Marcacao = 'PRESENCA';
        });        invalidateCacheForDate(dataISO);
        await refresh();
        toast(`${nomes.length} colaboradores marcados como "Presente"!`, 'success');
    } catch (e) {
        console.error('Erro na marcação em massa:', e);
        toast('Erro na marcação em massa. A página será recarregada.', 'error');
        await carregar(true);
    } finally {
        ui.markAllBtn.disabled = false;
        ui.clearAllBtn.disabled = false;
        ui.markAllBtn.textContent = 'Marcar Todos como Presente';
        showLoading(false);
    }
}async function limparTodas() {
    const dataISO = ui.date.value;
    if (!dataISO) return toast('Selecione a data.', 'info');
    const marcadosTrs = Array.from(ui.tbody.querySelectorAll('tr')).filter(tr => (tr.dataset.mark || 'NONE') !== 'NONE');
    if (!marcadosTrs.length) return toast('Não há marcações visíveis.', 'info');
    if (!confirm(`Limpar marcações de ${marcadosTrs.length} colaboradores visíveis?`)) return;
    const nomes = marcadosTrs.map(tr => tr.dataset.nome);
    ui.markAllBtn.disabled = true;
    ui.clearAllBtn.disabled = true;
    ui.clearAllBtn.textContent = 'Limpando...';
    showLoading(true);
    try {
        const {error: eDel} = await supabase
            .from('ControleDiario')
            .delete()
            .eq('Data', dataISO)
            .in('Nome', nomes);
        if (eDel) throw eDel;
        marcadosTrs.forEach(tr => {
            const nome = tr.dataset.nome;
            applyMarkToRow(tr, null);
            const item = state.baseList.find(x => x.Nome === nome);
            if (item) item.Marcacao = null;
        });
        invalidateCacheForDate(dataISO);
        await refresh();
        toast('Marcações limpas!', 'success');
    } catch (e) {
        console.error(e);
        toast('Erro ao limpar em massa', 'error');
        await carregar(true);
    } finally {
        ui.markAllBtn.disabled = false;
        ui.clearAllBtn.disabled = false;
        ui.clearAllBtn.textContent = 'Limpar Marcações Visíveis';
        showLoading(false);
    }
}function listDates(aISO, bISO) {
    let a = new Date(aISO), b = new Date(bISO);
    if (a > b) [a, b] = [b, a];
    const out = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        out.push(new Date(d).toISOString().slice(0, 10));
    }
    return out;
}const csvEsc = (v) => {
    const s = (v ?? '').toString();
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};async function ensureXLSX() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Falha ao carregar biblioteca XLSX'));
        document.head.appendChild(s);
    });
}function autoColWidths(headers, rows) {
    return headers.map(h => {
        const maxLen = Math.max(String(h).length, ...rows.map(r => String(r[h] ?? '').length));
        return {wch: Math.min(Math.max(10, maxLen + 2), 40)};
    });
}function clampEndToToday(startISO, endISO) {
    if (!startISO || !endISO) return [startISO, endISO];
    const today = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const todayISO = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    return [startISO, endISO > todayISO ? todayISO : endISO];
}async function exportXLSX() {
    const [start, endClamped] = clampEndToToday(state.period.start, state.period.end);
    if (!start || !endClamped) return toast('Selecione o período.', 'info');
    if (!confirm(`Exportar dados filtrados (${start} → ${endClamped}) em XLSX?`)) return;
    try {
        showLoading(true);
        ui.exportBtn.disabled = true;
        ui.exportBtn.textContent = 'Exportando…';
        await ensureXLSX();
        const HEADERS = ['Nome', 'Cargo', 'Presença', 'Falta', 'Atestado', 'Folga Especial', 'Suspensao', 'Feriado', 'Data', 'Turno', 'SVC', 'Gestor', 'Contrato', 'Matriz'];
        const rows = [];
        for (const dateISO of listDates(start, endClamped)) {
            const {list} = await fetchList(state.turnoAtual, dateISO);
            const filtered = applyFilters(list);
            filtered.sort((a, b) => collator.compare(a, b));
            for (const x of filtered) {
                const pres = x.Marcacao === 'PRESENCA' ? 1 : 0;
                const fal = x.Marcacao === 'FALTA' ? 1 : 0;
                const ate = x.Marcacao === 'ATESTADO' ? 1 : 0;
                const fe = x.Marcacao === 'F_ESPECIAL' ? 1 : 0;
                const sus = x.Marcacao === 'SUSPENSAO' ? 1 : 0;
                const fer = x.Marcacao === 'FERIADO' ? 1 : 0;
                rows.push({
                    'Nome': x.Nome || '',
                    'Cargo': x.Cargo || '',
                    'Presença': pres,
                    'Falta': fal,
                    'Atestado': ate,
                    'Folga Especial': fe,
                    'Suspensao': sus,
                    'Feriado': fer,
                    'Data': dateISO,
                    'Turno': x.Escala || '',
                    'SVC': x.SVC || '',
                    'Gestor': x.Gestor || '',
                    'Contrato': x.Contrato || '',
                    'Matriz': x.Matriz || ''
                });
            }
        }
        if (rows.length === 0) {
            toast('Nada para exportar com os filtros atuais.', 'info');
            return;
        }
        const wb = window.XLSX.utils.book_new();
        const ws = window.XLSX.utils.json_to_sheet(rows, {header: HEADERS});
        ws['!cols'] = autoColWidths(HEADERS, rows);
        window.XLSX.utils.book_append_sheet(wb, ws, 'Controle Diário');
        const slugTurno = state.turnoAtual === 'GERAL' ? 'GERAL' : state.turnoAtual;
        const fileName = `controle-diario_filtrado_${slugTurno}_${start}_a_${endClamped}.xlsx`;
        window.XLSX.writeFile(wb, fileName);
        toast('Exportação concluída', 'success');
    } catch (e) {
        console.error(e);
        toast('Falha na exportação', 'error');
    } finally {
        showLoading(false);
        ui.exportBtn.disabled = false;
        ui.exportBtn.textContent = 'Exportar dados';
    }
}function updatePeriodLabel() {
    ui.periodBtn.textContent = 'Selecionar Período';
}function openPeriodModal() {
    const today = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const toISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const curStart = state.period.start || toISO(new Date(today.getFullYear(), today.getMonth(), 1));
    const curEnd = state.period.end || toISO(today);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    const prevStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevEnd = new Date(today.getFullYear(), today.getMonth(), 0);
    const overlay = document.createElement('div');
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
      </div>`;
    const cssId = 'cdp-style';
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
    const elStart = overlay.querySelector('#cdp-period-start');
    const elEnd = overlay.querySelector('#cdp-period-end');
    const btnCancel = overlay.querySelector('#cdp-cancel');
    const btnApply = overlay.querySelector('#cdp-apply');
    const close = () => overlay.remove();
    overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) close();
    });
    btnCancel.onclick = close;
    overlay.querySelector('#cdp-today').onclick = () => {
        const iso = toISO(today);
        [state.period.start, state.period.end] = [iso, iso];
        updatePeriodLabel();
        if (ui.date) ui.date.value = iso;
        close();
        carregar(true);
    };
    overlay.querySelector('#cdp-yday').onclick = () => {
        const iso = toISO(yesterday);
        [state.period.start, state.period.end] = [iso, iso];
        updatePeriodLabel();
        if (ui.date) ui.date.value = iso;
        close();
        carregar(true);
    };
    overlay.querySelector('#cdp-prevmo').onclick = () => {
        const s = toISO(prevStart);
        const e = toISO(prevEnd);
        const [cs, ce] = clampEndToToday(s, e);
        state.period.start = cs;
        state.period.end = ce;
        updatePeriodLabel();
        close();
    };
    btnApply.onclick = () => {
        let sVal = (elStart?.value || '').slice(0, 10);
        let eVal = (elEnd?.value || '').slice(0, 10);
        if (!sVal || !eVal) {
            toast('Selecione as duas datas.', 'info');
            return;
        }
        [sVal, eVal] = clampEndToToday(sVal, eVal);
        state.period.start = sVal;
        state.period.end = eVal;
        updatePeriodLabel();
        close();
    };
}function injectSummaryStyles() {
    const style = document.createElement('style');
    style.textContent = `
        /* O container pai agora só organiza os itens (botão e sumário) */
        #cd-summary {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px; /* Aumentei o espaço entre o botão e o card */
            margin-bottom: 1rem;
        }
        /* Estilos do botão "Pendentes" (sem alteração) */
        .summary-pending {
            font-size: 1.2em;
            font-weight: bold;
            padding: 4px 8px;
            border-radius: 6px;
            color: #fff;
            transition: all 0.2s ease;
            cursor: pointer;
        }
        .summary-pending:hover { transform: scale(1.05); }
        .summary-pending.active {
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.4);
            transform: translateY(1px);
        }
        .summary-pending.status-orange { background-color: #f59e0b; }
        .summary-pending.status-green  { background-color: #10b981; }
        /* AQUI A MUDANÇA: */
        /* Aplicamos o card branco SÓ no texto do sumário */
        .summary-main {
            background-color: #ffffff; /* Fundo branco */
            border-radius: 12px; /* Cantos arredondados */
            padding: 10px 15px; /* Espaçamento interno */
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1); /* Sombra suave */
            color: #333; /* Cor do texto para contraste */
            font-size: 0.95em;
            font-weight: 700;
            text-align: center;
            /* Garante que o texto quebre se a tela for pequena */
            max-width: 100%; 
            word-wrap: break-word;
        }
    `;
    document.head.appendChild(style);
}export async function init() {
    const pad2 = (n) => String(n).padStart(2, '0');
    const localISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    injectSummaryStyles();
    ui = {
        tbody: document.getElementById('cd-tbody'),
        dsrTable: document.getElementById('cd-dsr-table'),
        summary: document.getElementById('cd-summary'),
        date: document.getElementById('cd-data'),
        markAllBtn: document.getElementById('cd-mark-all-present'),
        clearAllBtn: document.getElementById('cd-clear-all'),
        exportBtn: document.getElementById('cd-export'),
        periodBtn: document.getElementById('cd-period-btn'),
        search: document.getElementById('cd-search'),
        selGestor: document.getElementById('cd-filter-gestor'),
        selCargo: document.getElementById('cd-filter-cargo'),
        selContrato: document.getElementById('cd-filter-contrato'),
        selSVC: document.getElementById('cd-filter-svc'),
        selMatriz: document.getElementById('cd-filter-matriz'),
        footerCount: document.getElementById('cd-list-footer'),
        showMoreBtn: document.getElementById('cd-show-more'),
    };
    const hoje = localISO(new Date());
    const firstOfMonth = (() => {
        const d = new Date();
        d.setDate(1);
        return localISO(d);
    })();
    state = {
        turnoAtual: 'GERAL',
        baseList: [],
        filtered: [],
        meta: {},
        colabMap: new Map(),
        filters: {search: '', gestor: '', cargo: '', contrato: '', svc: '', matriz: ''},
        period: {start: firstOfMonth, end: hoje},
        isPendingFilterActive: false,
        isProcessing: false,
        dsrInfoList: [],
    };
    if (!ui.date.value) ui.date.value = hoje;
    document.querySelectorAll('.subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.turnoAtual = btn.dataset.turno || 'T1';
            carregar(true);
        });
    });
    if (ui.summary) {
        ui.summary.addEventListener('click', (e) => {
            const pendingBtn = e.target.closest('#cd-summary-pending-btn');
            if (pendingBtn) {
                state.isPendingFilterActive = !state.isPendingFilterActive;
                refresh();
            }
        });
    }
    ui.tbody.addEventListener('click', onRowClick);
    ui.markAllBtn?.addEventListener('click', marcarTodosPresentes);
    ui.clearAllBtn?.addEventListener('click', limparTodas);
    ui.exportBtn?.addEventListener('click', exportXLSX);
    ui.periodBtn?.addEventListener('click', openPeriodModal);
    ui.date?.addEventListener('change', () => carregar(true));
    ui.search.addEventListener('input', () => {
        state.filters.search = ui.search.value;
        refresh();
    });
    ui.selGestor.addEventListener('change', () => {
        state.filters.gestor = ui.selGestor.value;
        refresh();
    });
    ui.selCargo.addEventListener('change', () => {
        state.filters.cargo = ui.selCargo.value;
        refresh();
    });
    ui.selContrato.addEventListener('change', () => {
        state.filters.contrato = ui.selContrato.value;
        refresh();
    });
    ui.selSVC.addEventListener('change', () => {
        state.filters.svc = ui.selSVC.value;
        refresh();
    });
    ui.selMatriz.addEventListener('change', () => {
        state.filters.matriz = ui.selMatriz.value;
        refresh();
    });
    updatePeriodLabel();
    await carregar(true);
}export function destroy() {
}