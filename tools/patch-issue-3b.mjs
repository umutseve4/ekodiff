/*
 * Tek seferlik yama betigi.
 *
 * Buyuk bir kaynak dosyayi baglamdan yeniden yazmak bayt duzeyinde guvenilir
 * degildir, bu yuzden duzenleme CI icinde deponun kendi dosyalari uzerinde
 * yapilir. Her cengel TAM OLARAK bir kez eslesmek zorundadir; aksi halde
 * hicbir dosyaya yazilmaz ve is kirmizi yanar.
 *
 * Bu dosya, kendisini uygulayan is akisiyla birlikte ayni commit'te silinir.
 */

import { readFile, writeFile } from 'node:fs/promises';

const L = (...lines) => lines.join('\n');

const PATCHES = [
  {
    file: 'tests/live-acceptance.mjs',
    find: L(
      "  // Bilinen sinir: app.js silme sonrasi saveTranscript() cagirdigi icin anahtar",
      "  // bos bir dizi olarak geri yazilabiliyor. Ders verisinin kalmamasi sarttir;",
      "  // anahtarin kendisi issue #3'te ayrica izleniyor.",
      "  check(5, 'Kayitli hicbir ders verisi kalmadi',",
      "    storedAfter === null || storedAfter === '[]', String(storedAfter).slice(0, 80));",
    ),
    replace: L(
      "  // issue #3 kapandi: silme artik anahtarin kendisini de kaldiriyor. Bos bir",
      "  // dizi geri yazmak da kabul edilmez, cunku sayfa altindaki vaat silmenin",
      "  // geri alinamaz oldugunu soyluyor.",
      "  check(5, 'Kayitli anahtarin kendisi de silindi',",
      "    storedAfter === null, String(storedAfter).slice(0, 80));",
    ),
  },
  {
    file: 'tests/live-acceptance.mjs',
    find: L(
      "  check(5, 'Yenilemeden sonra silinen dersler geri gelmedi',",
      "    rowsReload === 0 && (storedReload === null || storedReload === '[]'),",
      "    `satir=${rowsReload} kayit=${String(storedReload)}`);",
    ),
    replace: L(
      "  check(5, 'Yenilemeden sonra silinen dersler geri gelmedi',",
      "    rowsReload === 0 && storedReload === null,",
      "    `satir=${rowsReload} kayit=${String(storedReload)}`);",
      "",
      "  // Temiz bir tarayici baglami: siteyi yalnizca acmak depoya hicbir sey",
      "  // yazmamalidir. Bunu ayni sayfada olcmek yeterli olmaz, cunku o baglamda",
      "  // zaten silme yapilmisti.",
      "  const fresh = await browser.newContext({ viewport: { width: 1280, height: 960 } });",
      "  const freshPage = await fresh.newPage();",
      "  await freshPage.goto(BASE, { waitUntil: 'load', timeout: 60000 });",
      "  await freshPage.waitForSelector('#diff-entries li.entry', { timeout: 30000 });",
      "  await freshPage.click('#tab-time');",
      "  await freshPage.waitForSelector('#panel-time:not([hidden])');",
      "  const freshStored = await freshPage.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);",
      "  check(5, 'Siteyi sadece acmak tarayiciya hicbir sey yazmadi',",
      "    freshStored === null, String(freshStored).slice(0, 80));",
      "  await fresh.close();",
    ),
  },
  {
    file: 'tests/acceptance-mutations.mjs',
    find: L(
      "    why: 'Silme sonrasi durum satiri dogru degilse tur kirmizi yanmalidir.',",
      "  },",
      "];",
    ),
    replace: L(
      "    why: 'Silme sonrasi durum satiri dogru degilse tur kirmizi yanmalidir.',",
      "  },",
      "  {",
      "    id: 'silinen-anahtari-geri-yaz',",
      "    file: 'app.js',",
      "    find: '    if (state.transcript.length === 0) localStorage.removeItem(STORAGE_KEY);\\n    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));',",
      "    replace: '    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));',",
      "    step: 5,",
      "    why: 'Silme sonrasi anahtari bos dizi olarak geri yazmak yakalanmalidir.',",
      "  },",
      "  {",
      "    id: 'acilista-sessizce-yaz',",
      "    file: 'app.js',",
      "    find: '  renderStorageState();\\n  renderTimeMachine();\\n  renderGate();',",
      "    replace: '  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));\\n  renderStorageState();\\n  renderTimeMachine();\\n  renderGate();',",
      "    step: 5,",
      "    why: 'Siteyi sadece acmanin depoya sessizce yazmasi yakalanmalidir.',",
      "  },",
      "];",
    ),
  },
];

const buffers = new Map();
let failed = false;

for (const patch of PATCHES) {
  const current = buffers.has(patch.file)
    ? buffers.get(patch.file)
    : await readFile(patch.file, 'utf8');
  const hits = current.split(patch.find).length - 1;
  if (hits !== 1) {
    failed = true;
    console.log(`::error title=Yama cengeli::${patch.file} icinde cengel ${hits} kez eslesti, 1 bekleniyordu`);
    console.log(patch.find.split('\n').map((line) => `    | ${line}`).join('\n'));
    continue;
  }
  buffers.set(patch.file, current.split(patch.find).join(patch.replace));
}

if (failed) {
  console.log('Hicbir dosyaya yazilmadi.');
  process.exit(1);
}

for (const [file, text] of buffers) {
  await writeFile(file, text);
  console.log(`yamalandi: ${file}`);
}
