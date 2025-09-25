import { createClient } from '@supabase/supabase-js';

// A mágica acontece aqui: esperamos o HTML carregar completamente antes de rodar o código.
document.addEventListener('DOMContentLoaded', () => {

    // 1. Inicializa o Supabase
    const supabase = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_KEY
    );

    // --- LÓGICA PARA ALTERNAR TELAS ---
    const loginView = document.getElementById('loginView');
    const registerView = document.getElementById('registerView');
    const showRegisterBtn = document.getElementById('showRegisterBtn');
    const showLoginBtn = document.getElementById('showLoginBtn');

    if (showRegisterBtn) {
        showRegisterBtn.addEventListener('click', () => {
            loginView.classList.add('hidden');
            registerView.classList.remove('hidden');
            loadMatrizes(); // Carrega as matrizes quando o usuário vai se registrar
        });
    }

    if (showLoginBtn) {
        showLoginBtn.addEventListener('click', () => {
            registerView.classList.add('hidden');
            loginView.classList.remove('hidden');
        });
    }

    // --- LÓGICA DE LOGIN (Existente) ---
    const loginForm = document.getElementById('loginForm');
    const pinLogin = document.getElementById('pinLogin');
    const loginMsg = document.getElementById('loginMsg');

    if (loginForm) {
        loginForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const pin = pinLogin.value;
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
            alert('Login realizado com sucesso!');
            // window.location.href = '/dashboard.html';
        });
    }

    // --- LÓGICA DE REGISTRO (Nova) ---
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
            registerMsg.classList.remove('text-red-400', 'text-green-400');


            const userData = {
                email: registerEmail.value,
                matriz: registerMatriz.value,
                pin: registerPin.value,
            };

            if (!userData.email || !userData.matriz || !/^\d{6}$/.test(userData.pin)) {
                registerMsg.classList.add('text-red-400');
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
                registerMsg.classList.add('text-red-400');
                registerMsg.textContent = 'Erro: Este PIN ou Email já pode estar em uso.';
                console.error('Erro no registro:', error);
            } else {
                registerMsg.classList.add('text-green-400');
                registerMsg.textContent = 'Solicitação enviada com sucesso! Aguarde a aprovação.';
                registerForm.reset();
            }
        });
    }
});