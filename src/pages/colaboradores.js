import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';

let state = {
    colaboradoresData: [],
    dadosFiltrados: [],
    filtrosAtivos: {},
    serviceMatrizMap: new Map()
};

const ITENS_POR_PAGINA = 50;
let itensVisiveis = ITENS_POR_PAGINA;

let colaboradoresTbody,
    searchInput,
    filtrosSelect,
    limparFiltrosBtn,
    mostrarMaisBtn,
    mostrarMenosBtn,
    contadorVisiveisEl,
    addColaboradorBtn,
    addForm;

let editModal, editForm, editTitulo, editSVC, editMatriz, editExcluirBtn, editCancelarBtn, editSalvarBtn,
    editDesligarBtn, editFeriasBtn, editHistoricoBtn;
let editInputs = {};
let editOriginal = null;

let desligarModal, desligarForm, desligarNomeEl, desligarDataEl, desligarMotivoEl, desligarCancelarBtn;
let desligarColaborador = null;

let feriasModal, feriasForm, feriasNomeEl, feriasInicioEl, feriasFinalEl, feriasCancelarBtn;
let feriasColaborador = null;
let isSubmittingFerias = false;

function normalizeCPF(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits || null;
}

function toUpperNoTrim(str) {
    return typeof str === 'string' ? str.toUpperCase() : str;
}

function toUpperTrim(str) {
    return typeof str === 'string' ? str.toUpperCase().trim() : str;
}

function nullIfEmpty(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
}

function numberOrNull(v) {
    const s = nullIfEmpty(v);
    if (s === null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}

function toStartOfDay(dateish) {
    if (!dateish) return NaN;

    if (typeof dateish === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateish)) {
        const [y, m, d] = dateish.split('-').map(Number);

        return new Date(y, m - 1, d).getTime();
    }


    if (typeof dateish === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateish)) {
        const [d, m, y] = dateish.split('/').map(Number);
        return new Date(y, m - 1, d).getTime();
    }

    const d = (dateish instanceof Date) ? dateish : new Date(dateish);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}


function formatDateLocal(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return `${d}/${m}/${y}`;
}

function attachUppercaseHandlers() {
    if (!addForm || addForm.dataset.upperBound === '1') return;
    addForm.dataset.upperBound = '1';
    const uppercaseOnInput = (el) => {
        el.addEventListener('input', () => {
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const upper = toUpperNoTrim(el.value);
            if (el.value !== upper) {
                el.value = upper;
                try {
                    el.setSelectionRange(start, end);
                } catch {
                }
            }
        });
        el.addEventListener('blur', () => {
            el.value = toUpperTrim(el.value);
        });
    };
    const textInputs = addForm.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input:not([type]), textarea');
    textInputs.forEach(uppercaseOnInput);
    addForm.querySelectorAll('select').forEach((sel) => {
        sel.style.textTransform = 'uppercase';
    });
}

function attachUpperHandlersTo(form) {
    if (!form || form.dataset.upperBound === '1') return;
    form.dataset.upperBound = '1';
    const textInputs = form.querySelectorAll('input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input:not([type]), textarea');
    textInputs.forEach((el) => {
        el.addEventListener('input', () => {
            const [st, en] = [el.selectionStart, el.selectionEnd];
            const up = toUpperNoTrim(el.value);
            if (el.value !== up) {
                el.value = up;
                try {
                    el.setSelectionRange(st, en);
                } catch {
                }
            }
        });
        el.addEventListener('blur', () => {
            el.value = toUpperTrim(el.value);
        });
    });
    form.querySelectorAll('select').forEach((sel) => {
        sel.style.textTransform = 'uppercase';
    });
}


function populateGestorSelectForEdit(selectedSvc, gestorAtual = null) {
    const gestorSelect = document.getElementById('editGestor');
    if (!gestorSelect) return;

    gestorSelect.innerHTML = '';

    if (!selectedSvc) {
        gestorSelect.disabled = true;
        gestorSelect.innerHTML = '<option value="" disabled selected>Selecione um SVC...</option>';
        return;
    }

    const gestoresFiltrados = state.gestoresData
        .filter(gestor => {
            if (!gestor.SVC) return false;
            const managerSVCs = gestor.SVC.split(',').map(s => s.trim());
            return managerSVCs.includes(selectedSvc);
        })
        .sort((a, b) => a.NOME.localeCompare(b.NOME));

    if (gestoresFiltrados.length === 0) {
        gestorSelect.disabled = true;
        gestorSelect.innerHTML = '<option value="" disabled selected>Nenhum gestor para este SVC</option>';
        return;
    }

    gestorSelect.disabled = false;
    gestorSelect.innerHTML = '<option value="">Selecione um gestor...</option>';
    gestoresFiltrados.forEach(gestor => {
        const option = document.createElement('option');
        option.value = gestor.NOME;
        option.textContent = gestor.NOME;
        gestorSelect.appendChild(option);
    });

    if (gestorAtual) {
        gestorSelect.value = gestorAtual;
    }
}

function toUpperObject(obj) {
    const dateKeys = new Set(['Data de admissão', 'Data de nascimento']);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v == null) {
            out[k] = null;
            continue;
        }
        if (k === 'LDAP') {
            out[k] = nullIfEmpty(v);
            continue;
        }
        if (dateKeys.has(k)) {
            out[k] = nullIfEmpty(v);
            continue;
        }
        if (typeof v === 'string') {
            const up = toUpperTrim(v);
            out[k] = up === '' ? null : up;
        } else {
            out[k] = v;
        }
    }
    return out;
}

function renderTable(dataToRender) {
    if (!colaboradoresTbody) return;
    colaboradoresTbody.innerHTML = '';
    if (!dataToRender || dataToRender.length === 0) {
        colaboradoresTbody.innerHTML = '<tr><td colspan="10" class="text-center p-4">Nenhum colaborador encontrado.</td></tr>';
        return;
    }

    const getNomeComEmoji = (colaborador) => {
        const diasRest = state?.feriasAtivasMap?.get?.(colaborador.Nome);
        if (diasRest == null || isNaN(diasRest)) return colaborador.Nome || '';

        if (diasRest === 0) {
            return `${colaborador.Nome} 🏖️ (Termina hoje)`;
        }

        const sufixo = diasRest === 1 ? 'dia' : 'dias';
        return `${colaborador.Nome} 🏖️ (Faltam ${diasRest} ${sufixo})`;
    };

    dataToRender.forEach((colaborador) => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-nome', colaborador.Nome || '');

        const nomeCelula = getNomeComEmoji(colaborador);

        tr.innerHTML = `
            <td class="nome-col">${nomeCelula}</td>
            <td>${colaborador.Contrato || ''}</td>
            <td>${colaborador.Cargo || ''}</td>
            <td>${colaborador['Data de admissão'] ? new Date(colaborador['Data de admissão']).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : ''}</td>
            <td>${colaborador.Escala || ''}</td>
            <td>${colaborador.DSR || ''}</td>
            <td>${colaborador.SVC || ''}</td>
            <td>${colaborador.LDAP || ''}</td>
            <td>${colaborador['ID GROOT'] || ''}</td>
            <td>${colaborador['FOLGA ESPECIAL'] || ''}</td>
        `;
        colaboradoresTbody.appendChild(tr);
    });
}


