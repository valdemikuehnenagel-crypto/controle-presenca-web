// --- ELEMENTOS GLOBAIS DA PÁGINA ---
const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const contentArea = document.getElementById('content-area');
const tabButtons = document.querySelectorAll('.tab-btn');

// --- ELEMENTOS DO MODAL (controlados globalmente) ---
const addModal = document.getElementById('addModal');
const cancelBtn = document.getElementById('cancelBtn');

// --- ESTADO GLOBAL ---
let currentModule = null; // Guarda o módulo da aba ativa

// --- MAPEAMENTO DE MÓDULOS DAS ABAS (build-friendly) ---
// Vite resolve esses imports em build e gera os chunks com hash corretamente.
const pageModules = import.meta.glob('/src/pages/*.js'); // ex: { '/src/pages/colaboradores.js': () => import('...'), ... }

// --- FUNÇÕES ---

// Função de segurança que verifica a sessão do usuário
function checkSession() {
  const userDataString = localStorage.getItem('userSession');
  if (!userDataString) {
    window.location.href = '/index.html'; // Redireciona se não estiver logado
    return;
  }
  const user = JSON.parse(userDataString);
  if (userInfoEl) userInfoEl.textContent = user.Usuario ?? 'Usuário';
}

// Função principal que carrega o conteúdo e a lógica de uma aba
async function loadPage(pageName) {
  // Se a aba anterior tiver um "destroy" opcional, chama antes de trocar
  try {
    if (currentModule && typeof currentModule.destroy === 'function') {
      await currentModule.destroy();
    }
  } catch (e) {
    console.warn('Falha ao destruir módulo anterior:', e);
  }

  // 1) Busca o HTML da página (em produção fica servindo de /public/pages)
  try {
    const response = await fetch(`/pages/${pageName}.html`);
    if (!response.ok) throw new Error(`HTML da página ${pageName} não encontrado.`);
    contentArea.innerHTML = await response.text();
  } catch (error) {
    console.error(`Falha ao carregar HTML da aba: ${error}`);
    if (contentArea) {
      contentArea.innerHTML = `<p class="p-4 text-red-500">Erro ao carregar a interface da aba "${pageName}".</p>`;
    }
    return;
  }

  // 2) Carrega o módulo JS correspondente via import.meta.glob
  try {
    const loader = pageModules[`/src/pages/${pageName}.js`];
    if (!loader) throw new Error(`Script da página ${pageName} não encontrado no build.`);

    const module = await loader(); // carrega o chunk gerado pelo Vite
    currentModule = module;

    // 3) Se o módulo tiver uma função 'init', executa (pode receber helpers se você quiser)
    if (currentModule && typeof currentModule.init === 'function') {
      await currentModule.init();
    }
  } catch (error) {
    console.error(`Falha ao carregar ou inicializar o script da aba: ${error}`);
    // Não mostra erro na tela porque o HTML já está visível
  }
}

// --- LÓGICA DO MODAL ---
function showAddModal() {
  if (addModal) addModal.classList.remove('hidden');
}

function hideAddModal() {
  if (addModal) addModal.classList.add('hidden');
  // Limpeza específica do formulário fica a cargo do módulo da aba (ex.: colaboradores.js)
}

// --- EVENT LISTENERS GLOBAIS ---

// Adiciona o listener para cada botão de aba
tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    tabButtons.forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    const page = button.dataset.page;
    loadPage(page);
  });
});

// Listener de Logout
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('userSession');
    window.location.href = '/index.html';
  });
}

// "Ouvinte" para o evento que o colaboradores.js dispara para abrir o modal
document.addEventListener('open-add-modal', showAddModal);

// Listener para o botão de cancelar do modal
if (cancelBtn) {
  cancelBtn.addEventListener('click', hideAddModal);
}

// "Ouvinte" para quando um colaborador for adicionado com sucesso
document.addEventListener('colaborador-added', () => {
  hideAddModal();
  // Recarrega a aba atual se for "colaboradores"
  const isColaboradoresAtivo = document.querySelector('[data-page="colaboradores"].active');
  if (isColaboradoresAtivo && currentModule && typeof currentModule.init === 'function') {
    currentModule.init();
  }
});

// --- INICIALIZAÇÃO DA PÁGINA ---
checkSession();

// marca a aba default como ativa (se existir) e carrega
const defaultTabBtn = document.querySelector('[data-page="colaboradores"]');
if (defaultTabBtn) defaultTabBtn.classList.add('active');
loadPage('colaboradores'); // Carrega a aba de colaboradores por padrão
