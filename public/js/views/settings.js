/** Profile, shop details, website integration, team and telephony. */
import { api, setToken } from '../api.js';
import { languageSelectHtml, t } from '../i18n.js';
import { navigate } from '../router.js';
import { loadSession, openPlatformSupport, setActiveShop, signOut, store } from '../store.js';
import { applyLanguage, openShopSwitcher, requireShop, screen, setContent } from '../shell.js';
import { enablePushNotifications, pushSupported } from '../push.js';
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
    return `<p class="list__meta" style="text-align:center">${esc(t('install.running'))}</p>`;
  }
  if (window.derteInstallPrompt) {
    return `
      <div class="install">
        ${icon('home', { size: 20 })}
        <div class="grow install__text">${esc(t('install.cta'))}</div>
        <button class="btn btn--small" data-install>${esc(t('install.button'))}</button>
      </div>`;
  }
  return `
    <div class="install">
      ${icon('home', { size: 20 })}
      <div class="grow install__text">${esc(t('install.ios'))}</div>
    </div>`;
}

/** Web Push permission CTA (required for iOS PWA urgencia alerts). */
function pushBlock() {
  if (!pushSupported()) {
    return `
      <div class="install">
        ${icon('bell', { size: 20 })}
        <div class="grow install__text">${esc(t('push.unsupported'))}</div>
      </div>`;
  }
  const permission = Notification.permission;
  if (permission === 'granted') {
    return `
      <div class="install">
        ${icon('bell', { size: 20 })}
        <div class="grow install__text">${esc(t('push.alreadyOn'))}</div>
        <button class="btn btn--small btn--soft" type="button" data-enable-push>${esc(t('push.refresh'))}</button>
      </div>`;
  }
  return `
    <div class="install">
      ${icon('bell', { size: 20 })}
      <div class="grow install__text">${esc(t('push.cta'))}</div>
      <button class="btn btn--small" type="button" data-enable-push>${esc(t('push.enable'))}</button>
    </div>`;
}

export function settingsView({ query } = {}) {
  if (store.isSuperAdmin) return superAdminSettingsView({ query });
  return ownerSettingsView();
}

