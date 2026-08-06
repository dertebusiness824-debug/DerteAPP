/**
 * API client.
 *
 * The session lives in an httpOnly cookie (so EventSource streams authenticate
 * themselves) and the token is mirrored in localStorage for the Authorization
 * header, which keeps the app working when third-party cookie rules bite.
 */
const TOKEN_KEY = 'derte_token';

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
  const token = getToken();
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  if (response.status === 401 && !silent401) {
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
  requestOtp: (payload) => request('POST', '/auth/otp/request', { body: payload }),
  loginWithOtp: (payload) => request('POST', '/auth/otp/login', { body: payload }),
  resetPassword: (payload) => request('POST', '/auth/password/reset', { body: payload }),
  me: () => request('GET', '/auth/me', { silent401: true }),
  logout: () => request('POST', '/auth/logout', { body: {} }),
  updateProfile: (payload) => request('PATCH', '/auth/me', { body: payload }),
  changePassword: (payload) => request('POST', '/auth/password', { body: payload }),

  // --- shops ---
  shops: () => request('GET', '/shops'),
  shop: (shopId) => request('GET', `/shops/${shopId}`),
  updateShop: (shopId, payload) => request('PATCH', `/shops/${shopId}`, { body: payload }),
  overview: (shopId) => request('GET', `/shops/${shopId}/overview`),
  analytics: (shopId, days = 30) => request('GET', `/shops/${shopId}/analytics${query({ days })}`),
  schedule: (shopId) => request('GET', `/shops/${shopId}/schedule`),
  saveSchedule: (shopId, days) => request('PUT', `/shops/${shopId}/schedule`, { body: { days } }),
  exceptions: (shopId, params) => request('GET', `/shops/${shopId}/exceptions${query(params)}`),
  addException: (shopId, payload) => request('POST', `/shops/${shopId}/exceptions`, { body: payload }),
  removeException: (shopId, id) => request('DELETE', `/shops/${shopId}/exceptions/${id}`),
  availability: (shopId, params) => request('GET', `/shops/${shopId}/availability${query(params)}`),
  embed: (shopId) => request('GET', `/shops/${shopId}/embed`),
  rotateKey: (shopId) => request('POST', `/shops/${shopId}/rotate-public-key`, { body: {} }),
  addMember: (shopId, payload) => request('POST', `/shops/${shopId}/members`, { body: payload }),
  removeMember: (shopId, userId) => request('DELETE', `/shops/${shopId}/members/${userId}`),

  // --- appointments ---
  appointments: (params) => request('GET', `/appointments${query(params)}`),
  todayAppointments: (shopId) => request('GET', `/appointments/today${query({ shop_id: shopId })}`),
  appointment: (id, shopId) => request('GET', `/appointments/${id}${query({ shop_id: shopId })}`),
  createAppointment: (payload) => request('POST', '/appointments', { body: payload }),
  updateAppointment: (id, payload) => request('PATCH', `/appointments/${id}`, { body: payload }),
  acceptAppointment: (id, shopId) => request('POST', `/appointments/${id}/accept`, { body: { shop_id: shopId } }),
  setAppointmentStatus: (id, payload) => request('POST', `/appointments/${id}/status`, { body: payload }),

  // --- chat ---
  threads: (params) => request('GET', `/chat/threads${query(params)}`),
  thread: (threadId) => request('GET', `/chat/threads/${threadId}`),
  threadMessages: (threadId, params) => request('GET', `/chat/threads/${threadId}/messages${query(params)}`),
  sendMessage: (threadId, body) => request('POST', `/chat/threads/${threadId}/messages`, { body: { body } }),
  supportThread: (shopId) => request('GET', `/chat/support${query({ shop_id: shopId })}`),
  unread: (shopId) => request('GET', `/chat/unread${query({ shop_id: shopId })}`),

  // --- telephony ---
  telephonyStatus: () => request('GET', '/telephony/status'),
  placeCall: (payload) => request('POST', '/telephony/call', { body: payload }),
  calls: (params) => request('GET', `/telephony/calls${query(params)}`),
  allCalls: (params) => request('GET', `/telephony/calls/all${query(params)}`),
  callStats: (shopId, days = 30) => request('GET', `/telephony/stats${query({ shop_id: shopId, days })}`),

  // --- admin ---
  adminOverview: (days = 30) => request('GET', `/admin/overview${query({ days })}`),
  adminShops: (params) => request('GET', `/admin/shops${query(params)}`),
  adminSetShopStatus: (shopId, payload) => request('PATCH', `/admin/shops/${shopId}/status`, { body: payload }),
  adminInbox: (params) => request('GET', `/admin/inbox${query(params)}`),
  adminSupportThread: (shopId) => request('GET', `/admin/inbox/${shopId}`),
  adminBroadcast: (payload) => request('POST', '/admin/broadcast', { body: payload }),
  adminUsers: (params) => request('GET', `/admin/users${query(params)}`),
  adminSetUserStatus: (userId, payload) => request('PATCH', `/admin/users/${userId}`, { body: payload }),
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
