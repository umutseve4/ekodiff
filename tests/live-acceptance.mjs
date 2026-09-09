/*
 * Canli kabul turu: yayindaki siteyi gercek bir Chromium'da surer.
 *
 * Neden var: repodaki testler modulleri, dom-smoke ise app.js'in stub bir DOM
 * uzerinde patlamadigini kanitlar. Ikisi de "yayindaki adres bugun dogru
 * davraniyor mu" sorusuna cevap vermez. Bu dosya tam olarak o boslugu kapatir
 * ve QA'in bes adimlik kabul turunu insan eli olmadan tekrar eder.
 *
 * Calistirma:
 *   PLAYWRIGHT_PATH=<...>/node_modules/playwright/index.mjs \
 *     node tests/live-acceptance.mjs [url]
 *
 * Bilerek disarida birakilanlar: gorsel regresyon, mobil yerlesim, gercek
 * klavye gezinmesi. Bu dosya davranis iddialarini olcer, estetigi degil.
 */

// Playwright repo bagimliligi degildir ve olmayacaktir: package.json'daki
// "sifir bagimlilik" iddiasi verify.yml tarafindan denetleniyor. Bu yuzden
// modul, CI'da repo disina kurulur ve yolu PLAYWRIGHT_PATH ile verilir.
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

