/**
 * Shop-owner "Web" tab: embeds the Hostinger panel / site URL configured by
 * the Super Admin. Falls back to an external open when framing is blocked.
 */
import { api } from '../api.js';
import { t } from '../i18n.js';
import { requireShop, screen, setContent } from '../shell.js';
import { emptyState, esc, icon, skeletonList } from '../ui.js';

function resolveWebsiteUrl(shop) {
  const raw = (shop?.website_url || shop?.site_url || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function webPanelView() {
  const shop = requireShop({ title: t('web.title'), navKey: 'web' });
  if (!shop) return undefined;

  screen({
    title: t('web.title'),
    nav: 'web',
    flush: true,
    shopSwitcher: true,
    content: skeletonList(2),
  });

  let details = shop;
  try {
    details = (await api.shop(shop.id)).shop;
  } catch (error) {
    setContent(emptyState(t('web.loadError'), error.message, 'x'));
    return undefined;
  }

  const url = resolveWebsiteUrl(details);

  if (!url) {
    setContent(`
      <div class="web-panel web-panel--empty">
        <div class="empty">
          ${icon('globe', { size: 32 })}
          <div class="empty__title">${esc(t('web.emptyTitle'))}</div>
          <div>${esc(t('web.emptyBody'))}</div>
        </div>
      </div>`);
    return undefined;
  }

  const hostLabel = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  setContent(`
    <div class="web-panel">
      <div class="web-panel__toolbar">
        <div class="web-panel__meta truncate" title="${esc(url)}">
          ${icon('globe', { size: 16 })}
          <span>${esc(hostLabel)}</span>
        </div>
        <a class="btn btn--small btn--ghost" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-native="true">
          ${icon('link', { size: 15 })}
          ${esc(t('web.openExternal'))}
        </a>
      </div>
      <div class="web-panel__frame-wrap">
        <iframe
          class="web-panel__frame"
          title="${esc(t('web.iframeTitle'))}"
          src="${esc(url)}"
          referrerpolicy="no-referrer"
          loading="lazy"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        ></iframe>
        <p class="web-panel__hint">${esc(t('web.frameHint'))}</p>
      </div>
    </div>`);

  return undefined;
}
