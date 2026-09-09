/*
 * Tek seferlik yama kosumu: issue #3.
 *
 * Neden bir betik: bu depoyu duzenleyen ajanin calisma alani github.com'a
 * erisemiyor, dolayisiyla buyuk bir dosyayi "tamamini yeniden yaz" seklinde
 * gondermek, gorunmez bir karakteri kazara degistirme riski tasiyor. Bunun
 * yerine yama, dosyanin gercek kopyasi uzerinde CI icinde uygulanir.
 *
 * Guvenlik agi: her cengel tam olarak BIR kez bulunmak zorunda. Bulunamazsa
 * ya da birden fazla yerde eslesirse betik hata verir ve hicbir sey yazilmaz.
 * Sessizce atlanan bir yama, uygulanmamis bir duzeltme demektir.
 *
 * Bu dosya ve onu calistiran is akisi, yama commit'inde silinir.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PATCHES = [
  {
    id: 'app: bos liste anahtari silsin',
    file: 'site/app.js',
    find: [
      'function saveTranscript() {',
      '  try {',
      '    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));',
      '  } catch {',
    ].join('\n'),
    replace: [
      'function saveTranscript() {',
      '  try {',
      '    // Bos bir liste kayit degildir. "[]" geri yazmak, hem sayfayi sadece',
      '    // acmanin hem de "tum verimi sil" dugmesinin arkada bir anahtar',
      '    // birakmasi demek olurdu; bu, sayfa altindaki vaadin tersidir.',
      '    if (state.transcript.length === 0) localStorage.removeItem(STORAGE_KEY);',
      '    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));',
      '  } catch {',
    ].join('\n'),
  },
  {
    id: 'app: durum satirini ayri fonksiyona ayir',
    file: 'site/app.js',
    find: [
      '  }',
      '  const count = state.transcript.length;',
      "  $('storage-state').textContent = count === 0",
    ].join('\n'),
    replace: [
      '  }',
      '  renderStorageState();',
      '}',
      '',
      '/* Yalnizca durum satirini tazeler, hicbir sey kaydetmez. Kaydetmek ile',
      ' * ekrana yazmak ayni fonksiyonda oldugu surece, sadece etiketi tazelemek',
      ' * isteyen her cagri istemeden depoya da yaziyordu. issue #3 tam olarak',
      ' * bu karisimdan dogmustu. */',
      'function renderStorageState() {',
      '  const count = state.transcript.length;',
      "  $('storage-state').textContent = count === 0",
    ].join('\n'),
  },
  {
    id: 'app: wipe icindeki ikinci yazmayi kaldir',
    file: 'site/app.js',
    find: [
      '    state.transcript = [];',
      '    try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to remove */ }',
      '    saveTranscript();',
    ].join('\n'),
    replace: [
      '    // saveTranscript() bos listede anahtari zaten siler, bu yuzden',
      '    // anahtari geri diriltebilecek ikinci bir yazma kalmadi.',
      '    state.transcript = [];',
      '    saveTranscript();',
    ].join('\n'),
  },
  {
    id: 'app: acilista kaydetme, yalnizca goster',
    file: 'site/app.js',
    find: [
      '',
      '  saveTranscript();',
      '  renderTimeMachine();',
      '  renderGate();',
      '}',
    ].join('\n'),
    replace: [
      '',
      '  // Acilista yalnizca durum satiri tazelenir. Burada kaydetmek, sayfayi',
      '  // sadece acmanin bile depoya yazmasi anlamina gelirdi.',
      '  renderStorageState();',
      '  renderTimeMachine();',
      '  renderGate();',
      '}',
    ].join('\n'),
  },
  {
    id: 'dom-smoke: acilis hicbir sey yazmamali',
    file: 'tools/dom-smoke.mjs',
    find: "await step('boot loaded data instead of rendering the error banner', () => {",
    replace: [
      "await step('booting alone wrote nothing to localStorage', () => {",
      '  // issue #3: siteyi sadece acmak bir anahtar olusturmamali.',
      "  const raw = localStorage.getItem('ekodiff.transcript.v1');",
      '  if (raw !== null) throw new Error(`boot created the key: ${raw}`);',
      '});',
      '',
      "await step('boot loaded data instead of rendering the error banner', () => {",
    ].join('\n'),
  },
  {
    id: 'dom-smoke: wipe anahtari geride birakmamali',
    file: 'tools/dom-smoke.mjs',
    find: [
      "await step('wipe clears local data', () => {",
      "  $('wipe').fire('click');",
      '});',
    ].join('\n'),
    replace: [
      "await step('wipe clears local data', () => {",
      "  $('wipe').fire('click');",
      '  // issue #3: silme, geride bos bir dizi bile birakmamali. Anahtarin',
      '  // kendisi durdugu surece "hepsini sil" vaadi karsilanmamis olur.',
      "  const raw = localStorage.getItem('ekodiff.transcript.v1');",
      '  if (raw !== null) throw new Error(`wipe left a key behind: ${raw}`);',
      '});',
    ].join('\n'),
  },
];

let failed = 0;
const touched = new Map();

for (const patch of PATCHES) {
  const target = join(ROOT, patch.file);
  const before = touched.has(target) ? touched.get(target) : await readFile(target, 'utf8');
  const hits = before.split(patch.find).length - 1;
  if (hits !== 1) {
    failed += 1;
    console.log(`::error title=Yama cengeli::${patch.id} -> ${patch.file} icinde ${hits} eslesme (1 bekleniyordu)`);
    continue;
  }
  touched.set(target, before.split(patch.find).join(patch.replace));
  console.log(`  uygulandi  ${patch.id}`);
}

if (failed > 0) {
  console.log(`\nYama FAIL: ${failed} cengel tam olarak bir kez eslesmedi. Hicbir dosya yazilmadi.`);
  process.exit(1);
}

for (const [target, content] of touched) {
  await writeFile(target, content);
}

console.log(`\nYama PASS: ${PATCHES.length} degisiklik, ${touched.size} dosya.`);
