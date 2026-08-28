/**
 * Spare parts and consumables inventory.
 *
 * Tyres, wheels, oils, filters… added by hand or straight from a photo, with
 * +/− buttons on every row because that is how a counter actually works. The
 * reminder banner at the top is the in-app half of the notification system: it
 * states the facts (nothing changed this month, or it is review Friday) and
 * links to the switch that turns the whole thing off.
 */
import { api, ApiError } from '../api.js';
import { t } from '../i18n.js';
import { requireShop, screen } from '../shell.js';
import {
  ago,
  confirmSheet,
  emptyState,
  esc,
  icon,
  num,
  sheet,
  skeletonList,
  toast,
} from '../ui.js';

/** Reads a picked file as a data URL, which is what the API expects. */
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(t('inventory.photoReadFailed')));
    reader.readAsDataURL(file);
  });
}

const CATEGORY_ICONS = {
  tyres: 'tyre',
  wheels: 'tyre',
  oils: 'box',
  filters: 'box',
  brakes: 'wrench',
  battery: 'box',
  fluids: 'box',
  ignition: 'wrench',
  wipers: 'wrench',
  consumables: 'box',
  other: 'box',
};

const MOVEMENT_LABEL = (kind) => t(`inventory.movement.${kind}`) || kind;

const quantityLabel = (item) =>
  `${num(item.quantity)} ${item.unit}${item.min_quantity > 0 ? ` / ${num(item.min_quantity)}` : ''}`;

function itemRow(item) {
  const tone = item.out_of_stock ? 'is-out' : item.low_stock ? 'is-low' : '';
  const subtitle = [item.spec, item.brand].filter(Boolean).join(' · ');
  return `
    <div class="list__item list__item--static inv-row ${tone}" data-item="${esc(item.id)}">
      <span class="list__thumb inv-row__thumb">
        ${
          item.photo_url
            ? `<img src="${esc(item.photo_url)}" alt="" loading="lazy">`
            : icon(CATEGORY_ICONS[item.category] ?? 'box', { size: 20 })
        }
      </span>
      <button class="grow inv-row__hit" type="button" data-edit-item="${esc(item.id)}">
        <div class="list__title truncate">${esc(item.name)}</div>
        ${subtitle ? `<div class="list__meta truncate">${esc(subtitle)}</div>` : ''}
        <div class="inv-row__qty">
          ${esc(quantityLabel(item))}
          ${
            item.out_of_stock
              ? `<span class="badge badge--danger">${esc(t('inventory.outOfStock'))}</span>`
              : item.low_stock
                ? `<span class="badge badge--warn">${esc(t('inventory.lowStock'))}</span>`
                : ''
          }
          ${item.preloaded ? `<span class="badge badge--info">${esc(t('inventory.preloaded'))}</span>` : ''}
        </div>
      </button>
      <div class="inv-row__steppers">
        <button class="btn btn--icon btn--soft" type="button" data-adjust="${esc(item.id)}" data-delta="-1"
                aria-label="${esc(t('inventory.decrease'))}">${icon('minus', { size: 16 })}</button>
        <button class="btn btn--icon btn--soft" type="button" data-adjust="${esc(item.id)}" data-delta="1"
                aria-label="${esc(t('inventory.increase'))}">${icon('plus', { size: 16 })}</button>
      </div>
    </div>`;
}

