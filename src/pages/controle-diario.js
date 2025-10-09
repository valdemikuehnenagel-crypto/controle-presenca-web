import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

let state;
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

function showLoading(on = true) {
    const el = document.getElementById('cd-loading');
    if (!el) return;
    el.style.display = on ? 'flex' : 'none';
}

function toast(msg, type = 'info', timeout = 2500) {
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
}

function weekdayPT(iso) {
    const d = new Date(iso + 'T00:00:00');
    const dias = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
    return dias[d.getDay()];
}

function uniqSorted(arr) {
    return Array.from(new Set(arr.filter(Boolean))).sort((a, b) => collator.compare(a, b));
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


async function getColaboradoresElegiveis(turno, dateISO) {
    const dia = weekdayPT(dateISO);
    const variantes = [dia, NORM(dia)];

    let matrizesPermitidas = getMatrizesPermitidas();
    if (Array.isArray(matrizesPermitidas) && matrizesPermitidas.length === 0) {
        matrizesPermitidas = null;
    }

    let q = supabase
        .from('Colaboradores')
        .select('Nome, Escala, DSR, Cargo, MATRIZ, SVC, Gestor, Contrato, Ativo, "Data de admissão"')
        .eq('Ativo', 'SIM');

    if (!turno || turno === 'GERAL') {
        q = q.in('Escala', ['T1', 'T2', 'T3']);
    } else {
        q = q.eq('Escala', turno);
    }

    if (matrizesPermitidas && matrizesPermitidas.length) {
        q = q.in('MATRIZ', matrizesPermitidas);
    }

    q = q.order('Nome', {ascending: true});

    try {
        const cols = await fetchAllWithPagination(q);


        const {data: feriasHoje, error: feriasError} = await supabase
            .from('Ferias')
            .select('Nome')
            .lte('"Data Inicio"', dateISO)
            .gte('"Data Final"', dateISO);

        if (feriasError) {
            console.warn("Erro ao buscar férias do dia:", feriasError);
        }

        const nomesEmFeriasHoje = new Set((feriasHoje || []).map(f => f.Nome));


        const all = cols || [];

        const dsrList = all
            .filter(c => {
                const dsr = (c.DSR || '').toString().toUpperCase();
                return variantes.includes(dsr) || variantes.includes(NORM(dsr));
            })
            .map(c => c.Nome);

        const elegiveis = all
            .filter(c => {

                const dataAdmissao = c['Data de admissão'];
                if (dataAdmissao && dataAdmissao > dateISO) {
                    return false;
                }


                if (nomesEmFeriasHoje.has(c.Nome)) {
                    return false;
                }


                const dsr = (c.DSR || '').toString().toUpperCase();
                const isDSR = variantes.includes(dsr) || variantes.includes(NORM(dsr));

                return !isDSR;
            })
            .sort((a, b) => collator.compare(a.Nome, b.Nome));

        return {elegiveis, dsrList};

    } catch (error) {
        console.error("Erro ao buscar colaboradores elegíveis com paginação:", error);
        throw error;
    }
}


async function getMarksFor(dateISO, nomes) {
    if (!nomes.length) return new Map();

    const {data, error} = await supabase
        .rpc('get_marcas_para_nomes', {
            nomes: nomes, data_consulta: dateISO
        });

    if (error) throw error;

    const map = new Map();
    (data || []).forEach(m => {
        let tipo = null;
        if (m['Presença']) tipo = 'PRESENCA'; else if (m['Falta']) tipo = 'FALTA'; else if (m['Atestado']) tipo = 'ATESTADO'; else if (m['Folga Especial']) tipo = 'F_ESPECIAL'; else if (m['Feriado']) tipo = 'FERIADO'; else if (m['Suspensao']) tipo = 'SUSPENSAO';
        map.set(m.Nome, tipo);
    });
    return map;
}

async function fetchList(turno, dateISO) {
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
        return {list: Array.from(byName.values()), meta: {dsrList: Array.from(dsrSet)}};
    }

    const {elegiveis, dsrList} = await getColaboradoresElegiveis(turno, dateISO);
    const markMap = await getMarksFor(dateISO, elegiveis.map(x => x.Nome));

    const list = elegiveis.map(c => ({
        Nome: c.Nome,
        Cargo: c.Cargo || '',
        SVC: c.SVC || '',
        Gestor: c.Gestor || '',
        Contrato: c.Contrato || '',
        Matriz: c.MATRIZ || '',
        Escala: c.Escala || '',
        Marcacao: markMap.get(c.Nome) || null
    }));

    return {list, meta: {dsrList}};
}