function updateDisplay() {
    const dataSlice = state.dadosFiltrados.slice(0, itensVisiveis);
    renderTable(dataSlice);
    if (mostrarMenosBtn) mostrarMenosBtn.classList.toggle('hidden', itensVisiveis <= ITENS_POR_PAGINA);
    if (mostrarMaisBtn) mostrarMaisBtn.classList.toggle('hidden', itensVisiveis >= state.dadosFiltrados.length);
    if (contadorVisiveisEl) contadorVisiveisEl.textContent = `${dataSlice.length} de ${state.dadosFiltrados.length} colaboradores visíveis`;
}

function populateFilters() {
    if (!filtrosSelect) return;
    const filtros = {
        Contrato: new Set(),
        Cargo: new Set(),
        Escala: new Set(),
        DSR: new Set(),
        MATRIZ: new Set(),
        SVC: new Set(),
        'FOLGA ESPECIAL': new Set()
    };
    state.colaboradoresData.forEach((c) => {
        Object.keys(filtros).forEach((key) => {
            if (c[key]) filtros[key].add(String(c[key]));
        });
    });
    filtrosSelect.forEach((selectEl) => {
        const key = selectEl.dataset.filterKey;
        if (!key || !(key in filtros)) return;
        const options = Array.from(filtros[key]).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        while (selectEl.options.length > 1) selectEl.remove(1);
        options.forEach((option) => {
            const optionEl = document.createElement('option');
            optionEl.value = option;
            optionEl.textContent = option;
            selectEl.appendChild(optionEl);
        });
    });
}

function applyFiltersAndSearch() {
    const searchTerm = (searchInput?.value || '').toLowerCase();
    state.dadosFiltrados = state.colaboradoresData.filter((colaborador) => {
        for (const key in state.filtrosAtivos) {
            if (Object.prototype.hasOwnProperty.call(state.filtrosAtivos, key) && state.filtrosAtivos[key] && String(colaborador[key]) !== state.filtrosAtivos[key]) return false;
        }
        if (searchTerm) {
            return (
                String(colaborador.Nome || '').toLowerCase().includes(searchTerm) ||
                String(colaborador.CPF || '').toLowerCase().includes(searchTerm) ||
                String(colaborador['ID GROOT'] || '').toLowerCase().includes(searchTerm) ||
                String(colaborador.LDAP || '').toLowerCase().includes(searchTerm)
            );
        }
        return true;
    });
    itensVisiveis = ITENS_POR_PAGINA;
    updateDisplay();
}

async function fetchColaboradores() {
    if (colaboradoresTbody) {
        colaboradoresTbody.innerHTML = '<tr><td colspan="10" class="text-center p-4">Carregando...</td></tr>';
    }

    const matrizesPermitidas = getMatrizesPermitidas();

    let query = supabase
        .from('Colaboradores')
        .select('*')
        .order('Nome');

    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }

    const {data, error} = await query;

    if (error) {
        console.error('Erro ao carregar colaboradores:', error);
        if (colaboradoresTbody) {
            colaboradoresTbody.innerHTML = '<tr><td colspan="10" class="text-center p-4 text-red-500">Erro ao carregar dados.</td></tr>';
        }
        return;
    }

    state.colaboradoresData = data || [];

    try {
        const nomes = (state.colaboradoresData || []).map(c => c.Nome).filter(Boolean);
        state.feriasAtivasMap = new Map();

        if (nomes.length > 0) {
            const {data: feriasAtivas, error: ferErr} = await supabase
                .from('Ferias')
                .select('Nome, Status, "Dias para finalizar"')
                .in('Nome', nomes)
                .eq('Status', 'Em andamento');

            if (ferErr) {
                console.warn('Falha ao buscar férias ativas:', ferErr);
            } else {
                (feriasAtivas || []).forEach(f => {
                    const dias = Number(f['Dias para finalizar']);
                    state.feriasAtivasMap.set(f.Nome, Number.isFinite(dias) ? dias : null);
                });
            }
        }
    } catch (e) {
        console.warn('Erro ao montar feriasAtivasMap:', e);
        state.feriasAtivasMap = new Map();
    }


    populateFilters();
    applyFiltersAndSearch();
}


async function loadSVCsParaFormulario() {
    const svcSelect = document.getElementById('addSVC');
    if (!svcSelect) return;

    if (state.serviceMatrizMap.size > 0 && svcSelect.options.length > 1) {
        const matrizesPermitidasCheck = getMatrizesPermitidas();
        if (matrizesPermitidasCheck === null) return;
    }

    const matrizesPermitidas = getMatrizesPermitidas();

    let query = supabase.from('Matrizes').select('SERVICE, MATRIZ');

    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }

    const {data, error} = await query;

    if (error) {
        console.error('Erro ao buscar mapa de serviço-matriz:', error);
        svcSelect.innerHTML = '<option value="" disabled selected>Erro ao carregar</option>';
        return;
    }

    state.serviceMatrizMap = new Map((data || []).map((item) => [String(item.SERVICE || '').toUpperCase(), item.MATRIZ || '']));

    svcSelect.innerHTML = '<option value="" disabled selected>Selecione um SVC...</option>';
    (data || []).sort((a, b) => String(a.SERVICE).localeCompare(String(b.SERVICE))).forEach((item) => {
        const opt = document.createElement('option');
        opt.value = String(item.SERVICE || '').toUpperCase();
        opt.textContent = String(item.SERVICE || '').toUpperCase();
        svcSelect.appendChild(opt);
    });
}

async function loadGestoresParaFormulario() {

    if (state.gestoresData && state.gestoresData.length > 0) return;

    const {data, error} = await supabase.from('Gestores').select('NOME, SVC');
    if (error) {
        console.error('Erro ao buscar gestores:', error);
        state.gestoresData = [];
        return;
    }
    state.gestoresData = data || [];
}

