import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  STATUS,
  applyMutations,
  computeGpa,
  requiredAverageForTarget,
  summarizeProgram,
  whatIf,
} from '../site/modules/simulate.js';

const scale = {
  points: { AA: 4.0, BA: 3.5, BB: 3.0, CB: 2.5, CC: 2.0, DC: 1.5, DD: 1.0, FF: 0.0 },
  passing: ['AA', 'BA', 'BB', 'CB', 'CC'],
  conditional: ['DC', 'DD'],
  verification: 'UNVERIFIED',
  verificationNote: 'Katsayı tablosu doğrulanmamıştır.',
};
const verifiedScale = { ...scale, verification: 'verified' };
const programme = { requiredEcts: 240, minimumGpa: 2.0 };

test('the module performs no I/O — the privacy claim is checkable by reading it', () => {
  const source = readFileSync(new URL('../site/modules/simulate.js', import.meta.url), 'utf8');
  for (const forbidden of ['fetch(', 'localStorage', 'XMLHttpRequest', 'Date.now', 'require(', 'import(']) {
    assert.equal(source.includes(forbidden), false, `simulate.js must not contain ${forbidden}`);
  }
});

test('GPA is ECTS-weighted', () => {
  const result = computeGpa(
    [
      { code: 'A', ects: 5, grade: 'AA' },
      { code: 'B', ects: 5, grade: 'CC' },
    ],
    verifiedScale,
  );
  assert.equal(result.gpa, 3);
  assert.equal(result.gradedEcts, 10);
});

test('an ungraded course leaves the average untouched', () => {
  const graded = [{ code: 'A', ects: 5, grade: 'AA' }];
  const withPlanned = [...graded, { code: 'B', ects: 5, status: STATUS.PLANNED }];
  assert.equal(computeGpa(graded, verifiedScale).gpa, computeGpa(withPlanned, verifiedScale).gpa);
  assert.equal(computeGpa(withPlanned, verifiedScale).skippedCount, 1);
});

test('an unverified scale attaches its warning to every GPA result', () => {
  const result = computeGpa([{ code: 'A', ects: 5, grade: 'AA' }], scale);
  assert.equal(result.warnings.includes(scale.verificationNote), true);
  assert.equal(computeGpa([], scale).warnings.includes(scale.verificationNote), true);
  assert.equal(summarizeProgram([], programme, scale).warnings.includes(scale.verificationNote), true);
});

test('a grade outside the scale is warned about and excluded', () => {
  const result = computeGpa([{ code: 'A', ects: 5, grade: 'A+' }], verifiedScale);
  assert.equal(result.gpa, null);
  assert.match(result.warnings.join(' '), /A\+/);
});

test('an empty transcript has a null GPA, not zero', () => {
  assert.equal(computeGpa([], verifiedScale).gpa, null);
});

test('conditional DC/DD credit counts only while the GPA holds', () => {
  const passing = summarizeProgram(
    [
      { code: 'A', ects: 30, grade: 'BB' },
      { code: 'B', ects: 5, grade: 'DC' },
    ],
    programme,
    verifiedScale,
  );
  assert.equal(passing.conditionalCounted, true);
  assert.equal(passing.earnedEcts, 35);

  const slipped = summarizeProgram(
    [
      { code: 'A', ects: 30, grade: 'FF' },
      { code: 'B', ects: 5, grade: 'DC' },
    ],
    programme,
    verifiedScale,
  );
  assert.equal(slipped.conditionalCounted, false);
  assert.equal(slipped.earnedEcts, 0);
  assert.equal(slipped.conditionalEcts, 5);
  assert.match(slipped.warnings.join(' '), /do not currently count/i);
});

