import html2canvas from 'html2canvas';
import {createClient} from '@supabase/supabase-js';

// Inicialização do Supabase
const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);

// Elementos Globais
const userInfoEl = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const contentArea = document.getElementById('content-area');
const tabButtons = document.querySelectorAll('.tab-btn');
const addModal = document.getElementById('addModal');
const cancelBtn = document.getElementById('cancelBtn');
const menuToggleBtn = document.getElementById('menu-toggle');
const sidebarOverlay = document.getElementById('sidebar-overlay');

// Estado da Aplicação
let currentModule = null;
let isLoadingPage = false;
let loadToken = 0;

// Importação Dinâmica dos Módulos das Páginas
const pageModules = import.meta.glob('/src/pages/*.js');
const LAST_PAGE_KEY = 'knc:lastPage';
const normalizePage = (name) => String(name || '').trim().toLowerCase();

// Elementos do Diálogo Global
const dialogEl = document.getElementById('kn-global-dialog');
const dialogTitle = document.getElementById('kn-dialog-title');
const dialogMsg = document.getElementById('kn-dialog-message');
const btnConfirm = document.getElementById('kn-dialog-btn-confirm');
const btnCancel = document.getElementById('kn-dialog-btn-cancel');
const iconContainer = document.getElementById('kn-dialog-icon-container');

// --- Funções de Diálogo (Alert/Confirm) ---

function closeDialog() {
    if (dialogEl) dialogEl.classList.add('hidden');
}

window.customAlert = function (message, title = 'Aviso') {
    return new Promise((resolve) => {
        if (!dialogEl) {
            alert(message);
            resolve();
            return;
        }
        dialogTitle.textContent = title;
        dialogTitle.style.color = '#003369';
        dialogMsg.innerHTML = message.replace(/\n/g, '<br>');
        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#02B1EE]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
        btnCancel.classList.add('hidden');
        btnConfirm.textContent = 'OK';
        btnConfirm.className = "px-6 py-2 rounded text-white font-bold shadow-md transition-all text-xs uppercase bg-[#003369] hover:bg-[#02B1EE]";
        btnConfirm.onclick = () => {
            closeDialog();
            resolve();
        };
        dialogEl.classList.remove('hidden');
    });
};

