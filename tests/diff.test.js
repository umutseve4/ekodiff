import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSnapshot, COMPLETENESS } from '../site/modules/snapshot.js';
import { CHANGE, diffSnapshots } from '../site/modules/diff.js';

const SOURCE = { url: 'https://example.org', fetched_at: '2026-09-05T00:00:00Z', provenance: 'test' };

function build(overrides) {
  const raw = {
    snapshot_id: 'snap',
    scope: 'shared scope',
    completeness: COMPLETENESS.FULL,
    covered_fields: ['title', 'ects', 'semester'],
    source: SOURCE,
    courses: [],
    ...overrides,
  };
  const { ok, errors, snapshot } = validateSnapshot(raw);
  assert.equal(ok, true, errors.join('; '));
  return snapshot;
}

const find = (report, kind) => report.entries.filter((e) => e.kind === kind);

test('a course present only in `from` is REMOVED when `to` is complete', () => {
  const from = build({ snapshot_id: 'a', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }] });
  const to = build({ snapshot_id: 'b', courses: [] });
  const report = diffSnapshots(from, to);
  assert.equal(find(report, CHANGE.REMOVED).length, 1);
  assert.equal(report.certain, true);
  assert.equal(report.caveat, null);
});

test('a partial `to` can never prove removal', () => {
  const from = build({ snapshot_id: 'a', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }] });
  const to = build({
    snapshot_id: 'b',
    completeness: COMPLETENESS.PARTIAL,
    covered_fields: ['title', 'ects', 'semester'],
    courses: [],
  });
  const report = diffSnapshots(from, to);
  assert.equal(find(report, CHANGE.REMOVED).length, 0);
  assert.equal(find(report, CHANGE.UNKNOWN_REMOVED).length, 1);
  assert.equal(report.certain, false);
  assert.match(report.caveat, /partial/i);
});

test('a partial `from` can never prove addition', () => {
  const from = build({ snapshot_id: 'a', completeness: COMPLETENESS.PARTIAL, courses: [] });
  const to = build({ snapshot_id: 'b', courses: [{ code: 'EKO9999', title: 'Yeni Ders', ects: 5, semester: 5 }] });
  const report = diffSnapshots(from, to);
  assert.equal(find(report, CHANGE.ADDED).length, 0);
  assert.equal(find(report, CHANGE.UNKNOWN_ADDED).length, 1);
});

test('an unambiguous 1:1 title match is reported as a recode', () => {
  const from = build({ snapshot_id: 'a', courses: [{ code: 'MAT1501', title: 'Matematik I', ects: 5, semester: 1 }] });
  const to = build({ snapshot_id: 'b', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }] });
  const report = diffSnapshots(from, to);
  const recodes = find(report, CHANGE.RECODED);
  assert.equal(recodes.length, 1);
  assert.equal(recodes[0].code, 'MAT1501');
  assert.equal(recodes[0].toCode, 'EKO1001');
  assert.equal(find(report, CHANGE.REMOVED).length, 0);
  assert.equal(find(report, CHANGE.ADDED).length, 0);
});

test('an ambiguous title match refuses to claim a recode', () => {
  const from = build({
    snapshot_id: 'a',
    courses: [
      { code: 'MAT1501', title: 'Matematik I', ects: 5, semester: 1 },
      { code: 'MAT1601', title: 'Matematik I', ects: 5, semester: 1 },
    ],
  });
  const to = build({ snapshot_id: 'b', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }] });
  const report = diffSnapshots(from, to);
  assert.equal(find(report, CHANGE.RECODED).length, 0);
  assert.equal(find(report, CHANGE.REMOVED).length, 2);
  assert.equal(find(report, CHANGE.ADDED).length, 1);
});

test('recode detection is skipped when either side does not cover titles', () => {
  const from = build({
    snapshot_id: 'a',
    completeness: COMPLETENESS.PARTIAL,
    covered_fields: ['semester'],
    courses: [{ code: 'MAT1501', title: 'Matematik I', semester: 1 }],
  });
  const to = build({ snapshot_id: 'b', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }] });
  const report = diffSnapshots(from, to);
  assert.equal(find(report, CHANGE.RECODED).length, 0);
});

test('a changed ECTS is a field change, not a replacement', () => {
  const from = build({ snapshot_id: 'a', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 6, semester: 1 }] });
  const to = build({ snapshot_id: 'b', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }] });
  const report = diffSnapshots(from, to);
  const changed = find(report, CHANGE.CHANGED);
  assert.equal(changed.length, 1);
  assert.deepEqual(changed[0].fieldChanges, [{ field: 'ects', from: 6, to: 5 }]);
});

test('a field one side does not cover is unknown, never "unchanged by proof"', () => {
  const from = build({
    snapshot_id: 'a',
    completeness: COMPLETENESS.PARTIAL,
    covered_fields: ['title', 'semester'],
    courses: [{ code: 'EKO1001', title: 'Matematik I', semester: 1 }],
  });
  const to = build({ snapshot_id: 'b', courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }] });
  const report = diffSnapshots(from, to);
  const entry = report.entries.find((e) => e.code === 'EKO1001');
  assert.equal(entry.unknownFields.some((u) => u.field === 'ects'), true);
  assert.equal(entry.fieldChanges.length, 0);
});

test('comparing across different scopes is flagged and never called certain', () => {
  const from = build({ snapshot_id: 'a', scope: 'zorunlu dersler', courses: [] });
  const to = build({ snapshot_id: 'b', scope: 'seçmeli dersler', courses: [] });
  const report = diffSnapshots(from, to);
  assert.equal(report.sameScope, false);
  assert.equal(report.certain, false);
  assert.match(report.caveat, /scope/i);
});

test('the summary counts every entry exactly once', () => {
  const from = build({
    snapshot_id: 'a',
    courses: [
      { code: 'MAT1501', title: 'Matematik I', ects: 5, semester: 1 },
      { code: 'EKO1003', title: 'Kariyer Planlama', ects: 1, semester: 1 },
      { code: 'ISL1003', title: 'İşletme', ects: 5, semester: 1 },
    ],
  });
  const to = build({
    snapshot_id: 'b',
    courses: [
      { code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 },
      { code: 'ISL1003', title: 'İşletme', ects: 5, semester: 1 },
      { code: 'YAD101', title: 'Yabancı Dil I', ects: 2, semester: 1 },
    ],
  });
  const report = diffSnapshots(from, to);
  const total = Object.values(report.summary).reduce((a, b) => a + b, 0);
  assert.equal(total, report.entries.length);
  assert.equal(report.summary[CHANGE.RECODED], 1);
  assert.equal(report.summary[CHANGE.REMOVED], 1);
  assert.equal(report.summary[CHANGE.ADDED], 1);
  assert.equal(report.summary[CHANGE.UNCHANGED], 1);
});

test('the loudest signals sort first', () => {
  const from = build({
    snapshot_id: 'a',
    courses: [
      { code: 'AAA1000', title: 'Sabit Ders', ects: 5, semester: 1 },
      { code: 'MAT1501', title: 'Matematik I', ects: 5, semester: 1 },
    ],
  });
  const to = build({
    snapshot_id: 'b',
    courses: [
      { code: 'AAA1000', title: 'Sabit Ders', ects: 5, semester: 1 },
      { code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 },
    ],
  });
  const report = diffSnapshots(from, to);
  assert.equal(report.entries[0].kind, CHANGE.RECODED);
});

test('the report and its entries are frozen', () => {
  const report = diffSnapshots(build({ snapshot_id: 'a' }), build({ snapshot_id: 'b' }));
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.entries), true);
});
