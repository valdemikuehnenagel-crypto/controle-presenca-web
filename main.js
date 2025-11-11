import {createClient} from '@supabase/supabase-js';

document.addEventListener('DOMContentLoaded', () => {
    const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);
    const container = document.getElementById('container');
    const showRegisterBtn = document.getElementById('showRegisterBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');
    const registerForm = document.getElementById('registerForm');
    const registerName = document.getElementById('registerName');
    const registerEmail = document.getElementById('registerEmail');
    const registerFuncao = document.getElementById('registerFuncao');
    const registerMsg = document.getElementById('registerMsg');
    const generatePinBtn = document.getElementById('generatePinBtn');
    const generatedPinDisplay = document.getElementById('generatedPinDisplay');
    const pinMessage = document.getElementById('pinMessage');
    let generatedPin = null;
    let selectedMatrizesState = [];
    const matrizModal = document.getElementById('matriz-modal');
    const modalOverlay = document.getElementById('matriz-modal-overlay');
    const openModalBtn = document.getElementById('open-matriz-modal-btn');
    const closeModalBtn = document.getElementById('close-matriz-modal-btn');
    const confirmSelectionBtn = document.getElementById('confirm-matriz-selection-btn');
    const modalMatrizList = document.getElementById('modal-matriz-list');

    function openModal() {
        if (matrizModal) matrizModal.classList.add('show');
        if (modalOverlay) modalOverlay.classList.add('show');
    }

    function closeModal() {
        if (matrizModal) matrizModal.classList.remove('show');
        if (modalOverlay) modalOverlay.classList.remove('show');
    }

    function updateMainButtonText() {
        const triggerSpan = openModalBtn.querySelector('span');
        if (selectedMatrizesState.includes('TODOS')) {
            triggerSpan.textContent = 'TODOS';
        } else if (selectedMatrizesState.length === 0) {
            triggerSpan.textContent = 'Selecione a Matriz';
        } else if (selectedMatrizesState.length === 1) {
            triggerSpan.textContent = selectedMatrizesState[0];
        } else {
            triggerSpan.textContent = `${selectedMatrizesState.length} matrizes selecionadas`;
        }
    }

    if (openModalBtn) openModalBtn.addEventListener('click', openModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);
    if (confirmSelectionBtn) {
        confirmSelectionBtn.addEventListener('click', () => {
            const checkedBoxes = modalMatrizList.querySelectorAll('input[type="checkbox"]:checked');
            selectedMatrizesState = Array.from(checkedBoxes).map(cb => cb.value);
            updateMainButtonText();
            closeModal();
        });
    }
    if (showRegisterBtn) {
        showRegisterBtn.addEventListener('click', () => {
            container.classList.add('active');
            loadMatrizes();
            loadFuncoes();
        });
    }
    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', () => {
            container.classList.remove('active');
        });
    }

    async function verifyPin(pin) {
        const loginMsg = document.getElementById('loginMsg');
        loginMsg.classList.remove('info');
        loginMsg.textContent = 'Verificando...';
        const {data, error} = await supabase.from('Logins').select('*').eq('PIN', pin).single();
        if (error || !data) {
            loginMsg.textContent = 'PIN inválido ou erro na conexão.';
            return;
        }
        if (data.Aprovacao !== 'SIM') {
            loginMsg.textContent = 'Acesso pendente de aprovação.';
            return;
        }
        localStorage.setItem('userSession', JSON.stringify(data));
        await logLoginHistory(data);
        const loginFormContent = document.getElementById('login-form-content');
        if (loginFormContent) loginFormContent.classList.add('fade-out-start');
        const welcomeBackContainer = document.getElementById('welcome-back-container');
        if (welcomeBackContainer) {
            const welcomeMessage = document.getElementById('welcome-message');
            const welcomeAvatar = document.getElementById('welcome-avatar');
            const fullName = data.Nome || 'Usuário';
            const firstName = fullName.split(' ')[0];
            if (welcomeMessage) welcomeMessage.textContent = `Olá, ${firstName}!`;

            // <-- AJUSTE AQUI -->
            // Força a URL para minúsculas para o navegador carregar
            if (welcomeAvatar && data.avatar_url) {
                welcomeAvatar.src = data.avatar_url.toLowerCase();
            } else if (welcomeAvatar) {
                welcomeAvatar.src = '/imagens/avatar.png'; // Fallback
            }
            // <-- FIM DO AJUSTE -->

            welcomeBackContainer.classList.remove('hidden');
            setTimeout(() => welcomeBackContainer.classList.add('visible'), 10);
        }
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 2800);
    }

    const loginForm = document.getElementById('loginForm');
    const pinLogin = document.getElementById('pinLogin');
    const forgotPinBtn = document.getElementById('forgotPinBtn');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            verifyPin(pinLogin.value);
        });
    }
    if (pinLogin) {
        pinLogin.addEventListener('input', () => {
            if (pinLogin.value.length === 6) verifyPin(pinLogin.value);
        });
    }
    if (forgotPinBtn) {
        forgotPinBtn.addEventListener('click', () => {
            const loginMsg = document.getElementById('loginMsg');
            loginMsg.textContent = 'Entre em contato conosco! Valdemi.silva@Kuehne-nagel.com';
            loginMsg.classList.add('info');
        });
    }
    const funcoes = ['ANALISTA', 'COORDENADOR', 'DIRETOR', 'ESTAGIÁRIO', 'GERENTE', 'JOVEM APRENDIZ', 'LÍDER', 'MELI', 'SHE', 'SUPERVISOR'];

    function loadFuncoes() {
        if (!registerFuncao) return;
        registerFuncao.innerHTML = '<option value="" disabled selected>Selecione a Função</option>';
        funcoes.forEach(funcao => {
            const option = document.createElement('option');
            option.value = funcao;
            option.textContent = funcao;
            registerFuncao.appendChild(option);
        });
    }

    async function loadMatrizes() {
        if (!modalMatrizList) return;
        modalMatrizList.innerHTML = '<div class="custom-option">Carregando...</div>';
        const {data, error} = await supabase.from('Matrizes').select('MATRIZ');
        if (error) {
            modalMatrizList.innerHTML = '<div class="custom-option">Erro ao carregar.</div>';
            return;
        }
        modalMatrizList.innerHTML = '';
        const matrizesUnicas = Array.from(new Set(data.map(item => item.MATRIZ))).sort();
        const createOption = (value, id) => {
            const optionDiv = document.createElement('div');
            optionDiv.classList.add('custom-option');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = id;
            checkbox.value = value;
            const label = document.createElement('label');
            label.htmlFor = id;
            label.textContent = value;
            optionDiv.appendChild(checkbox);
            optionDiv.appendChild(label);
            modalMatrizList.appendChild(optionDiv);
            return checkbox;
        };
        const todosCheckbox = createOption('TODOS', 'modal-matriz-checkbox-todos');
        const individualCheckboxes = matrizesUnicas.map(m => createOption(m, `modal-matriz-${m.replace(/\s+/g, '-')}`));
        modalMatrizList.addEventListener('change', (e) => {
            if (e.target.type === 'checkbox') {
                if (e.target === todosCheckbox) {
                    individualCheckboxes.forEach(cb => cb.checked = todosCheckbox.checked);
                } else {
                    if (!e.target.checked) todosCheckbox.checked = false;
                    const allChecked = individualCheckboxes.every(cb => cb.checked);
                    todosCheckbox.checked = allChecked;
                }
            }
        });
    }

    async function createUniquePin() {
        let pin;
        let pinExists = true;
        let attempts = 0;
        while (pinExists && attempts < 50) {
            pin = Math.floor(100000 + Math.random() * 900000).toString();
            const {data, error} = await supabase
                .from('Logins')
                .select('PIN')
                .eq('PIN', pin)
                .single();
            if (!data && (error && error.code === 'PGRST116')) {
                pinExists = false;
            } else if (error && error.code !== 'PGRST116') {
                console.error('Erro ao verificar PIN:', error);
                return null;
            }
            attempts++;
        }
        if (pinExists) {
            console.error('Não foi possível gerar um PIN único após 50 tentativas.');
            return null;
        }
        return pin;
    }

    if (generatePinBtn) {
        generatePinBtn.addEventListener('click', async () => {
            generatePinBtn.disabled = true;
            generatePinBtn.textContent = 'Gerando...';
            if (generatedPinDisplay) generatedPinDisplay.textContent = '';
            if (pinMessage) pinMessage.textContent = '';
            generatedPin = null;
            const newPin = await createUniquePin();
            if (newPin) {
                generatedPin = newPin;
                if (generatedPinDisplay) generatedPinDisplay.textContent = newPin;
                if (pinMessage) pinMessage.textContent = 'Por favor, anote seu pin... Esse é seu acesso.';
                generatePinBtn.textContent = 'Gerar PIN';
            } else {
                if (pinMessage) pinMessage.textContent = 'Erro ao gerar PIN. Tente novamente.';
                generatePinBtn.textContent = 'Gerar PIN';
            }
            generatePinBtn.disabled = false;
        });
    }
    if (registerForm) {
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            registerMsg.textContent = 'Enviando...';
            registerMsg.classList.remove('error');
            let matrizValue = '';
            if (selectedMatrizesState.includes('TODOS')) {
                matrizValue = 'TODOS';
            } else {
                matrizValue = selectedMatrizesState.join(', ');
            }
            const userData = {
                nome: registerName.value,
                email: registerEmail.value,
                matriz: matrizValue,
                funcao: registerFuncao.value,
                pin: generatedPin,
            };
            if (!userData.nome || !userData.email || !userData.matriz || !userData.funcao || !userData.pin) {
                registerMsg.textContent = 'Todos os campos são obrigatórios. Não se esqueça de gerar seu PIN.';
                registerMsg.classList.add('error');
                return;
            }
            const nivelParaSalvar = (userData.funcao === 'MELI') ? 'VISITANTE' : 'Usuario';

            // (Assumindo que sua lógica de upload de avatar está aqui ou em outro lugar)
            // Se você ainda não tem, a lógica da minha resposta anterior deve ser inserida aqui.

            const {error: insertError} = await supabase.from('Logins').insert({
                PIN: userData.pin,
                Nome: userData.nome,
                Usuario: userData.email.toLowerCase(),
                Matriz: userData.matriz,
                Tipo: userData.funcao,
                Nivel: nivelParaSalvar,
                Aprovacao: 'PENDENTE'
                // Se a lógica de upload estiver aqui, você adicionaria:
                // avatar_url: avatarUrl
            });
            if (insertError) {
                registerMsg.textContent = 'Erro ao registrar. Este Email já pode estar em uso.';
                registerMsg.classList.add('error');
            } else {
                registerMsg.textContent = 'Solicitação enviada! Aguarde a aprovação.';
                registerForm.reset();
                selectedMatrizesState = [];
                updateMainButtonText();
                generatedPin = null;
                if (generatedPinDisplay) generatedPinDisplay.textContent = '';
                if (pinMessage) pinMessage.textContent = '';
                if (generatePinBtn) generatePinBtn.textContent = 'Gerar PIN';
                setTimeout(() => {
                    container.classList.remove('active');
                }, 3000);
            }
        });
    }

    function getBrasiliaTimestamp() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    async function logLoginHistory(userData) {
        try {
            const {error} = await supabase.from('LoginHistorico').insert({
                Nome: userData.Nome,
                Usuario: userData.Usuario,
                MATRIZ: userData.Matriz,
                SVC: userData.SVC,
                'Data Login': getBrasiliaTimestamp()
            });
            if (error) throw error;
        } catch (error) {
            console.error('Erro ao registrar histórico de login:', error.message);
        }
    }
});