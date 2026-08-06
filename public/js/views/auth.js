/**
 * Sign in / sign up.
 *
 * Phone number first: the field is pre-filled with "+" and a country code, so
 * the number that becomes the login identity - and the number customers tap to
 * call - is always stored in international form.
 */
import { api, ApiError } from '../api.js';
import { navigate } from '../router.js';
import { applySession } from '../store.js';
import { takeoverScreen } from '../shell.js';
import { esc, icon, toast } from '../ui.js';

const COUNTRY_KEY = 'derte_country_code';

const COUNTRIES = [
  { code: '34', name: 'Spain' },
  { code: '351', name: 'Portugal' },
  { code: '33', name: 'France' },
  { code: '39', name: 'Italy' },
  { code: '49', name: 'Germany' },
  { code: '44', name: 'United Kingdom' },
  { code: '1', name: 'USA / Canada' },
  { code: '52', name: 'Mexico' },
  { code: '54', name: 'Argentina' },
  { code: '55', name: 'Brazil' },
  { code: '212', name: 'Morocco' },
  { code: '7', name: 'Russia / Kazakhstan' },
  { code: '48', name: 'Poland' },
  { code: '380', name: 'Ukraine' },
  { code: '971', name: 'UAE' },
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
    // Not critical.
  }
};

const phoneField = (label = 'Phone number') => `
  <div class="field">
    <label class="field__label" for="phone-national">${esc(label)}</label>
    <div class="phone-input">
      <span class="phone-input__code">+</span>
      <label class="sr-only" for="country-code">Country code</label>
      <input id="country-code" inputmode="numeric" autocomplete="tel-country-code" list="country-codes"
             style="width:4.2ch;text-align:left;padding-inline:0" value="${esc(savedCountry())}" maxlength="4">
      <input id="phone-national" type="tel" inputmode="tel" autocomplete="tel-national"
             placeholder="600 123 456" required>
    </div>
    <datalist id="country-codes">
      ${COUNTRIES.map((country) => `<option value="${esc(country.code)}">+${esc(country.code)} ${esc(country.name)}</option>`).join('')}
    </datalist>
    <span class="field__hint">Used to sign in, and shown to your customers so they can call you.</span>
  </div>`;

/** Joins the country code and the national part into E.164. */
function readPhone(form) {
  const code = form.querySelector('#country-code').value.replace(/\D/g, '');
  const national = form.querySelector('#phone-national').value.replace(/\D/g, '');
  if (code) rememberCountry(code);
  if (!code || !national) return null;
  return `+${code}${national.replace(/^0+/, '')}`;
}

const brand = (tagline) => `
  <div class="auth__brand">
    <img class="auth__logo" src="/icons/icon-192.png" alt="" width="42" height="42">
    <div>
      <div class="auth__name">DerteApp</div>
      <div class="auth__tagline">${esc(tagline)}</div>
    </div>
  </div>`;

const submitButton = (label) => `<button class="btn btn--block" type="submit">${esc(label)}</button>`;

function errorText(error) {
  if (error instanceof ApiError) {
    const detail = error.details?.[0]?.message;
    return detail ?? error.message;
  }
  return 'Something went wrong. Please check your connection and try again.';
}

