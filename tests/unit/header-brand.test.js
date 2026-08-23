import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const html = readFileSync(path.join(root, 'public/index.html'), 'utf8');

describe('global header brand lockup', () => {
  it('paints logo + derteapp with the same brand blue on every header', () => {
    assert.match(html, /app\.css\?v=48-ios-polish/);
    assert.match(css, /--brand:\s*#0ea5e9/);
    assert.match(css, /\.header__wordmark\s*\{[^}]*color:\s*var\(--brand\)/s);
    assert.match(css, /\.header__logo\s*\{[^}]*filter:\s*brightness\(0\)/s);
    assert.doesNotMatch(css, /\.header__wordmark\s*\{[^}]*color:\s*#0f2942/s);
    assert.doesNotMatch(css, /\.app--reservas \.header__wordmark/);
    assert.doesNotMatch(css, /\.app--urgencias \.header__wordmark/);
    assert.doesNotMatch(css, /\.app--home \.header__wordmark/);
    assert.doesNotMatch(css, /\.app--home \.header__logo\s*\{/);
  });

  it('keeps the launch splash as white lockup on brand blue', () => {
    assert.match(html, /theme-color" content="#0ea5e9"/);
    assert.match(css, /\.boot--launch\s*\{[^}]*background:\s*#0ea5e9/s);
    assert.match(css, /\.boot__wordmark\s*\{[^}]*color:\s*#ffffff/s);
  });
});
