let currentSubpage = null;
let currentSubpageModule = null;
let subtabButtons = [];
let contentArea = null;
let isLoadingSubpage = false;
let subpageLoadToken = 0;
const subpageModules = import.meta.glob('/src/pages/*.js');async function loadSubpage(pageName) {
    if (!pageName || isLoadingSubpage) return;
    isLoadingSubpage = true;
    const myToken = ++subpageLoadToken;    if (contentArea) {
        contentArea.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 150));
        if (myToken !== subpageLoadToken) {
            isLoadingSubpage = false;
            return;
        }
        contentArea.innerHTML = `<div class="p-4 text-sm text-gray-500">Carregando ${pageName}...</div>`;
        contentArea.style.opacity = '1';
    }    try {        if (currentSubpageModule && typeof currentSubpageModule.destroy === 'function') {
            await currentSubpageModule.destroy();
        }
        currentSubpageModule = null;
        const htmlResponse = await fetch(`/pages/${pageName}.html`, {cache: 'no-cache'});
        if (!htmlResponse.ok) {
            throw new Error(`HTML da sub-página ${pageName} não encontrado (HTTP ${htmlResponse.status}).`);
        }
        const htmlContent = await htmlResponse.text();        if (myToken !== subpageLoadToken) return;
        if (contentArea) {
            contentArea.innerHTML = htmlContent;
        }
        const modulePath = `/src/pages/${pageName}.js`;
        if (!subpageModules[modulePath]) {
            throw new Error(`Módulo JS (${modulePath}) não foi encontrado. Verifique o caminho em import.meta.glob.`);
        }
        const moduleFactory = subpageModules[modulePath];
        const module = await moduleFactory();
        if (myToken !== subpageLoadToken) return;
        currentSubpageModule = module;
        currentSubpage = pageName;
        if (currentSubpageModule && typeof currentSubpageModule.init === 'function') {
            await currentSubpageModule.init();
        }    } catch (error) {
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
}export async function init() {
    console.log("Inicializando Gerot Meli...");
    contentArea = document.getElementById('gerotmeli-content-area');
    subtabButtons = document.querySelectorAll('#tab-gerotmeli .subtab-btn');    subtabButtons.forEach(button => {
        button.addEventListener('click', handleSubtabClick);
    });
    const defaultSubpage = 'daily-regional';
    const defaultButton = document.querySelector(`#tab-gerotmeli .subtab-btn[data-subpage="${defaultSubpage}"]`);
    if (defaultButton) {
        defaultButton.classList.add('active');
        await loadSubpage(defaultSubpage);
    } else if (subtabButtons.length > 0) {        subtabButtons[0].classList.add('active');
        await loadSubpage(subtabButtons[0].dataset.subpage);
    }
}function handleSubtabClick(event) {
    if (isLoadingSubpage) return;
    const clickedButton = event.currentTarget;
    const subpageToLoad = clickedButton.dataset.subpage;    if (subpageToLoad && subpageToLoad !== currentSubpage) {
        subtabButtons.forEach(btn => btn.classList.remove('active'));
        clickedButton.classList.add('active');
        loadSubpage(subpageToLoad);
    }
}export async function destroy() {
    console.log("Destruindo Gerot Meli...");
    subtabButtons.forEach(button => {
        button.removeEventListener('click', handleSubtabClick);
    });    if (currentSubpageModule && typeof currentSubpageModule.destroy === 'function') {
        try {
            await currentSubpageModule.destroy();
        } catch (e) {
            console.warn(`Erro ao destruir sub-módulo ${currentSubpage}:`, e);
        }
    }    contentArea = null;
    subtabButtons = [];
    currentSubpage = null;
    currentSubpageModule = null;
    isLoadingSubpage = false;
    subpageLoadToken = 0;
}