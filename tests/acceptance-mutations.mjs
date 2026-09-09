/*
 * Kabul turunun kendisini olcer.
 *
 * "Yesil kabul testi" tek basina bir sey kanitlamaz: hicbir sey iddia etmeyen
 * bir test de yesil yanar. Bu dosya siteyi bilerek bozar ve turun kirmizi
 * yanmasini SART kosar. Once bozulmamis kopya uzerinde kontrol kosusu yapilir
 * (yesil olmali), sonra her mutasyon tek tek uygulanir (kirmizi olmali ve
 * beklenen adimda patlamali).
 *
 * Tamamen cevrimdisi calisir: site kopyasi gecici bir klasore alinir ve yerel
 * bir statik sunucudan servis edilir. Yayindaki adrese dokunmaz.
 *
 * Calistirma: PLAYWRIGHT_PATH=... node tests/acceptance-mutations.mjs
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const SITE = join(ROOT, 'site');
const TOUR = join(here, 'live-acceptance.mjs');

/* Her mutasyon, turdaki tek bir iddiayi hedefler. Cengel bulunamazsa bu dosya
 * hata verir: sessizce atlanan bir mutasyon, olculmeyen bir iddia demektir. */
const MUTATIONS = [
  {
    id: 'recoded-kodu-gizle',
    file: 'app.js',
    find: '`${entry.code} \u2192 ${entry.toCode}`',
    replace: '`${entry.code}`',
    step: 1,
    why: 'Yeni kodu gizlersen MAT1501 -> EKO1001 iddiasi cokmelidir.',
  },
  {
    id: 'bilinmeyeni-eklendi-diye-ilan-et',
    file: 'modules/diff.js',
    find: '      kind: fromIsComplete ? CHANGE.ADDED : CHANGE.UNKNOWN_ADDED,',
    replace: '      kind: CHANGE.ADDED,',
    step: 1,
    why: 'Kismi arsivde gorulemeyen dersi "eklendi" diye ilan etmek yakalanmalidir.',
  },
  {
    id: 'her-seyi-kesin-ilan-et',
    file: 'app.js',
    find: '  if (report.certain) {',
    replace: '  if (true) {',
    step: 2,
    why: 'Kapsam uyusmazliginda bile "kanitlidir" demek yakalanmalidir.',
  },
  {
    id: 'kaynak-kunyesini-sil',
    file: 'index.html',
    find: 'MADDE 32/(3)',
    replace: 'ilgili madde',
    step: 3,
    why: 'Katsayi tablosunun resmi kaynagi sayfadan dusunce tur kirmizi yanmalidir.',
  },
  {
    id: 'sartli-krediyi-hep-say',
    file: 'app.js',
    find: "'\u015Eu an SAYILMIYOR'",
    replace: "'\u015Eu an say\u0131l\u0131yor'",
    step: 4,
    why: 'GANO 2.00 altina dustugu halde krediyi sayiyor gostermek yakalanmalidir.',
  },
  {
    id: 'silme-durumunu-yalan-soyle',
    file: 'app.js',
    find: "? 'Kay\u0131tl\u0131 veri yok.'",
    replace: "? 'Veriler duruyor.'",
    step: 5,
    why: 'Silme sonrasi durum satiri dogru degilse tur kirmizi yanmalidir.',
  },
  {
    id: 'silinen-anahtari-geri-yaz',
    file: 'app.js',
    find: '    if (state.transcript.length === 0) localStorage.removeItem(STORAGE_KEY);\n    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));',
    replace: '    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));',
    step: 5,
    why: 'Silme sonrasi anahtari bos dizi olarak geri yazmak yakalanmalidir.',
  },
  {
    id: 'acilista-sessizce-yaz',
    file: 'app.js',
    find: '  renderStorageState();\n  renderTimeMachine();\n  renderGate();',
    replace: '  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));\n  renderStorageState();\n  renderTimeMachine();\n  renderGate();',
    step: 5,
    why: 'Siteyi sadece acmanin depoya sessizce yazmasi yakalanmalidir.',
  },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function serve(dir) {
  return new Promise((resolveServer) => {
    const server = createServer((request, response) => {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let file = join(dir, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
      if (!file.startsWith(dir) || !existsSync(file)) {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('yok');
        return;
      }
      response.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(response);
    });
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() });
    });
  });
}

function runTour(url) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [TOUR, url], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('close', (code) => done({ code, out }));
  });
}

async function copySite() {
  const dir = await mkdtemp(join(tmpdir(), 'ekodiff-'));
  await cp(SITE, dir, { recursive: true });
  return dir;
}

async function mutate(dir, mutation) {
  const target = join(dir, mutation.file);
  const before = await readFile(target, 'utf8');
  const hits = before.split(mutation.find).length - 1;
  if (hits === 0) {
    throw new Error(`mutasyon cengeli bulunamadi: ${mutation.id} -> ${mutation.file} icinde "${mutation.find}"`);
  }
  await writeFile(target, before.split(mutation.find).join(mutation.replace));
  return hits;
}

const problems = [];

console.log('Kontrol kosusu: bozulmamis kopya uzerinde tur yesil yanmali.\n');
const cleanDir = await copySite();
const cleanServer = await serve(cleanDir);
const control = await runTour(cleanServer.url);
cleanServer.close();
console.log(control.out.split('\n').map((l) => `    ${l}`).join('\n'));
if (control.code !== 0) {
  problems.push('kontrol kosusu kirmizi: tur, bozulmamis site uzerinde bile gecmiyor');
  console.log('::error title=Kontrol kosusu FAIL::Tur bozulmamis site uzerinde gecmedi');
} else {
  console.log('  kontrol kosusu PASS\n');
}

for (const mutation of MUTATIONS) {
  console.log(`\nMutasyon ${mutation.id} (adim ${mutation.step}) : ${mutation.why}`);
  const dir = await copySite();
  const hits = await mutate(dir, mutation);
  const server = await serve(dir);
  const result = await runTour(server.url);
  server.close();

  const caught = result.code !== 0;
  const rightStep = result.out.includes(`::error title=Kabul turu adim ${mutation.step}::`);
  if (caught && rightStep) {
    console.log(`  yakalandi (${hits} yerde uygulandi, adim ${mutation.step} kirmizi)`);
  } else {
    problems.push(`${mutation.id}: ${caught ? `yanlis adimda yakalandi` : 'HIC yakalanmadi'}`);
    console.log(`::error title=Mutasyon kacti::${mutation.id} (adim ${mutation.step}) tur tarafindan yakalanmadi`);
    console.log(result.out.split('\n').filter((l) => l.includes('FAIL')).map((l) => `    ${l}`).join('\n'));
  }
}

console.log('');
if (problems.length > 0) {
  console.log(`Mutasyon denetimi FAIL: ${problems.length} sorun`);
  for (const p of problems) console.log(` - ${p}`);
  process.exit(1);
}
console.log(`Mutasyon denetimi PASS: ${MUTATIONS.length}/${MUTATIONS.length} mutasyon turu kirmiziya cevirdi.`);
