import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ELIGIBILITY,
  computeRawScore,
  evaluateCourse,
  finalScoreNeededForRawFloor,
} from '../site/modules/rules.js';

const ruleset = {
  weights: { midtermWeight: 0.4, finalWeight: 0.6 },
  floors: { finalExamMinimum: 30, rawScoreMinimum: 40 },
  attendance: { requiredPercent: 70 },
};

test('the raw score is the declared 40/60 weighting', () => {
  assert.equal(computeRawScore({ midterm: 50, final: 60 }, ruleset), 56);
});

test('a missing or out-of-range input yields null, never a partial guess', () => {
  assert.equal(computeRawScore({ midterm: 50 }, ruleset), null);
  assert.equal(computeRawScore({ midterm: -1, final: 60 }, ruleset), null);
  assert.equal(computeRawScore({ midterm: 50, final: 101 }, ruleset), null);
  assert.equal(computeRawScore({ midterm: '50', final: 60 }, ruleset), null);
});

test('all gates cleared means eligible — and still no letter grade', () => {
  const result = evaluateCourse({ midterm: 60, final: 70, attendancePercent: 90 }, ruleset);
  assert.equal(result.eligibility, ELIGIBILITY.ELIGIBLE);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.unknowns.length, 0);
  assert.equal(result.letterGradeDeterminable, false);
});

test('every result states that the letter grade is undeterminable', () => {
  const inputs = [
    { midterm: 60, final: 70, attendancePercent: 90 },
    { midterm: 0, final: 0, attendancePercent: 0 },
    {},
  ];
  for (const input of inputs) {
    const result = evaluateCourse(input, ruleset);
    assert.equal(result.letterGradeDeterminable, false);
    assert.match(result.letterGradeNote, /relative assessment/i);
  }
});

test('attendance below 70% blocks regardless of scores', () => {
  const result = evaluateCourse({ midterm: 100, final: 100, attendancePercent: 69.9 }, ruleset);
  assert.equal(result.eligibility, ELIGIBILITY.BLOCKED);
  assert.equal(result.blockers.some((b) => b.gate === 'attendance'), true);
});

test('a final below the 30 limit blocks even with a passing raw score', () => {
  const result = evaluateCourse({ midterm: 100, final: 29, attendancePercent: 100 }, ruleset);
  assert.equal(result.eligibility, ELIGIBILITY.BLOCKED);
  assert.equal(result.blockers.some((b) => b.gate === 'final-exam-floor'), true);
});

test('a raw score below the 40 floor blocks', () => {
  const result = evaluateCourse({ midterm: 30, final: 35, attendancePercent: 100 }, ruleset);
  assert.equal(computeRawScore({ midterm: 30, final: 35 }, ruleset), 33);
  assert.equal(result.eligibility, ELIGIBILITY.BLOCKED);
  assert.equal(result.blockers.some((b) => b.gate === 'raw-score-floor'), true);
});

test('missing inputs yield UNKNOWN, not a pass', () => {
  const result = evaluateCourse({}, ruleset);
  assert.equal(result.eligibility, ELIGIBILITY.UNKNOWN);
  assert.equal(result.unknowns.length, 3);
  assert.equal(result.rawScore, null);
});

test('a proven blocker outranks an unknown gate', () => {
  const result = evaluateCourse({ midterm: 10, final: 10 }, ruleset);
  assert.equal(result.eligibility, ELIGIBILITY.BLOCKED);
  assert.equal(result.unknowns.some((u) => u.gate === 'attendance'), true);
});

test('the boundary values themselves pass', () => {
  const result = evaluateCourse({ midterm: 0, final: 66.67, attendancePercent: 70 }, ruleset);
  assert.equal(result.rawScore, 40);
  assert.equal(result.eligibility, ELIGIBILITY.ELIGIBLE);
});

test('the needed final score is never below the 30 exam limit', () => {
  const easy = finalScoreNeededForRawFloor(100, ruleset);
  assert.equal(easy.attainable, true);
  assert.equal(easy.needed, 30);
});

test('an unreachable target reports attainable:false, not a comforting number', () => {
  const hopeless = finalScoreNeededForRawFloor(0, { ...ruleset, floors: { finalExamMinimum: 30, rawScoreMinimum: 95 } });
  assert.equal(hopeless.attainable, false);
  assert.ok(hopeless.needed > 100);
});

test('a non-score midterm yields null', () => {
  assert.equal(finalScoreNeededForRawFloor(undefined, ruleset), null);
});
