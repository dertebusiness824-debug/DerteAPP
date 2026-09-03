/**
 * Live check: Inicio gate type, glass, and symmetric copy around the mark.
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

function near(actual, expected, tol, label) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected}±${tol}, got ${actual}`,
  );
}

async function measureGate(page) {
  return page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const welcome = document.querySelector('.home-split__welcome');
    const hint = document.querySelector('.home-split__trigger-hint');
    const trigger = document.querySelector('.home-split__trigger');
      const mark = document.querySelector('.home-split__trigger-mark');
    const vcs = cs(welcome);
    const ncs = cs(hint);
    const tcs = cs(trigger);
    const mcs = cs(mark);
    const wr = welcome?.getBoundingClientRect();
    const hr = hint?.getBoundingClientRect();
    const tr = trigger?.getBoundingClientRect();
    const mr = mark?.getBoundingClientRect();
    return {
      welcomeText: welcome?.textContent?.trim() || '',
      welcomeSize: vcs ? parseFloat(vcs.fontSize) : null,
      welcomeWeight: vcs?.fontWeight,
      welcomeColor: vcs?.color,
      welcomeShadow: vcs?.textShadow || '',
      welcomeFamily: vcs?.fontFamily || '',
      hintText: hint?.textContent?.trim() || '',
      hintSize: ncs ? parseFloat(ncs.fontSize) : null,
      hintWeight: ncs?.fontWeight,
      hintColor: ncs?.color,
      hintInsideTrigger: Boolean(trigger?.contains(hint)),
      triggerBg: tcs?.backgroundColor,
      triggerBlur: tcs?.backdropFilter || tcs?.webkitBackdropFilter || '',
      triggerBorder: tcs?.border,
      triggerBorderWidth: tcs?.borderTopWidth,
      triggerShadow: tcs?.boxShadow || '',
      triggerPad: tcs?.padding,
      markW: mcs ? parseFloat(mcs.width) : null,
      markSvgPaths: mark
        ? [...mark.querySelectorAll('path')].map((p) => p.getAttribute('d') || '').join(' ')
        : '',
      welcomeBottomToTrigger: wr && tr ? tr.top - wr.bottom : null,
      triggerBottomToHint: hr && tr ? hr.top - tr.bottom : null,
      markCenterX: mr ? mr.left + mr.width / 2 : null,
      triggerCenterX: tr ? tr.left + tr.width / 2 : null,
      markCenterY: mr ? mr.top + mr.height / 2 : null,
      triggerCenterY: tr ? tr.top + tr.height / 2 : null,
    };
  });
}

try {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'owner1.test@gmail.com', password: 'DerteDemo1' }),
  });
  const session = await login.json();
  assert(session.token, `login failed: ${JSON.stringify(session).slice(0, 200)}`);

  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await page.evaluateOnNewDocument((token) => {
    localStorage.setItem('derte_token', token);
  }, session.token);
  await page.goto(`${BASE}/#/home`, { waitUntil: 'networkidle0', timeout: 20000 });
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
  await page.evaluate(() => document.fonts.ready);

  const iphone = await measureGate(page);
  await page.screenshot({ path: '/opt/cursor/artifacts/inicio_gate_type_iphone_390.png' });
  console.log('IPHONE', iphone);

  assert(iphone.welcomeText === 'Bienvenido/a de nuevo', `welcome text: ${iphone.welcomeText}`);
  assert(iphone.hintText === 'Pulsa para desplegar', `hint text: ${iphone.hintText}`);
  near(iphone.welcomeSize, 19, 1, 'welcome size');
  assert(['550', '500', '600'].includes(String(iphone.welcomeWeight)), `welcome weight ${iphone.welcomeWeight}`);
  assert(iphone.welcomeFamily.includes('Outfit'), `font ${iphone.welcomeFamily}`);
  assert(iphone.welcomeColor === 'rgb(255, 255, 255)', `welcome color ${iphone.welcomeColor}`);
  assert(iphone.welcomeShadow.includes('255, 255, 255'), `welcome glow must be white, got ${iphone.welcomeShadow}`);
  assert(!iphone.welcomeShadow.includes('165, 243, 252'), 'welcome glow must not be ice-cyan');
  near(iphone.hintSize, 14, 0.5, 'hint size');
  assert(['400', '450', '300'].includes(String(iphone.hintWeight)), `hint weight ${iphone.hintWeight}`);
  assert(iphone.hintColor === 'rgba(255, 255, 255, 0.8)', `hint color ${iphone.hintColor}`);
  assert(!iphone.hintInsideTrigger, 'hint must sit outside the scaled trigger');
  assert(iphone.triggerBg === 'rgba(255, 255, 255, 0.06)', `glass bg ${iphone.triggerBg}`);
  assert(iphone.triggerBlur.includes('blur(16px)'), `blur ${iphone.triggerBlur}`);
  assert(
    iphone.triggerBorderWidth === '1.5px' || iphone.triggerBorder.includes('1.5px') || iphone.triggerBorder.includes('1px'),
    `border ${iphone.triggerBorderWidth} / ${iphone.triggerBorder}`,
  );
  assert(iphone.triggerShadow.includes('25px'), `neon ${iphone.triggerShadow}`);
  assert(iphone.triggerPad === '20px', `padding ${iphone.triggerPad}`);
  near(iphone.markW, 48, 2, 'mark width');
  assert(iphone.markSvgPaths.includes('M14 42'), `official mark paths, got ${iphone.markSvgPaths.slice(0, 40)}`);
  near(iphone.welcomeBottomToTrigger, iphone.triggerBottomToHint, 2, 'symmetric copy gap');
  assert(iphone.welcomeBottomToTrigger >= 16, `copy gap too tight: ${iphone.welcomeBottomToTrigger}`);
  near(iphone.markCenterX, iphone.triggerCenterX, 2, 'mark X center');
  near(iphone.markCenterY, iphone.triggerCenterY, 2, 'mark Y center');

  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
  });
  await new Promise((r) => setTimeout(r, 200));
  const android = await measureGate(page);
  await page.screenshot({ path: '/opt/cursor/artifacts/inicio_gate_type_android_412.png' });
  console.log('ANDROID', android);
  near(android.welcomeBottomToTrigger, android.triggerBottomToHint, 6, 'android symmetric copy gap');
  near(android.welcomeSize, 19, 1, 'android welcome size');
  near(android.hintSize, 14, 0.5, 'android hint size');

  console.log(JSON.stringify({ ok: true, iphone, android }, null, 2));
} finally {
  await browser.close();
}
