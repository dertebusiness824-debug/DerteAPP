/**
 * Super Admin screens: the master dashboard across all client sites, the shop
 * directory with its switcher, the central support inbox and the global call log.
 */
import { api } from '../api.js';
import { navigate } from '../router.js';
import { refreshBadges, setActiveShop, store } from '../store.js';
import { screen, setContent } from '../shell.js';
import {
  ago,
  barChart,
  confirmSheet,
  contactButtons,
  dateTimeOf,
  duration,
  emptyState,
  esc,
  icon,
  num,
  sheet,
  skeletonList,
  toast,
} from '../ui.js';

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const rangeTabs = (days) => `
  <div class="segmented" role="tablist">
    ${RANGES.map(
      (range) =>
        `<button role="tab" data-days="${range.days}" aria-pressed="${range.days === days}">${esc(range.label)}</button>`,
    ).join('')}
  </div>`;

const bindRangeTabs = (main, basePath) => {
  for (const tab of main.querySelectorAll('[data-days]')) {
    tab.addEventListener('click', () => navigate(`${basePath}?days=${tab.dataset.days}`));
  }
};

// --- Master dashboard --------------------------------------------------------

export async function adminOverviewView({ query }) {
  const days = Number(query.get('days')) || 30;

  screen({
    title: 'All shops',
    subtitle: `${store.shops.length} sites`,
    nav: 'admin',
    actions: `<button class="btn btn--icon" data-broadcast aria-label="Message every shop">${icon('megaphone', { size: 18 })}</button>`,
    content: skeletonList(5),
  });

  let data;
  try {
    data = await api.adminOverview(days);
  } catch (error) {
    setContent(emptyState('Could not load the dashboard', error.message, 'x'));
    return undefined;
  }

  const totals = data.totals;
  const calls = data.calls;
  const answerRate = calls.total ? Math.round((calls.answered / calls.total) * 100) : 0;

  const main = setContent(`
    <div class="stack">
      ${rangeTabs(days)}

      ${
        totals.pending_bookings > 0 || totals.support_unread > 0
          ? `<div class="banner">
               ${icon('bell', { size: 18 })}
               <div>
                 <strong>${num(totals.pending_bookings)} booking${totals.pending_bookings === 1 ? '' : 's'}</strong>
                 waiting for a shop reply · <strong>${num(totals.support_unread)}</strong> unread support message${totals.support_unread === 1 ? '' : 's'}
               </div>
             </div>`
          : ''
      }

      <div class="stats">
        <div class="stat">
          <div class="stat__value">${num(totals.active_shops)}</div>
          <div class="stat__label">Active sites</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(totals.bookings)}</div>
          <div class="stat__label">Bookings</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(totals.visitors)}</div>
          <div class="stat__label">Website visitors</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(calls.total)}</div>
          <div class="stat__label">Calls · ${answerRate}% answered</div>
        </div>
      </div>

      <div class="card">
        <div class="section-title"><span>Bookings per day</span><span class="muted">${num(totals.bookings)} total</span></div>
        ${
          data.timeline.length
            ? barChart(data.timeline.map((point) => ({ label: point.day, value: point.bookings })))
            : '<p class="muted">No bookings in this period yet.</p>'
        }
      </div>

      ${
        data.alerts.length
          ? `<div class="card">
               <div class="section-title"><span>Needs attention</span></div>
               <div class="list list--plain">
                 ${data.alerts
                   .map(
                     (alert) => `
                       <button class="list__item" data-shop-jump="${esc(alert.id)}">
                         <div class="grow">
                           <div class="list__title truncate">${esc(alert.name)}</div>
                           <div class="list__meta">${num(alert.stale_pending)} request${alert.stale_pending === 1 ? '' : 's'} unanswered for over 6 h</div>
                         </div>
                         ${icon('chevron', { size: 16 })}
                       </button>`,
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      <div class="section-title"><span>Per shop</span><span class="muted">last ${days} days</span></div>
      <div class="list">
        ${
          data.shops.length
            ? data.shops
                .map(
                  (shop) => `
                    <button class="list__item" data-shop-jump="${esc(shop.id)}">
                      <div class="grow">
                        <div class="row row--between" style="gap:8px">
                          <span class="list__title truncate">${esc(shop.name)}</span>
                          ${shop.pending > 0 ? `<span class="badge badge--warn">${num(shop.pending)} waiting</span>` : ''}
                        </div>
                        <div class="list__meta">
                          ${num(shop.bookings)} bookings · ${num(shop.visitors)} visitors · ${num(shop.calls)} calls${
                            shop.missed_calls > 0 ? ` · ${num(shop.missed_calls)} missed` : ''
                          }
                        </div>
                        <div class="list__meta">${esc(shop.owner_name ?? 'No owner linked')}${
                          shop.owner_phone_display ? ` · ${esc(shop.owner_phone_display)}` : ''
                        }</div>
                      </div>
                      ${icon('chevron', { size: 16 })}
                    </button>`,
                )
                .join('')
            : '<div class="list__item list__item--static">No shops yet</div>'
        }
      </div>
    </div>`);

  bindRangeTabs(main, '/admin');

  for (const button of main.querySelectorAll('[data-shop-jump]')) {
    button.addEventListener('click', () => openShopActions(button.dataset.shopJump));
  }

  document.querySelector('[data-broadcast]')?.addEventListener('click', openBroadcastSheet);
  return undefined;
}

/** What a Super Admin can do with one tenant, from anywhere in the dashboard. */
function openShopActions(shopId) {
  const shop = store.shops.find((entry) => entry.id === shopId);
  sheet({
    title: shop?.name ?? 'Shop',
    body: `
      <div class="stack">
        <button class="btn btn--block" data-act="work">${icon('inspect', { size: 17 })}Open this shop's dashboard</button>
        <button class="btn btn--soft btn--block" data-act="support">${icon('chat', { size: 17 })}Support chat</button>
        <button class="btn btn--soft btn--block" data-act="detail">${icon('building', { size: 17 })}Shop details</button>
      </div>`,
    onMount(content, close) {
      content.querySelector('[data-act="work"]').addEventListener('click', async () => {
        setActiveShop(shopId);
        close();
        await refreshBadges();
        navigate('/');
      });
      content.querySelector('[data-act="support"]').addEventListener('click', async () => {
        close();
        try {
          const { thread } = await api.adminSupportThread(shopId);
          navigate(`/chat/${thread.id}`);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
      content.querySelector('[data-act="detail"]').addEventListener('click', () => {
        setActiveShop(shopId);
        close();
        navigate('/settings/shop');
      });
    },
  });
}

function openBroadcastSheet() {
  sheet({
    title: 'Message every shop',
    body: `
      <form class="stack" data-form>
        <p class="muted" style="font-size:14px">
          Sent into each shop's support chat. Owners get it on their phone with your number attached.
        </p>
        <div class="field">
          <label class="field__label" for="broadcast-body">Message</label>
          <textarea id="broadcast-body" class="input" rows="4" maxlength="2000" required
                    placeholder="Scheduled maintenance tonight from 23:00 to 23:30."></textarea>
        </div>
        <button class="btn btn--block" type="submit">Send to all active shops</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          const result = await api.adminBroadcast({ body: form.querySelector('#broadcast-body').value });
          toast(`Sent to ${result.delivered} shop${result.delivered === 1 ? '' : 's'}`, 'ok');
          close();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    },
  });
}

