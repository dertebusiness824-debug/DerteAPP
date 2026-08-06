/** Profile, shop details, website integration, team and telephony. */
import { api, setToken } from '../api.js';
import { navigate } from '../router.js';
import { loadSession, signOut, store } from '../store.js';
import { openShopSwitcher, requireShop, screen, setContent } from '../shell.js';
import {
  confirmSheet,
  contactButtons,
  copy,
  emptyState,
  esc,
  icon,
  sheet,
  skeletonList,
  toast,
} from '../ui.js';

/**
 * "Add to Home Screen" affordance. Chromium exposes a real install prompt;
 * iOS Safari has no API, so we spell out the Share-sheet route instead.
 */
function installBlock() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (standalone) {
    return `<p class="list__meta" style="text-align:center">Ejecutándose como app instalada</p>`;
  }
  if (window.derteInstallPrompt) {
    return `
      <div class="install">
        ${icon('home', { size: 20 })}
        <div class="grow install__text">Instala DerteApp para pantalla completa y arranques más rápidos.</div>
        <button class="btn btn--small" data-install>Instalar</button>
      </div>`;
  }
  return `
    <div class="install">
      ${icon('home', { size: 20 })}
      <div class="grow install__text">
        Añade DerteApp a tu pantalla de inicio: toca <strong>Compartir</strong> y luego <strong>Añadir a pantalla de inicio</strong>.
      </div>
    </div>`;
}

export function settingsView() {
  const shop = store.activeShop;

  screen({
    title: 'Ajustes',
    subtitle: store.user.full_name,
    nav: 'more',
    content: `
      <div class="stack">
        <div class="card">
          <div class="row">
            <span class="avatar" style="width:46px;height:46px;font-size:16px">${esc(
              store.user.full_name
                .split(' ')
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() ?? '')
                .join(''),
            )}</span>
            <div class="grow">
              <div style="font-weight:640">${esc(store.user.full_name)}</div>
              <div class="list__meta">${esc(store.isSuperAdmin ? 'Super Admin' : 'Propietario del taller')}</div>
            </div>
          </div>
          <div style="height:12px"></div>
          <div class="card card--flat">
            <div class="card__label">Tu número registrado</div>
            <div style="font-weight:650;font-size:17px;font-variant-numeric:tabular-nums;margin-top:2px">
              ${esc(store.user.phone)}
            </div>
            <div class="list__meta" style="margin-top:4px">
              Los clientes y el equipo de DerteApp ven este número arriba en cada chat.
            </div>
          </div>
        </div>

        <div class="section-title"><span>Cuenta</span></div>
        <div class="list">
          <a class="list__item" href="/settings/profile">
            ${icon('user')}<div class="grow"><div class="list__title">Tus datos</div>
            <div class="list__meta">Nombre, email, número de WhatsApp</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
          <button class="list__item" data-password>
            ${icon('settings')}<div class="grow"><div class="list__title">Cambiar contraseña</div>
            <div class="list__meta">Cierra sesión en otros dispositivos</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </button>
        </div>

        ${
          shop
            ? `<div class="section-title"><span>${esc(shop.name)}</span>
                 ${store.shops.length > 1 || store.isSuperAdmin ? '<button class="auth__link" data-switch>Cambiar</button>' : ''}
               </div>
               <div class="list">
                 <a class="list__item" href="/settings/shop">
                   ${icon('building')}<div class="grow"><div class="list__title">Datos del taller</div>
                   <div class="list__meta">Nombre, Google Calendar, teléfono, servicios</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/website">
                   ${icon('code')}<div class="grow"><div class="list__title">Formulario de reservas web</div>
                   <div class="list__meta">Snippet de Hostinger y clave del sitio</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/telephony">
                   ${icon('phone')}<div class="grow"><div class="list__title">Llamadas y WhatsApp</div>
                   <div class="list__meta">Centralita Zadarma e historial de llamadas</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/team">
                   ${icon('team')}<div class="grow"><div class="list__title">Equipo</div>
                   <div class="list__meta">Personas que pueden usar este taller</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/schedule">
                   ${icon('clock')}<div class="grow"><div class="list__title">Horario de apertura</div>
                   <div class="list__meta">Horario, descansos y días libres</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
               </div>`
            : ''
        }

        <div class="section-title"><span>Soporte</span></div>
        <div class="list">
          <a class="list__item" href="/chat/support">
            ${icon('megaphone')}<div class="grow"><div class="list__title">Escribir a DerteApp</div>
            <div class="list__meta">Línea directa con el equipo de la plataforma</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
        </div>

        ${installBlock()}

        <button class="btn btn--danger btn--block" data-signout>${icon('logout', { size: 17 })} Cerrar sesión</button>
        <p class="list__meta" style="text-align:center">DerteApp</p>
      </div>`,
  });

  const main = document.querySelector('.main');
  main.querySelector('[data-install]')?.addEventListener('click', async (event) => {
    const prompt = window.derteInstallPrompt;
    if (!prompt) return;
    event.currentTarget.disabled = true;
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') window.derteInstallPrompt = null;
      else event.currentTarget.disabled = false;
    } catch {
      event.currentTarget.disabled = false;
    }
  });
  main.querySelector('[data-switch]')?.addEventListener('click', openShopSwitcher);
  main.querySelector('[data-password]').addEventListener('click', openPasswordSheet);
  main.querySelector('[data-signout]').addEventListener('click', async () => {
    const confirmed = await confirmSheet({
      title: '¿Cerrar sesión?',
      message: 'Necesitarás tu teléfono y contraseña para volver a entrar.',
      confirmLabel: 'Cerrar sesión',
      danger: true,
    });
    if (!confirmed) return;
    await signOut();
    navigate('/login', { replace: true });
  });
  return undefined;
}

