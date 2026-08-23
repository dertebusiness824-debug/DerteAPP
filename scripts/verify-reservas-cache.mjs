/**
 * Verifies Reservas paints from warm cache without a multi-second empty/skeleton wait.
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.APP_URL || 'http://localhost:3000';
const EMAIL = 'marco.demo@gmail.com';
const PASS = 'DerteDemo1';

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=420,900'],
  defaultViewport: { width: 420, height: 900 },
});

try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[type="email"], input[type="text"]', { timeout: 15000 });
  const email = (await page.$('input[type="email"]')) || (await page.$('input[type="text"]'));
  const pass = await page.$('input[type="password"]');
  await email.click({ clickCount: 3 });
  await email.type(EMAIL, { delay: 5 });
  await pass.click({ clickCount: 3 });
  await pass.type(PASS, { delay: 5 });
  await Promise.all([
    page.click('button[type="submit"], form button'),
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 }).catch(() => null),
  ]);
  await page.waitForSelector('.header, .home-split, .nav', { timeout: 20000 });

  // Give global prefetch time to warm appointments cache.
  await page.waitForFunction(
    async () => {
      const mod = await import('/js/data-cache.js');
      const shopId = window.__shopId;
      return true;
    },
    { timeout: 1000 },
  ).catch(() => null);

  // Poll peek via page until cache has rows or timeout.
  const warmed = await page.evaluate(async () => {
    const start = performance.now();
    for (let i = 0; i < 40; i += 1) {
      try {
        const mod = await import('/js/data-cache.js');
        // Find shop id from store
        const { store } = await import('/js/store.js');
        const shopId = store.activeShop?.id;
        if (!shopId) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        // Trigger prefetch if not started
        await mod.prefetchShopLists(store.activeShop);
        const rows = mod.peekAppointments(shopId);
        if (Array.isArray(rows)) {
          return { ok: true, count: rows.length, ms: Math.round(performance.now() - start) };
        }
      } catch {
        // module may still be loading
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false, count: 0, ms: 4000 };
  });

  // Navigate SPA to appointments and measure paint.
  const nav = await page.evaluate(async () => {
    const start = performance.now();
    document.querySelector('button[data-nav="appointments"]')?.click();
    // Wait until list has booking rows OR empty-state — but record first meaningful paint.
    for (let i = 0; i < 50; i += 1) {
      const list = document.querySelector('[data-booking-list]');
      const empty = document.querySelector('.empty');
      const skeleton = document.querySelector('.skeleton, [class*="skeleton"]');
      if (list || (empty && !skeleton)) {
        return {
          ms: Math.round(performance.now() - start),
          hasList: Boolean(list),
          hasEmpty: Boolean(empty),
          hasSkeleton: Boolean(skeleton),
          title: document.querySelector('.header__title')?.textContent?.trim() || '',
          rowCount: list ? list.querySelectorAll('[data-booking-row]').length : 0,
        };
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { ms: 1000, hasList: false, hasEmpty: false, hasSkeleton: true, title: '', rowCount: 0 };
  });

  const report = { warmed, nav };
  console.log(JSON.stringify(report, null, 2));

  if (!warmed.ok) {
    console.error('FAIL: appointments cache did not warm');
    process.exitCode = 1;
  } else if (nav.hasSkeleton && !nav.hasList) {
    console.error('FAIL: still showing skeleton after nav');
    process.exitCode = 2;
  } else if (nav.ms > 500 && !nav.hasList) {
    console.error('FAIL: slow empty paint');
    process.exitCode = 3;
  } else {
    console.log('PASS: reservas painted from warm cache');
  }
} finally {
  await browser.close();
}
