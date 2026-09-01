/**
 * Manual-only plate lookup gate for the PWA.
 *
 * Official APIVehículo calls (and the history write that follows them) must
 * start from an explicit "Consultar vehículo" submit. This guard:
 *   - refuses a second submit while one is in flight (`in_flight`)
 *   - refuses the same plate again until the user edits the field
 *     (`already_consulted`) after a lookup that already spent a credit
 *   - never starts a lookup by itself
 */

export function normalizeClientPlate(value) {
  return String(value || '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
}

/**
 * Reasons that did not consume an official lookup (or must be retryable
 * without editing the field). Everything else counts as "already consulted".
 */
const RETRYABLE = new Set([
  'timeout',
  'upstream_error',
  'lookup_in_progress',
  'not_configured',
  'invalid_plate',
  'empty',
  'in_flight',
]);

export function officialLookupSpent(reason, found) {
  if (found) return true;
  return !RETRYABLE.has(reason || '');
}

export function createPlateLookupGuard() {
  let busy = false;
  let spentPlate = '';

  return {
    isBusy: () => busy,
    lastSpentPlate: () => spentPlate,
    markEdited(value) {
      if (normalizeClientPlate(value) !== spentPlate) spentPlate = '';
    },
    begin(raw) {
      const plate = normalizeClientPlate(raw);
      if (!plate) return { ok: false, reason: 'empty', plate };
      if (busy) return { ok: false, reason: 'in_flight', plate };
      if (plate === spentPlate) return { ok: false, reason: 'already_consulted', plate };
      busy = true;
      return { ok: true, plate };
    },
    settle(spent, plate) {
      if (spent && plate) spentPlate = normalizeClientPlate(plate);
      busy = false;
    },
    abort() {
      busy = false;
    },
  };
}

export function setSubmitBusy(button, busy) {
  if (!button) return;
  button.disabled = Boolean(busy);
  button.setAttribute('aria-busy', String(Boolean(busy)));
}
