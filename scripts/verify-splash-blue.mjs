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
assert(html.includes('boot__mark'), 'index.html must render the spinning mark');
assert(html.includes('boot__wordmark'), 'index.html must render the derteapp wordmark');
assert(/derteapp/.test(html), 'index.html must include the derteapp wordmark text');
assert(html.includes('logo-mark.svg'), 'splash mark must be the icon, not the combined logo.svg');
assert(html.includes('content="#0ea5e9"'), 'theme-color must match the sky-500 splash');
assert(!html.includes('src="/icons/logo.svg"'), 'launch splash must not use the combined logo.svg');

assert(/\.boot--launch\s*\{[^}]*background:\s*#0ea5e9/.test(css), 'launch background must be sky-500 #0ea5e9');
assert(/\.boot__wordmark\s*\{[^}]*color:\s*#ffffff/.test(css), 'wordmark must be pure white');
assert(css.includes('boot-mark-spin'), 'mark must have a continuous spin keyframe');
assert(css.includes('animation: boot-mark-spin'), 'mark must spin continuously');
assert(css.includes('--boot-lockup-w: min(1188px, 94vw)'), 'lockup must target 3× the 220×40 / 72px logo');
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
  // Hold the splash so we can measure it (boot() dismisses after ~1s).
  await page.evaluateOnNewDocument(() => {
    const hold = document.createElement('script');
    hold.textContent = '';
    window.addEventListener('DOMContentLoaded', () => {
      const boot = document.getElementById('boot');
      if (!boot) return;
      const freeze = boot.cloneNode(true);
      freeze.id = 'boot-measure';
      freeze.style.pointerEvents = 'none';
      document.documentElement.appendChild(freeze);
    });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.boot--launch .boot__brand', { timeout: 10000 });

  const styles = await page.evaluate(() => {
    const boot = document.querySelector('.boot--launch');
    const mark = document.querySelector('.boot--launch .boot__mark');
    const word = document.querySelector('.boot--launch .boot__wordmark');
    const brand = document.querySelector('.boot--launch .boot__brand');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const bootCs = cs(boot);
    const markCs = cs(mark);
    const wordCs = cs(word);
    const brandCs = cs(brand);
    const bootBox = boot?.getBoundingClientRect();
    const brandBox = brand?.getBoundingClientRect();
    return {
      bootBg: bootCs?.backgroundColor,
      bootDisplay: bootCs?.display,
      bootAlign: bootCs?.alignItems,
      bootJustify: bootCs?.justifyContent,
      markFilter: markCs?.filter,
      markAnim: markCs?.animationName,
      markW: mark ? mark.getBoundingClientRect().width : 0,
      markH: mark ? mark.getBoundingClientRect().height : 0,
      wordColor: wordCs?.color,
      wordSize: wordCs ? parseFloat(wordCs.fontSize) : 0,
      wordText: word?.textContent?.trim() || '',
      brandDir: brandCs?.flexDirection,
      brandAlign: brandCs?.alignItems,
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
  assert(styles.brandDir === 'row', 'logo + text must stay on one horizontal row');
  assert(styles.markAnim.includes('boot-mark-spin'), `mark must spin, got ${styles.markAnim}`);
  assert(styles.markW > 40 && styles.markH > 40, `mark should be larger than the old ~24px icon, got ${styles.markW}x${styles.markH}`);
  assert(styles.wordSize > 28, `wordmark should be larger than the old ~22–28px, got ${styles.wordSize}`);

  const cx = styles.viewport.w / 2;
  const cy = styles.viewport.h / 2;
  assert(Math.abs(styles.brandBox.cx - cx) < 20, `lockup should be horizontally centered, cx=${styles.brandBox.cx} vs ${cx}`);
  assert(Math.abs(styles.brandBox.cy - cy) < 30, `lockup should be vertically centered, cy=${styles.brandBox.cy} vs ${cy}`);

  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  await page.screenshot({ path: '/opt/cursor/artifacts/splash_sky_lockup.png', fullPage: false });

  console.log(JSON.stringify({ liveOk: true, styles }, null, 2));
} finally {
  await browser.close();
}