async function upsertMarcacao({nome, turno, dateISO, tipo}) {
    const zeros = {'Presença': 0, 'Falta': 0, 'Atestado': 0, 'Folga Especial': 0, 'Suspensao': 0, 'Feriado': 0};
    const setOne = {...zeros};
    if (tipo === 'PRESENCA') setOne['Presença'] = 1; else if (tipo === 'FALTA') setOne['Falta'] = 1; else if (tipo === 'ATESTADO') setOne['Atestado'] = 1; else if (tipo === 'F_ESPECIAL') setOne['Folga Especial'] = 1; else if (tipo === 'FERIADO') setOne['Feriado'] = 1; else if (tipo === 'SUSPENSAO') setOne['Suspensao'] = 1; else throw new Error('Tipo inválido.');


    const {data: colabInfo, error: colabErr} = await supabase
        .from('Colaboradores')
        .select('Escala, SVC, MATRIZ')
        .eq('Nome', nome)
        .single();
    if (colabErr) throw colabErr;

    const turnoToUse = turno || colabInfo.Escala || null;

    const {data: existing, error: findErr} = await supabase
        .from('ControleDiario')
        .select('Numero')
        .eq('Nome', nome)
        .eq('Data', dateISO)
        .limit(1);
    if (findErr) throw findErr;

    if (existing && existing.length > 0) {
        const {error: updErr} = await supabase
            .from('ControleDiario')
            .update({...zeros, ...setOne, Turno: turnoToUse})
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
        const nextNumero = ((maxRow && maxRow[0] && maxRow[0].Numero) || 0) + 1;
        const row = {Numero: nextNumero, Nome: nome, Data: dateISO, Turno: turnoToUse, ...setOne};
        const {error: insErr} = await supabase.from('ControleDiario').insert(row);
        if (insErr) throw insErr;
    }

    try {
        if (window.absSyncForRow) {

            console.log('Enviando para absSyncForRow:', {
                Nome: nome, Data: dateISO, Falta: setOne['Falta'] || 0, Atestado: setOne['Atestado'] || 0,

                Escala: turnoToUse, SVC: colabInfo.SVC, MATRIZ: colabInfo.MATRIZ
            });

            await window.absSyncForRow({
                Nome: nome, Data: dateISO, Falta: setOne['Falta'] || 0, Atestado: setOne['Atestado'] || 0,

                Escala: turnoToUse, SVC: colabInfo.SVC, MATRIZ: colabInfo.MATRIZ
            });
        }
    } catch (e) {
        console.warn('ABS sync (row) falhou:', e);
    }
}

async function deleteMarcacao({nome, dateISO}) {
    const {error} = await supabase
        .from('ControleDiario')
        .delete()
        .eq('Nome', nome)
        .eq('Data', dateISO);
    if (error) throw error;

    try {
        if (window.absSyncForRow) {
            await window.absSyncForRow({
                Nome: nome, Data: dateISO, Falta: 0, Atestado: 0
            });
        }
    } catch (e) {
        console.warn('ABS sync (delete) falhou:', e);
    }
}


function ensureExtendedHeader() {
    const headerRow = document.querySelector('.main-table thead tr');
    if (!headerRow) return;
    const need = [{key: 'cargo', label: 'Cargo'}, {key: 'svc', label: 'SVC'}, {
        key: 'gestor',
        label: 'Gestor'
    }, {key: 'dsr', label: 'DSR do dia'}];
    need.forEach(({key, label}) => {
        if (!headerRow.querySelector(`th[data-col="${key}"]`)) {
            const th = document.createElement('th');
            th.textContent = label;
            th.setAttribute('data-col', key);
            headerRow.appendChild(th);
        }
    });
}


function label(tipo) {
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
}

function btnsHTML(item) {
    const tipos = [{label: 'P', tipo: 'PRESENCA', className: 'status-p'}, {
        label: 'F',
        tipo: 'FALTA',
        className: 'status-f'
    }, {label: 'A', tipo: 'ATESTADO', className: 'status-a'}, {
        label: 'F.E',
        tipo: 'F_ESPECIAL',
        className: 'status-fe'
    }, {label: 'S', tipo: 'SUSPENSAO', className: 'status-s'}, {
        label: 'F.D',
        tipo: 'FERIADO',
        className: 'status-fd'
    }, {label: 'X', tipo: 'LIMPAR', className: 'status-x'},];
    return tipos.map(b => {
        const on = item.Marcacao === b.tipo ? ' active' : '';
        return `<button class="cd-btn ${b.className}${on}" data-tipo="${b.tipo}" data-nome="${item.Nome}">${b.label}</button>`;
    }).join('');
}

