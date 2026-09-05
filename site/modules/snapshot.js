/**
 * Snapshot model and validation for EkoDiff.
 *
 * A snapshot is a dated, source-attributed capture of a curriculum as it was
 * published at one moment. Snapshots are immutable records, not opinions.
 *
 * Design rule that governs this whole file: a snapshot must be able to say
 * "I do not know" as loudly as it says "this is the value". A partial snapshot
 * that silently looks complete is the single most dangerous artifact this
 * project could produce, because every downstream diff would report phantom
 * removals.
 */

/** Fields a snapshot may claim to cover. */
export const KNOWN_FIELDS = Object.freeze([
  'title',
  'ects',
  'semester',
  'category',
  'theory',
  'practice',
]);

export const COMPLETENESS = Object.freeze({
  FULL: 'full',
  PARTIAL: 'partial',
});

/**
 * Normalize a course title for cross-code matching (recode detection).
 *
 * The dotted/dotless i is the trap here. Turkish casing is not round-trippable:
 * "Matematik I".toLocaleLowerCase('tr-TR') is "matematik ı", while
 * "MATEMATIK I" lowercases to "matematık ı". The same course title, captured
 * from two pages with different casing, would then fail to match and a recode
 * would be reported as a removal plus an addition.
 *
 * So after lowercasing, every i-family character is folded to plain "i". This
 * deliberately over-folds (ı and i become one letter) — for title matching that
 * is the safe direction, because the alternative is silent false removals.
 */
export function normalizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .toLocaleLowerCase('tr-TR')
    .replace(/[ıİi\u0130\u0131]/g, 'i')
    .replace(/\u0307/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Normalize a course code: uppercase, strip all non-alphanumerics. */
export function normalizeCode(code) {
  if (typeof code !== 'string') return '';
  return code.toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9]/g, '');
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validate a raw snapshot object.
 * Returns { ok, errors, snapshot } — never throws, never repairs silently.
 */
export function validateSnapshot(raw) {
  const errors = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['snapshot must be an object'], snapshot: null };
  }

  if (typeof raw.snapshot_id !== 'string' || raw.snapshot_id.trim() === '') {
    errors.push('snapshot_id must be a non-empty string');
  }

  // `completeness` is always relative to `scope`. "full" never means "the entire
  // university"; it means "every course inside this declared scope". Without a
  // scope the word is meaningless, so it is mandatory.
  if (typeof raw.scope !== 'string' || raw.scope.trim() === '') {
    errors.push('scope must be a non-empty string describing what this snapshot claims to cover');
  }

  const completeness = raw.completeness;
  if (completeness !== COMPLETENESS.FULL && completeness !== COMPLETENESS.PARTIAL) {
    errors.push(`completeness must be "full" or "partial", got ${JSON.stringify(completeness)}`);
  }

  // Two independent axes of incompleteness, deliberately not conflated:
  //   `completeness`   — is the COURSE SET inside `scope` exhaustive?
  //   `covered_fields` — which FIELDS of each course were actually captured?
  // A snapshot can list every course in its scope while knowing nothing about
  // their ECTS. Merging these two into one flag would force a lie in one
  // direction or the other, so covered_fields is always declared explicitly.
  let coveredFields = [];
  if (!Array.isArray(raw.covered_fields) || raw.covered_fields.length === 0) {
    errors.push('covered_fields must be a non-empty array naming the fields this snapshot captured');
  } else {
    const unknown = raw.covered_fields.filter((f) => !KNOWN_FIELDS.includes(f));
    if (unknown.length > 0) {
      errors.push(`covered_fields contains unknown field(s): ${unknown.join(', ')}`);
    }
    coveredFields = raw.covered_fields.filter((f) => KNOWN_FIELDS.includes(f));
  }

  const source = raw.source;
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    errors.push('source must be an object');
  } else {
    if (typeof source.url !== 'string' || source.url.trim() === '') {
      errors.push('source.url must be a non-empty string');
    }
    if (typeof source.fetched_at !== 'string' || Number.isNaN(Date.parse(source.fetched_at))) {
      errors.push('source.fetched_at must be an ISO 8601 timestamp');
    }
    if (typeof source.provenance !== 'string' || source.provenance.trim() === '') {
      errors.push('source.provenance must state how this snapshot was obtained');
    }
  }

  if (!Array.isArray(raw.courses)) {
    errors.push('courses must be an array');
    return { ok: false, errors, snapshot: null };
  }

  const seen = new Map();
  const courses = [];
  raw.courses.forEach((course, index) => {
    const where = `courses[${index}]`;
    if (course === null || typeof course !== 'object' || Array.isArray(course)) {
      errors.push(`${where} must be an object`);
      return;
    }
    const code = normalizeCode(course.code);
    if (code === '') {
      errors.push(`${where}.code must be a non-empty string`);
      return;
    }
    if (seen.has(code)) {
      errors.push(
        `${where}.code "${course.code}" duplicates courses[${seen.get(code)}] after normalization`,
      );
      return;
    }
    seen.set(code, index);

    for (const field of coveredFields) {
      const value = course[field];
      if (value === undefined || value === null) {
        errors.push(`${where}.${field} is required because the snapshot claims to cover it`);
        continue;
      }
      if ((field === 'ects' || field === 'theory' || field === 'practice') && !isFiniteNumber(value)) {
        errors.push(`${where}.${field} must be a finite number`);
      }
      if (field === 'semester' && !Number.isInteger(value)) {
        errors.push(`${where}.semester must be an integer`);
      }
      if ((field === 'title' || field === 'category') && typeof value !== 'string') {
        errors.push(`${where}.${field} must be a string`);
      }
    }
    courses.push(course);
  });

  if (errors.length > 0) return { ok: false, errors, snapshot: null };

  const byCode = new Map();
  for (const course of courses) {
    const normalized = { ...course, code: normalizeCode(course.code) };
    byCode.set(normalized.code, Object.freeze(normalized));
  }

  return {
    ok: true,
    errors: [],
    snapshot: Object.freeze({
      snapshot_id: raw.snapshot_id,
      label: typeof raw.label === 'string' ? raw.label : raw.snapshot_id,
      scope: raw.scope,
      completeness,
      coveredFields: Object.freeze([...coveredFields]),
      source: Object.freeze({ ...raw.source }),
      notes: Object.freeze(Array.isArray(raw.notes) ? [...raw.notes] : []),
      byCode,
      courses: Object.freeze([...byCode.values()]),
    }),
  };
}

/** True when this snapshot is authoritative about the given field. */
export function covers(snapshot, field) {
  return snapshot.coveredFields.includes(field);
}