/** Wires a form: disables the button, surfaces errors, applies the session. */
function handle(form, submit) {
  const button = form.querySelector('button[type="submit"]');
  const errorBox = form.querySelector('[data-error]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'One moment…';
    try {
      await submit();
    } catch (error) {
      errorBox.textContent = errorText(error);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

// --- sign in ---------------------------------------------------------------

export function loginView() {
  const root = takeoverScreen(
    `<form class="auth" novalidate>
      ${brand('The workshop in your pocket')}
      <div class="stack">
        ${phoneField()}
        <div class="field">
          <label class="field__label" for="password">Password</label>
          <input class="input" id="password" type="password" autocomplete="current-password" required>
        </div>
        <div class="field__error" data-error role="alert"></div>
        ${submitButton('Sign in')}
        <button class="btn btn--soft btn--block" type="button" data-otp>
          ${icon('phone', { size: 17 })} Sign in with a code instead
        </button>
      </div>
      <div class="auth__switch">
        New here? <button class="auth__link" type="button" data-register>Create a shop account</button>
      </div>
      <div class="auth__switch">
        <button class="auth__link" type="button" data-forgot>Forgot your password?</button>
      </div>
    </form>`,
  );

  const form = root.querySelector('form');
  handle(form, async () => {
    const phone = readPhone(form);
    if (!phone) throw new ApiError(400, { error: { message: 'Enter your country code and phone number' } });
    const session = await api.login({ phone, password: form.querySelector('#password').value });
    applySession(session);
    navigate('/', { replace: true });
  });

  form.querySelector('[data-register]').addEventListener('click', () => navigate('/register'));
  form.querySelector('[data-otp]').addEventListener('click', () => navigate('/code'));
  form.querySelector('[data-forgot]').addEventListener('click', () => navigate('/reset'));
}

// --- sign up ---------------------------------------------------------------

export function registerView() {
  const root = takeoverScreen(
    `<form class="auth" novalidate>
      ${brand('Set up your shop in a minute')}
      <div class="stack">
        <div class="field">
          <label class="field__label" for="shop_name">Shop name</label>
          <input class="input" id="shop_name" autocomplete="organization" placeholder="Derte Auto Centre" required>
        </div>
        <div class="field">
          <label class="field__label" for="full_name">Your name</label>
          <input class="input" id="full_name" autocomplete="name" placeholder="Marco Ruiz" required>
        </div>
        ${phoneField()}
        <div class="field">
          <label class="field__label" for="password">Password</label>
          <input class="input" id="password" type="password" autocomplete="new-password" required>
          <span class="field__hint">At least 8 characters, with a letter and a number.</span>
        </div>
        <div class="field__error" data-error role="alert"></div>
        ${submitButton('Create account')}
      </div>
      <div class="auth__switch">
        Already have an account? <button class="auth__link" type="button" data-login>Sign in</button>
      </div>
    </form>`,
  );

  const form = root.querySelector('form');
  handle(form, async () => {
    const phone = readPhone(form);
    if (!phone) throw new ApiError(400, { error: { message: 'Enter your country code and phone number' } });
    const session = await api.register({
      phone,
      password: form.querySelector('#password').value,
      full_name: form.querySelector('#full_name').value,
      shop_name: form.querySelector('#shop_name').value,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    applySession(session);
    toast('Welcome to DerteApp', 'ok');
    navigate('/', { replace: true });
  });

  form.querySelector('[data-login]').addEventListener('click', () => navigate('/login'));
}

// --- one-time passcode -----------------------------------------------------

export function otpView() {
  const root = takeoverScreen(
    `<form class="auth" novalidate>
      ${brand('Sign in with a code')}
      <div class="stack" data-step="phone">
        ${phoneField()}
        <div class="field__error" data-error role="alert"></div>
        ${submitButton('Send me a code')}
      </div>
      <div class="auth__switch">
        <button class="auth__link" type="button" data-login>Use a password instead</button>
      </div>
    </form>`,
  );

  const form = root.querySelector('form');
  let phone = null;

  handle(form, async () => {
    if (!phone) {
      phone = readPhone(form);
      if (!phone) throw new ApiError(400, { error: { message: 'Enter your country code and phone number' } });
      const response = await api.requestOtp({ phone, purpose: 'login' });

      form.querySelector('[data-step="phone"]').innerHTML = `
        <p style="color:var(--muted);font-size:13.5px">
          We sent a code to <strong>${esc(phone)}</strong>.
        </p>
        <div class="field">
          <label class="field__label" for="code">6-digit code</label>
          <input class="input" id="code" inputmode="numeric" autocomplete="one-time-code"
                 maxlength="8" style="font-size:22px;letter-spacing:.35em;text-align:center" required>
          ${response.debug_code ? `<span class="field__hint">Development mode: your code is ${esc(response.debug_code)}</span>` : ''}
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Sign in</button>`;
      form.querySelector('#code').focus();
      return;
    }

    const session = await api.loginWithOtp({ phone, code: form.querySelector('#code').value });
    applySession(session);
    navigate('/', { replace: true });
  });

  form.querySelector('[data-login]').addEventListener('click', () => navigate('/login'));
}

// --- password reset --------------------------------------------------------

export function resetView() {
  const root = takeoverScreen(
    `<form class="auth" novalidate>
      ${brand('Reset your password')}
      <div class="stack" data-step>
        ${phoneField()}
        <div class="field__error" data-error role="alert"></div>
        ${submitButton('Send me a code')}
      </div>
      <div class="auth__switch">
        <button class="auth__link" type="button" data-login>Back to sign in</button>
      </div>
    </form>`,
  );

  const form = root.querySelector('form');
  let phone = null;

  handle(form, async () => {
    if (!phone) {
      phone = readPhone(form);
      if (!phone) throw new ApiError(400, { error: { message: 'Enter your country code and phone number' } });
      const response = await api.requestOtp({ phone, purpose: 'reset' });

      form.querySelector('[data-step]').innerHTML = `
        <p style="color:var(--muted);font-size:13.5px">
          Enter the code we sent to <strong>${esc(phone)}</strong> and choose a new password.
        </p>
        <div class="field">
          <label class="field__label" for="code">Code</label>
          <input class="input" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" required>
          ${response.debug_code ? `<span class="field__hint">Development mode: your code is ${esc(response.debug_code)}</span>` : ''}
        </div>
        <div class="field">
          <label class="field__label" for="new_password">New password</label>
          <input class="input" id="new_password" type="password" autocomplete="new-password" required>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Save and sign in</button>`;
      return;
    }

    const session = await api.resetPassword({
      phone,
      code: form.querySelector('#code').value,
      new_password: form.querySelector('#new_password').value,
    });
    applySession(session);
    toast('Password updated', 'ok');
    navigate('/', { replace: true });
  });

  form.querySelector('[data-login]').addEventListener('click', () => navigate('/login'));
}