// --- Shop directory ----------------------------------------------------------

export async function adminShopsView({ query }) {
  const search = query.get('q') ?? '';

  screen({
    title: 'Shops',
    nav: 'shops',
    actions: `<button class="btn btn--icon" data-new-shop aria-label="Add shop">${icon('plus', { size: 18 })}</button>`,
    content: skeletonList(6),
  });

  const render = async () => {
    let data;
    try {
      data = await api.adminShops({ search: search || undefined, limit: 200 });
    } catch (error) {
      setContent(emptyState('Could not load shops', error.message, 'x'));
      return;
    }

    const main = setContent(`
      <div class="stack">
        <div class="field">
          <label class="sr-only" for="shop-search">Search shops</label>
          <input id="shop-search" class="input" type="search" value="${esc(search)}"
                 placeholder="Search by name, site or owner number" autocomplete="off">
        </div>
        <div class="list">
          ${
            data.shops.length
              ? data.shops
                  .map(
                    (shop) => `
                      <div class="list__item list__item--static">
                        <div class="grow">
                          <div class="row row--between" style="gap:8px">
                            <span class="list__title truncate">${esc(shop.name)}</span>
                            ${
                              shop.status === 'active'
                                ? `<span class="badge badge--ok">Active</span>`
                                : `<span class="badge badge--danger">${esc(shop.status)}</span>`
                            }
                          </div>
                          <div class="list__meta">
                            ${esc(shop.owner_name ?? 'No owner')}${shop.owner_phone_display ? ` · ${esc(shop.owner_phone_display)}` : ''}
                          </div>
                          <div class="list__meta">
                            ${num(shop.total_bookings)} bookings${shop.pending_bookings > 0 ? ` · ${num(shop.pending_bookings)} waiting` : ''}
                            · ${esc(shop.timezone)}
                          </div>
                          ${
                            shop.site_url
                              ? `<div class="list__meta truncate"><a href="${esc(shop.site_url)}" target="_blank" rel="noopener" data-native="true">${esc(
                                  shop.site_url.replace(/^https?:\/\//, ''),
                                )}</a></div>`
                              : ''
                          }
                          ${contactButtons({
                            telLink: shop.owner_tel_link,
                            whatsappLink: shop.owner_whatsapp_link,
                            phoneDisplay: shop.owner_phone_display,
                            compact: true,
                          })}
                          <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">
                            <button class="btn btn--small" data-open="${esc(shop.id)}">Open dashboard</button>
                            <button class="btn btn--small btn--soft" data-support="${esc(shop.id)}">Support chat</button>
                            <button class="btn btn--small btn--soft" data-status="${esc(shop.id)}"
                                    data-current="${esc(shop.status)}" data-name="${esc(shop.name)}">
                              ${shop.status === 'active' ? 'Suspend' : 'Reactivate'}
                            </button>
                          </div>
                        </div>
                      </div>`,
                  )
                  .join('')
              : emptyState('No shops match', 'Try a different search term.', 'building')
          }
        </div>
      </div>`);

    const input = main.querySelector('#shop-search');
    input.addEventListener('change', () => {
      const value = input.value.trim();
      navigate(value ? `/admin/shops?q=${encodeURIComponent(value)}` : '/admin/shops');
    });

    for (const button of main.querySelectorAll('[data-open]')) {
      button.addEventListener('click', async () => {
        setActiveShop(button.dataset.open);
        await refreshBadges();
        navigate('/');
      });
    }

    for (const button of main.querySelectorAll('[data-support]')) {
      button.addEventListener('click', async () => {
        try {
          const { thread } = await api.adminSupportThread(button.dataset.support);
          navigate(`/chat/${thread.id}`);
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }

    for (const button of main.querySelectorAll('[data-status]')) {
      button.addEventListener('click', async () => {
        const suspending = button.dataset.current === 'active';
        const confirmed = await confirmSheet({
          title: suspending ? `Suspend ${button.dataset.name}?` : `Reactivate ${button.dataset.name}?`,
          message: suspending
            ? 'The shop stops accepting online bookings and the owner cannot sign in to its dashboard.'
            : 'Online bookings and dashboard access are restored.',
          confirmLabel: suspending ? 'Suspend' : 'Reactivate',
          danger: suspending,
        });
        if (!confirmed) return;
        try {
          await api.adminSetShopStatus(button.dataset.status, { status: suspending ? 'suspended' : 'active' });
          toast(suspending ? 'Shop suspended' : 'Shop reactivated', 'ok');
          await render();
        } catch (error) {
          toast(error.message, 'error');
        }
      });
    }
  };

  await render();
  document.querySelector('[data-new-shop]')?.addEventListener('click', () => openNewShopSheet(render));
  return undefined;
}

/** Onboards a new Hostinger site: shop plus its owner account. */
function openNewShopSheet(onSaved) {
  sheet({
    title: 'Add a shop',
    body: `
      <form class="stack" data-form>
        <div class="field">
          <label class="field__label" for="new-shop-name">Shop name</label>
          <input id="new-shop-name" class="input" required maxlength="160" placeholder="Northside Motors">
        </div>
        <div class="field">
          <label class="field__label" for="new-shop-site">Hostinger site URL</label>
          <input id="new-shop-site" class="input" type="url" placeholder="https://northside-motors.com">
        </div>
        <div class="field">
          <label class="field__label" for="new-shop-tz">Timezone</label>
          <input id="new-shop-tz" class="input" value="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}" maxlength="64">
        </div>
        <div class="section-title"><span>Owner</span></div>
        <div class="field">
          <label class="field__label" for="new-owner-name">Full name</label>
          <input id="new-owner-name" class="input" maxlength="120" placeholder="Elena Costa">
        </div>
        <div class="field">
          <label class="field__label" for="new-owner-phone">Phone number (with country code)</label>
          <input id="new-owner-phone" class="input" type="tel" placeholder="+34600333444">
          <span class="field__hint">Becomes their login and the number customers tap to call.</span>
        </div>
        <button class="btn btn--block" type="submit">Create shop</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('[data-form]');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;

        const ownerName = form.querySelector('#new-owner-name').value.trim();
        const ownerPhone = form.querySelector('#new-owner-phone').value.trim();
        const payload = {
          name: form.querySelector('#new-shop-name').value.trim(),
          site_url: form.querySelector('#new-shop-site').value.trim() || null,
          timezone: form.querySelector('#new-shop-tz').value.trim() || null,
          ...(ownerName && ownerPhone ? { owner: { full_name: ownerName, phone: ownerPhone } } : {}),
        };

        try {
          const result = await api.post('/shops', payload);
          close();
          if (result.temporary_password) {
            sheet({
              title: 'Shop created',
              body: `
                <div class="stack">
                  <p class="muted" style="font-size:14px">
                    Share these details with ${esc(result.owner?.full_name ?? 'the owner')}. They can change the
                    password from their profile.
                  </p>
                  <div class="kv"><span>Phone</span><strong>${esc(result.owner?.phone ?? '')}</strong></div>
                  <div class="kv"><span>Temporary password</span><strong>${esc(result.temporary_password)}</strong></div>
                </div>`,
            });
          } else {
            toast('Shop created', 'ok');
          }
          await onSaved();
        } catch (error) {
          toast(error.message, 'error');
          button.disabled = false;
        }
      });
    },
  });
}

// --- Support inbox -----------------------------------------------------------

export async function adminInboxView() {
  screen({
    title: 'Support inbox',
    nav: 'inbox',
    actions: `<button class="btn btn--icon" data-broadcast aria-label="Message every shop">${icon('megaphone', { size: 18 })}</button>`,
    content: skeletonList(6),
  });

  let data;
  try {
    data = await api.adminInbox({ limit: 200 });
  } catch (error) {
    setContent(emptyState('Could not load the inbox', error.message, 'x'));
    return undefined;
  }

  const main = setContent(
    data.threads.length
      ? `<div class="list">
           ${data.threads
             .map(
               (thread) => `
                 <button class="list__item" data-thread="${esc(thread.id)}">
                   <div class="grow">
                     <div class="row row--between" style="gap:8px">
                       <span class="list__title truncate">${esc(thread.shop_name)}</span>
                       ${
                         thread.unread_for_other > 0
                           ? `<span class="badge badge--warn">${num(thread.unread_for_other)} new</span>`
                           : `<span class="list__meta">${esc(ago(thread.last_message_at))}</span>`
                       }
                     </div>
                     <div class="list__meta truncate">${esc(thread.last_message_preview ?? 'No messages yet')}</div>
                     <div class="list__meta">
                       ${esc(thread.owner_name ?? 'No owner')}${thread.owner_phone_display ? ` · ${esc(thread.owner_phone_display)}` : ''}
                     </div>
                   </div>
                   ${icon('chevron', { size: 16 })}
                 </button>`,
             )
             .join('')}
         </div>`
      : emptyState('Inbox is empty', 'Support conversations from your shops land here.', 'inbox'),
  );

  for (const button of main.querySelectorAll('[data-thread]')) {
    button.addEventListener('click', () => navigate(`/chat/${button.dataset.thread}`));
  }
  document.querySelector('[data-broadcast]')?.addEventListener('click', openBroadcastSheet);
  return undefined;
}

// --- Global call log ---------------------------------------------------------

export async function adminCallsView() {
  screen({ title: 'Calls', subtitle: 'All shops', nav: 'calls', content: skeletonList(6) });

  let data;
  let status;
  try {
    [data, status] = await Promise.all([api.allCalls({ limit: 100 }), api.telephonyStatus()]);
  } catch (error) {
    setContent(emptyState('Could not load calls', error.message, 'x'));
    return undefined;
  }

  setContent(`
    <div class="stack">
      ${
        status.configured
          ? ''
          : `<div class="banner banner--warn">
               ${icon('phone', { size: 18 })}
               <div>Zadarma is not connected. Set <code>ZADARMA_KEY</code> and <code>ZADARMA_SECRET</code> to log calls
               and enable one-tap dialling.</div>
             </div>`
      }
      ${
        data.calls.length
          ? `<div class="list">
               ${data.calls
                 .map(
                   (call) => `
                     <div class="list__item list__item--static">
                       <div class="grow">
                         <div class="row row--between" style="gap:8px">
                           <span class="list__title truncate">
                             ${icon(call.direction === 'out' ? 'phone' : call.status === 'completed' ? 'phone' : 'missed', { size: 15 })}
                             ${esc(call.caller_phone_display ?? call.caller_phone ?? 'Unknown')}
                           </span>
                           <span class="list__meta">${esc(ago(call.started_at))}</span>
                         </div>
                         <div class="list__meta">
                           ${esc(call.shop_name ?? 'Unassigned')} · ${esc(call.direction === 'out' ? 'Outgoing' : 'Incoming')}
                           · ${esc(call.status)}${call.duration_seconds ? ` · ${esc(duration(call.duration_seconds))}` : ''}
                         </div>
                         <div class="list__meta">${esc(dateTimeOf(call.started_at))}</div>
                       </div>
                     </div>`,
                 )
                 .join('')}
             </div>`
          : emptyState('No calls yet', 'Calls appear here once Zadarma webhooks start arriving.', 'phone')
      }
    </div>`);
  return undefined;
}
