import { supabase } from './src/supabaseClient.js';

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

// --- FUNÇÕES ---

// Função de segurança que verifica a sessão do usuário
function checkSession() {
    const userDataString = localStorage.getItem('userSession');
    if (!userDataString) {
        window.location.href = '/index.html'; // Redireciona se não estiver logado
        return;
    }
    const user = JSON.parse(userDataString);
    userInfoEl.textContent = user.Usuario;
}

// Função principal que carrega o conteúdo e a lógica de uma aba
async function loadPage(pageName) {
    // 1. Busca o HTML da página e o insere na área de conteúdo
    try {
        const response = await fetch(`/src/pages/${pageName}.html`);
        if (!response.ok) throw new Error(`HTML da página ${pageName} não encontrado.`);
        contentArea.innerHTML = await response.text();
    } catch (error) {
        console.error(`Falha ao carregar HTML da aba: ${error}`);
        contentArea.innerHTML = `<p class="p-4 text-red-500">Erro ao carregar a interface da aba.</p>`;
        return;
    }

    // 2. Importa o módulo JavaScript correspondente àquela página
    try {
        const module = await import(`/src/pages/${pageName}.js`);
        currentModule = module;

        // 3. Se o módulo tiver uma função 'init', ele a executa. (A CORREÇÃO ESTÁ AQUI)
        if (currentModule && typeof currentModule.init === 'function') {
            currentModule.init(); // Inicializa a lógica da aba
        }
    } catch (error) {
        console.error(`Falha ao carregar ou inicializar o script da aba: ${error}`);
        // Não mostra erro na tela, pois o HTML já carregou
    }
}

// --- LÓGICA DO MODAL ---
function showAddModal() {
    if (addModal) addModal.classList.remove('hidden');
}

function hideAddModal() {
    if (addModal) addModal.classList.add('hidden');
    // A limpeza do formulário (reset) será feita pelo módulo 'colaboradores.js'
}

// --- EVENT LISTENERS GLOBAIS ---

// Adiciona o listener para cada botão de aba
tabButtons.forEach(button => {
    button.addEventListener('click', () => {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        const page = button.dataset.page;
        loadPage(page);
    });
});

// Listener de Logout
logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('userSession');
    window.location.href = '/index.html';
});

// "Ouvinte" para o evento que o colaboradores.js dispara para abrir o modal
document.addEventListener('open-add-modal', showAddModal);

// Listener para o botão de cancelar do modal
if (cancelBtn) {
    cancelBtn.addEventListener('click', hideAddModal);
}

// "Ouvinte" para quando um colaborador for adicionado com sucesso
document.addEventListener('colaborador-added', () => {
    hideAddModal();
    // Apenas recarrega os dados da aba atual se for a de colaboradores
    if (document.querySelector('[data-page="colaboradores"].active')) {
        if (currentModule && typeof currentModule.init === 'function') {
            currentModule.init();
        }
    }
});

// --- INICIALIZAÇÃO DA PÁGINA ---
checkSession();
loadPage('colaboradores'); // Carrega a aba de colaboradores por padrão