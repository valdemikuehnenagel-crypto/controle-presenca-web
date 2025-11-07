import {supabase} from '../supabaseClient.js';let _loginsCache = null;
let _matrizesCache = null;
let _listeners = [];
let _mounted = false;
let _isAdmin = false;const state = {
    matrizesData: [],
    loginsData: [],
    svcMap: new Map(),
    usuarioEmEdicao: null,
};let registrarMatrizBtn, registrarGestorBtn;
let matrizModal, matrizForm;
let gestorModal, gestorForm, gestorNomeInput, gestorMatrizesCheckboxContainer, gestorServicesVinculadosDisplay;
let editUserModal, editUserForm, btnExcluirUsuario;
let filterAprovacao, filterTipo, filterMatriz, filterSvc, limparFiltrosBtn;function getUsuarioDaSessao() {
    try {
        const raw = localStorage.getItem('userSession');
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        console.error('Falha ao ler a sessão do usuário:', e);
        return null;
    }
}function renderAcessoBloqueado(containerId = 'dados-op-result', loaderId = 'dados-op-loader') {
    const container = document.getElementById(containerId);
    if (container) {
        container.innerHTML = `
      <div style="padding: 2rem; text-align: center; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
        <h2 style="color: #dc3545; font-size: 1.5rem; margin-bottom: 0.5rem;">Acesso Bloqueado</h2>
        <p style="font-size: 1.1rem; margin-top: 0.5rem; color: #343a40;">
          Apenas usuários com nível "Administrador" podem acessar esta página.
        </p>
        </div>
    `;
    }
    const loader = document.getElementById(loaderId);
    if (loader) loader.style.display = 'none';
}function gateIsAdmin() {
    const nivel = (getUsuarioDaSessao()?.Nivel || '').toLowerCase();
    return nivel === 'administrador';
}function invalidateCache(which = 'all') {
    if (which === 'logins' || which === 'all') _loginsCache = null;
    if (which === 'matrizes' || which === 'all') _matrizesCache = null;
}async function getCachedLogins() {
    if (!_isAdmin) return [];
    if (_loginsCache) return _loginsCache;
    const {data, error} = await supabase
        .from('Logins')
        .select('Usuario, Nome, Aprovacao, Tipo, Matriz')
        .order('Nome', {ascending: true});
    if (error) {
        console.error('Erro ao buscar Logins:', error);
        throw error;
    }
    _loginsCache = data || [];
    return _loginsCache;
}async function getCachedMatrizes() {
    if (!_isAdmin) return {list: [], map: new Map()};
    if (_matrizesCache) return _matrizesCache;
    const {data, error} = await supabase
        .from('Matrizes')
        .select('MATRIZ, SERVICE');
    if (error) {
        console.error('Erro ao buscar Matrizes:', error);
        throw error;
    }
    const list = data || [];
    const svcMap = new Map(list.map(item => [item.MATRIZ, item.SERVICE]));
    _matrizesCache = {list, map: svcMap};
    return _matrizesCache;
}function populateFilters() {
    if (!filterAprovacao || !filterTipo || !filterMatriz || !filterSvc) return;
    [filterAprovacao, filterTipo, filterMatriz, filterSvc].forEach(select => {
        while (select.options.length > 1) select.remove(1);
    });
    const aprovacoes = [...new Set(state.loginsData.map(u => u.Aprovacao).filter(Boolean))].sort();
    const tipos = [...new Set(state.loginsData.map(u => u.Tipo).filter(Boolean))].sort();
    const matrizes = [...new Set(state.matrizesData.map(m => m.MATRIZ).filter(Boolean))].sort();
    const svcs = [...new Set(state.matrizesData.map(m => m.SERVICE).filter(Boolean))].sort();    aprovacoes.forEach(v => filterAprovacao.add(new Option(v, v)));
    tipos.forEach(v => filterTipo.add(new Option(v, v)));
    matrizes.forEach(v => filterMatriz.add(new Option(v, v)));
    svcs.forEach(v => filterSvc.add(new Option(v, v)));
}function applyFilters() {
    const filtroA = filterAprovacao?.value || '';
    const filtroT = filterTipo?.value || '';
    const filtroM = filterMatriz?.value || '';
    const filtroS = filterSvc?.value || '';    let filtered = state.loginsData.filter(user => {
        if (filtroA && user.Aprovacao !== filtroA) return false;
        if (filtroT && user.Tipo !== filtroT) return false;        const userMatrizes = (user.Matriz || '').split(',').map(m => m.trim());
        if (filtroM && user.Matriz !== 'TODOS' && !userMatrizes.includes(filtroM)) return false;        if (filtroS) {
            if (user.Matriz === 'TODOS') {            } else {
                const userSvcs = new Set(userMatrizes.map(m => state.svcMap.get(m)).filter(Boolean));
                if (!userSvcs.has(filtroS)) return false;
            }
        }
        return true;
    });    filtered.sort((a, b) => {
        const aPend = a.Aprovacao === 'PENDENTE';
        const bPend = b.Aprovacao === 'PENDENTE';
        if (aPend && !bPend) return -1;
        if (!aPend && bPend) return 1;
        return (a.Nome || '').localeCompare(b.Nome || '', 'pt-BR');
    });    renderTable(filtered);
}function renderTable(logins) {
    const tbody = document.getElementById('relatorio-logins-tbody');
    if (!tbody) return;    if (!Array.isArray(logins) || !logins.length) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Nenhum usuário encontrado com os filtros aplicados.</td></tr>`;
        return;
    }    tbody.innerHTML = logins.map(row => {
        const aprovacaoStatus = row.Aprovacao === 'SIM'
            ? '<span class="status-ativo">Ativo</span>'
            : `<span class="status-pendente">${row.Aprovacao || 'Pendente'}</span>`;        let svc = 'N/D';
        const matrizDoUsuario = row.Matriz;
        if (matrizDoUsuario === 'TODOS') {
            svc = 'TODOS';
        } else if (typeof matrizDoUsuario === 'string') {
            const matrizesArray = matrizDoUsuario.split(',').map(m => m.trim());
            const svcs = matrizesArray.map(m => state.svcMap.get(m)).filter(Boolean);
            svc = [...new Set(svcs)].join(', ') || 'N/D';
        }        const matrizDisplay = matrizDoUsuario || 'N/D';
        return `
      <tr class="cursor-pointer hover:bg-gray-100" data-usuario="${row.Usuario}">
        <td>${row.Nome || 'N/D'}</td>
        <td>${aprovacaoStatus}</td>
        <td>${row.Tipo || 'N/D'}</td>
        <td>${matrizDisplay}</td>
        <td>${svc}</td>
      </tr>
    `;
    }).join('');    tbody.querySelectorAll('tr').forEach(tr => {
        const fn = () => {
            const usuario = tr.dataset.usuario;
            if (usuario) openEditUserModal(usuario);
        };
        tr.addEventListener('click', fn);
        _listeners.push(() => tr.removeEventListener('click', fn));
    });
}async function loadAndDisplayData() {
    const tbody = document.getElementById('relatorio-logins-tbody');
    if (!tbody) return;
    if (!_isAdmin) {        renderAcessoBloqueado('tab-painel-gerencial', null);
        return;
    }    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Carregando relatório...</td></tr>`;    try {
        const [logins, matrizesCache] = await Promise.all([
            getCachedLogins(),
            getCachedMatrizes(),
        ]);        state.loginsData = logins;
        state.matrizesData = matrizesCache.list;
        state.svcMap = matrizesCache.map;        populateFilters();
        applyFilters();
    } catch (error) {
        console.error('Erro ao buscar dados para o relatório:', error);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-red-500">Erro ao carregar relatório.</td></tr>`;
    }
}async function handleRegistrarMatriz(e) {
    e.preventDefault();
    if (!_isAdmin) return;    const service = document.getElementById('matrizService')?.value?.trim()?.toUpperCase();
    const matriz = document.getElementById('matrizNome')?.value?.trim()?.toUpperCase();
    if (!service || !matriz) {
        alert('Por favor, preencha todos os campos.');
        return;
    }    const {error} = await supabase.from('Matrizes').insert([{SERVICE: service, MATRIZ: matriz}]);
    if (error) {
        console.error('Erro ao registrar matriz:', error);
        alert(`Erro ao salvar: ${error.message}`);
        return;
    }    alert('Matriz/Service registrada com sucesso!');
    matrizForm.reset();
    matrizModal.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('matriz-saved'));
}async function handleRegistrarGestor(e) {
    e.preventDefault();
    if (!_isAdmin) return;    const nome = gestorNomeInput.value.trim().toUpperCase();
    const matrizesSelecionadas = Array.from(gestorMatrizesCheckboxContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
    if (!nome || matrizesSelecionadas.length === 0) {
        alert('Preencha o nome e selecione pelo menos uma matriz.');
        return;
    }    const servicesVinculados = state.matrizesData
        .filter(item => matrizesSelecionadas.includes(item.MATRIZ))
        .map(item => item.SERVICE);
    const servicesUnicos = [...new Set(servicesVinculados)];
    const matrizParaSalvar = matrizesSelecionadas.join(', ');
    const svcParaSalvar = servicesUnicos.join(', ');    const {error} = await supabase.from('Gestores').insert([{
        NOME: nome,
        MATRIZ: matrizParaSalvar,
        SVC: svcParaSalvar
    }]);
    if (error) {
        console.error('Erro ao registrar gestor:', error);
        alert(`Erro ao salvar: ${error.message}`);
        return;
    }    alert('Gestor registrado com sucesso!');
    gestorForm.reset();
    gestorModal.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('gestor-saved'));
}async function handleEditUserSubmit(e) {
    e.preventDefault();
    if (!_isAdmin) return;
    if (!state.usuarioEmEdicao) {
        alert('Erro: Nenhum usuário selecionado para edição.');
        return;
    }    const matrizesSelecionadas = Array.from(document.querySelectorAll('#editUserMatrizesCheckbox input:checked')).map(cb => cb.value);
    const matrizParaSalvar = (matrizesSelecionadas.length === 1 && matrizesSelecionadas[0] === 'TODOS') ? 'TODOS' : matrizesSelecionadas.join(', ');    const payload = {
        Nome: document.getElementById('editUserNome').value,
        Usuario: document.getElementById('editUserUsuario').value,
        Aprovacao: document.getElementById('editUserAprovacao').value,
        Tipo: document.getElementById('editUserTipo').value,
        Matriz: matrizParaSalvar,
    };    const pin = document.getElementById('editUserPin').value;
    if (pin) {
        if (pin.length !== 6 || !/^\d+$/.test(pin)) {
            alert('O PIN deve conter exatamente 6 dígitos numéricos.');
            return;
        }
        payload.PIN = pin;
    }    const {error} = await supabase.from('Logins').update(payload).eq('Usuario', state.usuarioEmEdicao.Usuario);
    if (error) {
        alert(`Erro ao atualizar usuário: ${error.message}`);
        console.error(error);
        return;
    }    alert('Usuário atualizado com sucesso!');
    editUserModal.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('login-updated', {detail: {usuario: payload.Usuario}}));
}async function handleDeleteUser() {
    if (!_isAdmin) return;
    if (!state.usuarioEmEdicao) {
        alert('Erro: Nenhum usuário selecionado.');
        return;
    }
    const ok = confirm(`Tem certeza que deseja EXCLUIR o usuário "${state.usuarioEmEdicao.Nome}" (${state.usuarioEmEdicao.Usuario})? Esta ação não pode ser desfeita.`);
    if (!ok) return;    const {error} = await supabase.from('Logins').delete().eq('Usuario', state.usuarioEmEdicao.Usuario);
    if (error) {
        alert(`Erro ao excluir usuário: ${error.message}`);
        return;
    }    alert('Usuário excluído com sucesso!');
    editUserModal.classList.add('hidden');
    window.dispatchEvent(new CustomEvent('login-deleted', {detail: {usuario: state.usuarioEmEdicao.Usuario}}));
}async function openEditUserModal(usuarioId) {
    if (!_isAdmin) return;
    let userData = state.loginsData.find(u => u.Usuario === usuarioId);
    if (!userData) {
        console.warn(`Usuário ${usuarioId} não encontrado no cache. Buscando no banco.`);
        const {data, error} = await supabase.from('Logins').select('*').eq('Usuario', usuarioId).single();
        if (error || !data) {
            alert('Não foi possível carregar os dados do usuário.');
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
        let tipoDoBanco = (userData.Tipo || '').toUpperCase();
        if (tipoDoBanco.endsWith('A')) {
            const masc = tipoDoBanco.slice(0, -1);
            if (Array.from(tipoSelect.options).some(opt => opt.value === masc)) tipoDoBanco = masc;
        }
        tipoSelect.value = tipoDoBanco;
        if (tipoSelect.value !== tipoDoBanco) {
            console.warn(`Tipo "${tipoDoBanco}" não encontrado nas opções do select.`);
            tipoSelect.value = '';
        }
    }    const container = document.getElementById('editUserMatrizesCheckbox');
    let userMatrizes = [];
    if (typeof userData.Matriz === 'string' && userData.Matriz) userMatrizes = userData.Matriz.split(',').map(m => m.trim());    const nomesMatrizesUnicas = [...new Set(state.matrizesData.map(item => item.MATRIZ))];
    if (!nomesMatrizesUnicas.includes('TODOS')) nomesMatrizesUnicas.unshift('TODOS');    container.innerHTML = nomesMatrizesUnicas.map(m => {
        const checked = userMatrizes.includes(m) ? 'checked' : '';
        return `<label class="checkbox-label"><input type="checkbox" value="${m}" ${checked}> ${m}</label>`;
    }).join('');    editUserModal.classList.remove('hidden');
}function preencherCheckboxesMatrizes() {
    const container = document.getElementById('gestorMatrizesCheckbox');
    const nomesMatrizesUnicas = [...new Set(state.matrizesData.map(item => item.MATRIZ))];    if (nomesMatrizesUnicas.length === 0) {
        container.innerHTML = '<span>Nenhuma matriz encontrada. Registre uma primeiro.</span>';
        return;
    }    container.innerHTML = nomesMatrizesUnicas.map(matriz => `
    <label class="checkbox-label"><input type="checkbox" name="matriz" value="${matriz}"> ${matriz}</label>
  `).join('');    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const fn = () => atualizarServicesVinculados();
        cb.addEventListener('change', fn);
        _listeners.push(() => cb.removeEventListener('change', fn));
    });
}function atualizarServicesVinculados() {
    const container = document.getElementById('gestorMatrizesCheckbox');
    const display = document.getElementById('gestorServicesVinculados');
    const matrizesSelecionadas = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);    if (matrizesSelecionadas.length === 0) {
        display.innerHTML = '<span>Selecione uma matriz para ver os services.</span>';
        return;
    }    const servicesVinculados = state.matrizesData
        .filter(item => matrizesSelecionadas.includes(item.MATRIZ))
        .map(item => item.SERVICE);
    const servicesUnicos = [...new Set(servicesVinculados)];
    display.innerHTML = servicesUnicos.map(s => `<span class="service-tag">${s}</span>`).join('');
}export async function init() {
    if (_mounted) return;    _isAdmin = gateIsAdmin();
    if (!_isAdmin) {
        console.warn(`Painel Gerencial: Acesso bloqueado. Nível detectado: [${(getUsuarioDaSessao()?.Nivel || 'Nenhum')}]`);        renderAcessoBloqueado('tab-painel-gerencial', null);        return;
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
        console.error('Painel Gerencial: Elementos essenciais do DOM não encontrados APÓS verificação de acesso. Verifique os IDs no HTML da página.');        const container = document.getElementById('tab-painel-gerencial');        if (container) {
            container.innerHTML = `<div class="erro-setup" style="padding: 2rem; text-align: center;"><p style="color: #dc3545;">Erro crítico: Falha ao inicializar a interface do Painel Gerencial (elementos não encontrados). Contate o suporte.</p></div>`;
        }
        return;
    }    {
        const fn = () => {
            matrizForm.reset();
            matrizModal.classList.remove('hidden');
        };
        registrarMatrizBtn.addEventListener('click', fn);
        _listeners.push(() => registrarMatrizBtn.removeEventListener('click', fn));
    }    {
        const fn = async () => {
            try {
                await getCachedMatrizes();
                gestorForm.reset();
                preencherCheckboxesMatrizes();
                atualizarServicesVinculados();
                gestorModal.classList.remove('hidden');
            } catch (error) {
                console.error('Erro ao preparar modal de gestor:', error);
                alert('Não foi possível carregar os dados necessários para abrir o modal de gestor.');
            }
        };
        registrarGestorBtn.addEventListener('click', fn);
        _listeners.push(() => registrarGestorBtn.removeEventListener('click', fn));
    }    matrizForm.addEventListener('submit', handleRegistrarMatriz);
    _listeners.push(() => matrizForm.removeEventListener('submit', handleRegistrarMatriz));    gestorForm.addEventListener('submit', handleRegistrarGestor);
    _listeners.push(() => gestorForm.removeEventListener('submit', handleRegistrarGestor));    editUserForm.addEventListener('submit', handleEditUserSubmit);
    _listeners.push(() => editUserForm.removeEventListener('submit', handleEditUserSubmit));    btnExcluirUsuario.addEventListener('click', handleDeleteUser);
    _listeners.push(() => btnExcluirUsuario.removeEventListener('click', handleDeleteUser));    document.querySelectorAll('[data-close-modal]').forEach(btn => {
        const fn = () => {
            const id = btn.getAttribute('data-close-modal');
            document.getElementById(id)?.classList.add('hidden');
        };
        btn.addEventListener('click', fn);
        _listeners.push(() => btn.removeEventListener('click', fn));
    });    filterAprovacao.addEventListener('change', applyFilters);
    _listeners.push(() => filterAprovacao.removeEventListener('change', applyFilters));
    filterTipo.addEventListener('change', applyFilters);
    _listeners.push(() => filterTipo.removeEventListener('change', applyFilters));
    filterMatriz.addEventListener('change', applyFilters);
    _listeners.push(() => filterMatriz.removeEventListener('change', applyFilters));
    filterSvc.addEventListener('change', applyFilters);
    _listeners.push(() => filterSvc.removeEventListener('change', applyFilters));    limparFiltrosBtn.addEventListener('click', () => {
        filterAprovacao.value = '';
        filterTipo.value = '';
        filterMatriz.value = '';
        filterSvc.value = '';
        applyFilters();
    });
    _listeners.push(() => limparFiltrosBtn.replaceWith(limparFiltrosBtn.cloneNode(true)));    const events = ['matriz-saved', 'login-updated', 'login-deleted', 'gestor-saved'];
    events.forEach(name => {
        const fn = () => {
            if (name === 'matriz-saved') invalidateCache('matrizes');
            else invalidateCache('logins');
            loadAndDisplayData();
        };
        window.addEventListener(name, fn);
        _listeners.push(() => window.removeEventListener(name, fn));
    });    _mounted = true;
    await loadAndDisplayData();
}export function destroy() {
    try {
        _listeners.forEach(off => off());
    } catch {
    }
    _listeners = [];
    _mounted = false;
    _isAdmin = false;
}