window.customConfirm = function (message, title = 'Confirmação', type = 'warning') {
    return new Promise((resolve) => {
        if (!dialogEl) {
            resolve(confirm(message));
            return;
        }
        dialogTitle.textContent = title;
        dialogMsg.innerHTML = message.replace(/\n/g, '<br>');
        if (type === 'danger') {
            dialogTitle.style.color = '#D81D1D';
            iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#D81D1D]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
            btnConfirm.className = "px-6 py-2 rounded text-white font-bold shadow-md transition-all text-xs uppercase bg-[#D81D1D] hover:bg-red-700";
        } else {
            dialogTitle.style.color = '#003369';
            iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-[#003369]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
            btnConfirm.className = "px-6 py-2 rounded text-white font-bold shadow-md transition-all text-xs uppercase bg-[#003369] hover:bg-[#02B1EE]";
        }
        btnCancel.classList.remove('hidden');
        btnConfirm.textContent = 'Confirmar';
        btnConfirm.onclick = () => {
            closeDialog();
            resolve(true);
        };
        btnCancel.onclick = () => {
            closeDialog();
            resolve(false);
        };
        dialogEl.classList.remove('hidden');
    });
};

function showZoomRecommendation(userName) {
    if (sessionStorage.getItem('knc:zoomAlertShown')) return;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
    const imgSrc = '/imagens/ctrl.png';
    overlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden animate-scaleIn transform transition-all">
            <div class="bg-[#003369] p-4 text-center">
                <h3 class="text-white font-bold text-lg">💡 Dica de Visualização</h3>
            </div>
            <div class="p-6 text-center">
                <h2 class="text-xl font-bold text-[#003369] mb-4">Olá, ${userName.toUpperCase()}! 👋</h2>
                <p class="text-gray-600 mb-4 text-sm leading-relaxed">
                    Para mais conforto visual e para visualizar todas as tabelas corretamente, recomendo os seguintes ajustes de zoom:
                </p>
                <div class="grid grid-cols-2 gap-4 mb-4 text-sm">
                    <div class="bg-gray-50 p-3 rounded border border-gray-200">
                        <span class="block text-gray-500 text-xs">Telas Pequenas (14")</span>
                        <span class="block font-bold text-[#003369] text-xl">70%</span>
                    </div>
                    <div class="bg-gray-50 p-3 rounded border border-gray-200">
                        <span class="block text-gray-500 text-xs">Telas Médias (15.6")</span>
                        <span class="block font-bold text-[#003369] text-xl">80%</span>
                    </div>
                </div>
                <div class="bg-blue-50 p-4 rounded-lg border border-blue-100 mb-6">
                    <p class="text-xs text-blue-800 font-semibold mb-2 uppercase tracking-wide">Como ajustar:</p>
                    <p class="text-sm text-gray-700 mb-3">
                        Pressione <kbd class="bg-white border border-gray-300 px-2 py-0.5 rounded shadow-sm font-sans font-semibold">Ctrl</kbd> 
                        e a tecla <kbd class="bg-white border border-gray-300 px-2 py-0.5 rounded shadow-sm font-sans font-semibold">-</kbd> 
                        ao mesmo tempo.
                    </p>
                    <div class="flex justify-center">
                        <img src="${imgSrc}" alt="Pressione Ctrl e Menos" class="h-16 object-contain opacity-90 hover:opacity-100 transition-opacity">
                    </div>
                </div>
                <button id="btnZoomOk" style="background-color: #003369; color: white;" class="w-full py-3 font-bold rounded-lg shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 hover:brightness-110">
                    OK, ENTENDI
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const btn = overlay.querySelector('#btnZoomOk');
    btn.onclick = () => {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s';
        setTimeout(() => overlay.remove(), 200);
        sessionStorage.setItem('knc:zoomAlertShown', 'true');
    };
}

function setActiveTab(pageName) {
    const p = normalizePage(pageName);
    tabButtons.forEach(btn => {
        btn.classList.toggle('active', normalizePage(btn.dataset.page) === p);
    });
    try {
        localStorage.setItem(LAST_PAGE_KEY, p);
    } catch (_) {
    }

    const currentPath = location.pathname.replace(/^\//, '');
    if (currentPath !== p) {
        history.pushState({page: p}, '', `/${p}`);
    }
}

function getInitialPage() {
    const path = location.pathname.replace(/^\//, '');
    const ignoreList = ['', 'dashboard', 'dashboard.html'];
    const fromPath = ignoreList.includes(path) ? '' : normalizePage(path);
    const fromStore = normalizePage(localStorage.getItem(LAST_PAGE_KEY));
    const fallback = 'colaboradores';
    const exists = (pg) => !!document.querySelector(`.tab-btn[data-page="${pg}"]`);

    if (fromPath && exists(fromPath)) return fromPath;
    if (fromStore && exists(fromStore)) return fromStore;
    return fallback;
}

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

    if (pageName === 'inclusao-pcd') {
        try {
            const key = `/src/pages/inclusao-pcd.js`;
            const loader = pageModules[key];
            if (!loader) throw new Error(`Script ${key} não encontrado. Verifique se o arquivo existe em src/pages.`);

            const module = await loader();
            if (myToken !== loadToken) return;

            currentModule = module;

            if (currentModule && typeof currentModule.renderInclusaoPCD === 'function') {
                currentModule.renderInclusaoPCD(contentArea);
            } else if (currentModule && typeof currentModule.init === 'function') {
                await currentModule.init();
            } else {
                throw new Error("Módulo PCD não possui função renderInclusaoPCD ou init.");
            }

        } catch (error) {
            console.error('Falha ao carregar PCD:', error);
            if (contentArea) contentArea.innerHTML = `<p class="p-4 text-red-500">Erro ao carregar módulo PCD.</p>`;
        } finally {
            if (myToken === loadToken) {
                isLoadingPage = false;
                if (contentArea) contentArea.classList.remove('fade-out');
            }
        }
        return;
    }

    // Lógica Padrão (Busca HTML + JS)
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

// --- Menu Lateral ---

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

// --- Sessão e Controle de Acesso ---

function checkSession() {
    const DEFAULT_AVATAR_URL = 'https://tzbqdjwgbisntzljwbqp.supabase.co/storage/v1/object/public/avatars/avatar.png';
    const userDataString = localStorage.getItem('userSession');
    if (!userDataString) {
        window.location.href = '/index.html';
        return;
    }
    try {
        const user = JSON.parse(userDataString);
        const userTipo = (user.Tipo || '').trim().toUpperCase();
        const userMatriz = (user.Matriz || '').trim().toUpperCase();
        const restrictedPage = 'separacao';

        // Regra para OPERAÇÃO: vê apenas a página separacao
        if (userTipo === 'OPERAÇÃO') {
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

            // Se a URL não for separação, força mudança
            const currentPath = normalizePage(location.pathname.replace(/^\//, ''));
            if (currentPath !== restrictedPage) {
                history.replaceState(null, '', `/${restrictedPage}`);
                // Não chamamos loadPage aqui para evitar duplo carregamento no init,
                // deixamos a lógica final do arquivo lidar com isso.
            }
        } else {
            // Outros usuários
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.style.display = '';
            });

            // 1. Oculta PAINEL GERENCIAL se não for MASTER
            if (userTipo !== 'MASTER') {
                const btnPainel = document.querySelector('.tab-btn[data-page="painel-gerencial"]');
                if (btnPainel) btnPainel.style.display = 'none';
            }

            // 2. Oculta PCD se não for MASTER nem ADMINISTRADOR
            if (userTipo !== 'MASTER' && userTipo !== 'ADMINISTRADOR') {
                const btnPcd = document.querySelector('.tab-btn[data-page="inclusao-pcd"]');
                if (btnPcd) btnPcd.style.display = 'none';
            }

            // Oculta separação se não for de Conquista ou TODOS
            if (!userMatriz.includes('CONQUISTA') && userMatriz !== 'TODOS') {
                const btnSeparacao = document.querySelector('.tab-btn[data-page="separacao"]');
                if (btnSeparacao) btnSeparacao.style.display = 'none';
            }
        }

        // Classes de Nível no Body (para CSS)
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

        // Avatar e Saudação
        const userAvatarEl = document.getElementById('userAvatar');
        if (userInfoEl) {
            const currentHour = new Date().getHours();
            const greeting =
                currentHour >= 5 && currentHour < 12 ? 'Bom dia' :
                    currentHour >= 12 && currentHour < 18 ? 'Boa tarde' : 'Boa noite';
            const fullName = user?.Nome || 'Usuário';
            const firstName = fullName.split(' ')[0];
            userInfoEl.textContent = `${greeting}, ${firstName}!`;
            showZoomRecommendation(firstName);
        }
        try {
            if (userAvatarEl) {
                if (user?.avatar_url && user.avatar_url.trim() !== '') {
                    userAvatarEl.src = user.avatar_url.toLowerCase();
                } else {
                    userAvatarEl.src = DEFAULT_AVATAR_URL;
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
}

// --- Modal Global de Adicionar (ex: Colaborador) ---

function showAddModal() {
    if (addModal) addModal.classList.remove('hidden');
}

function hideAddModal() {
    if (addModal) addModal.classList.add('hidden');
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


let hiddenAvatarInput = null;

function setupAvatarUpload(avatarElement) {
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
}

async function uploadAvatar(file, avatarElement) {
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
}

// --- Event Listeners Globais ---

tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
        if (isLoadingPage) return;
        const page = button.dataset.page;
        setActiveTab(page);
        loadPage(page);
        document.body.classList.add('sidebar-collapsed');
    });
});

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('knc:zoomAlertShown');
        localStorage.removeItem('userSession');
        window.location.href = '/index.html';
    });
}

if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        console.log('Iniciando captura de tela...');
        const originalText = screenshotBtn.textContent;
        const originalScrollY = window.scrollY;
        const originalScrollX = window.scrollX;
        screenshotBtn.disabled = true;
        screenshotBtn.textContent = 'Processando...';

        const body = document.body;
        const html = document.documentElement;

        const fullHeight = Math.max(
            body.scrollHeight, body.offsetHeight,
            html.clientHeight, html.scrollHeight, html.offsetHeight
        );
        const fullWidth = Math.max(
            body.scrollWidth, body.offsetWidth,
            html.clientWidth, html.scrollWidth, html.offsetWidth
        );

        window.scrollTo(0, 0);

        setTimeout(() => {
            html2canvas(document.body, {
                useCORS: true,
                logging: false,
                allowTaint: true,
                backgroundColor: '#ffffff',
                windowWidth: fullWidth,
                windowHeight: fullHeight,
                x: 0,
                y: 0,
                scrollX: 0,
                scrollY: 0
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
                window.scrollTo(originalScrollX, originalScrollY);
            });
        }, 800);
    });
}

