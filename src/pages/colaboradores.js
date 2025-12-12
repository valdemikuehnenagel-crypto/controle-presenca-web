import {supabase} from '../supabaseClient.js';
import {getMatrizesPermitidas} from '../session.js';
import {logAction} from '../../logAction.js';
import {openFeriasModal, processarStatusFerias, setOnFeriasChangeCallback, wireFerias} from './ferias.js';let state = {
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
    matrizGerenciaMap: new Map(),
    matrizesData: [],
    feriasAtivasMap: new Map()
};
let rhState = {
    dadosBrutos: [],
    nomesExistentes: new Set(),
    filtros: {
        termo: '',
        matriz: '',
        cargo: ''
    },
    activeTab: 'ATUAIS',
    somenteParaFechar: false
};
let cachedColaboradores = null;
let cachedFeriasStatus = null;
let lastFetchTimestamp = 0;
const CACHE_DURATION_MS = 5 * 60 * 1000;
const ITENS_POR_PAGINA = 200;
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
let fluxoEfetivacaoModal, fluxoEfetivacaoForm, fluxoEfetivacaoNomeEl,
    fluxoNumeroEl, fluxoDataAberturaEl, fluxoObservacaoEl, fluxoAdmissaoKnEl,
    fluxoGerarBtn, fluxoFinalizarBtn, fluxoCancelarBtn, fluxoSairBtn;
let editInputs = {};
let editOriginal = null;
let desligarModal, desligarForm, desligarNomeEl, desligarDataEl, desligarMotivoEl, desligarSmartoffEl,
    desligarSmartoffContainer, desligarCancelarBtn, desligarConfirmarBtn;
