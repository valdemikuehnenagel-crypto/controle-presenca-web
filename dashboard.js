import html2canvas from 'html2canvas';const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const contentArea = document.getElementById('content-area');
const tabButtons = document.querySelectorAll('.tab-btn');
const addModal = document.getElementById('addModal');
const cancelBtn = document.getElementById('cancelBtn');
const menuToggleBtn = document.getElementById('menu-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');let currentModule = null;
let isLoadingPage = false;
let loadToken = 0;const pageModules = import.meta.glob('/src/pages/*.js');
const LAST_PAGE_KEY = 'knc:lastPage';const normalizePage = (name) => String(name || '').trim().toLowerCase();function setActiveTab(pageName) {
    const p = normalizePage(pageName);    tabButtons.forEach(btn => {
        btn.classList.toggle('active', normalizePage(btn.dataset.page) === p);
    });    try {
        localStorage.setItem(LAST_PAGE_KEY, p);
    } catch (_) {
    }    const newHash = `#${p}`;
    if (location.hash !== newHash) {
        history.replaceState(null, '', newHash);
    }
}function getInitialPage() {
    const fromHash = normalizePage(location.hash.replace(/^#\/?/, ''));
    const fromStore = normalizePage(localStorage.getItem(LAST_PAGE_KEY));    const fallback = 'colaboradores';    const exists = (pg) => !!document.querySelector(`.tab-btn[data-page="${pg}"]`);    if (fromHash && exists(fromHash)) return fromHash;    if (fromStore && exists(fromStore)) return fromStore;    return fallback;
}if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
    });
}
if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
        document.body.classList.add('sidebar-collapsed');
    });
}
document.body.classList.add('sidebar-collapsed');function checkSession() {
    const userDataString = localStorage.getItem('userSession');
    if (!userDataString) {
        window.location.href = '/index.html';
        return;
    }
    try {
        const user = JSON.parse(userDataString);        const userType = (user && user.Tipo) ? user.Tipo.trim().toUpperCase() : '';
        const restrictedPage = 'separacao';        if (userType === 'OPERAÇÃO') {            document.querySelectorAll('.tab-btn').forEach(btn => {
                const page = btn.dataset.page;
                if (page !== restrictedPage) {
                    btn.style.display = 'none';
                    btn.classList.remove('active');
                } else {
                    btn.style.display = '';
                    btn.classList.add('active');
                }
            });            try {
                localStorage.setItem(LAST_PAGE_KEY, restrictedPage);
            } catch (_) {
            }
            location.hash = `#${restrictedPage}`;        } else {            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.style.display = '';
            });            try {
                const fromStore = normalizePage(localStorage.getItem(LAST_PAGE_KEY));
                if (fromStore === restrictedPage) {                    localStorage.removeItem(LAST_PAGE_KEY);
                }
            } catch (_) {
            }            const separacaoBtn = document.querySelector(`.tab-btn[data-page="${restrictedPage}"]`);
            if (separacaoBtn) separacaoBtn.classList.remove('active');            const activeBtn = document.querySelector('.tab-btn.active');
            if (!activeBtn) {
                const colabBtn = document.querySelector('.tab-btn[data-page="colaboradores"]');
                if (colabBtn) colabBtn.classList.add('active');
            }
        }        if (user?.Nivel) {
            document.body.classList.remove('user-level-visitante', 'user-level-usuario', 'user-level-admin');
            const nivel = user.Nivel.toUpperCase();
            if (nivel === 'VISITANTE') {
                document.body.classList.add('user-level-visitante');
            } else if (nivel === 'USUARIO') {
                document.body.classList.add('user-level-usuario');
            } else {
                document.body.classList.add(`user-level-${user.Nivel.toLowerCase()}`);
            }
        }        const userAvatarEl = document.getElementById('userAvatar');
        if (userInfoEl) {
            const currentHour = new Date().getHours();
            const greeting =
                currentHour >= 5 && currentHour < 12 ? 'Bom dia' :
                    currentHour >= 12 && currentHour < 18 ? 'Boa tarde' : 'Boa noite';
            const fullName = user?.Nome || 'Usuário';
            const firstName = fullName.split(' ')[0];
            userInfoEl.textContent = `${greeting}, ${firstName}!`;
        }        try {
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
}function setLoading(on) {
    isLoadingPage = !!on;
    if (!contentArea) return;
    if (on) {
        contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando…</div>`;
    }
}async function loadPage(pageName) {
    if (!pageName || isLoadingPage) return;
    isLoadingPage = true;    const myToken = ++loadToken;    if (contentArea) contentArea.classList.add('fade-out');
    await new Promise(resolve => setTimeout(resolve, 250));    if (myToken !== loadToken) {
        isLoadingPage = false;
        if (contentArea) contentArea.classList.remove('fade-out');
        return;
    }    try {
        if (currentModule && typeof currentModule.destroy === 'function') {
            await currentModule.destroy();
        }
        if (contentArea) {
            contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando…</div>`;
        }
    } catch (e) {
        console.warn('Falha ao destruir módulo anterior:', e);
    }    try {
        const response = await fetch(`/pages/${pageName}.html`, {cache: 'no-cache'});
        if (!response.ok) throw new Error(`HTML da página ${pageName} não encontrado (HTTP ${response.status}).`);
        const html = await response.text();
        if (myToken !== loadToken) return;        if (contentArea) contentArea.innerHTML = html;        const key = `/src/pages/${pageName}.js`;
        const loader = pageModules[key];
        if (!loader) throw new Error(`Script da página não encontrado no build: ${key}`);        const module = await loader();
        if (myToken !== loadToken) return;        currentModule = module;
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
}function showAddModal() {
    if (addModal) addModal.classList.remove('hidden');
}function hideAddModal() {
    if (addModal) addModal.classList.add('hidden');
}tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
        if (isLoadingPage) return;
        const page = button.dataset.page;
        setActiveTab(page);
        loadPage(page);
        document.body.classList.add('sidebar-collapsed');
    });
});if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('userSession');
        window.location.href = '/index.html';
    });
}if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        console.log('Iniciando captura de tela...');
        const originalText = screenshotBtn.textContent;
        screenshotBtn.disabled = true;
        screenshotBtn.textContent = 'Capturando...';        html2canvas(document.body, {
            useCORS: true,
            logging: false,
            windowWidth: document.body.scrollWidth,
            windowHeight: document.body.scrollHeight
        }).then(canvas => {
            const link = document.createElement('a');            const data = new Date();
            const dataFormatada = data.toISOString().split('T')[0];
            const horaFormatada = data.toTimeString().split(' ')[0].replace(/:/g, '-');            link.download = `captura-knconecta-${dataFormatada}_${horaFormatada}.png`;
            link.href = canvas.toDataURL('image/png');            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);        }).catch(err => {
            console.error('Erro ao gerar screenshot:', err);
            alert('Falha ao gerar a captura de tela. Tente novamente.');
        }).finally(() => {
            screenshotBtn.disabled = false;
            screenshotBtn.textContent = originalText;
        });
    });
}document.addEventListener('open-add-modal', showAddModal);
if (cancelBtn) {
    cancelBtn.addEventListener('click', hideAddModal);
}document.addEventListener('colaborador-added', () => {
    hideAddModal();
    const isColaboradoresAtivo = document.querySelector('[data-page="colaboradores"].active');
    if (isColaboradoresAtivo && currentModule && typeof currentModule.init === 'function') {
        currentModule.init();
    }
});checkSession();const firstPage = getInitialPage();setActiveTab(firstPage);loadPage(firstPage);window.addEventListener('hashchange', () => {
    const pg = normalizePage(location.hash.replace(/^#\/?/, ''));
    if (!pg) return;    try {
        const user = JSON.parse(localStorage.getItem('userSession'));
        const userType = (user && user.Tipo) ? user.Tipo.trim().toUpperCase() : '';
        const restrictedPage = 'separacao';        if (userType === 'OPERAÇÃO' && pg !== restrictedPage) {
            location.hash = `#${restrictedPage}`;
            return;
        }
    } catch (e) {
        console.error('Falha ao ler sessão no hashchange', e);
    }    if (!document.querySelector(`.tab-btn[data-page="${pg}"]`)) return;
    const active = document.querySelector('.tab-btn.active')?.dataset.page;
    if (normalizePage(active) !== pg && !isLoadingPage) {
        setActiveTab(pg);
        loadPage(pg);
    }
});