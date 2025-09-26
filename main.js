import { createClient } from '@supabase/supabase-js';

document.addEventListener('DOMContentLoaded', () => {

    const supabase = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_KEY
    );

    // --- Elementos da Interface ---
    const container = document.getElementById('container');
    const showRegisterBtn = document.getElementById('showRegisterBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');
    const loginForm = document.getElementById('loginForm');
    const pinLogin = document.getElementById('pinLogin');
    const loginMsg = document.getElementById('loginMsg');
    const forgotPinBtn = document.getElementById('forgotPinBtn');

    // --- Lógica de Navegação entre Telas ---
    if (showRegisterBtn) {
        showRegisterBtn.addEventListener('click', () => {
            container.classList.add('active');
            loadMatrizes();
        });
    }

    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', () => {
            container.classList.remove('active');
        });
    }

    // --- LÓGICA DE LOGIN (REESTRUTURADA) ---

    // 1. Função reutilizável para verificar o PIN
    async function verifyPin(pin) {
        // Limpa mensagens anteriores
        loginMsg.classList.remove('info');
        loginMsg.textContent = 'Verificando...';

        const { data, error } = await supabase
            .from('Logins')
            .select('*')
            .eq('PIN', pin)
            .single();

        if (error || !data) {
            loginMsg.textContent = 'PIN inválido ou erro na conexão.';
            return;
        }
        if (data.Aprovacao !== 'SIM') {
            loginMsg.textContent = 'Acesso pendente de aprovação.';
            return;
        }

        localStorage.setItem('userSession', JSON.stringify(data));
        window.location.href = '/dashboard.html';
    }

    // 2. Evento de clique no botão "Entrar" (continua funcionando)
    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (pinLogin.value.length === 6) {
                verifyPin(pinLogin.value);
            } else {
                loginMsg.textContent = 'O PIN deve ter 6 dígitos.';
            }
        });
    }

    // 3. NOVO: Evento de input para login automático
    if (pinLogin) {
        pinLogin.addEventListener('input', () => {
            // Limpa mensagens de erro/info se o usuário estiver corrigindo o PIN
            if (pinLogin.value.length < 6) {
                loginMsg.textContent = '';
                loginMsg.classList.remove('info');
            }

            // Se o PIN atingir 6 dígitos, dispara a verificação
            if (pinLogin.value.length === 6) {
                verifyPin(pinLogin.value);
            }
        });
    }


    // --- Lógica do Botão "Esqueci meu pin" ---
    if (forgotPinBtn) {
        forgotPinBtn.addEventListener('click', () => {
            loginMsg.textContent = 'Entre em contato conosco! Valdemi.silva@Kuehne-nagel.com';
            loginMsg.classList.add('info');
            loginMsg.classList.remove('error');
        });
    }

    // --- Lógica do Formulário de Registro (sem alterações) ---
    const registerForm = document.getElementById('registerForm');
    const registerEmail = document.getElementById('registerEmail');
    const registerMatriz = document.getElementById('registerMatriz');
    const registerPin = document.getElementById('registerPin');
    const registerMsg = document.getElementById('registerMsg');

    async function loadMatrizes() {
        registerMatriz.innerHTML = '<option value="" disabled selected>Carregando...</option>';

        const { data, error } = await supabase
            .from('Matrizes')
            .select('MATRIZ');

        if (error) {
            registerMatriz.innerHTML = '<option value="" disabled selected>Erro ao carregar</option>';
            console.error('Erro ao buscar matrizes:', error);
            return;
        }

        const matrizesUnicas = Array.from(new Set(data.map(item => item.MATRIZ))).sort();
        registerMatriz.innerHTML = '<option value="" disabled selected>Selecione a Matriz</option>';

        matrizesUnicas.forEach(matriz => {
            const option = document.createElement('option');
            option.value = matriz;
            option.textContent = matriz;
            registerMatriz.appendChild(option);
        });
    }

    if (registerForm) {
        registerForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            registerMsg.textContent = 'Enviando...';
            registerMsg.classList.remove('error');

            const userData = {
                email: registerEmail.value,
                matriz: registerMatriz.value,
                pin: registerPin.value,
            };

            if (!userData.email || !userData.matriz || !/^\d{6}$/.test(userData.pin)) {
                registerMsg.classList.add('error');
                registerMsg.textContent = 'Todos os campos são obrigatórios.';
                return;
            }

            const { error } = await supabase
                .from('Logins')
                .insert({
                    PIN: userData.pin,
                    Usuario: userData.email.toLowerCase(),
                    Matriz: userData.matriz,
                    Nivel: 'Usuario',
                    Aprovacao: 'PENDENTE'
                });

            if (error) {
                registerMsg.classList.add('error');
                registerMsg.textContent = 'Erro: Este PIN ou Email já pode estar em uso.';
                console.error('Erro no registro:', error);
            } else {
                registerMsg.textContent = 'Solicitação enviada! Aguarde a aprovação.';
                registerForm.reset();

                setTimeout(() => {
                    container.classList.remove('active');
                }, 3000);
            }
        });
    }
});