function populateGestorSelect(selectedSvc) {
    const gestorSelect = document.getElementById('addGestor');
    if (!gestorSelect) return;

    gestorSelect.innerHTML = '';

    if (!selectedSvc) {
        gestorSelect.disabled = true;
        gestorSelect.innerHTML = '<option value="" disabled selected>Selecione um SVC primeiro...</option>';
        return;
    }


    const gestoresFiltrados = state.gestoresData
        .filter(gestor => {
            if (!gestor.SVC) return false;

            const managerSVCs = gestor.SVC.split(',').map(s => s.trim());

            return managerSVCs.includes(selectedSvc);
        })
        .sort((a, b) => a.NOME.localeCompare(b.NOME));


    if (gestoresFiltrados.length === 0) {
        gestorSelect.disabled = true;
        gestorSelect.innerHTML = '<option value="" disabled selected>Nenhum gestor para este SVC</option>';
        return;
    }

    gestorSelect.disabled = false;
    gestorSelect.innerHTML = '<option value="" disabled selected>Selecione um gestor...</option>';
    gestoresFiltrados.forEach(gestor => {
        const option = document.createElement('option');
        option.value = gestor.NOME;
        option.textContent = gestor.NOME;
        gestorSelect.appendChild(option);
    });
}

async function handleAddSubmit(event) {
    event.preventDefault();
    attachUppercaseHandlers();
    const nomeRaw = document.getElementById('addNome')?.value || '';
    const cpfRaw = document.getElementById('addCPF')?.value || '';
    const cpf = normalizeCPF(cpfRaw);
    const nomeUpper = toUpperTrim(nomeRaw);
    if (!nomeUpper) {
        alert('Informe o NOME do colaborador.');
        document.getElementById('addNome')?.focus();
        return;
    }
    const {count: nomeCount, error: nomeErr} = await supabase.from('Colaboradores').select('Nome', {
        count: 'exact',
        head: true
    }).ilike('Nome', nomeUpper);
    if (nomeErr) {
        alert(`Erro ao validar nome: ${nomeErr.message}`);
        return;
    }
    if ((nomeCount || 0) > 0) {
        alert('Já existe um colaborador com esse NOME.');
        document.getElementById('addNome')?.focus();
        return;
    }
    if (cpf) {
        const {count: cpfCount, error: cpfErr} = await supabase.from('Colaboradores').select('CPF', {
            count: 'exact',
            head: true
        }).eq('CPF', cpf);
        if (cpfErr) {
            alert(`Erro ao validar CPF: ${cpfErr.message}`);
            return;
        }
        if ((cpfCount || 0) > 0) {
            alert('Já existe um colaborador com esse CPF.');
            document.getElementById('addCPF')?.focus();
            return;
        }
    }
    const generoVal = document.getElementById('addGenero')?.value || '';
    const generoNorm = nullIfEmpty(generoVal);
    if (!generoNorm) {
        alert('Selecione o GÊNERO.');
        document.getElementById('addGenero')?.focus();
        return;
    }

    const newColaborador = toUpperObject({
        Nome: nomeUpper,
        CPF: cpf,
        'Data de nascimento': document.getElementById('addDataNascimento')?.value || null,
        Genero: generoNorm,
        Contrato: document.getElementById('addContrato')?.value || '',
        Cargo: document.getElementById('addCargo')?.value || '',
        Gestor: document.getElementById('addGestor')?.value || '',
        DSR: nullIfEmpty(document.getElementById('addDSR')?.value),
        Escala: nullIfEmpty(document.getElementById('addEscala')?.value),
        'Data de admissão': document.getElementById('addDataAdmissao')?.value || null,
        SVC: nullIfEmpty(document.getElementById('addSVC')?.value),
        MATRIZ: nullIfEmpty(document.getElementById('addMatriz')?.value),
        LDAP: nullIfEmpty(document.getElementById('addLDAP')?.value),
        'ID GROOT': numberOrNull(document.getElementById('addIdGroot')?.value),
        Ativo: 'SIM',
        Ferias: 'NAO',
        'Total Presença': 0,
        'Total Faltas': 0,
        'Total Atestados': 0,
        'Total Suspensões': 0
    });

    const {error} = await supabase.from('Colaboradores').insert([newColaborador]);
    if (error) {
        alert(`Erro ao adicionar colaborador: ${error.message}`);
        return;
    }

    alert('Colaborador adicionado com sucesso!');

    if (addForm) {
        addForm.reset();
    }

    const gestorSelect = document.getElementById('addGestor');
    if (gestorSelect) {
        gestorSelect.innerHTML = '<option value="" disabled selected>Selecione um SVC primeiro...</option>';
        gestorSelect.disabled = true;
    }


    document.dispatchEvent(new CustomEvent('colaborador-added'));
    await fetchColaboradores();
}


async function loadServiceMatrizForEdit() {
    if (!editSVC) return;

    if (state.serviceMatrizMap.size > 0 && editSVC.options.length > 1) {
        const matrizesPermitidasCheck = getMatrizesPermitidas();
        if (matrizesPermitidasCheck === null) return;
    }

    const matrizesPermitidas = getMatrizesPermitidas();

    let query = supabase.from('Matrizes').select('SERVICE, MATRIZ');

    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }

    const {data, error} = await query;

    if (error) {
        console.error(error);
        return;
    }

    state.serviceMatrizMap = new Map((data || []).map(i => [String(i.SERVICE || '').toUpperCase(), i.MATRIZ || '']));

    editSVC.innerHTML = '<option value="" disabled selected>Selecione...</option>';
    (data || []).sort((a, b) => String(a.SERVICE).localeCompare(String(b.SERVICE))).forEach(i => {
        const opt = document.createElement('option');
        const svc = String(i.SERVICE || '').toUpperCase();
        opt.value = svc;
        opt.textContent = svc;
        editSVC.appendChild(opt);
    });
}

async function fetchColabByNome(nome) {
    const {data, error} = await supabase.from('Colaboradores').select('*').eq('Nome', nome).maybeSingle();
    if (error) throw error;
    return data;
}

function showEditModal() {
    editModal?.classList.remove('hidden');
}

function hideEditModal() {
    editModal?.classList.add('hidden');
    editOriginal = null;
    editForm?.reset();
}

async function fillEditForm(colab) {
    editOriginal = {Nome: colab.Nome, CPF: colab.CPF ?? null};

    await loadGestoresParaFormulario();

    const setVal = (el, v) => {
        if (el) el.value = v ?? '';
    };

    if (editTitulo) editTitulo.textContent = colab.Nome || 'Colaborador';

    setVal(editInputs.Nome, colab.Nome || '');
    setVal(editInputs.CPF, colab.CPF || '');
    setVal(editInputs.Contrato, colab.Contrato || '');
    setVal(editInputs.Cargo, colab.Cargo || '');

    setVal(editInputs.DSR, colab.DSR || '');
    setVal(editInputs.Escala, colab.Escala || '');
    setVal(editInputs['FOLGA ESPECIAL'], colab['FOLGA ESPECIAL'] || '');
    setVal(editInputs.LDAP, colab.LDAP ?? '');
    setVal(editInputs['ID GROOT'], colab['ID GROOT'] ?? '');
    setVal(editInputs['Data de nascimento'], colab['Data de nascimento'] ? new Date(colab['Data de nascimento']).toISOString().split('T')[0] : '');

    if (editSVC) {
        const svc = colab.SVC ? String(colab.SVC).toUpperCase() : '';
        if (svc && !Array.from(editSVC.options).some(o => o.value === svc)) {
            const opt = document.createElement('option');
            opt.value = svc;
            opt.textContent = svc;
            editSVC.appendChild(opt);
        }
        editSVC.value = svc || '';

        populateGestorSelectForEdit(svc, colab.Gestor);
    }
}


