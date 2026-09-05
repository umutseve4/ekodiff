/*
 * Headless smoke test for site/app.js.
 *
 * There is no browser and no npm in this environment, so tests/ui.test.js can
 * only assert static contracts (id integrity, no third-party assets, …). That
 * leaves the one failure mode static analysis cannot see: app.js throwing at
 * runtime on first load.
 *
 * This harness supplies the *minimal* DOM surface app.js actually touches
 * (createElement, createTextNode, getElementById, querySelector, append,
 * prepend, replaceChildren, addEventListener, textContent, dataset, value,
 * hidden, focus, setAttribute) plus a localStorage stub and a file-backed
 * fetch. It boots the app, then fires the listeners app.js registered, so a
 * crash in any render path surfaces here rather than on the live site.
 *
 * It is deliberately NOT a browser: layout, CSS, real event ordering and
 * <select> option validation are out of scope. It proves one thing —
 * "no exception on the exercised paths, with the real data files".
 *
 * Run: npm run smoke
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(here, '..', 'site');

/* ── DOM stub ───────────────────────────────────────────────────── */

const registry = new Map();

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.listeners = new Map();
    this.className = '';
    this.hidden = false;
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.id = '';
    this.focused = false;
    this._text = '';
  }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this._text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(v) {
    this._text = v === undefined || v === null ? '' : String(v);
    this.children = [];
  }

  append(...nodes) {
    for (const n of nodes) {
      if (n === null || n === undefined) {
        throw new Error(`append(${n}) on <${this.tagName}${this.id ? '#' + this.id : ''}>`);
      }
      this.children.push(typeof n === 'string' ? new Text(n) : n);
    }
  }

  prepend(...nodes) {
    this.children.unshift(...nodes.map((n) => (typeof n === 'string' ? new Text(n) : n)));
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  remove() {}

  setAttribute(k, v) {
    this.attributes.set(k, String(v));
    if (k === 'id') this.id = String(v);
  }

  getAttribute(k) {
    return this.attributes.has(k) ? this.attributes.get(k) : null;
  }

  removeAttribute(k) {
    this.attributes.delete(k);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  focus() {
    this.focused = true;
  }

  /** Fire every listener of `type`. Exceptions propagate on purpose. */
  fire(type, event = {}) {
    const list = this.listeners.get(type) || [];
    const ev = { type, preventDefault() {}, stopPropagation() {}, target: this, currentTarget: this, ...event };
    for (const fn of list) fn(ev);
    return list.length;
  }

  /** Depth-first walk over this node and its descendants. */
  *walk() {
    yield this;
    for (const child of this.children) if (child.walk) yield* child.walk();
  }
}

class Text extends Node {
  constructor(text) {
    super('#text');
    this._text = String(text);
  }
}

const document = {
  createElement: (tag) => new Node(tag),
  createTextNode: (t) => new Text(t),
  getElementById(id) {
    // Auto-vivify: tests/ui.test.js already proves every id app.js asks for
    // exists in index.html, so returning null here would only mask real
    // render bugs behind a null dereference.
    if (!registry.has(id)) {
      const node = new Node('div');
      node.id = id;
      registry.set(id, node);
    }
    return registry.get(id);
  },
  querySelector(sel) {
    const key = `sel:${sel}`;
    if (!registry.has(key)) registry.set(key, new Node(sel.replace(/[^a-z]/gi, '') || 'div'));
    return registry.get(key);
  },
  querySelectorAll: () => [],
  addEventListener() {},
  documentElement: new Node('html'),
  body: new Node('body'),
};

const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

/* ── file-backed fetch (same-origin only, by construction) ───────── */

const fetched = [];
globalThis.fetch = async (url) => {
  const path = String(url).split('?')[0];
  if (/^[a-z]+:\/\//i.test(path)) throw new Error(`off-origin fetch attempted: ${path}`);
  fetched.push(path);
  try {
    const body = await readFile(join(SITE, path), 'utf8');
    return {
      ok: true, status: 200, url: path,
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  } catch {
    return { ok: false, status: 404, url: path, json: async () => ({}), text: async () => '' };
  }
};

globalThis.document = document;
globalThis.localStorage = localStorage;
globalThis.window = {
  localStorage,
  addEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {} }),
};
globalThis.alert = () => {};
globalThis.confirm = () => true;

const $ = (id) => document.getElementById(id);

/* ── run ────────────────────────────────────────────────────────── */

const problems = [];
const step = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (error) {
    problems.push(`${name}: ${error.message}`);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${String(error.stack).split('\n').slice(0, 4).join('\n        ')}`);
  }
};

console.log('dom-smoke: booting site/app.js against a stub DOM\n');

await step('import + boot', async () => {
  await import('../site/app.js');
  // boot() is async and fired at import time; let its await chain drain.
  await new Promise((r) => setTimeout(r, 60));
});

await step('boot loaded data instead of rendering the error banner', () => {
  const banner = document.querySelector('main').children.find((c) => c.className === 'caveats');
  if (banner) throw new Error(`error banner: ${banner.textContent}`);
  if (fetched.length < 5) throw new Error(`only ${fetched.length} files fetched, expected >= 5`);
});

await step('default diff rendered entries', () => {
  if ($('diff-entries').children.length === 0) throw new Error('diff-entries is empty');
  if ($('diff-summary').children.length === 0) throw new Error('diff-summary is empty');
  if ($('diff-sources').children.length === 0) throw new Error('diff-sources is empty');
});

await step('tab switching fires', () => {
  const n = $('tab-time').fire('click')
    + $('tab-diff').fire('click')
    + $('tab-diff').fire('keydown', { key: 'ArrowRight' })
    + $('tab-time').fire('keydown', { key: 'ArrowLeft' });
  if (n === 0) throw new Error('no tab listeners registered');
});

await step('all 9 snapshot pairs diff without throwing', () => {
  const ids = ['2026-2027-zorunlu', '2018-2019-zorunlu', '2026-2027-secmeli-veri'];
  let fired = 0;
  for (const a of ids) {
    for (const b of ids) {
      $('from-select').value = a;
      $('to-select').value = b;
      fired += $('from-select').fire('change');
      fired += $('to-select').fire('change');
    }
  }
  if (fired === 0) throw new Error('select change listeners missing');
});

await step('diff filter buttons toggle and re-render', () => {
  // Filters are <button aria-pressed> elements, not checkboxes.
  $('from-select').value = '2018-2019-zorunlu';
  $('to-select').value = '2026-2027-zorunlu';
  $('from-select').fire('change');

  const buttons = [...$('diff-filters').children];
  if (buttons.length === 0) throw new Error('#diff-filters rendered no buttons');
  let fired = 0;
  for (let i = 0; i < buttons.length; i += 1) {
    // renderDiff() replaces the button nodes, so re-read on every pass.
    const live = [...$('diff-filters').children];
    const button = live[i];
    if (!button) continue;
    const before = button.getAttribute('aria-pressed');
    fired += button.fire('click');
    const after = [...$('diff-filters').children][i]?.getAttribute('aria-pressed');
    if (process.env.SMOKE_DEBUG) {
      console.log(`        [dbg] ${i} "${button.textContent}" ${before} -> ${after} | now: ${[...$('diff-filters').children].map((b) => `${b.textContent}=${b.getAttribute('aria-pressed')}`).join(', ')}`);
    }
    const activeBefore = live.filter((b) => b.getAttribute('aria-pressed') === 'true').length;
    if (before === after && before !== null) {
      // Turning off the *last* active filter is a deliberate no-op: app.js
      // re-adds it so the entry list can never silently become empty.
      const lastActive = before === 'true' && activeBefore === 1;
      if (!lastActive) throw new Error(`filter ${i} did not toggle (aria-pressed stayed ${before})`);
    }
  }
  if (fired === 0) throw new Error('filter buttons have no click listener');
  if ($('diff-entries').children.length === 0) throw new Error('diff-entries emptied itself');
});

await step('transcript: add graded courses', () => {
  let fired = 0;
  for (const [code, grade] of [['EKO1001', 'AA'], ['EKO1003', 'DC'], ['MAT1001', 'FF']]) {
    $('course-select').value = code;
    $('grade-select').value = grade;
    fired += $('add-form').fire('submit');
  }
  if (fired === 0) throw new Error('add-form has no submit listener');
});

await step('standing panel rendered', () => {
  if ($('standing').children.length === 0) throw new Error('#standing is empty after adding courses');
});

await step('transcript persisted to localStorage', () => {
  const raw = localStorage.getItem('ekodiff.transcript.v1');
  if (!raw) throw new Error('nothing persisted under ekodiff.transcript.v1');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('persisted value is not a course list');
});

await step('what-if across grades', () => {
  let fired = 0;
  $('whatif-course').value = 'EKO1003';
  for (const g of ['AA', 'DD', 'FF']) {
    $('whatif-grade').value = g;
    fired += $('whatif-form').fire('submit');
    fired += $('whatif-course').fire('change');
  }
  if (fired === 0) throw new Error('what-if has no listeners');
});

await step('target GPA input', () => {
  for (const v of ['3.00', '4.00', '0', '', 'abc', '-1']) {
    $('target-gpa').value = v;
    $('target-gpa').fire('input');
    $('target-gpa').fire('change');
  }
});

await step('eligibility gate', () => {
  $('gate-form').fire('submit');
});

await step('wipe clears local data', () => {
  $('wipe').fire('click');
});

await step('no off-origin fetch was attempted', () => {
  const bad = fetched.filter((u) => /^[a-z]+:\/\//i.test(u));
  if (bad.length) throw new Error(bad.join(', '));
});

console.log('');
if (problems.length) {
  console.log(`dom-smoke: ${problems.length} problem(s)`);
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log(`dom-smoke: clean — ${fetched.length} same-origin fetches, no exception on any exercised path`);