let desligarColaborador = null;
let feriasModal, feriasForm, feriasNomeEl, feriasInicioEl, feriasFinalEl, feriasCancelarBtn;
let feriasColaborador = null;
let isSubmittingFerias = false;
let isSubmittingEdit = false;
let dsrModal, dsrCheckboxesContainer, dsrOkBtn, dsrCancelarBtn;
let dropdownAdd, btnAdicionarManual, btnImportarRH;
let modalListaRH, tbodyCandidatosRH, fecharModalRH;
let currentDsrInputTarget = null;
let histContextMenu = null;
let selectedMonthIndex = null;
const DIAS_DA_SEMANA = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];function invalidateColaboradoresCache() {
    cachedColaboradores = null;
    cachedFeriasStatus = null;
    lastFetchTimestamp = 0;
    try {
        localStorage.removeItem('knc:colaboradoresCache');
    } catch (e) {
        console.warn('Falha ao invalidar cache compartilhado', e);
    }
    console.log("Cache de colaboradores e férias invalidado.");
}async function ensureMatrizesDataLoaded() {
    if (state.matrizesData.length > 0) return;
    try {
        const {data, error} = await supabase
            .from('Matrizes')
            .select('SERVICE, MATRIZ, REGIAO, GERENCIA');
        if (error) throw error;
        state.matrizesData = data || [];
        state.serviceMatrizMap = new Map();
        state.serviceRegiaoMap = new Map();
        state.matrizRegiaoMap = new Map();
        state.matrizGerenciaMap = new Map();
        state.matrizesData.forEach(item => {
            const svc = String(item.SERVICE || '').toUpperCase().trim();
            const mtz = String(item.MATRIZ || '').toUpperCase().trim();
            const reg = String(item.REGIAO || '').toUpperCase().trim();
            const ger = String(item.GERENCIA || '').toUpperCase().trim();
            if (svc) {
                state.serviceMatrizMap.set(svc, mtz);
                state.serviceRegiaoMap.set(svc, reg);
            }
            if (mtz) {
                state.matrizRegiaoMap.set(mtz, reg);
                if (ger) state.matrizGerenciaMap.set(mtz, ger);
            }
        });
    } catch (e) {
        console.error('Erro ao carregar dados de Matrizes/Gerência:', e);
    }
}function mapearDadosRhParaFormulario(candidato) {
    let contratoFormatado = (candidato.EmpresaContratante || '').toUpperCase();
    if (contratoFormatado.includes('AST')) contratoFormatado = 'AST';
    else if (contratoFormatado.includes('ADECCO')) contratoFormatado = 'ADECCO';
    else if (contratoFormatado.includes('LUANDRE')) contratoFormatado = 'LUANDRE';
    else if (contratoFormatado.includes('POLLY')) contratoFormatado = 'POLLY';
    else if (contratoFormatado.includes('TSI')) contratoFormatado = 'TSI';
    else if (contratoFormatado.includes('GNX')) contratoFormatado = 'GNX';
    let cargoFormatado = (candidato.Cargo || '').toUpperCase();
    if (cargoFormatado.includes('AUXILIAR')) cargoFormatado = 'AUXILIAR';
    else if (cargoFormatado.includes('ASSISTENTE')) cargoFormatado = 'ASSISTENTE';
    else if (cargoFormatado.includes('LÍDER') || cargoFormatado.includes('LIDER')) cargoFormatado = 'LIDER';
    else if (cargoFormatado.includes('CONFERENTE')) cargoFormatado = 'CONFERENTE';
    return {
        Nome: candidato.CandidatoAprovado,
        CPF: candidato.CPFCandidato,
        Cargo: cargoFormatado,
        Contrato: contratoFormatado,
        MATRIZ: candidato.MATRIZ, DataInicio: candidato.DataAdmissaoReal || candidato.DataInicioDesejado,
        rg: candidato.rg,
        telefone: candidato.telefone,
        email: candidato.email,
        pis: candidato.pis,
        endereco_completo: candidato.endereco_completo,
        numero: candidato.numero,
        bairro: candidato.bairro,
        cidade: candidato.cidade,
        colete: candidato.colete,
        sapato: candidato.sapato,
        DataNascimento: candidato.DataNascimento
    };
}function injectFluxoStyles() {
    const styleId = 'fluxo-modal-style-fix';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        #fluxoEfetivacaoModal > div {
            max-width: 450px !important; /* Deixa a janela mais estreita */
            width: 95% !important;
            margin: auto;
        }
        .swal-custom-list {
            text-align: left;
            font-size: 14px;
            margin-top: 10px;
            background: #f9fafb;
            padding: 10px;
            border-radius: 6px;
            border: 1px solid #e5e7eb;
        }
        .swal-custom-list li {
            margin-bottom: 4px;
        }
    `;
    document.head.appendChild(style);
}function promptSelectContratoReversao() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 z-[30000] flex items-center justify-center p-4 backdrop-blur-sm';
        overlay.innerHTML = `
            <div class="bg-white rounded-lg shadow-2xl w-full max-w-sm p-6 animate-scaleIn">
                <h3 class="text-lg font-bold text-[#003369] mb-2">Reverter para Consultoria</h3>
                <p class="text-sm text-gray-600 mb-4">Deseja voltar o colaborador para Consultoria? Selecione o contrato original:</p>                <select id="revertContractSelect" class="w-full border border-gray-300 rounded p-2 mb-6 text-sm focus:border-blue-500 outline-none">
                    <option value="ADECCO">ADECCO</option>
                    <option value="AST">AST</option>
                    <option value="GNX">GNX</option>
                    <option value="LUANDRE">LUANDRE</option>
                    <option value="POLLY">POLLY</option>
                    <option value="TSI">TSI</option>
                </select>                <div class="flex justify-end gap-2">
                    <button id="btnCancelRevert" class="px-4 py-2 rounded text-gray-600 hover:bg-gray-100 text-sm font-medium">Cancelar</button>
                    <button id="btnConfirmRevert" class="px-4 py-2 rounded bg-[#003369] text-white hover:bg-[#002244] text-sm font-bold shadow-md">Confirmar Reversão</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = (val) => {
            overlay.remove();
            resolve(val);
        };
        document.getElementById('btnCancelRevert').onclick = () => close(null);
        document.getElementById('btnConfirmRevert').onclick = () => {
            const selected = document.getElementById('revertContractSelect').value;
            close(selected);
        };
    });
}function injectRhTabsStyles() {
    const styleId = 'rh-tabs-style';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        /* Removemos a borda inferior do container para ficar limpo na barra */
        .rh-tabs-container { 
            display: flex; 
            gap: 0; 
            padding-right: 15px; /* Espaço entre abas e o busca */
        }
        .rh-tab-btn {
            background: transparent; 
            border: none; 
            padding: 8px 12px;
            font-size: 13px; 
            font-weight: 600; 
            color: #6b7280;
            cursor: pointer; 
            border-bottom: 2px solid transparent; 
            transition: all 0.2s;
            white-space: nowrap; /* Impede quebra de texto */
        }
        .rh-tab-btn:hover { color: #003369; background: #f9fafb; border-radius: 4px 4px 0 0; }
        .rh-tab-btn.active { color: #003369; border-bottom: 2px solid #003369; font-weight: 800; }
    `;
    document.head.appendChild(style);
}function ensureHistContextMenu() {
    if (document.getElementById('hist-context-menu')) return;
    const menu = document.createElement('div');
    menu.id = 'hist-context-menu';
    menu.className = 'hidden';
    menu.innerHTML = `
        <button id="btn-export-month-xlsx">
            <span class="icon-excel">📊</span> Exportar este Mês (XLSX)
        </button>
    `;
    document.body.appendChild(menu);
    histContextMenu = menu;
    const btn = document.getElementById('btn-export-month-xlsx');
    btn.addEventListener('click', () => {
        if (selectedMonthIndex !== null) {
            exportHistoricoMesXLSX(selectedMonthIndex);
        }
        hideHistContextMenu();
    });
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) {
            hideHistContextMenu();
        }
    });
    window.addEventListener('scroll', hideHistContextMenu, true);
}function showHistContextMenu(x, y, monthIndex) {
    ensureHistContextMenu();
    selectedMonthIndex = monthIndex;
    if (histContextMenu) {
        histContextMenu.style.left = `${x}px`;
        histContextMenu.style.top = `${y}px`;
        histContextMenu.classList.remove('hidden');
    }
}function hideHistContextMenu() {
    if (histContextMenu) {
        histContextMenu.classList.add('hidden');
    }
}function populateOptionsTamanhos(idSelectSapato, idSelectColete) {
    const selSapato = document.getElementById(idSelectSapato);
    const selColete = document.getElementById(idSelectColete);
    if (selSapato) {
        const valorAtual = selSapato.value;
        selSapato.innerHTML = '<option value="">Selecione...</option>';
        for (let i = 34; i <= 46; i++) {
            const opt = document.createElement('option');
            opt.value = i.toString();
            opt.textContent = i.toString();
            selSapato.appendChild(opt);
        }
        if (valorAtual) selSapato.value = valorAtual;
    }
    if (selColete) {
        const valorAtual = selColete.value;
        const tamanhos = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'];
        selColete.innerHTML = '<option value="">Selecione...</option>';
        tamanhos.forEach(tam => {
            const opt = document.createElement('option');
            opt.value = tam;
            opt.textContent = tam;
            selColete.appendChild(opt);
        });
        if (valorAtual) selColete.value = valorAtual;
    }
}async function fetchCandidatosAprovados() {
    if (!tbodyCandidatosRH) return;
    tbodyCandidatosRH.innerHTML = '<tr><td colspan="8" class="p-4 text-center">Carregando dados do RH...</td></tr>';
    try {
        const matrizesPermitidas = getMatrizesPermitidas();
        let queryVagas = supabase
            .from('Vagas')
            .select('ID_Vaga, CandidatoAprovado, CPFCandidato, Cargo, EmpresaContratante, MATRIZ, Gestor, DataInicioDesejado, DataAdmissaoReal, DataEncaminhadoAdmissao, DataAprovacao, rg, telefone, email, pis, endereco_completo, numero, bairro, cidade, colete, sapato, DataNascimento')
            .eq('Status', 'EM ADMISSÃO')
            .or('Cargo.ilike.%CONFERENTE%,Cargo.ilike.%AUXILIAR DE OPERAÇÕES%');
        if (matrizesPermitidas !== null) {
            queryVagas = queryVagas.in('MATRIZ', matrizesPermitidas);
        }
        const queryColabsBuilder = supabase
            .from('Colaboradores')
            .select('Nome')
            .neq('Ativo', 'NÃO');
        const [resVagas, todosNomesData] = await Promise.all([queryVagas.order('DataInicioDesejado', {ascending: true}),
            fetchAllWithPagination(queryColabsBuilder)
        ]);
        if (resVagas.error) throw resVagas.error;
        rhState.dadosBrutos = resVagas.data || [];
        rhState.nomesExistentes = new Set(
            (todosNomesData || []).map(c => {
                return (c.Nome || '')
                    .toUpperCase()
                    .trim()
                    .replace(/\s+/g, ' ');
            })
        );
        setupRhFilters();
        populateRhFilterOptions();
        aplicarFiltrosRh();
    } catch (err) {
        console.error('Erro RH:', err);
        tbodyCandidatosRH.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-red-600">Erro ao carregar ou filtrar dados.</td></tr>';
    }
}function setupRhFilters() {
    injectRhTabsStyles();
    const inputSearch = document.getElementById('filterRhSearch');
    const selectMatriz = document.getElementById('filterRhMatriz');
    const selectCargo = document.getElementById('filterRhCargo');
    const oldBtnDate = document.getElementById('btnToggleFutureDates');
    if (oldBtnDate) oldBtnDate.style.display = 'none';
    const oldBtnClose = document.getElementById('btnToggleParaFechar');
    if (oldBtnClose) oldBtnClose.style.display = 'none';
    const filterContainer = inputSearch?.closest('.flex-wrap') || inputSearch?.parentElement;
    if (filterContainer && !document.getElementById('rh-tabs-container')) {
        const tabsDiv = document.createElement('div');
        tabsDiv.id = 'rh-tabs-container';
        tabsDiv.className = 'rh-tabs-container';
        tabsDiv.style.cssText = "display: flex; gap: 4px; align-items: center; margin-right: auto;";
        tabsDiv.innerHTML = `
            <button type="button" class="rh-tab-btn active" data-tab="ATUAIS">🔥 Vagas Atuais</button>
            <button type="button" class="rh-tab-btn" data-tab="FUTURAS">🚀 Vagas Futuras</button>
            <button type="button" class="rh-tab-btn" data-tab="PARA_FECHAR">🔒 Vagas p/ Fechar</button>
        `;
        filterContainer.insertBefore(tabsDiv, filterContainer.firstChild);
        tabsDiv.querySelectorAll('.rh-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                tabsDiv.querySelectorAll('.rh-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                rhState.activeTab = btn.dataset.tab;
                aplicarFiltrosRh();
            });
        });
    }
    if (inputSearch) inputSearch.oninput = (e) => {
        rhState.filtros.termo = e.target.value.toUpperCase();
        aplicarFiltrosRh();
    };
    if (selectMatriz) selectMatriz.onchange = (e) => {
        rhState.filtros.matriz = e.target.value;
        aplicarFiltrosRh();
    };
    if (selectCargo) selectCargo.onchange = (e) => {
        rhState.filtros.cargo = e.target.value;
        aplicarFiltrosRh();
    };
}function populateRhFilterOptions() {
    const selMatriz = document.getElementById('filterRhMatriz');
    const selCargo = document.getElementById('filterRhCargo');
    if (!selMatriz || !selCargo) return;
    const valMatriz = selMatriz.value;
    const valCargo = selCargo.value;
    const matrizes = [...new Set(rhState.dadosBrutos.map(i => i.MATRIZ).filter(Boolean))].sort();
    const cargos = [...new Set(rhState.dadosBrutos.map(i => i.Cargo).filter(Boolean))].sort();
    selMatriz.innerHTML = '<option value="">Todas</option>';
    matrizes.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        selMatriz.appendChild(opt);
    });
    selCargo.innerHTML = '<option value="">Todos</option>';
    cargos.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = typeof formatCargoShort === 'function' ? formatCargoShort(c) : c;
        selCargo.appendChild(opt);
    });
    if (matrizes.includes(valMatriz)) selMatriz.value = valMatriz;
    if (cargos.includes(valCargo)) selCargo.value = valCargo;
}async function buscarEnderecoPorCep(cep, prefixoId) {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) {
        return;
    }
    const campoEndereco = document.getElementById(`${prefixoId}Endereco`);
    const campoBairro = document.getElementById(`${prefixoId}Bairro`);
    const campoCidade = document.getElementById(`${prefixoId}Cidade`);
    const campoNumero = document.getElementById(`${prefixoId}Numero`);
    if (campoEndereco) campoEndereco.placeholder = "Buscando CEP...";
    try {
        const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
        const data = await response.json();
        if (data.erro) {
            await window.customAlert('CEP não encontrado.', 'Erro');
            if (campoEndereco) campoEndereco.placeholder = "";
            return;
        }
        if (campoEndereco) {
            campoEndereco.value = (data.logradouro || '').toUpperCase();
            campoEndereco.dispatchEvent(new Event('input'));
        }
        if (campoBairro) {
            campoBairro.value = (data.bairro || '').toUpperCase();
            campoBairro.dispatchEvent(new Event('input'));
        }
        if (campoCidade) {
            campoCidade.value = (data.localidade || '').toUpperCase();
            campoCidade.dispatchEvent(new Event('input'));
        }
        if (campoNumero) {
            campoNumero.focus();
        }
    } catch (error) {
        console.error("Erro ao buscar CEP:", error);
        await window.customAlert('Erro ao buscar o endereço. Verifique sua conexão.', 'Erro de Rede');
    } finally {
        if (campoEndereco) campoEndereco.placeholder = "";
    }
}function wireCepEvents() {
    const addCepInput = document.getElementById('addCEP');
    if (addCepInput) {
        addCepInput.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length > 5) {
                val = val.substring(0, 5) + '-' + val.substring(5, 8);
            }
            e.target.value = val;
            const numeros = val.replace(/\D/g, '');
            if (numeros.length === 8) {
                buscarEnderecoPorCep(numeros, 'add');
            }
        });
    }
}function aplicarFiltrosRh() {
    const hoje = new Date().toISOString().split('T')[0];
    const badge = document.getElementById('countRhBadges');
    const filtrados = rhState.dadosBrutos.filter(item => {
        const termo = (rhState.filtros.termo || '').toUpperCase().trim();
        if (termo) {
            const nomeC = (item.CandidatoAprovado || '').toUpperCase();
            const cpfC = (item.CPFCandidato || '').toUpperCase();
            if (!nomeC.includes(termo) && !cpfC.includes(termo)) return false;
        }
        if (rhState.filtros.matriz && item.MATRIZ !== rhState.filtros.matriz) return false;
        if (rhState.filtros.cargo && item.Cargo !== rhState.filtros.cargo) return false;
        const dataInicio = item.DataInicioDesejado || '1900-01-01';
        const isFuture = dataInicio > hoje;
        const nomeNorm = (item.CandidatoAprovado || '').toUpperCase().trim();
        const jaExiste = rhState.nomesExistentes.has(nomeNorm);
        if (rhState.activeTab === 'PARA_FECHAR') {
            if (!jaExiste) return false;
        } else if (rhState.activeTab === 'FUTURAS') {
            if (!isFuture) return false;
        } else {
            if (isFuture) return false;
        }
        return true;
    });
    if (badge) badge.textContent = filtrados.length;
    renderTabelaRH(filtrados);
}function formatCargoShort(cargo) {
    if (!cargo) return '';
    let s = cargo.toUpperCase();
    s = s.replace('AUXILIAR DE OPERAÇÕES LOGÍSTICAS', 'Aux. Op. Log.');
    s = s.replace('AUXILIAR DE OPERAÇÕES', 'Aux. Op.');
    s = s.replace('LÍDER DE OPERAÇÕES LOGÍSTICAS', 'Líder Op. Log.');
    s = s.replace('LIDER DE OPERAÇÕES LOGÍSTICAS', 'Líder Op. Log.');
    s = s.replace('COORDENADOR DE OPERAÇÕES', 'Coord. Op.');
    s = s.replace('SUPERVISOR DE OPERAÇÕES', 'Sup. Op.');
    s = s.replace('ASSISTENTE ADMINISTRATIVO', 'Assist. Adm.');
    s = s.replace('OPERADOR DE EMPILHADEIRA', 'Op. Empilhadeira');
    s = s.replace('CONFERENTE', 'Conferente');
    return s;
}async function showAvisoDesligamento() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[20000]';
        overlay.innerHTML = `
            <div class="bg-white rounded-lg shadow-2xl max-w-lg w-full p-6 animate-scaleIn">
                <div class="flex items-center gap-3 mb-4 text-amber-600">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h3 class="text-xl font-bold text-[#003369]">Atenção ao Desligamento</h3>
                </div>            <div class="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 text-sm text-gray-700 leading-relaxed">
                    <p class="font-bold mb-2">As solicitações de desligamento devem ser enviadas com 48 horas úteis de antecedência.</p>
                    <p class="mb-2">Antes de finalizar, revise os dados de ponto para evitar descontos indevidos na rescisão.</p>
                    <p>Sempre que possível, priorize a realização de desligamentos voluntários entre <span class="font-bold">segunda e quinta-feira</span>.</p>
                </div>            <div class="flex justify-end gap-3 pt-2 border-t border-gray-100">
                    <button id="avisoCancelBtn" class="px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 font-semibold hover:bg-gray-50 transition-colors">
                        Cancelar
                    </button>
                    <button id="avisoContinueBtn" class="px-4 py-2 bg-[#003369] text-white rounded-md font-semibold hover:bg-[#002244] shadow-md transition-colors">
                        Continuar
                    </button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = (result) => {
            overlay.remove();
            resolve(result);
        };
        overlay.querySelector('#avisoCancelBtn').addEventListener('click', () => close(false));
        overlay.querySelector('#avisoContinueBtn').addEventListener('click', () => close(true));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(false);
        });
    });
}function getLocalISOString(date) {
    if (!(date instanceof Date)) {
        date = new Date(date);
    }
    if (isNaN(date.getTime())) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    const offsetMin = date.getTimezoneOffset();
    const sign = offsetMin > 0 ? '-' : '+';
    const absMin = Math.abs(offsetMin);
    const offHour = pad(Math.floor(absMin / 60));
    const offMin = pad(absMin % 60);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${offHour}:${offMin}`;
}function formatDateTimeLocal(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch (e) {
        return iso;
    }
}async function verificarPendencias(colab, dataDesligamentoStr) {
    const pendencias = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const trintaDiasAtras = new Date(hoje);
    trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
    let dataLimite = new Date(hoje);
    dataLimite.setDate(dataLimite.getDate() - 1);
    if (dataDesligamentoStr) {
        const dtDesligamento = new Date(dataDesligamentoStr);
        if (!isNaN(dtDesligamento.getTime())) {
            dtDesligamento.setHours(0, 0, 0, 0);
            if (dtDesligamento < dataLimite) {
                dataLimite = dtDesligamento;
            }
        }
    }
    let inicioVerificacao = new Date(trintaDiasAtras);
    if (colab['Data de admissão']) {
        const parts = colab['Data de admissão'].split('-');
        const dtAdm = new Date(parts[0], parts[1] - 1, parts[2]);
        dtAdm.setHours(0, 0, 0, 0);
        if (dtAdm > inicioVerificacao) {
            inicioVerificacao = dtAdm;
        }
        if (dtAdm > dataLimite) {
            return [];
        }
    }
    if (dataLimite < inicioVerificacao) return [];
    const startISO = inicioVerificacao.toISOString().split('T')[0];
    const endISO = dataLimite.toISOString().split('T')[0];
    const {data: registros, error} = await supabase
        .from('ControleDiario')
        .select('Data, Presença, Falta, Atestado, "Folga Especial", Suspensao, Feriado')
        .eq('Nome', colab.Nome)
        .gte('Data', startISO)
        .lte('Data', endISO);
    if (error) {
        console.error('Erro ao verificar pendências:', error);
        return [];
    }
    const datasPreenchidas = new Set();
    (registros || []).forEach(r => {
        const hasMarcacao =
            r['Presença'] === 1 || r['Presença'] === true ||
            r['Falta'] === 1 || r['Falta'] === true ||
            r['Atestado'] === 1 || r['Atestado'] === true ||
            r['Folga Especial'] === 1 || r['Folga Especial'] === true ||
            r['Suspensao'] === 1 || r['Suspensao'] === true ||
            r['Feriado'] === 1 || r['Feriado'] === true;
        if (hasMarcacao) {
            datasPreenchidas.add(r.Data);
        }
    });
    const {data: ferias} = await supabase
        .from('Ferias')
        .select('"Data Inicio", "Data Final"')
        .eq('Nome', colab.Nome)
        .or(`"Data Final".gte.${startISO},"Data Inicio".lte.${endISO}`);
    const {data: afastamentos} = await supabase
        .from('Afastamentos')
        .select('"DATA INICIO", "DATA RETORNO"')
        .eq('NOME', colab.Nome)
        .or(`"DATA RETORNO".gte.${startISO},"DATA INICIO".lte.${endISO},"DATA RETORNO".is.null`);
    const isAusenciaLegitima = (dateStr) => {
        if (ferias) {
            for (const f of ferias) {
                if (dateStr >= f['Data Inicio'] && dateStr <= f['Data Final']) return true;
            }
        }
        if (afastamentos) {
            for (const a of afastamentos) {
                const dtRetorno = a['DATA RETORNO'] || '2099-12-31';
                if (dateStr >= a['DATA INICIO'] && dateStr < dtRetorno) return true;
            }
        }
        return false;
    };
    const cursor = new Date(inicioVerificacao);
    cursor.setHours(0, 0, 0, 0);
    const limiteComparacao = new Date(dataLimite);
    limiteComparacao.setHours(0, 0, 0, 0);
    const dsrString = (colab.DSR || '').toUpperCase();
    while (cursor <= limiteComparacao) {
        const y = cursor.getFullYear();
        const m = String(cursor.getMonth() + 1).padStart(2, '0');
        const d = String(cursor.getDate()).padStart(2, '0');
        const diaISO = `${y}-${m}-${d}`;
        const diaSemana = DIAS_DA_SEMANA[cursor.getDay()];
        let cobrar = true;
        if (dsrString.includes(diaSemana) || (diaSemana === 'DOMINGO' && dsrString === '')) {
            cobrar = false;
        }
        if (cobrar && isAusenciaLegitima(diaISO)) {
            cobrar = false;
        }
        if (cobrar && !datasPreenchidas.has(diaISO)) {
            pendencias.push(formatDateLocal(diaISO));
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return pendencias;
}function renderTabelaRH(lista) {
    tbodyCandidatosRH.innerHTML = '';
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    lista.forEach(cand => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-blue-50 transition-colors border-b border-gray-100 group cursor-pointer";
        const nomeNormalizado = (cand.CandidatoAprovado || '').toUpperCase().trim().replace(/\s+/g, ' ');
        const jaExiste = rhState.nomesExistentes && rhState.nomesExistentes.has(nomeNormalizado);
        const nomeClass = jaExiste ? 'text-green-600 font-extrabold' : 'text-[#003369] font-bold';
        const iconCheck = jaExiste ? '<span style="color:green; margin-left:4px;">✔ (Cadastrado)</span>' : '';
        const btnFecharStyle = jaExiste
            ? 'background-color: #dcfce7; color: #166534; border: 1px solid #86efac; cursor: pointer;'
            : 'background-color: #f3f4f6; color: #9ca3af; border: 1px solid #e5e7eb; cursor: not-allowed; opacity: 0.7;';
        const btnFecharTitle = jaExiste
            ? "Colaborador já cadastrado! Clique para fechar a vaga."
            : "Ação bloqueada: Colaborador ainda não consta na base ativa.";
        const rawInicio = cand.DataAdmissaoReal || cand.DataInicioDesejado;
        const dtInicio = rawInicio ? formatDateLocal(rawInicio) : '-';
        const cpf = cand.CPFCandidato || '-';
        const cargoCurto = typeof formatCargoShort === 'function' ? formatCargoShort(cand.Cargo) : cand.Cargo;
        const dataRefStr = cand.DataAdmissaoReal || cand.DataInicioDesejado;
        let slaHtml = '<span class="text-gray-300">-</span>';
        if (dataRefStr) {
            const dataRef = new Date(dataRefStr);
            dataRef.setHours(0, 0, 0, 0);
            const diffTime = hoje - dataRef;
            const slaDias = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            let slaClass = "";
            let slaTexto = "";
            if (slaDias > 0) {
                if (slaDias > 3) slaClass = "bg-red-50 text-red-700 border-red-200";
                else slaClass = "bg-yellow-50 text-yellow-700 border-yellow-200";
                slaTexto = `+${slaDias}d`;
            } else if (slaDias === 0) {
                slaClass = "bg-blue-50 text-blue-700 border-blue-200";
                slaTexto = "HOJE";
            } else {
                slaClass = "bg-green-50 text-green-700 border-green-200";
                slaTexto = `${slaDias}d`;
            }
            slaHtml = `<span class="px-1.5 py-0.5 rounded border text-[10px] font-bold ${slaClass}">${slaTexto}</span>`;
        }
        tr.innerHTML = `
            <td class="p-2 ${nomeClass} leading-tight">
                ${cand.CandidatoAprovado || 'Sem Nome'} ${iconCheck}
            </td>
            <td class="p-2 text-gray-500 text-[11px]">
                ${cpf}
            </td>
            <td class="p-2 text-gray-700 font-medium text-[11px]" title="${cand.Cargo}">
                ${cargoCurto}
            </td>
            <td class="p-2 text-gray-600 text-[11px]">
                ${cand.MATRIZ || ''}
            </td>
            <td class="p-2 text-gray-600 text-[11px]">
                ${cand.Gestor || '-'}
            </td>
            <td class="p-2 text-gray-700 text-center font-semibold text-[11px]">
                ${dtInicio}
            </td>
            <td class="p-2 text-center">
                ${slaHtml}
            </td>
            <td class="p-2 text-center">
                <div class="flex items-center justify-center gap-1">
                    <button class="btn-fechar-vaga text-[10px] font-bold px-2 py-1 rounded transition-all shadow-sm"
                            style="${btnFecharStyle}"
                            title="${btnFecharTitle}">
                        Fechar Vaga
                    </button>
                    <button class="btn-noshow bg-white border border-purple-200 text-purple-600 hover:bg-purple-50 hover:text-purple-800 hover:border-purple-300 text-[10px] font-bold px-2 py-1 rounded transition-all shadow-sm"
                            title="Registrar não comparecimento">
                        NoShow
                    </button>
                    <button class="btn-desistencia bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:text-red-700 hover:border-red-300 text-[10px] font-bold px-2 py-1 rounded transition-all shadow-sm"
                            title="Cancelar vaga por desistência">
                        Desist.
                    </button>
                </div>
            </td>
        `;
        tr.addEventListener('dblclick', async (e) => {
            if (e.target.closest('button')) return;
            if (jaExiste) {
                await window.customAlert(
                    `O colaborador <b>${cand.CandidatoAprovado}</b> já consta na base de ativos.<br><br>Não é possível importar novamente. Por favor, clique no botão <b>"Fechar Vaga"</b> para encerrar o processo no RH.`,
                    'Ação Bloqueada',
                    'warning'
                );
                return;
            }
            selecionarCandidatoImportacao(cand);
        });
        const btnFechar = tr.querySelector('.btn-fechar-vaga');
        btnFechar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!jaExiste) {
                return;
            }
            fecharVagaImportacao(cand);
        });
        const btnDesistencia = tr.querySelector('.btn-desistencia');
        btnDesistencia.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmarDesistenciaVaga(cand);
        });
        const btnNoShow = tr.querySelector('.btn-noshow');
        btnNoShow.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmarNoShowVaga(cand);
        });
        tbodyCandidatosRH.appendChild(tr);
    });
}async function fecharVagaImportacao(vaga) {
    const nome = vaga.CandidatoAprovado || 'Candidato';
    const confirmacao = await window.customConfirm(
        `Deseja marcar a vaga de <b>${nome}</b> como <span style="color:green">FECHADA</span>?<br><br>Isso removerá o candidato desta lista de importação.`,
        'Fechar Vaga',
        'success'
    );
    if (!confirmacao) return;
    if (tbodyCandidatosRH) tbodyCandidatosRH.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-gray-500">Atualizando status...</td></tr>';
    try {
        const {error} = await supabase
            .from('Vagas')
            .update({
                Status: 'FECHADA'
            })
            .eq('ID_Vaga', vaga.ID_Vaga);
        if (error) throw error;
        await window.customAlert('Vaga fechada com sucesso!', 'Sucesso');
        logAction(`Fechou vaga (via Importação RH): ${nome} (Vaga #${vaga.ID_Vaga})`);
        await fetchCandidatosAprovados();
        if (typeof checkPendingImports === 'function') checkPendingImports();
    } catch (err) {
        console.error('Erro ao fechar vaga:', err);
        await window.customAlert('Erro ao fechar vaga: ' + err.message, 'Erro');
        fetchCandidatosAprovados();
    }
}async function confirmarDesistenciaVaga(vaga) {
    const nome = vaga.CandidatoAprovado || 'Candidato';
    const confirmacao = confirm(`Confirmar DESISTÊNCIA de:\n\n${nome}?\n\nA vaga será cancelada.`);
    if (!confirmacao) return;
    if (tbodyCandidatosRH) tbodyCandidatosRH.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-gray-500">Processando...</td></tr>';
    try {
        const {error} = await supabase
            .from('Vagas')
            .update({
                Status: 'CANCELADA',
                Motivo: 'DESISTENCIA DO CANDIDATO (Via Importação RH)'
            })
            .eq('ID_Vaga', vaga.ID_Vaga);
        if (error) throw error;
        alert('Desistência registrada com sucesso.');
        logAction(`Registrou desistência do candidato: ${nome} (Vaga #${vaga.ID_Vaga})`);
        await fetchCandidatosAprovados();
        if (typeof checkPendingImports === 'function') checkPendingImports();
    } catch (err) {
        console.error('Erro ao cancelar vaga:', err);
        alert('Erro ao registrar desistência: ' + err.message);
        fetchCandidatosAprovados();
    }
}async function confirmarNoShowVaga(vaga) {
    const nome = vaga.CandidatoAprovado || 'Candidato';
    const confirmacao = confirm(`Confirmar NO SHOW (Não Comparecimento) de:\n\n${nome}?\n\nA vaga será cancelada com motivo 'NO SHOW'.`);
    if (!confirmacao) return;
    if (tbodyCandidatosRH) tbodyCandidatosRH.innerHTML = '<tr><td colspan="8" class="p-4 text-center text-gray-500">Processando NoShow...</td></tr>';
    try {
        const {error} = await supabase
            .from('Vagas')
            .update({
                Status: 'CANCELADA',
                Motivo: 'NO SHOW (Colaborador não compareceu)'
            })
            .eq('ID_Vaga', vaga.ID_Vaga);
        if (error) throw error;
        alert('No Show registrado com sucesso.');
        logAction(`Registrou NO SHOW do candidato: ${nome} (Vaga #${vaga.ID_Vaga})`);
        await fetchCandidatosAprovados();
        if (typeof checkPendingImports === 'function') checkPendingImports();
    } catch (err) {
        console.error('Erro ao registrar No Show:', err);
        alert('Erro ao registrar No Show: ' + err.message);
        fetchCandidatosAprovados();
    }
}async function selecionarCandidatoImportacao(candidatoRaw) {
    const dadosMapeados = mapearDadosRhParaFormulario(candidatoRaw);
    modalListaRH.classList.add('hidden');
    await prepararFormularioAdicao();
    document.dispatchEvent(new CustomEvent('open-add-modal'));
    setTimeout(() => {
        preencherFormularioAdicao(dadosMapeados);
    }, 100);
}async function prepararFormularioAdicao() {
    await loadGestoresParaFormulario();
    loadSVCsParaFormulario();
    await populateContratoSelect(document.getElementById('addContrato'));
    populateOptionsTamanhos('addSapato', 'addColete');
    populateGestorSelect(null);
    attachUppercaseHandlers();
}function preencherFormularioAdicao(dados) {
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };
    if (Object.keys(dados).length === 0) {
        if (addForm) addForm.reset();
        return;
    }
    setVal('addNome', dados.Nome);
    setVal('addCPF', dados.CPF);
    setVal('addCargo', dados.Cargo);
    setVal('addContrato', dados.Contrato);
    setVal('addMatriz', dados.MATRIZ);
    setVal('addRG', dados.rg);
    setVal('addPIS', dados.pis);
    setVal('addTelefone', dados.telefone);
    setVal('addEmail', dados.email);
    setVal('addEndereco', dados.endereco_completo);
    setVal('addNumero', dados.numero);
    setVal('addBairro', dados.bairro);
    setVal('addCidade', dados.cidade);
    setVal('addColete', dados.colete);
    setVal('addSapato', dados.sapato);
    if (dados.DataInicio) {
        setVal('addDataAdmissao', dados.DataInicio);
    }
    if (dados.DataNascimento) {
        setVal('addDataNascimento', dados.DataNascimento);
    }
    if (dados.MATRIZ && state.matrizesData) {
        const matrizItem = state.matrizesData.find(m => m.MATRIZ === dados.MATRIZ);
        if (matrizItem && matrizItem.SERVICE) {
            setVal('addSVC', matrizItem.SERVICE);
            populateGestorSelect(matrizItem.SERVICE);
        }
    }
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
        state.isUserAdmin = (userData.Nivel || '').toUpperCase() === 'ADMINISTRADOR';
        console.log(`Usuário ${state.isUserAdmin ? 'é' : 'não é'} Administrador.`);
    } catch (error) {
        console.error('Erro ao processar sessão do usuário:', error);
        state.isUserAdmin = false;
    }
}function promptForDate(title, defaultDate) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:20000;';
        const modal = document.createElement('div');
        modal.style.cssText = 'background:white; padding:20px; border-radius:8px; box-shadow:0 4px 12px rgba(0,0,0,0.15); width: 300px;';
        const titleEl = document.createElement('h3');
        titleEl.textContent = title;
        titleEl.style.cssText = 'margin-top:0; margin-bottom:15px; font-size:18px; color: #333;';
        const inputEl = document.createElement('input');
        inputEl.type = 'date';
        inputEl.value = defaultDate;
        inputEl.style.cssText = 'width:100%; padding:8px; border:1px solid #ccc; border-radius:4px; box-sizing: border-box;';
        const actionsEl = document.createElement('div');
        actionsEl.style.cssText = 'margin-top:20px; display:flex; justify-content:flex-end; gap:10px;';
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Cancelar';
        cancelBtn.className = 'btn-cancelar';
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.textContent = 'Confirmar';
        okBtn.className = 'btn-salvar';
        actionsEl.append(cancelBtn, okBtn);
        modal.append(titleEl, inputEl, actionsEl);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        const close = (value) => {
            document.body.removeChild(overlay);
            resolve(value);
        };
        okBtn.onclick = () => {
            if (!inputEl.value) {
                alert('Por favor, selecione uma data.');
                return;
            }
            close(inputEl.value);
        };
        cancelBtn.onclick = () => close(null);
        overlay.onclick = (e) => {
            if (e.target === overlay) close(null);
        };
    });
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
}function ymdToday() {
    const t = new Date();
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, '0');
    const d = String(t.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}function isFutureYMD(yyyyMmDd) {
    if (!yyyyMmDd) return false;
    return yyyyMmDd > ymdToday();
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
    const [y, m, d] = String(iso).split('T')[0].split('-');
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
        if (colaborador.StatusDesligamento === 'PENDENTE') {
            return `${nomeBase} ⚠️ (Desligamento Pendente)`;
        }
        if (colaborador.StatusDesligamento === 'RECUSADO') {
            return `${nomeBase} ❌ (Desligamento Recusado)`;
        }
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
        if (colaborador.StatusDesligamento === 'PENDENTE') {
            tr.classList.add('row-pending');
        } else if (colaborador.StatusDesligamento === 'RECUSADO') {
            tr.classList.add('row-rejected');
        }
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
        Contrato: new Set(),
        Cargo: new Set(),
        Escala: new Set(),
        DSR: new Set(),
        Gestor: new Set(),
        MATRIZ: new Set(),
        Gerencia: new Set(),
        REGIAO: new Set(),
        'FOLGA ESPECIAL': new Set()
    };
    state.colaboradoresData.forEach((c) => {
        Object.keys(filtros).forEach((key) => {
            let v;
            if (key === 'Gerencia') {
                const mtzColab = String(c.MATRIZ || '').toUpperCase().trim();
                v = state.matrizGerenciaMap.get(mtzColab);
            } else if (key === 'SVC') {
                return;
            } else {
                v = c[key];
            }
            if (v !== undefined && v !== null && String(v).trim() !== '') {
                filtros[key].add(String(v).toUpperCase().trim());
            }
        });
    });
    filtrosSelect.forEach((selectEl) => {
        const key = selectEl.dataset.filterKey;
        if (!key || !(key in filtros)) return;
        const valorSalvo = selectEl.value;
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
        if (key === 'Contrato') {
            const optionEl = document.createElement('option');
            optionEl.value = 'Consultorias';
            optionEl.textContent = 'Consultorias';
            selectEl.appendChild(optionEl);
        }
        selectEl.value = valorSalvo;
    });
}function normalizeText(text) {
    return String(text || '')
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}function applyFiltersAndSearch() {
    const searchInputString = (searchInput?.value || '').trim();
    const searchTerms = searchInputString
        .split(',')
        .map(term => normalizeText(term))
        .filter(term => term.length > 0);
    state.dadosFiltrados = state.colaboradoresData.filter((colaborador) => {
        for (const key in state.filtrosAtivos) {
            if (!Object.prototype.hasOwnProperty.call(state.filtrosAtivos, key)) continue;
            const activeVal = state.filtrosAtivos[key];
            if (!activeVal) continue;
            if (key === 'Contrato' && activeVal === 'Consultorias') {
                if (String(colaborador?.['Contrato'] ?? '').toUpperCase() === 'KN') {
                    return false;
                }
                continue;
            }
            let colVal;
            if (key.toUpperCase() === 'GERENCIA') {
                const mtzColab = String(colaborador.MATRIZ || '').toUpperCase().trim();
                colVal = state.matrizGerenciaMap.get(mtzColab) || '';
            } else {
                colVal = String(colaborador?.[key] ?? '');
            }
            if (colVal.toUpperCase().trim() !== activeVal.toUpperCase().trim()) return false;
        }
        if (searchTerms.length === 0) {
            return true;
        }
        const nomeNorm = normalizeText(colaborador.Nome);
        const cpfNorm = normalizeText(colaborador.CPF);
        const idGrootNorm = normalizeText(colaborador['ID GROOT']);
        const ldapNorm = normalizeText(colaborador.LDAP);
        const fluxoNorm = normalizeText(colaborador.Fluxo);
        const matriculaKnNorm = normalizeText(colaborador.MatriculaKN);
        return searchTerms.some(term =>
            nomeNorm.includes(term) ||
            cpfNorm.includes(term) ||
            idGrootNorm.includes(term) ||
            ldapNorm.includes(term) ||
            fluxoNorm.includes(term) ||
            matriculaKnNorm.includes(term)
        );
    });
    itensVisiveis = ITENS_POR_PAGINA;
    repopulateFilterOptionsCascade();
    updateDisplay();
    if (typeof updatePendingImportCounter === 'function') {
        updatePendingImportCounter();
    }
}function repopulateFilterOptionsCascade() {
    if (!filtrosSelect || !filtrosSelect.length) return;
    filtrosSelect.forEach((selectEl) => {
        const key = selectEl.dataset.filterKey;
        if (!key) return;
        const searchTerm = normalizeText(searchInput?.value);
        const tempFiltrado = state.colaboradoresData.filter((c) => {
            for (const k in state.filtrosAtivos) {
                if (!Object.prototype.hasOwnProperty.call(state.filtrosAtivos, k)) continue;
                if (k === key) continue;
                const activeVal = state.filtrosAtivos[k];
                if (!activeVal) continue;
                if (k === 'Contrato' && activeVal === 'Consultorias') {
                    if (String(c?.['Contrato'] ?? '').toUpperCase() === 'KN') return false;
                    continue;
                }
                let colVal;
                if (k === 'Gerencia') {
                    const mtzColab = String(c.MATRIZ || '').toUpperCase().trim();
                    colVal = state.matrizGerenciaMap.get(mtzColab) || '';
                } else {
                    colVal = String(c?.[k] ?? '');
                }
                if (colVal.toUpperCase().trim() !== activeVal.toUpperCase().trim()) return false;
            }
            if (!searchTerm) return true;
            const nomeNorm = normalizeText(c.Nome);
            const cpfNorm = normalizeText(c.CPF);
            const idGrootNorm = normalizeText(c['ID GROOT']);
            const ldapNorm = normalizeText(c.LDAP);
            const fluxoNorm = normalizeText(c.Fluxo);
            const matriculaKnNorm = normalizeText(c.MatriculaKN);
            return (
                nomeNorm.includes(searchTerm) ||
                cpfNorm.includes(searchTerm) ||
                idGrootNorm.includes(searchTerm) ||
                ldapNorm.includes(searchTerm) ||
                fluxoNorm.includes(searchTerm) ||
                matriculaKnNorm.includes(searchTerm)
            );
        });
        const valores = new Set();
        tempFiltrado.forEach((c) => {
            let v;
            if (key === 'Gerencia') {
                const mtzColab = String(c.MATRIZ || '').toUpperCase().trim();
                v = state.matrizGerenciaMap.get(mtzColab);
            } else {
                v = c?.[key];
            }
            if (v != null && v !== '') valores.add(String(v).toUpperCase().trim());
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
        if (key === 'Contrato') {
            const o = document.createElement('option');
            o.value = 'Consultorias';
            o.textContent = 'Consultorias';
            selectEl.appendChild(o);
        }
        if (selecionadoAntes && (valores.has(selecionadoAntes) || (key === 'Contrato' && selecionadoAntes === 'Consultorias'))) {
            selectEl.value = selecionadoAntes;
        } else {
            if (state.filtrosAtivos[key]) delete state.filtrosAtivos[key];
            selectEl.selectedIndex = 0;
        }
    });
}function updatePendingImportCounter() {    if (state.isModuleActive === false) return;    if (!state.pendingImportsRaw || state.pendingImportsRaw.length === 0) {
        hidePendingImportAlert();
        return;
    }    const nomesCadastrados = new Set(
        state.colaboradoresData.map(c => (c.Nome || '').toUpperCase().trim())
    );    const pendentesFiltrados = state.pendingImportsRaw.filter(vaga => {
        const nomeCandidato = (vaga.CandidatoAprovado || '').toUpperCase().trim();
        if (!nomeCandidato || nomesCadastrados.has(nomeCandidato)) return false;        for (const key in state.filtrosAtivos) {
            if (!Object.prototype.hasOwnProperty.call(state.filtrosAtivos, key)) continue;
            const activeVal = state.filtrosAtivos[key];
            if (!activeVal) continue;            let vagaVal = '';
            if (key === 'MATRIZ') {
                vagaVal = vaga.MATRIZ;
            } else if (key === 'Contrato') {
                vagaVal = vaga.EmpresaContratante;
            } else if (key === 'Gerencia') {
                const mtzVaga = String(vaga.MATRIZ || '').toUpperCase().trim();
                vagaVal = state.matrizGerenciaMap.get(mtzVaga) || vaga.Gestor;
            } else if (key === 'Cargo') {
                vagaVal = vaga.Cargo;
            } else if (key === 'REGIAO') {
                vagaVal = computeRegiaoFromSvcMatriz(null, vaga.MATRIZ);
            } else {
                continue;
            }            if (vagaVal && String(vagaVal).toUpperCase().trim() !== String(activeVal).toUpperCase().trim()) {
                return false;
            }
        }
        return true;
    });    if (pendentesFiltrados.length > 0) {
        showPendingImportAlert(pendentesFiltrados.length);
    } else {
        hidePendingImportAlert();
    }
}function computeRegiaoFromSvcMatriz(svcVal, matrizVal) {
    const svc = (svcVal || '').toString().toUpperCase().trim();
    const matriz = (matrizVal || '').toString().toUpperCase().trim();
    state.serviceRegiaoMap = state.serviceRegiaoMap || new Map();
    state.matrizRegiaoMap = state.matrizRegiaoMap || new Map();
    const bySvc = svc ? (state.serviceRegiaoMap.get(svc) || null) : null;
    if (bySvc) return toUpperTrim(bySvc);
    const byMatriz = matriz ? (state.matrizRegiaoMap.get(matriz) || null) : null;
    return byMatriz ? toUpperTrim(byMatriz) : null;
}async function checkPendingImports() {
    const matrizesPermitidas = getMatrizesPermitidas();
    let query = supabase
        .from('Vagas')
        .select('CandidatoAprovado, MATRIZ, Gestor, Cargo, EmpresaContratante')
        .eq('Status', 'EM ADMISSÃO')
        .or('Cargo.ilike.%CONFERENTE%,Cargo.ilike.%AUXILIAR DE OPERAÇÕES%');
    if (matrizesPermitidas !== null) {
        query = query.in('MATRIZ', matrizesPermitidas);
    }
    const {data: vagasCandidatos, error} = await query;
    if (error || !vagasCandidatos) {
        state.pendingImportsRaw = [];
        hidePendingImportAlert();
        return;
    }
    state.pendingImportsRaw = vagasCandidatos;
    updatePendingImportCounter();
}function showPendingImportAlert(count) {
    let alertDiv = document.getElementById('pending-import-alert');
    if (!alertDiv) {
        alertDiv = document.createElement('div');
        alertDiv.id = 'pending-import-alert';
        const addBtnWrapper = document.getElementById('dropdownAdd')?.parentNode || document.getElementById('add-colaborador-btn')?.parentNode;
        if (addBtnWrapper) {
            addBtnWrapper.parentNode.insertBefore(alertDiv, addBtnWrapper.nextSibling);
        } else {
            const container = document.querySelector('.table-wrapper') || document.getElementById('colaboradores-tbody')?.closest('.container');
            if (container && container.parentNode) {
                container.parentNode.insertBefore(alertDiv, container);
            }
        }
    }
    const plural = count > 1 ? 'novas vagas pendentes' : 'nova vaga pendente';
    alertDiv.innerHTML = `
                <div class="alert-content">
                    <span style="font-size: 14px;">⚠️</span>
                    <span>Você tem <strong>${count} ${plural}</strong> de importação! Clique em <b>Adicionar</b> e depois <b>Importar do RH</b>.</span>
                </div>
            `;
    alertDiv.classList.remove('hidden');
}function hidePendingImportAlert() {
    const alertDiv = document.getElementById('pending-import-alert');
    if (alertDiv) {
        alertDiv.classList.add('hidden');
    }
}async function fetchColaboradores() {
    const now = Date.now();
    let currentUser = 'unknown';
    try {
        const sessionStr = localStorage.getItem('userSession');
        if (sessionStr) {
            const sess = JSON.parse(sessionStr);
            currentUser = sess.Nome || sess.ID || 'unknown';
        }
    } catch (e) {
        console.warn('Erro ao ler userSession', e);
    }
    try {
        const cached = localStorage.getItem('knc:colaboradoresCache');
        if (cached) {
            const {timestamp, data, ferias, owner} = JSON.parse(cached);
            const isSameUser = owner === currentUser;
            const isValidTime = (now - timestamp) < CACHE_DURATION_MS;
            if (isSameUser && isValidTime) {
                console.log("Usando cache de colaboradores (localStorage) - Usuário validado.");
                cachedColaboradores = data;
                cachedFeriasStatus = new Map(ferias);
                lastFetchTimestamp = timestamp;
                state.colaboradoresData = cachedColaboradores;
                state.feriasAtivasMap = cachedFeriasStatus;
                populateFilters();
                applyFiltersAndSearch();
                checkPendingImports();
                return;
            } else {
                if (!isSameUser) console.log("Cache pertence a outro usuário. Invalidando...");
                else console.log("Cache do localStorage expirado.");
                localStorage.removeItem('knc:colaboradoresCache');
            }
        }
    } catch (e) {
        console.warn('Falha ao ler cache de colaboradores do localStorage', e);
        localStorage.removeItem('knc:colaboradoresCache');
    }
    if (cachedColaboradores && (now - lastFetchTimestamp < CACHE_DURATION_MS)) {
        console.log("Usando cache de colaboradores (memória).");
        state.colaboradoresData = cachedColaboradores;
        if (cachedFeriasStatus) {
            state.feriasAtivasMap = cachedFeriasStatus;
        } else {
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
                state.feriasAtivasMap = new Map();
                cachedFeriasStatus = null;
            }
        }
        populateFilters();
        applyFiltersAndSearch();
        checkPendingImports();
        return;
    }
    console.log("Buscando dados frescos do banco (Colaboradores e Férias)...");
    if (colaboradoresTbody) {
        colaboradoresTbody.innerHTML = '<tr><td colspan="12" class="text-center p-4">Carregando...</td></tr>';
    }
    try {
        const matrizesPermitidas = getMatrizesPermitidas();
        let query = supabase
            .from('Colaboradores')
            .select('Nome, CPF, DSR, Escala, Contrato, Cargo, Gestor, "ID GROOT","Data de nascimento", MatriculaKN, LDAP, SVC, REGIAO, MATRIZ, "Data de admissão", "Admissao KN", "FOLGA ESPECIAL", Ativo, StatusDesligamento, Ferias, Efetivacao, Fluxo, "Data Fluxo", "Observacao Fluxo", rg, telefone, email, pis, endereco_completo, numero, bairro, cidade, colete, sapato, Genero, DataRetorno, CEP')
            .neq('Ativo', 'NÃO')
            .order('Nome');
        if (matrizesPermitidas !== null) {
            query = query.in('MATRIZ', matrizesPermitidas);
        }
        const data = await fetchAllWithPagination(query);
        state.colaboradoresData = data || [];
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
        }
        cachedColaboradores = state.colaboradoresData;
        cachedFeriasStatus = state.feriasAtivasMap;
        lastFetchTimestamp = Date.now();
        try {
            localStorage.setItem('knc:colaboradoresCache', JSON.stringify({
                timestamp: lastFetchTimestamp,
                data: cachedColaboradores,
                ferias: Array.from(cachedFeriasStatus.entries()),
                owner: currentUser
            }));
        } catch (e) {
            console.warn('Falha ao salvar cache no localStorage', e);
        }
        populateFilters();
        applyFiltersAndSearch();
        checkPendingImports();
    } catch (error) {
        console.error('Erro ao carregar colaboradores/férias:', error);
        if (colaboradoresTbody) {
            colaboradoresTbody.innerHTML = '<tr><td colspan="12" class="text-center p-4 text-red-500">Erro ao carregar dados.</td></tr>';
        }
        cachedColaboradores = null;
        lastFetchTimestamp = 0;
    }
}async function gerarJanelaDeQRCodes() {
    if (state.selectedNames.size === 0) {
        await window.customAlert('Nenhum colaborador selecionado. Use Ctrl+Click para selecionar um ou Shift+Click para selecionar todos.', 'Aviso');
        return;
    }
    const todosOsSelecionados = state.colaboradoresData.filter(colab =>
        state.selectedNames.has(colab.Nome)
    );
    const colaboradoresParaQR = todosOsSelecionados.filter(colab => colab['ID GROOT']);
    if (todosOsSelecionados.length > colaboradoresParaQR.length) {
        const faltantes = todosOsSelecionados.length - colaboradoresParaQR.length;
        const plural = faltantes > 1 ? 'colaboradores não possuem' : 'colaborador não possui';
        await window.customAlert(`Aviso: ${todosOsSelecionados.length} colaboradores foram selecionados, mas ${faltantes} ${plural} ID GROOT e não puderam ser gerados.`, 'Atenção');
    }
    if (colaboradoresParaQR.length === 0) {
        await window.customAlert('Nenhum dos colaboradores selecionados possui um ID GROOT para gerar o QR Code.', 'Erro');
        return;
    }
    const {data: imageData, error: imageError} = await supabase
        .storage
        .from('cards')
        .getPublicUrl('QRCODE.png');
    if (imageError) {
        console.error('Erro ao buscar a imagem do card:', imageError);
        await window.customAlert('Não foi possível carregar o template do card. Verifique o console de erros.', 'Erro');
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
    }
    if (state.matrizesData.length === 0) {
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
    }
    svcSelect.innerHTML = '<option value="" disabled selected>Selecione um SVC...</option>';
    const uniqueSvcs = [...new Set(state.matrizesData.map(item => String(item.SERVICE || '').toUpperCase()))].sort();
    uniqueSvcs.forEach((svc) => {
        const opt = document.createElement('option');
        opt.value = svc;
        opt.textContent = svc;
        svcSelect.appendChild(opt);
    });
}async function loadGestoresParaFormulario() {
    if (state.gestoresData.length > 0) return;
    const {data, error} = await supabase.from('Gestores').select('NOME, SVC');
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
        await window.customAlert('Ação não permitida. Você está em modo de visualização.', 'Acesso Negado');
        return;
    }
    attachUppercaseHandlers();
    const nomeRaw = document.getElementById('addNome')?.value || '';
    const cpfRaw = document.getElementById('addCPF')?.value || '';
    const cpf = normalizeCPF(cpfRaw);
    const nomeUpper = toUpperTrim(nomeRaw);
    if (!nomeUpper) {
        await window.customAlert('Informe o NOME do colaborador.', 'Campo Obrigatório');
        document.getElementById('addNome')?.focus();
        return;
    }
    const {count: nomeCount, error: nomeErr} = await supabase
        .from('Colaboradores')
        .select('Nome', {count: 'exact', head: true})
        .ilike('Nome', nomeUpper);
    if (nomeErr) {
        await window.customAlert(`Erro ao validar nome: ${nomeErr.message}`, 'Erro');
        return;
    }
    if ((nomeCount || 0) > 0) {
        await window.customAlert('Já existe um colaborador com esse NOME.', 'Duplicidade');
        document.getElementById('addNome')?.focus();
        return;
    }
    if (cpf) {
        const {count: cpfCount, error: cpfErr} = await supabase
            .from('Colaboradores')
            .select('CPF', {count: 'exact', head: true})
            .eq('CPF', cpf);
        if (cpfErr) {
            await window.customAlert(`Erro ao validar CPF: ${cpfErr.message}`, 'Erro');
            return;
        }
        if ((cpfCount || 0) > 0) {
            await window.customAlert('Já existe um colaborador com esse CPF.', 'Duplicidade');
            document.getElementById('addCPF')?.focus();
            return;
        }
    }
    const generoVal = document.getElementById('addGenero')?.value || '';
    const generoNorm = nullIfEmpty(generoVal);
    if (!generoNorm) {
        await window.customAlert('Selecione o GÊNERO.', 'Campo Obrigatório');
        document.getElementById('addGenero')?.focus();
        return;
    }
    const dsrRaw = document.getElementById('addDSR')?.value || '';
    const dsrVal = toUpperTrim(dsrRaw);
    if (!isDSRValida(dsrVal)) {
        await window.customAlert('Selecione pelo menos um dia de DSR (ex.: DOMINGO, SEGUNDA, ...).', 'Campo Obrigatório');
        document.getElementById('addDSRBtn')?.focus();
        return;
    }
    const svcSelecionado = nullIfEmpty(document.getElementById('addSVC')?.value);
    const matrizSelecionada = nullIfEmpty(document.getElementById('addMatriz')?.value)
        || (svcSelecionado ? (state.serviceMatrizMap.get(String(svcSelecionado).toUpperCase()) || null) : null);
    const regiaoAuto = computeRegiaoFromSvcMatriz(svcSelecionado, matrizSelecionada);
    const cepValor = document.getElementById('addCEP')?.value || '';
    const cepLimpo = cepValor.replace(/\D/g, '') || null;
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
        MatriculaKN: nullIfEmpty(document.getElementById('addMatriculaKN')?.value),
        rg: nullIfEmpty(document.getElementById('addRG')?.value),
        telefone: nullIfEmpty(document.getElementById('addTelefone')?.value),
        email: nullIfEmpty(document.getElementById('addEmail')?.value),
        pis: nullIfEmpty(document.getElementById('addPIS')?.value),
        CEP: cepLimpo,
        endereco_completo: toUpperTrim(document.getElementById('addEndereco')?.value),
        numero: nullIfEmpty(document.getElementById('addNumero')?.value),
        bairro: toUpperTrim(document.getElementById('addBairro')?.value),
        cidade: toUpperTrim(document.getElementById('addCidade')?.value),
        colete: nullIfEmpty(document.getElementById('addColete')?.value),
        sapato: nullIfEmpty(document.getElementById('addSapato')?.value),
        Ativo: 'SIM',
        Ferias: 'NAO',
        'Total Presença': 0,
        'Total Faltas': 0,
        'Total Atestados': 0,
        'Total Suspensões': 0,
        StatusDesligamento: 'ATIVO'
    });
    const {error} = await supabase.from('Colaboradores').insert([newColaborador]);
    if (error) {
        await window.customAlert(`Erro ao adicionar colaborador: ${error.message}`, 'Erro');
        return;
    }
    await window.customAlert('Colaborador adicionado com sucesso!', 'Sucesso');
    logAction(`Adicionou o colaborador: ${newColaborador.Nome} (Contrato: ${newColaborador.Contrato}, Cargo: ${newColaborador.Cargo}, SVC: ${newColaborador.SVC})`);
    if (addForm) {
        addForm.reset();
        const dsrBtn = document.getElementById('addDSRBtn');
        if (dsrBtn) {
            dsrBtn.value = '';
            dsrBtn.placeholder = 'CLIQUE PARA SELECIONAR OS DIAS...';
        }
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
    }
    if (state.matrizesData.length === 0) {
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
    }
    editSVC.innerHTML = '<option value="" disabled selected>Selecione...</option>';
    const uniqueSvcs = [...new Set(state.matrizesData.map(item => String(item.SERVICE || '').toUpperCase()))].sort();
    uniqueSvcs.forEach(svc => {
        const opt = document.createElement('option');
        opt.value = svc;
        opt.textContent = svc;
        editSVC.appendChild(opt);
    });
}async function fetchColabByNome(nome) {
    const {data, error} = await supabase
        .from('Colaboradores')
        .select('*')
        .eq('Nome', nome)
        .maybeSingle();
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
    populateOptionsTamanhos('editSapato', 'editColete');
    const setVal = (el, v) => {
        if (el) el.value = v ?? '';
    };
    const safeDate = (isoStr) => {
        if (!isoStr) return '';
        return isoStr.split('T')[0];
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
    setVal(editInputs.MatriculaKN, colab.MatriculaKN ?? '');
    setVal(editInputs['Data de nascimento'], safeDate(colab['Data de nascimento']));
    setVal(editInputs['Data de admissão'], safeDate(colab['Data de admissão']));
    setVal(editInputs['Admissao KN'], safeDate(colab['Admissao KN']));
    setVal(editInputs.rg, colab.rg);
    setVal(editInputs.telefone, colab.telefone);
    setVal(editInputs.email, colab.email);
    setVal(editInputs.pis, colab.pis);
    setVal(editInputs.endereco_completo, colab.endereco_completo);
    setVal(editInputs.numero, colab.numero);
    setVal(editInputs.bairro, colab.bairro);
    setVal(editInputs.cidade, colab.cidade);
    setVal(editInputs.colete, colab.colete);
    setVal(editInputs.sapato, colab.sapato);
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
        const status = colab.Efetivacao;
        const isKN = colab.Contrato && colab.Contrato.toUpperCase() === 'KN';
        if (status === 'Aberto') {
            editEfetivarKnBtn.textContent = 'Gerenciar Fluxo (Aberto)';
            editEfetivarKnBtn.style.display = 'inline-block';
            editEfetivarKnBtn.disabled = false;
        } else if (status === 'Concluido') {
            editEfetivarKnBtn.textContent = 'Fluxo Concluído';
            editEfetivarKnBtn.style.display = 'inline-block';
            editEfetivarKnBtn.disabled = false;
        } else if (status === 'Cancelado') {
            editEfetivarKnBtn.textContent = 'Fluxo Cancelado';
            editEfetivarKnBtn.style.display = 'inline-block';
            editEfetivarKnBtn.disabled = false;
        } else if (!isKN) {
            editEfetivarKnBtn.textContent = 'Efetivar KN / Gerar Fluxo';
            editEfetivarKnBtn.style.display = 'inline-block';
            editEfetivarKnBtn.disabled = false;
        } else {
            editEfetivarKnBtn.textContent = 'Visualizar Fluxo (Concluído)';
            editEfetivarKnBtn.style.display = 'inline-block';
            editEfetivarKnBtn.disabled = false;
        }
    }
    if (editDesligarBtn) {
        if (colab.StatusDesligamento === 'PENDENTE') {
            editDesligarBtn.textContent = 'Desligamento Pendente';
            editDesligarBtn.disabled = true;
            editDesligarBtn.style.display = 'inline-block';
        } else if (colab.StatusDesligamento === 'RECUSADO') {
            editDesligarBtn.textContent = 'Solicitar Desligamento';
            editDesligarBtn.disabled = false;
            editDesligarBtn.style.display = 'inline-block';
        } else if (colab.Ativo === 'SIM') {
            editDesligarBtn.textContent = 'Desligar';
            editDesligarBtn.disabled = false;
            editDesligarBtn.style.display = 'inline-block';
        } else {
            editDesligarBtn.style.display = 'none';
        }
    }
    if (editExcluirBtn) {
        editExcluirBtn.style.display = state.isUserAdmin ? 'inline-block' : 'none';
    }
}function openFluxoEfetivacaoModal() {
    if (!editOriginal || !fluxoEfetivacaoModal) {
        console.error("Colaborador original ou modal de fluxo não encontrado.");
        return;
    }
    injectFluxoStyles();
    if (
        !fluxoEfetivacaoNomeEl || !fluxoNumeroEl || !fluxoDataAberturaEl ||
        !fluxoObservacaoEl || !fluxoAdmissaoKnEl || !fluxoGerarBtn ||
        !fluxoFinalizarBtn || !fluxoCancelarBtn
    ) {
        fluxoEfetivacaoNomeEl = document.getElementById('fluxoEfetivacaoNome');
        fluxoNumeroEl = document.getElementById('fluxoNumero');
        fluxoDataAberturaEl = document.getElementById('fluxoDataAbertura');
        fluxoObservacaoEl = document.getElementById('fluxoObservacao');
        fluxoAdmissaoKnEl = document.getElementById('fluxoAdmissaoKnData');
        fluxoGerarBtn = document.getElementById('fluxoGerarBtn');
        fluxoFinalizarBtn = document.getElementById('fluxoFinalizarBtn');
        fluxoCancelarBtn = document.getElementById('fluxoCancelarBtn');
        if (!fluxoAdmissaoKnEl) return;
    }
    fluxoEfetivacaoNomeEl.value = editOriginal.Nome;
    fluxoNumeroEl.value = editOriginal.Fluxo || '';
    fluxoDataAberturaEl.value = editOriginal['Data Fluxo'] || ymdToday();
    fluxoObservacaoEl.value = editOriginal['Observacao Fluxo'] || '';
    const status = editOriginal.Efetivacao;
    if (status === 'Concluido') {
        fluxoAdmissaoKnEl.value = editOriginal['Admissao KN'] || editOriginal['Data de admissão'] || '';
        fluxoAdmissaoKnEl.disabled = true;
    } else {
        fluxoAdmissaoKnEl.value = '';
        fluxoAdmissaoKnEl.disabled = false;
    }
    fluxoNumeroEl.disabled = false;
    fluxoDataAberturaEl.disabled = false;
    fluxoObservacaoEl.disabled = false;
    fluxoFinalizarBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    if (status === 'Concluido') {
        fluxoGerarBtn.textContent = 'Salvar Observação';
        fluxoFinalizarBtn.disabled = true;
        fluxoFinalizarBtn.classList.add('opacity-50', 'cursor-not-allowed');
        fluxoCancelarBtn.textContent = 'Reverter Fluxo';
        fluxoCancelarBtn.disabled = false;
    } else {
        if (status === 'Aberto') {
            fluxoGerarBtn.textContent = 'Atualizar Fluxo';
        } else if (status === 'Cancelado') {
            fluxoGerarBtn.textContent = 'Re-abrir Fluxo';
        } else {
            fluxoGerarBtn.textContent = 'Gerar Fluxo';
        }
        fluxoFinalizarBtn.disabled = false;
        fluxoCancelarBtn.textContent = 'Cancelar Fluxo';
        fluxoCancelarBtn.disabled = false;
    }
    fluxoAdmissaoKnEl.oninput = null;
    fluxoEfetivacaoModal.classList.remove('hidden');
}function closeFluxoEfetivacaoModal() {
    if (fluxoEfetivacaoModal) {
        fluxoEfetivacaoModal.classList.add('hidden');
        fluxoEfetivacaoForm.reset();
    }
}async function handleFluxoSubmit(action) {
    if (!editOriginal) return;
    const nome = editOriginal.Nome;
    const numeroFluxo = nullIfEmpty(fluxoNumeroEl.value);
    const dataAbertura = nullIfEmpty(fluxoDataAberturaEl.value);
    const observacao = nullIfEmpty(fluxoObservacaoEl.value);
    let admissaoKN = nullIfEmpty(fluxoAdmissaoKnEl.value);
    let payload = {
        'Fluxo': numeroFluxo,
        'Data Fluxo': dataAbertura,
        'Observacao Fluxo': observacao,
        'Efetivacao': editOriginal.Efetivacao,
        'Contrato': editOriginal.Contrato,
        'Admissao KN': editOriginal['Admissao KN']
    };
    if (action === 'gerar') {
        if (!numeroFluxo || !dataAbertura) {
            await window.customAlert('Para "Gerar" ou "Atualizar", o número do Fluxo e Data são obrigatórios.', 'Campos Obrigatórios');
            return;
        }
        payload.Efetivacao = 'Aberto';
        const ok = await window.customConfirm(`Salvar o fluxo para <b>"${nome}"</b> como "Aberto"?`, 'Confirmar');
        if (!ok) return;
    } else if (action === 'finalizar') {
        if (!admissaoKN) {
            const dataHoje = ymdToday();
            const dataHojeFormatada = formatDateLocal(dataHoje);
            const usarHoje = await window.customConfirm(
                `A data de admissão não foi preenchida.<br><br>Deseja finalizar a admissão KN com a data de <b>HOJE (${dataHojeFormatada})</b>?`,
                'Definir Data',
                'question'
            );
            if (usarHoje) {
                admissaoKN = dataHoje;
            } else {
                admissaoKN = await promptForDate("Selecione a Data de Admissão KN:", dataHoje);
                if (!admissaoKN) return;
            }
            fluxoAdmissaoKnEl.value = admissaoKN;
        }
        const admOriginal = editOriginal['Data de admissão'] || null;
        if (admOriginal && admissaoKN < admOriginal) {
            await window.customAlert(`Data inválida! A Admissão KN (${formatDateLocal(admissaoKN)}) não pode ser anterior à admissão original na consultoria.`, 'Erro');
            fluxoAdmissaoKnEl.focus();
            return;
        }
        const dataFinalFormatada = formatDateLocal(admissaoKN);
        const htmlMsg = `
            <div class="text-left">
                <p>Confirma a finalização para "<b>${nome}</b>"?</p>
                <ul class="swal-custom-list">
                    <li>1. Status: <b>Concluido</b></li>
                    <li>2. Contrato: <b>KN</b></li>
                    <li>3. Admissão: <b>${dataFinalFormatada}</b></li>
                </ul>
            </div>
        `;
        const okFinal = await window.customConfirm(htmlMsg, 'Confirmar Efetivação', 'success');
        if (!okFinal) return;
        payload.Efetivacao = 'Concluido';
        payload.Contrato = 'KN';
        payload['Admissao KN'] = admissaoKN;
    } else if (action === 'cancelar') {
        const novoContrato = await promptSelectContratoReversao();
        if (!novoContrato) return;
        payload.Efetivacao = null;
        payload.Fluxo = null;
        payload['Data Fluxo'] = null;
        payload['Observacao Fluxo'] = null;
        payload['Admissao KN'] = null;
        payload.Contrato = novoContrato;
        await window.customAlert(`Fluxo revertido. Colaborador voltou para <b>${novoContrato}</b>.`, 'Sucesso', 'success');
    }
    try {
        if (fluxoGerarBtn) fluxoGerarBtn.disabled = true;
        if (fluxoFinalizarBtn) fluxoFinalizarBtn.disabled = true;
        if (fluxoCancelarBtn) fluxoCancelarBtn.disabled = true;
        const {error} = await supabase.from('Colaboradores').update(payload).eq('Nome', nome);
        if (error) throw error;
        if (action !== 'cancelar') {
            await window.customAlert('Fluxo salvo com sucesso!', 'Sucesso');
        }
        let logMsg = `Fluxo ${nome}: ${action.toUpperCase()}`;
        if (action === 'finalizar') logMsg += ` (Adm KN: ${formatDateLocal(admissaoKN)})`;
        if (action === 'cancelar') logMsg += ` (Revertido p/ ${payload.Contrato})`;
        logAction(logMsg);
        closeFluxoEfetivacaoModal();
        hideEditModal();
        invalidateColaboradoresCache();
        await fetchColaboradores();
    } catch (error) {
        console.error('Erro fluxo:', error);
        await window.customAlert(`Erro ao salvar: ${error.message}`, 'Erro');
    } finally {
        if (fluxoGerarBtn) fluxoGerarBtn.disabled = false;
        if (fluxoFinalizarBtn) fluxoFinalizarBtn.disabled = false;
        if (fluxoCancelarBtn) fluxoCancelarBtn.disabled = false;
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
}async function updateColaboradorSmart(nomeAnterior, payload) {
    if (payload.Nome && payload.Nome !== nomeAnterior) {
        const {error: rpcError} = await supabase.rpc('atualizar_nome_colaborador_cascata', {
            nome_antigo: nomeAnterior,
            novos_dados: payload
        });
        if (rpcError) throw rpcError;
        const patch = {};
        if (payload['Data de admissão'] !== undefined) patch['Data de admissão'] = payload['Data de admissão'];
        if (payload['Admissao KN'] !== undefined) patch['Admissao KN'] = payload['Admissao KN'];
        if (payload['Data de nascimento'] !== undefined) patch['Data de nascimento'] = payload['Data de nascimento'];
        if (payload.DSR !== undefined) patch.DSR = payload.DSR;
        if (payload.Escala !== undefined) patch.Escala = payload.Escala;
        if (payload['FOLGA ESPECIAL'] !== undefined) patch['FOLGA ESPECIAL'] = payload['FOLGA ESPECIAL'];
        if (payload.Contrato !== undefined) patch.Contrato = payload.Contrato;
        if (payload.Cargo !== undefined) patch.Cargo = payload.Cargo;
        if (payload.Gestor !== undefined) patch.Gestor = payload.Gestor;
        if (payload.LDAP !== undefined) patch.LDAP = payload.LDAP;
        if (payload['ID GROOT'] !== undefined) patch['ID GROOT'] = payload['ID GROOT'];
        if (payload.SVC !== undefined) patch.SVC = payload.SVC;
        if (payload.MATRIZ !== undefined) patch.MATRIZ = payload.MATRIZ;
        if (payload.REGIAO !== undefined) patch.REGIAO = payload.REGIAO;
        if (Object.keys(patch).length > 0) {
            console.log("RPC executada, dados principais atualizados via RPC.");
        }
        return;
    }
    const {error: upErr} = await supabase
        .from('Colaboradores')
        .update(payload)
        .eq('Nome', nomeAnterior);
    if (upErr) throw upErr;
}async function onEditSubmit(e) {
    e.preventDefault();
    if (document.body.classList.contains('user-level-visitante')) {
        await window.customAlert('Ação não permitida. Você está em modo de visualização.', 'Acesso Negado');
        return;
    }
    if (isSubmittingEdit) return;
    isSubmittingEdit = true;
    if (!editOriginal) {
        await window.customAlert('Erro: Não há dados originais do colaborador.', 'Erro');
        isSubmittingEdit = false;
        return;
    }
    const Nome = toUpperTrim(editInputs.Nome.value || '');
    if (!Nome) {
        await window.customAlert('Informe o NOME.', 'Campo Obrigatório');
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
            await window.customAlert('Selecione pelo menos um dia de DSR (ex.: DOMINGO, SEGUNDA, ...).', 'DSR Inválido');
            document.getElementById('editDSRBtn')?.focus();
            isSubmittingEdit = false;
            return;
        }
        const regiaoInputEl = document.getElementById('editRegiao');
        const regiaoFromInput = toUpperTrim(nullIfEmpty(regiaoInputEl?.value));
        const regiaoAuto = computeRegiaoFromSvcMatriz(svc, matrizAuto);
        const regiaoFinal = toUpperTrim(nullIfEmpty(regiaoAuto)) || regiaoFromInput || null;
        const dataNasc = editInputs['Data de nascimento']?.value || null;
        const dataAdmissao = editInputs['Data de admissão']?.value || null;
        const admKn = editInputs['Admissao KN']?.value || null;
        if (dataAdmissao && admKn && admKn < dataAdmissao) {
            await window.customAlert('Admissão KN não pode ser anterior à Data de Admissão.', 'Data Inválida');
            editInputs['Admissao KN'].focus();
            isSubmittingEdit = false;
            return;
        }
        let gestorFinal = toUpperTrim(nullIfEmpty(editInputs.Gestor?.value));
        if (!gestorFinal && svc === editOriginal.SVC && editOriginal.Gestor) {
            gestorFinal = editOriginal.Gestor;
        }
        const cepValor = document.getElementById('editCEP')?.value || '';
        const cepLimpo = cepValor.replace(/\D/g, '') || null;
        const payload = {
            Nome,
            CPF,
            Contrato: toUpperTrim(editInputs.Contrato.value || ''),
            Cargo: toUpperTrim(editInputs.Cargo.value || ''),
            Gestor: gestorFinal,
            DSR: dsrValue,
            Escala: toUpperTrim(nullIfEmpty(editInputs.Escala.value)),
            'FOLGA ESPECIAL': toUpperTrim(nullIfEmpty(editInputs['FOLGA ESPECIAL'].value)),
            LDAP: nullIfEmpty(editInputs.LDAP.value),
            'ID GROOT': numberOrNull(editInputs['ID GROOT'].value),
            MatriculaKN: nullIfEmpty(editInputs.MatriculaKN.value),
            'Data de nascimento': dataNasc,
            'Data de admissão': dataAdmissao,
            'Admissao KN': admKn,
            SVC: toUpperTrim(svc),
            MATRIZ: toUpperTrim(matrizAuto),
            REGIAO: regiaoFinal,
            'Efetivacao': editOriginal.Efetivacao,
            'Fluxo': editOriginal.Fluxo,
            'Data Fluxo': editOriginal['Data Fluxo'],
            'Observacao Fluxo': editOriginal['Observacao Fluxo'],
            rg: nullIfEmpty(editInputs.rg?.value),
            telefone: nullIfEmpty(editInputs.telefone?.value),
            email: nullIfEmpty(editInputs.email?.value),
            pis: nullIfEmpty(editInputs.pis?.value), CEP: cepLimpo,
            endereco_completo: toUpperTrim(editInputs.endereco_completo?.value),
            numero: nullIfEmpty(editInputs.numero?.value),
            bairro: toUpperTrim(editInputs.bairro?.value),
            cidade: toUpperTrim(editInputs.cidade?.value), colete: nullIfEmpty(editInputs.colete?.value),
            sapato: nullIfEmpty(editInputs.sapato?.value)
        };
        const changes = [];
        if (payload.Nome !== editOriginal.Nome) changes.push(`Nome (de '${editOriginal.Nome}' para '${payload.Nome}')`);
        if (payload.DSR !== editOriginal.DSR) changes.push(`DSR`);
        if (payload.Cargo !== editOriginal.Cargo) changes.push(`Cargo`);
        if (payload.Contrato !== editOriginal.Contrato) changes.push(`Contrato`);
        if (payload.Gestor !== editOriginal.Gestor) changes.push(`Gestor`);
        if (payload.Escala !== editOriginal.Escala) changes.push(`Escala`);
        if (payload.LDAP !== editOriginal.LDAP) changes.push(`LDAP`);
        if (payload['ID GROOT'] !== editOriginal['ID GROOT']) changes.push(`ID GROOT`);
        if (payload.SVC !== editOriginal.SVC) changes.push(`SVC`);
        if (payload['Data de admissão'] !== editOriginal['Data de admissão']) changes.push(`Data de Admissão`);
        if (payload['Admissao KN'] !== editOriginal['Admissao KN']) changes.push(`Admissão KN`);
        if (payload.CEP !== editOriginal.CEP) changes.push(`CEP`);
        const dupMsg = await validateEditDuplicates(payload);
        if (dupMsg) {
            await window.customAlert(dupMsg, 'Duplicidade');
            isSubmittingEdit = false;
            return;
        }
        await updateColaboradorSmart(nomeAnterior, payload);
        const dsrAnterior = editOriginal.DSR || null;
        const dsrAtual = payload.DSR || null;
        if (dsrAnterior !== dsrAtual) {
            try {
                const {data: maxRow} = await supabase.from('LogDSR').select('Numero').order('Numero', {ascending: false}).limit(1);
                const nextNumero = (maxRow?.[0]?.Numero || 0) + 1;
                await supabase.from('LogDSR').insert([{
                    Numero: nextNumero,
                    Name: payload.Nome,
                    DsrAnterior: dsrAnterior,
                    DsrAtual: dsrAtual,
                    DataAlteracao: new Date().toISOString(),
                    Escala: payload.Escala,
                    Gestor: payload.Gestor,
                    SVC: payload.SVC,
                    MATRIZ: payload.MATRIZ
                }]);
            } catch (e) {
                console.warn('Falha ao registrar log de DSR:', e);
            }
        }
        invalidateColaboradoresCache();
        await fetchColaboradores();
        try {
            const recarregado = await fetchColabByNome(payload.Nome);
            if (recarregado) await fillEditForm(recarregado);
        } catch {
        }
        if (changes.length > 0) {
            logAction(`Atualizou o colaborador ${editOriginal.Nome}: ${changes.join(', ')}.`);
        }
        await window.customAlert('Colaborador atualizado com sucesso em todas as tabelas!', 'Sucesso');
        hideEditModal();
        document.dispatchEvent(new CustomEvent('colaborador-edited', {
            detail: {nomeAnterior: nomeAnterior, nomeAtual: payload.Nome}
        }));
    } catch (err) {
        console.error('Erro no processo de edição:', err);
        await window.customAlert('Ocorreu um erro inesperado. Verifique o console.', 'Erro');
    } finally {
        isSubmittingEdit = false;
        if (editSalvarBtn) {
            editSalvarBtn.disabled = false;
            editSalvarBtn.textContent = 'Salvar Alterações';
        }
    }
}async function onAfastarClick() {
    if (!editOriginal || !editOriginal.Nome) {
        await window.customAlert('Erro: Colaborador não identificado.', 'Erro');
        return;
    }
    let colab;
    try {
        colab = await fetchColabByNome(editOriginal.Nome);
    } catch (fetchError) {
        await window.customAlert('Não foi possível carregar os dados atuais do colaborador.', 'Erro de Rede');
        return;
    }
    if (!colab) {
        await window.customAlert('Colaborador não encontrado no banco.', 'Erro');
        return;
    }
    const currentStatus = colab.Ativo;
    const hojeISO = new Date().toISOString().split('T')[0];
    if (currentStatus === 'SIM') {
        const dataInicio = await promptForDate("Selecione a data de INÍCIO do afastamento:", hojeISO);
        if (!dataInicio) return;
        const ok = await window.customConfirm(
            `Tem certeza que deseja <b>AFASTAR</b> "${colab.Nome}" a partir de <b>${formatDateLocal(dataInicio)}</b>?`,
            'Confirmar Afastamento',
            'warning'
        );
        if (!ok) return;
        const newAfastamento = {
            NOME: colab.Nome,
            SVC: colab.SVC || null,
            MATRIZ: colab.MATRIZ || null,
            REGIAO: colab.REGIAO || null,
            "DATA INICIO": dataInicio,
            "DATA RETORNO": null
        };
        const {error: insertError} = await supabase.from('Afastamentos').insert(newAfastamento);
        if (insertError) {
            await window.customAlert(`Erro ao criar registro: ${insertError.message}`, 'Erro');
            return;
        }
        const {error: updateError} = await supabase.from('Colaboradores').update({Ativo: 'AFAS'}).eq('Nome', colab.Nome);
        if (updateError) {
            await window.customAlert(`Erro ao atualizar status: ${updateError.message}`, 'Erro');
            return;
        }
        await window.customAlert('Colaborador afastado com sucesso!', 'Sucesso');
        logAction(`Afastou o colaborador: ${colab.Nome} (Início: ${formatDateLocal(dataInicio)})`);
    } else if (currentStatus === 'AFAS') {
        const dataRetorno = await promptForDate("Selecione a data de RETORNO do colaborador:", hojeISO);
        if (!dataRetorno) return;
        const {data: ultimoAfastamento} = await supabase
            .from('Afastamentos')
            .select('"DATA INICIO"')
            .eq('NOME', colab.Nome)
            .is('DATA RETORNO', null)
            .order('"DATA INICIO"', {ascending: false})
            .limit(1)
            .maybeSingle();
        if (ultimoAfastamento && ultimoAfastamento["DATA INICIO"] > dataRetorno) {
            await window.customAlert(`Data de retorno inválida. O afastamento iniciou em ${formatDateLocal(ultimoAfastamento["DATA INICIO"])}.`, 'Data Inválida');
            return;
        }
        const ok = await window.customConfirm(
            `Tem certeza que deseja registrar o <b>RETORNO</b> de "${colab.Nome}" em <b>${formatDateLocal(dataRetorno)}</b>?`,
            'Confirmar Retorno',
            'success'
        );
        if (!ok) return;
        const {error: updateAfastamentoError} = await supabase
            .from('Afastamentos')
            .update({"DATA RETORNO": dataRetorno})
            .eq('NOME', colab.Nome)
            .is('DATA RETORNO', null);
        if (updateAfastamentoError) {
            await window.customAlert(`Erro ao atualizar registro: ${updateAfastamentoError.message}`, 'Erro');
            return;
        }
        const {error: updateColabError} = await supabase
            .from('Colaboradores')
            .update({Ativo: 'SIM'})
            .eq('Nome', colab.Nome);
        if (updateColabError) {
            await window.customAlert(`Erro ao atualizar status: ${updateColabError.message}`, 'Erro');
            return;
        }
        await window.customAlert('Retorno registrado com sucesso!', 'Sucesso');
        logAction(`Registrou retorno de afastamento para: ${colab.Nome}`);
    } else {
        await window.customAlert(`Ação não permitida para status "${currentStatus}".`, 'Aviso');
        return;
    }
    hideEditModal();
    invalidateColaboradoresCache();
    await fetchColaboradores();
}function openDesligarModalFromColab(colab) {
    desligarColaborador = colab;
    desligarNomeEl.value = colab?.Nome || '';
    const hoje = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = `${hoje.getFullYear()}-${pad(hoje.getMonth() + 1)}-${pad(hoje.getDate())}`;
    desligarDataEl.value = iso;
    desligarMotivoEl.selectedIndex = 0;
    const isKN = (colab.Contrato || '').trim().toUpperCase() === 'KN';
    if (desligarSmartoffContainer) {
        if (isKN) {
            desligarSmartoffContainer.classList.remove('hidden');
            if (desligarSmartoffEl) {
                desligarSmartoffEl.value = '';
            }
            if (desligarConfirmarBtn) {
                desligarConfirmarBtn.disabled = true;
            }
        } else {
            desligarSmartoffContainer.classList.add('hidden');
            if (desligarSmartoffEl) desligarSmartoffEl.value = '';
            if (desligarConfirmarBtn) {
                desligarConfirmarBtn.disabled = false;
            }
        }
    }
    desligarModal.classList.remove('hidden');
}function closeDesligarModal() {
    desligarModal.classList.add('hidden');
    desligarColaborador = null;
    desligarForm.reset();
}const sleep = (ms) => new Promise(r => setTimeout(r, ms));async function onDesligarSubmit(e) {
    e.preventDefault();
    if (!desligarColaborador) {
        await window.customAlert('Erro: colaborador não carregado.', 'Erro');
        return;
    }
    if (document.body.classList.contains('user-level-visitante')) {
        await window.customAlert('Ação não permitida. Você está em modo de visualização.', 'Acesso Negado');
        return;
    }
    const nome = desligarColaborador.Nome;
    const dataAgendadaInput = (desligarDataEl?.value || '').trim();
    let motivo = (desligarMotivoEl?.value || '').trim();
    const isKN = (desligarColaborador.Contrato || '').trim().toUpperCase() === 'KN';
    const smartoffVal = desligarSmartoffEl ? desligarSmartoffEl.value.trim() : null;
    if (isKN) {
        if (!smartoffVal) {
            await window.customAlert('Para colaboradores KN, o Número Smart é obrigatório.', 'Campo Obrigatório');
            return;
        }
        if (/\D/.test(smartoffVal)) {
            await window.customAlert('O Número Smart deve conter apenas números, sem letras ou símbolos.', 'Formato Inválido');
            desligarSmartoffEl.value = smartoffVal.replace(/\D/g, '');
            desligarSmartoffEl.focus();
            return;
        }
        if (smartoffVal.length < 6 || smartoffVal.length > 10) {
            await window.customAlert(`O Número Smart deve ter entre 6 e 10 dígitos. Atualmente tem ${smartoffVal.length}.`, 'Tamanho Inválido');
            desligarSmartoffEl.focus();
            return;
        }
    }
    if (!dataAgendadaInput) {
        await window.customAlert('Informe a data prevista para o desligamento.', 'Campo Obrigatório');
        return;
    }
    if (!motivo) {
        await window.customAlert('Selecione o motivo.', 'Campo Obrigatório');
        return;
    }
    let timestampSolicitacao;
    try {
        timestampSolicitacao = getLocalISOString(new Date());
    } catch (err) {
        console.error("Erro ao gerar timestamp:", err);
        timestampSolicitacao = new Date().toISOString();
    }
    const dataAgendadaFormatada = dataAgendadaInput.split('-').reverse().join('/');
    const motivoCompleto = `${motivo} (Data Prevista: ${dataAgendadaFormatada})`;    /*
    const btnSubmit = desligarConfirmarBtn;
    const txtOriginal = btnSubmit.textContent;
    btnSubmit.textContent = 'Verificando pendências...';
    btnSubmit.disabled = true;    let listaPendencias = [];
    try {
        const colabAtualizado = await fetchColabByNome(nome);
        if (colabAtualizado) {
            listaPendencias = await verificarPendencias(colabAtualizado, dataAgendadaInput);
        } else {
            listaPendencias = await verificarPendencias(desligarColaborador, dataAgendadaInput);
        }
    } catch (err) {
        console.error("Erro verificando pendencias:", err);
        await window.customAlert('Erro ao verificar pendências. Tente novamente.', 'Erro');
        btnSubmit.textContent = txtOriginal;
        btnSubmit.disabled = false;
        return;
    } finally {
        btnSubmit.textContent = txtOriginal;
        btnSubmit.disabled = false;
    }    if (listaPendencias.length > 0) {
        const listaExibicao = listaPendencias.slice(0, 10).join('<br>');
        const mais = listaPendencias.length > 10 ? `<br>...e mais ${listaPendencias.length - 10} dias.` : '';        await window.customAlert(
            `Atenção, esse colaborador contém preenchimentos de presença pendentes! Verifique na aba Controle Diário.<br><br><b>Datas pendentes:</b><br>${listaExibicao}${mais}`,
            'Pendências Encontradas'
        );
        return;
    }
    */
    let solicitante = 'Gestor Desconhecido';
    try {
        const userSession = localStorage.getItem('userSession');
        if (userSession) {
            solicitante = JSON.parse(userSession)?.Nome || solicitante;
        }
    } catch (e) {
        console.warn('Erro ao ler sessão', e);
    }
    const ok = await window.customConfirm(
        `Confirmar solicitação de desligamento para <b>"${nome}"</b>?<br>Data Prevista: <b>${dataAgendadaFormatada}</b>`,
        'Confirmar Desligamento',
        'danger'
    );
    if (!ok) return;
    try {
        const payload = {
            Ativo: 'PEN',
            StatusDesligamento: 'PENDENTE',
            DataDesligamentoSolicitada: timestampSolicitacao,
            DataRetorno: null,
            MotivoDesligamento: motivoCompleto,
            SolicitanteDesligamento: solicitante,
            Smartoff: isKN ? smartoffVal : null
        };
        const {error} = await supabase
            .from('Colaboradores')
            .update(payload)
            .eq('Nome', nome);
        if (error) throw error;
        await window.customAlert('Solicitação enviada com sucesso!', 'Sucesso');
        logAction(
            `Enviou solicitação de desligamento: ${nome} ` +
            `(Solicitado em: ${formatDateTimeLocal(timestampSolicitacao)}, Para: ${dataAgendadaFormatada})`
        );
        closeDesligarModal();
        hideEditModal();
        invalidateColaboradoresCache();
        await fetchColaboradores();
    } catch (err) {
        console.error('Erro desligamento:', err);
        await window.customAlert(`Erro ao enviar: ${err.message || err}`, 'Erro');
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
    ensureHistContextMenu();
    for (let m = 0; m < 12; m++) {
        const monthCard = document.createElement('div');
        monthCard.className = 'month-card';
        monthCard.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showHistContextMenu(e.pageX, e.pageY, m);
        });
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
}async function exportHistoricoMesXLSX(monthIndex) {
    if (monthIndex === null || monthIndex === undefined) return;
    await ensureXLSX();
    const nomeColaborador = HIST.nome || 'Colaborador';
    const ano = HIST.ano;
    const mesNome = HIST_MONTH_NAMES[monthIndex];
    const totalDias = daysInMonth(ano, monthIndex);
    const rows = [];
    for (let d = 1; d <= totalDias; d++) {
        const dataObj = new Date(ano, monthIndex, d);
        const iso = isoOf(ano, monthIndex, d);
        const diasSemana = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const diaSemanaStr = diasSemana[dataObj.getDay()];
        let statusCodigo = HIST.marks.get(iso);
        let statusTexto = '';
        let tipo = 'Normal';
        if (statusCodigo) {
            statusTexto = HIST_STATUS_LABEL[statusCodigo] || statusCodigo;
        } else if (HIST.dsrDates && HIST.dsrDates.has(iso)) {
            statusTexto = 'DSR (Descanso Semanal)';
            statusCodigo = 'DSR';
        } else {
            statusTexto = 'Sem registro';
        }
        rows.push({
            'Data': `${pad2(d)}/${pad2(monthIndex + 1)}/${ano}`,
            'Dia da Semana': diaSemanaStr,
            'Status': statusTexto,
            'Código Interno': statusCodigo || '-'
        });
    }
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wscols = [
        {wch: 15},
        {wch: 15},
        {wch: 25},
        {wch: 15}
    ];
    ws['!cols'] = wscols;
    const sheetName = `${mesNome} ${ano}`;
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const fileName = `Historico_${nomeColaborador.replace(/\s+/g, '_')}_${mesNome}_${ano}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
    await window.customAlert(`Exportação de <b>${mesNome}/${ano}</b> concluída com sucesso!`, 'Sucesso');
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
    if (!dsrModal || dsrModal.dataset.wired === '1') return;
    dsrModal.dataset.wired = '1';
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
    if (!editModal) return;
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
    const editCepInput = document.getElementById('editCEP');
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
        MatriculaKN: document.getElementById('editMatriculaKN'),
        'Data de nascimento': document.getElementById('editDataNascimento'),
        'Data de admissão': document.getElementById('editDataAdmissao'),
        'Admissao KN': document.getElementById('editAdmissaoKn'),
        rg: document.getElementById('editRG'),
        telefone: document.getElementById('editTelefone'),
        email: document.getElementById('editEmail'),
        pis: document.getElementById('editPIS'),
        endereco_completo: document.getElementById('editEndereco'),
        numero: document.getElementById('editNumero'),
        bairro: document.getElementById('editBairro'),
        cidade: document.getElementById('editCidade'),
        colete: document.getElementById('editColete'),
        sapato: document.getElementById('editSapato')
    };
    attachUpperHandlersTo(editForm);
    if (editCepInput && editCepInput.dataset.cepWired !== '1') {
        editCepInput.dataset.cepWired = '1';
        editCepInput.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length > 5) {
                val = val.substring(0, 5) + '-' + val.substring(5, 8);
            }
            e.target.value = val;
            const numeros = val.replace(/\D/g, '');
            if (numeros.length === 8) {
                buscarEnderecoPorCep(numeros, 'edit');
            }
        });
    }
    if (editSVC) {
        if (editSVC.dataset.svcWired !== '1') {
            editSVC.dataset.svcWired = '1';
            editSVC.addEventListener('change', () => {
                const svc = (editSVC.value || '').toString().toUpperCase();
                const matrizAuto = svc ? (state.serviceMatrizMap.get(svc) || '') : '';
                if (editMatriz) editMatriz.value = matrizAuto || '';
                const regAuto = computeRegiaoFromSvcMatriz(svc, matrizAuto) || '';
                if (editRegiao) editRegiao.value = regAuto || '';
                populateGestorSelectForEdit(editSVC.value);
            });
        }
    }
    const editDSRBtn = document.getElementById('editDSRBtn');
    if (editDSRBtn && editDSRBtn.dataset.dsrWired !== '1') {
        editDSRBtn.dataset.dsrWired = '1';
        editDSRBtn.addEventListener('click', () => {
            openDsrModal(document.getElementById('editDSR'));
        });
    }
    if (editModal.dataset.wired === '1') return;
    editModal.dataset.wired = '1';
    editForm?.addEventListener('submit', onEditSubmit);
    editCancelarBtn?.addEventListener('click', hideEditModal);
    editAfastarBtn?.addEventListener('click', onAfastarClick);
    editEfetivarKnBtn?.addEventListener('click', openFluxoEfetivacaoModal);
    editFeriasBtn?.addEventListener('click', async () => {
        if (!editOriginal) return;
        const colab = await fetchColabByNome(editOriginal.Nome);
        if (!colab) {
            await window.customAlert('Colaborador não encontrado.', 'Erro');
            return;
        }
        openFeriasModal(colab);
    });
    editHistoricoBtn?.addEventListener('click', () => {
        if (!editOriginal?.Nome) return;
        openHistorico(editOriginal.Nome);
    });
    editExcluirBtn?.addEventListener('click', async () => {
        if (!state.isUserAdmin) {
            await window.customAlert('Apenas administradores podem excluir colaboradores.', 'Acesso Negado');
            return;
        }
        if (!editOriginal) return;
        const ok1 = await window.customConfirm('Deseja excluir o colaborador? Só faça isso em caso de duplicidade ou erros.', 'Atenção', 'warning');
        if (!ok1) return;
        const ok2 = await window.customConfirm('Tem certeza que deseja excluir? <b>Ação irreversível.</b>', 'Exclusão Definitiva', 'danger');
        if (!ok2) return;
        try {
            editExcluirBtn.disabled = true;
            editExcluirBtn.textContent = 'Excluindo...';
            const {error} = await supabase.from('Colaboradores').delete().eq('Nome', editOriginal.Nome);
            if (error) throw error;
            await window.customAlert('Colaborador excluído com sucesso!', 'Sucesso');
            logAction(`EXCLUIU (PERMANENTEMENTE) o colaborador: ${editOriginal.Nome}`);
            document.dispatchEvent(new CustomEvent('colaborador-deleted', {detail: {nome: editOriginal.Nome}}));
            hideEditModal();
            invalidateColaboradoresCache();
            await fetchColaboradores();
        } catch (error) {
            console.error('Erro ao excluir:', error);
            await window.customAlert(`Erro ao excluir: ${error.message}`, 'Erro');
        } finally {
            editExcluirBtn.disabled = false;
            editExcluirBtn.textContent = 'Excluir Colaborador';
        }
    });
    editDesligarBtn?.addEventListener('click', async () => {
        if (!editOriginal) return;
        const continuar = await showAvisoDesligamento();
        if (!continuar) return;
        const colab = await fetchColabByNome(editOriginal.Nome);
        if (!colab) {
            await window.customAlert('Colaborador não encontrado.', 'Erro');
            return;
        }
        openDesligarModalFromColab(colab);
    });
    document.addEventListener('open-edit-modal', async (evt) => {
        const nome = evt.detail?.nome;
        if (!nome) return;
        try {
            await loadServiceMatrizForEdit();
            const colab = await fetchColabByNome(nome);
            if (!colab) {
                await window.customAlert('Colaborador não encontrado.', 'Erro');
                return;
            }
            await fillEditForm(colab);
            showEditModal();
        } catch (err) {
            console.error(err);
            await window.customAlert('Erro ao carregar colaborador para edição.', 'Erro');
        }
    });
}function wireDesligar() {
    desligarModal = document.getElementById('desligarModal');
    if (!desligarModal || desligarModal.dataset.wired === '1') return;
    desligarModal.dataset.wired = '1';
    desligarForm = document.getElementById('desligarForm');
    desligarNomeEl = document.getElementById('desligarNome');
    desligarDataEl = document.getElementById('desligarData');
    desligarMotivoEl = document.getElementById('desligarMotivo');
    desligarCancelarBtn = document.getElementById('desligarCancelarBtn');
    desligarSmartoffEl = document.getElementById('desligarSmartoff');
    desligarSmartoffContainer = document.getElementById('desligarSmartoffContainer');
    desligarConfirmarBtn = desligarForm.querySelector('button[type="submit"]');
    desligarCancelarBtn?.addEventListener('click', closeDesligarModal);
    desligarForm?.addEventListener('submit', onDesligarSubmit);
    if (desligarSmartoffEl) {
        desligarSmartoffEl.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '');
            if (val.length > 10) {
                val = val.slice(0, 10);
            }
            e.target.value = val;
            if (desligarConfirmarBtn && desligarSmartoffContainer && !desligarSmartoffContainer.classList.contains('hidden')) {
                if (val.length >= 6 && val.length <= 10) {
                    desligarConfirmarBtn.disabled = false;
                } else {
                    desligarConfirmarBtn.disabled = true;
                }
            } else if (desligarConfirmarBtn) {
                desligarConfirmarBtn.disabled = false;
            }
        });
    }
}async function ensureXLSX() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Falha ao carregar biblioteca XLSX'));
        document.head.appendChild(s);
    });
}async function exportColaboradoresXLSX(useFiltered) {
    const data = useFiltered ? state.dadosFiltrados : state.colaboradoresData;
    if (!data || data.length === 0) {
        await window.customAlert('Não há dados para exportar.', 'Aviso');
        return;
    }
    await ensureXLSX();
    const mapColabToExportRow = (c) => {
        const fmt = (v) => v == null ? '' : v;
        const fmtDate = (v) => v ? formatDateLocal(String(v)) : '';
        return {
            'Nome': fmt(c.Nome),
            'Contrato': fmt(c.Contrato),
            'Cargo': fmt(c.Cargo),
            'Data de admissão': fmtDate(c['Data de admissão']),
            'Gestor': fmt(c.Gestor),
            'Escala': fmt(c.Escala),
            'DSR': fmt(c.DSR),
            'Ativo': fmt(c.Ativo),
            'Ferias': fmt(c.Ferias),
            'Genero': fmt(c.Genero),
            'Data de nascimento': fmtDate(c['Data de nascimento']),
            'SVC': fmt(c.SVC),
            'CPF': fmt(c.CPF),
            'LDAP': fmt(c.LDAP),
            'ID GROOT': c['ID GROOT'] ?? '',
            'FOLGA ESPECIAL': fmt(c['FOLGA ESPECIAL']),
            'MATRIZ': fmt(c.MATRIZ),
            'Admissao KN': fmtDate(c['Admissao KN']),
            'REGIAO': fmt(c.REGIAO),
            'rg': fmt(c.rg),
            'telefone': fmt(c.telefone),
            'email': fmt(c.email),
            'pis': fmt(c.pis),
            'endereco_completo': fmt(c.endereco_completo),
            'numero': fmt(c.numero),
            'bairro': fmt(c.bairro),
            'cidade': fmt(c.cidade),
            'colete': fmt(c.colete),
            'sapato': fmt(c.sapato),
            'DataRetorno': fmtDate(c.DataRetorno),
            'CEP': fmt(c.CEP),
            'MatriculaKN': fmt(c.MatriculaKN)
        };
    };
    const rows = data.map(mapColabToExportRow);
    const headers = Object.keys(rows[0]);
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(rows, {header: headers});
    const colWidths = headers.map(h => {
        const maxLen = Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length));
        return {wch: Math.min(Math.max(10, maxLen + 2), 50)};
    });
    ws['!cols'] = colWidths;
    window.XLSX.utils.book_append_sheet(wb, ws, 'Colaboradores');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const suffix = useFiltered ? 'filtrado' : 'completo';
    window.XLSX.writeFile(wb, `colaboradores-${suffix}-${stamp}.xlsx`);
}function wireFluxoEfetivacao() {
    fluxoEfetivacaoModal = document.getElementById('fluxoEfetivacaoModal');
    if (!fluxoEfetivacaoModal) {
        console.warn("Modal de fluxo de efetivação (id='fluxoEfetivacaoModal') não encontrado. A funcionalidade não será ativada.");
        return;
    }
    if (fluxoEfetivacaoModal.dataset.wired === '1') {
        console.log("Modal de fluxo já 'wired'. Pulando.");
        return;
    }
    fluxoEfetivacaoModal.dataset.wired = '1';
    console.log("Modal de fluxo de efetivação encontrado. Carregando...");
    fluxoEfetivacaoForm = document.getElementById('fluxoEfetivacaoForm');
    fluxoEfetivacaoNomeEl = document.getElementById('fluxoEfetivacaoNome');
    fluxoNumeroEl = document.getElementById('fluxoNumero');
    fluxoDataAberturaEl = document.getElementById('fluxoDataAbertura');
    fluxoObservacaoEl = document.getElementById('fluxoObservacao');
    fluxoAdmissaoKnEl = document.getElementById('fluxoAdmissaoKnData');
    fluxoGerarBtn = document.getElementById('fluxoGerarBtn');
    fluxoFinalizarBtn = document.getElementById('fluxoFinalizarBtn');
    fluxoCancelarBtn = document.getElementById('fluxoCancelarBtn');
    fluxoSairBtn = document.getElementById('fluxoCancelarEfetivacaoBtn');
    fluxoEfetivacaoForm?.addEventListener('submit', (e) => e.preventDefault());
    fluxoGerarBtn?.addEventListener('click', () => handleFluxoSubmit('gerar'));
    fluxoFinalizarBtn?.addEventListener('click', () => handleFluxoSubmit('finalizar'));
    fluxoCancelarBtn?.addEventListener('click', () => handleFluxoSubmit('cancelar'));
    fluxoSairBtn?.addEventListener('click', closeFluxoEfetivacaoModal);
    fluxoEfetivacaoModal.addEventListener('click', (e) => {
        if (e.target === fluxoEfetivacaoModal) {
            closeFluxoEfetivacaoModal();
        }
    });
}function wireTabelaColaboradoresEventos() {
    if (!colaboradoresTbody) return;
    if (colaboradoresTbody.dataset.wired === '1') return;
    colaboradoresTbody.dataset.wired = '1';
    colaboradoresTbody.addEventListener('click', (event) => {
        const tr = event.target.closest('tr[data-nome]');
        if (!tr) return;
        const nome = tr.dataset.nome;
        if (!nome) return;
        if (event.ctrlKey || event.metaKey) {
            const sel = window.getSelection();
            if (sel) sel.removeAllRanges();
            if (state.selectedNames.has(nome)) {
                state.selectedNames.delete(nome);
                tr.classList.remove('selecionado');
            } else {
                state.selectedNames.add(nome);
                tr.classList.add('selecionado');
            }
        } else if (event.shiftKey) {
            event.preventDefault();
            const sel = window.getSelection();
            if (sel) sel.removeAllRanges();
            const rows = Array.from(colaboradoresTbody.querySelectorAll('tr[data-nome]'));
            const currentIndex = rows.indexOf(tr);
            let startIndex = rows.findIndex(r => r.classList.contains('selecionado'));
            if (startIndex === -1) startIndex = currentIndex;
            const min = Math.min(startIndex, currentIndex);
            const max = Math.max(startIndex, currentIndex);
            for (let i = min; i <= max; i++) {
                const row = rows[i];
                const n = row.dataset.nome;
                if (n) {
                    state.selectedNames.add(n);
                    row.classList.add('selecionado');
                }
            }
        }
    });
    colaboradoresTbody.addEventListener('dblclick', (event) => {
        if (document.body.classList.contains('user-level-visitante')) return;
        const tr = event.target.closest('tr[data-nome]');
        if (!tr) return;
        const nome = (tr.dataset.nome || '').trim();
        if (!nome) return;
        const sel = window.getSelection && window.getSelection();
        if (sel) {
            try {
                sel.removeAllRanges();
            } catch {
            }
        }
        document.dispatchEvent(
            new CustomEvent('open-edit-modal', {detail: {nome}})
        );
    });
}export async function init() {
    state.isModuleActive = true;
    colaboradoresTbody = document.getElementById('colaboradores-tbody');
    wireTabelaColaboradoresEventos();
    searchInput = document.getElementById('search-input');
    filtrosSelect = document.querySelectorAll('.filters select');
    limparFiltrosBtn = document.getElementById('limpar-filtros-btn');
    addColaboradorBtn = document.getElementById('add-colaborador-btn');
    mostrarMaisBtn = document.getElementById('mostrar-mais-btn');
    mostrarMenosBtn = document.getElementById('mostrar-menos-btn');
    contadorVisiveisEl = document.getElementById('contador-visiveis');
    addForm = document.getElementById('addForm');
    dropdownAdd = document.getElementById('dropdownAdd');
    btnAdicionarManual = document.getElementById('btnAdicionarManual');
    btnImportarRH = document.getElementById('btnImportarRH');
    modalListaRH = document.getElementById('modalListaRH');
    tbodyCandidatosRH = document.getElementById('tbodyCandidatosRH');
    fecharModalRH = document.getElementById('fecharModalRH');
    checkUserAdminStatus();
    setOnFeriasChangeCallback(async () => {
        if (!state.isModuleActive) return;
        console.log("Status de férias atualizado em background. Atualizando tela...");
        invalidateColaboradoresCache();
        await fetchColaboradores();
    });
    wireFerias();
    await ensureMatrizesDataLoaded();
    fetchColaboradores();
    processarStatusFerias().then(() => {
        console.log("Verificação inicial de férias concluída (background).");
    }).catch(err => console.error("Erro na verificação de férias background:", err));
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
        addColaboradorBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (document.body.classList.contains('user-level-visitante')) return;
            if (dropdownAdd) dropdownAdd.classList.toggle('hidden');
        });
    }
    document.addEventListener('click', (event) => {
        if (dropdownAdd && !dropdownAdd.contains(event.target) && event.target !== addColaboradorBtn) {
            dropdownAdd.classList.add('hidden');
        }
    });
    if (btnAdicionarManual) {
        btnAdicionarManual.addEventListener('click', async () => {
            dropdownAdd.classList.add('hidden');
            await prepararFormularioAdicao();
            document.dispatchEvent(new CustomEvent('open-add-modal'));
            preencherFormularioAdicao({});
        });
    }
    if (btnImportarRH) {
        btnImportarRH.addEventListener('click', () => {
            dropdownAdd.classList.add('hidden');
            modalListaRH.classList.remove('hidden');
            fetchCandidatosAprovados();
        });
    }
    if (fecharModalRH) {
        fecharModalRH.addEventListener('click', () => {
            modalListaRH.classList.add('hidden');
        });
    }
    window.addEventListener('click', (e) => {
        if (e.target === modalListaRH) modalListaRH.classList.add('hidden');
    });
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
        document.addEventListener('colaborador-edited', async (e) => {
            if (document.querySelector('[data-page="colaboradores"].active')) {
                await fetchColaboradores();
            } else {
                invalidateColaboradoresCache();
            }
        });
        document.addEventListener('colaborador-deleted', async (e) => {
            if (document.querySelector('[data-page="colaboradores"].active')) {
                await fetchColaboradores();
            } else {
                invalidateColaboradoresCache();
            }
        });
        document.addEventListener('colaborador-added', async (e) => {
            if (document.querySelector('[data-page="colaboradores"].active')) {
                await fetchColaboradores();
            } else {
                invalidateColaboradoresCache();
            }
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
    const gerarQRBtn = document.getElementById('gerar-qr-btn');
    if (gerarQRBtn) {
        gerarQRBtn.addEventListener('click', gerarJanelaDeQRCodes);
    }
    wireEdit();
    wireDesligar();
    wireFluxoEfetivacao();
    wireDsrModal();
    wireCepEvents();
}export function destroy() {    state.isModuleActive = false;    const alertDiv = document.getElementById('pending-import-alert');
    if (alertDiv) {
        alertDiv.remove();
    }    cachedColaboradores = null;
    cachedFeriasStatus = null;
    lastFetchTimestamp = 0;
    state.colaboradoresData = [];
    state.dadosFiltrados = [];
    state.filtrosAtivos = {};    try { state.gestoresData = []; } catch {}
    try { state.matrizesData = []; } catch {}
    try { state.serviceMatrizMap?.clear?.(); } catch {}
    try { state.serviceRegiaoMap?.clear?.(); } catch {}
    try { state.matrizRegiaoMap?.clear?.(); } catch {}
    try { state.selectedNames?.clear?.(); } catch {}
    try { state.feriasAtivasMap?.clear?.(); } catch {}    console.log("Cache de colaboradores e estado local destruídos ao sair do módulo.");
}export function garantirModalEdicaoAtivo() {
    if (!editModal || editModal.dataset.wired !== '1') {
        console.log("Iniciando Modal de Edição via Dados Operacionais...");
        wireEdit();
    }
}