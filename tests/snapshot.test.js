import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPLETENESS,
  KNOWN_FIELDS,
  covers,
  normalizeCode,
  normalizeTitle,
  validateSnapshot,
} from '../site/modules/snapshot.js';

function base(overrides = {}) {
  return {
    snapshot_id: 'test',
    scope: 'test scope',
    completeness: COMPLETENESS.FULL,
    covered_fields: ['title', 'ects', 'semester'],
    source: { url: 'https://example.org', fetched_at: '2026-09-05T00:00:00Z', provenance: 'test' },
    courses: [{ code: 'EKO1001', title: 'Matematik I', ects: 5, semester: 1 }],
    ...overrides,
  };
}

test('normalizeCode strips separators and uppercases', () => {
  assert.equal(normalizeCode(' eko-1001 '), 'EKO1001');
  assert.equal(normalizeCode(null), '');
});

test('normalizeTitle folds punctuation and whitespace', () => {
  assert.equal(normalizeTitle('İstatistiksel  Karar-Teorisi'), 'istatistiksel karar teorisi');
  assert.equal(normalizeTitle('  Ekonometri   II  '), 'ekonometri ii');
  assert.equal(normalizeTitle(42), '');
  assert.equal(normalizeTitle(null), '');
});

test('normalizeTitle survives the Turkish dotted/dotless i trap', () => {
  // Same title, different source casing: must still match, or a recode would be
  // misreported as a removal plus an addition.
  assert.equal(normalizeTitle('Matematik I'), normalizeTitle('MATEMATIK I'));
  assert.equal(normalizeTitle('Matematik I'), normalizeTitle('matematik i'));
  assert.equal(normalizeTitle('İleri Excel'), normalizeTitle('İLERİ EXCEL'));
  assert.equal(normalizeTitle('Finansal İstatistik'), 'finansal istatistik');
});

test('a valid snapshot round-trips and freezes', () => {
  const { ok, errors, snapshot } = validateSnapshot(base());
  assert.equal(ok, true, errors.join('; '));
  assert.equal(snapshot.courses.length, 1);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(snapshot.byCode.get('EKO1001').title, 'Matematik I');
});

test('scope is mandatory: completeness is meaningless without it', () => {
  const { ok, errors } = validateSnapshot(base({ scope: '   ' }));
  assert.equal(ok, false);
  assert.equal(errors.some((e) => e.includes('scope')), true);
});

test('covered_fields is required even for a full snapshot', () => {
  const raw = base();
  delete raw.covered_fields;
  const { ok, errors } = validateSnapshot(raw);
  assert.equal(ok, false);
  assert.equal(errors.some((e) => e.includes('covered_fields')), true);
});

test('unknown covered_fields are rejected, not silently dropped', () => {
  const { ok, errors } = validateSnapshot(base({ covered_fields: ['title', 'kredi'] }));
  assert.equal(ok, false);
  assert.equal(errors.some((e) => e.includes('kredi')), true);
});

test('a claimed field missing from a course is an error', () => {
  const { ok, errors } = validateSnapshot(
    base({ courses: [{ code: 'EKO1001', title: 'Matematik I', semester: 1 }] }),
  );
  assert.equal(ok, false);
  assert.equal(errors.some((e) => e.includes('ects')), true);
});

test('fields outside covered_fields are not required', () => {
  const { ok } = validateSnapshot(
    base({ covered_fields: ['title'], courses: [{ code: 'EKO1001', title: 'Matematik I' }] }),
  );
  assert.equal(ok, true);
});

test('codes that collide after normalization are rejected', () => {
  const { ok, errors } = validateSnapshot(
    base({
      covered_fields: ['title'],
      courses: [
        { code: 'EKO 1001', title: 'Matematik I' },
        { code: 'eko-1001', title: 'Matematik I (tekrar)' },
      ],
    }),
  );
  assert.equal(ok, false);
  assert.equal(errors.some((e) => e.includes('duplicates')), true);
});

test('source provenance and timestamp are enforced', () => {
  const { ok, errors } = validateSnapshot(
    base({ source: { url: 'https://example.org', fetched_at: 'yakında', provenance: '' } }),
  );
  assert.equal(ok, false);
  assert.equal(errors.some((e) => e.includes('fetched_at')), true);
  assert.equal(errors.some((e) => e.includes('provenance')), true);
});

test('validateSnapshot never throws on hostile input', () => {
  for (const input of [null, undefined, 42, 'snapshot', [], { courses: 'no' }]) {
    const result = validateSnapshot(input);
    assert.equal(result.ok, false);
    assert.equal(Array.isArray(result.errors), true);
    assert.equal(result.snapshot, null);
  }
});

test('covers() reflects exactly what was declared', () => {
  const { snapshot } = validateSnapshot(base({ covered_fields: ['title', 'semester'] }));
  assert.equal(covers(snapshot, 'title'), true);
  assert.equal(covers(snapshot, 'ects'), false);
  for (const field of KNOWN_FIELDS) {
    assert.equal(typeof covers(snapshot, field), 'boolean');
  }
});