function applyMarkToRow(tr, tipo) {
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
}


function passFilters(x) {
    const f = state.filters;
    if (f.search && !NORM(x.Nome).includes(NORM(f.search))) return false;
    if (f.gestor && (x.Gestor || '') !== f.gestor) return false;
    if (f.cargo && (x.Cargo || '') !== f.cargo) return false;
    if (f.contrato && (x.Contrato || '') !== f.contrato) return false;
    if (f.svc && (x.SVC || '') !== f.svc) return false;
    if (f.matriz && getMatriz(x) !== f.matriz) return false;


    if (state.isPendingFilterActive && x.Marcacao) {
        return false;
    }

    return true;
}


function applyFilters(list) {
    return list.filter(passFilters).sort((a, b) => collator.compare(a.Nome, b.Nome));
}

function passFiltersExcept(x, exceptKey) {
    const f = state.filters;
    if (f.search && !NORM(x.Nome).includes(NORM(f.search))) return false;

    if (exceptKey !== 'gestor' && f.gestor && (x.Gestor || '') !== f.gestor) return false;
    if (exceptKey !== 'cargo' && f.cargo && (x.Cargo || '') !== f.cargo) return false;
    if (exceptKey !== 'contrato' && f.contrato && (x.Contrato || '') !== f.contrato) return false;
    if (exceptKey !== 'svc' && f.svc && (x.SVC || '') !== f.svc) return false;
    if (exceptKey !== 'matriz' && f.matriz && getMatriz(x) !== f.matriz) return false;

    return true;
}

function recomputeOptionsFor(key) {

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
}

function fillPreserving(sel, values, placeholder, current, onInvalid) {
    if (!sel) return;


    sel.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option value="${v}">${v}</option>`).join('');


    if (current && values.includes(current)) {
        sel.value = current;
    } else {
        sel.value = '';
        if (typeof onInvalid === 'function') onInvalid();
    }
}

/**
 * Atualiza TODAS as combos com base no estado atual dos filtros,
 * aplicando todos os demais filtros + busca (comportamento em cascata).
 */
function repopulateFilterOptionsCascade() {

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
}


function fill(sel, values, placeholder) {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option value="${v}">${v}</option>`).join('');
    sel.value = values.includes(prev) ? prev : '';
}


async function renderRows(list) {
    ensureExtendedHeader();
    ui.tbody.innerHTML = '';

    const dsrNamesRaw = (state.meta?.dsrList || []).slice();
    if (!dsrNamesRaw.length && list.length === 0) {
        ui.tbody.innerHTML = '<tr><td colspan="6">Nenhum colaborador previsto para hoje.</td></tr>';
        return;
    }

    let dsrInfos = dsrNamesRaw.map(n => ({Nome: n}));

    try {
        const {data: info, error} = await supabase
            .from('Colaboradores')
            .select('Nome, Cargo, SVC, Gestor, Contrato, MATRIZ')
            .in('Nome', dsrNamesRaw);

        if (!error && Array.isArray(info)) {
            const byName = new Map(info.map(x => [x.Nome, x]));
            dsrInfos = dsrNamesRaw.map(n => byName.get(n) || {Nome: n});
        }
    } catch (_) { /* silencioso */
    }

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

            const tdCargo = document.createElement('td');
            tdCargo.textContent = item.Cargo || '';
            const tdSVC = document.createElement('td');
            tdSVC.textContent = item.SVC || '';
            const tdGestor = document.createElement('td');
            tdGestor.textContent = item.Gestor || '';

            const tdDSR = document.createElement('td');
            tdDSR.textContent = dsrName;

            tr.append(tdNome, tdAcoes, tdCargo, tdSVC, tdGestor, tdDSR);
        } else {
            const dash = () => {
                const td = document.createElement('td');
                td.textContent = '—';
                return td;
            };
            const tdDSR = document.createElement('td');
            tdDSR.textContent = dsrName;
            tr.append(dash(), dash(), dash(), dash(), dash(), tdDSR);
        }

        frag.appendChild(tr);
    }

    ui.tbody.replaceChildren(frag);
}


