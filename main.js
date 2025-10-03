import {createClient} from '@supabase/supabase-js';

document.addEventListener('DOMContentLoaded', () => {

    const supabase = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_KEY
    );


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


    if (pinLogin) {
        pinLogin.addEventListener('input', () => {

            if (pinLogin.value.length < 6) {
                loginMsg.textContent = '';
                loginMsg.classList.remove('info');
            }


            if (pinLogin.value.length === 6) {
                verifyPin(pinLogin.value);
            }
        });
    }



    if (forgotPinBtn) {
        forgotPinBtn.addEventListener('click', () => {
            loginMsg.textContent = 'Entre em contato conosco! Valdemi.silva@Kuehne-nagel.com';
            loginMsg.classList.add('info');
            loginMsg.classList.remove('error');
        });
    }


    const registerForm = document.getElementById('registerForm');

    const registerName = document.getElementById('registerName');
    const registerEmail = document.getElementById('registerEmail');
    const registerMatriz = document.getElementById('registerMatriz');
    const registerFuncao = document.getElementById('registerFuncao');
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


            const userData = {
                nome: registerName.value,
                email: registerEmail.value,
                matriz: registerMatriz.value,
                funcao: registerFuncao.value,
                pin: registerPin.value,
            };


            if (!userData.nome || !userData.email || !userData.matriz || !userData.funcao || !/^\d{6}$/.test(userData.pin)) {
                registerMsg.classList.add('error');
                registerMsg.textContent = 'Todos os campos são obrigatórios.';
                return;
            }


            const {error} = await supabase
                .from('Logins')
                .insert({
                    PIN: userData.pin,
                    Nome: userData.nome,
                    Usuario: userData.email.toLowerCase(),
                    Matriz: userData.matriz,
                    Tipo: userData.funcao,
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