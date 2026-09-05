/**
 * Static contract tests for the browser layer.
 *
 * There is no headless browser in this project's CI, so instead of pretending
 * to test the DOM we test the two things that actually break silently in a
 * no-build static site: an element id that app.js reaches for and index.html
 * no longer has, and a network call that quietly leaves the origin.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(path.join(root, ...parts), 'utf8');

const html = read('site', 'index.html');
const app = read('site', 'app.js');
const css = read('site', 'style.css');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// Ids reach app.js two ways: literally as $('x'), and as strings fed to $() in
// a loop. Collecting every quoted string covers both without false alarms.
const lookedUpIds = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
const quotedStrings = new Set([...app.matchAll(/'([^'\n]+)'/g)].map((m) => m[1]));
const referencedIds = new Set([...lookedUpIds, ...quotedStrings].filter((s) => htmlIds.has(s) || lookedUpIds.has(s)));

test('every id app.js reaches for exists in index.html', () => {
  const missing = [...referencedIds].filter((id) => !htmlIds.has(id));
  assert.deepEqual(missing, [], `index.html is missing: ${missing.join(', ')}`);
});

test('every interactive id in index.html is actually wired up', () => {
  const interactive = [...html.matchAll(/<(?:select|input|button|form)\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
  const orphans = interactive.filter((id) => !referencedIds.has(id));
  assert.deepEqual(orphans, [], `declared but never used by app.js: ${orphans.join(', ')}`);
});

test('the only network calls are same-origin static data files', () => {
  const fetches = [...app.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(fetches.length > 0, 'expected at least one data fetch');
  for (const call of fetches) {
    assert.equal(/https?:\/\//.test(call), false, `absolute URL in fetch: ${call}`);
  }
  for (const forbidden of ['XMLHttpRequest', 'navigator.sendBeacon', 'new WebSocket', 'googletagmanager', 'analytics']) {
    assert.equal(app.includes(forbidden), false, `app.js must not contain ${forbidden}`);
  }
});

test('the page loads no third-party assets', () => {
  const urls = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  const offenders = urls.filter((u) => !u.startsWith('https://github.com/'));
  assert.deepEqual(offenders, [], `third-party assets: ${offenders.join(', ')}`);
});

test('the "not official" disclaimer is present on the page itself', () => {
  assert.match(html, /Bursa Uludağ Üniversitesi\s*\n?\s*tarafından hazırlanmamış/);
  assert.match(html, /Bağımsız öğrenci projesi/i);
});

test('the privacy claim and the wipe control both exist', () => {
  assert.match(html, /localStorage/);
  assert.match(html, /Tüm verimi sil/);
  assert.ok(referencedIds.has('wipe'));
  assert.match(app, /localStorage\.removeItem/);
});

test('the site never promises a letter grade', () => {
  // The one thing relative assessment makes impossible must not be implied.
  assert.match(html, /harf notu (üretmez|→)/i);
  assert.match(app, /letterGradeNote/);
});

test('motion is fully opt-out', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const block = css.slice(css.indexOf('prefers-reduced-motion'));
  assert.match(block, /animation-duration:\s*0\.001ms\s*!important/);
  assert.match(block, /transition-duration:\s*0\.001ms\s*!important/);
});

test('a skip link and visible focus styling exist', () => {
  assert.match(html, /class="skip"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.skip:focus/);
});

test('the module scripts the page loads actually exist', () => {
  assert.match(html, /<script type="module" src="app\.js">/);
  for (const spec of [...app.matchAll(/from '(\.\/[^']+)'/g)].map((m) => m[1])) {
    assert.doesNotThrow(() => read('site', spec.replace('./', '')), `${spec} not found`);
  }
});
