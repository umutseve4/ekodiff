/**
 * EkoDiff — the difference engine between two curriculum snapshots.
 *
 * The engine exists because of one observation: a university curriculum is a
 * slowly-changing dimension that nobody versions. Course codes get reassigned,
 * ECTS values drift, prerequisites are rewritten, and the previous page simply
 * stops existing. A student who planned against last year's catalogue has no
 * way to discover what moved.
 *
 * The hardest requirement here is epistemic, not algorithmic: the engine must
 * distinguish "this course was removed" from "I cannot see whether this course
 * was removed". Conflating those two produces confident lies, which is worse
 * than producing nothing. Every code path below is fail-closed toward
 * "unknown".
 */

import { covers, normalizeTitle, COMPLETENESS } from './snapshot.js';

export const CHANGE = Object.freeze({
  ADDED: 'added',
  REMOVED: 'removed',
  CHANGED: 'changed',
  RECODED: 'recoded',
  UNCHANGED: 'unchanged',
  UNKNOWN_ADDED: 'unknown-added',
  UNKNOWN_REMOVED: 'unknown-removed',
});

/** Fields compared, in the order a reader wants to see them. */
const COMPARABLE = Object.freeze(['title', 'ects', 'semester', 'category', 'theory', 'practice']);

function valuesDiffer(field, a, b) {
  if (field === 'title') return normalizeTitle(a) !== normalizeTitle(b);
  return a !== b;
}

/**
 * Compare one course present on both sides.
 * Returns { fieldChanges, unknownFields }.
 */
function compareCourse(from, to, fromSnapshot, toSnapshot) {
  const fieldChanges = [];
  const unknownFields = [];
  for (const field of COMPARABLE) {
    const fromCovers = covers(fromSnapshot, field);
    const toCovers = covers(toSnapshot, field);
    if (!fromCovers || !toCovers) {
      unknownFields.push({
        field,
        reason: !fromCovers && !toCovers
          ? 'neither snapshot records this field'
          : `${!fromCovers ? fromSnapshot.snapshot_id : toSnapshot.snapshot_id} does not record this field`,
      });
      continue;
    }
    if (valuesDiffer(field, from[field], to[field])) {
      fieldChanges.push({ field, from: from[field] ?? null, to: to[field] ?? null });
    }
  }
  return { fieldChanges, unknownFields };
}

/**
 * Detect 1:1 recodes among the courses that failed to match by code.
 *
 * A recode is only claimed when exactly one leftover on each side shares a
 * normalized title. Any ambiguity (two courses with the same title) leaves both
 * sides unmatched, because a wrong recode silently rewrites a student's history.
 */
function matchRecodes(leftoverFrom, leftoverTo, fromSnapshot, toSnapshot) {
  const pairs = [];
  if (!covers(fromSnapshot, 'title') || !covers(toSnapshot, 'title')) {
    return { pairs, unmatchedFrom: leftoverFrom, unmatchedTo: leftoverTo };
  }

  const indexBy = (courses) => {
    const index = new Map();
    for (const course of courses) {
      const key = normalizeTitle(course.title);
      if (key === '') continue;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(course);
    }
    return index;
  };

  const fromIndex = indexBy(leftoverFrom);
  const toIndex = indexBy(leftoverTo);
  const consumedFrom = new Set();
  const consumedTo = new Set();

  for (const [key, fromGroup] of fromIndex) {
    const toGroup = toIndex.get(key);
    if (!toGroup) continue;
    if (fromGroup.length !== 1 || toGroup.length !== 1) continue; // ambiguous: refuse
    pairs.push({ from: fromGroup[0], to: toGroup[0] });
    consumedFrom.add(fromGroup[0].code);
    consumedTo.add(toGroup[0].code);
  }

  return {
    pairs,
    unmatchedFrom: leftoverFrom.filter((c) => !consumedFrom.has(c.code)),
    unmatchedTo: leftoverTo.filter((c) => !consumedTo.has(c.code)),
  };
}

/**
 * Diff two validated snapshots in the direction from → to.
 *
 * @returns a frozen report; entries are sorted so that the loudest signal
 *          (recodes and removals) is read before the quiet one (unchanged).
 */
