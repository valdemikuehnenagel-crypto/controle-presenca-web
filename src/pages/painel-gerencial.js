import {supabase} from '../supabaseClient.js';let _loginsCache = null;
let _matrizesCache = null;let state = {
    matrizesData: [],
    loginsData: [],
    svcMap: new Map(),
    usuarioEmEdicao: null,
};
let registrarMatrizBtn, registrarGestorBtn;
let matrizModal, matrizForm;
let gestorModal, gestorForm, gestorNomeInput, gestorMatrizesCheckboxContainer, gestorServicesVinculadosDisplay;
let editUserModal, editUserForm, btnExcluirUsuario;
let filterAprovacao, filterTipo, filterMatriz, filterSvc, limparFiltrosBtn;function getUsuarioDaSessao() {
    try {
        const sessionData = localStorage.getItem('userSession');
        return sessionData ? JSON.parse(sessionData) : null;
    } catch (e) {
        console.error("Falha ao ler a sessão do usuário:", e);
        return null;
    }
}async function getCachedLogins() {
    if (_loginsCache) {
        return _loginsCache;
    }
    const {data, error} = await supabase
        .from('Logins')
        .select('Usuario, Nome, Aprovacao, Tipo, Matriz')
        .order('Nome', {ascending: true});    if (error) {
        console.error('Erro ao buscar logins:', error);
        throw error;
    }
    _loginsCache = data || [];
    return _loginsCache;
}async function getCachedMatrizes() {
    if (_matrizesCache) {
        return _matrizesCache;
    }
    const {data, error} = await supabase
        .from('Matrizes')
        .select('MATRIZ, SERVICE');    if (error) {
        console.error('Erro ao buscar matrizes:', error);
        throw error;
    }
    const matrizesList = data || [];
    const svcMap = new Map(matrizesList.map(item => [item.MATRIZ, item.SERVICE]));
    _matrizesCache = {list: matrizesList, map: svcMap};
    return _matrizesCache;
}function invalidateCache(which = 'all') {
    if (which === 'logins' || which === 'all') {
        _loginsCache = null;
    }
    if (which === 'matrizes' || which === 'all') {
        _matrizesCache = null;
    }
}function populateFilters() {    [filterAprovacao, filterTipo, filterMatriz, filterSvc].forEach(select => {
        while (select.options.length > 1) {
            select.remove(1);
        }
    });    const aprovacoes = [...new Set(state.loginsData.map(u => u.Aprovacao).filter(Boolean))].sort();
    const tipos = [...new Set(state.loginsData.map(u => u.Tipo).filter(Boolean))].sort();
    const matrizes = [...new Set(state.matrizesData.map(m => m.MATRIZ).filter(Boolean))].sort();
    const svcs = [...new Set(state.matrizesData.map(m => m.SERVICE).filter(Boolean))].sort();    aprovacoes.forEach(val => filterAprovacao.add(new Option(val, val)));
    tipos.forEach(val => filterTipo.add(new Option(val, val)));
    matrizes.forEach(val => filterMatriz.add(new Option(val, val)));
    svcs.forEach(val => filterSvc.add(new Option(val, val)));
}function applyFilters() {
    const filtroAprovacao = filterAprovacao.value;
    const filtroTipo = filterTipo.value;
    const filtroMatriz = filterMatriz.value;
    const filtroSvc = filterSvc.value;    let filteredLogins = state.loginsData.filter(user => {        if (filtroAprovacao && user.Aprovacao !== filtroAprovacao) return false;
        if (filtroTipo && user.Tipo !== filtroTipo) return false;        const userMatrizes = (user.Matriz || '').split(',').map(m => m.trim());        if (filtroMatriz && user.Matriz !== 'TODOS' && !userMatrizes.includes(filtroMatriz)) return false;        if (filtroSvc) {
            if (user.Matriz === 'TODOS') {            } else {
                const userSvcs = new Set(userMatrizes.map(m => state.svcMap.get(m)).filter(Boolean));
                if (!userSvcs.has(filtroSvc)) return false;
            }
        }
        return true;
    });    filteredLogins.sort((a, b) => {        const aIsPendente = a.Aprovacao === 'PENDENTE';
        const bIsPendente = b.Aprovacao === 'PENDENTE';        if (aIsPendente && !bIsPendente) {
            return -1;
        } else if (!aIsPendente && bIsPendente) {
            return 1;
        } else {            return (a.Nome || '').localeCompare(b.Nome || '', 'pt-BR');
        }
    });    renderTable(filteredLogins);
}function renderTable(logins) {
    const tbody = document.getElementById('relatorio-logins-tbody');
    if (!tbody) return;
    if (!logins || logins.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Nenhum usuário encontrado com os filtros aplicados.</td></tr>`;
        return;
    }
    tbody.innerHTML = logins.map(row => {
        const aprovacaoStatus = row.Aprovacao === 'SIM' ? '<span class="status-ativo">Ativo</span>' : `<span class="status-pendente">${row.Aprovacao || 'Pendente'}</span>`;
        let svc = 'N/D';
        const matrizDoUsuario = row.Matriz;        if (matrizDoUsuario === 'TODOS') {
            svc = 'TODOS';
        } else if (typeof matrizDoUsuario === 'string') {
            const matrizesArray = matrizDoUsuario.split(',').map(m => m.trim());            const svcs = matrizesArray.map(m => state.svcMap.get(m)).filter(Boolean);
            svc = [...new Set(svcs)].join(', ') || 'N/D';
        }
        const matrizDisplay = matrizDoUsuario || 'N/D';
        return `<tr class="cursor-pointer hover:bg-gray-100" data-usuario="${row.Usuario}"><td>${row.Nome || 'N/D'}</td><td>${aprovacaoStatus}</td><td>${row.Tipo || 'N/D'}</td><td>${matrizDisplay}</td><td>${svc}</td></tr>`;
    }).join('');    tbody.querySelectorAll('tr').forEach(tr => {
        tr.addEventListener('click', () => {
            const usuario = tr.dataset.usuario;
            if (usuario) openEditUserModal(usuario);
        });
    });
}async function loadAndDisplayData() {
    const tbody = document.getElementById('relatorio-logins-tbody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center;">Carregando relatório...</td></tr>`;    try {        const [logins, matrizesCache] = await Promise.all([
            getCachedLogins(),
            getCachedMatrizes()
        ]);        state.loginsData = logins;
        state.matrizesData = matrizesCache.list;
        state.svcMap = matrizesCache.map;        populateFilters();
        applyFilters();    } catch (error) {
        console.error('Erro ao buscar dados para o relatório:', error);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-red-500">Erro ao carregar relatório.</td></tr>`;
    }
}async function handleRegistrarMatriz(event) {
    event.preventDefault();
    const service = document.getElementById('matrizService').value.trim().toUpperCase();
    const matriz = document.getElementById('matrizNome').value.trim().toUpperCase();
    if (!service || !matriz) {
        alert('Por favor, preencha todos os campos.');
        return;
    }
    const {error} = await supabase.from('Matrizes').insert([{SERVICE: service, MATRIZ: matriz}]);
    if (error) {
        console.error('Erro ao registrar matriz:', error);
        alert(`Erro ao salvar: ${error.message}`);
    } else {
        alert('Matriz/Service registrada com sucesso!');
        matrizForm.reset();
        matrizModal.classList.add('hidden');        window.dispatchEvent(new CustomEvent('matriz-saved'));
    }
}async function handleRegistrarGestor(event) {
    event.preventDefault();
    const nome = gestorNomeInput.value.trim().toUpperCase();
    const matrizesSelecionadas = Array.from(gestorMatrizesCheckboxContainer.querySelectorAll('input[type="checkbox"]:checked')).map(checkbox => checkbox.value);
    if (!nome || matrizesSelecionadas.length === 0) {
        alert('Preencha o nome e selecione pelo menos uma matriz.');
        return;
    }
    const servicesVinculados = state.matrizesData
        .filter(item => matrizesSelecionadas.includes(item.MATRIZ))
        .map(item => item.SERVICE);
    const servicesUnicos = [...new Set(servicesVinculados)];
    const matrizParaSalvar = matrizesSelecionadas.join(', ');
    const svcParaSalvar = servicesUnicos.join(', ');    const {error} = await supabase.from('Gestores').insert([{
        NOME: nome,
        MATRIZ: matrizParaSalvar,
        SVC: svcParaSalvar
    }]);    if (error) {
        console.error('Erro ao registrar gestor:', error);
        alert(`Erro ao salvar: ${error.message}`);
    } else {
        alert('Gestor registrado com sucesso!');
        gestorForm.reset();
        gestorModal.classList.add('hidden');        window.dispatchEvent(new CustomEvent('gestor-saved'));
    }
}async function handleEditUserSubmit(event) {
    event.preventDefault();
    if (!state.usuarioEmEdicao) {
        alert("Erro: Nenhum usuário selecionado para edição.");
        return;
    }
    const matrizesSelecionadas = Array.from(document.querySelectorAll('#editUserMatrizesCheckbox input:checked')).map(cb => cb.value);
    const matrizParaSalvar = (matrizesSelecionadas.length === 1 && matrizesSelecionadas[0] === 'TODOS') ? 'TODOS' : matrizesSelecionadas.join(', ');    const payload = {
        Nome: document.getElementById('editUserNome').value,
        Usuario: document.getElementById('editUserUsuario').value,
        Aprovacao: document.getElementById('editUserAprovacao').value,
        Tipo: document.getElementById('editUserTipo').value,
        Matriz: matrizParaSalvar
    };
    const pin = document.getElementById('editUserPin').value;
    if (pin) {
        if (pin.length !== 6 || !/^\d+$/.test(pin)) {
            alert("O PIN deve conter exatamente 6 dígitos numéricos.");
            return;
        }
        payload.PIN = pin;
    }    const {error} = await supabase
        .from('Logins')
        .update(payload)
        .eq('Usuario', state.usuarioEmEdicao.Usuario);    if (error) {
        alert(`Erro ao atualizar usuário: ${error.message}`);
        console.error(error);
    } else {
        alert("Usuário atualizado com sucesso!");
        editUserModal.classList.add('hidden');        window.dispatchEvent(new CustomEvent('login-updated', {detail: {usuario: payload.Usuario}}));
    }
}async function handleDeleteUser() {
    if (!state.usuarioEmEdicao) {
        alert("Erro: Nenhum usuário selecionado.");
        return;
    }
    const confirmacao = confirm(`Tem certeza que deseja EXCLUIR o usuário "${state.usuarioEmEdicao.Nome}" (${state.usuarioEmEdicao.Usuario})? Esta ação não pode ser desfeita.`);
    if (!confirmacao) return;    const {error} = await supabase
        .from('Logins')
        .delete()
        .eq('Usuario', state.usuarioEmEdicao.Usuario);    if (error) {
        alert(`Erro ao excluir usuário: ${error.message}`);
    } else {
        alert("Usuário excluído com sucesso!");
        editUserModal.classList.add('hidden');        window.dispatchEvent(new CustomEvent('login-deleted', {detail: {usuario: state.usuarioEmEdicao.Usuario}}));
    }
}async function openEditUserModal(usuarioId) {    let userData = state.loginsData.find(u => u.Usuario === usuarioId);    if (!userData) {        console.warn(`Usuário ${usuarioId} não encontrado no cache. Buscando no banco.`);
        const {data, error} = await supabase.from('Logins').select('*').eq('Usuario', usuarioId).single();
        if (error || !data) {
            alert("Não foi possível carregar os dados do usuário.");
            console.error(error);
            return;
        }
        userData = data;
    }    state.usuarioEmEdicao = userData;
    document.getElementById('editUserNome').value = userData.Nome || '';
    document.getElementById('editUserUsuario').value = userData.Usuario || '';
    document.getElementById('editUserAprovacao').value = userData.Aprovacao || 'PENDENTE';
    document.getElementById('editUserPin').value = '';    const tipoSelect = document.getElementById('editUserTipo');
    if (tipoSelect) {
        let tipoDoBanco = (userData.Tipo || '').toUpperCase();        if (tipoDoBanco.endsWith('A')) {
            const masculino = tipoDoBanco.slice(0, -1);
            if (Array.from(tipoSelect.options).some(opt => opt.value === masculino)) {
                tipoDoBanco = masculino;
            }
        }
        tipoSelect.value = tipoDoBanco;        if (tipoSelect.value !== tipoDoBanco) {
            console.warn(`Tipo "${tipoDoBanco}" não encontrado nas opções do select.`);
            tipoSelect.value = '';
        }
    }    const matrizesContainer = document.getElementById('editUserMatrizesCheckbox');
    let userMatrizes = [];
    if (typeof userData.Matriz === 'string' && userData.Matriz) {
        userMatrizes = userData.Matriz.split(',').map(m => m.trim());
    }    const nomesMatrizesUnicas = [...new Set(state.matrizesData.map(item => item.MATRIZ))];
    if (!nomesMatrizesUnicas.includes('TODOS')) {
        nomesMatrizesUnicas.unshift('TODOS');
    }    matrizesContainer.innerHTML = nomesMatrizesUnicas.map(matriz => {
        const isChecked = userMatrizes.includes(matriz) ? 'checked' : '';
        return `<label class="checkbox-label"><input type="checkbox" value="${matriz}" ${isChecked}> ${matriz}</label>`;
    }).join('');    editUserModal.classList.remove('hidden');
}function preencherCheckboxesMatrizes() {
    const container = document.getElementById('gestorMatrizesCheckbox');    const nomesMatrizesUnicas = [...new Set(state.matrizesData.map(item => item.MATRIZ))];
    if (nomesMatrizesUnicas.length === 0) {
        container.innerHTML = '<span>Nenhuma matriz encontrada. Registre uma primeiro.</span>';
        return;
    }
    container.innerHTML = nomesMatrizesUnicas.map(matriz =>
        `<label class="checkbox-label"><input type="checkbox" name="matriz" value="${matriz}"> ${matriz}</label>`
    ).join('');    container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', atualizarServicesVinculados);
    });
}function atualizarServicesVinculados() {
    const container = document.getElementById('gestorMatrizesCheckbox');
    const display = document.getElementById('gestorServicesVinculados');
    const matrizesSelecionadas = Array.from(container.querySelectorAll('input[type="checkbox"]:checked'))
        .map(checkbox => checkbox.value);    if (matrizesSelecionadas.length === 0) {
        display.innerHTML = '<span>Selecione uma matriz para ver os services.</span>';
        return;
    }    const servicesVinculados = state.matrizesData
        .filter(item => matrizesSelecionadas.includes(item.MATRIZ))
        .map(item => item.SERVICE);
    const servicesUnicos = [...new Set(servicesVinculados)];    display.innerHTML = servicesUnicos.map(service => `<span class="service-tag">${service}</span>`).join('');
}export async function init() {
    const usuarioLogado = getUsuarioDaSessao();    const userNivel = (usuarioLogado?.Nivel || '').toLowerCase();    if (userNivel !== 'administrador') {
        console.warn(`Painel Gerencial: Acesso bloqueado. Nível detectado: [${userNivel || 'Nenhum'}]`);        const container = document.getElementById('dados-op-result');
        if (container) {
            container.innerHTML = `
                <div style="padding: 2rem; text-align: center;">
                    <h2 style="color: #dc3545; font-size: 1.5rem;">Acesso Bloqueado</h2>
                    <p style="font-size: 1.1rem; margin-top: 0.5rem;">
                        Apenas usuários com nível "Administrador" podem acessar esta página.
                    </p>
                    <p style="color: #6c757d; margin-top: 1rem;">
                        (Nível detectado: <strong>${userNivel ? userNivel.charAt(0).toUpperCase() + userNivel.slice(1) : 'Nenhum'}</strong>)
                    </p>
                </div>
            `;
        }        const loader = document.getElementById('dados-op-loader');
        if (loader) loader.style.display = 'none';        return;
    }    console.log('Painel Gerencial: Acesso de Administrador concedido.');    registrarMatrizBtn = document.getElementById('btnAbrirModalMatriz');
    registrarGestorBtn = document.getElementById('btnAbrirModalGestor');
    matrizModal = document.getElementById('matrizModal');
    matrizForm = document.getElementById('matrizForm');
    gestorModal = document.getElementById('gestorModal');
    gestorForm = document.getElementById('gestorForm');
    gestorNomeInput = document.getElementById('gestorNome');
    gestorMatrizesCheckboxContainer = document.getElementById('gestorMatrizesCheckbox');
    gestorServicesVinculadosDisplay = document.getElementById('gestorServicesVinculados');
    editUserModal = document.getElementById('editUserModal');
    editUserForm = document.getElementById('editUserForm');
    btnExcluirUsuario = document.getElementById('btnExcluirUsuario');
    filterAprovacao = document.getElementById('filter-aprovacao');
    filterTipo = document.getElementById('filter-tipo');
    filterMatriz = document.getElementById('filter-matriz');
    filterSvc = document.getElementById('filter-svc');
    limparFiltrosBtn = document.getElementById('limpar-filtros-gerencial');    if (!registrarMatrizBtn || !registrarGestorBtn || !matrizModal || !matrizForm || !gestorModal || !gestorForm || !editUserModal || !editUserForm || !btnExcluirUsuario || !filterAprovacao || !filterTipo || !filterMatriz || !filterSvc || !limparFiltrosBtn) {
        console.error("Painel Gerencial: Elementos essenciais do DOM não encontrados APÓS verificação de acesso. Verifique os IDs no HTML da página.");
        const container = document.getElementById('dados-op-result');
        if (container) {
            container.innerHTML = `<div class="erro-setup" style="padding: 2rem; text-align: center;"><p style="color: #dc3545;">Erro crítico: Falha ao inicializar a interface do Painel Gerencial (elementos não encontrados). Contate o suporte.</p></div>`;
        }
        return;
    }    registrarMatrizBtn.addEventListener('click', () => {
        matrizForm.reset();
        matrizModal.classList.remove('hidden');
    });    registrarGestorBtn.addEventListener('click', async () => {
        try {
            await getCachedMatrizes();
            gestorForm.reset();
            preencherCheckboxesMatrizes();
            atualizarServicesVinculados();
            gestorModal.classList.remove('hidden');
        } catch (error) {
            console.error("Erro ao preparar modal de gestor:", error);
            alert("Não foi possível carregar os dados necessários para abrir o modal de gestor.");
        }
    });    matrizForm.addEventListener('submit', handleRegistrarMatriz);
    gestorForm.addEventListener('submit', handleRegistrarGestor);
    editUserForm.addEventListener('submit', handleEditUserSubmit);
    btnExcluirUsuario.addEventListener('click', handleDeleteUser);    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-close-modal');
            document.getElementById(modalId)?.classList.add('hidden');
        });
    });    filterAprovacao.addEventListener('change', applyFilters);
    filterTipo.addEventListener('change', applyFilters);
    filterMatriz.addEventListener('change', applyFilters);
    filterSvc.addEventListener('change', applyFilters);    limparFiltrosBtn.addEventListener('click', () => {
        filterAprovacao.value = '';
        filterTipo.value = '';
        filterMatriz.value = '';
        filterSvc.value = '';
        applyFilters();
    });    window.addEventListener('matriz-saved', () => {
        invalidateCache('matrizes');
        loadAndDisplayData();
    });
    window.addEventListener('login-updated', () => {
        invalidateCache('logins');
        loadAndDisplayData();
    });
    window.addEventListener('login-deleted', () => {
        invalidateCache('logins');
        loadAndDisplayData();
    });
    window.addEventListener('gestor-saved', () => {        loadAndDisplayData();
    });    await loadAndDisplayData();
}