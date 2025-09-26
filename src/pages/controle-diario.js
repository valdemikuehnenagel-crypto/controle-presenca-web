import {supabase} from '../supabaseClient.js';

let state;
let ui;

const collator = new Intl.Collator('pt-BR', {sensitivity: 'base'});
const NORM = (s) => (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

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

async function pageAll(buildQuery, pageSize = 1000) {
    let from = 0, to = pageSize - 1;
    const out = [];
    for (; ;) {
        const q = buildQuery().range(from, to);
        const {data, error} = await q;
        if (error) return {error};
        out.push(...(data || []));
        if (!data || data.length < pageSize) break;
        from = to + 1;
        to = from + pageSize - 1;
    }
    return {data: out};
}

async function getColaboradoresElegiveis(turno, dateISO) {
    const dia = weekdayPT(dateISO);
    const variantes = [dia, NORM(dia)];

    const {data: cols, error} = await pageAll(() => {
        let q = supabase
            .from('Colaboradores')
            .select('Nome, Escala, DSR, Ferias, Cargo, MATRIZ, SVC, Gestor, Contrato, Ativo')
            .eq('Ativo', 'SIM');
        if (!turno || turno === 'GERAL') q = q.in('Escala', ['T1', 'T2', 'T3']);
        else q = q.eq('Escala', turno);
        return q.order('Nome', {ascending: true});
    });
    if (error) throw error;

    const all = cols || [];

    const dsrList = all
        .filter(c => {
            const dsr = (c.DSR || '').toString().toUpperCase();
            return variantes.includes(dsr) || variantes.includes(NORM(dsr));
        })
        .map(c => c.Nome);

    const elegiveis = all
        .filter(c => String(c.Ferias || 'NAO').toUpperCase() !== 'SIM')
        .filter(c => {
            const dsr = (c.DSR || '').toString().toUpperCase();
            return !variantes.includes(dsr) && !variantes.includes(NORM(dsr));
        })
        .sort((a, b) => collator.compare(a.Nome, b.Nome));

    return {elegiveis, dsrList};
}

async function getMarksFor(dateISO, nomes) {
    if (!nomes.length) return new Map();
    const {data, error} = await pageAll(() =>
        supabase
            .from('ControleDiario')
            .select('Nome, "Presença", Falta, Atestado, "Folga Especial", Suspensao, Feriado')
            .eq('Data', dateISO)
            .in('Nome', nomes)
            .order('Nome', {ascending: true})
    );
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
    if (tipo === 'PRESENCA') setOne['Presença'] = 1;
    else if (tipo === 'FALTA') setOne['Falta'] = 1;
    else if (tipo === 'ATESTADO') setOne['Atestado'] = 1;
    else if (tipo === 'F_ESPECIAL') setOne['Folga Especial'] = 1;
    else if (tipo === 'FERIADO') setOne['Feriado'] = 1;
    else if (tipo === 'SUSPENSAO') setOne['Suspensao'] = 1;
    else throw new Error('Tipo inválido.');

    let turnoToUse = turno;
    if (!turnoToUse || turnoToUse === 'GERAL') {
        const {data: c, error: e} = await supabase.from('Colaboradores').select('Escala').eq('Nome', nome).limit(1);
        if (e) throw e;
        turnoToUse = c?.[0]?.Escala || null;
    }

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
        const nextNumero = (maxRow?.[0]?.Numero ?? 0) + 1;
        const row = {Numero: nextNumero, Nome: nome, Data: dateISO, Turno: turnoToUse, ...setOne};
        const {error: insErr} = await supabase.from('ControleDiario').insert(row);
        if (insErr) throw insErr;
    }
}

async function deleteMarcacao({nome, dateISO}) {
    const {error} = await supabase
        .from('ControleDiario')
        .delete()
        .eq('Nome', nome)
        .eq('Data', dateISO);
    if (error) throw error;
}

function ensureExtendedHeader() {
    const headerRow = document.querySelector('.main-table thead tr');
    if (!headerRow) return;
    const need = [
        {key: 'cargo', label: 'Cargo'},
        {key: 'svc', label: 'SVC'},
        {key: 'gestor', label: 'Gestor'},
        {key: 'dsr', label: 'DSR do dia'}
    ];
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
    if (f.matriz && (x.Matriz || '') !== f.matriz) return false;
    return true;
}

function applyFilters(list) {
    return list.filter(passFilters).sort((a, b) => collator.compare(a.Nome, b.Nome));
}

function buildFilterOptions(list) {
    const gestores = uniqSorted(list.map(x => x.Gestor));
    const cargos = uniqSorted(list.map(x => x.Cargo));
    const contratos = uniqSorted(list.map(x => x.Contrato));
    const svcs = uniqSorted(list.map(x => x.SVC));
    const matrizes = uniqSorted(list.map(x => x.Matriz));
    fill(ui.selGestor, gestores, 'Gestor');
    fill(ui.selCargo, cargos, 'Cargo');
    fill(ui.selContrato, contratos, 'Contrato');
    fill(ui.selSVC, svcs, 'SVC');
    fill(ui.selMatriz, matrizes, 'Matriz');
}

