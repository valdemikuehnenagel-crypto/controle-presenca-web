import {createClient} from '@supabase/supabase-js';

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

        loginMsg.classList.remove('info');
        loginMsg.textContent = 'Verificando...';

        const {data, error} = await supabase
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

    // --- Lógica do Formulário de Registro (MODIFICADO) ---
    const registerForm = document.getElementById('registerForm');
    // NOVO: Adiciona os novos campos do formulário
    const registerName = document.getElementById('registerName');
    const registerEmail = document.getElementById('registerEmail');
    const registerMatriz = document.getElementById('registerMatriz');
    const registerFuncao = document.getElementById('registerFuncao'); // NOVO
    const registerPin = document.getElementById('registerPin');
    const registerMsg = document.getElementById('registerMsg');


    const funcoes = [
        'JOVEM APRENDIZ',
        'ESTAGIÁRIO',
        'LÍDER',
        'SHE',
        'COORDENADOR',
        'ANALISTA',
        'SUPERVISOR',
        'GERENTE',
        'DIRETOR'
    ];

    function loadFuncoes() {
        registerFuncao.innerHTML = '<option value="" disabled selected>Selecione a Função</option>';
        funcoes.forEach(funcao => {
            const option = document.createElement('option');
            option.value = funcao;
            option.textContent = funcao;
            registerFuncao.appendChild(option);
        });
    }

    async function loadMatrizes() {
        registerMatriz.innerHTML = '<option value="" disabled selected>Carregando...</option>';

        const {data, error} = await supabase
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

            // MODIFICADO: Captura os valores dos novos campos
            const userData = {
                nome: registerName.value,
                email: registerEmail.value,
                matriz: registerMatriz.value,
                funcao: registerFuncao.value, // NOVO
                pin: registerPin.value,
            };

            // MODIFICADO: Atualiza a validação para incluir os novos campos
            if (!userData.nome || !userData.email || !userData.matriz || !userData.funcao || !/^\d{6}$/.test(userData.pin)) {
                registerMsg.classList.add('error');
                registerMsg.textContent = 'Todos os campos são obrigatórios.';
                return;
            }

            // MODIFICADO: O objeto de inserção agora inclui Nome e Tipo
            const {error} = await supabase
                .from('Logins')
                .insert({
                    PIN: userData.pin,
                    Nome: userData.nome, // NOVO: Mapeia para a coluna "Nome"
                    Usuario: userData.email.toLowerCase(),
                    Matriz: userData.matriz,
                    Tipo: userData.funcao, // NOVO: Mapeia para a coluna "Tipo"
                    Nivel: 'Usuario', // Mantém um nível padrão, se necessário
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