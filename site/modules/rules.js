/**
 * Absolute (non-relative) assessment rules.
 *
 * Deliberate scope limit, and the most important design decision in this file:
 * this module does NOT convert a raw score into a letter grade. Bursa Uludağ
 * Üniversitesi uses relative assessment (bağıl değerlendirme), so the letter
 * depends on the whole cohort's distribution — data a student does not have and
 * this project will never collect. Any tool that pretends otherwise is
 * fabricating.
 *
 * What CAN be evaluated without cohort data are the absolute floors: attendance,
 * the final-exam floor, and the raw-score floor. Those are hard gates: failing
 * one of them means no letter grade is possible regardless of the distribution.
 * So this module answers exactly one question — "are you even eligible to
 * receive a passing letter grade?" — and refuses the rest.
 */

export const ELIGIBILITY = Object.freeze({
  ELIGIBLE: 'eligible',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
});

function isScore(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * Weighted raw score. Returns null when any input is missing or out of range —
 * never a partial guess.
 */
export function computeRawScore({ midterm, final }, ruleset) {
  if (!isScore(midterm) || !isScore(final)) return null;
  const { midtermWeight, finalWeight } = ruleset.weights;
  const raw = midterm * midtermWeight + final * finalWeight;
  return Math.round(raw * 100) / 100;
}

/**
 * Evaluate the absolute gates for a single course.
 *
 * @returns {{ rawScore: number|null, eligibility: string, blockers: Array, unknowns: Array }}
 */
export function evaluateCourse({ midterm, final, attendancePercent }, ruleset) {
  const blockers = [];
  const unknowns = [];

  if (typeof attendancePercent !== 'number' || !Number.isFinite(attendancePercent)) {
    unknowns.push({
      gate: 'attendance',
      reason: `Attendance not provided; ${ruleset.attendance.requiredPercent}% is required to sit the final.`,
    });
  } else if (attendancePercent < ruleset.attendance.requiredPercent) {
    blockers.push({
      gate: 'attendance',
      detail: `Attendance ${attendancePercent}% is below the required ${ruleset.attendance.requiredPercent}%.`,
    });
  }

  if (!isScore(final)) {
    unknowns.push({
      gate: 'final-exam-floor',
      reason: `Final exam score not provided; it must be at least ${ruleset.floors.finalExamMinimum}.`,
    });
  } else if (final < ruleset.floors.finalExamMinimum) {
    blockers.push({
      gate: 'final-exam-floor',
      detail: `Final exam ${final} is below the limit of ${ruleset.floors.finalExamMinimum}.`,
    });
  }

  const rawScore = computeRawScore({ midterm, final }, ruleset);
  if (rawScore === null) {
    unknowns.push({
      gate: 'raw-score-floor',
      reason: `Raw score cannot be computed; it must reach at least ${ruleset.floors.rawScoreMinimum}.`,
    });
  } else if (rawScore < ruleset.floors.rawScoreMinimum) {
    blockers.push({
      gate: 'raw-score-floor',
      detail: `Raw score ${rawScore} is below the floor of ${ruleset.floors.rawScoreMinimum}.`,
    });
  }

  let eligibility;
  if (blockers.length > 0) {
    // A proven blocker is decisive even if other gates are unknown.
    eligibility = ELIGIBILITY.BLOCKED;
  } else if (unknowns.length > 0) {
    eligibility = ELIGIBILITY.UNKNOWN;
  } else {
    eligibility = ELIGIBILITY.ELIGIBLE;
  }

  return Object.freeze({
    rawScore,
    eligibility,
    blockers: Object.freeze(blockers),
    unknowns: Object.freeze(unknowns),
    // Stated on every result so no caller can forget it.
    letterGradeDeterminable: false,
    letterGradeNote:
      'Passing the absolute gates does not fix a letter grade. The letter is set by relative assessment against the whole cohort, which this tool cannot and does not model.',
  });
}

/** Minimum final-exam score that would lift the raw score to the floor. */
export function finalScoreNeededForRawFloor(midterm, ruleset) {
  if (!isScore(midterm)) return null;
  const { midtermWeight, finalWeight } = ruleset.weights;
  const needed = (ruleset.floors.rawScoreMinimum - midterm * midtermWeight) / finalWeight;
  const bounded = Math.max(needed, ruleset.floors.finalExamMinimum);
  if (bounded > 100) return { attainable: false, needed: Math.round(bounded * 100) / 100 };
  return { attainable: true, needed: Math.round(bounded * 100) / 100 };
}
