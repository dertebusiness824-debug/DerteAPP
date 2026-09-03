/**
 * Live check: splash lockup is naked, Inicio gate shows lockup + welcome + hint.
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.APP_URL || 'http://127.0.0.1:3000';
mkdirSync('/opt/cursor/artifacts', { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=390,844'],
  defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 },
});

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

try {
  const splash = await browser.newPage();
  await splash.setRequestInterception(true);
  splash.on('request', (req) => {
    if (req.url().includes('/js/app.js')) return req.abort();
    return req.continue();
  });
  await splash.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
  await splash.evaluate(() => document.fonts.ready);
  await splash.evaluate(() => {
    document.getAnimations().forEach((anim) => {
      try {
        anim.pause();
        anim.currentTime = 2200;
      } catch {
        /* ignore */
      }
    });
  });
  const splashState = await splash.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const ring = cs(document.querySelector('.boot__ring'));
    const glow = cs(document.querySelector('.boot__glow'));
    const word = document.querySelector('.boot__wordmark');
    const logo = cs(document.querySelector('.header__logo'));
    return {
      ringOp: ring ? Number(ring.opacity) : null,
      glowOp: glow ? Number(glow.opacity) : null,
      word: word?.textContent?.trim() || '',
      wordOp: word ? Number(getComputedStyle(word).opacity) : null,
      headerLogoBg: logo?.backgroundColor,
      headerLogoShadow: logo?.boxShadow,
      headerLogoBorder: logo?.border,
    };
  });
  await splash.screenshot({ path: '/opt/cursor/artifacts/splash_lockup_naked.png' });
  console.log('SPLASH', splashState);
  assert(splashState.ringOp === 0, `ring should be gone, got ${splashState.ringOp}`);
  assert(splashState.glowOp === 0, `glow should be gone, got ${splashState.glowOp}`);
  assert(splashState.word === 'derteapp', 'wordmark must read derteapp');
  assert(splashState.wordOp > 0.9, `wordmark should be visible, got ${splashState.wordOp}`);
  await splash.close();

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1.test@gmail.com', password: 'DerteDemo1' }),
  });
  const session = await login.json();
  assert(session.token, `login failed: ${JSON.stringify(session).slice(0, 200)}`);

  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.evaluateOnNewDocument((token) => {
    localStorage.setItem('derte_token', token);
  }, session.token);
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle0', timeout: 20000 });
  await page.evaluate(async () => {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    if (regs) await Promise.all(regs.map((reg) => reg.unregister()));
    const keys = await caches?.keys?.();
    if (keys) await Promise.all(keys.map((key) => caches.delete(key)));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const boot = document.getElementById('boot');
    if (boot) {
      boot.classList.add('is-done');
      boot.remove();
    }
    document.documentElement.classList.remove('is-booting');
  });
  await page.waitForSelector('.home-split__welcome', { timeout: 15000 });
  await page.waitForFunction(() => document.documentElement.classList.contains('is-home-gate'), {
    timeout: 10000,
  });

  const gate = await page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const header = document.querySelector('.header');
    const logo = document.querySelector('.header__logo');
    const word = document.querySelector('.header__wordmark');
    const welcome = document.querySelector('.home-split__welcome');
    const hint = document.querySelector('.home-split__trigger-hint');
    const title = document.querySelector('.header__title');
    const lang = document.querySelector('.header__lang');
    const hcs = cs(header);
    const lcs = cs(logo);
    const wcs = cs(word);
    const vcs = cs(welcome);
    const ncs = cs(hint);
    return {
      hash: location.hash,
      headerOp: hcs ? Number(hcs.opacity) : null,
      headerBg: hcs?.backgroundColor,
      headerBorder: hcs?.borderBottomColor,
      logoFilter: lcs?.filter,
      logoBg: lcs?.backgroundColor,
      logoShadow: lcs?.boxShadow,
      logoBorder: lcs?.borderWidth,
      logoPad: lcs?.padding,
      wordColor: wcs?.color,
      wordText: word?.textContent?.trim() || '',
      welcomeText: welcome?.textContent?.trim() || '',
      welcomeColor: vcs?.color,
      welcomeShadow: vcs?.textShadow,
      welcomeDisplay: vcs?.display,
      hintText: hint?.textContent?.trim() || '',
      hintSize: ncs ? parseFloat(ncs.fontSize) : null,
      hintWeight: ncs?.fontWeight,
      hintColor: ncs?.color,
      titleOp: title ? Number(cs(title).opacity) : null,
      langVis: lang ? cs(lang).visibility : null,
    };
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/inicio_gate_welcome.png' });
  console.log('GATE', gate);
  assert(gate.headerOp === 1, `header should be visible on gate, op=${gate.headerOp}`);
  assert(gate.wordText === 'derteapp', 'gate lockup must include derteapp');
  assert(gate.welcomeText === 'Bienvenido/a de nuevo', `welcome text, got ${gate.welcomeText}`);
  assert(gate.hintText === 'Pulsa para desplegar', `hint text, got ${gate.hintText}`);
  assert(gate.logoBg === 'rgba(0, 0, 0, 0)', `logo must be naked, bg=${gate.logoBg}`);
  assert(gate.logoShadow === 'none', `logo must have no glow, shadow=${gate.logoShadow}`);
  assert(gate.logoFilter.includes('invert'), `gate logo must be white, filter=${gate.logoFilter}`);

  const toggle = await page.$('[data-home-logo-toggle]');
  await toggle.click();
  await page.waitForFunction(() => !document.documentElement.classList.contains('is-home-gate'), {
    timeout: 4000,
  });
  await page.screenshot({
    path: '/opt/cursor/artifacts/header_lockup_naked.png',
    clip: { x: 0, y: 0, width: 390, height: 140 },
  });
  const opened = await page.evaluate(() => {
    const logo = document.querySelector('.header__logo');
    const welcome = document.querySelector('.home-split__welcome');
    const cs = getComputedStyle(logo);
    return {
      logoBg: cs.backgroundColor,
      logoShadow: cs.boxShadow,
      logoPad: cs.padding,
      welcomeDisplay: welcome ? getComputedStyle(welcome).display : null,
    };
  });
  console.log('OPEN', opened);
  assert(opened.logoBg === 'rgba(0, 0, 0, 0)', `opened header logo must be naked, bg=${opened.logoBg}`);
  assert(opened.logoShadow === 'none', `opened header logo must have no glow`);
  assert(opened.welcomeDisplay === 'none', 'welcome must hide after gate opens');

  console.log(JSON.stringify({ ok: true, splashState, gate, opened }, null, 2));
} finally {
  await browser.close();
}
