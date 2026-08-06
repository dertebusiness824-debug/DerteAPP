/**
 * History-API router.
 *
 * Routes are declared as patterns with `:params`. The server serves the app
 * shell for every non-API path, so deep links and refreshes work.
 */
const routes = [];
let currentCleanup = null;
let notFound = null;
let beforeEach = null;

const compile = (pattern) => {
  const names = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(segment.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { regex: new RegExp(`^${source}/?$`), names };
};

export function route(pattern, handler, options = {}) {
  routes.push({ ...compile(pattern), handler, options, pattern });
}

export const setNotFound = (handler) => {
  notFound = handler;
};

/** Guard run before every navigation; return a path string to redirect. */
export const setGuard = (handler) => {
  beforeEach = handler;
};

export const currentPath = () => location.pathname + location.search;

export function navigate(path, { replace = false } = {}) {
  if (path === currentPath()) return resolve();
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  return resolve();
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else navigate(fallback, { replace: true });
}

export async function resolve() {
  const path = location.pathname;

  if (beforeEach) {
    const redirect = await beforeEach(path);
    if (redirect && redirect !== path) return navigate(redirect, { replace: true });
  }

  for (const entry of routes) {
    const match = entry.regex.exec(path);
    if (!match) continue;

    const params = Object.fromEntries(entry.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));

    // Views may return a cleanup function (event streams, timers).
    if (typeof currentCleanup === 'function') currentCleanup();
    currentCleanup = null;
    currentCleanup = (await entry.handler({ params, query: new URLSearchParams(location.search), path })) ?? null;
    return undefined;
  }

  if (typeof currentCleanup === 'function') currentCleanup();
  currentCleanup = null;
  if (notFound) currentCleanup = (await notFound({ path })) ?? null;
  return undefined;
}

export function startRouter() {
  addEventListener('popstate', () => resolve());

  // Intercept in-app links so navigation never reloads the shell.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href?.startsWith('/') || link.target === '_blank' || link.hasAttribute('download')) return;
    if (link.dataset.native === 'true') return;

    event.preventDefault();
    navigate(href);
  });

  return resolve();
}
