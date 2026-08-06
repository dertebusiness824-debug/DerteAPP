/**
 * Inline SVG icon set. Single stroke weight, 24px grid, no fills - the whole
 * icon language of the app in one place, and nothing extra to download.
 */
const paths = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  calendar:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/>',
  chat: '<path d="M20.5 12c0 4.2-3.8 7.5-8.5 7.5-1 0-2-.15-2.9-.42L4.5 20.5l1.2-3.4A7.1 7.1 0 0 1 3.5 12C3.5 7.8 7.3 4.5 12 4.5s8.5 3.3 8.5 7.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chart: '<path d="M4 20h16M7.5 20V11M12 20V5.5M16.5 20v-6"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20c.7-3.6 3.7-5.7 7.2-5.7s6.5 2.1 7.2 5.7"/>',
  phone:
    '<path d="M6.2 3.8h2.6l1.5 4-2 1.4a11 11 0 0 0 5.1 5.1l1.4-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.2 6a2 2 0 0 1 2-2.2z"/>',
  whatsapp:
    '<path d="M20.5 11.7a8.4 8.4 0 0 1-12.4 7.4L4 20.5l1.4-4.1a8.4 8.4 0 1 1 15.1-4.7z"/><path d="M9.3 9.1c.3 2.4 2.2 4.3 4.6 4.7"/>',
  building: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9.5 20.5v-4h5v4"/>',
  inbox: '<path d="M3.5 13h4l1.5 2.5h6L16.5 13h4"/><path d="M3.5 13 6 5h12l2.5 8v5.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  settings:
    '<circle cx="12" cy="12" r="2.8"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  send: '<path d="M5 12 20 5l-7 15-2.2-5.8z"/>',
  car: '<path d="M4 15.5h16M6 15.5v2M18 15.5v2"/><path d="M4.5 15.5 6.2 9.8A2 2 0 0 1 8.1 8.4h7.8a2 2 0 0 1 1.9 1.4l1.7 5.7"/><circle cx="8" cy="15.5" r="1.4"/><circle cx="16" cy="15.5" r="1.4"/>',
  link: '<path d="M10 13.8a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1L11.3 7.5"/><path d="M14 10.2a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.3-1.3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.5"/>',
  bell: '<path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  logout: '<path d="M15 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2.5"/><path d="M11 12h9.5M18 8.5 21.5 12 18 15.5"/>',
  code: '<path d="M9 8.5 5 12l4 3.5M15 8.5 19 12l-4 3.5M13.5 5.5l-3 13"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.2 2.3 3.4 5.3 3.4 8.5S14.2 18.2 12 20.5c-2.2-2.3-3.4-5.3-3.4-8.5S9.8 5.8 12 3.5z"/>',
  team: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.9-4.7 5.5-4.7s4.9 1.7 5.5 4.7"/><path d="M16 6.2a3.2 3.2 0 0 1 0 5.6M17.5 14.5c2 .5 3.4 2.1 3.9 4.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.5"/>',
  megaphone: '<path d="M4.5 10.5v3l11 4.5V6z"/><path d="M15.5 9.5a2.5 2.5 0 0 1 0 5M7 14v4.5h3V15"/>',
  missed: '<path d="M6.2 3.8h2.6l1.5 4-2 1.4a11 11 0 0 0 5.1 5.1l1.4-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.2 6a2 2 0 0 1 2-2.2z"/><path d="M15 4.5 21 10M21 4.5 15 10"/>',
  inspect: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
};

/**
 * Returns an SVG string for `name`.
 * Strings are used rather than nodes so icons can be composed into templates.
 */
export function icon(name, { size = 20, className = '' } = {}) {
  const body = paths[name];
  if (!body) return '';
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"` +
    `${className ? ` class="${className}"` : ''}>${body}</svg>`
  );
}

export const iconNames = Object.keys(paths);
