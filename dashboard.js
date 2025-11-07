const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const contentArea = document.getElementById('content-area');
const tabButtons = document.querySelectorAll('.tab-btn');
const addModal = document.getElementById('addModal');
const cancelBtn = document.getElementById('cancelBtn');
const menuToggleBtn = document.getElementById('menu-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');

let currentModule = null;
let isLoadingPage = false;
let loadToken = 0;

const pageModules = import.meta.glob('/src/pages/*.js');

// -----------------------------------------------------------------------------
// Persistência da aba selecionada
// -----------------------------------------------------------------------------
const LAST_PAGE_KEY = 'knc:lastPage';

const normalizePage = (name) => String(name || '').trim().toLowerCase();

function setActiveTab(pageName) {
    const p = normalizePage(pageName);
    // marca visualmente o botão ativo
    tabButtons.forEach(btn => {
        btn.classList.toggle('active', normalizePage(btn.dataset.page) === p);
    });
    // guarda no storage
    try {
        localStorage.setItem(LAST_PAGE_KEY, p);
    } catch (_) {
    }
    // reflete na URL (permite reload/voltar/compartilhar)
    const newHash = `#${p}`;
    if (location.hash !== newHash) {
        history.replaceState(null, '', newHash);
    }
}

function getInitialPage() {
    const fromHash = normalizePage(location.hash.replace(/^#\/?/, ''));
    const fromStore = normalizePage(localStorage.getItem(LAST_PAGE_KEY));
    const fallback = 'colaboradores';
    const exists = (pg) => !!document.querySelector(`.tab-btn[data-page="${pg}"]`);
    if (fromHash && exists(fromHash)) return fromHash;
    if (fromStore && exists(fromStore)) return fromStore;
    return fallback;
}

// -----------------------------------------------------------------------------
// Menu lateral
// -----------------------------------------------------------------------------
if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
    });
}
if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
        document.body.classList.add('sidebar-collapsed');
    });
}
document.body.classList.add('sidebar-collapsed');

// -----------------------------------------------------------------------------
// Sessão do usuário
// -----------------------------------------------------------------------------
function checkSession() {
    const userDataString = localStorage.getItem('userSession');
    if (!userDataString) {
        window.location.href = '/index.html';
        return;
    }
    try {
        const user = JSON.parse(userDataString);

        if (user?.Nivel) {
            document.body.classList.remove('user-level-visitante', 'user-level-usuario', 'user-level-admin');
            const nivel = user.Nivel.toUpperCase();
            if (nivel === 'VISITANTE') {
                document.body.classList.add('user-level-visitante');
            } else if (nivel === 'USUARIO') {
                document.body.classList.add('user-level-usuario');
            } else {
                document.body.classList.add(`user-level-${user.Nivel.toLowerCase()}`);
            }
        }

        const userAvatarEl = document.getElementById('userAvatar');
        if (userInfoEl) {
            const currentHour = new Date().getHours();
            const greeting =
                currentHour >= 5 && currentHour < 12 ? 'Bom dia' :
                    currentHour >= 12 && currentHour < 18 ? 'Boa tarde' : 'Boa noite';
            const fullName = user?.Nome || 'Usuário';
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

// -----------------------------------------------------------------------------
// Loading
// -----------------------------------------------------------------------------
function setLoading(on) {
    isLoadingPage = !!on;
    if (!contentArea) return;
    if (on) {
        contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando…</div>`;
    }
}

// -----------------------------------------------------------------------------
// Carregamento das páginas
// -----------------------------------------------------------------------------
async function loadPage(pageName) {
    if (!pageName || isLoadingPage) return;
    isLoadingPage = true;

    const myToken = ++loadToken;

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
        const response = await fetch(`/pages/${pageName}.html`, {cache: 'no-cache'});
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

// -----------------------------------------------------------------------------
// Modais
// -----------------------------------------------------------------------------
function showAddModal() {
    if (addModal) addModal.classList.remove('hidden');
}

function hideAddModal() {
    if (addModal) addModal.classList.add('hidden');
}

// -----------------------------------------------------------------------------
// Tabs - clique
// -----------------------------------------------------------------------------
tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
        if (isLoadingPage) return;
        const page = button.dataset.page;
        setActiveTab(page);        // persiste e marca ativo
        loadPage(page);
        document.body.classList.add('sidebar-collapsed');
    });
});

// -----------------------------------------------------------------------------
// Logout
// -----------------------------------------------------------------------------
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('userSession');
        window.location.href = '/index.html';
    });
}

// -----------------------------------------------------------------------------
// Eventos diversos
// -----------------------------------------------------------------------------
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

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------
checkSession();

// Restaura aba inicial (hash > storage > fallback)
const firstPage = getInitialPage();
setActiveTab(firstPage);
loadPage(firstPage);

// Suporta navegação por hash (voltar/avançar/colar URL)
window.addEventListener('hashchange', () => {
    const pg = normalizePage(location.hash.replace(/^#\/?/, ''));
    if (!pg) return;
    if (!document.querySelector(`.tab-btn[data-page="${pg}"]`)) return;
    const active = document.querySelector('.tab-btn.active')?.dataset.page;
    if (normalizePage(active) !== pg && !isLoadingPage) {
        setActiveTab(pg);
        loadPage(pg);
    }
});
