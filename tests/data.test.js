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
import { computeGpa } from '../site/modules/simulate.js';

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

test('the shipped scale is marked UNVERIFIED and says so out loud', () => {
  assert.notEqual(ruleset.scale.verification, 'verified');
  assert.match(ruleset.scale.verificationNote, /doğrulanmamıştır/);
  const result = computeGpa([{ code: 'A', ects: 5, grade: 'AA' }], ruleset.scale);
  assert.equal(result.gpa, 4);
  assert.equal(result.warnings.includes(ruleset.scale.verificationNote), true);
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
