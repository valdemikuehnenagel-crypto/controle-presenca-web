import { createClient } from '@supabase/supabase-js';

document.addEventListener('DOMContentLoaded', () => {
  const supabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_KEY
  );

  // --- Elementos principais ---
  const container       = document.getElementById('container');
  const showRegisterBtn = document.getElementById('showRegisterBtn');
  const showLoginBtn    = document.getElementById('showLoginBtn');
  const loginForm       = document.getElementById('loginForm');
  const pinLogin        = document.getElementById('pinLogin');
  const loginMsg        = document.getElementById('loginMsg');
  const forgotPinBtn    = document.getElementById('forgotPinBtn');

  // Elementos da animação de boas-vindas (opcionais)
  const loginContent       = document.getElementById('login-form-content');
  const welcomeContainer   = document.getElementById('welcome-back-container');
  const welcomeAvatar      = document.getElementById('welcome-avatar');
  const welcomeMessage     = document.getElementById('welcome-message');

  // --- Tela de cadastro ---
  const registerForm   = document.getElementById('registerForm');
  const registerName   = document.getElementById('registerName');
  const registerEmail  = document.getElementById('registerEmail');
  const registerMatriz = document.getElementById('registerMatriz');
  const registerPin    = document.getElementById('registerPin');
  const registerMsg    = document.getElementById('registerMsg');
  const registerAvatar = document.getElementById('registerAvatar');
  const avatarPreview  = document.getElementById('avatarPreview');

  // --- Navegação login/registro ---
  if (showRegisterBtn) {
    showRegisterBtn.addEventListener('click', () => {
      container?.classList.add('active');
      loadMatrizes();
    });
  }
  if (showLoginBtn) {
    showLoginBtn.addEventListener('click', () => {
      container?.classList.remove('active');
    });
  }

  // --- Controle de verificação para evitar chamadas duplicadas ---
  let isVerifying = false;
  let inputTimer  = null;

  // Utilitários
  const norm = (v) =>
    String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-');

  function greet() {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  }

  function showMessage(msg, type = null) {
    if (!loginMsg) return;
    loginMsg.textContent = msg || '';
    loginMsg.classList.remove('info', 'error');
    if (type) loginMsg.classList.add(type);
  }

  // --- Animação de boas-vindas com fallback ---
  function runWelcome(user) {
    // Se não houver DOM da animação, faz fallback imediato
    if (!welcomeContainer || !welcomeMessage || !loginContent) {
      localStorage.setItem('userSession', JSON.stringify(user));
      window.location.href = '/dashboard.html';
      return;
    }

    try {
      const firstName = (user.Nome || 'Usuário').split(' ')[0];
      if (welcomeAvatar) {
        welcomeAvatar.src = user.avatar_url || '/imagens/avatar.png';
      }
      welcomeMessage.textContent = `${greet()}, ${firstName}!`;

      // Some o formulário
      loginContent.classList.add('fade-out-start');

      // espera 500ms, mostra container
      setTimeout(() => {
        welcomeContainer.classList.remove('hidden');
        // forçar reflow antes de adicionar a classe que faz transição
        requestAnimationFrame(() => {
          welcomeContainer.classList.add('visible');
        });

        // Salva sessão e redireciona após 1.5s
        setTimeout(() => {
          localStorage.setItem('userSession', JSON.stringify(user));
          window.location.href = '/dashboard.html';
        }, 1500);
      }, 500);
    } catch (e) {
      // fallback se qualquer coisa der errado na animação
      localStorage.setItem('userSession', JSON.stringify(user));
      window.location.href = '/dashboard.html';
    }
  }

  // --- Verificação do PIN ---
  async function verifyPin(pin) {
    if (isVerifying) return;
    isVerifying = true;
    showMessage('Verificando...', 'info');

    try {
      const { data: user, error } = await supabase
        .from('Logins')
        .select('PIN, Nome, Usuario, Matriz, Nivel, Aprovacao, avatar_url')
        .eq('PIN', pin)
        .single();

      if (error || !user) {
        showMessage('PIN inválido ou erro na conexão.', 'error');
        return;
      }
      if (user.Aprovacao !== 'SIM') {
        showMessage('Acesso pendente de aprovação.', 'error');
        return;
      }

      if (!user.Matriz || user.Matriz.trim() === '') {
        user.Matriz = 'TODOS';
      }

      // roda animação (ou fallback) e redireciona
      runWelcome(user);
    } catch (e) {
      console.error('verifyPin error:', e);
      showMessage('Falha ao verificar o PIN. Tente novamente.', 'error');
    } finally {
      // dá um pequeno atraso para evitar double-submit enquanto anima
      setTimeout(() => { isVerifying = false; }, 300);
    }
  }

  // --- Eventos do Login ---
  if (loginForm) {
    loginForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const pin = pinLogin?.value?.trim() || '';
      if (/^\d{6}$/.test(pin)) {
        verifyPin(pin);
      } else {
        showMessage('O PIN deve ter 6 dígitos.', 'error');
      }
    });
  }

  if (pinLogin) {
    // debounce no input para evitar duas chamadas quando o usuário pressiona Enter
    pinLogin.addEventListener('input', () => {
      const value = pinLogin.value.trim();
      if (value.length < 6) {
        showMessage('');
        return;
      }
      if (value.length === 6) {
        clearTimeout(inputTimer);
        inputTimer = setTimeout(() => verifyPin(value), 120); // debounce curto
      }
    });
  }

  if (forgotPinBtn) {
    forgotPinBtn.addEventListener('click', () => {
      showMessage('Entre em contato conosco! Valdemi.silva@Kuehne-nagel.com', 'info');
    });
  }

  // --- Cadastro ---
  async function loadMatrizes() {
    if (!registerMatriz) return;
    registerMatriz.innerHTML = '<option value="" disabled selected>Carregando...</option>';

    const { data, error } = await supabase.from('Matrizes').select('MATRIZ');
    if (error) {
      registerMatriz.innerHTML = '<option value="" disabled selected>Erro ao carregar</option>';
      console.error('Erro ao buscar matrizes:', error);
      return;
    }

    const matrizesUnicas = Array.from(new Set((data || []).map(item => item.MATRIZ))).sort();
    registerMatriz.innerHTML = '<option value="" disabled selected>Selecione a Matriz</option>';
    matrizesUnicas.forEach(matriz => {
      const option = document.createElement('option');
      option.value = matriz;
      option.textContent = matriz;
      registerMatriz.appendChild(option);
    });

    // opção Gerencia (vira TODOS no salvar)
    const gerenciaOption = document.createElement('option');
    gerenciaOption.value = 'Gerencia';
    gerenciaOption.textContent = 'Gerencia';
    registerMatriz.appendChild(gerenciaOption);
  }

  if (registerAvatar && avatarPreview) {
    registerAvatar.addEventListener('change', () => {
      const file = registerAvatar.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => { avatarPreview.src = e.target.result; };
      reader.readAsDataURL(file);
    });
  }

  if (registerForm) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!registerMsg) return;

      registerMsg.textContent = 'Enviando...';
      registerMsg.classList.remove('error');

      const userData = {
        name: (registerName?.value || '').trim(),
        email: (registerEmail?.value || '').trim(),
        matriz: registerMatriz?.value || '',
        pin: registerPin?.value || '',
        file: registerAvatar?.files?.[0] || null
      };

      if (!userData.name || !userData.email || !userData.matriz || !/^\d{6}$/.test(userData.pin)) {
        registerMsg.classList.add('error');
        registerMsg.textContent = 'Todos os campos são obrigatórios.';
        return;
      }

      let avatarUrl = null;
      try {
        if (userData.file) {
          registerMsg.textContent = 'Enviando imagem...';
          const fileName = `${norm(userData.name)}-${Date.now()}`;
          const { error: uploadError } = await supabase
            .storage
            .from('avatars')
            .upload(fileName, userData.file);

          if (uploadError) {
            registerMsg.classList.add('error');
            registerMsg.textContent = `Erro no upload da imagem: ${uploadError.message}`;
            return;
          }

          const { data: urlData } = supabase
            .storage
            .from('avatars')
            .getPublicUrl(fileName);

          avatarUrl = urlData?.publicUrl || null;
          registerMsg.textContent = 'Registrando dados...';
        }

        let matrizParaSalvar = userData.matriz;
        if (matrizParaSalvar === 'Gerencia') matrizParaSalvar = 'TODOS';

        const { error: insertError } = await supabase
          .from('Logins')
          .insert({
            PIN: userData.pin,
            Nome: userData.name.toUpperCase(),
            Usuario: userData.email.toLowerCase(),
            Matriz: matrizParaSalvar,
            Nivel: 'Usuario',
            Aprovacao: 'PENDENTE',
            avatar_url: avatarUrl
          });

        if (insertError) {
          registerMsg.classList.add('error');
          registerMsg.textContent = 'Erro: Este PIN ou Email já pode estar em uso.';
          console.error('Erro no registro:', insertError);
          return;
        }

        registerMsg.textContent = 'Solicitação enviada! Aguarde a aprovação.';
        registerForm.reset();
        if (avatarPreview) avatarPreview.src = '/imagens/avatar.png';

        setTimeout(() => container?.classList.remove('active'), 3000);
      } catch (e) {
        console.error('Falha no cadastro:', e);
        registerMsg.classList.add('error');
        registerMsg.textContent = 'Falha no cadastro. Tente novamente.';
      }
    });
  }
});
