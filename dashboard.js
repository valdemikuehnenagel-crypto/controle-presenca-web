import html2canvas from 'html2canvas';
import {createClient} from '@supabase/supabase-js';const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);
const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
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
const LAST_PAGE_KEY = 'knc:lastPage';
const normalizePage = (name) => String(name || '').trim().toLowerCase();const dialogEl = document.getElementById('kn-global-dialog');
const dialogTitle = document.getElementById('kn-dialog-title');
const dialogMsg = document.getElementById('kn-dialog-message');
const btnConfirm = document.getElementById('kn-dialog-btn-confirm');
const btnCancel = document.getElementById('kn-dialog-btn-cancel');
const iconContainer = document.getElementById('kn-dialog-icon-container');function closeDialog() {
    if (dialogEl) dialogEl.classList.add('hidden');
}window.customAlert = function (message, title = 'Aviso') {
    return new Promise((resolve) => {
        if (!dialogEl) {
            alert(message);
            resolve();
            return;
        }        dialogTitle.textContent = title;
        dialogTitle.style.color = '#003369';
        dialogMsg.innerHTML = message.replace(/\n/g, '<br>');        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#02B1EE]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;        btnCancel.classList.add('hidden');
        btnConfirm.textContent = 'OK';
        btnConfirm.className = "px-6 py-2 rounded text-white font-bold shadow-md transition-all text-xs uppercase bg-[#003369] hover:bg-[#02B1EE]";        btnConfirm.onclick = () => {
            closeDialog();
            resolve();
        };        dialogEl.classList.remove('hidden');
    });
};window.customConfirm = function (message, title = 'Confirmação', type = 'warning') {
    return new Promise((resolve) => {
        if (!dialogEl) {
            resolve(confirm(message));
            return;
        }        dialogTitle.textContent = title;
        dialogMsg.innerHTML = message.replace(/\n/g, '<br>');        if (type === 'danger') {
            dialogTitle.style.color = '#D81D1D';
            iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#D81D1D]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
            btnConfirm.className = "px-6 py-2 rounded text-white font-bold shadow-md transition-all text-xs uppercase bg-[#D81D1D] hover:bg-red-700";
        } else {
            dialogTitle.style.color = '#003369';
            iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#003369]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
            btnConfirm.className = "px-6 py-2 rounded text-white font-bold shadow-md transition-all text-xs uppercase bg-[#003369] hover:bg-[#02B1EE]";
        }        btnCancel.classList.remove('hidden');
        btnConfirm.textContent = 'Confirmar';        btnConfirm.onclick = () => {
            closeDialog();
            resolve(true);
        };        btnCancel.onclick = () => {
            closeDialog();
            resolve(false);
        };        dialogEl.classList.remove('hidden');
    });
};function showZoomRecommendation(userName) {    if (sessionStorage.getItem('knc:zoomAlertShown')) return;    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';    const imgSrc = '/imagens/ctrl.png';    overlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-scaleIn transform transition-all">
            <div class="bg-[#003369] p-4 text-center">
                <h3 class="text-white font-bold text-lg">💡 Dica de Visualização</h3>
            </div>
            <div class="p-6 text-center">
                <h2 class="text-xl font-bold text-[#003369] mb-4">Olá, ${userName.toUpperCase()}! 👋</h2>
                <p class="text-gray-600 mb-4 text-sm leading-relaxed">
                    Para mais conforto visual e para visualizar todas as tabelas corretamente, recomendo os seguintes ajustes de zoom:
                </p>                <div class="grid grid-cols-2 gap-4 mb-4 text-sm">
                    <div class="bg-gray-50 p-3 rounded border border-gray-200">
                        <span class="block text-gray-500 text-xs">Telas Pequenas (14")</span>
                        <span class="block font-bold text-[#003369] text-xl">70%</span>
                    </div>
                    <div class="bg-gray-50 p-3 rounded border border-gray-200">
                        <span class="block text-gray-500 text-xs">Telas Médias (15.6")</span>
                        <span class="block font-bold text-[#003369] text-xl">80%</span>
                    </div>
                </div>                <div class="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6">
                    <p class="text-xs text-blue-800 font-semibold mb-2 uppercase tracking-wide">Como ajustar:</p>
                    <p class="text-sm text-gray-700 mb-3">
                        Pressione <kbd class="bg-white border border-gray-300 px-2 py-0.5 rounded shadow-sm font-sans font-semibold">Ctrl</kbd> 
                        e a tecla <kbd class="bg-white border border-gray-300 px-2 py-0.5 rounded shadow-sm font-sans font-semibold">-</kbd> 
                        ao mesmo tempo.
                    </p>
                    <div class="flex justify-center">
                        <img src="${imgSrc}" alt="Pressione Ctrl e Menos" class="h-16 object-contain opacity-90 hover:opacity-100 transition-opacity">
                    </div>
                </div>                <button id="btnZoomOk" style="background-color: #003369; color: white;" class="w-full py-3 font-bold rounded-lg shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 hover:brightness-110">
                    OK, ENTENDI
                </button>
            </div>
        </div>
    `;    document.body.appendChild(overlay);    const btn = overlay.querySelector('#btnZoomOk');
    btn.onclick = () => {        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s';
        setTimeout(() => overlay.remove(), 200);        sessionStorage.setItem('knc:zoomAlertShown', 'true');
    };
}function setActiveTab(pageName) {
    const p = normalizePage(pageName);
    tabButtons.forEach(btn => {
        btn.classList.toggle('active', normalizePage(btn.dataset.page) === p);
    });
    try {
        localStorage.setItem(LAST_PAGE_KEY, p);
    } catch (_) {
    }
    const newHash = `#${p}`;
    if (location.hash !== newHash) {
        history.replaceState(null, '', newHash);
    }
}function getInitialPage() {
    const fromHash = normalizePage(location.hash.replace(/^#\/?/, ''));
    const fromStore = normalizePage(localStorage.getItem(LAST_PAGE_KEY));
    const fallback = 'colaboradores';
    const exists = (pg) => !!document.querySelector(`.tab-btn[data-page="${pg}"]`);
    if (fromHash && exists(fromHash)) return fromHash;
    if (fromStore && exists(fromStore)) return fromStore;
    return fallback;
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
        const user = JSON.parse(userDataString);
        const userType = (user && user.Tipo) ? user.Tipo.trim().toUpperCase() : '';
        const restrictedPage = 'separacao';
        if (userType === 'OPERAÇÃO') {
            document.querySelectorAll('.tab-btn').forEach(btn => {
                const page = btn.dataset.page;
                if (page !== restrictedPage) {
                    btn.style.display = 'none';
                    btn.classList.remove('active');
                } else {
                    btn.style.display = '';
                    btn.classList.add('active');
                }
            });
            try {
                localStorage.setItem(LAST_PAGE_KEY, restrictedPage);
            } catch (_) {
            }
            location.hash = `#${restrictedPage}`;
        } else {
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.style.display = '';
            });
            try {
                const fromStore = normalizePage(localStorage.getItem(LAST_PAGE_KEY));
                if (fromStore === restrictedPage) {
                    localStorage.removeItem(LAST_PAGE_KEY);
                }
            } catch (_) {
            }
            const separacaoBtn = document.querySelector(`.tab-btn[data-page="${restrictedPage}"]`);
            if (separacaoBtn) separacaoBtn.classList.remove('active');
            const activeBtn = document.querySelector('.tab-btn.active');
            if (!activeBtn) {
                const colabBtn = document.querySelector('.tab-btn[data-page="colaboradores"]');
                if (colabBtn) colabBtn.classList.add('active');
            }
        }
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
            userInfoEl.textContent = `${greeting}, ${firstName}!`;            showZoomRecommendation(firstName);
        }
        try {
            if (userAvatarEl) {
                if (user?.avatar_url) {
                    userAvatarEl.src = user.avatar_url.toLowerCase();
                } else {
                    userAvatarEl.src = '/imagens/default-avatar.png';
                }
                userAvatarEl.classList.remove('hidden');
                setupAvatarUpload(userAvatarEl);
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
}function showAddModal() {
    if (addModal) addModal.classList.remove('hidden');
}function hideAddModal() {
    if (addModal) addModal.classList.add('hidden');
}let hiddenAvatarInput = null;function setupAvatarUpload(avatarElement) {
    if (!hiddenAvatarInput) {
        hiddenAvatarInput = document.createElement('input');
        hiddenAvatarInput.type = 'file';
        hiddenAvatarInput.accept = 'image/png, image/jpeg';
        hiddenAvatarInput.style.display = 'none';
        document.body.appendChild(hiddenAvatarInput);
        hiddenAvatarInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                uploadAvatar(file, avatarElement);
            }
            hiddenAvatarInput.value = '';
        });
    }
    const removeOldMenu = () => {
        const oldMenu = document.getElementById('avatar-context-menu');
        if (oldMenu) {
            oldMenu.remove();
        }
        document.removeEventListener('click', removeOldMenu);
        document.removeEventListener('contextmenu', removeOldMenu);
    };
    avatarElement.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        removeOldMenu();
        const menu = document.createElement('div');
        menu.id = 'avatar-context-menu';
        menu.className = 'custom-context-menu';
        menu.style.top = `${e.clientY}px`;
        menu.style.left = `${e.clientX}px`;
        const changeButton = document.createElement('button');
        changeButton.textContent = 'Alterar foto';
        changeButton.onclick = () => {
            hiddenAvatarInput.click();
            removeOldMenu();
        };
        menu.appendChild(changeButton);
        document.body.appendChild(menu);
        setTimeout(() => {
            document.addEventListener('click', removeOldMenu, {once: true});
            document.addEventListener('contextmenu', removeOldMenu, {once: true});
        }, 0);
    });
}async function uploadAvatar(file, avatarElement) {
    const userDataString = localStorage.getItem('userSession');
    if (!userDataString) {
        await window.customAlert('Sessão expirada. Faça login novamente.');
        return;
    }
    let user;
    try {
        user = JSON.parse(userDataString);
    } catch (e) {
        await window.customAlert('Erro ao ler dados do usuário.');
        return;
    }
    if (!user || !user.Usuario) {
        await window.customAlert('Não foi possível identificar o usuário.');
        return;
    }
    try {
        avatarElement.classList.add('uploading');
        const fileExt = file.name.split('.').pop();
        const safeUserName = user.Usuario.toLowerCase()
            .replace(/\./g, '-')
            .replace(/@/g, '-at-');
        const fileName = `${safeUserName}-avatar.${fileExt}`;
        const {error: uploadError} = await supabase.storage
            .from('avatars')
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: true
            });
        if (uploadError) throw uploadError;
        const {data: publicUrlData} = supabase.storage
            .from('avatars')
            .getPublicUrl(fileName);
        if (!publicUrlData) throw new Error('Não foi possível obter a URL pública da imagem.');
        const newAvatarUrl = `${publicUrlData.publicUrl.toLowerCase()}?t=${new Date().getTime()}`;
        const dbAvatarUrl = newAvatarUrl.split('?t=')[0];
        const {error: updateError} = await supabase
            .from('Logins')
            .update({avatar_url: dbAvatarUrl})
            .eq('Usuario', user.Usuario);
        if (updateError) throw updateError;
        user.avatar_url = dbAvatarUrl;
        localStorage.setItem('userSession', JSON.stringify(user));
        avatarElement.src = newAvatarUrl;
        avatarElement.classList.remove('uploading');
        await window.customAlert('Foto de perfil atualizada com sucesso!', 'Sucesso');
    } catch (error) {
        console.error('Erro ao atualizar avatar:', error);
        await window.customAlert(`Falha ao atualizar a foto: ${error.message}`, 'Erro');
        avatarElement.classList.remove('uploading');
    }
}tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
        if (isLoadingPage) return;
        const page = button.dataset.page;
        setActiveTab(page);
        loadPage(page);
        document.body.classList.add('sidebar-collapsed');
    });
});
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {        sessionStorage.removeItem('knc:zoomAlertShown');        localStorage.removeItem('userSession');
        window.location.href = '/index.html';
    });
}
if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        console.log('Iniciando captura de tela...');
        const originalText = screenshotBtn.textContent;
        screenshotBtn.disabled = true;
        screenshotBtn.textContent = 'Capturando...';
        html2canvas(document.body, {
            useCORS: true,
            logging: false,
            windowWidth: document.body.scrollWidth,
            windowHeight: document.body.scrollHeight
        }).then(canvas => {
            const link = document.createElement('a');
            const data = new Date();
            const dataFormatada = data.toISOString().split('T')[0];
            const horaFormatada = data.toTimeString().split(' ')[0].replace(/:/g, '-');
            link.download = `captura-knconecta-${dataFormatada}_${horaFormatada}.png`;
            link.href = canvas.toDataURL('image/png');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }).catch(err => {
            console.error('Erro ao gerar screenshot:', err);
            window.customAlert('Falha ao gerar a captura de tela. Tente novamente.', 'Erro');
        }).finally(() => {
            screenshotBtn.disabled = false;
            screenshotBtn.textContent = originalText;
        });
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
const firstPage = getInitialPage();
setActiveTab(firstPage);
loadPage(firstPage);
window.addEventListener('hashchange', () => {
    const pg = normalizePage(location.hash.replace(/^#\/?/, ''));
    if (!pg) return;
    try {
        const user = JSON.parse(localStorage.getItem('userSession'));
        const userType = (user && user.Tipo) ? user.Tipo.trim().toUpperCase() : '';
        const restrictedPage = 'separacao';
        if (userType === 'OPERAÇÃO' && pg !== restrictedPage) {
            location.hash = `#${restrictedPage}`;
            return;
        }
    } catch (e) {
        console.error('Falha ao ler sessão no hashchange', e);
    }
    if (!document.querySelector(`.tab-btn[data-page="${pg}"]`)) return;
    const active = document.querySelector('.tab-btn.active')?.dataset.page;
    if (normalizePage(active) !== pg && !isLoadingPage) {
        setActiveTab(pg);
        loadPage(pg);
    }
});