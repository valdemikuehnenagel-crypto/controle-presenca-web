// Variáveis globais para este módulo
let currentSubpage = null;
let currentSubpageModule = null;
let subtabButtons = [];
let contentArea = null;
let isLoadingSubpage = false;
let subpageLoadToken = 0;

// *** INÍCIO DA CORREÇÃO ***
// Informa ao Vite (Vercel) sobre todos os módulos JS na pasta /src/pages/
// Isso garante que eles sejam incluídos no build de produção.
const subpageModules = import.meta.glob('/src/pages/*.js');
// *** FIM DA CORREÇÃO ***


// Função para carregar dinamicamente o HTML e JS de uma sub-página
async function loadSubpage(pageName) {
    if (!pageName || isLoadingSubpage) return;
    isLoadingSubpage = true;
    const myToken = ++subpageLoadToken;

    if (contentArea) {
        contentArea.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 150));
        if (myToken !== subpageLoadToken) {
            isLoadingSubpage = false;
            return;
        }
        contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando ${pageName}...</div>`;
        contentArea.style.opacity = '1';
    }

    try {
        // 1. Destruir o módulo da sub-página anterior (se existir)
        if (currentSubpageModule && typeof currentSubpageModule.destroy === 'function') {
            await currentSubpageModule.destroy();
        }
        currentSubpageModule = null;

        // 2. Buscar o HTML da sub-página (Isso já estava correto, pois /pages/ está na pasta 'public')
        const htmlResponse = await fetch(`/pages/${pageName}.html`, {cache: 'no-cache'});
        if (!htmlResponse.ok) {
            throw new Error(`HTML da sub-página ${pageName} não encontrado (HTTP ${htmlResponse.status}).`);
        }
        const htmlContent = await htmlResponse.text();

        if (myToken !== subpageLoadToken) return;

        // 3. Injetar o HTML no container
        if (contentArea) {
            contentArea.innerHTML = htmlContent;
        }

        // *** INÍCIO DA CORREÇÃO ***
        // 4. Carregar o Módulo JS usando o glob que definimos
        const modulePath = `/src/pages/${pageName}.js`;

        // Verifica se o módulo que queremos existe no 'manifest' que o Vite criou
        if (!subpageModules[modulePath]) {
            throw new Error(`Módulo JS (${modulePath}) não foi encontrado. Verifique o caminho em import.meta.glob.`);
        }

        // O glob retorna uma *função* que, quando chamada, importa o módulo
        const moduleFactory = subpageModules[modulePath];
        const module = await moduleFactory(); // Chama a função para carregar o módulo
        // *** FIM DA CORREÇÃO ***


        if (myToken !== subpageLoadToken) return;

        // 5. Chamar a função init do módulo carregado
        currentSubpageModule = module;
        currentSubpage = pageName;
        if (currentSubpageModule && typeof currentSubpageModule.init === 'function') {
            await currentSubpageModule.init();
        }

    } catch (error) {
        console.error(`Falha ao carregar a sub-página ${pageName}:`, error);
        if (contentArea && myToken === subpageLoadToken) {
            contentArea.innerHTML = `<p class="p-4 text-red-500">Erro ao carregar a interface da sub-aba "${pageName}".</p>`;
        }
    } finally {
        if (myToken === subpageLoadToken) {
            isLoadingSubpage = false;
            if (contentArea) contentArea.style.opacity = '1';
        }
    }
}

// Função chamada quando a aba "Gerot Meli" é aberta (pelo dashboard.js)
export async function init() {
    console.log("Inicializando Gerot Meli...");
    contentArea = document.getElementById('gerotmeli-content-area');
    subtabButtons = document.querySelectorAll('#tab-gerotmeli .subtab-btn');

    subtabButtons.forEach(button => {
        button.addEventListener('click', handleSubtabClick);
    });

    // Carrega a sub-aba padrão (Daily Op)
    const defaultSubpage = 'daily-regional';
    const defaultButton = document.querySelector(`#tab-gerotmeli .subtab-btn[data-subpage="${defaultSubpage}"]`);
    if (defaultButton) {
        defaultButton.classList.add('active');
        await loadSubpage(defaultSubpage);
    } else if (subtabButtons.length > 0) {
        // Se a padrão não existir, carrega a primeira disponível
        subtabButtons[0].classList.add('active');
        await loadSubpage(subtabButtons[0].dataset.subpage);
    }
}

// Handler para clique nas sub-abas
function handleSubtabClick(event) {
    if (isLoadingSubpage) return;
    const clickedButton = event.currentTarget;
    const subpageToLoad = clickedButton.dataset.subpage;

    if (subpageToLoad && subpageToLoad !== currentSubpage) {
        subtabButtons.forEach(btn => btn.classList.remove('active'));
        clickedButton.classList.add('active');
        loadSubpage(subpageToLoad);
    }
}

// Função chamada quando o usuário sai da aba "Gerot Meli" (pelo dashboard.js)
export async function destroy() {
    console.log("Destruindo Gerot Meli...");
    subtabButtons.forEach(button => {
        button.removeEventListener('click', handleSubtabClick);
    });

    if (currentSubpageModule && typeof currentSubpageModule.destroy === 'function') {
        try {
            await currentSubpageModule.destroy();
        } catch (e) {
            console.warn(`Erro ao destruir sub-módulo ${currentSubpage}:`, e);
        }
    }

    contentArea = null;
    subtabButtons = [];
    currentSubpage = null;
    currentSubpageModule = null;
    isLoadingSubpage = false;
    subpageLoadToken = 0;
}