function computeSummary(list, meta) {
    const isConf = x => String(x.Cargo || '').toUpperCase() === 'CONFERENTE';


    const aux = list.filter(x => !isConf(x));

    const hcPrevisto = aux.length;
    const hcReal = aux.filter(x => x.Marcacao === 'PRESENCA').length;
    const confReal = list.filter(x => isConf(x) && x.Marcacao === 'PRESENCA').length;


    const pend = list.filter(x => !x.Marcacao).length;

    const faltas = list.filter(x => x.Marcacao === 'FALTA').length;
    const atest = list.filter(x => x.Marcacao === 'ATESTADO').length;
    const fesp = list.filter(x => x.Marcacao === 'F_ESPECIAL').length;
    const fer = list.filter(x => x.Marcacao === 'FERIADO').length;
    const susp = list.filter(x => x.Marcacao === 'SUSPENSAO').length;

    const quadroTotal = hcReal + confReal;

    let dsrCount = 0;
    if (meta?.dsrList?.length) {
        const dsrColabs = meta.dsrList.map(nome => state.baseList.find(c => c.Nome === nome) || state.colabMap.get(nome) || {Nome: nome});
        dsrCount = dsrColabs.filter(passFilters).length;
    }

    const pendentesClass = pend > 0 ? 'status-orange' : 'status-green';

    const mainSummaryHTML = `HC Previsto: ${hcPrevisto} | HC Real: ${hcReal} | ` + `Faltas: ${faltas} | Atestados: ${atest} | Folga Especial: ${fesp} | ` + `Feriado: ${fer} | Suspensão: ${susp} | DSR: ${dsrCount} | ` + `Conferente: ${confReal} | Quadro total: ${quadroTotal}`;


    const activeClass = state.isPendingFilterActive ? 'active' : '';
    ui.summary.innerHTML = `
        <div id="cd-summary-pending-btn" class="summary-pending ${pendentesClass} ${activeClass}" title="Clique para filtrar pendentes">
            Pendentes: ${pend}
        </div>
        <div class="summary-main">
            ${mainSummaryHTML}
        </div>
    `;
}


async function carregar(full = false) {
    const dateISO = ui.date.value;
    if (!dateISO) return;
    if (full) ui.summary.textContent = 'Carregando…';

    try {
        showLoading(true);


        const {elegiveis, dsrList} = await getColaboradoresElegiveis(state.turnoAtual, dateISO);

        state.colabMap.clear();
        const todosColabs = [...elegiveis];
        const nomesDSR = new Set(dsrList);
        const nomesElegiveis = new Set(elegiveis.map(c => c.Nome));

        nomesDSR.forEach(nome => {
            if (!nomesElegiveis.has(nome)) {


                todosColabs.push({Nome: nome, DSR: weekdayPT(dateISO)});
            }
        });
        todosColabs.forEach(c => state.colabMap.set(c.Nome, c));

        const markMap = await getMarksFor(dateISO, elegiveis.map(c => c.Nome));

        state.baseList = elegiveis.map(c => ({
            ...c,

            Matriz: getMatriz(c), Marcacao: markMap.get(c.Nome) || null
        }));


        state.meta = {dsrList};


        repopulateFilterOptionsCascade();

        refresh();

    } catch (e) {
        console.error(e);
        toast('Erro ao carregar dados', 'error');
        ui.tbody.innerHTML = '<tr><td colspan="6">Erro ao carregar. Veja o console.</td></tr>';
        ui.summary.textContent = 'Erro ao carregar.';
    } finally {
        showLoading(false);
    }
}


async function onRowClick(ev) {
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

    try {
        showLoading(true);
        const novoTipo = tipo === 'LIMPAR' ? null : tipo;

        if (novoTipo) {
            const turno = state.turnoAtual === 'GERAL' ? null : state.turnoAtual;
            await upsertMarcacao({nome, turno, dateISO: dataISO, tipo: novoTipo});
        } else {
            await deleteMarcacao({nome, dateISO: dataISO});
        }


        applyMarkToRow(tr, novoTipo);
        toast(novoTipo ? 'Marcação registrada' : 'Marcação removida', 'success');


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
        showLoading(false);
    }
}

