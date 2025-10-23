import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';let state = {
  colaboradoresData: [],
  dadosFiltrados: [],
  filtrosAtivos: {},
  serviceMatrizMap: new Map(),
  serviceRegiaoMap: new Map(),
  matrizRegiaoMap: new Map(),
  selectedNames: new Set(),
  contratosData: null,
  isUserAdmin: false,
  gestoresData: [],
  matrizesData: [],
  feriasAtivasMap: new Map()
};let cachedColaboradores = null;
let cachedFeriasStatus = null;
let lastFetchTimestamp = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000;const ITENS_POR_PAGINA = 200;
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
    editDesligarBtn, editFeriasBtn, editHistoricoBtn, editAfastarBtn,
    editEfetivarKnBtn;
let efetivarKnModal, efetivarKnForm, efetivarKnNomeEl, efetivarKnDataEl, efetivarKnCancelarBtn;
let editInputs = {};
let editOriginal = null;
let desligarModal, desligarForm, desligarNomeEl, desligarDataEl, desligarMotivoEl, desligarCancelarBtn;
let desligarColaborador = null;
let feriasModal, feriasForm, feriasNomeEl, feriasInicioEl, feriasFinalEl, feriasCancelarBtn;
let feriasColaborador = null;
let isSubmittingFerias = false;
let isSubmittingEdit = false;
let dsrModal, dsrCheckboxesContainer, dsrOkBtn, dsrCancelarBtn;
let currentDsrInputTarget = null;
const DIAS_DA_SEMANA = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];function invalidateColaboradoresCache() {
    cachedColaboradores = null;
    cachedFeriasStatus = null;
    lastFetchTimestamp = 0;
    console.log("Cache de colaboradores e férias invalidado.");
}function checkUserAdminStatus() {
    const sessionString = localStorage.getItem('userSession');
    if (!sessionString) {
        console.warn('Sessão do usuário não encontrada. Permissões de admin não concedidas.');
        state.isUserAdmin = false;
        return;
    }
    try {
        const userData = JSON.parse(sessionString);
        if (!userData || !userData.Nivel) {
            console.warn('Dados da sessão incompletos. Permissões de admin não concedidas.');
            state.isUserAdmin = false;
            return;
        }
        state.isUserAdmin = userData.Nivel === 'Administrador';
        console.log(`Usuário ${state.isUserAdmin ? 'é' : 'não é'} Administrador.`);
    } catch (error) {
        console.error('Erro ao processar sessão do usuário:', error);
        state.isUserAdmin = false;
    }
}async function fetchAllWithPagination(queryBuilder) {
    let allData = [];
    let page = 0;
    const pageSize = 1000;
    let moreData = true;
    while (moreData) {
        const {data, error} = await queryBuilder.range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) {
            console.error("Erro na paginação:", error);
            throw error;
        }
        if (data && data.length > 0) {
            allData = allData.concat(data);
            page++;
        } else {
            moreData = false;
        }
    }
    return allData;
}function normalizeCPF(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    return digits || null;
}function toUpperNoTrim(str) {
    return typeof str === 'string' ? str.toUpperCase() : str;
}function toUpperTrim(str) {
    return typeof str === 'string' ? str.toUpperCase().trim() : str;
}function nullIfEmpty(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
}function numberOrNull(v) {
    const s = nullIfEmpty(v);
    if (s === null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}function toStartOfDay(dateish) {
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
}function formatDateLocal(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).split('-');
    return `${d}/${m}/${y}`;
}function attachUppercaseHandlers() {
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
}async function populateContratoSelect(selectElement) {
    if (!selectElement) return;
    const CONTRATOS_PERMITIDOS = ['ADECCO', 'AST', 'GNX', 'KN', 'LUANDRE', 'POLLY', 'TSI'].sort();
    const valorAtual = selectElement.value;
    selectElement.innerHTML = '<option value="">Selecione um Contrato...</option>';
    CONTRATOS_PERMITIDOS.forEach(contrato => {
        const option = document.createElement('option');
        option.value = contrato;
        option.textContent = contrato;
        selectElement.appendChild(option);
    });
    if (CONTRATOS_PERMITIDOS.includes(valorAtual)) {
        selectElement.value = valorAtual;
    }
}function attachUpperHandlersTo(form) {
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
}function populateGestorSelectForEdit(selectedSvc, gestorAtual = null) {
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
}function toUpperObject(obj) {
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
        if (k === 'DSR' && typeof v === 'string' && v) {
            const days = v.split(',')
                .map(day => toUpperTrim(day))
                .map(day => (day === 'SABADO' ? 'SÁBADO' : day))
                .filter(Boolean);
            out[k] = days.length > 0 ? days.join(', ') : null;
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
}function renderTable(dataToRender) {
    if (!colaboradoresTbody) return;
    colaboradoresTbody.innerHTML = '';
    if (!dataToRender || dataToRender.length === 0) {
        colaboradoresTbody.innerHTML = '<tr><td colspan="12" class="text-center p-4">Nenhum colaborador encontrado.</td></tr>';
        return;
    }
    const formatarNomeColaborador = (colaborador) => {
        const nomeBase = colaborador.Nome || '';
        if (colaborador.Ativo === 'AFAS') return `${nomeBase} (Afastado)`;
        const diasRest = state?.feriasAtivasMap?.get?.(nomeBase);
        if (diasRest != null && !isNaN(diasRest)) {
            if (diasRest === 0) return `${nomeBase} 🏖️ (Termina hoje)`;
            const sufixo = diasRest === 1 ? 'dia' : 'dias';
            return `${nomeBase} 🏖️ (Faltam ${diasRest} ${sufixo})`;
        }
        return nomeBase;
    };
    dataToRender.forEach((colaborador) => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-nome', colaborador.Nome || '');
        const nomeCelula = formatarNomeColaborador(colaborador);
        const admissaoOriginal = formatDateLocal(colaborador['Data de admissão']);
        const admissaoKN = formatDateLocal(colaborador['Admissao KN']);
        tr.innerHTML = `
            <td class="nome-col">${nomeCelula}</td>
            <td>${colaborador.DSR || ''}</td>
            <td>${colaborador.Escala || ''}</td>
            <td>${colaborador.Contrato || ''}</td>
            <td>${colaborador.Cargo || ''}</td>
            <td>${colaborador['ID GROOT'] || ''}</td>
            <td>${colaborador.LDAP || ''}</td>
            <td>${colaborador.SVC || ''}</td>
            <td>${colaborador.REGIAO || ''}</td>
            <td>${admissaoOriginal}</td>
            <td>${admissaoKN}</td>
            <td>${colaborador['FOLGA ESPECIAL'] || ''}</td>
        `;
        colaboradoresTbody.appendChild(tr);
    });
}function updateDisplay() {
    const dataSlice = state.dadosFiltrados.slice(0, itensVisiveis);
    renderTable(dataSlice);
    if (mostrarMenosBtn) mostrarMenosBtn.classList.toggle('hidden', itensVisiveis <= ITENS_POR_PAGINA);
    if (mostrarMaisBtn) mostrarMaisBtn.classList.toggle('hidden', itensVisiveis >= state.dadosFiltrados.length);
    if (contadorVisiveisEl) contadorVisiveisEl.textContent = `${dataSlice.length} de ${state.dadosFiltrados.length} colaboradores visíveis`;
}function populateFilters() {
    if (!filtrosSelect) return;
    const filtros = {
        Contrato: new Set(), Cargo: new Set(), Escala: new Set(), DSR: new Set(),
        Gestor: new Set(), MATRIZ: new Set(), SVC: new Set(), REGIAO: new Set(),
        'FOLGA ESPECIAL': new Set()
    };
    state.colaboradoresData.forEach((c) => {
        Object.keys(filtros).forEach((key) => {
            const v = c[key];
            if (v !== undefined && v !== null && String(v) !== '') {
                filtros[key].add(String(v));
            }
        });
    });
    filtrosSelect.forEach((selectEl) => {
        const key = selectEl.dataset.filterKey;
        if (!key || !(key in filtros)) return;
        const options = Array.from(filtros[key]).sort((a, b) =>
            a.localeCompare(b, 'pt-BR', {sensitivity: 'base'})
        );
        while (selectEl.options.length > 1) selectEl.remove(1);
        options.forEach((option) => {
            const optionEl = document.createElement('option');
            optionEl.value = option;
            optionEl.textContent = option;
            selectEl.appendChild(optionEl);
        });
    });
}function applyFiltersAndSearch() {
    const searchInputString = (searchInput?.value || '').trim();
    const searchTerms = searchInputString
        .split(',')
        .map(term => term.trim().toLowerCase())
        .filter(term => term.length > 0);
    state.dadosFiltrados = state.colaboradoresData.filter((colaborador) => {
        for (const key in state.filtrosAtivos) {
            if (!Object.prototype.hasOwnProperty.call(state.filtrosAtivos, key)) continue;
            const activeVal = state.filtrosAtivos[key];
            if (!activeVal) continue;
            const colVal = String(colaborador?.[key] ?? '');
            if (colVal !== activeVal) return false;
        }
        if (searchTerms.length === 0) {
            return true;
        }
        return searchTerms.some(term =>
            String(colaborador.Nome || '').toLowerCase().includes(term) ||
            String(colaborador.CPF || '').toLowerCase().includes(term) ||
            String(colaborador['ID GROOT'] || '').toLowerCase().includes(term) ||
            String(colaborador.LDAP || '').toLowerCase().includes(term)
        );
    });
    itensVisiveis = ITENS_POR_PAGINA;
    repopulateFilterOptionsCascade();
    updateDisplay();
}function repopulateFilterOptionsCascade() {
    if (!filtrosSelect || !filtrosSelect.length) return;
    filtrosSelect.forEach((selectEl) => {
        const key = selectEl.dataset.filterKey;
        if (!key) return;
        const searchTerm = (searchInput?.value || '').toLowerCase();
        const tempFiltrado = state.colaboradoresData.filter((c) => {
            for (const k in state.filtrosAtivos) {
                if (!Object.prototype.hasOwnProperty.call(state.filtrosAtivos, k)) continue;
                if (k === key) continue;
                const activeVal = state.filtrosAtivos[k];
                if (!activeVal) continue;
                const colVal = String(c?.[k] ?? '');
                if (colVal !== activeVal) return false;
            }
            if (!searchTerm) return true;
            return (
                String(c.Nome || '').toLowerCase().includes(searchTerm) ||
                String(c.CPF || '').toLowerCase().includes(searchTerm) ||
                String(c['ID GROOT'] || '').toLowerCase().includes(searchTerm) ||
                String(c.LDAP || '').toLowerCase().includes(searchTerm)
            );
        });
        const valores = new Set();
        tempFiltrado.forEach((c) => {
            const v = c?.[key];
            if (v != null && v !== '') valores.add(String(v));
        });
        const selecionadoAntes = selectEl.value || '';
        while (selectEl.options.length > 1) selectEl.remove(1);
        Array.from(valores)
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
            .forEach((optVal) => {
                const o = document.createElement('option');
                o.value = optVal;
                o.textContent = optVal;
                selectEl.appendChild(o);
            });
        if (selecionadoAntes && valores.has(selecionadoAntes)) {
            selectEl.value = selecionadoAntes;
        } else {
            if (state.filtrosAtivos[key]) delete state.filtrosAtivos[key];
            selectEl.selectedIndex = 0;
        }
    });
}function computeRegiaoFromSvcMatriz(svcVal, matrizVal) {
    const svc = (svcVal || '').toString().toUpperCase().trim();
    const matriz = (matrizVal || '').toString().toUpperCase().trim();
    state.serviceRegiaoMap = state.serviceRegiaoMap || new Map();
    state.matrizRegiaoMap = state.matrizRegiaoMap || new Map();
    const bySvc = svc ? (state.serviceRegiaoMap.get(svc) || null) : null;
    if (bySvc) return toUpperTrim(bySvc);
    const byMatriz = matriz ? (state.matrizRegiaoMap.get(matriz) || null) : null;
    return byMatriz ? toUpperTrim(byMatriz) : null;
}async function fetchColaboradores() {
    const now = Date.now();    if (cachedColaboradores && (now - lastFetchTimestamp < CACHE_DURATION_MS)) {
        console.log("Usando cache de colaboradores.");
        state.colaboradoresData = cachedColaboradores;        if (cachedFeriasStatus) {
            state.feriasAtivasMap = cachedFeriasStatus;
            console.log("Usando cache de status de férias.");
        } else {
            console.log("Cache de colaboradores OK, mas buscando status de férias...");
            try {
                const nomes = (state.colaboradoresData || []).map(c => c.Nome).filter(Boolean);
                state.feriasAtivasMap = new Map();
                if (nomes.length > 0) {
                    const {data: feriasAtivas, error: ferErr} = await supabase
                        .rpc('get_ferias_status_para_nomes', {nomes: nomes});
                    if (ferErr) throw ferErr;
                    (feriasAtivas || []).forEach(f => {
                        const dias = Number(f['Dias para finalizar']);
                        state.feriasAtivasMap.set(f.Nome, Number.isFinite(dias) ? dias : null);
                    });
                    cachedFeriasStatus = state.feriasAtivasMap;
                }
            } catch (e) {
                console.warn('Erro ao buscar status de férias (no reuso do cache):', e);
                state.feriasAtivasMap = new Map();
                cachedFeriasStatus = null;
            }
        }
        populateFilters();
        applyFiltersAndSearch();
        return;
    }    console.log("Buscando dados frescos do banco (Colaboradores e Férias)...");
    if (colaboradoresTbody) {
        colaboradoresTbody.innerHTML = '<tr><td colspan="12" class="text-center p-4">Carregando...</td></tr>';
    }    try {
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase
            .from('Colaboradores')
            .select('*')
            .order('Nome');
        if (matrizesPermitidas !== null) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }        const data = await fetchAllWithPagination(query);
        state.colaboradoresData = data || [];        const nomes = (state.colaboradoresData || []).map(c => c.Nome).filter(Boolean);
        state.feriasAtivasMap = new Map();
        if (nomes.length > 0) {
            const {data: feriasAtivas, error: ferErr} = await supabase
                .rpc('get_ferias_status_para_nomes', {nomes: nomes});
            if (ferErr) throw ferErr;
            (feriasAtivas || []).forEach(f => {
                const dias = Number(f['Dias para finalizar']);
                state.feriasAtivasMap.set(f.Nome, Number.isFinite(dias) ? dias : null);
            });
        }        cachedColaboradores = state.colaboradoresData;
        cachedFeriasStatus = state.feriasAtivasMap;
        lastFetchTimestamp = Date.now();        populateFilters();
        applyFiltersAndSearch();    } catch (error) {
        console.error('Erro ao carregar colaboradores/férias:', error);
        if (colaboradoresTbody) {
            colaboradoresTbody.innerHTML = '<tr><td colspan="12" class="text-center p-4 text-red-500">Erro ao carregar dados.</td></tr>';
        }
        cachedColaboradores = null;
        cachedFeriasStatus = null;
        lastFetchTimestamp = 0;
    }
}async function gerarJanelaDeQRCodes() {
    if (state.selectedNames.size === 0) {
        alert('Nenhum colaborador selecionado. Use Ctrl+Click para selecionar um ou Shift+Click para selecionar todos.');
        return;
    }
    const todosOsSelecionados = state.colaboradoresData.filter(colab =>
        state.selectedNames.has(colab.Nome)
    );
    const colaboradoresParaQR = todosOsSelecionados.filter(colab => colab['ID GROOT']);
    if (todosOsSelecionados.length > colaboradoresParaQR.length) {
        const faltantes = todosOsSelecionados.length - colaboradoresParaQR.length;
        const plural = faltantes > 1 ? 'colaboradores não possuem' : 'colaborador não possui';
        alert(`Aviso: ${todosOsSelecionados.length} colaboradores foram selecionados, mas ${faltantes} ${plural} ID GROOT e não puderam ser gerados.`);
    }
    if (colaboradoresParaQR.length === 0) {
        alert('Nenhum dos colaboradores selecionados possui um ID GROOT para gerar o QR Code.');
        return;
    }
    const {data: imageData, error: imageError} = await supabase
        .storage
        .from('cards')
        .getPublicUrl('QRCODE.png');
    if (imageError) {
        console.error('Erro ao buscar a imagem do card:', imageError);
        alert('Não foi possível carregar o template do card. Verifique o console de erros.');
        return;
    }
    const urlImagemCard = imageData.publicUrl;
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>QR Codes - Colaboradores</title>
            <script src="https://cdn.jsdelivr.net/npm/davidshimjs-qrcodejs@0.0.2/qrcode.min.js"><\/script>
            <style>
                body { font-family: sans-serif; }
                .pagina { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; page-break-after: always; }
                .card-item { position: relative; width: 240px; height: 345px; background-image: url('${urlImagemCard}'); background-size: 100% 100%; background-repeat: no-repeat; overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .qr-code-area { position: absolute; top: 75px; left: 20px; width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; }
                .info-area { position: absolute; bottom: 1px; left: 0; width: 100%; height: 60px; padding: 0 3px; box-sizing: border-box; color: black; font-weight: bold; display: flex; flex-direction: column; justify-content: center; align-items: center; }
                .info-area .nome { display: block; font-size: 11px; line-height: 1.2; margin-bottom: 4px; }
                .info-area .id { display: block; font-size: 15px; }
                @media print { @page { size: A4; margin: 1cm; } body { margin: 0; } .pagina:last-of-type { page-break-after: auto; } }
            </style>
        </head>
        <body>
    `);
    let htmlContent = '';
    const ITENS_POR_PAGINA_QR = 9;
    for (let i = 0; i < colaboradoresParaQR.length; i++) {
        if (i % ITENS_POR_PAGINA_QR === 0) {
            if (i > 0) htmlContent += '</div>';
            htmlContent += '<div class="pagina">';
        }
        const colaborador = colaboradoresParaQR[i];
        const idFormatado = String(colaborador['ID GROOT']).padStart(11, '0');
        htmlContent += `
            <div class="card-item">
                <div class="qr-code-area">
                    <div id="qrcode-${i}"></div>
                </div>
                <div class="info-area">
                    <span class="nome">${colaborador.Nome}</span>
                    <span class="id">ID: ${idFormatado}</span>
                </div>
            </div>
        `;
    }
    htmlContent += '</div>';
    printWindow.document.write(htmlContent);
    printWindow.document.write(`
        <script>
            const dados = ${JSON.stringify(colaboradoresParaQR)};
            window.onload = function() {
                for (let i = 0; i < dados.length; i++) {
                    const colaborador = dados[i];
                    const qrElement = document.getElementById('qrcode-' + i);
                    if (qrElement) {
                        const idParaQRCode = String(colaborador['ID GROOT']).padStart(11, '0');
                        new QRCode(qrElement, { text: idParaQRCode, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.H });
                    }
                }
            };
        <\/script>
    `);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
}async function loadSVCsParaFormulario() {
    const svcSelect = document.getElementById('addSVC');
    if (!svcSelect) return;
    if (state.matrizesData.length > 0 && svcSelect.options.length > 1) {
        const matrizesPermitidasCheck = getMatrizesPermitidas();
        if (matrizesPermitidasCheck === null) return;
    }    if (state.matrizesData.length === 0) {
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase.from('Matrizes').select('SERVICE, MATRIZ, REGIAO');
        if (matrizesPermitidas !== null) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }
        const {data, error} = await query;
        if (error) {
            console.error('Erro ao buscar mapa de serviço-matriz:', error);
            svcSelect.innerHTML = '<option value="" disabled selected>Erro ao carregar</option>';
            return;
        }
        state.matrizesData = data || [];
        state.serviceMatrizMap = new Map((state.matrizesData).map(item => [String(item.SERVICE || '').toUpperCase(), item.MATRIZ || '']));
        state.serviceRegiaoMap = new Map((state.matrizesData).map(item => [String(item.SERVICE || '').toUpperCase(), item.REGIAO || '']));
        state.matrizRegiaoMap = new Map((state.matrizesData).map(item => [String(item.MATRIZ || '').toUpperCase(), item.REGIAO || '']));
    }    svcSelect.innerHTML = '<option value="" disabled selected>Selecione um SVC...</option>';
    const uniqueSvcs = [...new Set(state.matrizesData.map(item => String(item.SERVICE || '').toUpperCase()))].sort();
    uniqueSvcs.forEach((svc) => {
        const opt = document.createElement('option');
        opt.value = svc;
        opt.textContent = svc;
        svcSelect.appendChild(opt);
    });
}async function loadGestoresParaFormulario() {
    if (state.gestoresData.length > 0) return;    const {data, error} = await supabase.from('Gestores').select('NOME, SVC');
    if (error) {
        console.error('Erro ao buscar gestores:', error);
        state.gestoresData = [];
        return;
    }
    state.gestoresData = data || [];
}function populateGestorSelect(selectedSvc) {
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
}function isDSRValida(dsrStr) {
    const raw = (dsrStr || '').toUpperCase().trim();
    if (!raw) return false;
    const dias = raw.split(',').map(d => d.trim()).filter(Boolean);
    if (dias.length === 0) return false;
    const permitidos = new Set(DIAS_DA_SEMANA.map(d => d.toUpperCase()));
    permitidos.add('SABADO');
    return dias.every(d => permitidos.has(d));
}async function handleAddSubmit(event) {
    event.preventDefault();
    if (document.body.classList.contains('user-level-visitante')) {
        alert('Ação não permitida. Você está em modo de visualização.');
        return;
    }
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
    const {count: nomeCount, error: nomeErr} = await supabase
        .from('Colaboradores')
        .select('Nome', {count: 'exact', head: true})
        .ilike('Nome', nomeUpper);
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
        const {count: cpfCount, error: cpfErr} = await supabase
            .from('Colaboradores')
            .select('CPF', {count: 'exact', head: true})
            .eq('CPF', cpf);
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
    const dsrRaw = document.getElementById('addDSR')?.value || '';
    const dsrVal = toUpperTrim(dsrRaw);
    if (!isDSRValida(dsrVal)) {
        alert('Selecione pelo menos um dia de DSR (ex.: DOMINGO, SEGUNDA, ...).');
        document.getElementById('addDSRBtn')?.focus();
        return;
    }
    const svcSelecionado = nullIfEmpty(document.getElementById('addSVC')?.value);
    const matrizSelecionada = nullIfEmpty(document.getElementById('addMatriz')?.value)
        || (svcSelecionado ? (state.serviceMatrizMap.get(String(svcSelecionado).toUpperCase()) || null) : null);
    const regiaoAuto = computeRegiaoFromSvcMatriz(svcSelecionado, matrizSelecionada);
    const newColaborador = toUpperObject({
        Nome: nomeUpper,
        CPF: cpf,
        'Data de nascimento': document.getElementById('addDataNascimento')?.value || null,
        Genero: generoNorm,
        Contrato: document.getElementById('addContrato')?.value || '',
        Cargo: document.getElementById('addCargo')?.value || '',
        Gestor: document.getElementById('addGestor')?.value || '',
        DSR: dsrVal,
        Escala: nullIfEmpty(document.getElementById('addEscala')?.value),
        'Data de admissão': document.getElementById('addDataAdmissao')?.value || null,
        SVC: nullIfEmpty(svcSelecionado),
        MATRIZ: nullIfEmpty(matrizSelecionada),
        REGIAO: nullIfEmpty(regiaoAuto),
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
        const dsrBtn = document.getElementById('addDSRBtn');
        if (dsrBtn) dsrBtn.querySelector('span').textContent = 'CLIQUE PARA SELECIONAR OS DIAS...';
    }
    const gestorSelect = document.getElementById('addGestor');
    if (gestorSelect) {
        gestorSelect.innerHTML = '<option value="" disabled selected>Selecione um SVC primeiro...</option>';
        gestorSelect.disabled = true;
    }
    document.dispatchEvent(new CustomEvent('colaborador-added'));
    invalidateColaboradoresCache();
    await fetchColaboradores();
}async function loadServiceMatrizForEdit() {
    if (!editSVC) return;
    if (state.matrizesData.length > 0 && editSVC.options.length > 1) {
        const matrizesPermitidasCheck = getMatrizesPermitidas();
        if (matrizesPermitidasCheck === null) return;
    }    if (state.matrizesData.length === 0) {
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase.from('Matrizes').select('SERVICE, MATRIZ, REGIAO');
        if (matrizesPermitidas !== null) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }
        const {data, error} = await query;
        if (error) {
            console.error(error);
            return;
        }
        state.matrizesData = data || [];
        state.serviceMatrizMap = new Map((state.matrizesData).map(i => [String(i.SERVICE || '').toUpperCase(), i.MATRIZ || '']));
        state.serviceRegiaoMap = new Map((state.matrizesData).map(i => [String(i.SERVICE || '').toUpperCase(), i.REGIAO || '']));
        state.matrizRegiaoMap = new Map((state.matrizesData).map(i => [String(i.MATRIZ || '').toUpperCase(), i.REGIAO || '']));
    }    editSVC.innerHTML = '<option value="" disabled selected>Selecione...</option>';
    const uniqueSvcs = [...new Set(state.matrizesData.map(item => String(item.SERVICE || '').toUpperCase()))].sort();
    uniqueSvcs.forEach(svc => {
        const opt = document.createElement('option');
        opt.value = svc;
        opt.textContent = svc;
        editSVC.appendChild(opt);
    });
}async function fetchColabByNome(nome) {
    const {data, error} = await supabase.from('Colaboradores').select('*').eq('Nome', nome).maybeSingle();
    if (error) throw error;
    return data;
}function showEditModal() {
    editModal?.classList.remove('hidden');
}function hideEditModal() {
    editModal?.classList.add('hidden');
    editOriginal = null;
    editForm?.reset();
}async function fillEditForm(colab) {
    editOriginal = colab;
    await populateContratoSelect(editInputs.Contrato);
    await loadGestoresParaFormulario();
    const setVal = (el, v) => {
        if (el) el.value = v ?? '';
    };
    if (editTitulo) editTitulo.textContent = colab.Nome || 'Colaborador';
    setVal(editInputs.Nome, colab.Nome || '');
    setVal(editInputs.CPF, colab.CPF || '');
    setVal(editInputs.Contrato, colab.Contrato || '');
    setVal(editInputs.Cargo, colab.Cargo || '');
    const dsrValue = colab.DSR || '';
    setVal(document.getElementById('editDSR'), dsrValue);
    const editDsrBtn = document.getElementById('editDSRBtn');
    if (editDsrBtn) editDsrBtn.value = dsrValue || '';
    setVal(editInputs.Escala, colab.Escala || '');
    setVal(editInputs['FOLGA ESPECIAL'], colab['FOLGA ESPECIAL'] || '');
    setVal(editInputs.LDAP, colab.LDAP ?? '');
    setVal(editInputs['ID GROOT'], colab['ID GROOT'] ?? '');
    setVal(editInputs['Data de nascimento'], colab['Data de nascimento'] ? new Date(colab['Data de nascimento']).toISOString().split('T')[0] : '');
    editMatriz = document.getElementById('editMatriz');
    const editRegiao = document.getElementById('editRegiao');
    if (editSVC) {
        const svc = colab.SVC ? String(colab.SVC).toUpperCase() : '';
        if (svc && !Array.from(editSVC.options).some(o => o.value === svc)) {
            const opt = document.createElement('option');
            opt.value = svc;
            opt.textContent = svc;
            editSVC.appendChild(opt);
        }
        editSVC.value = svc || '';
        const matrizUi = colab.MATRIZ || (svc ? (state.serviceMatrizMap.get(svc) || '') : '');
        if (editMatriz) editMatriz.value = matrizUi || '';
        const regUi = computeRegiaoFromSvcMatriz(svc, matrizUi) || colab.REGIAO || '';
        if (editRegiao) editRegiao.value = regUi || '';
        populateGestorSelectForEdit(svc, colab.Gestor);
    }
    if (editAfastarBtn) {
        if (colab.Ativo === 'SIM') {
            editAfastarBtn.textContent = 'Afastar Colaborador';
            editAfastarBtn.style.display = 'inline-block';
        } else if (colab.Ativo === 'AFAS') {
            editAfastarBtn.textContent = 'Remover Afastamento';
            editAfastarBtn.style.display = 'inline-block';
        } else {
            editAfastarBtn.style.display = 'none';
        }
    }
    if (editEfetivarKnBtn) {
        if (colab.Contrato && colab.Contrato.toUpperCase() === 'KN') {
            editEfetivarKnBtn.style.display = 'none';
        } else {
            editEfetivarKnBtn.style.display = 'inline-block';
        }
    }
    if (editExcluirBtn) {
        editExcluirBtn.style.display = state.isUserAdmin ? 'inline-block' : 'none';
    }
}function openEfetivarKnModal() {
    if (!editOriginal || !efetivarKnModal) return;
    efetivarKnNomeEl.value = editOriginal.Nome;
    efetivarKnDataEl.value = new Date().toISOString().split('T')[0];
    efetivarKnModal.classList.remove('hidden');
}function closeEfetivarKnModal() {
    if (efetivarKnModal) {
        efetivarKnModal.classList.add('hidden');
        efetivarKnForm.reset();
    }
}async function onEfetivarKnClick() {
    if (!editOriginal) {
        alert('Erro: Colaborador não carregado.');
        return;
    }
    const confirmacao = confirm(`Tem certeza que deseja efetivar "${editOriginal.Nome}" como KN?`);
    if (confirmacao) {
        openEfetivarKnModal();
    }
}async function onEfetivarKnSubmit(e) {
    e.preventDefault();
    const dataEfetivacao = efetivarKnDataEl.value;
    if (!dataEfetivacao) {
        alert('Por favor, selecione a data de efetivação.');
        return;
    }
    if (!editOriginal) {
        alert('Erro crítico: Dados do colaborador original perdidos.');
        return;
    }
    try {
        const {error} = await supabase
            .from('Colaboradores')
            .update({Contrato: 'KN', 'Admissao KN': dataEfetivacao})
            .eq('Nome', editOriginal.Nome);
        if (error) throw error;
        alert('Colaborador efetivado como KN com sucesso!');
        closeEfetivarKnModal();
        hideEditModal();
        invalidateColaboradoresCache();
        await fetchColaboradores();
    } catch (error) {
        console.error('Erro ao efetivar colaborador:', error);
        alert(`Não foi possível efetivar o colaborador: ${error.message}`);
    }
}async function validateEditDuplicates(payload) {
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
}async function onEditSubmit(e) {
    e.preventDefault();
    if (document.body.classList.contains('user-level-visitante')) {
        alert('Ação não permitida. Você está em modo de visualização.');
        return;
    }
    if (isSubmittingEdit) return;
    isSubmittingEdit = true;
    if (!editOriginal) {
        alert('Erro: Não há dados originais do colaborador.');
        isSubmittingEdit = false;
        return;
    }
    const Nome = toUpperTrim(editInputs.Nome.value || '');
    if (!Nome) {
        alert('Informe o NOME.');
        editInputs.Nome.focus();
        isSubmittingEdit = false;
        return;
    }
    if (editSalvarBtn) {
        editSalvarBtn.disabled = true;
        editSalvarBtn.textContent = 'Salvando...';
    }
    try {
        const nomeAnterior = editOriginal.Nome;
        const CPF = normalizeCPF(editInputs.CPF.value || '');
        const svc = nullIfEmpty(editSVC.value);
        const matrizAuto = svc ? (state.serviceMatrizMap.get(String(svc).toUpperCase()) || null) : null;
        const dsrRaw = document.getElementById('editDSR').value;
        const dsrValue = toUpperTrim(nullIfEmpty(dsrRaw));
        if (!isDSRValida(dsrValue)) {
            alert('Selecione pelo menos um dia de DSR (ex.: DOMINGO, SEGUNDA, ...).');
            document.getElementById('editDSRBtn')?.focus();
            isSubmittingEdit = false;
            if (editSalvarBtn) {
                editSalvarBtn.disabled = false;
                editSalvarBtn.textContent = 'Salvar Alterações';
            }
            return;
        }
        const regiaoInputEl = document.getElementById('editRegiao');
        const regiaoFromInput = toUpperTrim(nullIfEmpty(regiaoInputEl?.value));
        const regiaoAuto = computeRegiaoFromSvcMatriz(svc, matrizAuto);
        const regiaoFinal = toUpperTrim(nullIfEmpty(regiaoAuto)) || regiaoFromInput || null;
        const payload = {
            Nome, CPF, Contrato: toUpperTrim(editInputs.Contrato.value || ''),
            Cargo: toUpperTrim(editInputs.Cargo.value || ''), Gestor: toUpperTrim(nullIfEmpty(editInputs.Gestor.value)),
            DSR: dsrValue, Escala: toUpperTrim(nullIfEmpty(editInputs.Escala.value)),
            'FOLGA ESPECIAL': toUpperTrim(nullIfEmpty(editInputs['FOLGA ESPECIAL'].value)),
            LDAP: nullIfEmpty(editInputs.LDAP.value), 'ID GROOT': numberOrNull(editInputs['ID GROOT'].value),
            'Data de nascimento': editInputs['Data de nascimento'].value || null,
            SVC: toUpperTrim(svc), MATRIZ: toUpperTrim(matrizAuto), REGIAO: regiaoFinal
        };
        const dupMsg = await validateEditDuplicates(payload);
        if (dupMsg) {
            alert(dupMsg);
            isSubmittingEdit = false;
            if (editSalvarBtn) {
                editSalvarBtn.disabled = false;
                editSalvarBtn.textContent = 'Salvar Alterações';
            }
            return;
        }
        const {error: rpcError} = await supabase.rpc('atualizar_nome_colaborador_cascata', {
            nome_antigo: nomeAnterior,
            novos_dados: payload
        });
        if (rpcError) {
            console.error('Erro na transação de atualização:', rpcError);
            alert(`Erro ao atualizar colaborador: ${rpcError.message}`);
            isSubmittingEdit = false;
            if (editSalvarBtn) {
                editSalvarBtn.disabled = false;
                editSalvarBtn.textContent = 'Salvar Alterações';
            }
            return;
        }
        const dsrAnterior = editOriginal.DSR || null;
        const dsrAtual = payload.DSR || null;
        if (dsrAnterior !== dsrAtual) {
            try {
                const {data: maxRow} = await supabase.from('LogDSR').select('Numero').order('Numero', {ascending: false}).limit(1);
                const nextNumero = (maxRow?.[0]?.Numero || 0) + 1;
                const logEntry = {
                    Numero: nextNumero, Name: payload.Nome, DsrAnterior: dsrAnterior, DsrAtual: dsrAtual,
                    DataAlteracao: new Date().toISOString(), Escala: payload.Escala, Gestor: payload.Gestor,
                    SVC: payload.SVC, MATRIZ: payload.MATRIZ
                };
                await supabase.from('LogDSR').insert([logEntry]);
            } catch (e) {
                console.warn('Falha ao registrar log de DSR:', e);
            }
        }        invalidateColaboradoresCache();
        await fetchColaboradores();        alert('Colaborador atualizado com sucesso em todas as tabelas!');
        hideEditModal();
        document.dispatchEvent(new CustomEvent('colaborador-edited', {
            detail: {
                nomeAnterior: nomeAnterior,
                nomeAtual: payload.Nome
            }
        }));    } catch (err) {
        console.error("Erro no processo de edição:", err);
        alert("Ocorreu um erro inesperado. Verifique o console.");
    } finally {
        isSubmittingEdit = false;
        if (editSalvarBtn) {
            editSalvarBtn.disabled = false;
            editSalvarBtn.textContent = 'Salvar Alterações';
        }
    }
}async function onAfastarClick() {
    if (!editOriginal || !editOriginal.Nome) {
        alert('Erro: Colaborador não identificado.');
        return;
    }
    let colab;
    try {
        colab = await fetchColabByNome(editOriginal.Nome);
    } catch (fetchError) {
        console.error("Erro ao buscar colaborador para afastamento:", fetchError);
        alert('Não foi possível carregar os dados atuais do colaborador. Tente novamente.');
        return;
    }
    if (!colab) {
        alert('Não foi possível carregar os dados atuais do colaborador. Tente novamente.');
        return;
    }
    const currentStatus = colab.Ativo;
    let newStatus;
    let confirmationMessage;
    if (currentStatus === 'SIM') {
        newStatus = 'AFAS';
        confirmationMessage = 'Tem certeza que deseja afastar este colaborador? O status será alterado para "AFAS".';
    } else if (currentStatus === 'AFAS') {
        newStatus = 'SIM';
        confirmationMessage = 'Tem certeza que deseja remover o afastamento deste colaborador? O status voltará para "SIM".';
    } else {
        alert(`Ação não permitida para o status atual "${currentStatus}".`);
        return;
    }
    const ok = confirm(confirmationMessage);
    if (!ok) return;
    const {error} = await supabase
        .from('Colaboradores')
        .update({Ativo: newStatus})
        .eq('Nome', colab.Nome);
    if (error) {
        alert(`Erro ao atualizar o status: ${error.message}`);
        return;
    }
    alert('Status do colaborador atualizado com sucesso!');
    hideEditModal();
    invalidateColaboradoresCache();
    await fetchColaboradores();
}function calcularPeriodoTrabalhado(dataAdmissao, dataDesligamento) {
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
}function openDesligarModalFromColab(colab) {
    desligarColaborador = colab;
    desligarNomeEl.value = colab?.Nome || '';
    const hoje = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
    desligarDataEl.value = iso;
    desligarMotivoEl.selectedIndex = 0;
    desligarModal.classList.remove('hidden');
}function closeDesligarModal() {
    desligarModal.classList.add('hidden');
    desligarColaborador = null;
    desligarForm.reset();
}async function onDesligarSubmit(e) {
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
        Nome: desligarColaborador.Nome || null, Contrato: desligarColaborador.Contrato || null,
        Cargo: desligarColaborador.Cargo || null, 'Data de Admissão': desligarColaborador['Data de admissão'] || null,
        Gestor: desligarColaborador.Gestor || null, 'Data de Desligamento': dataDesligamento,
        'Período Trabalhado': periodoTrabalhado, Escala: desligarColaborador.Escala || null,
        SVC: desligarColaborador.SVC || null, MATRIZ: desligarColaborador.MATRIZ || null,
        Motivo: motivo || null
    };
    const {error: insertError} = await supabase.from('Desligados').insert([desligadoData]);
    if (insertError) {
        alert(`Erro ao registrar em Desligados: ${insertError.message}`);
        return;
    }
    const {error: deleteError} = await supabase.from('Colaboradores').delete().eq('Nome', desligarColaborador.Nome);
    if (deleteError) {
        alert(`Erro ao remover de Colaboradores: ${deleteError.message}`);        return;
    }
    alert('Colaborador desligado com sucesso!');
    closeDesligarModal();
    hideEditModal();
    invalidateColaboradoresCache();
    await fetchColaboradores();
}async function getNonFinalizedFerias(nome) {
    const {data, error} = await supabase
        .from('Ferias')
        .select('Numero, Status, "Data Final"')
        .eq('Nome', nome)
        .neq('Status', 'Finalizado')
        .order('Numero', {ascending: false})
        .limit(1);    if (error) return {error};
    return {data: (data && data.length > 0) ? data[0] : null};
}async function agendarFerias(info) {
    const {colaborador, dataInicio, dataFinal} = info;
    const {data: feriasPendentes, error: feriasCheckError} = await getNonFinalizedFerias(colaborador.Nome);    if (feriasCheckError) {
        console.error("Erro ao verificar férias pendentes:", feriasCheckError);
        return {error: new Error('Erro ao verificar férias existentes.')};
    }
    if (feriasPendentes) {
        const status = feriasPendentes.Status || 'pendente';
        const dataFinalStr = feriasPendentes['Data Final'] ? ` (terminando em ${formatDateLocal(feriasPendentes['Data Final'])})` : '';
        return {error: new Error(`Este colaborador já possui férias com status "${status}"${dataFinalStr}. Não é possível agendar novas férias até que as anteriores sejam finalizadas.`)};
    }    const {data: lastFerias, error: numError} = await supabase
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
        const {
            data: m,
            error: mErr
        } = await supabase.from('Matrizes').select('MATRIZ').eq('SERVICE', svcUp).maybeSingle();
        if (!mErr && m) matriz = m.MATRIZ || null;
    }
    const feriasData = {
        Numero: newNumero, Nome: colaborador.Nome, Cargo: colaborador.Cargo || null,
        Escala: colaborador.Escala, SVC: colaborador.SVC, MATRIZ: matriz || null,
        'Data Inicio': dataInicio, 'Data Final': dataFinal, Status: statusInicial,
        'Dias para finalizar': diasParaFinalizar
    };
    const {error} = await supabase.from('Ferias').insert([feriasData]);
    if (error) return {error};
    invalidateColaboradoresCache();
    await updateAllVacationStatuses();
    return {success: true};
}async function updateAllVacationStatuses() {
    const {data: feriasList, error} = await supabase.from('Ferias').select('*').order('Numero', {ascending: true});
    if (error || !feriasList) return;
    const today = toStartOfDay(new Date());
    let needsColabUpdate = false;
    for (const ferias of feriasList) {
        const dataInicio = toStartOfDay(ferias['Data Inicio']);
        const dataFinal = toStartOfDay(ferias['Data Final']);
        let newStatus = ferias.Status;
        let updatePayload = {};
        let colabFeriasStatusUpdate = null;        if (ferias.Status === 'Finalizado') {
            if (ferias['Dias para finalizar'] !== 0) updatePayload['Dias para finalizar'] = 0;
            colabFeriasStatusUpdate = 'NAO';
        } else {
            if (today > dataFinal) newStatus = 'Finalizado';
            else if (today >= dataInicio && today <= dataFinal) newStatus = 'Em andamento';
            else if (today < dataInicio) newStatus = 'A iniciar';            const diasParaFinalizar = Math.max(0, Math.ceil((dataFinal - today) / (1000 * 60 * 60 * 24)));
            if (newStatus !== ferias.Status || diasParaFinalizar !== ferias['Dias para finalizar']) {
                updatePayload.Status = newStatus;
                updatePayload['Dias para finalizar'] = diasParaFinalizar;
                if (newStatus === 'Em andamento') colabFeriasStatusUpdate = 'SIM';
                else if (newStatus === 'Finalizado') colabFeriasStatusUpdate = 'NAO';
            }
        }        if (Object.keys(updatePayload).length > 0) {
            await supabase.from('Ferias').update(updatePayload).eq('Numero', ferias.Numero);
        }        if (colabFeriasStatusUpdate) {            const colab = cachedColaboradores?.find(c => c.Nome === ferias.Nome);
            if (!colab || colab.Ferias !== colabFeriasStatusUpdate) {
                await supabase.from('Colaboradores').update({Ferias: colabFeriasStatusUpdate}).eq('Nome', ferias.Nome);
                needsColabUpdate = true;
            }
        }
    }    if (needsColabUpdate) {
        invalidateColaboradoresCache();
    }
}function openFeriasModalFromColab(colab) {
    feriasColaborador = colab;
    if (!feriasModal) return;
    if (feriasNomeEl) feriasNomeEl.value = colab?.Nome || '';
    const hoje = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
    if (feriasInicioEl && !feriasInicioEl.value) feriasInicioEl.value = iso;
    if (feriasFinalEl && !feriasFinalEl.value) feriasFinalEl.value = iso;
    feriasModal.classList.remove('hidden');
}function closeFeriasModal() {
    if (!feriasModal) return;
    feriasModal.classList.add('hidden');
    feriasColaborador = null;
    feriasForm?.reset();
}async function onFeriasSubmit(e) {
    e.preventDefault();
    if (isSubmittingFerias) return;    try {
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
        }        const ok = confirm(`Confirmar férias de ${feriasColaborador.Nome} de ${formatDateLocal(dataInicio)} até ${formatDateLocal(dataFinal)}?`);
        if (!ok) return;        isSubmittingFerias = true;
        const submitButton = feriasForm ? feriasForm.querySelector('button[type="submit"]') : null;
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Agendando...';
        }        const {success, error} = await agendarFerias({colaborador: feriasColaborador, dataInicio, dataFinal});        if (!success) {
            alert(`Erro ao agendar férias: ${error?.message || error}`);        } else {
            alert('Férias agendadas com sucesso!');
            closeFeriasModal();            await fetchColaboradores();
        }    } finally {
        isSubmittingFerias = false;
        const submitButton = feriasForm ? feriasForm.querySelector('button[type="submit"]') : null;
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = 'Confirmar';
        }
    }
}const HIST = {
    nome: null, ano: new Date().getFullYear(), marks: new Map(), dsrDates: new Set(),
    initialized: false, els: {modal: null, title: null, yearSel: null, months: null, fecharBtn: null,}
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
const isTrue = (v) => v === 1 || v === '1' || v === true || String(v).toUpperCase() === 'SIM';function ensureHistoricoDomRefs() {
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
}function putHistoricoTitle() {
    if (!HIST.els.title) return;
    HIST.els.title.textContent = HIST.nome ? `Histórico – ${HIST.nome}` : 'Histórico';
}function renderHistoricoCalendar() {
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
}async function computeDsrDatesForYear(nome, ano) {
    try {
        const {data: colab, error} = await supabase.from('Colaboradores').select('DSR').eq('Nome', nome).maybeSingle();
        if (error) throw error;
        const dsrString = String(colab?.DSR || '').toUpperCase();
        if (!dsrString) return new Set();
        const dsrDays = dsrString.split(',').map(d => d.trim());
        const dayNameToIndex = {
            'DOMINGO': 6,
            'SEGUNDA': 0,
            'TERÇA': 1,
            'QUARTA': 2,
            'QUINTA': 3,
            'SEXTA': 4,
            'SÁBADO': 5,
            'SABADO': 5
        };
        const targetIndexes = new Set(dsrDays.map(day => dayNameToIndex[day]).filter(idx => idx != null));
        if (targetIndexes.size === 0) return new Set();
        const out = new Set();
        const start = new Date(ano, 0, 1);
        const end = new Date(ano, 11, 31);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const jsDay = d.getDay();
            const myDayIndex = (jsDay === 0) ? 6 : jsDay - 1;
            if (targetIndexes.has(myDayIndex)) {
                out.add(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
            }
        }
        return out;
    } catch (e) {
        console.error('computeDsrDatesForYear error:', e);
        return new Set();
    }
}async function loadHistoricoIntoModal() {
    if (!HIST.nome) return;
    if (HIST.els.months) {
        HIST.els.months.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:10px;color:#6b7280;">Carregando…</div>';
    }
    try {
        const y = Number.isInteger(HIST.ano) ? HIST.ano : (new Date()).getFullYear();
        const start = `${y}-01-01`;
        const end = `${y}-12-31`;
        const {
            data,
            error
        } = await supabase.from('ControleDiario').select('Data, "Presença", Falta, Atestado, "Folga Especial", Feriado, Suspensao')
            .eq('Nome', HIST.nome).gte('Data', start).lte('Data', end).order('Data', {ascending: true});
        if (error) {
            console.error('getHistoricoPresencas erro:', error);
            if (HIST.els.months) {
                HIST.els.months.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:10px;color:#e55353;">Erro ao carregar histórico.</div>';
            }
            return;
        }
        HIST.marks.clear();
        (data || []).forEach((r) => {
            const iso = r.Data;
            let status = null;
            if (isTrue(r['Presença'])) status = 'PRESENCA'; else if (isTrue(r['Falta'])) status = 'FALTA'; else if (isTrue(r['Atestado'])) status = 'ATESTADO'; else if (isTrue(r['Folga Especial'])) status = 'F_ESPECIAL'; else if (isTrue(r['Feriado'])) status = 'FERIADO'; else if (isTrue(r['Suspensao'])) status = 'SUSPENSAO';
            if (status) HIST.marks.set(iso, status);
        });
        HIST.dsrDates = await computeDsrDatesForYear(HIST.nome, y);
        renderHistoricoCalendar();
    } catch (e) {
        console.error('Falha geral ao carregar histórico:', e);
        if (HIST.els.months) {
            HIST.els.months.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:10px;color:#e55353;">Erro ao carregar histórico.</div>';
        }
    }
}async function openHistorico(nome) {
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
}function wireDsrModal() {
    dsrModal = document.getElementById('dsrModal');
    dsrCheckboxesContainer = document.getElementById('dsrCheckboxesContainer');
    dsrOkBtn = document.getElementById('dsrOkBtn');
    dsrCancelarBtn = document.getElementById('dsrCancelarBtn');
    if (!dsrModal || !dsrCheckboxesContainer || !dsrOkBtn || !dsrCancelarBtn) {
        console.error('Elementos do modal de DSR não encontrados!');
        return;
    }
    dsrCheckboxesContainer.innerHTML = '';
    DIAS_DA_SEMANA.forEach(dia => {
        const diaId = `dsr-${dia.toLowerCase().replace('-feira', '')}`;
        const label = document.createElement('label');
        label.className = 'flex items-center space-x-2 cursor-pointer';
        label.innerHTML = `<input type="checkbox" id="${diaId}" value="${dia}" class="form-checkbox h-5 w-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"><span class="text-gray-700">${dia.charAt(0).toUpperCase() + dia.slice(1).toLowerCase().replace('-feira', '')}</span>`;
        dsrCheckboxesContainer.appendChild(label);
    });
    dsrCancelarBtn.addEventListener('click', () => {
        dsrModal.classList.add('hidden');
        currentDsrInputTarget = null;
    });
    dsrOkBtn.addEventListener('click', () => {
        if (!currentDsrInputTarget) return;
        const selectedDays = [];
        dsrCheckboxesContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
            selectedDays.push(checkbox.value);
        });
        const finalValue = selectedDays.join(', ');
        currentDsrInputTarget.value = finalValue;
        const buttonId = currentDsrInputTarget.id.replace('DSR', 'DSRBtn');
        const displayButton = document.getElementById(buttonId);
        if (displayButton) {
            displayButton.value = finalValue || '';
        }
        dsrModal.classList.add('hidden');
        currentDsrInputTarget = null;
    });
}function openDsrModal(targetInput) {
    if (!dsrModal) return;
    currentDsrInputTarget = targetInput;
    const currentValues = (targetInput.value || '').split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
    const currentValueSet = new Set(currentValues);
    dsrCheckboxesContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = currentValueSet.has(checkbox.value);
    });
    dsrModal.classList.remove('hidden');
}function wireEdit() {
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
    editAfastarBtn = document.getElementById('editAfastarBtn');
    editEfetivarKnBtn = document.getElementById('editEfetivarKnBtn');
    editMatriz = document.getElementById('editMatriz');
    const editRegiao = document.getElementById('editRegiao');
    editInputs = {
        Nome: document.getElementById('editNome'),
        CPF: document.getElementById('editCPF'),
        Contrato: document.getElementById('editContrato'),
        Cargo: document.getElementById('editCargo'),
        Gestor: document.getElementById('editGestor'),
        Escala: document.getElementById('editEscala'),
        'FOLGA ESPECIAL': document.getElementById('editFolgaEspecial'),
        LDAP: document.getElementById('editLDAP'),
        'ID GROOT': document.getElementById('editIdGroot'),
        'Data de nascimento': document.getElementById('editDataNascimento')
    };
    attachUpperHandlersTo(editForm);
    if (editSVC) {
        editSVC.addEventListener('change', () => {
            const svc = (editSVC.value || '').toString().toUpperCase();
            const matrizAuto = svc ? (state.serviceMatrizMap.get(svc) || '') : '';
            if (editMatriz) editMatriz.value = matrizAuto || '';
            const regAuto = computeRegiaoFromSvcMatriz(svc, matrizAuto) || '';
            if (editRegiao) editRegiao.value = regAuto || '';
            populateGestorSelectForEdit(editSVC.value);
        });
    }
    const editDSRBtn = document.getElementById('editDSRBtn');
    if (editDSRBtn) {
        editDSRBtn.addEventListener('click', () => {
            openDsrModal(document.getElementById('editDSR'));
        });
    }
    editForm?.addEventListener('submit', onEditSubmit);
    editCancelarBtn?.addEventListener('click', hideEditModal);
    editAfastarBtn?.addEventListener('click', onAfastarClick);
    editEfetivarKnBtn?.addEventListener('click', onEfetivarKnClick);
    editExcluirBtn?.addEventListener('click', async () => {
        if (!state.isUserAdmin) {
            alert('Apenas administradores podem excluir colaboradores.');
            return;
        }
        if (!editOriginal) return;
        const ok = confirm('Tem certeza que deseja excluir este colaborador? ESTA AÇÃO É IRREVERSÍVEL!');
        if (!ok) return;
        try {
            editExcluirBtn.disabled = true;
            editExcluirBtn.textContent = 'Excluindo...';
            const {error} = await supabase.from('Colaboradores').delete().eq('Nome', editOriginal.Nome);
            if (error) throw error;
            alert('Colaborador excluído com sucesso!');
            document.dispatchEvent(new CustomEvent('colaborador-deleted', {detail: {nome: editOriginal.Nome}}));
            hideEditModal();
            invalidateColaboradoresCache();
            await fetchColaboradores();
        } catch (error) {
            console.error('Erro ao excluir:', error);
            alert(`Erro ao excluir: ${error.message}`);
        } finally {
            editExcluirBtn.disabled = false;
            editExcluirBtn.textContent = 'Excluir Colaborador';
        }
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
}function wireDesligar() {
    desligarModal = document.getElementById('desligarModal');
    desligarForm = document.getElementById('desligarForm');
    desligarNomeEl = document.getElementById('desligarNome');
    desligarDataEl = document.getElementById('desligarData');
    desligarMotivoEl = document.getElementById('desligarMotivo');
    desligarCancelarBtn = document.getElementById('desligarCancelarBtn');
    desligarCancelarBtn?.addEventListener('click', closeDesligarModal);
    desligarForm?.addEventListener('submit', onDesligarSubmit);
}function wireFerias() {
    feriasModal = document.getElementById('feriasModal') || null;
    feriasForm = document.getElementById('feriasForm') || document.getElementById('ferias-form') || null;
    feriasNomeEl = document.getElementById('feriasNome') || document.getElementById('nome-colaborador') || null;
    feriasInicioEl = document.getElementById('feriasDataInicio') || document.getElementById('data-inicio') || null;
    feriasFinalEl = document.getElementById('feriasDataFinal') || document.getElementById('data-final') || null;
    feriasCancelarBtn = document.getElementById('feriasCancelarBtn') || document.getElementById('cancelarBtn') || null;
    feriasCancelarBtn?.addEventListener('click', closeFeriasModal);
    feriasForm?.addEventListener('submit', onFeriasSubmit);
}async function ensureXLSX() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Falha ao carregar biblioteca XLSX'));
        document.head.appendChild(s);
    });
}function mapColabToExportRow(c) {
    const fmt = (v) => v == null ? '' : v;
    const fmtDate = (v) => v ? formatDateLocal(String(v)) : '';
    return {
        'Nome': fmt(c.Nome),
        'DSR': fmt(c.DSR),
        'Escala': fmt(c.Escala),
        'Contrato': fmt(c.Contrato),
        'Cargo': fmt(c.Cargo),
        'ID GROOT': c['ID GROOT'] ?? '',
        'LDAP': fmt(c.LDAP),
        'SVC': fmt(c.SVC),
        'REGIAO': fmt(c.REGIAO),
        'Data de admissão': fmtDate(c['Data de admissão']),
        'Admissao KN': fmtDate(c['Admissao KN']),
        'FOLGA ESPECIAL': fmt(c['FOLGA ESPECIAL']),
        'CPF': fmt(c.CPF),
        'Data de nascimento': fmtDate(c['Data de nascimento']),
        'Gênero': fmt(c.Genero),
        'MATRIZ': fmt(c.MATRIZ),
        'Ativo': fmt(c.Ativo),
        'Férias': fmt(c.Ferias),
        'Total Presença': c['Total Presença'] ?? '',
        'Total Faltas': c['Total Faltas'] ?? '',
        'Total Atestados': c['Total Atestados'] ?? '',
        'Total Suspensões': c['Total Suspensões'] ?? ''
    };
}async function exportColaboradoresXLSX(useFiltered) {
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
}function wireEfetivarKn() {
    efetivarKnModal = document.getElementById('efetivarKnModal');
    efetivarKnForm = document.getElementById('efetivarKnForm');
    efetivarKnNomeEl = document.getElementById('efetivarKnNome');
    efetivarKnDataEl = document.getElementById('efetivarKnData');
    efetivarKnCancelarBtn = document.getElementById('efetivarKnCancelarBtn');
    efetivarKnForm?.addEventListener('submit', onEfetivarKnSubmit);
    efetivarKnCancelarBtn?.addEventListener('click', closeEfetivarKnModal);
}export function init() {
    colaboradoresTbody = document.getElementById('colaboradores-tbody');
    searchInput = document.getElementById('search-input');
    filtrosSelect = document.querySelectorAll('.filters select');
    limparFiltrosBtn = document.getElementById('limpar-filtros-btn');
    addColaboradorBtn = document.getElementById('add-colaborador-btn');
    mostrarMaisBtn = document.getElementById('mostrar-mais-btn');
    mostrarMenosBtn = document.getElementById('mostrar-menos-btn');
    contadorVisiveisEl = document.getElementById('contador-visiveis');
    addForm = document.getElementById('addForm');
    checkUserAdminStatus();
    fetchColaboradores();
    if (searchInput) searchInput.addEventListener('input', applyFiltersAndSearch);
    if (filtrosSelect && filtrosSelect.length) {
        filtrosSelect.forEach((selectEl) => {
            selectEl.addEventListener('change', (event) => {
                const filterKey = selectEl.dataset.filterKey;
                const value = event.target.value;
                if (value) state.filtrosAtivos[filterKey] = value; else delete state.filtrosAtivos[filterKey];
                applyFiltersAndSearch();
            });
        });
    }
    if (limparFiltrosBtn) {
        limparFiltrosBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (filtrosSelect && filtrosSelect.length) filtrosSelect.forEach((select) => (select.selectedIndex = 0));
            state.filtrosAtivos = {};
            state.selectedNames.clear();
            const todasAsLinhas = colaboradoresTbody.querySelectorAll('tr.selecionado');
            todasAsLinhas.forEach(linha => {
                linha.classList.remove('selecionado');
            });
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
            if (document.body.classList.contains('user-level-visitante')) return;
            await loadGestoresParaFormulario();
            loadSVCsParaFormulario();
            await populateContratoSelect(document.getElementById('addContrato'));
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
        const addDSRBtn = document.getElementById('addDSRBtn');
        if (addDSRBtn) {
            addDSRBtn.addEventListener('click', () => {
                openDsrModal(document.getElementById('addDSR'));
            });
        }
    }
    if (colaboradoresTbody) {
        colaboradoresTbody.addEventListener('click', (event) => {
            const tr = event.target.closest('tr');
            if (!tr) return;
            const nome = tr.dataset.nome;
            if (!nome) return;
            if (event.ctrlKey) {
                if (state.selectedNames.has(nome)) {
                    state.selectedNames.delete(nome);
                    tr.classList.remove('selecionado');
                } else {
                    state.selectedNames.add(nome);
                    tr.classList.add('selecionado');
                }
            } else if (event.shiftKey) {
                event.preventDefault();
                const todasAsLinhasVisiveis = colaboradoresTbody.querySelectorAll('tr');
                todasAsLinhasVisiveis.forEach(linha => {
                    const nomeDaLinha = linha.dataset.nome;
                    if (nomeDaLinha) {
                        state.selectedNames.add(nomeDaLinha);
                        linha.classList.add('selecionado');
                    }
                });
            } else {
                if (document.body.classList.contains('user-level-visitante')) return;
                document.dispatchEvent(new CustomEvent('open-edit-modal', {detail: {nome}}));
            }
        });
        document.addEventListener('colaborador-edited', async (e) => {            if (document.querySelector('[data-page="colaboradores"].active')) {
                await fetchColaboradores();
            } else {
                invalidateColaboradoresCache();
            }
        });
        document.addEventListener('colaborador-deleted', async (e) => {            if (document.querySelector('[data-page="colaboradores"].active')) {
                await fetchColaboradores();
            } else {
                invalidateColaboradoresCache();
            }
        });
        document.addEventListener('colaborador-added', async (e) => {            if (document.querySelector('[data-page="colaboradores"].active')) {
                await fetchColaboradores();
            } else {
                invalidateColaboradoresCache();
            }
        });    }
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
    const gerarQRBtn = document.getElementById('gerar-qr-btn');
    if (gerarQRBtn) {
        gerarQRBtn.addEventListener('click', gerarJanelaDeQRCodes);
    }
    wireEdit();
    wireDesligar();
    wireFerias();
    wireEfetivarKn();
    wireDsrModal();
}export function destroy() {  cachedColaboradores = null;
  cachedFeriasStatus = null;
  lastFetchTimestamp = 0;  try { state.gestoresData = []; } catch {}
  try { state.matrizesData = []; } catch {}  try { state.serviceMatrizMap?.clear?.(); } catch {}
  try { state.serviceRegiaoMap?.clear?.(); } catch {}
  try { state.matrizRegiaoMap?.clear?.(); } catch {}
  try { state.selectedNames?.clear?.(); } catch {}
  try { state.feriasAtivasMap?.clear?.(); } catch {}  console.log("Cache de colaboradores destruído ao sair do módulo.");
}