async function validateEditDuplicates(payload) {
    if (payload.Nome && payload.Nome !== editOriginal.Nome) {
        const {count, error} = await supabase.from('Colaboradores').select('Nome', {
            count: 'exact',
            head: true
        }).ilike('Nome', payload.Nome).neq('Nome', editOriginal.Nome);
        if (error) throw error;
        if ((count || 0) > 0) return 'Já existe um colaborador com esse NOME.';
    }
    if (payload.CPF) {
        const {count, error} = await supabase.from('Colaboradores').select('CPF', {
            count: 'exact',
            head: true
        }).eq('CPF', payload.CPF).neq('Nome', editOriginal.Nome);
        if (error) throw error;
        if ((count || 0) > 0) return 'Já existe um colaborador com esse CPF.';
    }
    return null;
}

async function onEditSubmit(e) {
    e.preventDefault();
    const Nome = toUpperTrim(editInputs.Nome.value || '');
    if (!Nome) {
        alert('Informe o NOME.');
        editInputs.Nome.focus();
        return;
    }

    const CPF = normalizeCPF(editInputs.CPF.value || '');
    const svc = nullIfEmpty(editSVC.value);
    const matrizAuto = svc ? (state.serviceMatrizMap.get(String(svc).toUpperCase()) || null) : null;

    const payload = {
        Nome,
        CPF,
        Contrato: editInputs.Contrato.value || '',
        Cargo: editInputs.Cargo.value || '',
        Gestor: nullIfEmpty(editInputs.Gestor.value),
        DSR: nullIfEmpty(editInputs.DSR.value),
        Escala: nullIfEmpty(editInputs.Escala.value),
        'FOLGA ESPECIAL': nullIfEmpty(editInputs['FOLGA ESPECIAL'].value),
        LDAP: nullIfEmpty(editInputs.LDAP.value),
        'ID GROOT': numberOrNull(editInputs['ID GROOT'].value),
        'Data de nascimento': editInputs['Data de nascimento'].value || null,
        SVC: svc,
        MATRIZ: matrizAuto
    };

    Object.keys(payload).forEach(k => {
        if (typeof payload[k] === 'string' && k !== 'LDAP') payload[k] = toUpperTrim(payload[k]);
    });

    const dupMsg = await validateEditDuplicates(payload);
    if (dupMsg) {
        alert(dupMsg);
        return;
    }

    const {error} = await supabase.from('Colaboradores').update(payload).eq('Nome', editOriginal.Nome);
    if (error) {
        alert(`Erro ao atualizar: ${error.message}`);
        return;
    }

    alert('Colaborador atualizado com sucesso!');
    document.dispatchEvent(new CustomEvent('colaborador-edited', {
        detail: {nomeAnterior: editOriginal.Nome, nomeAtual: payload.Nome}
    }));
    hideEditModal();
}


function calcularPeriodoTrabalhado(dataAdmissao, dataDesligamento) {
    if (!dataAdmissao) return '0';
    const inicio = new Date(dataAdmissao);
    const fim = new Date(dataDesligamento);
    if (isNaN(inicio.getTime())) return '0';
    const inicioUTC = Date.UTC(inicio.getFullYear(), inicio.getMonth(), inicio.getDate());
    const fimUTC = Date.UTC(fim.getFullYear(), fim.getMonth(), fim.getDate());
    const dias = Math.floor((fimUTC - inicioUTC) / (1000 * 60 * 60 * 24));
    if (dias < 0) return 'Data inválida';
    if (dias === 0) return '0';
    if (dias <= 15) return `${dias} dia(s)`;
    let meses = (fim.getFullYear() - inicio.getFullYear()) * 12;
    meses -= inicio.getMonth();
    meses += fim.getMonth();
    const anos = Math.floor(meses / 12);
    const mesesRestantes = meses % 12;
    if (meses < 1) return 'Menos de 1 mês';
    if (meses < 2) return '1 mês';
    if (anos > 0) return mesesRestantes > 0 ? `${anos} ano(s) e ${mesesRestantes} mes(es)` : `${anos} ano(s)`;
    return `${meses} mes(es)`;
}

function openDesligarModalFromColab(colab) {
    desligarColaborador = colab;
    desligarNomeEl.value = colab?.Nome || '';
    const hoje = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
    desligarDataEl.value = iso;
    desligarMotivoEl.selectedIndex = 0;
    desligarModal.classList.remove('hidden');
}

function closeDesligarModal() {
    desligarModal.classList.add('hidden');
    desligarColaborador = null;
    desligarForm.reset();
}

async function onDesligarSubmit(e) {
    e.preventDefault();
    if (!desligarColaborador) {
        alert('Erro: colaborador não carregado.');
        return;
    }
    const dataDesligamento = desligarDataEl.value;
    const motivo = desligarMotivoEl.value;
    if (!dataDesligamento) {
        alert('Informe a data de desligamento.');
        return;
    }
    if (!motivo) {
        alert('Selecione o motivo.');
        return;
    }

    const periodoTrabalhado = calcularPeriodoTrabalhado(desligarColaborador['Data de admissão'], dataDesligamento);
    const desligadoData = {
        Nome: desligarColaborador.Nome || null,
        Contrato: desligarColaborador.Contrato || null,
        Cargo: desligarColaborador.Cargo || null,
        'Data de Admissão': desligarColaborador['Data de admissão'] || null,
        Gestor: desligarColaborador.Gestor || null,
        'Data de Desligamento': dataDesligamento,
        'Período Trabalhado': periodoTrabalhado,
        Escala: desligarColaborador.Escala || null,
        SVC: desligarColaborador.SVC || null,
        MATRIZ: desligarColaborador.MATRIZ || null,
        Motivo: motivo || null
    };

    const {error: insertError} = await supabase.from('Desligados').insert([desligadoData]);
    if (insertError) {
        alert(`Erro ao registrar em Desligados: ${insertError.message}`);
        return;
    }

    const {error: deleteError} = await supabase.from('Colaboradores').delete().eq('Nome', desligarColaborador.Nome);
    if (deleteError) {
        alert(`Erro ao remover de Colaboradores: ${deleteError.message}`);
        return;
    }

    alert('Colaborador desligado com sucesso!');
    closeDesligarModal();
    hideEditModal();
    await fetchColaboradores();
}