function openPasswordSheet() {
  sheet({
    title: 'Cambiar contraseña',
    body: `
      <form class="stack" novalidate>
        <div class="field">
          <label class="field__label" for="pw-current">Contraseña actual</label>
          <input class="input" id="pw-current" type="password" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label class="field__label" for="pw-new">Nueva contraseña</label>
          <input class="input" id="pw-new" type="password" autocomplete="new-password" required>
          <span class="field__hint">Al menos 8 caracteres, con una letra y un número.</span>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Actualizar contraseña</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('form');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const errorBox = form.querySelector('[data-error]');
        const button = form.querySelector('button');
        errorBox.textContent = '';
        button.disabled = true;
        try {
          const session = await api.changePassword({
            current_password: form.querySelector('#pw-current').value,
            new_password: form.querySelector('#pw-new').value,
          });
          // The server revokes every other session, so adopt the fresh token.
          setToken(session.token);
          close();
          toast('Contraseña actualizada', 'ok');
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}

// --- profile ----------------------------------------------------------------

export function profileView() {
  screen({
    title: 'Tus datos',
    back: '/settings',
    nav: 'more',
    content: `
      <form class="stack" novalidate>
        <div class="card card--flat">
          <div class="card__label">Teléfono (tu acceso)</div>
          <div style="font-weight:650;font-size:17px;font-variant-numeric:tabular-nums">${esc(store.user.phone)}</div>
          <div class="list__meta" style="margin-top:4px">
            Para cambiarlo, escribe al soporte de DerteApp desde la pestaña Soporte.
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="pf-name">Nombre completo</label>
          <input class="input" id="pf-name" value="${esc(store.user.full_name)}" required>
        </div>
        <div class="field">
          <label class="field__label" for="pf-email">Email</label>
          <input class="input" id="pf-email" type="email" value="${esc(store.user.email ?? '')}">
        </div>
        <div class="field">
          <label class="field__label" for="pf-whatsapp">Número de WhatsApp</label>
          <input class="input" id="pf-whatsapp" type="tel" value="${esc(store.user.whatsapp_phone ?? '')}"
                 placeholder="+34600123456">
          <span class="field__hint">Lo usan los botones de WhatsApp. Por defecto es tu teléfono.</span>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Guardar</button>
      </form>`,
  });

  const form = document.querySelector('.main form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = form.querySelector('[data-error]');
    const button = form.querySelector('button');
    errorBox.textContent = '';
    button.disabled = true;
    try {
      await api.updateProfile({
        full_name: form.querySelector('#pf-name').value,
        email: form.querySelector('#pf-email').value.trim() || null,
        whatsapp_phone: form.querySelector('#pf-whatsapp').value.trim() || null,
      });
      await loadSession();
      toast('Guardado', 'ok');
      navigate('/settings');
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  });
  return undefined;
}

// --- shop details -----------------------------------------------------------

function googleCalendarBlock(gcal) {
  const connected = Boolean(gcal?.connected);
  const statusLabel = connected
    ? gcal.connected_email
      ? `Conectado · ${gcal.connected_email}`
      : 'Sincronización activa'
    : gcal?.configured
      ? 'Sin vincular'
      : 'Pendiente de configuración en el servidor';

  const connectButton = gcal?.oauth_configured
    ? `<button type="button" class="btn btn--block" data-gcal-connect>
         ${connected ? 'Volver a conectar con Google' : 'Conectar Google Calendar'}
       </button>`
    : '';

  const saHint = gcal?.service_account_configured
    ? `<span class="field__hint">
         Comparte tu calendario con <strong>${esc(gcal.service_account_email)}</strong>
         (permiso «Hacer cambios en eventos») e introduce el Calendar ID abajo.
       </span>`
    : '';

  return `
    <div class="section-title"><span>Google Calendar</span></div>
    <div class="card ${connected ? 'card--accent' : 'card--flat'}" data-gcal>
      <div class="row" style="gap:8px">
        ${icon('calendar', { size: 18 })}
        <div class="grow">
          <strong>${connected ? 'Agenda sincronizada' : 'Vincular Google Calendar'}</strong>
          <div class="list__meta" style="margin-top:2px">${esc(statusLabel)}</div>
          <div class="list__meta" style="margin-top:6px">
            Las citas nuevas, editadas o canceladas se reflejan automáticamente en la agenda del taller.
          </div>
        </div>
      </div>
      ${
        gcal?.configured || gcal?.oauth_configured
          ? `<div style="height:14px"></div>
             ${connectButton}
             <form class="stack" data-gcal-form style="margin-top:12px" novalidate>
               <div class="field">
                 <label class="field__label" for="gcal-id">Calendar ID</label>
                 <input class="input" id="gcal-id" value="${esc(gcal.calendar_id ?? '')}"
                        placeholder="primary o correo@gmail.com" autocomplete="off">
                 ${saHint}
                 <span class="field__hint">
                   Con OAuth suele bastar «primary». Con cuenta de servicio usa el ID exacto del calendario.
                 </span>
               </div>
               <label class="row" style="gap:10px;align-items:center">
                 <input type="checkbox" id="gcal-enabled" ${gcal.sync_enabled ? 'checked' : ''}>
                 <span>Sincronizar citas con Google Calendar</span>
               </label>
               <div class="field__error" data-gcal-error role="alert"></div>
               <button class="btn btn--block btn--ghost" type="submit">Guardar Calendar ID</button>
             </form>
             ${
               connected || gcal.connected_email || gcal.sync_enabled
                 ? `<button type="button" class="btn btn--block btn--danger" data-gcal-disconnect style="margin-top:8px">
                      Desconectar Google Calendar
                    </button>`
                 : ''
             }`
          : `<div class="list__meta" style="margin-top:12px">
               Un Super Admin debe configurar <code>GOOGLE_CALENDAR_CLIENT_ID</code> /
               <code>GOOGLE_CALENDAR_CLIENT_SECRET</code> o una cuenta de servicio en el servidor.
             </div>`
      }
    </div>`;
}

export async function shopSettingsView({ query } = {}) {
  const shop = requireShop({ title: 'Datos del taller', navKey: 'more' });
  if (!shop) return undefined;

  if (query?.get('google') === 'connected') {
    toast('Google Calendar conectado', 'ok');
    history.replaceState(null, '', '/settings/shop');
  } else if (query?.get('google') === 'error') {
    toast('No se pudo conectar Google Calendar', 'error');
    history.replaceState(null, '', '/settings/shop');
  }

  screen({ title: 'Datos del taller', back: '/settings', nav: 'more', content: skeletonList(4) });

  let payload;
  try {
    payload = await api.shop(shop.id);
  } catch (error) {
    setContent(emptyState('No se pudo cargar el taller', error.message, 'x'));
    return undefined;
  }
  const details = payload.shop;
  const gcal = details.google_calendar ?? {};

  const main = setContent(`
    <div class="stack">
      <form class="stack" data-shop-form novalidate>
        <div class="field">
          <label class="field__label" for="sh-name">Nombre del taller</label>
          <input class="input" id="sh-name" value="${esc(details.name)}" required>
        </div>
        <div class="field">
          <label class="field__label" for="sh-phone">Teléfono del taller</label>
          <input class="input" id="sh-phone" type="tel" value="${esc(details.phone ?? '')}" placeholder="+34600123456">
          <span class="field__hint">Se muestra en tu web y se usa cuando los clientes llaman al taller.</span>
        </div>
        <div class="field">
          <label class="field__label" for="sh-whatsapp">Número de WhatsApp</label>
          <input class="input" id="sh-whatsapp" type="tel" value="${esc(details.whatsapp_phone ?? '')}">
        </div>
        <div class="field">
          <label class="field__label" for="sh-email">Email</label>
          <input class="input" id="sh-email" type="email" value="${esc(details.email ?? '')}">
        </div>
        <div class="field">
          <label class="field__label" for="sh-address">Dirección</label>
          <input class="input" id="sh-address" value="${esc(details.address ?? '')}">
        </div>
        <div class="grid-2">
          <div class="field">
            <label class="field__label" for="sh-city">Ciudad</label>
            <input class="input" id="sh-city" value="${esc(details.city ?? '')}">
          </div>
          <div class="field">
            <label class="field__label" for="sh-country">Prefijo del país</label>
            <input class="input" id="sh-country" value="${esc(details.country_code ?? '')}" placeholder="34" maxlength="4">
            <span class="field__hint">Permite a los clientes escribir un número local.</span>
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="sh-site">Dirección web</label>
          <input class="input" id="sh-site" type="url" value="${esc(details.site_url ?? '')}" placeholder="https://…">
        </div>
        <div class="field">
          <label class="field__label" for="sh-services">Servicios que ofreces</label>
          <textarea class="input" id="sh-services" placeholder="Frenos&#10;Neumáticos&#10;Diagnóstico">${esc((details.services ?? []).join('\n'))}</textarea>
          <span class="field__hint">Uno por línea. Rellenan el desplegable de servicios de tu web.</span>
        </div>
        <div class="field">
          <label class="field__label" for="sh-timezone">Zona horaria</label>
          <input class="input" id="sh-timezone" value="${esc(details.timezone)}">
          <span class="field__hint">Todas las reservas y el horario usan esta zona horaria.</span>
        </div>
        ${
          store.isSuperAdmin
            ? `<div class="section-title"><span>Enrutado de la plataforma</span></div>
               <div class="field">
                 <label class="field__label" for="sh-retell-agent">ID del agente Retell</label>
                 <input class="input" id="sh-retell-agent" value="${esc(details.retell_agent_id ?? '')}"
                        placeholder="agent_…">
                 <span class="field__hint">Envía las llamadas de la recepcionista IA al calendario de este taller.</span>
               </div>
               <div class="field">
                 <label class="field__label" for="sh-retell-did">Número entrante Retell</label>
                 <input class="input" id="sh-retell-did" type="tel" value="${esc(details.retell_did ?? '')}"
                        placeholder="+34910000111">
               </div>
               <div class="field">
                 <label class="field__label" for="sh-zadarma-sip">SIP / extensión Zadarma</label>
                 <input class="input" id="sh-zadarma-sip" value="${esc(details.zadarma_sip ?? '')}">
               </div>
               <div class="field">
                 <label class="field__label" for="sh-zadarma-did">DID Zadarma</label>
                 <input class="input" id="sh-zadarma-did" type="tel" value="${esc(details.zadarma_did ?? '')}">
               </div>`
            : ''
        }
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Guardar datos del taller</button>
      </form>

      ${googleCalendarBlock(gcal)}
    </div>`);

  const form = main.querySelector('[data-shop-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = form.querySelector('[data-error]');
    const button = form.querySelector('button[type="submit"]');
    errorBox.textContent = '';
    button.disabled = true;
    const value = (id) => form.querySelector(id)?.value.trim() ?? '';
    try {
      await api.updateShop(shop.id, {
        name: value('#sh-name'),
        phone: value('#sh-phone') || null,
        whatsapp_phone: value('#sh-whatsapp') || null,
        email: value('#sh-email') || null,
        address: value('#sh-address') || null,
        city: value('#sh-city') || null,
        country_code: value('#sh-country') || null,
        site_url: value('#sh-site') || null,
        timezone: value('#sh-timezone'),
        services: value('#sh-services')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
        ...(store.isSuperAdmin
          ? {
              retell_agent_id: value('#sh-retell-agent') || null,
              retell_did: value('#sh-retell-did') || null,
              zadarma_sip: value('#sh-zadarma-sip') || null,
              zadarma_did: value('#sh-zadarma-did') || null,
            }
          : {}),
      });
      await loadSession();
      toast('Datos del taller guardados', 'ok');
      navigate('/settings');
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  });

  main.querySelector('[data-gcal-connect]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { url } = await api.googleCalendarConnect(shop.id);
      window.location.href = url;
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });

  main.querySelector('[data-gcal-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const gcalForm = event.currentTarget;
    const errorBox = gcalForm.querySelector('[data-gcal-error]');
    const button = gcalForm.querySelector('button[type="submit"]');
    errorBox.textContent = '';
    button.disabled = true;
    try {
      await api.saveGoogleCalendar(shop.id, {
        calendar_id: gcalForm.querySelector('#gcal-id').value.trim(),
        sync_enabled: gcalForm.querySelector('#gcal-enabled').checked,
      });
      toast('Google Calendar actualizado', 'ok');
      navigate('/settings/shop');
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  });

  main.querySelector('[data-gcal-disconnect]')?.addEventListener('click', async () => {
    const confirmed = await confirmSheet({
      title: '¿Desconectar Google Calendar?',
      message: 'Las citas nuevas dejarán de sincronizarse. Los eventos ya creados en Google no se borran.',
      confirmLabel: 'Desconectar',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.disconnectGoogleCalendar(shop.id);
      toast('Google Calendar desconectado', 'ok');
      navigate('/settings/shop');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  return undefined;
}

// --- Hostinger website integration -----------------------------------------

export async function websiteView() {
  const shop = requireShop({ title: 'Web', navKey: 'more' });
  if (!shop) return undefined;

  screen({ title: 'Formulario de reservas web', back: '/settings', nav: 'more', content: skeletonList(3) });

  const render = async () => {
    let embed;
    try {
      embed = await api.embed(shop.id);
    } catch (error) {
      setContent(emptyState('No se pudo cargar el snippet', error.message, 'x'));
      return;
    }

    const main = setContent(`
      <div class="stack">
        <div class="card card--accent">
          <div class="row" style="gap:8px">
            ${icon('code', { size: 18 })}
            <div class="grow">
              <strong>Conecta tu sitio de Hostinger</strong>
              <div class="list__meta" style="margin-top:2px">
                Un solo snippet añade reservas, consulta de horario y estadísticas de visitas.
              </div>
            </div>
          </div>
        </div>

        <div class="section-title"><span>1 · Copia el snippet</span></div>
        <div class="card">
          <pre style="margin:0;overflow-x:auto;font-family:var(--mono);font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all">${esc(embed.snippet)}</pre>
          <div style="height:12px"></div>
          <button class="btn btn--block btn--small" data-copy-snippet>${icon('copy', { size: 16 })} Copiar snippet</button>
        </div>

        <div class="section-title"><span>2 · Pégalo en Hostinger</span></div>
        <div class="card">
          <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:var(--ink-2)">
            ${embed.instructions.map((step) => `<li>${esc(step)}</li>`).join('')}
          </ol>
        </div>

        <div class="section-title"><span>Tu clave del sitio</span></div>
        <div class="card">
          <div class="card__label">Clave pública</div>
          <div style="font-family:var(--mono);font-size:12.5px;word-break:break-all;margin-top:4px">${esc(embed.public_key)}</div>
          <div style="height:12px"></div>
          <div class="btn-row">
            <button class="btn btn--small btn--ghost" data-copy-key>${icon('copy', { size: 16 })} Copiar clave</button>
            <button class="btn btn--small btn--soft" data-rotate>${icon('refresh', { size: 16 })} Rotar</button>
          </div>
          <div class="list__meta" style="margin-top:8px">
            Rotar la clave hace que el snippet antiguo deje de funcionar al momento. Hazlo solo si la clave se ha filtrado.
          </div>
        </div>

        <div class="section-title"><span>Endpoints</span></div>
        <div class="card">
          ${Object.entries(embed.endpoints)
            .map(
              ([name, url]) => `
                <div class="kv" style="align-items:center">
                  <span class="kv__key">${esc(name)}</span>
                  <span class="kv__value truncate" style="font-family:var(--mono);font-size:11.5px;max-width:60%">${esc(url)}</span>
                </div>`,
            )
            .join('')}
        </div>

        <div class="card card--flat">
          <div class="card__label">Nombres de campo que entiende el formulario</div>
          <p class="list__meta" style="margin-top:6px">
            name, phone, email, date, time, service, make, model, plate, notes.
            Añade <code>data-derte="booking-form"</code> al propio formulario y un campo oculto
            <code>derte_trap</code> para atrapar bots.
          </p>
        </div>
      </div>`);

    main.querySelector('[data-copy-snippet]').addEventListener('click', () => copy(embed.snippet, 'Snippet copiado'));
    main.querySelector('[data-copy-key]').addEventListener('click', () => copy(embed.public_key, 'Clave copiada'));
    main.querySelector('[data-rotate]').addEventListener('click', async () => {
      const confirmed = await confirmSheet({
        title: '¿Rotar la clave del sitio?',
        message: 'Tu web dejará de aceptar reservas hasta que pegues el nuevo snippet en Hostinger.',
        confirmLabel: 'Rotar clave',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.rotateKey(shop.id);
        toast('Nueva clave generada — actualiza tu web', 'ok');
        await render();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  };

  await render();
  return undefined;
}

// --- telephony --------------------------------------------------------------

export async function telephonyView() {
  const shop = requireShop({ title: 'Llamadas', navKey: 'more' });
  if (!shop) return undefined;

  screen({ title: 'Llamadas y WhatsApp', back: '/settings', nav: 'more', content: skeletonList(3) });

  let status;
  let calls;
  try {
    [status, calls] = await Promise.all([api.telephonyStatus(), api.calls({ shop_id: shop.id, limit: 30 })]);
  } catch (error) {
    setContent(emptyState('No se pudieron cargar los ajustes de llamadas', error.message, 'x'));
    return undefined;
  }
  store.telephony = status;

  const shopDetail = await api.shop(shop.id).then((result) => result.shop).catch(() => shop);

  setContent(`
    <div class="stack">
      <div class="card ${status.configured ? 'card--accent' : 'card--flat'}">
        <div class="row" style="gap:8px">
          ${icon('phone', { size: 18 })}
          <div class="grow">
            <strong>${status.configured ? 'Centralita Zadarma conectada' : 'Zadarma no conectado'}</strong>
            <div class="list__meta" style="margin-top:2px">
              ${
                status.configured
                  ? 'Las llamadas con un toque pasan por tu centralita virtual y las entrantes se registran aquí.'
                  : 'Los botones de llamar y WhatsApp siguen funcionando con tu teléfono. Pide al soporte de DerteApp que conecte un número Zadarma.'
              }
            </div>
          </div>
        </div>
      </div>

      <div class="card card--flat">
        <div class="row" style="gap:8px">
          ${icon('megaphone', { size: 18 })}
          <div class="grow">
            <strong>Recepcionista IA (Retell)</strong>
            <div class="list__meta" style="margin-top:2px">
              Las llamadas de Retell terminadas se convierten automáticamente en reservas pendientes en tu calendario.
              ${
                shopDetail.retell_agent_id || shopDetail.retell_did
                  ? ` Vinculado${shopDetail.retell_agent_id ? ` · agente ${esc(shopDetail.retell_agent_id)}` : ''}${
                      shopDetail.retell_did ? ` · DID ${esc(shopDetail.retell_did)}` : ''
                    }.`
                  : ' Pide al soporte de DerteApp que vincule tu agente Retell o número entrante a este taller.'
              }
            </div>
          </div>
        </div>
      </div>

      <div class="section-title"><span>Llamadas recientes</span></div>
      ${
        calls.calls.length
          ? `<div class="list">
               ${calls.calls
                 .map(
                   (call) => `
                     <div class="list__item list__item--static">
                       <span class="avatar" style="background:${
                         call.status === 'completed' ? 'var(--ok-soft)' : 'var(--danger-soft)'
                       };color:${call.status === 'completed' ? 'var(--ok)' : 'var(--danger)'}">
                         ${icon(call.status === 'completed' ? 'phone' : 'missed', { size: 17 })}
                       </span>
                       <div class="grow">
                         <div class="list__title truncate">${esc(call.counterparty ?? 'Número desconocido')}</div>
                         <div class="list__meta">
                           ${call.direction === 'in' ? 'Entrante' : 'Saliente'} ·
                           ${esc(call.status.replaceAll('_', ' '))}
                           ${call.duration_seconds ? ` · ${call.duration_seconds}s` : ''}
                         </div>
                       </div>
                       ${
                         call.tel_link
                           ? `<a class="btn btn--icon" href="${esc(call.tel_link)}" aria-label="Devolver llamada">${icon('phone', { size: 17 })}</a>`
                           : ''
                       }
                     </div>`,
                 )
                 .join('')}
             </div>`
          : emptyState('Aún no hay llamadas registradas', 'Las llamadas aparecen aquí cuando se enruta un número Zadarma a este taller.', 'phone')
      }

      <div class="card card--flat">
        <div class="card__label">URL del webhook de Zadarma</div>
        <div style="font-family:var(--mono);font-size:11.5px;word-break:break-all;margin-top:4px">${esc(status.webhook_url)}</div>
        <div class="list__meta" style="margin-top:6px">
          Un Super Admin añade esta URL en el panel de Zadarma para recibir eventos de llamadas.
        </div>
      </div>
    </div>`);
  return undefined;
}

// --- team -------------------------------------------------------------------

export async function teamView() {
  const shop = requireShop({ title: 'Equipo', navKey: 'more' });
  if (!shop) return undefined;

  screen({
    title: 'Equipo',
    back: '/settings',
    nav: 'more',
    actions: `<button class="btn btn--icon" data-add aria-label="Añadir miembro">${icon('plus', { size: 20 })}</button>`,
    content: skeletonList(3),
  });

  const render = async () => {
    let payload;
    try {
      payload = await api.shop(shop.id);
    } catch (error) {
      setContent(emptyState('No se pudo cargar el equipo', error.message, 'x'));
      return;
    }

    const main = setContent(`
      <div class="stack">
        <div class="list">
          ${payload.members
            .map(
              (member) => `
                <div class="list__item list__item--static">
                  <div class="grow">
                    <div class="list__title">${esc(member.full_name)}</div>
                    <div class="list__meta">${esc(member.phone_display)} · ${esc(member.role)}</div>
                  </div>
                  ${
                    member.id === store.user.id
                      ? '<span class="badge">Tú</span>'
                      : `<button class="btn btn--icon" data-remove="${esc(member.id)}" aria-label="Eliminar">${icon('x', { size: 17 })}</button>`
                  }
                </div>`,
            )
            .join('')}
        </div>
        ${
          payload.shop.contact?.phone
            ? `<div class="card card--flat">
                 <div class="card__label">Número que ven los clientes</div>
                 <div style="font-weight:640;margin:2px 0 10px">${esc(payload.shop.contact.phone_display)}</div>
                 ${contactButtons({
                   telLink: payload.shop.contact.tel_link,
                   whatsappLink: payload.shop.contact.whatsapp_link,
                   compact: true,
                 })}
               </div>`
            : ''
        }
      </div>`);

    main.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-remove]');
      if (!remove) return;
      const confirmed = await confirmSheet({
        title: '¿Eliminar a esta persona?',
        message: 'Pierde el acceso a este taller al momento.',
        confirmLabel: 'Eliminar',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.removeMember(shop.id, remove.dataset.remove);
        await render();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  };

  document.querySelector('.header [data-add]').addEventListener('click', () => {
    sheet({
      title: 'Añadir un miembro del equipo',
      body: `
        <form class="stack" novalidate>
          <div class="field">
            <label class="field__label" for="tm-name">Nombre</label>
            <input class="input" id="tm-name" required>
          </div>
          <div class="field">
            <label class="field__label" for="tm-phone">Teléfono</label>
            <input class="input" id="tm-phone" type="tel" placeholder="+34600123456" required>
          </div>
          <div class="field">
            <label class="field__label" for="tm-role">Rol</label>
            <select class="input" id="tm-role">
              <option value="mechanic">Mecánico</option>
              <option value="manager">Encargado</option>
              <option value="owner">Propietario</option>
            </select>
          </div>
          <div class="field__error" data-error role="alert"></div>
          <button class="btn btn--block" type="submit">Añadir</button>
        </form>`,
      onMount(content, close) {
        const form = content.querySelector('form');
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const errorBox = form.querySelector('[data-error]');
          const button = form.querySelector('button');
          errorBox.textContent = '';
          button.disabled = true;
          try {
            const result = await api.addMember(shop.id, {
              full_name: form.querySelector('#tm-name').value,
              phone: form.querySelector('#tm-phone').value,
              role: form.querySelector('#tm-role').value,
            });
            close();
            if (result.temporary_password) {
              sheet({
                title: 'Comparte estos datos de acceso',
                body: `
                  <div class="stack">
                    <p style="color:var(--muted);font-size:14px">
                      ${esc(result.member.full_name)} puede entrar con su teléfono y esta contraseña temporal.
                    </p>
                    <div class="card card--flat" style="font-family:var(--mono);font-size:15px">
                      ${esc(result.member.phone)}<br>${esc(result.temporary_password)}
                    </div>
                    <button class="btn btn--block" data-copy>Copiar contraseña</button>
                  </div>`,
                onMount(inner) {
                  inner
                    .querySelector('[data-copy]')
                    .addEventListener('click', () => copy(result.temporary_password, 'Contraseña copiada'));
                },
              });
            } else {
              toast('Miembro del equipo añadido', 'ok');
            }
            await render();
          } catch (error) {
            errorBox.textContent = error.message;
            button.disabled = false;
          }
        });
      },
    });
  });

  await render();
  return undefined;
}
