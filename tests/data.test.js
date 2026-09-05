/**
 * Contract tests for the shipped data files.
 *
 * These exist because the data is the product. A regression here is not a
 * cosmetic bug: it is the tool telling a student something untrue about their
 * own degree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { validateSnapshot } from '../site/modules/snapshot.js';
import { CHANGE, diffSnapshots } from '../site/modules/diff.js';
import { computeGpa, summarizeProgram } from '../site/modules/simulate.js';

// Data lives under site/ on purpose: GitHub Pages serves that directory
// verbatim, so the tests and the live site read byte-identical files with no
// build step in between and therefore no possibility of drift.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, 'site', 'data');
const snapshotDir = path.join(dataDir, 'snapshots');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const snapshotFiles = readdirSync(snapshotDir).filter((f) => f.endsWith('.json')).sort();
const ruleset = readJson(path.join(dataDir, 'rules', 'assessment.json'));

test('the manifest lists exactly the snapshots that exist on disk', () => {
  // The browser cannot list a directory over HTTP, so this manifest is the only
  // thing standing between the site and a silently missing snapshot.
  const manifest = readJson(path.join(dataDir, 'index.json'));
  const listed = manifest.snapshots.map((s) => path.basename(s.file)).sort();
  assert.deepEqual(listed, snapshotFiles);
  for (const entry of manifest.snapshots) {
    const raw = readJson(path.join(root, 'site', entry.file));
    assert.equal(raw.snapshot_id, entry.id);
  }
  assert.ok(readJson(path.join(root, 'site', manifest.rules)).ruleset_id);
  assert.equal(manifest.snapshots.filter((s) => s.default_from).length, 1);
  assert.equal(manifest.snapshots.filter((s) => s.default_to).length, 1);
});

test('there is at least one snapshot to compare', () => {
  assert.ok(snapshotFiles.length >= 2, 'a diff tool needs at least two snapshots');
});

for (const file of snapshotFiles) {
  test(`${file} passes validation`, () => {
    const { ok, errors } = validateSnapshot(readJson(path.join(snapshotDir, file)));
    assert.equal(ok, true, errors.join('\n'));
  });

  test(`${file} declares an honest, dated source`, () => {
    const raw = readJson(path.join(snapshotDir, file));
    assert.match(raw.source.provenance, /user-transcribed/);
    assert.ok(!Number.isNaN(Date.parse(raw.source.fetched_at)));
    assert.match(raw.source.url, /^https:\/\//);
  });

  test(`${file} filename matches its snapshot_id`, () => {
    const raw = readJson(path.join(snapshotDir, file));
    assert.equal(`${raw.snapshot_id}.json`, file);
  });

  test(`${file}, if partial, explains what it does not cover`, () => {
    const raw = readJson(path.join(snapshotDir, file));
    if (raw.completeness !== 'partial') return;
    assert.ok(Array.isArray(raw.notes) && raw.notes.length > 0);
    assert.match(raw.notes.join(' '), /eksik/i);
  });
}

test('the mandatory-course snapshot carries the full eight-semester spine', () => {
  const { snapshot } = validateSnapshot(readJson(path.join(snapshotDir, '2026-2027-zorunlu.json')));
  const semesters = new Set(snapshot.courses.map((c) => c.semester));
  assert.deepEqual([...semesters].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(snapshot.completeness, 'full');
  for (const code of ['EKO1001', 'EKO1002', 'EKO3101', 'EKO3102', 'EKO4102']) {
    assert.ok(snapshot.byCode.has(code), `${code} missing`);
  }
});

test('the documented 241-vs-240 ECTS discrepancy still holds and is disclosed', () => {
  const raw = readJson(path.join(snapshotDir, '2026-2027-zorunlu.json'));
  const { snapshot } = validateSnapshot(raw);
  const mandatoryEcts = snapshot.courses.reduce((sum, c) => sum + c.ects, 0);
  // 181 mandatory ECTS + 60 elective ECTS (12 courses x 5) = 241, against 240 declared.
  assert.equal(mandatoryEcts, 181);
  assert.equal(mandatoryEcts + 60, 241);
  assert.equal(ruleset.programme.requiredEcts, 240);
  assert.match(raw.notes.join(' '), /241/);
});

test('the archive diff surfaces the MAT→EKO recode without inventing removals', () => {
  const { snapshot: from } = validateSnapshot(readJson(path.join(snapshotDir, '2018-2019-zorunlu.json')));
  const { snapshot: to } = validateSnapshot(readJson(path.join(snapshotDir, '2026-2027-zorunlu.json')));
  const report = diffSnapshots(from, to);

  const recodes = report.entries.filter((e) => e.kind === CHANGE.RECODED);
  assert.equal(recodes.length, 2);
  assert.deepEqual(
    recodes.map((e) => `${e.code}->${e.toCode}`).sort(),
    ['MAT1501->EKO1001', 'MAT1502->EKO1002'],
  );

  // The archive snapshot is partial, so nothing may be claimed as added.
  assert.equal(report.summary[CHANGE.ADDED], 0);
  assert.equal(report.summary[CHANGE.REMOVED], 0);
  assert.ok(report.summary[CHANGE.UNKNOWN_ADDED] > 0);
  assert.equal(report.certain, false);
  assert.equal(report.sameScope, true);
});

test('the ruleset states the published absolute gates', () => {
  assert.equal(ruleset.weights.midtermWeight + ruleset.weights.finalWeight, 1);
  assert.equal(ruleset.weights.midtermWeight, 0.4);
  assert.equal(ruleset.floors.finalExamMinimum, 30);
  assert.equal(ruleset.floors.rawScoreMinimum, 40);
  assert.equal(ruleset.attendance.requiredPercent, 70);
  assert.equal(ruleset.relative.inclusionThreshold, 20);
  assert.equal(ruleset.programme.minimumGpa, 2.0);
});

test('the shipped scale is the regulation table, verbatim and cited', () => {
  // Verbatim from MADDE 32/(3) of the BUÜ undergraduate regulation. If a future
  // amendment moves a coefficient, this test is the thing that must go red
  // before a single student sees a wrong average.
  assert.deepEqual(ruleset.scale.points, {
    AA: 4.0,
    BA: 3.5,
    BB: 3.0,
    CB: 2.5,
    CC: 2.0,
    DC: 1.5,
    DD: 1.0,
    FD: 0.5,
    FF: 0.0,
    D: 0.0,
  });
  assert.equal(ruleset.scale.verification, 'verified');

  const cite = ruleset.scale.verifiedAgainst;
  assert.match(cite.regulation, /Bursa Uludağ Üniversitesi/);
  assert.match(cite.article, /MADDE 32/);
  assert.equal(cite.officialGazette.number, '31250');
  assert.equal(cite.officialGazette.date, '2020-09-20');
  assert.match(cite.url, /^https:\/\//);
  assert.ok(!Number.isNaN(Date.parse(cite.verified_at)));
});

test('a verified scale no longer attaches a doubt warning to every average', () => {
  const result = computeGpa([{ code: 'A', ects: 5, grade: 'AA' }], ruleset.scale);
  assert.equal(result.gpa, 4);
  assert.deepEqual([...result.warnings], []);
});

test('(D) counts as FF in the average and never earns credit', () => {
  // MADDE 32/(4)-a: (D) Devamsız is included in the average as (FF).
  const summary = summarizeProgram(
    [
      { code: 'X', ects: 6, grade: 'AA' },
      { code: 'Y', ects: 6, grade: 'D' },
    ],
    ruleset.programme,
    ruleset.scale,
  );
  assert.equal(summary.gpa, 2);
  assert.equal(summary.earnedEcts, 6);
  assert.deepEqual(summary.failed.map((f) => f.grade), ['D']);
});

test('FD is failing, not conditional', () => {
  assert.equal(ruleset.scale.failing.includes('FD'), true);
  assert.equal(ruleset.scale.conditional.includes('FD'), false);
  assert.equal(ruleset.scale.points.FD, 0.5);
});

test('no fixed 100-point band is invented for any letter grade', () => {
  // The regulation deliberately defines none: letters come out of relative
  // assessment. Shipping a band would be a fabrication dressed as precision.
  const asText = JSON.stringify(ruleset.scale);
  assert.equal('hundredPointBands' in ruleset.scale, false);
  assert.equal('bands' in ruleset.scale, false);
  assert.match(ruleset.scale.letterGradeNote, /üretmez/);
  assert.equal(/"(AA|BA|BB|CB|CC|DC|DD|FD|FF)"\s*:\s*\[\s*\d+\s*,/.test(asText), false);
});

test('marks that stay out of the GPA are documented and out of the points table', () => {
  const points = Object.keys(ruleset.scale.points);
  for (const mark of ['S', 'E', 'G', 'K', 'M', 'İ']) {
    assert.ok(ruleset.scale.nonGpaMarks[mark], `${mark} is undocumented`);
    assert.equal(points.includes(mark), false, `${mark} must not carry a coefficient`);
  }
  // And if one is typed in anyway, the engine must refuse it out loud.
  const result = computeGpa([{ code: 'A', ects: 5, grade: 'M' }], ruleset.scale);
  assert.equal(result.gpa, null);
  assert.equal(result.warnings.length, 1);
});

test('every grade in passing/conditional/failing exists in the points table', () => {
  const known = Object.keys(ruleset.scale.points);
  for (const group of ['passing', 'conditional', 'failing']) {
    for (const grade of ruleset.scale[group]) {
      assert.ok(known.includes(grade), `${grade} is not in the points table`);
    }
  }
  const covered = [...ruleset.scale.passing, ...ruleset.scale.conditional, ...ruleset.scale.failing];
  assert.deepEqual(covered.sort(), known.sort());
});

test('the elective snapshot confirms the SQL / data-engineering gap', () => {
  const { snapshot } = validateSnapshot(readJson(path.join(snapshotDir, '2026-2027-secmeli-veri.json')));
  const titles = snapshot.courses.map((c) => c.title.toLocaleLowerCase('tr-TR')).join(' | ');
  for (const term of ['sql', 'veri tabanı', 'veritabanı', 'veri mühendisliği']) {
    assert.equal(titles.includes(term), false, `unexpected: a course now mentions "${term}"`);
  }
  // R and Python are present, contrary to the earlier 2018-plan-based conclusion.
  assert.ok(snapshot.byCode.has('EKO3001'));
  assert.ok(snapshot.byCode.has('EKO3002'));
  assert.ok(snapshot.byCode.has('EKO3310'));
});