async function getActiveFerias(nome) {
    const {
        data,
        error
    } = await supabase.from('Ferias').select('*').eq('Nome', nome).eq('Status', 'Em andamento').order('Numero', {ascending: false}).limit(1);
    if (error) return {error};
    return {data: (data && data[0]) ? data[0] : null};
}

async function agendarFerias(info) {
    const {colaborador, dataInicio, dataFinal} = info;


    const {data: ativa} = await getActiveFerias(colaborador.Nome);
    if (ativa) {
        return {error: new Error('Este colaborador já está com férias "Em andamento". Finalize antes de iniciar novas férias.')};
    }


    const {data: lastFerias, error: numError} = await supabase
        .from('Ferias')
        .select('Numero')
        .order('Numero', {ascending: false})
        .limit(1);
    if (numError) return {error: numError};
    const newNumero = (lastFerias && lastFerias.length > 0) ? (lastFerias[0].Numero + 1) : 1;


    const hoje = toStartOfDay(new Date());
    const inicio = toStartOfDay(dataInicio);
    const fim = toStartOfDay(dataFinal);


    const statusInicial = (hoje < inicio) ? 'A iniciar' : (hoje <= fim ? 'Em andamento' : 'Finalizado');
    const diasParaFinalizar = Math.max(0, Math.ceil((fim - hoje) / (1000 * 60 * 60 * 24)));

    const svcUp = (colaborador.SVC || '').toString().toUpperCase();
    let matriz = colaborador.MATRIZ || (state?.serviceMatrizMap?.get?.(svcUp) ?? null);
    if (!matriz && svcUp) {

        const {data: m, error: mErr} = await supabase
            .from('Matrizes')
            .select('MATRIZ')
            .eq('SERVICE', svcUp)
            .maybeSingle();
        if (!mErr && m) matriz = m.MATRIZ || null;
    }

    const feriasData = {
        Numero: newNumero,
        Nome: colaborador.Nome,
        Escala: colaborador.Escala,
        SVC: colaborador.SVC,
        MATRIZ: matriz || null,
        'Data Inicio': dataInicio,
        'Data Final': dataFinal,
        Status: statusInicial,
        'Dias para finalizar': diasParaFinalizar
    };

    const {error} = await supabase.from('Ferias').insert([feriasData]);
    if (error) return {error};

    await updateAllVacationStatuses();

    return {success: true};
}


async function finalizarFerias(nome) {
    const {data: ativa, error: e1} = await getActiveFerias(nome);
    if (e1) return {error: e1};
    if (!ativa) return {error: new Error('Nenhum registro de férias "Em andamento" para este colaborador.')};
    const {error: e2} = await supabase.from('Ferias').update({
        Status: 'Finalizado',
        'Dias para finalizar': 0
    }).eq('Numero', ativa.Numero);
    if (e2) return {error: e2};
    const {error: e3} = await supabase.from('Colaboradores').update({Ferias: 'NAO'}).eq('Nome', nome);
    if (e3) return {error: e3};
    await updateAllVacationStatuses();
    return {success: true};
}

async function updateAllVacationStatuses() {
    const {data: feriasList, error} = await supabase.from('Ferias').select('*').order('Numero', {ascending: true});
    if (error || !feriasList) return;
    const today = toStartOfDay(new Date());
    for (const ferias of feriasList) {
        const dataInicio = toStartOfDay(ferias['Data Inicio']);
        const dataFinal = toStartOfDay(ferias['Data Final']);
        let newStatus = ferias.Status;
        let updatePayload = {};
        if (ferias.Status === 'Finalizado') {
            if (ferias['Dias para finalizar'] !== 0) updatePayload['Dias para finalizar'] = 0;
            await supabase.from('Colaboradores').update({Ferias: 'NAO'}).eq('Nome', ferias.Nome);
        } else {
            if (today > dataFinal) newStatus = 'Finalizado';
            else if (today >= dataInicio && today <= dataFinal) newStatus = 'Em andamento';
            else if (today < dataInicio) newStatus = 'A iniciar';
            const diasParaFinalizar = Math.max(0, Math.ceil((dataFinal - today) / (1000 * 60 * 60 * 24)));
            if (newStatus !== ferias.Status || diasParaFinalizar !== ferias['Dias para finalizar']) {
                updatePayload.Status = newStatus;
                updatePayload['Dias para finalizar'] = diasParaFinalizar;
                if (newStatus === 'Em andamento') await supabase.from('Colaboradores').update({Ferias: 'SIM'}).eq('Nome', ferias.Nome);
                else if (newStatus === 'Finalizado') await supabase.from('Colaboradores').update({Ferias: 'NAO'}).eq('Nome', ferias.Nome);
            }
        }
        if (Object.keys(updatePayload).length > 0) await supabase.from('Ferias').update(updatePayload).eq('Numero', ferias.Numero);
    }
}

function openFeriasModalFromColab(colab) {
    feriasColaborador = colab;
    if (!feriasModal) return;
    if (feriasNomeEl) feriasNomeEl.value = colab?.Nome || '';
    const hoje = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
    if (feriasInicioEl && !feriasInicioEl.value) feriasInicioEl.value = iso;
    if (feriasFinalEl && !feriasFinalEl.value) feriasFinalEl.value = iso;
    feriasModal.classList.remove('hidden');
}

function closeFeriasModal() {
    if (!feriasModal) return;
    feriasModal.classList.add('hidden');
    feriasColaborador = null;
    feriasForm?.reset();
}

async function onFeriasSubmit(e) {
    e.preventDefault();
    if (isSubmittingFerias) return;
    isSubmittingFerias = true;
    try {
        if (!feriasColaborador || !feriasColaborador.Nome) {
            alert('Erro: dados do colaborador não carregados.');
            return;
        }
        const dataInicio = (feriasInicioEl?.value || '').trim();
        const dataFinal = (feriasFinalEl?.value || '').trim();
        if (!dataInicio || !dataFinal) {
            alert('Selecione a Data de Início e a Data Final.');
            return;
        }
        const dIni = new Date(dataInicio);
        const dFim = new Date(dataFinal);
        if (isNaN(dIni) || isNaN(dFim)) {
            alert('Datas inválidas. Verifique os campos.');
            return;
        }
        if (dFim < dIni) {
            alert('A Data Final não pode ser anterior à Data de Início.');
            return;
        }
        const ok = confirm(`Confirmar férias de ${feriasColaborador.Nome} de ${formatDateLocal(dataInicio)} até ${formatDateLocal(dataFinal)}?`);
        if (!ok) return;
        const {success, error} = await agendarFerias({colaborador: feriasColaborador, dataInicio, dataFinal});
        if (!success) {
            alert(`Erro ao agendar férias: ${error?.message || error}`);
            return;
        }
        alert('Férias agendadas com sucesso!');
        closeFeriasModal();
        await fetchColaboradores();
    } finally {
        isSubmittingFerias = false;
    }
}


