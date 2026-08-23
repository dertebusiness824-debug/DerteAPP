import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(path.join(root, 'public/css/app.css'), 'utf8');
const shell = readFileSync(path.join(root, 'public/js/shell.js'), 'utf8');
const view = readFileSync(path.join(root, 'public/js/views/urgencias.js'), 'utf8');

describe('urgencias iOS list theme', () => {
  it('keeps filter, card and action bindings', () => {
    assert.match(view, /data-scope=/);
    assert.match(view, /data-urgencia=/);
    assert.match(view, /data-urgencia-open=/);
    assert.match(view, /data-accept-card=/);
    assert.match(view, /data-cancel-card=/);
    assert.match(view, /data-track="call"|data-track='call'|contactButtons\(/);
    assert.match(view, /callPrimary:\s*true/);
    assert.match(view, /Llamar \(\$\{/);
  });

  it('scopes the pale-sky theme to the urgencias shell', () => {
    assert.match(shell, /classList\.toggle\('app--urgencias', isUrgencias\)/);
    assert.match(shell, /classList\.toggle\('nav--urgencias', isUrgencias\)/);
    assert.match(css, /--urgencias-sky:\s*#e3f2fd/);
    assert.match(css, /\.segmented\s*\{[^}]*background:\s*#f1f5f9/s);
    assert.match(view, /class="segmented"/);
    assert.match(view, /list__title/);
    assert.doesNotMatch(view, /urgencia-card__fields/);
    assert.match(css, /\.app--urgencias \.urgencia-status--pending\s*\{[^}]*color:\s*#ef6c00/s);
    assert.match(css, /\.app--urgencias \.kv\s*\{[^}]*border-bottom-color:\s*#f0f4f8/s);
    assert.match(css, /a\[data-track='call'\]\s*\{[^}]*background:\s*#e3f2fd/s);
    assert.match(css, /a\[data-track='whatsapp'\]\s*\{[^}]*background:\s*#e8f5e9/s);
    assert.match(css, /\.nav--urgencias\s*\{[^}]*background:\s*#e3f2fd/s);
    assert.match(css, /\.app--urgencias \.urgencia-card__actions \.btn:not\(\.btn--danger\)\s*\{[^}]*background:\s*#2196f3/s);
    assert.match(css, /\.urgencia-card__actions \.btn--danger[\s\S]*background:\s*#fde8ee/);
  });
});