async function marcarTodosPresentes() {
    const dataISO = ui.date.value;
    if (!dataISO) return toast('Selecione a data.', 'info');

    const pendTrs = Array.from(ui.tbody.querySelectorAll('tr'))
        .filter(tr => (tr.dataset.mark || 'NONE') === 'NONE');

    if (!pendTrs.length) return toast('Não há pendentes visíveis.', 'info');
    if (!confirm(`Marcar ${pendTrs.length} colaboradores visíveis como "Presente"?`)) return;

    const nomes = pendTrs.map(tr => tr.dataset.nome);

    try {
        showLoading(true);

        const {data: existentes, error: e1} = await supabase
            .from('ControleDiario')
            .select('Nome')
            .eq('Data', dataISO)
            .in('Nome', nomes);
        if (e1) throw e1;

        const setExistentes = new Set((existentes || []).map(r => r.Nome));
        const paraUpdate = nomes.filter(n => setExistentes.has(n));
        const paraInsert = nomes.filter(n => !setExistentes.has(n));

        if (paraUpdate.length) {
            const zeros = {'Presença': 0, 'Falta': 0, 'Atestado': 0, 'Folga Especial': 0, 'Suspensao': 0, 'Feriado': 0};
            const setOne = {...zeros, 'Presença': 1};
            const {error: eUpd} = await supabase
                .from('ControleDiario')
                .update(setOne)
                .eq('Data', dataISO)
                .in('Nome', paraUpdate);
            if (eUpd) throw eUpd;
        }

        let escMap = new Map();
        if (paraInsert.length) {
            const {data: cols, error: eCols} = await supabase
                .from('Colaboradores')
                .select('Nome, Escala')
                .in('Nome', paraInsert);
            if (eCols) throw eCols;
            escMap = new Map((cols || []).map(c => [c.Nome, c.Escala || null]));

            const {data: maxRow, error: eMax} = await supabase
                .from('ControleDiario')
                .select('Numero')
                .order('Numero', {ascending: false})
                .limit(1);
            if (eMax) throw eMax;

            let nextNumero = ((maxRow && maxRow[0] && maxRow[0].Numero) || 0) + 1;
            const rows = paraInsert.map((nome) => ({
                Numero: nextNumero++,
                Nome: nome,
                Data: dataISO,
                Turno: escMap.get(nome) || null,
                'Presença': 1,
                'Falta': 0,
                'Atestado': 0,
                'Folga Especial': 0,
                'Suspensao': 0,
                'Feriado': 0
            }));

            if (rows.length) {
                const {error: eIns} = await supabase.from('ControleDiario').insert(rows);
                if (eIns) throw eIns;
            }
        }

        pendTrs.forEach(tr => applyMarkToRow(tr, 'PRESENCA'));
        state.baseList = state.baseList.map(x => nomes.includes(x.Nome) ? {...x, Marcacao: 'PRESENCA'} : x);
        state.filtered = applyFilters(state.baseList);
        renderRows(state.filtered);
        computeSummary(state.filtered, state.meta);

        try {
            if (window.absSyncBatch) {
                const payload = nomes.map(n => ({
                    Nome: n, Data: dataISO, Turno: escMap.get(n) || null, Falta: 0, Atestado: 0
                }));
                await window.absSyncBatch(payload);
            }
        } catch (e) {
            console.warn('ABS sync (batch presentes) falhou:', e);
        }

        toast('Marcação em massa concluída!', 'success');
    } catch (e) {
        console.error(e);
        toast('Erro na marcação em massa', 'error');
        await carregar(true);
    } finally {
        showLoading(false);
    }
}


async function limparTodas() {
    const dataISO = ui.date.value;
    if (!dataISO) return toast('Selecione a data.', 'info');

    const marcadosTrs = Array.from(ui.tbody.querySelectorAll('tr'))
        .filter(tr => (tr.dataset.mark || 'NONE') !== 'NONE');

    if (!marcadosTrs.length) return toast('Não há marcações visíveis.', 'info');
    if (!confirm(`Limpar marcações de ${marcadosTrs.length} colaboradores visíveis?`)) return;

    const nomes = marcadosTrs.map(tr => tr.dataset.nome);

    try {
        showLoading(true);

        const {error: eDel} = await supabase
            .from('ControleDiario')
            .delete()
            .eq('Data', dataISO)
            .in('Nome', nomes);
        if (eDel) throw eDel;

        marcadosTrs.forEach(tr => applyMarkToRow(tr, null));
        state.baseList = state.baseList.map(x => nomes.includes(x.Nome) ? {...x, Marcacao: null} : x);
        state.filtered = applyFilters(state.baseList);
        renderRows(state.filtered);
        computeSummary(state.filtered, state.meta);

        try {
            if (window.absSyncBatch) {
                const payload = nomes.map(n => ({
                    Nome: n, Data: dataISO, Falta: 0, Atestado: 0
                }));
                await window.absSyncBatch(payload);
            }
        } catch (e) {
            console.warn('ABS sync (batch limpar) falhou:', e);
        }

        toast('Marcações limpas!', 'success');
    } catch (e) {
        console.error(e);
        toast('Erro ao limpar em massa', 'error');
        await carregar(true);
    } finally {
        showLoading(false);
    }
}


