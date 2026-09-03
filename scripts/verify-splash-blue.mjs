/**
 * Verifies the launch splash: sky-500 field, white 3× lockup, spinning mark.
 * Static contract + live computed styles (puppeteer) against a local server.
 */
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.APP_URL || 'http://localhost:3000';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../public/chat.html', import.meta.url), 'utf8');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(html.includes('class="boot boot--launch"'), 'index.html must use boot--launch');
assert(html.includes('class="is-booting"'), 'html must hide chrome until splash dismisses');
assert(html.includes('boot__glyph'), 'index.html must wrap the official mark in one GPU glyph');
assert(!html.includes('boot__tools'), 'launch splash must not render the wrench + hammer X');
assert(!html.includes('boot__tool--wrench'), 'launch splash must not include a wrench');
assert(!html.includes('boot__tool--hammer'), 'launch splash must not include a hammer');
assert(html.includes('boot__ring'), 'index.html may rim the mark during the spin');
assert(html.includes('boot__spin'), 'index.html must wrap the official mark');
assert(html.includes('boot__mark'), 'index.html must render the official mark');
assert(html.includes('boot__wordmark'), 'index.html must render the derteapp wordmark');
assert(/derteapp/.test(html), 'index.html must include the derteapp wordmark text');
assert(html.includes('logo-mark.svg'), 'splash mark must be the icon, not the combined logo.svg');
assert(html.includes('content="#0ea5e9"'), 'theme-color must match the sky-500 splash');
assert(!html.includes('src="/icons/logo.svg"'), 'launch splash must not use the combined logo.svg');