/** The in-app reminder. Fortnightly Friday nudge and the monthly "nothing changed". */
function reminderBannerHtml(reminders) {
  if (!reminders) return '';

  if (!reminders.enabled) {
    return `
      <div class="card card--flat inv-banner inv-banner--off">
        ${icon('bell', { size: 18 })}
        <div class="grow">
          <div class="list__title">${esc(t('inventory.remindersOff'))}</div>
          <div class="list__meta">${esc(t('inventory.remindersOffHint'))}</div>
        </div>
        <a class="btn btn--small btn--soft" href="/settings">${esc(t('inventory.remindersSettings'))}</a>
      </div>`;
  }

  if (!reminders.monthly_due && !reminders.fortnightly_due) return '';

  // The monthly nudge is the stronger statement, so it wins when both apply.
  const monthly = reminders.monthly_due;
  return `
    <div class="card inv-banner ${monthly ? 'inv-banner--warn' : ''}">
      ${icon('bell', { size: 18 })}
      <div class="grow">
        <div class="list__title">${esc(monthly ? t('inventory.monthlyDue') : t('inventory.fortnightlyDue'))}</div>
        <div class="list__meta">
          ${esc(monthly ? t('inventory.monthlyDueHint') : t('inventory.fortnightlyDueHint'))}
        </div>
      </div>
    </div>`;
}

function summaryHtml(summary) {
  return `
    <div class="stats">
      <div class="stat"><div class="stat__value">${num(summary.items)}</div>
        <div class="stat__label">${esc(t('inventory.kpiItems'))}</div></div>
      <div class="stat"><div class="stat__value">${num(summary.units)}</div>
        <div class="stat__label">${esc(t('inventory.kpiUnits'))}</div></div>
      <div class="stat${summary.low_stock > 0 ? ' stat--alert' : ''}">
        <div class="stat__value">${num(summary.low_stock)}</div>
        <div class="stat__label">${esc(t('inventory.kpiLowStock'))}</div></div>
      <div class="stat"><div class="stat__value">${num(summary.changes_this_month)}</div>
        <div class="stat__label">${esc(t('inventory.kpiChanges'))}</div></div>
    </div>`;
}