function ownerSettingsView() {
  const shop = store.activeShop;

  screen({
    title: t('settings.title'),
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
              <div class="list__meta">${esc(t('settings.roleOwner'))}</div>
            </div>
          </div>
          <div style="height:12px"></div>
          <div class="card card--flat">
            <div class="card__label">${esc(t('settings.registeredPhone'))}</div>
            <div style="font-weight:650;font-size:17px;font-variant-numeric:tabular-nums;margin-top:2px">
              ${esc(store.user.phone)}
            </div>
            <div class="list__meta" style="margin-top:4px">
              ${esc(t('settings.registeredPhoneHint'))}
            </div>
          </div>
        </div>

        <div class="section-title"><span>${esc(t('settings.languageSection'))}</span></div>
        <div class="card card--flat">
          <div class="field">
            <label class="field__label" for="settings-lang">${esc(t('common.chooseLanguage'))}</label>
            ${languageSelectHtml({ id: 'settings-lang', className: 'input lang-select' })}
            <span class="field__hint">${esc(t('lang.subtitle'))}</span>
          </div>
        </div>

        <div class="section-title"><span>${esc(t('settings.account'))}</span></div>
        <div class="list">
          <a class="list__item" href="/settings/profile">
            ${icon('user')}<div class="grow"><div class="list__title">${esc(t('settings.profile'))}</div>
            <div class="list__meta">${esc(t('settings.profileMeta'))}</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </a>
          <button class="list__item" data-password>
            ${icon('settings')}<div class="grow"><div class="list__title">${esc(t('settings.password'))}</div>
            <div class="list__meta">${esc(t('settings.passwordMeta'))}</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </button>
        </div>

        ${
          shop
            ? `<div class="section-title"><span>${esc(shop.name)}</span>
                 ${store.shops.length > 1 ? `<button class="auth__link" data-switch>${esc(t('settings.switchShop'))}</button>` : ''}
               </div>
               <div class="list">
                 <a class="list__item" href="/urgencias" data-nav-urgencias>
                   ${icon('phone')}<div class="grow"><div class="list__title">${esc(t('urgencias.title'))}</div>
                   <div class="list__meta">${esc(t('urgencias.homeHint'))}</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/shop">
                   ${icon('building')}<div class="grow"><div class="list__title">${esc(t('settings.shop'))}</div>
                   <div class="list__meta">${esc(t('settings.shopMeta'))}</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/website">
                   ${icon('code')}<div class="grow"><div class="list__title">${esc(t('settings.website'))}</div>
                   <div class="list__meta">${esc(t('settings.websiteMeta'))}</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/telephony">
                   ${icon('phone')}<div class="grow"><div class="list__title">${esc(t('settings.telephony'))}</div>
                   <div class="list__meta">${esc(t('settings.telephonyMeta'))}</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/settings/team">
                   ${icon('team')}<div class="grow"><div class="list__title">${esc(t('settings.team'))}</div>
                   <div class="list__meta">${esc(t('settings.teamMeta'))}</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
                 <a class="list__item" href="/schedule">
                   ${icon('clock')}<div class="grow"><div class="list__title">${esc(t('settings.hours'))}</div>
                   <div class="list__meta">${esc(t('settings.hoursMeta'))}</div></div>
                   ${icon('chevron', { size: 18, className: 'chev' })}
                 </a>
               </div>`
            : ''
        }

        <div class="section-title"><span>${esc(t('settings.support'))}</span></div>
        <div class="list">
          <button class="list__item" type="button" data-support-wa>
            ${icon('megaphone')}<div class="grow"><div class="list__title">${esc(t('settings.support'))}</div>
            <div class="list__meta">${esc(t('settings.supportWaMeta'))}</div></div>
            ${icon('chevron', { size: 18, className: 'chev' })}
          </button>
        </div>

        ${installBlock()}
        ${pushBlock()}

        <button class="btn btn--danger btn--block" data-signout>${icon('logout', { size: 17 })} ${esc(t('settings.signOut'))}</button>
        <p class="list__meta" style="text-align:center">DerteApp</p>
      </div>`,
  });

  const main = document.querySelector('.main');
  main.querySelector('#settings-lang')?.addEventListener('change', async (event) => {
    await applyLanguage(event.target.value);
  });
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
  main.querySelector('[data-enable-push]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await enablePushNotifications({ shopId: store.activeShop?.id });
    } finally {
      event.currentTarget.disabled = false;
    }
  });
  main.querySelector('[data-switch]')?.addEventListener('click', openShopSwitcher);
  main.querySelector('[data-password]').addEventListener('click', openPasswordSheet);
  main.querySelector('[data-support-wa]')?.addEventListener('click', () => openPlatformSupport());
  main.querySelector('[data-signout]').addEventListener('click', async () => {
    const confirmed = await confirmSheet({
      title: t('settings.signOutConfirm'),
      message: t('settings.signOutBody'),
      confirmLabel: t('settings.signOut'),
      danger: true,
    });
    if (!confirmed) return;
    await signOut();
    navigate('/login', { replace: true });
  });
  return undefined;
}

/**
 * Super Admin configuration hub:
 * 1) Gestión de talleres (crear + editar seleccionado)
 * 2) Perfil y teléfono del Super Admin
 */
async function superAdminSettingsView({ query } = {}) {
  consumeGoogleOAuthQuery(query, '/settings');

  screen({
    title: t('settings.title'),
    subtitle: store.user.full_name,
    nav: 'more',
    content: skeletonList(5),
  });

  let shopsPayload;
  let salesRepOptions = [];
  try {
    shopsPayload = await api.adminShops({ limit: 200 });
    const repsPayload = await api.adminSalesRepOptions();
    salesRepOptions = repsPayload.options ?? [];
  } catch (error) {
    setContent(emptyState('No se pudieron cargar los talleres', error.message, 'x'));
    return undefined;
  }

  const shops = shopsPayload.shops ?? [];
  const selectedId = store.activeShop?.id ?? shops[0]?.id ?? '';
  const salesRepSelectOptions = (selected = '') =>
    `<option value="">${esc(t('sa.salesRepNone'))}</option>` +
    salesRepOptions
      .map(
        (rep) =>
          `<option value="${esc(rep.id)}" ${rep.id === selected ? 'selected' : ''}>${esc(rep.name)}${
            rep.referral_code ? ` (${esc(rep.referral_code)})` : ''
          }</option>`,
      )
      .join('');

  const main = setContent(`
    <div class="stack">
      <div class="section-title"><span>${esc(t('sa.shopsSection'))}</span></div>

      <div class="card">
        <strong>${esc(t('sa.createShop'))}</strong>
        <p class="list__meta" style="margin:6px 0 12px">${esc(t('sa.createShopHint'))}</p>
        <form class="stack" data-create-shop novalidate>
          <div class="field">
            <label class="field__label" for="ns-name">${esc(t('sa.shopName'))}</label>
            <input class="input" id="ns-name" required autocomplete="organization">
          </div>
          <div class="field">
            <label class="field__label" for="ns-address">${esc(t('sa.address'))}</label>
            <input class="input" id="ns-address" autocomplete="street-address">
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field__label" for="ns-city">${esc(t('sa.city'))}</label>
              <input class="input" id="ns-city" autocomplete="address-level2">
            </div>
            <div class="field">
              <label class="field__label" for="ns-phone">${esc(t('sa.shopPhone'))}</label>
              <input class="input" id="ns-phone" type="tel" placeholder="+34600123456" required>
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="ns-website">${esc(t('sa.hostingerPanelUrl'))}</label>
            <input class="input" id="ns-website" type="url" placeholder="https://…">
            <span class="field__hint">${esc(t('sa.hostingerPanelHint'))}</span>
          </div>
          <div class="section-title" style="margin-top:4px"><span>${esc(t('sa.ownerAccess'))}</span></div>
          <div class="field">
            <label class="field__label" for="ns-owner-name">${esc(t('sa.ownerName'))}</label>
            <input class="input" id="ns-owner-name" required autocomplete="name">
          </div>
          <div class="field">
            <label class="field__label" for="ns-owner-email">${esc(t('sa.ownerEmail'))}</label>
            <input class="input" id="ns-owner-email" type="email" required autocomplete="email">
          </div>
          <div class="field">
            <label class="field__label" for="ns-owner-password">${esc(t('sa.ownerPassword'))}</label>
            <input class="input" id="ns-owner-password" type="password" required autocomplete="new-password">
            <span class="field__hint">${esc(t('sa.passwordHint'))}</span>
          </div>
          <div class="field">
            <label class="field__label" for="ns-sales-rep">${esc(t('sa.salesRep'))}</label>
            <select class="input" id="ns-sales-rep">${salesRepSelectOptions()}</select>
            <span class="field__hint">${esc(t('sa.salesRepHint'))}</span>
          </div>
          <p class="list__meta" style="margin:0">${esc(t('sa.createShopAutoHint'))}</p>
          <div class="field__error" data-create-error role="alert"></div>
          <button class="btn btn--block" type="submit">${esc(t('sa.createSubmit'))}</button>
        </form>
      </div>

      <div class="card">
        <div class="field">
          <label class="field__label" for="sa-shop-select">${esc(t('sa.selectShop'))}</label>
          <select class="input" id="sa-shop-select">
            <option value="">${esc(t('sa.selectShopPlaceholder'))}</option>
            ${shops
              .map(
                (shop) =>
                  `<option value="${esc(shop.id)}" ${shop.id === selectedId ? 'selected' : ''}>${esc(shop.name)}${
                    shop.city ? ` · ${esc(shop.city)}` : ''
                  }</option>`,
              )
              .join('')}
          </select>
        </div>
        <div data-shop-editor>${
          selectedId
            ? `<p class="list__meta">${esc(t('common.loading'))}</p>`
            : `<p class="list__meta">${esc(t('sa.selectShopHint'))}</p>`
        }</div>
      </div>

      <div class="section-title"><span>${esc(t('sa.profileSection'))}</span></div>
      <form class="card stack" data-sa-profile novalidate>
        <div class="field">
          <label class="field__label" for="sa-name">${esc(t('sa.fullName'))}</label>
          <input class="input" id="sa-name" value="${esc(store.user.full_name)}" required>
        </div>
        <div class="field">
          <label class="field__label" for="sa-email">${esc(t('sa.email'))}</label>
          <input class="input" id="sa-email" type="email" value="${esc(store.user.email ?? '')}" required>
        </div>
        <div class="field">
          <label class="field__label" for="sa-phone">${esc(t('sa.phone'))}</label>
          <input class="input" id="sa-phone" type="tel" value="${esc(store.user.phone ?? '')}" required
                 placeholder="+34605686509">
          <span class="field__hint">${esc(t('sa.phoneHint'))}</span>
        </div>
        <div class="field">
          <label class="field__label" for="sa-password">${esc(t('sa.newPassword'))}</label>
          <input class="input" id="sa-password" type="password" autocomplete="new-password"
                 placeholder="${esc(t('sa.passwordOptional'))}">
          <span class="field__hint">${esc(t('sa.passwordHint'))}</span>
        </div>
        <div class="field" data-current-pw-wrap hidden>
          <label class="field__label" for="sa-current-password">${esc(t('sa.currentPassword'))}</label>
          <input class="input" id="sa-current-password" type="password" autocomplete="current-password">
        </div>
        <div class="field__error" data-profile-error role="alert"></div>
        <button class="btn btn--block" type="submit">${esc(t('common.save'))}</button>
      </form>

      <div class="section-title"><span>${esc(t('settings.languageSection'))}</span></div>
      <div class="card card--flat">
        <div class="field">
          <label class="field__label" for="settings-lang">${esc(t('common.chooseLanguage'))}</label>
          ${languageSelectHtml({ id: 'settings-lang', className: 'input lang-select' })}
        </div>
      </div>

      ${installBlock()}

      <button class="btn btn--danger btn--block" data-signout>${icon('logout', { size: 17 })} ${esc(t('settings.signOut'))}</button>
      <p class="list__meta" style="text-align:center">DerteApp</p>
    </div>`);

  const editorHost = main.querySelector('[data-shop-editor]');

  const loadShopEditor = async (shopId) => {
    if (!shopId) {
      editorHost.innerHTML = `<p class="list__meta">${esc(t('sa.selectShopHint'))}</p>`;
      return;
    }
    setActiveShop(shopId);
    editorHost.innerHTML = `<p class="list__meta">${esc(t('common.loading'))}</p>`;
    let payload;
    try {
      payload = await api.shop(shopId);
    } catch (error) {
      editorHost.innerHTML = `<p class="field__error">${esc(error.message)}</p>`;
      return;
    }
    const details = payload.shop;
    const owner = (payload.members ?? []).find((m) => m.role === 'owner') ?? payload.members?.[0];
    const gcal = details.google_calendar ?? {};
    const domainsText = (details.site_domains ?? []).join('\n');

    editorHost.innerHTML = `
      <div class="stack" style="margin-top:12px">
        <div class="row" style="gap:8px;align-items:flex-start">
          ${icon('building', { size: 18 })}
          <div class="grow">
            <strong>${esc(details.name)}</strong>
            <div class="list__meta">${owner ? esc(`${owner.full_name} · ${owner.phone_display || owner.phone || ''}`) : esc(t('sa.noOwner'))}</div>
          </div>
        </div>

        <form class="stack" data-edit-shop novalidate>
          <div class="section-title"><span>${esc(t('sa.generalData'))}</span></div>
          <div class="field">
            <label class="field__label" for="es-name">${esc(t('sa.shopName'))}</label>
            <input class="input" id="es-name" value="${esc(details.name)}" required>
          </div>
          <div class="field">
            <label class="field__label" for="es-address">${esc(t('sa.address'))}</label>
            <input class="input" id="es-address" value="${esc(details.address ?? '')}">
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field__label" for="es-city">${esc(t('sa.city'))}</label>
              <input class="input" id="es-city" value="${esc(details.city ?? '')}">
            </div>
            <div class="field">
              <label class="field__label" for="es-phone">${esc(t('sa.shopPhone'))}</label>
              <input class="input" id="es-phone" type="tel" value="${esc(details.phone ?? '')}">
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="es-whatsapp">${esc(t('sa.whatsapp'))}</label>
            <input class="input" id="es-whatsapp" type="tel" value="${esc(details.whatsapp_phone ?? '')}">
          </div>
          <div class="field">
            <label class="field__label" for="es-email">${esc(t('sa.contactEmail'))}</label>
            <input class="input" id="es-email" type="email" value="${esc(details.email ?? '')}">
          </div>
          <div class="field">
            <label class="field__label" for="es-sales-rep">${esc(t('sa.salesRep'))}</label>
            <select class="input" id="es-sales-rep">${salesRepSelectOptions(details.sales_rep_id ?? '')}</select>
            <span class="field__hint">${esc(t('sa.salesRepHint'))}</span>
          </div>
          <label class="row" style="gap:10px;align-items:center">
            <input type="checkbox" id="es-first-payment" ${details.first_payment_paid ? 'checked' : ''}>
            <span>${esc(t('sa.firstPayment'))}</span>
          </label>
          <p class="list__meta" style="margin:0">${esc(t('sa.firstPaymentHint'))}</p>

          <div class="section-title"><span>${esc(t('sa.ownerPasswordSection'))}</span></div>
          <div class="field">
            <label class="field__label" for="es-owner-password">${esc(t('sa.newOwnerPassword'))}</label>
            <input class="input" id="es-owner-password" type="password" autocomplete="new-password"
                   placeholder="${esc(t('sa.passwordOptional'))}">
            <span class="field__hint">${esc(t('sa.ownerPasswordHint'))}</span>
          </div>

          <div class="section-title"><span>${esc(t('sa.integrations'))}</span></div>
          <div class="field">
            <label class="field__label" for="es-website">${esc(t('sa.hostingerPanelUrl'))}</label>
            <input class="input" id="es-website" type="url" value="${esc(details.website_url ?? details.site_url ?? '')}" placeholder="https://…">
            <span class="field__hint">${esc(t('sa.hostingerPanelHint'))}</span>
          </div>
          <div class="field">
            <label class="field__label" for="es-site">${esc(t('sa.hostingerUrl'))}</label>
            <input class="input" id="es-site" type="url" value="${esc(details.site_url ?? '')}" placeholder="https://…">
          </div>
          <div class="field">
            <label class="field__label" for="es-domains">${esc(t('sa.hostingerDomains'))}</label>
            <textarea class="input" id="es-domains" rows="2" placeholder="midominio.com">${esc(domainsText)}</textarea>
            <span class="field__hint">${esc(t('sa.hostingerDomainsHint'))}</span>
          </div>
          <div class="field">
            <label class="field__label" for="es-retell-key">${esc(t('sa.retellKey'))}</label>
            <input class="input" id="es-retell-key" type="password" autocomplete="off"
                   placeholder="${details.retell_api_key_set ? '•••••••• (configurada)' : 'key_…'}">
            <span class="field__hint">${esc(t('sa.retellKeyHint'))}</span>
          </div>
          <div class="field">
            <label class="field__label" for="es-retell-agent">${esc(t('sa.retellAgent'))}</label>
            <input class="input" id="es-retell-agent" value="${esc(details.retell_agent_id ?? '')}" placeholder="agent_…">
          </div>
          <div class="field">
            <label class="field__label" for="es-retell-did">${esc(t('sa.retellDid'))}</label>
            <input class="input" id="es-retell-did" type="tel" value="${esc(details.retell_did ?? '')}" placeholder="+3491…">
          </div>

          <div class="section-title"><span>${esc(t('sa.zadarmaSection'))}</span></div>
          <p class="list__meta" style="margin:0">${esc(t('sa.zadarmaShopHint'))}</p>
          <div class="field">
            <label class="field__label" for="es-zadarma-key">${esc(t('sa.zadarmaKey'))}</label>
            <input class="input" id="es-zadarma-key" type="password" autocomplete="off"
                   placeholder="${details.zadarma_api_key_set ? '•••••••• (configurada)' : ''}">
            <span class="field__hint">${esc(t('sa.zadarmaKeyHint'))}</span>
          </div>
          <div class="field">
            <label class="field__label" for="es-zadarma-secret">${esc(t('sa.zadarmaSecret'))}</label>
            <input class="input" id="es-zadarma-secret" type="password" autocomplete="off"
                   placeholder="${details.zadarma_api_secret_set ? '•••••••• (configurada)' : ''}">
            <span class="field__hint">${esc(t('sa.zadarmaSecretHint'))}</span>
          </div>
          <div class="field">
            <label class="field__label" for="es-zadarma-sip">${esc(t('sa.zadarmaSip'))}</label>
            <input class="input" id="es-zadarma-sip" value="${esc(details.zadarma_sip ?? '')}"
                   placeholder="100 o sip:100@pbx.zadarma.com" maxlength="120">
          </div>
          <div class="field">
            <label class="field__label" for="es-zadarma-did">${esc(t('sa.zadarmaDid'))}</label>
            <input class="input" id="es-zadarma-did" type="tel" value="${esc(details.zadarma_did ?? '')}" placeholder="+3491…">
          </div>

          <div class="field__error" data-edit-error role="alert"></div>
          <button class="btn btn--block" type="submit">${esc(t('sa.saveShop'))}</button>
        </form>

        ${googleCalendarBlock(gcal)}
      </div>`;

    editorHost.querySelector('[data-edit-shop]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const errorBox = form.querySelector('[data-edit-error]');
      const button = form.querySelector('button[type="submit"]');
      errorBox.textContent = '';
      button.disabled = true;
      const value = (id) => form.querySelector(id)?.value.trim() ?? '';
      try {
        const domains = value('#es-domains')
          .split(/[\n,]+/)
          .map((line) => line.trim())
          .filter(Boolean);
        const websiteUrl = value('#es-website') || null;
        const siteUrl = value('#es-site') || websiteUrl;
        const payload = {
          name: value('#es-name'),
          address: value('#es-address') || null,
          city: value('#es-city') || null,
          phone: value('#es-phone') || null,
          whatsapp_phone: value('#es-whatsapp') || null,
          email: value('#es-email') || null,
          website_url: websiteUrl,
          site_url: siteUrl,
          site_domains: domains,
          retell_agent_id: value('#es-retell-agent') || null,
          retell_did: value('#es-retell-did') || null,
          zadarma_sip: value('#es-zadarma-sip') || null,
          zadarma_did: value('#es-zadarma-did') || null,
          did_zadarma: value('#es-zadarma-did') || null,
          sales_rep_id: value('#es-sales-rep') || null,
          first_payment_paid: Boolean(form.querySelector('#es-first-payment')?.checked),
        };
        const retellKey = value('#es-retell-key');
        if (retellKey) payload.retell_api_key = retellKey;
        const zadarmaKey = value('#es-zadarma-key');
        const zadarmaSecret = value('#es-zadarma-secret');
        if (zadarmaKey) payload.zadarma_api_key = zadarmaKey;
        if (zadarmaSecret) payload.zadarma_api_secret = zadarmaSecret;

        await api.updateShop(shopId, payload);

        const ownerPassword = value('#es-owner-password');
        if (ownerPassword) {
          await api.setOwnerPassword(shopId, ownerPassword);
        }

        await loadSession();
        toast(t('sa.shopSaved'), 'ok');
        await loadShopEditor(shopId);
      } catch (error) {
        errorBox.textContent = error.message;
        button.disabled = false;
      }
    });

    bindGoogleCalendarHandlers(editorHost, shopId, () => loadShopEditor(shopId));
  };

  main.querySelector('#sa-shop-select')?.addEventListener('change', async (event) => {
    await loadShopEditor(event.target.value);
  });

  if (selectedId) await loadShopEditor(selectedId);

  main.querySelector('[data-create-shop]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = form.querySelector('[data-create-error]');
    const button = form.querySelector('button[type="submit"]');
    errorBox.textContent = '';
    button.disabled = true;
    const value = (id) => form.querySelector(id)?.value.trim() ?? '';
    try {
      const websiteUrl = value('#ns-website') || undefined;
      const created = await api.adminCreateUser({
        shop_name: value('#ns-name'),
        phone: value('#ns-phone'),
        address: value('#ns-address') || undefined,
        city: value('#ns-city') || undefined,
        website_url: websiteUrl,
        site_url: websiteUrl,
        full_name: value('#ns-owner-name'),
        email: value('#ns-owner-email'),
        password: value('#ns-owner-password'),
        create_shop: true,
        sales_rep_id: value('#ns-sales-rep') || null,
      });
      await loadSession();
      setActiveShop(created.shop.id);
      toast(t('sa.shopCreated'), 'ok');
      navigate('/settings');
    } catch (error) {
      const message = error?.message || t('common.error');
      errorBox.textContent = message;
      toast(message, 'error');
      button.disabled = false;
    }
  });

  const profileForm = main.querySelector('[data-sa-profile]');
  const passwordInput = profileForm?.querySelector('#sa-password');
  const currentWrap = profileForm?.querySelector('[data-current-pw-wrap]');
  passwordInput?.addEventListener('input', () => {
    const needsCurrent = Boolean(passwordInput.value.trim());
    currentWrap.hidden = !needsCurrent;
  });

  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = profileForm.querySelector('[data-profile-error]');
    const button = profileForm.querySelector('button[type="submit"]');
    errorBox.textContent = '';
    button.disabled = true;
    try {
      await api.updateProfile({
        full_name: profileForm.querySelector('#sa-name').value.trim(),
        email: profileForm.querySelector('#sa-email').value.trim() || null,
        phone: profileForm.querySelector('#sa-phone').value.trim(),
      });
      const newPassword = profileForm.querySelector('#sa-password').value;
      if (newPassword.trim()) {
        const session = await api.changePassword({
          current_password: profileForm.querySelector('#sa-current-password').value,
          new_password: newPassword,
        });
        if (session?.token) setToken(session.token);
      }
      await loadSession();
      toast(t('sa.profileSaved'), 'ok');
      navigate('/settings');
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  });

  main.querySelector('#settings-lang')?.addEventListener('change', async (event) => {
    await applyLanguage(event.target.value);
  });
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
  main.querySelector('[data-signout]')?.addEventListener('click', async () => {
    const confirmed = await confirmSheet({
      title: t('settings.signOutConfirm'),
      message: t('settings.signOutBody'),
      confirmLabel: t('settings.signOut'),
      danger: true,
    });
    if (!confirmed) return;
    await signOut();
    navigate('/login', { replace: true });
  });

  return undefined;
}

/** Toast + clear `?google=` query after OAuth redirect (optionally with import counts). */
function consumeGoogleOAuthQuery(query, cleanPath) {
  if (query?.get('google') === 'connected') {
    const fetched = Number(query.get('fetched') || 0);
    const created = Number(query.get('created') || 0);
    const updated = Number(query.get('updated') || 0);
    if (fetched > 0 || created > 0 || updated > 0) {
      toast(t('gcal.connectedImported', { fetched, created, updated }), 'ok');
    } else {
      toast(t('gcal.connectedToast'), 'ok');
    }
    history.replaceState(null, '', cleanPath);
    return true;
  }
  if (query?.get('google') === 'error') {
    toast(t('gcal.errorToast'), 'error');
    history.replaceState(null, '', cleanPath);
    return true;
  }
  return false;
}

function bindGoogleCalendarHandlers(root, shopId, onDone) {
  root.querySelector('[data-gcal-connect]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { url } = await api.googleCalendarConnect(shopId);
      window.location.href = url;
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  });

  root.querySelector('[data-gcal-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const gcalForm = event.currentTarget;
    const errorBox = gcalForm.querySelector('[data-gcal-error]');
    const button = gcalForm.querySelector('button[type="submit"]');
    errorBox.textContent = '';
    button.disabled = true;
    try {
      await api.saveGoogleCalendar(shopId, {
        calendar_id: gcalForm.querySelector('#gcal-id').value.trim(),
        sync_enabled: gcalForm.querySelector('#gcal-enabled').checked,
      });
      toast(t('gcal.updated'), 'ok');
      await onDone?.();
    } catch (error) {
      errorBox.textContent = error.message;
      button.disabled = false;
    }
  });

  root.querySelector('[data-gcal-sync]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = t('gcal.syncing');
    try {
      const result = await api.syncGoogleCalendar(shopId);
      const sync = result.sync ?? result;
      if (!sync.ok && sync.reason) {
        toast(sync.message || t('gcal.syncFailed'), 'error');
      } else {
        toast(
          t('gcal.syncDone', {
            fetched: sync.fetched || 0,
            created: sync.created || 0,
            updated: sync.updated || 0,
          }),
          'ok',
        );
      }
      await onDone?.();
    } catch (error) {
      toast(error.message || t('gcal.syncFailed'), 'error');
    } finally {
      button.disabled = false;
      button.textContent = previous || t('gcal.syncNow');
    }
  });

  root.querySelector('[data-gcal-disconnect]')?.addEventListener('click', async () => {
    const confirmed = await confirmSheet({
      title: t('gcal.disconnectConfirm'),
      message: t('gcal.disconnectBody'),
      confirmLabel: t('gcal.disconnect'),
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.disconnectGoogleCalendar(shopId);
      toast(t('gcal.disconnected'), 'ok');
      await onDone?.();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
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
  const isAdmin = store.isSuperAdmin;
  screen({
    title: 'Tus datos',
    back: '/settings',
    nav: 'more',
    content: `
      <form class="stack" novalidate>
        ${
          isAdmin
            ? `<div class="field">
                 <label class="field__label" for="pf-phone">Teléfono (soporte global)</label>
                 <input class="input" id="pf-phone" type="tel" value="${esc(store.user.phone)}" required
                        placeholder="+34605686509">
                 <span class="field__hint">Este número es el que ven los talleres en Soporte (WhatsApp / llamada).</span>
               </div>`
            : `<div class="card card--flat">
                 <div class="card__label">Teléfono (tu acceso)</div>
                 <div style="font-weight:650;font-size:17px;font-variant-numeric:tabular-nums">${esc(store.user.phone)}</div>
                 <div class="list__meta" style="margin-top:4px">
                   Para cambiarlo, escribe al soporte de DerteApp desde la pestaña Soporte.
                 </div>
               </div>`
        }
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
        ...(isAdmin ? { phone: form.querySelector('#pf-phone').value.trim() } : {}),
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
      ? `${t('common.active')} · ${gcal.connected_email}`
      : t('gcal.synced')
    : gcal?.configured
      ? t('gcal.unlinked')
      : t('gcal.pendingServer');

  const connectButton = gcal?.oauth_configured
    ? `<button type="button" class="btn btn--block" data-gcal-connect>
         ${connected ? t('gcal.reconnect') : t('gcal.connect')}
       </button>`
    : '';

  const saHint = gcal?.service_account_configured
    ? `<span class="field__hint">
         Comparte tu calendario con <strong>${esc(gcal.service_account_email)}</strong>
         (permiso «Hacer cambios en eventos») e introduce el Calendar ID abajo.
       </span>`
    : '';

  return `
    <div class="section-title"><span>${esc(t('gcal.title'))}</span></div>
    <div class="card ${connected ? 'card--accent' : 'card--flat'}" data-gcal>
      <div class="row" style="gap:8px">
        ${icon('calendar', { size: 18 })}
        <div class="grow">
          <strong>${connected ? esc(t('gcal.synced')) : esc(t('gcal.link'))}</strong>
          <div class="list__meta" style="margin-top:2px">${esc(statusLabel)}</div>
          <div class="list__meta" style="margin-top:6px">${esc(t('gcal.hint'))}</div>
        </div>
      </div>
      ${
        gcal?.configured || gcal?.oauth_configured
          ? `<div style="height:14px"></div>
             ${connectButton}
             <form class="stack" data-gcal-form style="margin-top:12px" novalidate>
               <div class="field">
                 <label class="field__label" for="gcal-id">${esc(t('gcal.calendarId'))}</label>
                 <input class="input" id="gcal-id" value="${esc(gcal.calendar_id ?? '')}"
                        placeholder="primary o correo@gmail.com" autocomplete="off">
                 ${saHint}
               </div>
               <label class="row" style="gap:10px;align-items:center">
                 <input type="checkbox" id="gcal-enabled" ${gcal.sync_enabled ? 'checked' : ''}>
                 <span>${esc(t('gcal.syncToggle'))}</span>
               </label>
               <div class="field__error" data-gcal-error role="alert"></div>
               <button class="btn btn--block btn--ghost" type="submit">${esc(t('gcal.saveId'))}</button>
             </form>
             ${
               connected
                 ? `<button type="button" class="btn btn--block" data-gcal-sync style="margin-top:8px">
                      ${esc(t('gcal.syncNow'))}
                    </button>`
                 : ''
             }
             ${
               connected || gcal.connected_email || gcal.sync_enabled
                 ? `<button type="button" class="btn btn--block btn--danger" data-gcal-disconnect style="margin-top:8px">
                      ${esc(t('gcal.disconnect'))}
                    </button>`
                 : ''
             }`
          : `<div class="list__meta" style="margin-top:12px">${esc(t('gcal.serverHint'))}</div>`
      }
    </div>`;
}

export async function shopSettingsView({ query } = {}) {
  const shop = requireShop({ title: 'Datos del taller', navKey: 'more' });
  if (!shop) return undefined;

  consumeGoogleOAuthQuery(query, '/settings/shop');

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
                 <label class="field__label" for="sh-zadarma-key">${esc(t('sa.zadarmaKey'))}</label>
                 <input class="input" id="sh-zadarma-key" type="password" autocomplete="off"
                        placeholder="${details.zadarma_api_key_set ? '•••••••• (configurada)' : ''}">
                 <span class="field__hint">${esc(t('sa.zadarmaKeyHint'))}</span>
               </div>
               <div class="field">
                 <label class="field__label" for="sh-zadarma-secret">${esc(t('sa.zadarmaSecret'))}</label>
                 <input class="input" id="sh-zadarma-secret" type="password" autocomplete="off"
                        placeholder="${details.zadarma_api_secret_set ? '•••••••• (configurada)' : ''}">
                 <span class="field__hint">${esc(t('sa.zadarmaSecretHint'))}</span>
               </div>
               <div class="field">
                 <label class="field__label" for="sh-zadarma-sip">${esc(t('sa.zadarmaSip'))}</label>
                 <input class="input" id="sh-zadarma-sip" value="${esc(details.zadarma_sip ?? '')}">
               </div>
               <div class="field">
                 <label class="field__label" for="sh-zadarma-did">${esc(t('sa.zadarmaDid'))}</label>
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
              did_zadarma: value('#sh-zadarma-did') || null,
              ...(value('#sh-zadarma-key') ? { zadarma_api_key: value('#sh-zadarma-key') } : {}),
              ...(value('#sh-zadarma-secret')
                ? { zadarma_api_secret: value('#sh-zadarma-secret') }
                : {}),
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

  bindGoogleCalendarHandlers(main, shop.id, () => navigate('/settings/shop'));

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

export { telephonyView } from './telephony.js';

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