assert(/\.boot--launch\s*\{[^}]*background:\s*#0ea5e9/.test(css), 'launch background must be sky-500 #0ea5e9');
assert(/\.boot__wordmark\s*\{[^}]*color:\s*#ffffff/.test(css), 'wordmark must be pure white');
assert(css.includes('boot-glyph-spin'), 'glyph must spin once');
assert(!css.includes('boot-tools-fuse'), 'tools fuse must be gone');
assert(!css.includes('boot-mark-fuse'), 'mark fuse must be gone');
assert(css.includes('boot-brand-shift'), 'brand must slide left on a GPU transform');
assert(css.includes('boot-word-in'), 'wordmark must fade/slide in on GPU props');
assert(css.includes('animation: boot-glyph-spin'), 'glyph layer must rotate');
assert(css.includes('--boot-type: min(7.5rem, calc(94vw / 6.15))'), 'lockup must target 3× ~40px type, capped to 94vw');
assert(/z-index:\s*100/.test(css), 'launch splash must sit above the bottom nav');
assert(/\.boot\s*\{[^}]*background:\s*#ffffff/.test(css), 'default .boot (chat) must stay white');
assert(chat.includes('class="boot"') && !chat.includes('boot--launch'), 'chat splash must stay on the default .boot');

console.log(JSON.stringify({ staticOk: true }, null, 2));

const browser = await puppeteer.launch({
  executablePath: '/usr/local/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=420,900'],
  defaultViewport: { width: 420, height: 900 },
});

try {
  const page = await browser.newPage();
  // Hold the splash: skip app.js so boot() cannot dismiss it.
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/js/app.js')) return req.abort();
    return req.continue();
  });

  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
  await page.waitForSelector('.boot--launch .boot__brand', { timeout: 10000 });
  await page.evaluate(() => document.fonts.ready);

  const readSplash = () =>
    page.evaluate(() => {
      const boot = document.querySelector('.boot--launch');
      const mark = document.querySelector('.boot--launch .boot__mark');
      const glyph = document.querySelector('.boot--launch .boot__glyph');
      const tools = document.querySelector('.boot--launch .boot__tools');
      const spin = document.querySelector('.boot--launch .boot__spin');
      const word = document.querySelector('.boot--launch .boot__wordmark');
      const brand = document.querySelector('.boot--launch .boot__brand');
      const nav = document.querySelector('.nav');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      const bootCs = cs(boot);
      const markCs = cs(mark);
      const glyphCs = cs(glyph);
      const toolsCs = cs(tools);
      const spinCs = cs(spin);
      const wordCs = cs(word);
      const brandCs = cs(brand);
      const bootBox = boot?.getBoundingClientRect();
      const markBox = mark?.getBoundingClientRect();
      const wordBox = word?.getBoundingClientRect();
      const brandBox = brand?.getBoundingClientRect();
      const lockupLeft = Math.min(markBox?.x ?? 0, wordBox?.x ?? 0);
      const lockupRight = Math.max(
        (markBox?.x ?? 0) + (markBox?.width ?? 0),
        (wordBox?.x ?? 0) + (wordBox?.width ?? 0),
      );
      return {
        bootBg: bootCs?.backgroundColor,
        bootZ: bootCs ? Number(bootCs.zIndex) : 0,
        bootDisplay: bootCs?.display,
        bootAlign: bootCs?.alignItems,
        bootJustify: bootCs?.justifyContent,
        markFilter: markCs?.filter,
        markAnim: markCs?.animationName,
        glyphAnim: glyphCs?.animationName,
        glyphTransform: glyphCs?.transform,
        toolsPresent: Boolean(tools),
        spinAnim: spinCs?.animationName,
        spinOpacity: spinCs ? Number(spinCs.opacity) : 0,
        markW: markBox?.width || 0,
        markH: markBox?.height || 0,
        markCx: markBox ? markBox.x + markBox.width / 2 : 0,
        markCy: markBox ? markBox.y + markBox.height / 2 : 0,
        wordColor: wordCs?.color,
        wordSize: wordCs ? parseFloat(wordCs.fontSize) : 0,
        wordOpacity: wordCs ? Number(wordCs.opacity) : 0,
        wordW: wordBox?.width || 0,
        wordText: word?.textContent?.trim() || '',
        lockupCx: (lockupLeft + lockupRight) / 2,
        lockupW: lockupRight - lockupLeft,
        brandDir: brandCs?.flexDirection,
        brandAlign: brandCs?.alignItems,
        brandTransform: brandCs?.transform,
        navHidden: !nav || cs(nav)?.visibility === 'hidden',
        viewport: { w: window.innerWidth, h: window.innerHeight },
        bootBox: bootBox && { w: bootBox.width, h: bootBox.height, x: bootBox.x, y: bootBox.y },
        brandBox: brandBox && {
          w: brandBox.width,
          h: brandBox.height,
          cx: brandBox.x + brandBox.width / 2,
          cy: brandBox.y + brandBox.height / 2,
        },
      };
    });

  const styles = await readSplash();

  const rgb = (c) => {
    const m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const bootRgb = rgb(styles.bootBg);
  const wordRgb = rgb(styles.wordColor);
  assert(bootRgb && bootRgb[0] < 40 && bootRgb[1] > 150 && bootRgb[2] > 200, `splash bg should be sky-500, got ${styles.bootBg}`);
  assert(wordRgb && wordRgb.every((n) => n >= 250), `wordmark must be #FFFFFF, got ${styles.wordColor}`);
  assert(styles.wordText === 'derteapp', `wordmark text must be derteapp, got ${styles.wordText}`);
  assert(styles.bootDisplay === 'flex', 'splash must be a flex box');
  assert(styles.bootAlign === 'center' && styles.bootJustify === 'center', 'splash must center the lockup');
  assert(styles.bootZ >= 100, `launch splash must cover the nav, z=${styles.bootZ}`);
  assert(styles.brandDir === 'row', 'logo + text must stay on one horizontal row');
  assert(styles.glyphAnim.includes('boot-glyph-spin'), `glyph must spin, got ${styles.glyphAnim}`);
  assert(!styles.toolsPresent, 'tools X must not be in the splash');
  assert(!styles.markAnim || styles.markAnim === 'none', `mark itself must not animate, got ${styles.markAnim}`);
  assert(styles.markW > 72 && styles.markH > 72, `mark should stay large on the sky field, got ${styles.markW}x${styles.markH}`);
  assert(styles.wordOpacity < 0.15, `wordmark starts hidden, got opacity ${styles.wordOpacity}`);
  assert(styles.spinOpacity > 0.85, `official mark starts visible, got opacity ${styles.spinOpacity}`);

  const cx = styles.viewport.w / 2;
  const cy = styles.viewport.h / 2;
  assert(Math.abs(styles.markCx - cx) < 24, `mark should start on the viewport center, cx=${styles.markCx} vs ${cx}`);
  assert(Math.abs(styles.markCy - cy) < 36, `mark should start vertically centered, cy=${styles.markCy} vs ${cy}`);

  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  const spin0 = await page.$eval('.boot--launch .boot__glyph', (el) => getComputedStyle(el).transform);
  await page.screenshot({ path: '/opt/cursor/artifacts/splash_mark_center.png', fullPage: false });
  await new Promise((r) => setTimeout(r, 520));
  const spin1 = await page.$eval('.boot--launch .boot__glyph', (el) => getComputedStyle(el).transform);
  await page.screenshot({ path: '/opt/cursor/artifacts/splash_mark_spin_frame.png', fullPage: false });
  assert(spin0 !== spin1, `glyph must rotate once the fuse starts, got ${spin0} then ${spin1}`);
  styles.spin0 = spin0;
  styles.spin1 = spin1;

  await new Promise((r) => setTimeout(r, 1600));
  const after = await readSplash();
  assert(after.wordOpacity > 0.9, `wordmark must appear after the slide, got ${after.wordOpacity}`);
  assert(after.wordSize > 55, `wordmark should be ~3× the old ~40px type, got ${after.wordSize}`);
  assert(after.markCx < cx - 20, `mark must slide left of center, markCx=${after.markCx} vs ${cx}`);
  assert(
    Math.abs(after.lockupCx - cx) < 28,
    `revealed lockup should be centered, cx=${after.lockupCx} vs ${cx} (wordW=${after.wordW})`,
  );
  await page.screenshot({ path: '/opt/cursor/artifacts/splash_sky_lockup.png', fullPage: false });
  styles.after = after;

  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1280, height: 800 });
  await desktop.setRequestInterception(true);
  desktop.on('request', (req) => {
    if (req.url().includes('/js/app.js')) return req.abort();
    return req.continue();
  });
  await desktop.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
  await desktop.evaluate(() => document.fonts.ready);
  await desktop.screenshot({ path: '/opt/cursor/artifacts/splash_sky_lockup_desktop.png', fullPage: false });
  await desktop.close();

  console.log(JSON.stringify({ liveOk: true, styles }, null, 2));
} finally {
  await browser.close();
}
