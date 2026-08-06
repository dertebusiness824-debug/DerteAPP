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

export function settingsView() {
  const shop = store.activeShop;

  screen({
    title: 'Settings',
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
              <div class="list__meta">${esc(store.isSuperAdmin ? 'Super Admin' : 'Shop owner')}</div>
            </div>
          </div>
          <div style="height:12px"></div>
          <div class="card card--flat">
            <div class="card__label">Your registered number</div>
            <div style="font-weight:650;font-size:17px;font-variant-numeric:tabular-nums;margin-top:2px">
              ${esc(store.user.phone)}
            </div>
            <div class="list__meta" style="margin-top:4px">
              Customers and the DerteApp team see this number at the top of every chat.
            </div>
          </div>
        </div>

        <div class="section-title"><span>Account</span></div>
        <div class="list">
          <a class="list__item" href="/settings/profile">
            ${icon('user')}<div class="grow"><div class="list__title">Your details</div>
            <div class="list__meta">Name, email, WhatsApp number</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
          <button class="list__item" data-password>
            ${icon('settings')}<div class="grow"><div class="list__title">Change password</div>
            <div class="list__meta">Signs you out on other devices</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </button>
        </div>

        ${
          shop
            ? `<div class="section-title"><span>${esc(shop.name)}</span>
                 ${store.shops.length > 1 || store.isSuperAdmin ? '<button class="auth__link" data-switch>Switch</button>' : ''}
               </div>
               <div class="list">
                 <a class="list__item" href="/settings/shop">
                   ${icon('building')}<div class="grow"><div class="list__title">Shop details</div>
                   <div class="list__meta">Name, phone, address, services</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/website">
                   ${icon('code')}<div class="grow"><div class="list__title">Website booking form</div>
                   <div class="list__meta">Hostinger snippet and site key</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/telephony">
                   ${icon('phone')}<div class="grow"><div class="list__title">Calls &amp; WhatsApp</div>
                   <div class="list__meta">Zadarma PBX and call history</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/team">
                   ${icon('team')}<div class="grow"><div class="list__title">Team</div>
                   <div class="list__meta">People who can use this shop</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/schedule">
                   ${icon('clock')}<div class="grow"><div class="list__title">Opening hours</div>
                   <div class="list__meta">Hours, breaks and days off</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
               </div>`
            : ''
        }

        <div class="section-title"><span>Support</span></div>
        <div class="list">
          <a class="list__item" href="/chat/support">
            ${icon('megaphone')}<div class="grow"><div class="list__title">Message DerteApp</div>
            <div class="list__meta">Direct line to the platform team</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
        </div>

        <button class="btn btn--danger btn--block" data-signout>${icon('logout', { size: 17 })} Sign out</button>
        <p class="list__meta" style="text-align:center">DerteApp · installed as a home-screen app</p>
      </div>`,
  });

  const main = document.querySelector('.main');
  main.querySelector('[data-switch]')?.addEventListener('click', openShopSwitcher);
  main.querySelector('[data-password]').addEventListener('click', openPasswordSheet);
  main.querySelector('[data-signout]').addEventListener('click', async () => {
    const confirmed = await confirmSheet({
      title: 'Sign out?',
      message: 'You will need your phone number and password to sign back in.',
      confirmLabel: 'Sign out',
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
    title: 'Change password',
    body: `
      <form class="stack" novalidate>
        <div class="field">
          <label class="field__label" for="pw-current">Current password</label>
          <input class="input" id="pw-current" type="password" autocomplete="current-password" required>
        </div>
        <div class="field">
          <label class="field__label" for="pw-new">New password</label>
          <input class="input" id="pw-new" type="password" autocomplete="new-password" required>
          <span class="field__hint">At least 8 characters, with a letter and a number.</span>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Update password</button>
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
          toast('Password updated', 'ok');
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
    title: 'Your details',
    back: '/settings',
    nav: 'more',
    content: `
      <form class="stack" novalidate>
        <div class="card card--flat">
          <div class="card__label">Phone number (your sign-in)</div>
          <div style="font-weight:650;font-size:17px;font-variant-numeric:tabular-nums">${esc(store.user.phone)}</div>
          <div class="list__meta" style="margin-top:4px">
            To change it, message DerteApp support so nothing breaks in your customers' chats.
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="pf-name">Full name</label>
          <input class="input" id="pf-name" value="${esc(store.user.full_name)}" required>
        </div>
        <div class="field">
          <label class="field__label" for="pf-email">Email</label>
          <input class="input" id="pf-email" type="email" value="${esc(store.user.email ?? '')}">
        </div>
        <div class="field">
          <label class="field__label" for="pf-whatsapp">WhatsApp number</label>
          <input class="input" id="pf-whatsapp" type="tel" value="${esc(store.user.whatsapp_phone ?? '')}"
                 placeholder="+34600123456">
          <span class="field__hint">Used by the WhatsApp buttons. Defaults to your phone number.</span>
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Save</button>
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
      toast('Saved', 'ok');
      navigate('/settings');
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  });
  return undefined;
}

// --- shop details -----------------------------------------------------------

export async function shopSettingsView() {
  const shop = requireShop({ title: 'Shop details', navKey: 'more' });
  if (!shop) return undefined;

  screen({ title: 'Shop details', back: '/settings', nav: 'more', content: skeletonList(4) });

  let payload;
  try {
    payload = await api.shop(shop.id);
  } catch (error) {
    setContent(emptyState('Could not load the shop', error.message, 'x'));
    return undefined;
  }
  const details = payload.shop;

  const main = setContent(`
    <form class="stack" novalidate>
      <div class="field">
        <label class="field__label" for="sh-name">Shop name</label>
        <input class="input" id="sh-name" value="${esc(details.name)}" required>
      </div>
      <div class="field">
        <label class="field__label" for="sh-phone">Shop phone number</label>
        <input class="input" id="sh-phone" type="tel" value="${esc(details.phone ?? '')}" placeholder="+34600123456">
        <span class="field__hint">Shown on your website and in customer chats.</span>
      </div>
      <div class="field">
        <label class="field__label" for="sh-whatsapp">WhatsApp number</label>
        <input class="input" id="sh-whatsapp" type="tel" value="${esc(details.whatsapp_phone ?? '')}">
      </div>
      <div class="field">
        <label class="field__label" for="sh-email">Email</label>
        <input class="input" id="sh-email" type="email" value="${esc(details.email ?? '')}">
      </div>
      <div class="field">
        <label class="field__label" for="sh-address">Address</label>
        <input class="input" id="sh-address" value="${esc(details.address ?? '')}">
      </div>
      <div class="grid-2">
        <div class="field">
          <label class="field__label" for="sh-city">City</label>
          <input class="input" id="sh-city" value="${esc(details.city ?? '')}">
        </div>
        <div class="field">
          <label class="field__label" for="sh-country">Country code</label>
          <input class="input" id="sh-country" value="${esc(details.country_code ?? '')}" placeholder="34" maxlength="4">
          <span class="field__hint">Lets customers type a local number.</span>
        </div>
      </div>
      <div class="field">
        <label class="field__label" for="sh-site">Website address</label>
        <input class="input" id="sh-site" type="url" value="${esc(details.site_url ?? '')}" placeholder="https://…">
      </div>
      <div class="field">
        <label class="field__label" for="sh-services">Services you offer</label>
        <textarea class="input" id="sh-services" placeholder="Brakes&#10;Tyres&#10;Diagnostics">${esc((details.services ?? []).join('\n'))}</textarea>
        <span class="field__hint">One per line. These fill the service dropdown on your website.</span>
      </div>
      <div class="field">
        <label class="field__label" for="sh-timezone">Timezone</label>
        <input class="input" id="sh-timezone" value="${esc(details.timezone)}">
        <span class="field__hint">All bookings and opening hours use this timezone.</span>
      </div>
      <div class="field__error" data-error role="alert"></div>
      <button class="btn btn--block" type="submit">Save shop details</button>
    </form>`);

  const form = main.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = form.querySelector('[data-error]');
    const button = form.querySelector('button');
    errorBox.textContent = '';
    button.disabled = true;
    const value = (id) => form.querySelector(id).value.trim();
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
      });
      await loadSession();
      toast('Shop details saved', 'ok');
      navigate('/settings');
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  });
  return undefined;
}

// --- Hostinger website integration -----------------------------------------

export async function websiteView() {
  const shop = requireShop({ title: 'Website', navKey: 'more' });
  if (!shop) return undefined;

  screen({ title: 'Website booking form', back: '/settings', nav: 'more', content: skeletonList(3) });

  const render = async () => {
    let embed;
    try {
      embed = await api.embed(shop.id);
    } catch (error) {
      setContent(emptyState('Could not load the snippet', error.message, 'x'));
      return;
    }

    const main = setContent(`
      <div class="stack">
        <div class="card card--accent">
          <div class="row" style="gap:8px">
            ${icon('code', { size: 18 })}
            <div class="grow">
              <strong>Connect your Hostinger site</strong>
              <div class="list__meta" style="margin-top:2px">
                One snippet adds bookings, opening-hours checks and visitor stats.
              </div>
            </div>
          </div>
        </div>

        <div class="section-title"><span>1 · Copy the snippet</span></div>
        <div class="card">
          <pre style="margin:0;overflow-x:auto;font-family:var(--mono);font-size:11.5px;line-height:1.55;white-space:pre-wrap;word-break:break-all">${esc(embed.snippet)}</pre>
          <div style="height:12px"></div>
          <button class="btn btn--block btn--small" data-copy-snippet>${icon('copy', { size: 16 })} Copy snippet</button>
        </div>

        <div class="section-title"><span>2 · Paste it into Hostinger</span></div>
        <div class="card">
          <ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:var(--ink-2)">
            ${embed.instructions.map((step) => `<li>${esc(step)}</li>`).join('')}
          </ol>
        </div>

        <div class="section-title"><span>Your site key</span></div>
        <div class="card">
          <div class="card__label">Public key</div>
          <div style="font-family:var(--mono);font-size:12.5px;word-break:break-all;margin-top:4px">${esc(embed.public_key)}</div>
          <div style="height:12px"></div>
          <div class="btn-row">
            <button class="btn btn--small btn--ghost" data-copy-key>${icon('copy', { size: 16 })} Copy key</button>
            <button class="btn btn--small btn--soft" data-rotate>${icon('refresh', { size: 16 })} Rotate</button>
          </div>
          <div class="list__meta" style="margin-top:8px">
            Rotating the key immediately stops the old snippet from working. Only do it if the key leaked.
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
          <div class="card__label">Form field names it understands</div>
          <p class="list__meta" style="margin-top:6px">
            name, phone, email, date, time, service, make, model, plate, notes.
            Add <code>data-derte="booking-form"</code> to the form itself, and a hidden
            <code>derte_trap</code> field to catch bots.
          </p>
        </div>
      </div>`);

    main.querySelector('[data-copy-snippet]').addEventListener('click', () => copy(embed.snippet, 'Snippet copied'));
    main.querySelector('[data-copy-key]').addEventListener('click', () => copy(embed.public_key, 'Key copied'));
    main.querySelector('[data-rotate]').addEventListener('click', async () => {
      const confirmed = await confirmSheet({
        title: 'Rotate the site key?',
        message: 'Your website stops taking bookings until you paste the new snippet into Hostinger.',
        confirmLabel: 'Rotate key',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.rotateKey(shop.id);
        toast('New key generated — update your site', 'ok');
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
  const shop = requireShop({ title: 'Calls', navKey: 'more' });
  if (!shop) return undefined;

  screen({ title: 'Calls & WhatsApp', back: '/settings', nav: 'more', content: skeletonList(3) });

  let status;
  let calls;
  try {
    [status, calls] = await Promise.all([api.telephonyStatus(), api.calls({ shop_id: shop.id, limit: 30 })]);
  } catch (error) {
    setContent(emptyState('Could not load call settings', error.message, 'x'));
    return undefined;
  }
  store.telephony = status;

  setContent(`
    <div class="stack">
      <div class="card ${status.configured ? 'card--accent' : 'card--flat'}">
        <div class="row" style="gap:8px">
          ${icon('phone', { size: 18 })}
          <div class="grow">
            <strong>${status.configured ? 'Zadarma PBX connected' : 'Zadarma not connected'}</strong>
            <div class="list__meta" style="margin-top:2px">
              ${
                status.configured
                  ? 'One-tap calls go through your virtual PBX, and incoming calls are logged here.'
                  : 'Call and WhatsApp buttons still work using your phone directly. Ask DerteApp support to connect a Zadarma number.'
              }
            </div>
          </div>
        </div>
      </div>

      <div class="section-title"><span>Recent calls</span></div>
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
                         <div class="list__title truncate">${esc(call.counterparty ?? 'Unknown number')}</div>
                         <div class="list__meta">
                           ${call.direction === 'in' ? 'Incoming' : 'Outgoing'} ·
                           ${esc(call.status.replaceAll('_', ' '))}
                           ${call.duration_seconds ? ` · ${call.duration_seconds}s` : ''}
                         </div>
                       </div>
                       ${
                         call.tel_link
                           ? `<a class="btn btn--icon" href="${esc(call.tel_link)}" aria-label="Call back">${icon('phone', { size: 17 })}</a>`
                           : ''
                       }
                     </div>`,
                 )
                 .join('')}
             </div>`
          : emptyState('No calls logged yet', 'Calls appear here once a Zadarma number is routed to this shop.', 'phone')
      }

      <div class="card card--flat">
        <div class="card__label">Webhook URL for Zadarma</div>
        <div style="font-family:var(--mono);font-size:11.5px;word-break:break-all;margin-top:4px">${esc(status.webhook_url)}</div>
        <div class="list__meta" style="margin-top:6px">
          A Super Admin adds this in the Zadarma control panel to receive call events.
        </div>
      </div>
    </div>`);
  return undefined;
}

// --- team -------------------------------------------------------------------

export async function teamView() {
  const shop = requireShop({ title: 'Team', navKey: 'more' });
  if (!shop) return undefined;

  screen({
    title: 'Team',
    back: '/settings',
    nav: 'more',
    actions: `<button class="btn btn--icon" data-add aria-label="Add member">${icon('plus', { size: 20 })}</button>`,
    content: skeletonList(3),
  });

  const render = async () => {
    let payload;
    try {
      payload = await api.shop(shop.id);
    } catch (error) {
      setContent(emptyState('Could not load the team', error.message, 'x'));
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
                      ? '<span class="badge">You</span>'
                      : `<button class="btn btn--icon" data-remove="${esc(member.id)}" aria-label="Remove">${icon('x', { size: 17 })}</button>`
                  }
                </div>`,
            )
            .join('')}
        </div>
        ${
          payload.shop.contact?.phone
            ? `<div class="card card--flat">
                 <div class="card__label">Number customers see</div>
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
        title: 'Remove this person?',
        message: 'They lose access to this shop straight away.',
        confirmLabel: 'Remove',
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
      title: 'Add a team member',
      body: `
        <form class="stack" novalidate>
          <div class="field">
            <label class="field__label" for="tm-name">Name</label>
            <input class="input" id="tm-name" required>
          </div>
          <div class="field">
            <label class="field__label" for="tm-phone">Phone number</label>
            <input class="input" id="tm-phone" type="tel" placeholder="+34600123456" required>
          </div>
          <div class="field">
            <label class="field__label" for="tm-role">Role</label>
            <select class="input" id="tm-role">
              <option value="mechanic">Mechanic</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </select>
          </div>
          <div class="field__error" data-error role="alert"></div>
          <button class="btn btn--block" type="submit">Add</button>
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
                title: 'Share these sign-in details',
                body: `
                  <div class="stack">
                    <p style="color:var(--muted);font-size:14px">
                      ${esc(result.member.full_name)} can sign in with their phone number and this temporary password.
                    </p>
                    <div class="card card--flat" style="font-family:var(--mono);font-size:15px">
                      ${esc(result.member.phone)}<br>${esc(result.temporary_password)}
                    </div>
                    <button class="btn btn--block" data-copy>Copy password</button>
                  </div>`,
                onMount(inner) {
                  inner
                    .querySelector('[data-copy]')
                    .addEventListener('click', () => copy(result.temporary_password, 'Password copied'));
                },
              });
            } else {
              toast('Team member added', 'ok');
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