test('already-earned conditional credit can be LOST by a later bad grade', () => {
  const before = [
    { code: 'A', ects: 30, grade: 'BB' },
    { code: 'B', ects: 5, grade: 'DD' },
  ];
  const result = whatIf(
    before,
    [{ type: 'add', course: { code: 'C', ects: 30, grade: 'FF' } }],
    programme,
    verifiedScale,
  );
  assert.equal(result.before.conditionalCounted, true);
  assert.equal(result.after.conditionalCounted, false);
  assert.equal(result.delta.conditionalFlipped, true);
  assert.ok(result.delta.earnedEcts < 0, 'earned ECTS must fall when the conditional pass flips');
});

test('graduation needs both the ECTS total and the minimum GPA', () => {
  const enough = summarizeProgram([{ code: 'A', ects: 240, grade: 'CC' }], programme, verifiedScale);
  assert.equal(enough.graduation.ready, true);

  const lowGpa = summarizeProgram(
    [
      { code: 'A', ects: 240, grade: 'DD' },
      { code: 'B', ects: 5, grade: 'FF' },
    ],
    programme,
    verifiedScale,
  );
  assert.equal(lowGpa.graduation.gpaMet, false);
  assert.equal(lowGpa.graduation.ready, false);
});

test('mutations never touch the original transcript', () => {
  const original = [{ code: 'A', ects: 5, grade: 'CC' }];
  const { entries } = applyMutations(original, [{ type: 'set-grade', code: 'A', grade: 'AA' }]);
  assert.equal(original[0].grade, 'CC');
  assert.equal(entries[0].grade, 'AA');
  assert.equal(entries[0].status, STATUS.COMPLETED);
});

test('an unknown code or type is reported, never silently swallowed', () => {
  const { entries, problems } = applyMutations(
    [{ code: 'A', ects: 5, grade: 'CC' }],
    [
      { type: 'set-grade', code: 'YOK', grade: 'AA' },
      { type: 'drop', code: 'YOK' },
      { type: 'teleport', code: 'A' },
      null,
      { type: 'add', course: { code: 'A', ects: 5 } },
    ],
  );
  assert.equal(problems.length, 5);
  assert.equal(entries.length, 1);
});

test('drop and add behave as stated', () => {
  const { entries, problems } = applyMutations(
    [{ code: 'A', ects: 5, grade: 'CC' }],
    [{ type: 'drop', code: 'A' }, { type: 'add', course: { code: 'B', ects: 5, grade: 'AA' } }],
  );
  assert.deepEqual(problems, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].code, 'B');
  assert.equal(entries[0].status, STATUS.PLANNED);
});

test('an out-of-reach target reports attainable:false', () => {
  const result = requiredAverageForTarget(
    [{ code: 'A', ects: 230, grade: 'FF' }],
    programme,
    verifiedScale,
    3.5,
  );
  assert.equal(result.attainable, false);
  assert.match(result.reason, /Out of reach/i);
});

test('a reachable target reports the average needed', () => {
  const result = requiredAverageForTarget(
    [{ code: 'A', ects: 120, grade: 'CC' }],
    programme,
    verifiedScale,
    3.0,
  );
  assert.equal(result.attainable, true);
  assert.equal(result.required, 4);
  assert.equal(result.remainingEcts, 120);
});

test('an already-secured target asks for nothing more', () => {
  const result = requiredAverageForTarget(
    [{ code: 'A', ects: 120, grade: 'AA' }],
    programme,
    verifiedScale,
    2.0,
  );
  assert.equal(result.attainable, true);
  assert.equal(result.required, 0);
});

test('with no remaining ECTS the average is final', () => {
  const result = requiredAverageForTarget(
    [{ code: 'A', ects: 240, grade: 'CC' }],
    programme,
    verifiedScale,
    3.0,
  );
  assert.equal(result.remainingEcts, 0);
  assert.equal(result.attainable, false);
  assert.match(result.reason, /already final/i);
});

test('a non-positive ECTS entry is excluded with a warning', () => {
  const result = computeGpa([{ code: 'A', ects: 0, grade: 'AA' }], verifiedScale);
  assert.equal(result.gpa, null);
  assert.match(result.warnings.join(' '), /ECTS/i);
});
