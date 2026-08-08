/**
 * Acceso: correo + contraseña (cuenta Google) o Continuar con Google.
 * El teléfono del taller se pide solo al registrarse (para que te llamen).
 */
import { api, ApiError } from '../api.js';
import { navigate } from '../router.js';
import { applySession } from '../store.js';
import { takeoverScreen } from '../shell.js';
import { esc, toast } from '../ui.js';

const COUNTRY_KEY = 'derte_country_code';

const COUNTRIES = [
  { code: '34', name: 'España' },
  { code: '351', name: 'Portugal' },
  { code: '33', name: 'Francia' },
  { code: '39', name: 'Italia' },
  { code: '49', name: 'Alemania' },
  { code: '44', name: 'Reino Unido' },
  { code: '1', name: 'EE. UU. / Canadá' },
  { code: '52', name: 'México' },
  { code: '54', name: 'Argentina' },
  { code: '55', name: 'Brasil' },
  { code: '212', name: 'Marruecos' },
];

const savedCountry = () => {
  try {
    return localStorage.getItem(COUNTRY_KEY) ?? '34';
  } catch {
    return '34';
  }
};

const rememberCountry = (code) => {
  try {
    localStorage.setItem(COUNTRY_KEY, code);
  } catch {
    // No crítico.
  }
};

const phoneField = (label = 'Teléfono del taller') => `
  <div class="field">
    <label class="field__label" for="phone-national">${esc(label)}</label>
    <div class="phone-input">
      <span class="phone-input__code">+</span>
      <label class="sr-only" for="country-code">Prefijo</label>
      <input id="country-code" name="tel-country-code" inputmode="numeric"
             autocomplete="tel-country-code" list="country-codes"
             style="width:4.2ch;text-align:left;padding-inline:0" value="${esc(savedCountry())}" maxlength="4">
      <input id="phone-national" name="tel-national" type="tel" inputmode="tel"
             autocomplete="tel-national" placeholder="600 123 456" required>
    </div>
    <datalist id="country-codes">
      ${COUNTRIES.map((country) => `<option value="${esc(country.code)}">+${esc(country.code)} ${esc(country.name)}</option>`).join('')}
    </datalist>
    <span class="field__hint">Lo verán tus clientes para llamarte. No se usa para entrar.</span>
  </div>`;

function readPhone(form) {
  const code = form.querySelector('#country-code')?.value.replace(/\D/g, '');
  const national = form.querySelector('#phone-national')?.value.replace(/\D/g, '');
  if (code) rememberCountry(code);
  if (!code || !national) return null;
  return `+${code}${national.replace(/^0+/, '')}`;
}

const brand = (tagline) => `
  <div class="auth__brand">
    <img class="auth__logo" src="/icons/logo.svg" alt="derteapp" height="42">
    <div>
      <div class="auth__tagline">${esc(tagline)}</div>
    </div>
  </div>`;

const submitButton = (label) => `<button class="btn btn--block" type="submit">${esc(label)}</button>`;

function errorText(error) {
  if (error instanceof ApiError) {
    const detail = error.details?.[0]?.message;
    return detail ?? error.message;
  }
  return 'Algo ha fallado. Comprueba la conexión e inténtalo de nuevo.';
}

function handle(form, submit) {
  const button = form.querySelector('button[type="submit"]');
  const errorBox = form.querySelector('[data-error]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Un momento…';
    try {
      await submit();
    } catch (error) {
      // Keep the form mounted and show a clear reason — never reload.
      errorBox.textContent = errorText(error);
      errorBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

function goAfterLogin(user) {
  const target = user?.role === 'super_admin' ? '/admin' : '/';
  navigate(target, { replace: true });
}

let googleScriptPromise = null;
function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Sign-In'));
    document.head.append(script);
  });
  return googleScriptPromise;
}

/**
 * Mounts the Google button. `onCredential` receives the ID token string.
 * Returns false when Google is not configured.
 */