function fill(sel, values, placeholder) {
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

// Arquivo: controle-diario.js

function computeSummary(list, meta) {
    // 'list' já é a lista de colaboradores TRABALHANDO que passaram pelos filtros.
    // As contagens abaixo, portanto, já refletem os filtros aplicados.
    const isAux = x => String(x.Cargo || '').toUpperCase() === 'AUXILIAR';
    const isConf = x => String(x.Cargo || '').toUpperCase() === 'CONFERENTE';
    const aux = list.filter(isAux);
    const conf = list.filter(isConf);

    const hcPrevisto = aux.length;
    const hcReal = aux.filter(x => x.Marcacao === 'PRESENCA').length;
    const faltas = aux.filter(x => x.Marcacao === 'FALTA').length;
    const atest = aux.filter(x => x.Marcacao === 'ATESTADO').length;
    const fesp = aux.filter(x => x.Marcacao === 'F_ESPECIAL').length;
    const fer = aux.filter(x => x.Marcacao === 'FERIADO').length;
    const susp = aux.filter(x => x.Marcacao === 'SUSPENSAO').length;
    const pend = aux.filter(x => !x.Marcacao).length;
    const confReal = conf.filter(x => x.Marcacao === 'PRESENCA').length;
    const quadroTotal = hcReal + confReal;

    // --- INÍCIO DA CORREÇÃO ---
    // A contagem de DSR agora também respeita os filtros.
    // Buscamos os dados completos de TODOS os colaboradores do dia (trabalhando + DSR)
    // e aplicamos os filtros a eles para obter a contagem correta.
    let dsrCount = 0;
    if (meta?.dsrList?.length) {
        // Pega os dados completos de todos os colaboradores que estão de DSR
        const dsrColabs = meta.dsrList.map(nome => state.baseList.find(c => c.Nome === nome) || state.colabMap.get(nome) || {Nome: nome});

        // Aplica os filtros (passFilters) a essa lista de DSRs
        dsrCount = dsrColabs.filter(passFilters).length;
    }
    // --- FIM DA CORREÇÃO ---

    ui.summary.textContent =
        `HC Previsto: ${hcPrevisto} | HC Real: ${hcReal} | ` +
        `Faltas: ${faltas} | Atestados: ${atest} | Folga Especial: ${fesp} | ` +
        `Feriado: ${fer} | Suspensão: ${susp} | DSR: ${dsrCount} | ` +
        `Pendentes: ${pend} | Conferente: ${confReal} | Quadro total: ${quadroTotal}`;
}

// Arquivo: controle-diario.js

async function carregar(full = false) {
    const dateISO = ui.date.value;
    if (!dateISO) return;
    if (full) ui.summary.textContent = 'Carregando…';

    try {
        showLoading(true);

        // --- INÍCIO DA CORREÇÃO ---
        // 1. Buscamos TODOS os colaboradores do dia primeiro (trabalhando e DSR)
        // para ter um mapa de dados completo.
        const {elegiveis, dsrList} = await getColaboradoresElegiveis(state.turnoAtual, dateISO);

        // 2. Criamos o mapa de dados (colabMap) com TODOS, incluindo os de DSR.
        state.colabMap.clear();
        const todosColabs = [...elegiveis]; // Começa com os que estão trabalhando
        const nomesDSR = new Set(dsrList);
        const nomesElegiveis = new Set(elegiveis.map(c => c.Nome));
        // Adiciona dados de DSR que não estão na lista de elegíveis
        nomesDSR.forEach(nome => {
            if (!nomesElegiveis.has(nome)) {
                // Se não temos o dado completo, usamos o que temos (o nome)
                // A busca completa por dados de DSR acontecerá em renderRows se necessário
                todosColabs.push({Nome: nome, DSR: weekdayPT(dateISO)});
            }
        });
        todosColabs.forEach(c => state.colabMap.set(c.Nome, c));

        // 3. Com o mapa completo, buscamos as marcações do dia.
        const markMap = await getMarksFor(dateISO, elegiveis.map(c => c.Nome));

        // 4. Montamos a lista final de trabalho (baseList)
        state.baseList = elegiveis.map(c => ({
            ...c,
            Marcacao: markMap.get(c.Nome) || null
        }));

        // 5. Guardamos os metadados (lista de nomes em DSR)
        state.meta = {dsrList};
        // --- FIM DA CORREÇÃO ---

        buildFilterOptions(state.baseList);
        refresh(); // A função refresh agora vai funcionar corretamente

    } catch (e) {
        console.error(e);
        toast('Erro ao carregar dados', 'error');
        ui.tbody.innerHTML = '<tr><td colspan="6">Erro ao carregar. Veja o console.</td></tr>';
        ui.summary.textContent = 'Erro ao carregar.';
    } finally {
        showLoading(false);
    }
}

// Arquivo: controle-diario.js

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

        // Ação no banco de dados
        if (novoTipo) {
            const turno = state.turnoAtual === 'GERAL' ? null : state.turnoAtual;
            await upsertMarcacao({nome, turno, dateISO: dataISO, tipo: novoTipo});
        } else {
            await deleteMarcacao({nome, dateISO: dataISO});
        }

        // --- INÍCIO DA CORREÇÃO ---
        // 1. Atualiza o visual da linha clicada DIRETAMENTE
        applyMarkToRow(tr, novoTipo);
        toast(novoTipo ? 'Marcação registrada' : 'Marcação removida', 'success');

        // 2. Atualiza o dado correspondente nas listas de estado (baseList e filtered)
        // sem reordenar a lista inteira.
        const updateItem = (list) => {
            const item = list.find(x => x.Nome === nome);
            if (item) item.Marcacao = novoTipo;
        };
        updateItem(state.baseList);
        updateItem(state.filtered);

        // 3. Recalcula o resumo com os dados atualizados
        computeSummary(state.filtered, state.meta);
        // --- FIM DA CORREÇÃO ---

    } catch (e) {
        console.error(e);
        toast('Falha ao registrar marcação', 'error');
        // Em caso de erro, recarrega tudo para garantir consistência
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

        if (paraInsert.length) {
            const {data: cols, error: eCols} = await supabase
                .from('Colaboradores')
                .select('Nome, Escala')
                .in('Nome', paraInsert);
            if (eCols) throw eCols;
            const escMap = new Map((cols || []).map(c => [c.Nome, c.Escala || null]));

            const {data: maxRow, error: eMax} = await supabase
                .from('ControleDiario')
                .select('Numero')
                .order('Numero', {ascending: false})
                .limit(1);
            if (eMax) throw eMax;

            let nextNumero = (maxRow?.[0]?.Numero ?? 0) + 1;

            const rows = paraInsert.map((nome) => ({
                Numero: nextNumero++,
                Nome: nome,
                Data: dataISO,
                Turno: escMap.get(nome) ?? null,
                'Presença': 1,
                'Falta': 0,
                'Atestado': 0,
                'Folga Especial': 0,
                'Suspensao': 0,
                'Feriado': 0,
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

async function exportCSV() {
    const {start, end} = state.period;
    if (!start || !end) return toast('Selecione o período.', 'info');

    if (!confirm(`Exportar somente AUXILIAR (${start} → ${end})?`)) return;

    try {
        showLoading(true);
        ui.exportBtn.disabled = true;
        ui.exportBtn.textContent = 'Exportando…';

        const rows = [];
        rows.push('Nome;Presença;Falta;Atestado;Folga Especial;Suspensao;Feriado;Data;Turno;SVC');

        for (const dateISO of listDates(start, end)) {
            const {list} = await fetchList(state.turnoAtual, dateISO);
            const filtered = applyFilters(list);
            const onlyAux = filtered.filter(x => String(x.Cargo || '').toUpperCase() === 'AUXILIAR');

            for (const x of onlyAux) {
                const pres = x.Marcacao === 'PRESENCA' ? 1 : 0;
                const fal = x.Marcacao === 'FALTA' ? 1 : 0;
                const ate = x.Marcacao === 'ATESTADO' ? 1 : 0;
                const fe = x.Marcacao === 'F_ESPECIAL' ? 1 : 0;
                const sus = x.Marcacao === 'SUSPENSAO' ? 1 : 0;
                const fer = x.Marcacao === 'FERIADO' ? 1 : 0;

                rows.push([
                    csvEsc(x.Nome), pres, fal, ate, fe, sus, fer, dateISO, csvEsc(x.Escala || ''), csvEsc(x.SVC || '')
                ].join(';'));
            }
        }

        const csv = rows.join('\n');
        const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const slug = state.turnoAtual === 'GERAL' ? 'GERAL' : state.turnoAtual;
        a.href = url;
        a.download = `controle-diario_${slug}_${start}_a_${end}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

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
    // A função agora apenas define o texto estático, ignorando as datas.
    ui.periodBtn.textContent = 'Selecionar Período';
}

function openPeriodModal() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '9997'
    });
    const modal = document.createElement('div');
    Object.assign(modal.style, {
        background: '#fff', borderRadius: '12px', padding: '16px', minWidth: '420px',
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

export async function init() {
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

    const hoje = new Date().toISOString().slice(0, 10);
    state = {
        turnoAtual: 'GERAL',
        baseList: [], filtered: [], meta: {},
        colabMap: new Map(),
        filters: {search: '', gestor: '', cargo: '', contrato: '', svc: '', matriz: ''},
        period: {
            start: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10),
            end: hoje
        }
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

    ui.tbody.addEventListener('click', onRowClick);
    ui.markAllBtn?.addEventListener('click', marcarTodosPresentes);
    ui.clearAllBtn?.addEventListener('click', limparTodas);
    ui.exportBtn?.addEventListener('click', exportCSV);
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
    renderRows(state.filtered);
    computeSummary(state.filtered, state.meta);
}

export function destroy() {
}