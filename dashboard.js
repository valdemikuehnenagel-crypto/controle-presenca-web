const userInfoEl   = document.getElementById('userInfo');
const logoutBtn    = document.getElementById('logoutBtn');
const contentArea  = document.getElementById('content-area');
const tabButtons   = document.querySelectorAll('.tab-btn');



const addModal     = document.getElementById('addModal');
const cancelBtn    = document.getElementById('cancelBtn');

let currentModule  = null;
let isLoadingPage  = false;
let loadToken      = 0;


const pageModules = import.meta.glob('/src/pages/*.js');

function checkSession() {
  const userDataString = localStorage.getItem('userSession');
  if (!userDataString) {
    window.location.href = '/index.html';
    return;
  }
  try {
    const user = JSON.parse(userDataString);
    const userAvatarEl = document.getElementById('userAvatar');

    // Saudação
    if (userInfoEl) {
      const currentHour = new Date().getHours();
      const greeting =
        currentHour >= 5 && currentHour < 12 ? 'Bom dia' :
        currentHour >= 12 && currentHour < 18 ? 'Boa tarde' : 'Boa noite';

      const fullName  = user?.Nome || 'Usuário';
      const firstName = fullName.split(' ')[0];
      userInfoEl.textContent = `${greeting}, ${firstName}!`;
    }

    try {
      if (userAvatarEl) {
        if (user?.avatar_url) {
          userAvatarEl.src = user.avatar_url;
          userAvatarEl.classList.remove('hidden');
        } else {
          userAvatarEl.classList.add('hidden');
        }
      }
    } catch (e) {
      console.warn('Falha ao renderizar avatar:', e);
    }
  } catch (e) {
    console.error('Sessão inválida:', e);
    localStorage.removeItem('userSession');
    window.location.href = '/index.html';
  }
}


function setLoading(on) {
  isLoadingPage = !!on;
  if (!contentArea) return;
  if (on) {
    contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando…</div>`;
  }
}

async function loadPage(pageName) {
  if (!pageName || isLoadingPage) return;

  isLoadingPage = true;
  const myToken = ++loadToken;

  // efeito visual opcional
  if (contentArea) contentArea.classList.add('fade-out');
  await new Promise(resolve => setTimeout(resolve, 250));
  if (myToken !== loadToken) {
    isLoadingPage = false;
    if (contentArea) contentArea.classList.remove('fade-out');
    return;
  }

  try {
    if (currentModule && typeof currentModule.destroy === 'function') {
      await currentModule.destroy();
    }
    if (contentArea) {
      contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando…</div>`;
    }
  } catch (e) {
    console.warn('Falha ao destruir módulo anterior:', e);
  }

  try {
    const response = await fetch(`/pages/${pageName}.html`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTML da página ${pageName} não encontrado (HTTP ${response.status}).`);
    const html = await response.text();

    if (myToken !== loadToken) return;

    if (contentArea) contentArea.innerHTML = html;


    const key = `/src/pages/${pageName}.js`;
    const loader = pageModules[key];
    if (!loader) throw new Error(`Script da página não encontrado no build: ${key}`);

    const module = await loader();
    if (myToken !== loadToken) return;

    currentModule = module;


    if (currentModule && typeof currentModule.init === 'function') {
      await currentModule.init();
    }
  } catch (error) {
    console.error('Falha ao carregar ou inicializar a aba:', error);
    if (contentArea) {
      contentArea.innerHTML = `<p class="p-4 text-red-500">Erro ao carregar a interface da aba "${pageName}".</p>`;
    }
  } finally {
    if (myToken === loadToken) {
      isLoadingPage = false;
      if (contentArea) contentArea.classList.remove('fade-out');
    }
  }
}

function showAddModal() {
  if (addModal) addModal.classList.remove('hidden');
}

function hideAddModal() {
  if (addModal) addModal.classList.add('hidden');

}


tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (isLoadingPage) return;
    tabButtons.forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    const page = button.dataset.page;
    loadPage(page);
  });
});


if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('userSession');
    window.location.href = '/index.html';
  });
}


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


checkSession();

const defaultTabBtn = document.querySelector('[data-page="colaboradores"]');
if (defaultTabBtn) defaultTabBtn.classList.add('active');
loadPage('colaboradores');
