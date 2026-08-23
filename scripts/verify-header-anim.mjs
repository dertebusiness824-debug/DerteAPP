/**
 * Verifies header section titles + brand animation classes during SPA navigations.
 * Uses demo owner credentials against local server.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.APP_URL || 'http://localhost:3000';
const EMAIL = 'marco.demo@gmail.com';
const PASS = 'DerteDemo1';

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type="email"], input[name="email"], #email, input[type="text"]', {
    timeout: 15000,
  });
  const emailSel =
    (await page.$('input[type="email"]')) ||
    (await page.$('input[name="email"]')) ||
    (await page.$('#email'));
  const passSel =
    (await page.$('input[type="password"]')) || (await page.$('input[name="password"]'));
  if (!emailSel || !passSel) throw new Error('login form not found');
  await emailSel.click({ clickCount: 3 });
  await emailSel.type(EMAIL, { delay: 10 });
  await passSel.click({ clickCount: 3 });
  await passSel.type(PASS, { delay: 10 });
  await Promise.all([
    page.click('button[type="submit"], button.btn--primary, form button'),
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => null),
  ]);
  await page.waitForSelector('.header__title', { timeout: 20000 });
}

async function titleOf(page) {
  return page.$eval('.header__title', (el) => el.textContent.trim());
}

async function watchNav(page, navKey, expectedTitle) {
  const result = await page.evaluate(async (key) => {
    const samples = [];
    const btn = document.querySelector(`button[data-nav="${key}"]`);
    if (!btn) return { ok: false, error: `missing nav ${key}` };

    const observer = new MutationObserver(() => {
      const logo = document.querySelector('.header__logo');
      const wm = document.querySelector('.header__wordmark');
      samples.push({
        t: performance.now(),
        title: document.querySelector('.header__title')?.textContent?.trim() || '',
        spinning: Boolean(logo?.classList.contains('is-spinning')),
        collapsed: Boolean(wm?.classList.contains('is-collapsed')),
        logoTransform: logo ? getComputedStyle(logo).transform : '',
        wmMax: wm ? getComputedStyle(wm).maxWidth : '',
        wmOpacity: wm ? getComputedStyle(wm).opacity : '',
      });
    });
    observer.observe(document.querySelector('.header') || document.body, {
      subtree: true,
      attributes: true,
      childList: true,
      attributeFilter: ['class', 'style'],
    });

    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    observer.disconnect();
    const title = document.querySelector('.header__title')?.textContent?.trim() || '';
    const sawSpin = samples.some((s) => s.spinning || (s.logoTransform && s.logoTransform !== 'none'));
    const sawCollapse = samples.some(
      (s) => s.collapsed || s.wmOpacity === '0' || (s.wmMax && s.wmMax !== '0px' && parseFloat(s.wmMax) < 40),
    );
    // Collapse specifically: max-width near 0 or opacity 0
    const sawCollapseStrict = samples.some(
      (s) => s.collapsed || s.wmOpacity === '0' || parseFloat(s.wmMax || '99') < 1,
    );
    return { ok: true, title, sawSpin, sawCollapse: sawCollapseStrict, samples: samples.slice(0, 40) };
  }, navKey);

  if (!result.ok) throw new Error(result.error);
  if (result.title !== expectedTitle) {
    throw new Error(`expected title ${expectedTitle}, got ${result.title}`);
  }
  return result;
}

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=420,900'],
  defaultViewport: { width: 420, height: 900 },
});

try {
  const page = await browser.newPage();
  await login(page);
  const homeTitle = await titleOf(page);
  console.log(JSON.stringify({ homeTitle }, null, 2));

  const paths = [
    ['appointments', 'Reservas'],
    ['urgencias', 'Urgencias'],
    ['more', 'Ajustes'],
    ['home', 'Inicio'],
  ];

  const report = [];
  for (const [key, expected] of paths) {
    const r = await watchNav(page, key, expected);
    report.push({
      nav: key,
      title: r.title,
      sawSpin: r.sawSpin,
      sawCollapse: r.sawCollapse,
      sampleCount: r.samples.length,
      spinningSamples: r.samples.filter((s) => s.spinning).length,
      collapsedSamples: r.samples.filter((s) => s.collapsed).length,
    });
  }
  console.log(JSON.stringify({ report }, null, 2));
  const allTitlesOk = report.every((r) => r.title);
  const anyAnim = report.some((r) => r.sawSpin || r.sawCollapse);
  if (!allTitlesOk) process.exitCode = 1;
  if (!anyAnim) {
    console.error('WARNING: no spin/collapse classes observed during SPA navigations');
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
