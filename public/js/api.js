/**
 * API client.
 *
 * The session lives in an httpOnly cookie (so EventSource streams authenticate
 * themselves). A token may also be mirrored in localStorage for API clients,
 * but the cookie is canonical in the browser so a leftover taller token cannot
 * overwrite a Super Admin session.
 */
const TOKEN_KEY = 'derte_token';
/** Temporary client placeholder so missing auth never cancels the request early. */
const MOCK_TOKEN = 'mock-token';

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.error?.code ?? null;
    this.details = payload?.error?.details ?? null;
  }
}

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

/** Real session token, or a mock placeholder so client guards do not abort. */
export const getRequestToken = () => getToken() || MOCK_TOKEN;

export const setToken = (token) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable in private mode; the cookie still carries us.
  }
};

/** Called with no arguments when the server rejects our session. */
let onUnauthorized = () => {};
export const setUnauthorizedHandler = (handler) => {
  onUnauthorized = handler;
};

async function request(method, path, { body, signal, silent401 = false } = {}) {
  const realToken = getToken();
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      // Never send mock-token: it would shadow the httpOnly session cookie.
      ...(realToken ? { Authorization: `Bearer ${realToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: { message: 'The server returned an unexpected response' } };
  }

  // Only treat 401 as "session died" for a REAL stored token (never mock-token),
  // and never while silent401 is set (appointments soft-load path).
  if (response.status === 401 && !silent401 && realToken) {
    setToken(null);
    onUnauthorized();
  }
  if (!response.ok) throw new ApiError(response.status, payload);
  return payload;
}

const query = (params = {}) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    // Arrays must be repeated (?status=a&status=b). String(array) would send
    // "a,b" and fail Zod validation on the appointments list.
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === '') continue;
        search.append(key, String(item));
      }
      continue;
    }
    search.set(key, String(value));
  }
  const string = search.toString();
  return string ? `?${string}` : '';
};

export const api = {
  get: (path, params) => request('GET', `${path}${query(params)}`),
  post: (path, body) => request('POST', path, { body }),
  patch: (path, body) => request('PATCH', path, { body }),
  put: (path, body) => request('PUT', path, { body }),
  del: (path) => request('DELETE', path),

  // --- auth ---
  register: (payload) => request('POST', '/auth/register', { body: payload }),
  login: (payload) => request('POST', '/auth/login', { body: payload }),
  googleConfig: () => request('GET', '/auth/google/config'),
  googleAuth: (payload) => request('POST', '/auth/google', { body: payload }),
  requestOtp: (payload) => request('POST', '/auth/otp/request', { body: payload }),
  loginWithOtp: (payload) => request('POST', '/auth/otp/login', { body: payload }),
  resetPassword: (payload) => request('POST', '/auth/password/reset', { body: payload }),
  me: () => request('GET', '/auth/me', { silent401: true }),
  logout: () => request('POST', '/auth/logout', { body: {} }),
  updateProfile: (payload) => request('PATCH', '/auth/me', { body: payload }),
  changePassword: (payload) => request('POST', '/auth/password', { body: payload }),

  // --- shops ---
  shops: () => request('GET', '/shops'),
  createShop: (payload) => request('POST', '/shops', { body: payload }),
  shop: (shopId) => request('GET', `/shops/${shopId}`),
  updateShop: (shopId, payload) => request('PATCH', `/shops/${shopId}`, { body: payload }),
  setOwnerPassword: (shopId, password) =>
    request('POST', `/shops/${shopId}/owner-password`, { body: { password } }),
  // silent401: Citas soft-loads overview for auto-complete; never wipe session.
  overview: (shopId) => request('GET', `/shops/${shopId}/overview`, { silent401: true }),
  analytics: (shopId, days = 30) => request('GET', `/shops/${shopId}/analytics${query({ days })}`),
  yearlyHistory: (shopId, year) =>
    request('GET', `/shops/${shopId}/history${query(year ? { year } : {})}`, { silent401: true }),
  availability: (shopId, params) => request('GET', `/shops/${shopId}/availability${query(params)}`),
  embed: (shopId) => request('GET', `/shops/${shopId}/embed`),
  rotateKey: (shopId) => request('POST', `/shops/${shopId}/rotate-public-key`, { body: {} }),
  addMember: (shopId, payload) => request('POST', `/shops/${shopId}/members`, { body: payload }),
  removeMember: (shopId, userId) => request('DELETE', `/shops/${shopId}/members/${userId}`),
  googleCalendar: (shopId) => request('GET', `/shops/${shopId}/google-calendar`),
  googleCalendarConnect: (shopId) => request('GET', `/shops/${shopId}/google-calendar/connect`),
  saveGoogleCalendar: (shopId, payload) =>
    request('POST', `/shops/${shopId}/google-calendar`, { body: payload }),
  syncGoogleCalendar: (shopId) => request('POST', `/shops/${shopId}/google-calendar/sync`, { body: {} }),
  disconnectGoogleCalendar: (shopId) => request('DELETE', `/shops/${shopId}/google-calendar`),

  // --- appointments ---
  // silent401: list failures must not wipe the session / force re-login UI.
  appointments: (params) =>
    request('GET', `/appointments${query(params)}`, { silent401: true }),
  /** Public-key board (no user JWT) — Postgres path, bypasses session/RLS. */
  appointmentsBoard: (params) =>
    request('GET', `/appointments/board${query(params)}`, { silent401: true }),
  todayAppointments: (shopId) =>
    request('GET', `/appointments/today${query({ shop_id: shopId })}`, { silent401: true }),
  appointment: (id, shopId) =>
    request('GET', `/appointments/${id}${query({ shop_id: shopId })}`, { silent401: true }),
  createAppointment: (payload) =>
    request('POST', '/appointments', { body: { ...payload, status: 'confirmed' } }),
  updateAppointment: (id, payload) => request('PATCH', `/appointments/${id}`, { body: payload }),
  setAppointmentStatus: (id, payload) => request('POST', `/appointments/${id}/status`, { body: payload }),

  // --- urgencias ---
  urgencias: (params) => request('GET', `/urgencias${query(params)}`, { silent401: true }),
  urgencia: (id, shopId) =>
    request('GET', `/urgencias/${id}${query({ shop_id: shopId })}`, { silent401: true }),
  acceptUrgencia: (id, payload = {}) =>
    request('POST', `/urgencias/${id}/accept`, { body: payload }),
  cancelUrgencia: (id, payload = {}) =>
    request('POST', `/urgencias/${id}/cancel`, { body: payload }),

  // --- vehicles ---
  vehicles: (params) => request('GET', `/workshop/vehicles${query(params)}`, { silent401: true }),
  vehicle: (id, shopId) => request('GET', `/workshop/vehicles/${id}${query({ shop_id: shopId })}`),
  identifyPlate: (payload) => request('POST', '/workshop/vehicles/identify/plate', { body: payload }),
  identifyVehiclePhoto: (payload) =>
    request('POST', '/workshop/vehicles/identify/photo', { body: payload }),
  vehicleCatalog: (params) => request('GET', `/workshop/vehicles/catalog${query(params)}`),
  saveVehicle: (payload) => request('POST', '/workshop/vehicles', { body: payload }),
  updateVehicle: (id, payload) => request('PATCH', `/workshop/vehicles/${id}`, { body: payload }),
  uploadVehiclePhoto: (id, payload) =>
    request('POST', `/workshop/vehicles/${id}/photo`, { body: payload }),
  deleteVehicle: (id, shopId) =>
    request('DELETE', `/workshop/vehicles/${id}${query({ shop_id: shopId })}`),

  // --- diagnostic assistant ---
  diagnose: (payload) => request('POST', '/workshop/diagnostics', { body: payload }),
  diagnosticHistory: (params) => request('GET', `/workshop/diagnostics${query(params)}`),

  // --- inventory ---
  inventory: (params) => request('GET', `/workshop/inventory${query(params)}`, { silent401: true }),
  createInventoryItem: (payload) => request('POST', '/workshop/inventory', { body: payload }),
  updateInventoryItem: (id, payload) =>
    request('PATCH', `/workshop/inventory/${id}`, { body: payload }),
  adjustInventoryItem: (id, payload) =>
    request('POST', `/workshop/inventory/${id}/adjust`, { body: payload }),
  deleteInventoryItem: (id, shopId) =>
    request('DELETE', `/workshop/inventory/${id}${query({ shop_id: shopId })}`),
  recognizeInventoryPhoto: (payload) =>
    request('POST', '/workshop/inventory/recognize', { body: payload }),
  uploadInventoryPhoto: (id, payload) =>
    request('POST', `/workshop/inventory/${id}/photo`, { body: payload }),
  inventoryMovements: (params) => request('GET', `/workshop/inventory/movements${query(params)}`),
  setInventoryReminders: (shopId, enabled) =>
    request('PATCH', '/workshop/inventory/reminders', { body: { shop_id: shopId, enabled } }),

  // --- chat ---
  threads: (params) => request('GET', `/chat/threads${query(params)}`),
  thread: (threadId) => request('GET', `/chat/threads/${threadId}`),
  threadMessages: (threadId, params) => request('GET', `/chat/threads/${threadId}/messages${query(params)}`),
  sendMessage: (threadId, body) => request('POST', `/chat/threads/${threadId}/messages`, { body: { body } }),
  supportThread: (shopId) => request('GET', `/chat/support${query({ shop_id: shopId })}`),
  unread: (shopId) => request('GET', `/chat/unread${query({ shop_id: shopId })}`),

  // --- telephony ---
  telephonyStatus: (params) => request('GET', `/telephony/status${query(params)}`),
  placeCall: (payload) => request('POST', '/telephony/call', { body: payload }),
  calls: (params) => request('GET', `/telephony/calls${query(params)}`),
  allCalls: (params) => request('GET', `/telephony/calls/all${query(params)}`),
  callStats: (shopId, days = 30) => request('GET', `/telephony/stats${query({ shop_id: shopId, days })}`),

  // --- admin ---
  adminOverview: (days = 30) => request('GET', `/admin/overview${query({ days })}`),
  adminShops: (params) => request('GET', `/admin/shops${query(params)}`),
  adminSetShopStatus: (shopId, payload) => request('PATCH', `/admin/shops/${shopId}/status`, { body: payload }),
  adminSetShopMarketplace: (shopId, payload) =>
    request('PATCH', `/admin/shops/${shopId}/marketplace`, { body: payload }),
  adminUploadShopCover: (shopId, payload) =>
    request('POST', `/admin/shops/${shopId}/cover`, { body: payload }),
  adminClearShopCover: (shopId) => request('DELETE', `/admin/shops/${shopId}/cover`),
  adminPurgeShopsExcept: (payload) => request('POST', '/admin/shops/purge-except', { body: payload }),
  adminShopInventory: (shopId) => request('GET', `/admin/shops/${shopId}/inventory`),
  adminPreloadInventory: (shopId, payload = {}) =>
    request('POST', `/admin/shops/${shopId}/inventory/preload`, { body: payload }),
  adminClearPreloadedInventory: (shopId) =>
    request('DELETE', `/admin/shops/${shopId}/inventory/preload`),
  adminShopPromotions: (shopId) => request('GET', `/admin/shops/${shopId}/promotions`),
  adminCreatePromotion: (shopId, payload) =>
    request('POST', `/admin/shops/${shopId}/promotions`, { body: payload }),
  adminUpdatePromotion: (promotionId, payload) =>
    request('PATCH', `/admin/promotions/${promotionId}`, { body: payload }),
  adminDeletePromotion: (promotionId) => request('DELETE', `/admin/promotions/${promotionId}`),
  adminInbox: (params) => request('GET', `/admin/inbox${query(params)}`),
  adminSupportThread: (shopId) => request('GET', `/admin/inbox/${shopId}`),
  adminBroadcast: (payload) => request('POST', '/admin/broadcast', { body: payload }),
  adminUsers: (params) => request('GET', `/admin/users${query(params)}`),
  adminCreateUser: (payload) => request('POST', '/admin/users', { body: payload }),
  adminSetUserStatus: (userId, payload) => request('PATCH', `/admin/users/${userId}`, { body: payload }),
  adminDeleteUser: (userId) => request('DELETE', `/admin/users/${userId}`),
  adminSalesReps: (params) => request('GET', `/admin/sales-reps${query(params)}`),
  adminSalesRepOptions: () => request('GET', '/admin/sales-reps/options'),
  adminCreateSalesRep: (payload) => request('POST', '/admin/sales-reps', { body: payload }),
  adminUpdateSalesRep: (repId, payload) => request('PATCH', `/admin/sales-reps/${repId}`, { body: payload }),
  adminCommissions: (params) => request('GET', `/admin/commissions${query(params)}`),
  adminPayCommission: (commissionId) =>
    request('POST', `/admin/commissions/${commissionId}/pay`, { body: {} }),

  // --- public ---
  publicSupport: () => request('GET', '/public/support'),
};

/**
 * Subscribes to a Server-Sent Events endpoint.
 * Returns an unsubscribe function; the browser reconnects on its own.
 */
export function stream(path, handlers = {}) {
  let source;
  try {
    source = new EventSource(`/api${path}`, { withCredentials: true });
  } catch {
    return () => {};
  }
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (message) => {
      try {
        handler(message.data ? JSON.parse(message.data) : null);
      } catch {
        // Ignore malformed frames rather than tearing the stream down.
      }
    });
  }
  return () => source.close();
}