const HIST = {
    nome: null,
    ano: new Date().getFullYear(),
    marks: new Map(),
    dsrDates: new Set(),
    initialized: false,
    els: {
        modal: null,
        title: null,
        yearSel: null,
        months: null,
        fecharBtn: null,
    }
};

const HIST_MONTH_NAMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const HIST_STATUS_TO_CLASS = {
    PRESENCA: 'st-presenca',
    FALTA: 'st-falta',
    ATESTADO: 'st-atestado',
    F_ESPECIAL: 'st-fe',
    FERIADO: 'st-feriado',
    SUSPENSAO: 'st-susp',
    DSR: 'st-dsr',
};
const HIST_STATUS_LABEL = {
    PRESENCA: 'Presença',
    FALTA: 'Falta',
    ATESTADO: 'Atestado',
    F_ESPECIAL: 'Folga Especial',
    FERIADO: 'Feriado',
    SUSPENSAO: 'Suspensão',
    DSR: 'DSR',
};

const pad2 = (n) => (n < 10 ? `0${n}` : `${n}`);
const daysInMonth = (year, month0) => new Date(year, month0 + 1, 0).getDate();
const firstWeekdayIndex = (year, month0) => {

    const d = new Date(year, month0, 1).getDay();
    return (d === 0) ? 6 : d - 1;
};
const isoOf = (year, month0, day) => `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
const isTrue = (v) => v === 1 || v === '1' || v === true || String(v).toUpperCase() === 'SIM';

function ensureHistoricoDomRefs() {
    if (HIST.initialized) return;
    HIST.els.modal = document.getElementById('historicoModal');
    HIST.els.title = document.getElementById('hist-title');
    HIST.els.yearSel = document.getElementById('hist-year');
    HIST.els.months = document.getElementById('months');
    HIST.els.fecharBtn = document.getElementById('historicoFecharBtn');

    if (!HIST.els.modal || !HIST.els.title || !HIST.els.yearSel || !HIST.els.months) {
        console.warn('Histórico: elementos do modal não encontrados.');
        return;
    }

    const start = 2023, end = 2030;
    HIST.els.yearSel.innerHTML = '';
    for (let y = start; y <= end; y++) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        HIST.els.yearSel.appendChild(opt);
    }
    const now = new Date().getFullYear();
    HIST.ano = Math.max(start, Math.min(end, now));
    HIST.els.yearSel.value = String(HIST.ano);

    HIST.els.yearSel.addEventListener('change', async () => {
        HIST.ano = parseInt(HIST.els.yearSel.value, 10);
        await loadHistoricoIntoModal();
    });

    HIST.els.fecharBtn?.addEventListener('click', () => {
        HIST.els.modal.classList.add('hidden');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !HIST.els.modal.classList.contains('hidden')) {
            HIST.els.modal.classList.add('hidden');
        }
    });

    HIST.initialized = true;
}

function putHistoricoTitle() {
    if (!HIST.els.title) return;
    HIST.els.title.textContent = HIST.nome ? `Histórico – ${HIST.nome}` : 'Histórico';
}

function renderHistoricoCalendar() {
    const monthsEl = HIST.els.months;
    if (!monthsEl) return;

    monthsEl.innerHTML = '';

    for (let m = 0; m < 12; m++) {
        const monthCard = document.createElement('div');
        monthCard.className = 'month-card';

        const title = document.createElement('div');
        title.className = 'month-title';
        title.textContent = HIST_MONTH_NAMES[m] + ' ' + HIST.ano;
        monthCard.appendChild(title);

        const dow = document.createElement('div');
        dow.className = 'dow';

        ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].forEach((ch) => {
            const el = document.createElement('div');
            el.textContent = ch;
            dow.appendChild(el);
        });
        monthCard.appendChild(dow);

        const days = document.createElement('div');
        days.className = 'days';

        const blanks = firstWeekdayIndex(HIST.ano, m);
        for (let b = 0; b < blanks; b++) {
            const blank = document.createElement('div');
            blank.className = 'day blank';
            days.appendChild(blank);
        }

        const total = daysInMonth(HIST.ano, m);
        for (let d = 1; d <= total; d++) {
            const cell = document.createElement('div');
            cell.className = 'day';
            cell.textContent = d;

            const iso = isoOf(HIST.ano, m, d);
            let mark = HIST.marks.get(iso);

            if (!mark && HIST.dsrDates && HIST.dsrDates.has(iso)) {
                mark = 'DSR';
            }

            if (mark && HIST_STATUS_TO_CLASS[mark]) {
                cell.classList.add(HIST_STATUS_TO_CLASS[mark]);
                cell.title = `${iso} – ${HIST_STATUS_LABEL[mark]}`;
            } else {
                cell.title = iso;
            }

            days.appendChild(cell);
        }

        monthCard.appendChild(days);
        monthsEl.appendChild(monthCard);
    }
}

async function computeDsrDatesForYear(nome, ano) {
    try {

        const {data: colab, error} = await supabase
            .from('Colaboradores')
            .select('DSR')
            .eq('Nome', nome)
            .maybeSingle();
        if (error) throw error;

        const dsr = String(colab?.DSR || '').toUpperCase();
        if (!dsr) return new Set();

        const mapIdx = {
            'SEGUNDA': 0,
            'TERÇA': 1, 'TERCA': 1,
            'QUARTA': 2,
            'QUINTA': 3,
            'SEXTA': 4,
            'SABADO': 5, 'SÁBADO': 5,
            'DOMINGO': 6,
        };
        const target = mapIdx[dsr] ?? null;
        if (target == null) return new Set();

        const out = new Set();
        const start = new Date(ano, 0, 1);
        const end = new Date(ano, 11, 31);

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {

            const jsDay = d.getDay();
            const wk = (jsDay === 0) ? 6 : jsDay - 1;
            if (wk === target) {
                out.add(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
            }
        }
        return out;
    } catch (e) {
        console.error('computeDsrDatesForYear error:', e);
        return new Set();
    }
}

async function loadHistoricoIntoModal() {
    if (!HIST.nome) return;
    if (HIST.els.months) {
        HIST.els.months.innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:10px;color:#6b7280;">Carregando…</div>';
    }

    try {
        const y = Number.isInteger(HIST.ano) ? HIST.ano : (new Date()).getFullYear();
        const start = `${y}-01-01`;
        const end = `${y}-12-31`;

        const {data, error} = await supabase
            .from('ControleDiario')
            .select('Data, "Presença", Falta, Atestado, "Folga Especial", Feriado, Suspensao')
            .eq('Nome', HIST.nome)
            .gte('Data', start)
            .lte('Data', end)
            .order('Data', {ascending: true});

        if (error) {
            console.error('getHistoricoPresencas erro:', error);
            if (HIST.els.months) {
                HIST.els.months.innerHTML =
                    '<div style="grid-column:1/-1;text-align:center;padding:10px;color:#e55353;">Erro ao carregar histórico.</div>';
            }
            return;
        }

        HIST.marks.clear();

        (data || []).forEach((r) => {
            const iso = r.Data;
            let status = null;

            if (isTrue(r['Presença'])) status = 'PRESENCA';
            else if (isTrue(r['Falta'])) status = 'FALTA';
            else if (isTrue(r['Atestado'])) status = 'ATESTADO';
            else if (isTrue(r['Folga Especial'])) status = 'F_ESPECIAL';
            else if (isTrue(r['Feriado'])) status = 'FERIADO';
            else if (isTrue(r['Suspensao'])) status = 'SUSPENSAO';

            if (status) HIST.marks.set(iso, status);
        });

        HIST.dsrDates = await computeDsrDatesForYear(HIST.nome, y);

        renderHistoricoCalendar();
    } catch (e) {
        console.error('Falha geral ao carregar histórico:', e);
        if (HIST.els.months) {
            HIST.els.months.innerHTML =
                '<div style="grid-column:1/-1;text-align:center;padding:10px;color:#e55353;">Erro ao carregar histórico.</div>';
        }
    }
}

async function openHistorico(nome) {
    ensureHistoricoDomRefs();
    if (!HIST.els.modal) {
        alert('Não foi possível abrir o histórico (elementos do modal não encontrados).');
        return;
    }
    HIST.nome = nome || null;

    if (HIST.els.yearSel) {
        const now = new Date().getFullYear();
        if (!HIST.els.yearSel.value) HIST.els.yearSel.value = String(now);
        HIST.ano = parseInt(HIST.els.yearSel.value || now, 10) || now;
    }

    putHistoricoTitle();
    await loadHistoricoIntoModal();

    HIST.els.modal.classList.remove('hidden');
}


function wireEdit() {
    editModal = document.getElementById('editModal');
    editForm = document.getElementById('editForm');
    editTitulo = document.getElementById('editTitulo');
    editSVC = document.getElementById('editSVC');
    editExcluirBtn = document.getElementById('editExcluirBtn');
    editCancelarBtn = document.getElementById('editCancelarBtn');
    editSalvarBtn = document.getElementById('editSalvarBtn');
    editDesligarBtn = document.getElementById('editDesligarBtn');
    editFeriasBtn = document.getElementById('editFeriasBtn');
    editHistoricoBtn = document.getElementById('editHistoricoBtn');

    editInputs = {
        Nome: document.getElementById('editNome'),
        CPF: document.getElementById('editCPF'),
        Contrato: document.getElementById('editContrato'),
        Cargo: document.getElementById('editCargo'),
        Gestor: document.getElementById('editGestor'),
        DSR: document.getElementById('editDSR'),
        Escala: document.getElementById('editEscala'),
        'FOLGA ESPECIAL': document.getElementById('editFolgaEspecial'),
        LDAP: document.getElementById('editLDAP'),
        'ID GROOT': document.getElementById('editIdGroot'),
        'Data de nascimento': document.getElementById('editDataNascimento')
    };

    attachUpperHandlersTo(editForm);


    if (editSVC) {
        editSVC.addEventListener('change', () => {

            populateGestorSelectForEdit(editSVC.value);
        });
    }


    editForm?.addEventListener('submit', onEditSubmit);
    editCancelarBtn?.addEventListener('click', hideEditModal);

    editExcluirBtn?.addEventListener('click', async () => {
        if (!editOriginal) return;
        const ok = confirm('Tem certeza que deseja excluir este colaborador?');
        if (!ok) return;
        const {error} = await supabase.from('Colaboradores').delete().eq('Nome', editOriginal.Nome);
        if (error) {
            alert(`Erro ao excluir: ${error.message}`);
            return;
        }
        alert('Colaborador excluído com sucesso!');
        document.dispatchEvent(new CustomEvent('colaborador-deleted', {detail: {nome: editOriginal.Nome}}));
        hideEditModal();
        await fetchColaboradores();
    });

    editDesligarBtn?.addEventListener('click', async () => {
        if (!editOriginal) return;
        const colab = await fetchColabByNome(editOriginal.Nome);
        if (!colab) {
            alert('Colaborador não encontrado.');
            return;
        }
        openDesligarModalFromColab(colab);
    });

    editFeriasBtn?.addEventListener('click', async () => {
        if (!editOriginal) return;
        const colab = await fetchColabByNome(editOriginal.Nome);
        if (!colab) {
            alert('Colaborador não encontrado.');
            return;
        }
        openFeriasModalFromColab(colab);
    });

    editHistoricoBtn?.addEventListener('click', () => {
        if (!editOriginal?.Nome) return;
        openHistorico(editOriginal.Nome);
    });

    document.addEventListener('open-edit-modal', async (evt) => {
        const nome = evt.detail?.nome;
        if (!nome) return;
        try {
            await loadServiceMatrizForEdit();
            const colab = await fetchColabByNome(nome);
            if (!colab) {
                alert('Colaborador não encontrado.');
                return;
            }
            await fillEditForm(colab);
            showEditModal();
        } catch (err) {
            console.error(err);
            alert('Erro ao carregar colaborador para edição.');
        }
    });
}


function wireDesligar() {
    desligarModal = document.getElementById('desligarModal');
    desligarForm = document.getElementById('desligarForm');
    desligarNomeEl = document.getElementById('desligarNome');
    desligarDataEl = document.getElementById('desligarData');
    desligarMotivoEl = document.getElementById('desligarMotivo');
    desligarCancelarBtn = document.getElementById('desligarCancelarBtn');

    desligarCancelarBtn?.addEventListener('click', closeDesligarModal);
    desligarForm?.addEventListener('submit', onDesligarSubmit);
}

function wireFerias() {
    feriasModal = document.getElementById('feriasModal') || null;
    feriasForm = document.getElementById('feriasForm') || document.getElementById('ferias-form') || null;
    feriasNomeEl = document.getElementById('feriasNome') || document.getElementById('nome-colaborador') || null;
    feriasInicioEl = document.getElementById('feriasDataInicio') || document.getElementById('data-inicio') || null;
    feriasFinalEl = document.getElementById('feriasDataFinal') || document.getElementById('data-final') || null;
    feriasCancelarBtn = document.getElementById('feriasCancelarBtn') || document.getElementById('cancelarBtn') || null;

    feriasCancelarBtn?.addEventListener('click', closeFeriasModal);
    feriasForm?.addEventListener('submit', onFeriasSubmit);
}

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

function mapColabToExportRow(c) {
    const fmt = (v) => v == null ? '' : v;
    const fmtDate = (v) => v ? formatDateLocal(String(v)) : '';
    return {
        'Nome': fmt(c.Nome),
        'CPF': fmt(c.CPF),
        'Data de nascimento': fmtDate(c['Data de nascimento']),
        'Gênero': fmt(c.Genero),
        'Contrato': fmt(c.Contrato),
        'Cargo': fmt(c.Cargo),
        'Gestor': fmt(c.Gestor),
        'DSR': fmt(c.DSR),
        'Escala': fmt(c.Escala),
        'Data de admissão': fmtDate(c['Data de admissão']),
        'SVC': fmt(c.SVC),
        'MATRIZ': fmt(c.MATRIZ),
        'LDAP': fmt(c.LDAP),
        'ID GROOT': c['ID GROOT'] ?? '',
        'FOLGA ESPECIAL': fmt(c['FOLGA ESPECIAL']),
        'Ativo': fmt(c.Ativo),
        'Férias': fmt(c.Ferias),
        'Total Presença': c['Total Presença'] ?? '',
        'Total Faltas': c['Total Faltas'] ?? '',
        'Total Atestados': c['Total Atestados'] ?? '',
        'Total Suspensões': c['Total Suspensões'] ?? ''
    };
}

async function exportColaboradoresXLSX(useFiltered) {
    const data = useFiltered ? state.dadosFiltrados : state.colaboradoresData;
    if (!data || data.length === 0) {
        alert('Não há dados para exportar.');
        return;
    }
    await ensureXLSX();
    const rows = data.map(mapColabToExportRow);
    const headers = Object.keys(mapColabToExportRow({}));
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(rows, {header: headers});
    const colWidths = headers.map(h => {
        const maxLen = Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length));
        return {wch: Math.min(Math.max(10, maxLen + 2), 40)};
    });
    ws['!cols'] = colWidths;
    window.XLSX.utils.book_append_sheet(wb, ws, 'Colaboradores');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const suffix = useFiltered ? 'filtrado' : 'completo';
    window.XLSX.writeFile(wb, `colaboradores-${suffix}-${stamp}.xlsx`);
}

export async function getFeriasRange(inicioISO, fimISO) {
    try {
        const {data, error} = await supabase
            .from('Ferias')
            .select('Nome, Escala, SVC, "Data Inicio"')
            .gte('Data Inicio', inicioISO)
            .lte('Data Inicio', fimISO)
            .order('Data Inicio', {ascending: true})
            .order('Nome', {ascending: true});
        if (error) return {error};
        return {data: data || []};
    } catch (e) {
        return {error: e};
    }
}

export function init() {
    colaboradoresTbody = document.getElementById('colaboradores-tbody');
    searchInput = document.getElementById('search-input');
    filtrosSelect = document.querySelectorAll('.filters select');
    limparFiltrosBtn = document.getElementById('limpar-filtros-btn');
    addColaboradorBtn = document.getElementById('add-colaborador-btn');
    mostrarMaisBtn = document.getElementById('mostrar-mais-btn');
    mostrarMenosBtn = document.getElementById('mostrar-menos-btn');
    contadorVisiveisEl = document.getElementById('contador-visiveis');
    addForm = document.getElementById('addForm');

    fetchColaboradores();

    if (searchInput) searchInput.addEventListener('input', applyFiltersAndSearch);
    if (filtrosSelect && filtrosSelect.length) {
        filtrosSelect.forEach((selectEl) => {
            selectEl.addEventListener('change', (event) => {
                const filterKey = selectEl.dataset.filterKey;
                const value = event.target.value;
                if (value) state.filtrosAtivos[filterKey] = value;
                else delete state.filtrosAtivos[filterKey];
                applyFiltersAndSearch();
            });
        });
    }
    if (limparFiltrosBtn) {
        limparFiltrosBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (filtrosSelect && filtrosSelect.length) filtrosSelect.forEach((select) => (select.selectedIndex = 0));
            state.filtrosAtivos = {};
            applyFiltersAndSearch();
        });
    }
    if (mostrarMaisBtn) {
        mostrarMaisBtn.addEventListener('click', () => {
            itensVisiveis += ITENS_POR_PAGINA;
            updateDisplay();
        });
    }
    if (mostrarMenosBtn) {
        mostrarMenosBtn.addEventListener('click', () => {
            itensVisiveis = Math.max(ITENS_POR_PAGINA, itensVisiveis - ITENS_POR_PAGINA);
            updateDisplay();
        });
    }
    if (addColaboradorBtn) {
        addColaboradorBtn.addEventListener('click', async () => {
            await loadGestoresParaFormulario();
            loadSVCsParaFormulario();
            populateGestorSelect(null);
            attachUppercaseHandlers();
            document.dispatchEvent(new CustomEvent('open-add-modal'));
        });
    }
    if (addForm) {
        attachUppercaseHandlers();
        addForm.addEventListener('submit', handleAddSubmit);
        const svcSelect = document.getElementById('addSVC');
        const matrizInput = document.getElementById('addMatriz');
        if (svcSelect && matrizInput) {
            svcSelect.addEventListener('change', () => {
                matrizInput.value = state.serviceMatrizMap.get(String(svcSelect.value)) || '';
                populateGestorSelect(svcSelect.value);
            });
        }
    }
    if (colaboradoresTbody) {
        colaboradoresTbody.addEventListener('dblclick', (event) => {
            const nome = event.target.closest('tr')?.dataset.nome;
            if (nome) document.dispatchEvent(new CustomEvent('open-edit-modal', {detail: {nome}}));
        });
        document.addEventListener('colaborador-edited', async () => {
            await fetchColaboradores();
        });
        document.addEventListener('colaborador-deleted', async () => {
            await fetchColaboradores();
        });
    }

    const exportColaboradoresBtn = document.getElementById('export-colaboradores-btn');
    if (exportColaboradoresBtn) {
        exportColaboradoresBtn.addEventListener('click', async () => {
            if (!state.colaboradoresData.length) {
                alert('Não há dados para exportar.');
                return;
            }
            const hasSearch = !!(searchInput && searchInput.value && searchInput.value.trim() !== '');
            const hasFilters = Object.keys(state.filtrosAtivos).length > 0;
            const filteredDifferent = state.dadosFiltrados.length !== state.colaboradoresData.length;
            const useFiltered = hasSearch || hasFilters || filteredDifferent;
            exportColaboradoresBtn.disabled = true;
            try {
                await exportColaboradoresXLSX(useFiltered);
            } catch (e) {
                console.error(e);
                alert('Falha ao exportar. Tente novamente.');
            } finally {
                exportColaboradoresBtn.disabled = false;
            }
        });
    }

    wireEdit();
    wireDesligar();
    wireFerias();
}