const BASE = (process.argv[2] || process.env.EKODIFF_URL || 'https://umutseve4.github.io/ekodiff/')
  .replace(/\/*$/, '/');
const STORAGE_KEY = 'ekodiff.transcript.v1';

let total = 0;
let failed = 0;

function check(step, label, condition, detail = '') {
  total += 1;
  const ok = Boolean(condition);
  if (!ok) failed += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${step}. ${label}${detail ? `  ::  ${detail}` : ''}`);
  if (!ok) console.log(`::error title=Kabul turu adim ${step}::${label}${detail ? ` (${detail})` : ''}`);
}

const flat = (s) => String(s).replace(/\s+/g, ' ').trim();

async function standingStats(page) {
  // dd = deger metni + istege bagli <span class="note">. Ikisi bitisik
  // okunursa "58" ile "240 gerekiyor" birleserek 58240 olur, o yuzden
  // deger ilk cocuk dugumden, not ayri alinir.
  const raw = await page.$$eval('#standing .stat', (nodes) => nodes.map((n) => {
    const dd = n.querySelector('dd');
    const note = dd.querySelector('.note');
    return {
      term: n.querySelector('dt').textContent,
      value: (dd.firstChild ? dd.firstChild.textContent : '').trim(),
      note: note ? note.textContent : '',
      state: n.dataset.state || '',
    };
  }));
  const map = new Map();
  for (const item of raw) map.set(item.term.replace(/\s+/g, ' ').trim(), item);
  return map;
}

async function entries(page) {
  return page.$$eval('#diff-entries li.entry', (nodes) => nodes.map((n) => ({
    kind: n.dataset.kind,
    text: n.innerText.replace(/\s+/g, ' ').trim(),
  })));
}

async function addCourse(page, code, grade) {
  await page.selectOption('#course-select', code);
  await page.selectOption('#grade-select', grade);
  await page.click('#add-form button[type="submit"]');
  await page.waitForTimeout(150);
}

async function run() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const foreign = [];
  const origin = new URL(BASE).origin;

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(flat(m.text())); });
  page.on('pageerror', (e) => consoleErrors.push(flat(String(e))));
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('about:')) foreign.push(url);
  });

  console.log(`Hedef: ${BASE}\n`);

  /* Adim 0: site ayakta ve veri yukleniyor */
  const response = await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
  check(0, 'Yayindaki adres HTTP 200 dondu', response && response.status() === 200,
    response ? `HTTP ${response.status()}` : 'yanit yok');
  await page.waitForSelector('#diff-entries li.entry', { timeout: 30000 });
  const banner = await page.$('main > .caveats');
  check(0, 'Veri yuklendi, hata afisi basilmadi', banner === null);

  /* Adim 1: iki RECODED, gorulemeyenler UNKNOWN_ADDED */
  console.log('\nAdim 1 : 2018-2019 zorunlu  ->  2026-2027 zorunlu');
  await page.selectOption('#from-select', '2018-2019-zorunlu');
  await page.selectOption('#to-select', '2026-2027-zorunlu');
  await page.waitForTimeout(250);

  const list = await entries(page);
  const byKind = (kind) => list.filter((e) => e.kind === kind);
  const recoded = byKind('recoded');
  const removed = byKind('removed');
  const added = byKind('added');
  const unknownAdded = byKind('unknown-added');
  const recodedText = recoded.map((e) => e.text).join(' | ');

  // Arsiv anlik goruntusu bilerek yalnizca iki dersi tasir ve ikisinin de kodu
  // degismistir: MAT1501 -> EKO1001, MAT1502 -> EKO1002. Eski taraftan
  // eslesmeyen ders kalmadigi icin "kaldirildi" sorusu hic dogmaz; asil
  // epistemik sinav ters yondedir: yeni plandaki dersler, kismi bir arsivle
  // karsilastirildigi icin "eklendi" diye ILAN EDILEMEZ.
  check(1, 'Iki ders de "kodu degisti" olarak eslesti', recoded.length === 2, `recoded=${recoded.length}`);
  check(1, 'MAT1501 -> EKO1001 eslesmesi ekranda',
    recodedText.includes('MAT1501') && recodedText.includes('EKO1001'), recodedText.slice(0, 140));
  check(1, 'MAT1502 -> EKO1002 eslesmesi ekranda',
    recodedText.includes('MAT1502') && recodedText.includes('EKO1002'), recodedText.slice(0, 140));
  check(1, 'MAT1501 ayrica silinmis/eklenmis diye ikinci kez listelenmiyor',
    !list.some((e) => e.kind !== 'recoded' && e.text.includes('MAT1501')));
  check(1, 'Kismi arsive dayanarak hicbir ders kesin "kaldirildi" denmiyor',
    removed.length === 0, `removed=${removed.length}`);
  check(1, 'Kismi arsive dayanarak hicbir ders kesin "eklendi" denmiyor',
    added.length === 0, `added=${added.length}`);
  check(1, 'Yeni plandaki dersler "eklendi mi? bilinmiyor" olarak isaretli',
    unknownAdded.length > 0, `unknown-added=${unknownAdded.length}`);

  const caveats1 = flat(await page.locator('#diff-caveats').innerText());
  check(1, 'Kismi veri uyarisi ekranda ve kesinlik dili kullanilmiyor',
    caveats1.length > 0 && !caveats1.includes('kanıtlıdır'), caveats1.slice(0, 140));

  /* Adim 2: kapsam uyusmazligi */
  console.log('\nAdim 2 : uyumsuz kapsam (zorunlu  ->  secmeli veri)');
  await page.selectOption('#from-select', '2026-2027-zorunlu');
  await page.selectOption('#to-select', '2026-2027-secmeli-veri');
  await page.waitForTimeout(250);
  const caveats2 = flat(await page.locator('#diff-caveats').innerText());
  const caveatCount = await page.$$eval('#diff-caveats p', (n) => n.length);
  check(2, 'Kapsam uyusmazligi acikca yaziliyor', /scope mismatch/i.test(caveats2), caveats2.slice(0, 180));
  check(2, 'Sonuc kesin ilan edilmiyor', !caveats2.includes('kanıtlıdır') && caveatCount > 0, `p=${caveatCount}`);

  /* Adim 3: not senaryosu, dogrulanmis katsayi tablosu */
  console.log('\nAdim 3 : ders ekle, GANO ve kaynak kunyesi');
  await page.click('#tab-time');
  await page.waitForSelector('#panel-time:not([hidden])');

  const options = await page.$$eval('#course-select option', (o) => o.map((x) => ({
    value: x.value,
    ects: Number((x.textContent.match(/\((\d+(?:[.,]\d+)?) AKTS\)/) || [])[1]),
  })));
  check(3, 'Ders secici en az iki dersi AKTS bilgisiyle sunuyor',
    options.length >= 2 && options.every((o) => Number.isFinite(o.ects)), `ders=${options.length}`);

  const sorted = [...options].sort((a, b) => a.ects - b.ects);
  const light = sorted[0];                 // DC verilecek ders
  const heavy = sorted[sorted.length - 1]; // once AA, sonra FF verilecek ders

  await addCourse(page, light.value, 'DC');
  await addCourse(page, heavy.value, 'AA');

  const rows = await page.$$eval('#transcript-body tr', (n) => n.length);
  check(3, 'Iki ders transkripte islendi', rows === 2, `satir=${rows}`);

  const stats1 = await standingStats(page);
  const gpa1 = Number((stats1.get('GANO (tahmini)')?.value.match(/(\d\.\d\d)/) || [])[1]);
  check(3, 'GANO iki ondalikli sayi olarak hesaplandi', Number.isFinite(gpa1), String(gpa1));
  check(3, 'Bu senaryoda GANO 2.00 ve uzeri', gpa1 >= 2.0, `GANO=${gpa1}`);

  const body = await page.locator('body').innerText();
  check(3, 'Sayfanin hicbir yerinde UNVERIFIED etiketi kalmadi', !/UNVERIFIED/i.test(body));
  check(3, 'Katsayi tablosunun resmi kunyesi sayfada',
    body.includes('MADDE 32/(3)') && body.includes('20.09.2020') && body.includes('31250'));

  const gate = flat(await page.locator('#gate-result').innerText());
  check(3, 'Tek ders bolumu harf notu uretmedigini soyluyor',
    gate.includes('Harf notu bilinçli olarak üretilmez'), gate.slice(0, 140));

  const cond1 = stats1.get('Şartlı geçen AKTS');
  check(3, 'DC kredisi su an sayiliyor', /Şu an sayılıyor/.test(cond1?.note ?? '') && cond1?.state === 'good',
    `${flat(cond1?.value)} / ${flat(cond1?.note)} / ${cond1?.state}`);

  /* Adim 4: GANO 2.00 altina dusunce sartli kredi dusmeli */
  console.log('\nAdim 4 : GANO 2.00 altina dusuruluyor');
  const earnedBefore = parseInt(stats1.get('Kazanılan AKTS').value, 10);

  await page.selectOption('#whatif-course', heavy.value);
  await page.selectOption('#whatif-grade', 'FF');
  await page.waitForTimeout(200);
  const whatif = flat(await page.locator('#whatif-result').innerText());
  check(4, 'Senaryo, kazanilmis DC/DD kredisinin dusecegini onceden bildiriyor',
    /KAYBETT[İI]R[İI]YOR/.test(whatif), whatif.slice(0, 200));

  // Senaryoyu gercekten uygula: dersi sil, ayni dersi FF ile yeniden ekle.
  await page.click('#transcript-body tr:nth-child(2) button');
  await page.waitForTimeout(150);
  await addCourse(page, heavy.value, 'FF');

  const stats2 = await standingStats(page);
  const gpa2 = Number((stats2.get('GANO (tahmini)')?.value.match(/(\d\.\d\d)/) || [])[1]);
  const cond2 = stats2.get('Şartlı geçen AKTS');
  const earnedAfter = parseInt(stats2.get('Kazanılan AKTS').value, 10);

  check(4, 'GANO gercekten 2.00 altina dustu', Number.isFinite(gpa2) && gpa2 < 2.0, `GANO=${gpa2}`);
  check(4, 'Sartli gecilen AKTS artik SAYILMIYOR',
    /SAYILMIYOR/.test(cond2?.note ?? '') && cond2?.state === 'bad',
    `${flat(cond2?.value)} / ${flat(cond2?.note)} / ${cond2?.state}`);
  check(4, 'Kazanilan AKTS gercekten azaldi', earnedAfter < earnedBefore, `${earnedBefore} -> ${earnedAfter}`);

  await page.selectOption('#whatif-course', heavy.value);
  await page.selectOption('#whatif-grade', 'AA');
  await page.waitForTimeout(200);
  const whatifBack = flat(await page.locator('#whatif-result').innerText());
  check(4, 'Ters senaryo krediyi geri kazandirdigini soyluyor',
    /yeniden geçerli hâle getiriyor/.test(whatifBack), whatifBack.slice(0, 200));

  /* Adim 5: tum verimi sil */
  console.log('\nAdim 5 : tum verimi sil');
  const storedBefore = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  check(5, 'Silmeden once tarayicida kayit vardi', storedBefore !== null && storedBefore !== '[]',
    String(storedBefore).slice(0, 60));

  await page.click('#wipe');
  await page.waitForTimeout(200);
  const storedAfter = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  const rowsAfter = await page.$$eval('#transcript-body tr', (n) => n.length);
  const emptyHidden = await page.$eval('#transcript-empty', (n) => n.hidden);
  const storageState = flat(await page.locator('#storage-state').innerText());

  // Bilinen sinir: app.js silme sonrasi saveTranscript() cagirdigi icin anahtar
  // bos bir dizi olarak geri yazilabiliyor. Ders verisinin kalmamasi sarttir;
  // anahtarin kendisi issue #3'te ayrica izleniyor.
  check(5, 'Kayitli hicbir ders verisi kalmadi',
    storedAfter === null || storedAfter === '[]', String(storedAfter).slice(0, 80));
  check(5, 'Transkript tablosu bosaldi ve bos mesaji gorunur', rowsAfter === 0 && emptyHidden === false,
    `satir=${rowsAfter} bosMesajGizli=${emptyHidden}`);
  check(5, 'Durum satiri "Kayitli veri yok." diyor', /Kayıtlı veri yok\./.test(storageState), storageState);

  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#diff-entries li.entry', { timeout: 30000 });
  await page.click('#tab-time');
  await page.waitForSelector('#panel-time:not([hidden])');
  const rowsReload = await page.$$eval('#transcript-body tr', (n) => n.length);
  const storedReload = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  check(5, 'Yenilemeden sonra silinen dersler geri gelmedi',
    rowsReload === 0 && (storedReload === null || storedReload === '[]'),
    `satir=${rowsReload} kayit=${String(storedReload)}`);

  /* Tur boyunca gecerli iki sart */
  console.log('\nTur boyunca');
  check(6, 'Konsola tek bir hata bile dusmedi', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check(6, 'Site kendi kaynagi disinda hicbir istek yapmadi', foreign.length === 0, foreign.slice(0, 3).join(' | '));

  await browser.close();
}

run().then(() => {
  console.log(`\n${total - failed}/${total} kontrol gecti.`);
  if (failed > 0) {
    console.log(`::error title=Canli kabul turu FAIL::${failed} kontrol basarisiz`);
    process.exit(1);
  }
  console.log('Canli kabul turu PASS.');
}).catch((error) => {
  console.error(error);
  console.log(`::error title=Canli kabul turu cokti::${flat(error && error.message)}`);
  process.exit(1);
});
