/**
 * Shop owner home — minimal dashboard.
 * Brand (logo + TODO EN UNO) + shop name + one counter: trabajos realizados hoy.
 */
import { api, stream } from '../api.js';
import { t } from '../i18n.js';
import { refreshBadges, store, loadSession, setActiveShop } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { esc, num } from '../ui.js';

function paintMinimalHome({ shopName = '', jobsToday = 0 } = {}) {
  // Hide the default shell title row; brand + shop live in the content.
  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shopName || t('home.todoEnUno'))}</span>`;
  }
  const brand = document.querySelector('.header__brand');
  if (brand) {
    brand.innerHTML = `<img class="header__logo" src="/icons/logo-mark.svg" alt="" width="28" height="28">`;
    brand.classList.remove('header__brand--todo');
  }

  return setContent(`
    <div class="home-minimal" data-dashboard-home="minimal">
      <header class="home-minimal__hero">
        <div class="home-minimal__brand">
          <img class="home-minimal__logo" src="/icons/logo.svg" alt="derteapp">
          <span class="home-minimal__todo">${esc(t('home.todoEnUno'))}</span>
        </div>
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
    </div>`);
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

  screen({
    title: shop.name,
    subtitle: '',
    nav: 'home',
    shopSwitcher: true,
    content: `
      <div class="home-minimal" data-dashboard-home="minimal">
        <header class="home-minimal__hero">
          <div class="home-minimal__brand">
            <img class="home-minimal__logo" src="/icons/logo.svg" alt="derteapp">
            <span class="home-minimal__todo">${esc(t('home.todoEnUno'))}</span>
          </div>
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

  // Collapse default title after first paint (shop name is in hero).
  const headerTitle = document.querySelector('.header__title');
  if (headerTitle) {
    headerTitle.innerHTML = `<span class="sr-only">${esc(shop.name)}</span>`;
  }

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
    paintMinimalHome({ shopName: shop.name, jobsToday });
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
  };
}
