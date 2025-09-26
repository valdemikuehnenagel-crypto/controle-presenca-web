// --- ELEMENTOS GLOBAIS DA PÁGINA ---
const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const contentArea = document.getElementById('content-area');
const tabButtons = document.querySelectorAll('.tab-btn');

// --- ELEMENTOS DO MODAL (controlados globalmente) ---
const addModal = document.getElementById('addModal');
const cancelBtn = document.getElementById('cancelBtn');

// --- ESTADO GLOBAL ---
let currentModule = null;   // módulo da aba ativa
let isLoadingPage = false;  // trava para evitar clique duplo
let loadToken = 0;          // token para evitar race condition entre trocas rápidas

// --- MAPEAMENTO DE MÓDULOS DAS ABAS (build-friendly) ---
// Vite resolve isso no build e gera os chunks corretos.
const pageModules = import.meta.glob('/src/pages/*.js'); // { '/src/pages/colaboradores.js': () => import('...'), ... }

// --- FUNÇÕES ---

// Verifica sessão do usuário
function checkSession() {
  const userDataString = localStorage.getItem('userSession');
  if (!userDataString) {
    window.location.href = '/index.html';
    return;
  }
  try {
    const user = JSON.parse(userDataString);
    if (userInfoEl) userInfoEl.textContent = user?.Usuario ?? 'Usuário';
  } catch {
    localStorage.removeItem('userSession');
    window.location.href = '/index.html';
  }
}

// Mostra indicador simples de carregamento
function setLoading(on) {
  isLoadingPage = !!on;
  if (!contentArea) return;
  if (on) {
    contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando…</div>`;
  }
}

// Carrega a aba (HTML em /public/pages e JS em /src/pages)
async function loadPage(pageName) {
  if (!pageName) return;
  if (isLoadingPage) return;

  setLoading(true);
  const myToken = ++loadToken;

  // tenta destruir a aba anterior (se o módulo expor destroy)
  try {
    if (currentModule && typeof currentModule.destroy === 'function') {
      await currentModule.destroy();
    }
  } catch (e) {
    console.warn('Falha ao destruir módulo anterior:', e);
  }

  // 1) HTML da página (servido de /public/pages)
  try {
    const response = await fetch(`/pages/${pageName}.html`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTML da página ${pageName} não encontrado (HTTP ${response.status}).`);
    const html = await response.text();

    // se outra aba foi carregada no meio do caminho, aborta atualização
    if (myToken !== loadToken) return;

    if (contentArea) contentArea.innerHTML = html;
  } catch (error) {
    console.error('Falha ao carregar HTML da aba:', error);
    if (contentArea) {
      contentArea.innerHTML = `<p class="p-4 text-red-500">Erro ao carregar a interface da aba "${pageName}".</p>`;
    }
    setLoading(false);
    return;
  }

  // 2) Script da aba via import.meta.glob
  try {
    const key = `/src/pages/${pageName}.js`;
    const loader = pageModules[key];
    if (!loader) throw new Error(`Script da página não encontrado no build: ${key}`);

    const module = await loader(); // carrega o chunk gerado pelo Vite

    // se outra aba foi carregada no meio do caminho, aborta inicialização
    if (myToken !== loadToken) return;

    currentModule = module;

    // 3) Inicializa a aba (se o módulo expor init)
    if (currentModule && typeof currentModule.init === 'function') {
      await currentModule.init();
    }
  } catch (error) {
    console.error('Falha ao carregar ou inicializar o script da aba:', error);
    // HTML já está visível; não quebramos a UI.
  } finally {
    // apenas o último load deve encerrar "loading"
    if (myToken === loadToken) setLoading(false);
  }
}

// --- LÓGICA DO MODAL ---
function showAddModal() {
  if (addModal) addModal.classList.remove('hidden');
}

function hideAddModal() {
  if (addModal) addModal.classList.add('hidden');
  // limpeza específica de inputs fica a cargo do módulo da aba (ex.: colaboradores.js)
}

// --- EVENT LISTENERS GLOBAIS ---

// Troca de abas
tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (isLoadingPage) return;
    tabButtons.forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    const page = button.dataset.page;
    loadPage(page);
  });
});

// Logout
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('userSession');
    window.location.href = '/index.html';
  });
}

// Eventos disparados pelos módulos
document.addEventListener('open-add-modal', showAddModal);

if (cancelBtn) {
  cancelBtn.addEventListener('click', hideAddModal);
}

document.addEventListener('colaborador-added', () => {
  hideAddModal();
  const isColaboradoresAtivo = document.querySelector('[data-page="colaboradores"].active');
  if (isColaboradoresAtivo && currentModule && typeof currentModule.init === 'function') {
    currentModule.init();
  }
});

// --- INICIALIZAÇÃO ---
checkSession();

// marca a aba default como ativa e carrega
const defaultTabBtn = document.querySelector('[data-page="colaboradores"]');
if (defaultTabBtn) defaultTabBtn.classList.add('active');
loadPage('colaboradores');
