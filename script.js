const container = document.getElementById('container');
const registerBtn = document.getElementById('register');
const loginBtn = document.getElementById('login');

registerBtn.addEventListener('click', () => container.classList.add('active'));
loginBtn.addEventListener('click', () => container.classList.remove('active'));

const onlyDigits = (el) => el.addEventListener('input', () => { el.value = el.value.replace(/\D/g,'').slice(0,6); });

const pinLogin = document.getElementById('pinLogin');
const registerPin = document.getElementById('registerPin');
onlyDigits(pinLogin);
onlyDigits(registerPin);

const loginForm = document.getElementById('loginForm');
const loginMsg = document.getElementById('loginMsg');
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loginMsg.textContent = '';
  const pin = (pinLogin.value || '').trim();
  if (pin.length !== 6) { loginMsg.textContent = 'PIN deve ter 6 dígitos.'; return; }
  document.dispatchEvent(new CustomEvent('login-submit', { detail: { pin } }));
});

const registerForm = document.getElementById('registerForm');
const registerEmail = document.getElementById('registerEmail');
const registerMatriz = document.getElementById('registerMatriz');
const registerMsg = document.getElementById('registerMsg');
registerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  registerMsg.textContent = '';
  const email = (registerEmail.value || '').trim();
  const matriz = registerMatriz.value || '';
  const pin = (registerPin.value || '').trim();
  if (!email) { registerMsg.textContent = 'Informe um email válido.'; return; }
  if (!matriz) { registerMsg.textContent = 'Selecione a Matriz.'; return; }
  if (pin.length !== 6) { registerMsg.textContent = 'PIN deve ter 6 dígitos.'; return; }
  document.dispatchEvent(new CustomEvent('register-submit', { detail: { email, matriz, pin } }));
});

const forgotPinLink = document.getElementById('forgotPinLink');
forgotPinLink.addEventListener('click', (e) => {
  // mantém mailto, mas evita navegação se precisar tratar internamente
  // e.preventDefault();
  document.dispatchEvent(new CustomEvent('forgot-pin'));
});

export function setRegisterStatus(message, ok = true) {
  registerMsg.style.color = ok ? '#16a34a' : '#e11d48';
  registerMsg.textContent = message || '';
}
export function setLoginStatus(message, ok = false) {
  loginMsg.style.color = ok ? '#16a34a' : '#e11d48';
  loginMsg.textContent = message || '';
}
export function fillMatrizes(options) {
  registerMatriz.innerHTML = '<option value="" disabled selected>Selecione a Matriz</option>';
  (options || []).forEach(opt => {
    const o = document.createElement('option');
    o.value = String(opt.value ?? opt);
    o.textContent = String(opt.label ?? opt);
    registerMatriz.appendChild(o);
  });
}