window.addEventListener('popstate', () => {
    const pg = normalizePage(location.pathname.replace(/^\//, ''));
    if (!pg || pg === 'dashboard' || pg === 'dashboard.html') return;

    // --- VERIFICAÇÃO DE SEGURANÇA NO BOTÃO VOLTAR ---
    try {
        const user = JSON.parse(localStorage.getItem('userSession') || '{}');
        const userTipo = (user.Tipo || '').trim().toUpperCase();
        const userMatriz = (user.Matriz || '').trim().toUpperCase();

        // Alterado: Permite MASTER ou ADMINISTRADOR na aba Inclusao PCD
        if (pg === 'inclusao-pcd' && userTipo !== 'MASTER' && userTipo !== 'ADMINISTRADOR') {
            history.replaceState(null, '', '/colaboradores');
            setActiveTab('colaboradores');
            loadPage('colaboradores');
            return;
        }

        // Mantido: Apenas MASTER no painel gerencial
        if (pg === 'painel-gerencial' && userTipo !== 'MASTER') {
            history.replaceState(null, '', '/colaboradores');
            setActiveTab('colaboradores');
            loadPage('colaboradores');
            return;
        }

        if (userTipo === 'OPERAÇÃO' && pg !== 'separacao') {
            history.replaceState(null, '', '/separacao');
            setActiveTab('separacao');
            loadPage('separacao');
            return;
        }
    } catch (e) {
        console.error(e);
    }


    if (!document.querySelector(`.tab-btn[data-page="${pg}"]`)) return;

    tabButtons.forEach(btn => {
        btn.classList.toggle('active', normalizePage(btn.dataset.page) === pg);
    });
    loadPage(pg);
});

// --- EXECUÇÃO INICIAL ---

checkSession();

// --- LÓGICA DE SEGURANÇA E CARREGAMENTO BLINDADO ---

let firstPage = getInitialPage();

try {
    const user = JSON.parse(localStorage.getItem('userSession') || '{}');
    const userTipo = (user.Tipo || '').trim().toUpperCase();
    const userMatriz = (user.Matriz || '').trim().toUpperCase();

    // 1. Bloqueio PCD (Permitido MASTER ou ADMINISTRADOR)
    if (firstPage === 'inclusao-pcd' && userTipo !== 'MASTER' && userTipo !== 'ADMINISTRADOR') {
        console.warn('Acesso direto bloqueado: PCD');
        firstPage = 'colaboradores';
    }

    // 2. Bloqueio Painel Gerencial (Apenas MASTER)
    if (firstPage === 'painel-gerencial' && userTipo !== 'MASTER') {
        console.warn('Acesso direto bloqueado: Painel');
        firstPage = 'colaboradores';
    }

    // 3. Bloqueio Operação (só vê separacao)
    if (userTipo === 'OPERAÇÃO' && firstPage !== 'separacao') {
        console.warn('Acesso direto bloqueado: Operação');
        firstPage = 'separacao';
    }

    // 4. Bloqueio Separação para quem não é da área
    if (firstPage === 'separacao' && !userMatriz.includes('CONQUISTA') && userMatriz !== 'TODOS') {
        console.warn('Acesso direto bloqueado: Separação');
        firstPage = 'colaboradores';
    }

} catch (e) {
    console.error("Erro na verificação de segurança inicial", e);
    firstPage = 'colaboradores'; // Fallback seguro
}


setActiveTab(firstPage);
loadPage(firstPage);