export async function inventoryView() {
  const shop = requireShop({ title: t('nav.inventory'), navKey: 'inventory' });
  if (!shop) return undefined;

  let categories = [];
  const filters = { search: '', category: '', lowStock: false };

  screen({
    title: t('nav.inventory'),
    nav: 'inventory',
    shopSwitcher: true,
    actions: `<button class="btn btn--icon" data-new-item aria-label="${esc(t('inventory.addItem'))}">
                ${icon('plus', { size: 20 })}
              </button>`,
    content: `
      <div class="stack">
        <div data-reminder></div>
        <div data-summary></div>

        <div class="btn-row">
          <button class="btn btn--block" type="button" data-new-item>
            ${icon('plus', { size: 17 })} ${esc(t('inventory.addManual'))}
          </button>
          <label class="btn btn--soft btn--block" for="inv-photo" data-photo-cta>
            ${icon('camera', { size: 17 })} ${esc(t('inventory.addByPhoto'))}
            <input id="inv-photo" type="file" accept="image/*" capture="environment" data-photo-input hidden>
          </label>
        </div>

        <label class="reservas-search">
          <span class="reservas-search__icon" aria-hidden="true">${icon('search', { size: 18 })}</span>
          <input class="input reservas-search__input" type="search" data-search
                 placeholder="${esc(t('inventory.searchPlaceholder'))}">
        </label>

        <div class="chips" data-categories></div>

        <div data-items>${skeletonList(4)}</div>

        <div class="section-title"><span>${esc(t('inventory.movementsTitle'))}</span></div>
        <div data-movements></div>
      </div>`,
  });

  const main = document.querySelector('.main');
  const reminderBox = main.querySelector('[data-reminder]');
  const summaryBox = main.querySelector('[data-summary]');
  const categoryBox = main.querySelector('[data-categories]');
  const itemsBox = main.querySelector('[data-items]');
  const movementsBox = main.querySelector('[data-movements]');

  const paintCategories = () => {
    categoryBox.innerHTML = `
      <button class="chip" type="button" data-category="" aria-pressed="${filters.category === ''}">
        ${esc(t('inventory.allCategories'))}
      </button>
      ${categories
        .map(
          (category) => `
            <button class="chip" type="button" data-category="${esc(category.key)}"
                    aria-pressed="${filters.category === category.key}">
              ${esc(category.label)}
            </button>`,
        )
        .join('')}
      <button class="chip" type="button" data-low-stock aria-pressed="${filters.lowStock}">
        ${esc(t('inventory.onlyLowStock'))}
      </button>`;
  };

  const paintMovements = (movements) => {
    movementsBox.innerHTML = movements.length
      ? `<div class="list">${movements
          .map(
            (movement) => `
              <div class="list__item list__item--static">
                ${icon(movement.delta >= 0 ? 'plus' : 'minus', { size: 16 })}
                <div class="grow">
                  <div class="list__title truncate">${esc(movement.item_name)}</div>
                  <div class="list__meta truncate">
                    ${esc(MOVEMENT_LABEL(movement.kind))}
                    ${movement.source === 'photo' ? ` · ${esc(t('inventory.viaPhoto'))}` : ''}
                    · ${esc(ago(movement.created_at))}
                    ${movement.actor_name ? ` · ${esc(movement.actor_name)}` : ''}
                  </div>
                </div>
                <span class="inv-move__delta${movement.delta < 0 ? ' is-negative' : ''}">
                  ${movement.delta > 0 ? '+' : ''}${num(movement.delta)}
                </span>
              </div>`,
          )
          .join('')}</div>`
      : `<div class="card card--flat"><p class="list__meta">${esc(t('inventory.movementsEmpty'))}</p></div>`;
  };

  /** Last painted rows, so the edit sheet opens without a second request. */
  let items = [];

  const load = async () => {
    try {
      const payload = await api.inventory({
        shop_id: shop.id,
        search: filters.search || undefined,
        category: filters.category || undefined,
        low_stock: filters.lowStock ? 'true' : undefined,
      });

      items = payload.items ?? [];
      categories = payload.categories ?? [];
      main.querySelector('[data-photo-cta]')?.classList.toggle('is-hidden', !payload.vision_available);

      reminderBox.innerHTML = reminderBannerHtml(payload.reminders);
      summaryBox.innerHTML = summaryHtml(payload.summary);
      paintCategories();

      itemsBox.innerHTML = items.length
        ? `<div class="list">${items.map(itemRow).join('')}</div>`
        : emptyState(
            filters.search || filters.category || filters.lowStock
              ? t('inventory.noMatches')
              : t('inventory.empty'),
            filters.search || filters.category || filters.lowStock
              ? t('inventory.noMatchesHint')
              : t('inventory.emptyHint'),
            'box',
          );

      paintMovements(payload.movements ?? []);
    } catch (error) {
      itemsBox.innerHTML = emptyState(t('inventory.loadFailed'), error.message, 'x');
    }
  };

  // --- item sheet -----------------------------------------------------------

  const openItemSheet = (item = null, suggestion = null) => {
    const initial = item ?? {
      name: suggestion?.name ?? '',
      category: suggestion?.category ?? 'other',
      brand: suggestion?.brand ?? '',
      spec: suggestion?.spec ?? '',
      quantity: 0,
      unit: suggestion?.unit ?? 'ud',
      min_quantity: 0,
      price: '',
      notes: '',
    };
    const list = categories.length ? categories : [{ key: 'other', label: t('inventory.categoryOther') }];

    sheet({
      title: item ? t('inventory.editItem') : t('inventory.addItem'),
      body: `
        <form class="stack" novalidate>
          ${
            suggestion
              ? `<div class="card card--flat inv-suggestion">
                   ${icon('camera', { size: 17 })}
                   <div class="grow">
                     <div class="list__title">${esc(t('inventory.photoSuggestion'))}</div>
                     <div class="list__meta">${esc(
                       t('inventory.photoConfidence').replace(
                         '{n}',
                         Math.round((suggestion.confidence ?? 0.5) * 100),
                       ),
                     )}</div>
                   </div>
                 </div>`
              : ''
          }
          <div class="field">
            <label class="field__label" for="inv-name">${esc(t('inventory.name'))}</label>
            <input class="input" id="inv-name" required maxlength="120" value="${esc(initial.name)}">
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field__label" for="inv-category">${esc(t('inventory.category'))}</label>
              <select class="input" id="inv-category">
                ${list
                  .map(
                    (category) =>
                      `<option value="${esc(category.key)}"${
                        category.key === initial.category ? ' selected' : ''
                      }>${esc(category.label)}</option>`,
                  )
                  .join('')}
              </select>
            </div>
            <div class="field">
              <label class="field__label" for="inv-spec">${esc(t('inventory.spec'))}</label>
              <input class="input" id="inv-spec" maxlength="120" value="${esc(initial.spec ?? '')}"
                     placeholder="${esc(t('inventory.specPlaceholder'))}">
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field__label" for="inv-brand">${esc(t('inventory.brand'))}</label>
              <input class="input" id="inv-brand" maxlength="80" value="${esc(initial.brand ?? '')}">
            </div>
            <div class="field">
              <label class="field__label" for="inv-unit">${esc(t('inventory.unit'))}</label>
              <input class="input" id="inv-unit" maxlength="12" value="${esc(initial.unit ?? 'ud')}">
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="field__label" for="inv-quantity">${esc(t('inventory.quantity'))}</label>
              <input class="input" id="inv-quantity" type="number" min="0" step="0.01" inputmode="decimal"
                     value="${esc(initial.quantity ?? 0)}">
            </div>
            <div class="field">
              <label class="field__label" for="inv-min">${esc(t('inventory.minQuantity'))}</label>
              <input class="input" id="inv-min" type="number" min="0" step="0.01" inputmode="decimal"
                     value="${esc(initial.min_quantity ?? 0)}">
              <span class="field__hint">${esc(t('inventory.minQuantityHint'))}</span>
            </div>
          </div>
          <div class="field">
            <label class="field__label" for="inv-price">${esc(t('inventory.price'))}</label>
            <input class="input" id="inv-price" type="number" min="0" step="0.01" inputmode="decimal"
                   value="${esc(initial.price ?? '')}">
          </div>
          <div class="field">
            <label class="field__label" for="inv-notes">${esc(t('inventory.notes'))}</label>
            <textarea class="input" id="inv-notes" maxlength="400">${esc(initial.notes ?? '')}</textarea>
          </div>
          ${
            item
              ? `<label class="upload" for="inv-item-photo">
                   ${icon('camera', { size: 20 })}
                   <span class="grow">${esc(t('inventory.attachPhoto'))}</span>
                   <input id="inv-item-photo" type="file" accept="image/*" capture="environment" hidden>
                 </label>`
              : ''
          }
          <div class="field__error" data-error role="alert"></div>
          <button class="btn btn--block" type="submit">${esc(t('common.save'))}</button>
          ${
            item
              ? `<button class="btn btn--danger btn--block" type="button" data-delete>
                   ${icon('trash', { size: 17 })} ${esc(t('inventory.deleteItem'))}
                 </button>`
              : ''
          }
        </form>`,
      onMount(content, close) {
        const form = content.querySelector('form');
        const errorBox = form.querySelector('[data-error]');

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          errorBox.textContent = '';
          const button = form.querySelector('button[type="submit"]');
          const text = (id) => form.querySelector(id).value.trim() || null;
          const number = (id) => {
            const raw = form.querySelector(id).value.trim();
            return raw === '' ? null : Number(raw);
          };

          const name = text('#inv-name');
          if (!name || name.length < 2) {
            errorBox.textContent = t('inventory.nameRequired');
            return;
          }

          const payload = {
            shop_id: shop.id,
            name,
            category: form.querySelector('#inv-category').value,
            brand: text('#inv-brand'),
            spec: text('#inv-spec'),
            unit: text('#inv-unit') ?? 'ud',
            quantity: number('#inv-quantity') ?? 0,
            min_quantity: number('#inv-min') ?? 0,
            price: number('#inv-price'),
            notes: text('#inv-notes'),
            source: suggestion ? 'photo' : 'manual',
          };

          button.disabled = true;
          try {
            if (item) await api.updateInventoryItem(item.id, payload);
            else await api.createInventoryItem(payload);
            close();
            toast(item ? t('inventory.itemSaved') : t('inventory.itemCreated'), 'ok');
            await load();
          } catch (error) {
            errorBox.textContent = error instanceof ApiError ? error.message : t('inventory.saveFailed');
            button.disabled = false;
          }
        });

        form.querySelector('#inv-item-photo')?.addEventListener('change', async (event) => {
          const file = event.target.files?.[0];
          if (!file || !item) return;
          const label = form.querySelector('.upload');
          label?.classList.add('is-busy');
          try {
            const dataUrl = await readImage(file);
            await api.uploadInventoryPhoto(item.id, { shop_id: shop.id, data_url: dataUrl });
            toast(t('inventory.photoSaved'), 'ok');
            await load();
          } catch (error) {
            errorBox.textContent = error.message;
          } finally {
            label?.classList.remove('is-busy');
          }
        });

        form.querySelector('[data-delete]')?.addEventListener('click', async () => {
          const confirmed = await confirmSheet({
            title: t('inventory.deleteItem'),
            message: t('inventory.deleteConfirm').replace('{name}', item.name),
            confirmLabel: t('inventory.deleteItem'),
            danger: true,
          });
          if (!confirmed) return;
          try {
            await api.deleteInventoryItem(item.id, shop.id);
            close();
            toast(t('inventory.itemDeleted'), 'ok');
            await load();
          } catch (error) {
            errorBox.textContent = error.message;
          }
        });
      },
    });
  };

  /** Photo → suggested fields → the same sheet, so nothing is saved unconfirmed. */
  const addByPhoto = async (file) => {
    const label = main.querySelector('[data-photo-cta]');
    label?.classList.add('is-busy');
    try {
      const dataUrl = await readImage(file);
      const payload = await api.recognizeInventoryPhoto({ shop_id: shop.id, data_url: dataUrl });
      if (payload.categories?.length) categories = payload.categories;
      if (!payload.recognized) {
        toast(
          payload.reason === 'vision_not_configured'
            ? t('inventory.visionUnavailable')
            : t('inventory.photoNoMatch'),
          'warn',
        );
        openItemSheet(null, null);
        return;
      }
      openItemSheet(null, payload.item);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      label?.classList.remove('is-busy');
    }
  };

  // --- events ---------------------------------------------------------------

  main.addEventListener('click', async (event) => {
    if (event.target.closest('[data-new-item]')) {
      openItemSheet();
      return;
    }

    const category = event.target.closest('[data-category]');
    if (category) {
      filters.category = category.dataset.category;
      await load();
      return;
    }

    if (event.target.closest('[data-low-stock]')) {
      filters.lowStock = !filters.lowStock;
      await load();
      return;
    }

    const adjust = event.target.closest('[data-adjust]');
    if (adjust) {
      adjust.disabled = true;
      try {
        await api.adjustInventoryItem(adjust.dataset.adjust, {
          shop_id: shop.id,
          delta: Number(adjust.dataset.delta),
        });
        await load();
      } catch (error) {
        toast(error.message, 'error');
        adjust.disabled = false;
      }
      return;
    }

    const edit = event.target.closest('[data-edit-item]');
    if (edit) {
      const found = items.find((row) => row.id === edit.dataset.editItem);
      if (found) openItemSheet(found);
    }
  });

  main.addEventListener('change', (event) => {
    const input = event.target.closest('[data-photo-input]');
    if (!input?.files?.length) return;
    void addByPhoto(input.files[0]);
    input.value = '';
  });

  let searchTimer;
  main.querySelector('[data-search]')?.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value.trim();
    searchTimer = setTimeout(() => {
      filters.search = value;
      void load();
    }, 250);
  });

  await load();
  return () => clearTimeout(searchTimer);
}