export function diffSnapshots(fromSnapshot, toSnapshot) {
  const entries = [];
  const matchedTo = new Set();
  const leftoverFrom = [];

  for (const fromCourse of fromSnapshot.courses) {
    const toCourse = toSnapshot.byCode.get(fromCourse.code);
    if (!toCourse) {
      leftoverFrom.push(fromCourse);
      continue;
    }
    matchedTo.add(toCourse.code);
    const { fieldChanges, unknownFields } = compareCourse(
      fromCourse,
      toCourse,
      fromSnapshot,
      toSnapshot,
    );
    entries.push({
      kind: fieldChanges.length > 0 ? CHANGE.CHANGED : CHANGE.UNCHANGED,
      code: fromCourse.code,
      toCode: toCourse.code,
      title: toCourse.title ?? fromCourse.title ?? null,
      fieldChanges,
      unknownFields,
    });
  }

  const leftoverTo = toSnapshot.courses.filter((c) => !matchedTo.has(c.code));
  const { pairs, unmatchedFrom, unmatchedTo } = matchRecodes(
    leftoverFrom,
    leftoverTo,
    fromSnapshot,
    toSnapshot,
  );

  for (const pair of pairs) {
    const { fieldChanges, unknownFields } = compareCourse(
      pair.from,
      pair.to,
      fromSnapshot,
      toSnapshot,
    );
    entries.push({
      kind: CHANGE.RECODED,
      code: pair.from.code,
      toCode: pair.to.code,
      title: pair.to.title ?? pair.from.title ?? null,
      fieldChanges: fieldChanges.filter((c) => c.field !== 'title'),
      unknownFields,
    });
  }

  // Present in `from`, absent from `to`. Only a complete `to` can prove removal.
  const toIsComplete = toSnapshot.completeness === COMPLETENESS.FULL;
  for (const course of unmatchedFrom) {
    entries.push({
      kind: toIsComplete ? CHANGE.REMOVED : CHANGE.UNKNOWN_REMOVED,
      code: course.code,
      toCode: null,
      title: course.title ?? null,
      fieldChanges: [],
      unknownFields: toIsComplete
        ? []
        : [{ field: '*', reason: `${toSnapshot.snapshot_id} is a partial snapshot, so absence is not evidence of removal` }],
    });
  }

  // Present in `to`, absent from `from`. Only a complete `from` can prove addition.
  const fromIsComplete = fromSnapshot.completeness === COMPLETENESS.FULL;
  for (const course of unmatchedTo) {
    entries.push({
      kind: fromIsComplete ? CHANGE.ADDED : CHANGE.UNKNOWN_ADDED,
      code: null,
      toCode: course.code,
      title: course.title ?? null,
      fieldChanges: [],
      unknownFields: fromIsComplete
        ? []
        : [{ field: '*', reason: `${fromSnapshot.snapshot_id} is a partial snapshot, so absence is not evidence of addition` }],
    });
  }

  const order = [
    CHANGE.RECODED,
    CHANGE.REMOVED,
    CHANGE.UNKNOWN_REMOVED,
    CHANGE.ADDED,
    CHANGE.UNKNOWN_ADDED,
    CHANGE.CHANGED,
    CHANGE.UNCHANGED,
  ];
  entries.sort((a, b) => {
    const byKind = order.indexOf(a.kind) - order.indexOf(b.kind);
    if (byKind !== 0) return byKind;
    return String(a.code ?? a.toCode).localeCompare(String(b.code ?? b.toCode), 'tr-TR');
  });

  const summary = {};
  for (const kind of Object.values(CHANGE)) summary[kind] = 0;
  for (const entry of entries) summary[entry.kind] += 1;

  // Comparing across different scopes is a category error: every course outside
  // the shared scope would look added or removed. Report it loudly.
  const sameScope = fromSnapshot.scope === toSnapshot.scope;
  const certain = fromIsComplete && toIsComplete && sameScope;
  const caveats = [];
  if (!sameScope) {
    caveats.push(
      `Scope mismatch: "${fromSnapshot.scope}" vs "${toSnapshot.scope}". Differences outside the shared scope are artifacts of the comparison, not curriculum changes.`,
    );
  }
  if (!fromIsComplete || !toIsComplete) {
    caveats.push(
      'At least one snapshot is partial. Additions and removals it cannot see are reported as unknown, never as fact.',
    );
  }

  return Object.freeze({
    from: Object.freeze({
      id: fromSnapshot.snapshot_id,
      label: fromSnapshot.label,
      scope: fromSnapshot.scope,
      completeness: fromSnapshot.completeness,
    }),
    to: Object.freeze({
      id: toSnapshot.snapshot_id,
      label: toSnapshot.label,
      scope: toSnapshot.scope,
      completeness: toSnapshot.completeness,
    }),
    certain,
    sameScope,
    caveats: Object.freeze(caveats),
    caveat: caveats.length > 0 ? caveats.join(' ') : null,
    entries: Object.freeze(entries.map(Object.freeze)),
    summary: Object.freeze(summary),
  });
}
