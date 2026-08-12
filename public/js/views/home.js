/**
 * Shop owner home — minimal dashboard.
 * Header brand (logo + derteapp) lives in the shell; the body centres
 * TODO EN UNO + shop name, the jobs-today card, and an interactive logo menu.
 */
import { api, stream } from '../api.js';
import { canCancelAppointment } from '../booking-lifecycle.js';
import { t } from '../i18n.js';
import { navigate } from '../router.js';
import { refreshBadges, store, loadSession, setActiveShop } from '../store.js';
import { requireShop, screen, setContent, contentArea } from '../shell.js';
import { openNewBookingSheet } from './appointments.js';
import {
  confirmSheet,
  emptyState,
  esc,
  num,
  sheet,
  statusBadge,
  timeOf,
  toast,
} from '../ui.js';

function ensureHeaderBrand() {
  const brand = document.querySelector('.header__brand');
  if (!brand) return;
  brand.innerHTML = `
    <img class="header__logo" src="/icons/logo-mark.svg" alt="" width="28" height="28">
    <span class="header__wordmark">derteapp</span>`;
  brand.classList.remove('header__brand--todo');
}

function paintMinimalHome({ shopName = '', jobsToday = 0, menuOpen = false } = {}) {
  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shopName || t('home.todoEnUno'))}</span>`;
  }
  ensureHeaderBrand();

  return setContent(`
    <div class="home-minimal" data-dashboard-home="minimal">
      <header class="home-minimal__hero">
        <h1 class="home-minimal__todo">${esc(t('home.todoEnUno'))}</h1>
        ${
          shopName
            ? `<p class="home-minimal__shop">${esc(shopName)}</p>`
            : `<p class="home-minimal__shop home-minimal__shop--muted">${esc(t('home.noShopTitle'))}</p>`
        }
      </header>

      <section class="home-minimal__metric" aria-live="polite">
        <div class="home-minimal__card">
          <div class="home-minimal__value">${num(jobsToday)}</div>
          <div class="home-minimal__label">${esc(t('home.jobsDoneToday'))}</div>
        </div>
      </section>

      <section class="home-minimal__launcher" data-home-launcher>
        <button
          type="button"
          class="home-minimal__logo-btn${menuOpen ? ' is-open' : ''}"
          data-home-logo-toggle
          aria-expanded="${menuOpen ? 'true' : 'false'}"
          aria-controls="home-logo-menu"
          aria-label="${esc(t('home.logoMenuAria'))}"
        >
          <img class="home-minimal__logo-mark" src="/icons/logo-mark.svg" alt="" width="96" height="96">
          <span class="home-minimal__logo-hint" aria-hidden="true"></span>
        </button>

        <div
          id="home-logo-menu"
          class="home-minimal__menu${menuOpen ? ' is-open' : ''}"
          data-home-logo-menu
          ${menuOpen ? '' : 'hidden'}
          role="menu"
        >
          <button type="button" class="home-minimal__menu-btn" role="menuitem" data-home-action="today">
            <span class="home-minimal__menu-emoji" aria-hidden="true">📅</span>
            <span>${esc(t('home.menu.today'))}</span>
          </button>
          <button type="button" class="home-minimal__menu-btn" role="menuitem" data-home-action="new">
            <span class="home-minimal__menu-emoji" aria-hidden="true">➕</span>
            <span>${esc(t('home.menu.new'))}</span>
          </button>
          <button type="button" class="home-minimal__menu-btn" role="menuitem" data-home-action="cancel">
            <span class="home-minimal__menu-emoji" aria-hidden="true">❌</span>
            <span>${esc(t('home.menu.cancel'))}</span>
          </button>
          <button type="button" class="home-minimal__menu-btn" role="menuitem" data-home-action="schedule">
            <span class="home-minimal__menu-emoji" aria-hidden="true">🕒</span>
            <span>${esc(t('home.menu.schedule'))}</span>
          </button>
        </div>
      </section>
    </div>`);
}

async function openCancelBookingsSheet(shop) {
  sheet({
    title: t('home.menu.cancel'),
    body: `<div class="stack" data-cancel-sheet>${emptyState(t('common.loading'), '')}</div>`,
    onMount(content) {
      const box = content.querySelector('[data-cancel-sheet]');
      void (async () => {
        let rows = [];
        try {
          const result = await api.appointments({ shop_id: shop.id, limit: 80 });
          rows = (Array.isArray(result?.appointments) ? result.appointments : []).filter((item) =>
            canCancelAppointment(item),
          );
        } catch (error) {
          console.error('[home] cancel list failed', error);
          box.innerHTML = emptyState(t('home.loadError'), '');
          return;
        }

        if (!rows.length) {
          box.innerHTML = emptyState(t('home.cancelEmptyTitle'), t('home.cancelEmptyBody'));
          return;
        }

        box.innerHTML = `
          <div class="list">
            ${rows
              .map((appointment) => {
                const when = timeOf(appointment.scheduled_at, appointment.timezone);
                return `
                  <div class="list__item list__item--static" style="flex-direction:column;align-items:stretch;gap:10px">
                    <div class="row row--between" style="gap:8px">
                      <span class="list__title truncate">${esc(appointment.customer_name)}</span>
                      ${statusBadge(appointment.status)}
                    </div>
                    <div class="list__meta truncate">${esc(appointment.scheduled_local || when || '')}</div>
                    <button class="btn btn--small btn--danger" type="button" data-cancel-id="${esc(appointment.id)}">
                      ${esc(t('appointments.cancelBooking'))}
                    </button>
                  </div>`;
              })
              .join('')}
          </div>`;

        box.addEventListener('click', async (event) => {
          const button = event.target.closest('[data-cancel-id]');
          if (!button) return;
          const appointmentId = button.dataset.cancelId;
          const outcome = await confirmSheet({
            title: t('appointments.cancelBooking'),
            message: t('appointments.cancelConfirm'),
            confirmLabel: t('appointments.cancelBooking'),
            danger: true,
          });
          if (!outcome) return;
          button.disabled = true;
          try {
            await api.setAppointmentStatus(appointmentId, { shop_id: shop.id, status: 'cancelled' });
            toast(t('appointments.cancelToast'), 'ok');
            await refreshBadges();
            button.closest('.list__item')?.remove();
            if (!box.querySelector('[data-cancel-id]')) {
              box.innerHTML = emptyState(t('home.cancelEmptyTitle'), t('home.cancelEmptyBody'));
            }
          } catch (error) {
            console.error('[home] cancel failed', error);
            toast('No se pudo cancelar ahora', 'danger');
            button.disabled = false;
          }
        });
      })();
    },
  });
}

function bindHomeActions(shop) {
  const main = contentArea();
  if (!main || main.dataset.homeActionsBound === '1') return;
  main.dataset.homeActionsBound = '1';

  main.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-home-logo-toggle]');
    if (toggle) {
      const launcher = toggle.closest('[data-home-launcher]');
      const menu = launcher?.querySelector('[data-home-logo-menu]');
      if (!menu) return;
      const open = !menu.classList.contains('is-open');
      menu.classList.toggle('is-open', open);
      menu.hidden = !open;
      toggle.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }

    const action = event.target.closest('[data-home-action]');
    if (!action) return;
    const kind = action.dataset.homeAction;
    if (kind === 'today') {
      navigate('/appointments?filter=today');
      return;
    }
    if (kind === 'new') {
      if (shop) openNewBookingSheet(shop, () => void refreshBadges());
      return;
    }
    if (kind === 'cancel') {
      if (shop) openCancelBookingsSheet(shop);
      return;
    }
    if (kind === 'schedule') {
      navigate('/schedule');
    }
  });
}

export async function homeView() {
  if (!store.user?.id && !store.user?.uid) {
    try {
      await loadSession();
    } catch {
      // soft shell below
    }
  }

  let shop = store.activeShop;
  if (!shop) {
    try {
      await loadSession();
      shop = store.activeShop;
      if (!shop && store.shops?.[0]) {
        setActiveShop(store.shops[0].id);
        shop = store.activeShop;
      }
    } catch {
      // fall through
    }
  }

  if (!store.user?.id && !store.user?.uid) {
    screen({
      title: t('home.todoEnUno'),
      nav: 'home',
      shopSwitcher: false,
      content: '',
    });
    paintMinimalHome({ shopName: '', jobsToday: 0 });
    return undefined;
  }

  shop = requireShop({ title: t('home.todoEnUno'), navKey: 'home' });
  if (!shop) return undefined;

  let loading = false;
  let menuOpen = false;

  screen({
    title: shop.name,
    subtitle: '',
    nav: 'home',
    shopSwitcher: true,
    content: `
      <div class="home-minimal" data-dashboard-home="minimal">
        <header class="home-minimal__hero">
          <h1 class="home-minimal__todo">${esc(t('home.todoEnUno'))}</h1>
          <p class="home-minimal__shop">${esc(shop.name)}</p>
        </header>
        <section class="home-minimal__metric">
          <div class="home-minimal__card">
            <div class="home-minimal__value">…</div>
            <div class="home-minimal__label">${esc(t('home.jobsDoneToday'))}</div>
          </div>
        </section>
      </div>`,
  });

  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shop.name)}</span>`;
  }
  ensureHeaderBrand();
  bindHomeActions(shop);

  async function load() {
    if (loading) return;
    loading = true;
    let jobsToday = 0;
    try {
      const overview = await api.overview(shop.id);
      jobsToday = Number(overview?.stats?.completed_today ?? 0) || 0;
    } catch {
      jobsToday = 0;
    } finally {
      loading = false;
    }
    const menu = contentArea()?.querySelector('[data-home-logo-menu]');
    menuOpen = Boolean(menu?.classList.contains('is-open'));
    paintMinimalHome({ shopName: shop.name, jobsToday, menuOpen });
  }

  await load();
  await refreshBadges();

  const stopStream = stream(`/chat/stream?shop_id=${shop.id}`, {
    appointment_created: () => {
      void load();
      void refreshBadges();
    },
    appointment_updated: () => void load(),
    urgencia_created: () => void refreshBadges(),
    chat_message: () => void refreshBadges(),
    call_event: () => void load(),
  });

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      void load();
      void refreshBadges();
    }
  }, 60_000);

  return () => {
    stopStream();
    clearInterval(timer);
    const main = contentArea();
    if (main) delete main.dataset.homeActionsBound;
  };
}