async function mountGoogleButton(container, { onCredential, text = 'continue_with' } = {}) {
  let config;
  try {
    config = await api.googleConfig();
  } catch {
    return false;
  }
  if (!config.configured || !config.client_id) {
    container.hidden = true;
    return false;
  }

  try {
    await loadGoogleScript();
  } catch {
    container.innerHTML = `<p class="field__hint">No se pudo cargar Google Sign-In.</p>`;
    return false;
  }

  container.hidden = false;
  container.innerHTML = `<div data-google-btn></div>`;
  window.google.accounts.id.initialize({
    client_id: config.client_id,
    callback: (response) => {
      if (response.credential) onCredential(response.credential);
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  });
  window.google.accounts.id.renderButton(container.querySelector('[data-google-btn]'), {
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text,
    width: Math.min(container.clientWidth || 320, 400),
    locale: 'es',
  });
  return true;
}

// --- entrar ----------------------------------------------------------------

export function loginView() {
  const root = takeoverScreen(
    `<form class="auth" method="post" action="/login" autocomplete="on" novalidate>
      ${brand('El taller en el bolsillo')}
      <div class="stack">
        <div data-google></div>
        <div class="auth__divider" data-google-divider hidden><span>o con correo</span></div>
        <div class="field">
          <label class="field__label" for="login-email">Correo electrónico</label>
          <input class="input" id="login-email" name="username" type="email"
                 autocomplete="username" inputmode="email" autocapitalize="none"
                 spellcheck="false" placeholder="tunombre@gmail.com" required>
          <span class="field__hint">Usa tu cuenta de Google (Gmail) o el correo del Super Admin.</span>
        </div>
        <div class="field">
          <label class="field__label" for="password">Contraseña</label>
          <input class="input" id="password" name="password" type="password"
                 autocomplete="current-password" required>
        </div>
        <div class="field__error" data-error role="alert"></div>
        ${submitButton('Entrar')}
      </div>
      <div class="auth__switch">
        ¿Nuevo aquí? <button class="auth__link" type="button" data-register>Crear cuenta de taller</button>
      </div>
    </form>`,
  );

  const form = root.querySelector('form');
  const googleBox = form.querySelector('[data-google]');
  const divider = form.querySelector('[data-google-divider]');

  mountGoogleButton(googleBox, {
    text: 'signin_with',
    onCredential: async (credential) => {
      const errorBox = form.querySelector('[data-error]');
      errorBox.textContent = '';
      try {
        const session = await api.googleAuth({ credential });
        if (session.needs_registration) {
          sessionStorage.setItem(
            'derte_google_pending',
            JSON.stringify({ credential, profile: session.profile }),
          );
          navigate('/register');
          return;
        }
        applySession(session);
        goAfterLogin(session.user);
      } catch (error) {
        errorBox.textContent = errorText(error);
      }
    },
  }).then((ok) => {
    if (ok) divider.hidden = false;
  });

  handle(form, async () => {
    const email = form.querySelector('#login-email').value.trim();
    const password = form.querySelector('#password').value;
    if (!email.includes('@')) throw new ApiError(400, { error: { message: 'Introduce un correo válido' } });
    const session = await api.login({ email, password });
    applySession(session);
    goAfterLogin(session.user);
  });

  form.querySelector('[data-register]').addEventListener('click', () => navigate('/register'));
}

// --- registro --------------------------------------------------------------

export function registerView() {
  let pendingGoogle = null;
  try {
    pendingGoogle = JSON.parse(sessionStorage.getItem('derte_google_pending') || 'null');
  } catch {
    pendingGoogle = null;
  }

  const prefillEmail = pendingGoogle?.profile?.email ?? '';
  const prefillName = pendingGoogle?.profile?.name ?? '';

  const root = takeoverScreen(
    `<form class="auth" method="post" action="/register" autocomplete="on" novalidate>
      ${brand('Crea tu taller en un minuto')}
      <div class="stack">
        <div data-google></div>
        <div class="auth__divider" data-google-divider hidden><span>o con correo y contraseña de Google</span></div>
        <div class="field">
          <label class="field__label" for="shop_name">Nombre del taller</label>
          <input class="input" id="shop_name" name="organization" autocomplete="organization"
                 placeholder="Taller Derte Madrid" required>
        </div>
        <div class="field">
          <label class="field__label" for="full_name">Tu nombre</label>
          <input class="input" id="full_name" name="name" autocomplete="name"
                 placeholder="Marco Ruiz" value="${esc(prefillName)}" required>
        </div>
        <div class="field">
          <label class="field__label" for="email">Correo de Google</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email"
                 inputmode="email" autocapitalize="none" spellcheck="false"
                 placeholder="tunombre@gmail.com" value="${esc(prefillEmail)}" ${pendingGoogle ? 'readonly' : ''} required>
          <span class="field__hint">Registro solo con correo y contraseña de tu cuenta Google.</span>
        </div>
        <div class="field" data-password-block ${pendingGoogle ? 'hidden' : ''}>
          <label class="field__label" for="password">Contraseña</label>
          <input class="input" id="password" name="password" type="password"
                 autocomplete="new-password" ${pendingGoogle ? '' : 'required'}>
          <span class="field__hint">Mínimo 8 caracteres, con letra y número (la de tu cuenta Google o una nueva para DerteApp).</span>
        </div>
        ${phoneField()}
        <div class="field__error" data-error role="alert"></div>
        ${submitButton(pendingGoogle ? 'Terminar con Google' : 'Crear cuenta')}
      </div>
      <div class="auth__switch">
        ¿Ya tienes cuenta? <button class="auth__link" type="button" data-login>Entrar</button>
      </div>
    </form>`,
  );

  const form = root.querySelector('form');
  const googleBox = form.querySelector('[data-google]');
  const divider = form.querySelector('[data-google-divider]');

  const finishGoogle = async (credential) => {
    const phone = readPhone(form);
    if (!phone) throw new ApiError(400, { error: { message: 'Indica el prefijo y el teléfono del taller' } });
    const session = await api.googleAuth({
      credential,
      shop_name: form.querySelector('#shop_name').value.trim(),
      full_name: form.querySelector('#full_name').value.trim(),
      phone,
      password: form.querySelector('#password').value || undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (session.needs_registration) {
      throw new ApiError(400, { error: { message: 'Completa el nombre del taller y el teléfono' } });
    }
    sessionStorage.removeItem('derte_google_pending');
    applySession(session);
    toast('Bienvenido a DerteApp', 'ok');
    goAfterLogin(session.user);
  };

  mountGoogleButton(googleBox, {
    text: 'signup_with',
    onCredential: async (credential) => {
      const errorBox = form.querySelector('[data-error]');
      errorBox.textContent = '';
      try {
        sessionStorage.setItem('derte_google_pending', JSON.stringify({ credential }));
        pendingGoogle = { credential };
        form.querySelector('[data-password-block]').hidden = true;
        form.querySelector('#password').required = false;
        const probe = await api.googleAuth({ credential });
        if (!probe.needs_registration) {
          applySession(probe);
          toast('Bienvenido a DerteApp', 'ok');
          goAfterLogin(probe.user);
          return;
        }
        form.querySelector('#email').value = probe.profile.email;
        form.querySelector('#email').readOnly = true;
        if (probe.profile.name) form.querySelector('#full_name').value = probe.profile.name;
        form.querySelector('button[type="submit"]').textContent = 'Terminar con Google';
        toast('Completa el taller y el teléfono para acabar', 'ok');
      } catch (error) {
        errorBox.textContent = errorText(error);
      }
    },
  }).then((ok) => {
    if (ok) divider.hidden = false;
  });

  handle(form, async () => {
    if (pendingGoogle?.credential) {
      await finishGoogle(pendingGoogle.credential);
      return;
    }

    const phone = readPhone(form);
    if (!phone) throw new ApiError(400, { error: { message: 'Indica el prefijo y el teléfono del taller' } });
    const session = await api.register({
      email: form.querySelector('#email').value.trim(),
      password: form.querySelector('#password').value,
      phone,
      full_name: form.querySelector('#full_name').value.trim(),
      shop_name: form.querySelector('#shop_name').value.trim(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    applySession(session);
    toast('Bienvenido a DerteApp', 'ok');
    goAfterLogin(session.user);
  });

  form.querySelector('[data-login]').addEventListener('click', () => {
    sessionStorage.removeItem('derte_google_pending');
    navigate('/login');
  });
}

// Rutas legacy: redirigen al acceso por correo.
export function otpView() {
  navigate('/login', { replace: true });
}

export function resetView() {
  navigate('/login', { replace: true });
}
