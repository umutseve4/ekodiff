/**
 * The Academic Time Machine — a local-first what-if engine.
 *
 * Everything here is a pure function over data the student typed into their own
 * browser. Nothing is uploaded, and this module has no I/O whatsoever: no fetch,
 * no storage, no clock. That is not an aesthetic preference — it is what makes
 * the privacy claim on the site verifiable by reading one file.
 *
 * Second governing rule: the grade-point scale is not assumed, it is cited. The
 * shipped table comes verbatim from MADDE 32/(3) of the BUÜ undergraduate
 * regulation (RG 20.09.2020/31250), and the data file carries that citation
 * next to the numbers. The doubt machinery below is therefore not deleted but
 * inverted: any scale whose `verification` is not `verified` still pushes its
 * own note into every result, so an unsourced table can never be rendered as a
 * confident average.
 *
 * What stays out on purpose: letter grades. The regulation defines no fixed
 * 100-point bands — letters fall out of relative assessment against the class
 * distribution, and this project has no such data. So a score never becomes a
 * letter here; only a settled letter becomes a coefficient.
 */

export const STATUS = Object.freeze({
  COMPLETED: 'completed',
  IN_PROGRESS: 'in-progress',
  PLANNED: 'planned',
});

function round2(value) {
  return Math.round(value * 100) / 100;
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Compute a weighted grade-point average over graded entries only.
 *
 * Entries without a grade are excluded from BOTH numerator and denominator —
 * an ungraded course must never silently depress an average.
 */
export function computeGpa(entries, scale) {
  const warnings = [];
  let points = 0;
  let gradedEcts = 0;
  const counted = [];
  const skipped = [];

  for (const entry of entries) {
    if (!isPositiveNumber(entry.ects)) {
      warnings.push(`"${entry.code}" has a non-positive or missing ECTS value and was excluded.`);
      skipped.push(entry);
      continue;
    }
    if (entry.grade === undefined || entry.grade === null || entry.grade === '') {
      skipped.push(entry);
      continue;
    }
    const point = scale.points[entry.grade];
    if (typeof point !== 'number') {
      warnings.push(`Grade "${entry.grade}" on "${entry.code}" is not in the scale and was excluded.`);
      skipped.push(entry);
      continue;
    }
    points += entry.ects * point;
    gradedEcts += entry.ects;
    counted.push(entry);
  }

  if (scale.verification !== 'verified') {
    warnings.push(scale.verificationNote);
  }

  return Object.freeze({
    gpa: gradedEcts > 0 ? round2(points / gradedEcts) : null,
    qualityPoints: round2(points),
    gradedEcts: round2(gradedEcts),
    countedCount: counted.length,
    skippedCount: skipped.length,
    warnings: Object.freeze(warnings),
  });
}

/**
 * Full programme standing, including the conditional-pass rule.
 *
 * The conditional rule is the subtle one: DC and DD count as passing only while
 * the cumulative GPA is at or above the threshold. So a student can *lose*
 * already-earned credit by letting their average slip — which is exactly the
 * kind of consequence a static transcript never shows and this engine must.
 */
export function summarizeProgram(entries, programme, scale) {
  const gpaResult = computeGpa(entries, scale);
  const gpa = gpaResult.gpa;
  const threshold = programme.minimumGpa;
  const conditionalSatisfied = gpa !== null && gpa >= threshold;

  let earnedEcts = 0;
  const conditional = [];
  const failed = [];

  for (const entry of entries) {
    if (!isPositiveNumber(entry.ects)) continue;
    const grade = entry.grade;
    if (grade === undefined || grade === null || grade === '') continue;
    if (scale.passing.includes(grade)) {
      earnedEcts += entry.ects;
    } else if (scale.conditional.includes(grade)) {
      conditional.push({ code: entry.code, ects: entry.ects, grade });
      if (conditionalSatisfied) earnedEcts += entry.ects;
    } else if (typeof scale.points[grade] === 'number') {
      failed.push({ code: entry.code, ects: entry.ects, grade });
    }
  }

  const conditionalEcts = round2(conditional.reduce((sum, c) => sum + c.ects, 0));
  const remainingEcts = round2(Math.max(programme.requiredEcts - earnedEcts, 0));
  const ectsMet = earnedEcts >= programme.requiredEcts;
  const gpaMet = conditionalSatisfied;

  const warnings = [...gpaResult.warnings];
  if (conditional.length > 0 && !conditionalSatisfied) {
    warnings.push(
      `${conditional.length} course(s) graded ${scale.conditional.join('/')} (${conditionalEcts} ECTS) do not currently count, because the GPA is below ${threshold.toFixed(2)}.`,
    );
  }

  return Object.freeze({
    gpa,
    gradedEcts: gpaResult.gradedEcts,
    qualityPoints: gpaResult.qualityPoints,
    earnedEcts: round2(earnedEcts),
    remainingEcts,
    conditional: Object.freeze(conditional),
    conditionalEcts,
    conditionalCounted: conditionalSatisfied,
    failed: Object.freeze(failed),
    graduation: Object.freeze({
      requiredEcts: programme.requiredEcts,
      minimumGpa: threshold,
      ectsMet,
      gpaMet,
      ready: ectsMet && gpaMet,
    }),
    warnings: Object.freeze(warnings),
  });
}

/**
 * Apply mutations to a transcript without touching the original array.
 *
 * Supported mutations:
 *   { type: 'set-grade', code, grade }
 *   { type: 'drop', code }
 *   { type: 'add', course: { code, ects, grade?, status? } }
 *
 * Unknown mutation types and unknown course codes are reported, not ignored:
 * a silently discarded what-if is a wrong answer wearing a right answer's face.
 */
export function applyMutations(entries, mutations) {
  const next = entries.map((entry) => ({ ...entry }));
  const problems = [];

  for (const [index, mutation] of mutations.entries()) {
    const where = `mutations[${index}]`;
    if (mutation === null || typeof mutation !== 'object') {
      problems.push(`${where} is not an object`);
      continue;
    }
    if (mutation.type === 'set-grade') {
      const target = next.find((e) => e.code === mutation.code);
      if (!target) {
        problems.push(`${where}: no course with code "${mutation.code}"`);
        continue;
      }
      target.grade = mutation.grade;
      target.status = STATUS.COMPLETED;
    } else if (mutation.type === 'drop') {
      const at = next.findIndex((e) => e.code === mutation.code);
      if (at === -1) {
        problems.push(`${where}: no course with code "${mutation.code}"`);
        continue;
      }
      next.splice(at, 1);
    } else if (mutation.type === 'add') {
      const course = mutation.course;
      if (course === null || typeof course !== 'object' || typeof course.code !== 'string') {
        problems.push(`${where}: add requires a course object with a code`);
        continue;
      }
      if (next.some((e) => e.code === course.code)) {
        problems.push(`${where}: course "${course.code}" is already present`);
        continue;
      }
      next.push({ status: STATUS.PLANNED, ...course });
    } else {
      problems.push(`${where}: unknown mutation type ${JSON.stringify(mutation.type)}`);
    }
  }

  return { entries: next, problems };
}

/** Run a what-if and report the delta against the untouched baseline. */
export function whatIf(entries, mutations, programme, scale) {
  const before = summarizeProgram(entries, programme, scale);
  const { entries: mutated, problems } = applyMutations(entries, mutations);
  const after = summarizeProgram(mutated, programme, scale);

  const gpaDelta = before.gpa === null || after.gpa === null ? null : round2(after.gpa - before.gpa);

  return Object.freeze({
    before,
    after,
    problems: Object.freeze(problems),
    delta: Object.freeze({
      gpa: gpaDelta,
      earnedEcts: round2(after.earnedEcts - before.earnedEcts),
      remainingEcts: round2(after.remainingEcts - before.remainingEcts),
      conditionalFlipped: before.conditionalCounted !== after.conditionalCounted,
      graduationReadyChanged: before.graduation.ready !== after.graduation.ready,
    }),
  });
}

/**
 * The average grade point that must be sustained across the remaining ECTS to
 * reach a target GPA.
 *
 * Returns attainable:false rather than a comforting number when the target is
 * arithmetically out of reach — the whole point of the exercise is to find that
 * out early enough to act.
 */
export function requiredAverageForTarget(entries, programme, scale, targetGpa) {
  const summary = summarizeProgram(entries, programme, scale);
  const remainingEcts = programme.requiredEcts - summary.gradedEcts;

  if (remainingEcts <= 0) {
    return Object.freeze({
      attainable: summary.gpa !== null && summary.gpa >= targetGpa,
      required: null,
      remainingEcts: 0,
      reason: 'No remaining ECTS: the average is already final.',
    });
  }

  const totalEcts = summary.gradedEcts + remainingEcts;
  const required = (targetGpa * totalEcts - summary.qualityPoints) / remainingEcts;
  const maxPoint = Math.max(...Object.values(scale.points));

  if (required <= 0) {
    return Object.freeze({
      attainable: true,
      required: 0,
      remainingEcts: round2(remainingEcts),
      reason: `Target ${targetGpa.toFixed(2)} is already secured by the current record.`,
    });
  }

  return Object.freeze({
    attainable: required <= maxPoint,
    required: round2(required),
    remainingEcts: round2(remainingEcts),
    reason:
      required <= maxPoint
        ? `Average of ${round2(required)} needed across the remaining ${round2(remainingEcts)} ECTS.`
        : `Out of reach: ${round2(required)} exceeds the maximum grade point of ${maxPoint}.`,
  });
}
