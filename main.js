import {createClient} from '@supabase/supabase-js';document.addEventListener('DOMContentLoaded', () => {
    const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY);    const container = document.getElementById('container');
    const showRegisterBtn = document.getElementById('showRegisterBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');    const registerForm = document.getElementById('registerForm');
    const registerName = document.getElementById('registerName');
    const registerEmail = document.getElementById('registerEmail');
    const registerFuncao = document.getElementById('registerFuncao');
    const registerMsg = document.getElementById('registerMsg');
    const registerPassword = document.getElementById('registerPassword');    let selectedMatrizesState = [];
    const matrizModal = document.getElementById('matriz-modal');
    const modalOverlay = document.getElementById('matriz-modal-overlay');
    const openModalBtn = document.getElementById('open-matriz-modal-btn');
    const closeModalBtn = document.getElementById('close-matriz-modal-btn');
    const confirmSelectionBtn = document.getElementById('confirm-matriz-selection-btn');
    const modalMatrizList = document.getElementById('modal-matriz-list');    const migrationModal = document.getElementById('migration-modal');
    const migrationOverlay = document.getElementById('migration-modal-overlay');
    const migrationPassword = document.getElementById('migrationPassword');
    const confirmMigrationBtn = document.getElementById('confirm-migration-btn');
    const migrationMsg = document.getElementById('migrationMsg');
    let userToMigrate = null;    const eyeOpenSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
    const eyeClosedSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const input = document.getElementById(targetId);            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = eyeOpenSVG;
            } else {
                input.type = 'password';
                btn.innerHTML = eyeClosedSVG;
            }
        });
    });    function openModal() {
        if (matrizModal) matrizModal.classList.add('show');
        if (modalOverlay) modalOverlay.classList.add('show');
    }    function closeModal() {
        if (matrizModal) matrizModal.classList.remove('show');
        if (modalOverlay) modalOverlay.classList.remove('show');
    }    function updateMainButtonText() {
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
    }    if (openModalBtn) openModalBtn.addEventListener('click', openModal);
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', closeModal);
    if (confirmSelectionBtn) {
        confirmSelectionBtn.addEventListener('click', () => {
            const checkedBoxes = modalMatrizList.querySelectorAll('input[type="checkbox"]:checked');
            selectedMatrizesState = Array.from(checkedBoxes).map(cb => cb.value);
            updateMainButtonText();
            closeModal();
        });
    }    if (showRegisterBtn) {
        showRegisterBtn.addEventListener('click', () => {
            container.classList.add('active');
            loadMatrizes();
            loadFuncoes();
        });
    }    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', () => {
            container.classList.remove('active');
        });
    }    function isPasswordStrictlyValid(password) {        const hasMinLength = password.length >= 8;
        const hasLetter = /[a-zA-Z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        const hasSpecial = /[^a-zA-Z0-9]/.test(password);        return hasMinLength && hasLetter && hasNumber && hasSpecial;
    }    function setupPasswordMeter(inputElement, indicatorElement, textElement) {
        if (!inputElement || !indicatorElement || !textElement) return;        inputElement.addEventListener('input', function () {
            const password = this.value;            let score = 0;
            if (password.length >= 8) score++;
            if (/[a-zA-Z]/.test(password)) score++;
            if (/[0-9]/.test(password)) score++;
            if (/[^a-zA-Z0-9]/.test(password)) score++;            if (password.length > 0 && password.length < 6) score = 1;            const width = (score / 4) * 100;
            indicatorElement.style.width = `${Math.min(width, 100)}%`;            switch (score) {
                case 0:
                case 1:
                    indicatorElement.style.backgroundColor = "#e70b0b";
                    textElement.innerHTML = "Muito fraca";
                    break;
                case 2:
                    indicatorElement.style.backgroundColor = "#FFB74D";
                    textElement.innerHTML = "Média";
                    break;
                case 3:
                    indicatorElement.style.backgroundColor = "#FFF176";
                    textElement.innerHTML = "Forte";
                    break;
                case 4:
                    indicatorElement.style.backgroundColor = "#81C784";
                    textElement.innerHTML = "Muito Forte";
                    break;
            }            if (password.length === 0) {
                textElement.innerHTML = "";
                indicatorElement.style.width = "0";
            }
        });
    }    setupPasswordMeter(
        document.getElementById('registerPassword'),
        document.getElementById('password-strength-indicator'),
        document.getElementById('password-strength-text')
    );    setupPasswordMeter(
        document.getElementById('migrationPassword'),
        document.getElementById('migration-strength-indicator'),
        document.getElementById('migration-strength-text')
    );    if (registerForm) {
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            registerMsg.textContent = 'Validando...';
            registerMsg.classList.remove('error');            let matrizValue = '';
            if (selectedMatrizesState.includes('TODOS')) {
                matrizValue = 'TODOS';
            } else {
                matrizValue = selectedMatrizesState.join(', ');
            }            const userPassword = registerPassword.value;            if (!isPasswordStrictlyValid(userPassword)) {
                registerMsg.textContent = "Caro usuário, sua senha precisa ter no mínimo 8 dígitos, letras, números e caracteres especiais. Ex: @ # $ !";
                registerMsg.classList.add('error');
                return;
            }            const userData = {
                nome: registerName.value,
                email: registerEmail.value,
                matriz: matrizValue,
                funcao: registerFuncao.value,
                senha: userPassword,
            };            if (!userData.nome || !userData.email || !userData.matriz || !userData.funcao) {
                registerMsg.textContent = 'Todos os campos são obrigatórios.';
                registerMsg.classList.add('error');
                return;
            }            registerMsg.textContent = 'Enviando...';
            const nivelParaSalvar = (userData.funcao === 'MELI') ? 'VISITANTE' : 'Usuario';            const {error: insertError} = await supabase.from('Logins').insert({
                Senha: userData.senha,
                PIN: null,
                Nome: userData.nome,
                Usuario: userData.email.toLowerCase(),
                Matriz: userData.matriz,
                Tipo: userData.funcao,
                Nivel: nivelParaSalvar,
                Aprovacao: 'PENDENTE'
            });            if (insertError) {
                console.error(insertError);
                registerMsg.textContent = 'Erro ao registrar. Verifique os dados ou tente novamente.';
                registerMsg.classList.add('error');
            } else {
                registerMsg.textContent = 'Solicitação enviada! Aguarde a aprovação.';
                registerForm.reset();
                document.getElementById('password-strength-indicator').style.width = '0';
                document.getElementById('password-strength-text').textContent = '';                selectedMatrizesState = [];
                updateMainButtonText();                setTimeout(() => {
                    container.classList.remove('active');
                }, 3000);
            }
        });
    }    async function verifyLogin(credential) {
        const loginMsg = document.getElementById('loginMsg');
        loginMsg.classList.remove('info');
        loginMsg.textContent = 'Verificando...';        const {data: users, error} = await supabase
            .from('Logins')
            .select('*')
            .or(`Senha.eq.${credential},PIN.eq.${credential}`);        if (error || !users || users.length === 0) {
            loginMsg.textContent = 'Credenciais inválidas.';
            return;
        }        const user = users[0];        if (user.Aprovacao !== 'SIM') {
            loginMsg.textContent = 'Acesso pendente de aprovação.';
            return;
        }        if (user.PIN === credential) {
            userToMigrate = user;
            openMigrationModal();
            loginMsg.textContent = '';
            return;
        }        if (user.Senha === credential) {
            performLoginSuccess(user);
        } else {
            loginMsg.textContent = 'Credenciais inválidas.';
        }
    }    function openMigrationModal() {
        if (migrationModal) migrationModal.classList.add('show');
        if (migrationOverlay) migrationOverlay.classList.add('show');
    }    function closeMigrationModal() {
        if (migrationModal) migrationModal.classList.remove('show');
        if (migrationOverlay) migrationOverlay.classList.remove('show');        migrationPassword.value = '';
        document.getElementById('migration-strength-indicator').style.width = '0';
        document.getElementById('migration-strength-text').innerHTML = '';
        migrationMsg.textContent = '';        userToMigrate = null;
    }    if (confirmMigrationBtn) {
        confirmMigrationBtn.addEventListener('click', async () => {
            const newPass = migrationPassword.value;            if (!isPasswordStrictlyValid(newPass)) {
                migrationMsg.textContent = "Caro usuário, sua senha precisa ter no mínimo 8 dígitos, letras, números e caracteres especiais. Ex: @ # $ !";
                migrationMsg.classList.add('error');
                return;
            }            migrationMsg.textContent = 'Salvando e entrando...';
            migrationMsg.classList.remove('error');            const {error} = await supabase
                .from('Logins')
                .update({
                    Senha: newPass,
                    PIN: null
                })
                .eq('Usuario', userToMigrate.Usuario);            if (error) {
                console.error(error);
                migrationMsg.textContent = 'Erro ao salvar. Tente novamente.';
                migrationMsg.classList.add('error');
            } else {                userToMigrate.Senha = newPass;
                userToMigrate.PIN = null;                performLoginSuccess(userToMigrate);                closeMigrationModal();
            }
        });
    }    async function performLoginSuccess(data) {
        localStorage.setItem('userSession', JSON.stringify(data));
        await logLoginHistory(data);        const loginFormContent = document.getElementById('login-form-content');
        if (loginFormContent) loginFormContent.classList.add('fade-out-start');        const welcomeBackContainer = document.getElementById('welcome-back-container');
        if (welcomeBackContainer) {
            const welcomeMessage = document.getElementById('welcome-message');
            const welcomeAvatar = document.getElementById('welcome-avatar');
            const fullName = data.Nome || 'Usuário';
            const firstName = fullName.split(' ')[0];
            if (welcomeMessage) welcomeMessage.textContent = `Olá, ${firstName}!`;
            if (welcomeAvatar && data.avatar_url) {
                welcomeAvatar.src = data.avatar_url.toLowerCase();
            } else if (welcomeAvatar) {
                welcomeAvatar.src = '/imagens/avatar.png';
            }
            welcomeBackContainer.classList.remove('hidden');
            setTimeout(() => welcomeBackContainer.classList.add('visible'), 10);
        }
        setTimeout(() => {
            window.location.href = '/dashboard.html';
        }, 2800);
    }    const loginForm = document.getElementById('loginForm');
    const loginInput = document.getElementById('loginInput');
    const forgotPinBtn = document.getElementById('forgotPinBtn');    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            verifyLogin(loginInput.value);
        });
    }    if (forgotPinBtn) {
        forgotPinBtn.addEventListener('click', () => {
            const loginMsg = document.getElementById('loginMsg');
            loginMsg.textContent = 'Entre em contato conosco! Valdemi.silva@Kuehne-nagel.com';
            loginMsg.classList.add('info');
        });
    }    const funcoes = ['ANALISTA', 'RH', 'COORDENADOR', 'DIRETOR', 'ESTAGIÁRIO', 'GERENTE', 'JOVEM APRENDIZ', 'LÍDER', 'MELI', 'SHE', 'SUPERVISOR'];    function loadFuncoes() {
        if (!registerFuncao) return;
        registerFuncao.innerHTML = '<option value="" disabled selected>Selecione a Função</option>';
        funcoes.forEach(funcao => {
            const option = document.createElement('option');
            option.value = funcao;
            option.textContent = funcao;
            registerFuncao.appendChild(option);
        });
    }    async function loadMatrizes() {
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
    }    function getBrasiliaTimestamp() {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }    async function logLoginHistory(userData) {
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