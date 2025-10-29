// Variáveis globais para este módulo
let currentSubpage = null;
let currentSubpageModule = null;
let subtabButtons = [];
let contentArea = null;
let isLoadingSubpage = false;
let subpageLoadToken = 0; // Para evitar condições de corrida ao carregar

// Função para carregar dinamicamente o HTML e JS de uma sub-página
async function loadSubpage(pageName) {
    if (!pageName || isLoadingSubpage) return;
    isLoadingSubpage = true;
    const myToken = ++subpageLoadToken; // Incrementa token para esta tentativa

    // Mostra feedback de carregamento
    if (contentArea) {
        contentArea.style.opacity = '0'; // Começa a esmaecer
        await new Promise(resolve => setTimeout(resolve, 150)); // Tempo para animação
        if (myToken !== subpageLoadToken) { // Verifica se outra carga começou
             isLoadingSubpage = false;
             return;
        }
        contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando ${pageName}...</div>`;
        contentArea.style.opacity = '1'; // Mostra carregando
    }

    try {
        // 1. Destruir o módulo da sub-página anterior (se existir)
        if (currentSubpageModule && typeof currentSubpageModule.destroy === 'function') {
            await currentSubpageModule.destroy();
        }
        currentSubpageModule = null; // Limpa a referência

        // 2. Buscar o HTML da sub-página
        const htmlResponse = await fetch(`/pages/${pageName}.html`, { cache: 'no-cache' });
        if (!htmlResponse.ok) {
            throw new Error(`HTML da sub-página ${pageName} não encontrado (HTTP ${htmlResponse.status}).`);
        }
        const htmlContent = await htmlResponse.text();

        if (myToken !== subpageLoadToken) return; // Aborta se outra carga começou

        // 3. Injetar o HTML no container
        if (contentArea) {
            contentArea.innerHTML = htmlContent;
        }

        // 4. Importar dinamicamente o módulo JS da sub-página
        //    IMPORTANTE: O caminho DEVE começar com '/' ou ser relativo à raiz do projeto
        //    para que o build/servidor consiga encontrá-lo.
        const modulePath = `/src/pages/${pageName}.js`;
        const module = await import(modulePath);

        if (myToken !== subpageLoadToken) return; // Aborta se outra carga começou

        // 5. Chamar a função init do módulo carregado
        currentSubpageModule = module;
        currentSubpage = pageName;
        if (currentSubpageModule && typeof currentSubpageModule.init === 'function') {
            await currentSubpageModule.init();
        }

    } catch (error) {
        console.error(`Falha ao carregar a sub-página ${pageName}:`, error);
        if (contentArea && myToken === subpageLoadToken) { // Mostra erro apenas se for a carga mais recente
            contentArea.innerHTML = `<p class="p-4 text-red-500">Erro ao carregar a interface da sub-aba "${pageName}".</p>`;
        }
    } finally {
        if (myToken === subpageLoadToken) { // Só finaliza se for a carga mais recente
            isLoadingSubpage = false;
             if(contentArea) contentArea.style.opacity = '1'; // Garante visibilidade
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
    if (isLoadingSubpage) return; // Ignora cliques enquanto carrega
    const clickedButton = event.currentTarget;
    const subpageToLoad = clickedButton.dataset.subpage;

    if (subpageToLoad && subpageToLoad !== currentSubpage) {
        // Remove 'active' de todos os botões
        subtabButtons.forEach(btn => btn.classList.remove('active'));
        // Adiciona 'active' ao botão clicado
        clickedButton.classList.add('active');
        // Carrega a nova sub-página
        loadSubpage(subpageToLoad);
    }
}

// Função chamada quando o usuário sai da aba "Gerot Meli" (pelo dashboard.js)
export async function destroy() {
    console.log("Destruindo Gerot Meli...");
    // Remove listeners dos botões das sub-abas
    subtabButtons.forEach(button => {
        button.removeEventListener('click', handleSubtabClick);
    });

    // Chama o destroy do módulo da sub-página atualmente carregada
    if (currentSubpageModule && typeof currentSubpageModule.destroy === 'function') {
        try {
            await currentSubpageModule.destroy();
        } catch (e) {
            console.warn(`Erro ao destruir sub-módulo ${currentSubpage}:`, e);
        }
    }

    // Limpa referências
    contentArea = null;
    subtabButtons = [];
    currentSubpage = null;
    currentSubpageModule = null;
    isLoadingSubpage = false; // Reseta estado de carregamento
    subpageLoadToken = 0; // Reseta token
}