function listDates(aISO, bISO) {
    let a = new Date(aISO), b = new Date(bISO);
    if (a > b) [a, b] = [b, a];
    const out = [];
    for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        out.push(new Date(d).toISOString().slice(0, 10));
    }
    return out;
}

const csvEsc = (v) => {
    const s = (v ?? '').toString();
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function ensureXLSX() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Falha ao carregar biblioteca XLSX'));
        document.head.appendChild(s);
    });
}

function autoColWidths(headers, rows) {
    return headers.map(h => {
        const maxLen = Math.max(String(h).length, ...rows.map(r => String(r[h] ?? '').length));
        return {wch: Math.min(Math.max(10, maxLen + 2), 40)};
    });
}

/**
 * Exporta o Controle Diário como XLSX respeitando *todos* os filtros atuais.
 * Cada linha do Excel = (colaborador filtrado) x (dia no período selecionado).
 */
async function exportXLSX() {
    const {start, end} = state.period;
    if (!start || !end) return toast('Selecione o período.', 'info');

    if (!confirm(`Exportar dados filtrados (${start} → ${end}) em XLSX?`)) return;

    try {
        showLoading(true);
        ui.exportBtn.disabled = true;
        ui.exportBtn.textContent = 'Exportando…';

        await ensureXLSX();


        const HEADERS = ['Nome', 'Cargo', 'Presença', 'Falta', 'Atestado', 'Folga Especial', 'Suspensao', 'Feriado', 'Data', 'Turno', 'SVC', 'Gestor', 'Contrato', 'Matriz'];

        const rows = [];


        for (const dateISO of listDates(start, end)) {
            const {list} = await fetchList(state.turnoAtual, dateISO);


            const filtered = applyFilters(list);


            filtered.sort((a, b) => collator.compare(a.Nome, b.Nome));

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
        const fileName = `controle-diario_filtrado_${slugTurno}_${start}_a_${end}.xlsx`;
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
}


function formatDateBR(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function updatePeriodLabel() {

    ui.periodBtn.textContent = 'Selecionar Período';
}

function openPeriodModal() {
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
    i1.value = state.period.start || '';
    i1.style.width = '100%';
    const l2 = document.createElement('label');
    l2.textContent = 'Fim';
    l2.style.display = 'block';
    const i2 = document.createElement('input');
    i2.type = 'date';
    i2.value = state.period.end || '';
    i2.style.width = '100%';

    const left = document.createElement('div');
    left.append(l1, i1);
    const right = document.createElement('div');
    right.append(l2, i2);
    grid.append(left, right);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '8px';
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

    cancel.addEventListener('click', () => document.body.removeChild(overlay));
    ok.addEventListener('click', () => {
        if (!i1.value || !i2.value) return toast('Selecione as duas datas.', 'info');
        state.period.start = i1.value;
        state.period.end = i2.value;
        updatePeriodLabel();
        document.body.removeChild(overlay);
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) document.body.removeChild(overlay);
    });
}


function injectSummaryStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #cd-summary {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            margin-bottom: 1rem;
        }

        .summary-pending {
            font-size: 1.2em;
            font-weight: bold;
            padding: 4px 8px;
            border-radius: 6px;
            color: #fff;
            transition: all 0.2s ease;
            cursor: pointer; /* <-- Adicionado cursor de clique */
        }
        
        /* ***** NOVOS ESTILOS ***** */
        .summary-pending:hover {
            transform: scale(1.05); /* Efeito ao passar o mouse */
        }
        .summary-pending.active {
            box-shadow: inset 0 2px 6px rgba(0,0,0,0.4); /* Efeito de botão pressionado */
            transform: translateY(1px);
        }
        /* ***** FIM DOS NOVOS ESTILOS ***** */
        
        .summary-pending.status-orange { background-color: #f59e0b; }
        .summary-pending.status-green { background-color: #10b981; }
    `;
    document.head.appendChild(style);
}


export async function init() {
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
}


function refresh() {

    state.filtered = applyFilters(state.baseList);


    repopulateFilterOptionsCascade();


    renderRows(state.filtered);
    computeSummary(state.filtered, state.meta);
}


export function destroy() {
}