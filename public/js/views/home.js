/**
 * Inicio del taller — vista minimalista.
 * Logo + "TODO EN UNO", nombre del taller, y un solo contador:
 * trabajos realizados hoy.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { loadSession, refreshBadges, setActiveShop, store } from '../store.js';
import { requireShop, screen, setContent } from '../shell.js';
import { esc, num } from '../ui.js';

/** Prefer active shop; falls back to first accessible shop. */
function resolveCurrentShop() {
  // store.currentShop is an alias of activeShop (see store.js).
  return store.currentShop || store.activeShop || store.shops?.[0] || null;
}

function renderHome({ shopName, jobsToday }) {
  setContent(`
    <div class="home-minimal" data-dashboard-home="minimal">
      <header class="home-minimal__hero">
        <div class="home-minimal__brand">
          <img class="home-minimal__logo" src="/icons/logo.svg" alt="DerteApp">
          <span class="home-minimal__todo">TODO EN UNO</span>
        </div>
        <p class="home-minimal__shop${shopName ? '' : ' home-minimal__shop--muted'}">
          ${esc(shopName || t('home.noShopTitle'))}
        </p>
      </header>

      <section class="home-minimal__metric" aria-live="polite">
        <div class="home-minimal__card">
          <div class="home-minimal__value">${num(jobsToday)}</div>
          <div class="home-minimal__label">${esc(t('home.jobsDoneToday'))}</div>
        </div>
      </section>
    </div>`);

  // Brand + shop live in content; keep shell title for a11y only.
  const title = document.querySelector('.header__title');
  if (title) {
    title.innerHTML = `<span class="sr-only">${esc(shopName || 'TODO EN UNO')}</span>`;
  }
}

async function fetchJobsCompletedToday(shopId) {
  if (!shopId) return 0;
  try {
    // Only the overview stats endpoint — no yearly history / board / quick-link APIs.
    const overview = await api.overview(shopId);
    return Number(overview?.stats?.completed_today ?? 0) || 0;
  } catch {
    return 0;
  }
}

export async function homeView() {
  try {
    if (!store.user?.id && !store.user?.uid) await loadSession();
  } catch {
    // Soft empty UI below.
  }

  let shop = resolveCurrentShop();
  if (!shop && store.shops?.[0]) {
    setActiveShop(store.shops[0].id);
    shop = resolveCurrentShop();
  }

  if (!store.user?.id && !store.user?.uid) {
    screen({ title: 'TODO EN UNO', nav: 'home', content: '' });
    renderHome({ shopName: '', jobsToday: 0 });
    return undefined;
  }

  shop = requireShop({ title: 'TODO EN UNO', navKey: 'home' }) || resolveCurrentShop();
  if (!shop) return undefined;

  const shopName = shop.name || store.currentShop?.name || '';

  screen({
    title: shopName,
    nav: 'home',
    shopSwitcher: true,
    content: '',
  });
  renderHome({ shopName, jobsToday: 0 });

  let loading = false;
  const load = async () => {
    if (loading) return;
    loading = true;
    const jobsToday = await fetchJobsCompletedToday(shop.id);
    loading = false;
    const name = resolveCurrentShop()?.name || shopName;
    renderHome({ shopName: name, jobsToday });
  };

  await load();
  await refreshBadges();

  const timer = setInterval(() => {
    if (document.visibilityState === 'visible') void load();
  }, 60_000);

  return () => clearInterval(timer);
}
