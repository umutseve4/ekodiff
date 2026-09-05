/*
 * UI wiring. All domain logic lives in ./modules/ — this file only fetches
 * public curriculum JSON, renders, and talks to localStorage.
 *
 * Two rules govern everything below:
 *   1. Nothing leaves the browser. The only network calls are GETs for this
 *      site's own static data files.
 *   2. Uncertainty is rendered, not hidden. Every caveat the engines emit is
 *      shown next to the number it qualifies.
 */

import { validateSnapshot } from './modules/snapshot.js';
import { CHANGE, diffSnapshots } from './modules/diff.js';
import { ELIGIBILITY, evaluateCourse } from './modules/rules.js';
import {
  requiredAverageForTarget,
  summarizeProgram,
  whatIf,
} from './modules/simulate.js';

const STORAGE_KEY = 'ekodiff.transcript.v1';

const KIND_LABEL = {
  [CHANGE.RECODED]: 'kodu değişti',
  [CHANGE.REMOVED]: 'kaldırıldı',
  [CHANGE.ADDED]: 'eklendi',
  [CHANGE.CHANGED]: 'değişti',
  [CHANGE.UNCHANGED]: 'aynı',
  [CHANGE.UNKNOWN_REMOVED]: 'kaldırıldı mı? bilinmiyor',
  [CHANGE.UNKNOWN_ADDED]: 'eklendi mi? bilinmiyor',
};

const FIELD_LABEL = {
  title: 'ad',
  ects: 'AKTS',
  semester: 'yarıyıl',
  category: 'tür',
  theory: 'teori saati',
  practice: 'uygulama saati',
  '*': 'tümü',
};

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const state = {
  snapshots: new Map(),
  manifest: null,
  ruleset: null,
  transcript: [],
  catalogue: new Map(),
  activeKinds: new Set(),
};

/* ───────────────────────────── boot ───────────────────────────── */

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${url} yüklenemedi (HTTP ${response.status})`);
  return response.json();
}

async function boot() {
  try {
    state.manifest = await getJson('data/index.json');
    state.ruleset = await getJson(state.manifest.rules);

    for (const entry of state.manifest.snapshots) {
      const raw = await getJson(entry.file);
      const { ok, errors, snapshot } = validateSnapshot(raw);
      if (!ok) {
        // A malformed snapshot is refused rather than rendered. Showing a
        // half-parsed curriculum would be worse than showing none.
        throw new Error(`${entry.file} geçersiz: ${errors.join('; ')}`);
      }
      state.snapshots.set(entry.id, { snapshot, meta: entry, raw });
    }
  } catch (error) {
    document.querySelector('main').prepend(
      el('div', 'caveats', `Veri yüklenemedi: ${error.message}`),
    );
    return;
  }

  buildCatalogue();
  setupTabs();
  setupDiff();
  setupTimeMachine();
}

/** Every course the site knows about, for the transcript picker. */
function buildCatalogue() {
  for (const { snapshot } of state.snapshots.values()) {
    for (const course of snapshot.courses) {
      // A course with no recorded ECTS cannot participate in a GPA, so it is
      // kept out of the picker rather than defaulted to a made-up value.
      if (typeof course.ects !== 'number') continue;
      if (!state.catalogue.has(course.code)) {
        state.catalogue.set(course.code, {
          code: course.code,
          title: course.title ?? course.code,
          ects: course.ects,
          semester: course.semester ?? 99,
          category: course.category ?? '',
        });
      }
    }
  }
}

/* ───────────────────────────── tabs ───────────────────────────── */

function setupTabs() {
  const tabs = [
    { tab: $('tab-diff'), panel: $('panel-diff') },
    { tab: $('tab-time'), panel: $('panel-time') },
  ];
  const select = (index) => {
    tabs.forEach(({ tab, panel }, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      panel.hidden = !on;
    });
    tabs[index].tab.focus();
  };
  tabs.forEach(({ tab }, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowRight') select((i + 1) % tabs.length);
      if (event.key === 'ArrowLeft') select((i - 1 + tabs.length) % tabs.length);
    });
  });
}

/* ───────────────────────────── EkoDiff ───────────────────────────── */

function setupDiff() {
  const fromSelect = $('from-select');
  const toSelect = $('to-select');

  for (const { meta } of state.snapshots.values()) {
    for (const select of [fromSelect, toSelect]) {
      const option = el('option', null, meta.label);
      option.value = meta.id;
      select.append(option);
    }
  }

  const defaultFrom = state.manifest.snapshots.find((s) => s.default_from);
  const defaultTo = state.manifest.snapshots.find((s) => s.default_to);
  if (defaultFrom) fromSelect.value = defaultFrom.id;
  if (defaultTo) toSelect.value = defaultTo.id;

  fromSelect.addEventListener('change', renderDiff);
  toSelect.addEventListener('change', renderDiff);
  renderDiff();
}

function renderDiff() {
  const from = state.snapshots.get($('from-select').value);
  const to = state.snapshots.get($('to-select').value);
  if (!from || !to) return;

  const report = diffSnapshots(from.snapshot, to.snapshot);

  renderDiffMeta(from, to);
  renderDiffCaveats(report);
  renderDiffSummary(report);
  renderDiffFilters(report);
  renderDiffEntries(report);
  renderDiffSources(from, to);
}

function renderDiffMeta(from, to) {
  const host = $('diff-meta');
  host.replaceChildren();
  for (const [role, item] of [['Eski sürüm', from], ['Yeni sürüm', to]]) {
    const card = el('div', 'meta-card');
    card.append(el('h3', null, `${role}: ${item.snapshot.label}`));
    const dl = el('dl');
    const rows = [
      ['Kapsam', item.snapshot.scope],
      ['Eksiksizlik', item.snapshot.completeness === 'full'
        ? 'Bu kapsamdaki tüm dersler'
        : 'Kısmi — kapsamın tamamı değil'],
      ['Kayıtlı alanlar', item.snapshot.coveredFields.map((f) => FIELD_LABEL[f] ?? f).join(', ')],
      ['Kaynak', item.snapshot.source.url],
      ['Alınma tarihi', new Date(item.snapshot.source.fetched_at).toLocaleDateString('tr-TR')],
      ['Elde ediliş', item.snapshot.source.provenance],
    ];
    for (const [term, value] of rows) {
      dl.append(el('dt', null, term), el('dd', null, String(value)));
    }
    card.append(dl);
    host.append(card);
  }
}

function renderDiffCaveats(report) {
  const host = $('diff-caveats');
  host.replaceChildren();
  if (report.certain) {
    host.append(el('p', null,
      'Her iki sürüm de kendi kapsamında eksiksiz ve kapsamlar aynı. Aşağıdaki ekleme ve kaldırmalar kanıtlıdır.'));
    return;
  }
  for (const caveat of report.caveats) host.append(el('p', null, caveat));
}

function renderDiffSummary(report) {
  const host = $('diff-summary');
  host.replaceChildren();
  for (const [kind, count] of Object.entries(report.summary)) {
    if (count === 0) continue;
    const chip = el('span', 'chip');
    chip.append(el('b', null, String(count)), el('span', null, KIND_LABEL[kind] ?? kind));
    host.append(chip);
  }
}

function renderDiffFilters(report) {
  const host = $('diff-filters');
  host.replaceChildren();
  const present = Object.entries(report.summary).filter(([, count]) => count > 0).map(([kind]) => kind);

  // Default view hides the silent majority so the signal is visible on arrival.
  if (state.activeKinds.size === 0) {
    for (const kind of present) if (kind !== CHANGE.UNCHANGED) state.activeKinds.add(kind);
  }
  for (const kind of [...state.activeKinds]) if (!present.includes(kind)) state.activeKinds.delete(kind);
  if (state.activeKinds.size === 0) for (const kind of present) state.activeKinds.add(kind);

  for (const kind of present) {
    const button = el('button', null, `${KIND_LABEL[kind] ?? kind} (${report.summary[kind]})`);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(state.activeKinds.has(kind)));
    button.addEventListener('click', () => {
      if (state.activeKinds.has(kind)) state.activeKinds.delete(kind);
      else state.activeKinds.add(kind);
      if (state.activeKinds.size === 0) state.activeKinds.add(kind);
      renderDiff();
    });
    host.append(button);
  }
}

function renderDiffEntries(report) {
  const host = $('diff-entries');
  host.replaceChildren();
  const visible = report.entries.filter((entry) => state.activeKinds.has(entry.kind));

  if (visible.length === 0) {
    host.append(el('li', 'muted', 'Seçili filtrelere uyan kayıt yok.'));
    return;
  }

  for (const entry of visible) {
    const item = el('li', 'entry');
    item.dataset.kind = entry.kind;

    const head = el('div', 'entry-head');
    head.append(el('span', 'entry-kind', KIND_LABEL[entry.kind] ?? entry.kind));
    const code = entry.kind === CHANGE.RECODED
      ? `${entry.code} → ${entry.toCode}`
      : (entry.code ?? entry.toCode ?? '');
    head.append(el('span', 'entry-code', code));
    head.append(el('span', 'entry-title', entry.title ?? '(ad kayıtlı değil)'));
    item.append(head);

    if (entry.fieldChanges.length > 0) {
      const list = el('ul');
      for (const change of entry.fieldChanges) {
        list.append(el('li', null,
          `${FIELD_LABEL[change.field] ?? change.field}: ${change.from ?? '—'} → ${change.to ?? '—'}`));
      }
      item.append(list);
    }

    if (entry.unknownFields.length > 0) {
      const list = el('ul');
      for (const unknown of entry.unknownFields) {
        list.append(el('li', 'unknown-note',
          `${FIELD_LABEL[unknown.field] ?? unknown.field}: ${unknown.reason}`));
      }
      item.append(list);
    }

    host.append(item);
  }
}

function renderDiffSources(from, to) {
  const host = $('diff-sources');
  host.replaceChildren();
  for (const item of [from, to]) {
    host.append(el('h4', null, item.snapshot.label));
    const list = el('ul');
    list.append(el('li', null, `Kaynak: ${item.snapshot.source.url}`));
    list.append(el('li', null, `Alınma: ${item.snapshot.source.fetched_at}`));
    list.append(el('li', null, `Elde ediliş: ${item.snapshot.source.provenance}`));
    if (item.snapshot.source.note) list.append(el('li', null, item.snapshot.source.note));
    for (const note of item.snapshot.notes) list.append(el('li', null, note));
    host.append(list);
  }
}

/* ───────────────────────── Time Machine ───────────────────────── */

function loadTranscript() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.code === 'string' && typeof e.ects === 'number');
  } catch {
    return [];
  }
}

function saveTranscript() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transcript));
  } catch {
    /* Private mode or a full quota. The session still works in memory. */
  }
  const count = state.transcript.length;
  $('storage-state').textContent = count === 0
    ? 'Kayıtlı veri yok.'
    : `${count} ders yalnızca bu tarayıcıda kayıtlı.`;
}

function gradeOptions(select, includeEmpty) {
  select.replaceChildren();
  if (includeEmpty) {
    const option = el('option', null, '— henüz notlanmadı —');
    option.value = '';
    select.append(option);
  }
  for (const grade of Object.keys(state.ruleset.scale.points)) {
    const option = el('option', null, `${grade} (${state.ruleset.scale.points[grade].toFixed(2)})`);
    option.value = grade;
    select.append(option);
  }
}

function setupTimeMachine() {
  state.transcript = loadTranscript();

  const courses = [...state.catalogue.values()].sort(
    (a, b) => a.semester - b.semester || a.code.localeCompare(b.code, 'tr-TR'),
  );
  const courseSelect = $('course-select');
  for (const course of courses) {
    const option = el('option', null, `${course.semester}. yy · ${course.code} — ${course.title} (${course.ects} AKTS)`);
    option.value = course.code;
    courseSelect.append(option);
  }

  gradeOptions($('grade-select'), true);
  gradeOptions($('whatif-grade'), false);

  $('add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = courseSelect.value;
    const course = state.catalogue.get(code);
    if (!course) return;
    if (state.transcript.some((e) => e.code === code)) {
      $('add-error').textContent = `${code} zaten listende.`;
      return;
    }
    $('add-error').textContent = '';
    state.transcript.push({
      code: course.code,
      title: course.title,
      ects: course.ects,
      grade: $('grade-select').value,
    });
    saveTranscript();
    renderTimeMachine();
  });

  $('wipe').addEventListener('click', () => {
    state.transcript = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to remove */ }
    saveTranscript();
    renderTimeMachine();
  });

  $('target-gpa').addEventListener('input', renderTarget);
  $('whatif-course').addEventListener('change', renderWhatIf);
  $('whatif-grade').addEventListener('change', renderWhatIf);
  for (const id of ['gate-midterm', 'gate-final', 'gate-attendance']) {
    $(id).addEventListener('input', renderGate);
  }
  // These two forms exist only to group and label their controls; submitting
  // them would reload the page and wipe the in-memory state for no reason.
  $('gate-form').addEventListener('submit', (event) => event.preventDefault());
  $('whatif-form').addEventListener('submit', (event) => event.preventDefault());

  saveTranscript();
  renderTimeMachine();
  renderGate();
}

function renderTimeMachine() {
  renderTranscript();
  renderStanding();
  renderTarget();
  renderWhatIfPicker();
  renderWhatIf();
}

function renderTranscript() {
  const body = $('transcript-body');
  body.replaceChildren();
  $('transcript-empty').hidden = state.transcript.length > 0;

  const conditional = new Set(state.ruleset.scale.conditional);
  for (const entry of state.transcript) {
    const row = el('tr');
    if (conditional.has(entry.grade)) row.dataset.conditional = 'true';
    row.append(el('td', null, entry.code));
    row.append(el('td', null, entry.title ?? ''));
    row.append(el('td', null, String(entry.ects)));
    row.append(el('td', null, entry.grade || '—'));

    const actions = el('td');
    const remove = el('button', null, 'Sil');
    remove.type = 'button';
    remove.setAttribute('aria-label', `${entry.code} dersini listeden sil`);
    remove.addEventListener('click', () => {
      state.transcript = state.transcript.filter((e) => e.code !== entry.code);
      saveTranscript();
      renderTimeMachine();
    });
    actions.append(remove);
    row.append(actions);
    body.append(row);
  }
}

function stat(term, value, note, state_) {
  const box = el('div', 'stat');
  if (state_) box.dataset.state = state_;
  const dl = el('dl');
  dl.append(el('dt', null, term));
  const dd = el('dd', null, value);
  if (note) dd.append(el('span', 'note', note));
  dl.append(dd);
  box.append(dl);
  return box;
}

function renderStanding() {
  const host = $('standing');
  const warnHost = $('standing-warnings');
  host.replaceChildren();
  warnHost.replaceChildren();

  const summary = summarizeProgram(state.transcript, state.ruleset.programme, state.ruleset.scale);

  host.append(stat(
    'GANO (tahmini)',
    summary.gpa === null ? '—' : summary.gpa.toFixed(2),
    summary.gpa === null ? 'Notlandırılmış ders yok' : `${summary.gradedEcts} AKTS üzerinden`,
    summary.gpa === null ? 'unknown' : (summary.gpa >= state.ruleset.programme.minimumGpa ? 'good' : 'bad'),
  ));

  host.append(stat(
    'Kazanılan AKTS',
    String(summary.earnedEcts),
    `${state.ruleset.programme.requiredEcts} gerekiyor · ${summary.remainingEcts} kaldı`,
  ));

  host.append(stat(
    'Şartlı geçen AKTS',
    String(summary.conditionalEcts),
    summary.conditional.length === 0
      ? 'DC/DD notun yok'
      : (summary.conditionalCounted ? 'Şu an sayılıyor' : 'Şu an SAYILMIYOR'),
    summary.conditional.length === 0 ? undefined : (summary.conditionalCounted ? 'good' : 'bad'),
  ));

  host.append(stat(
    'Mezuniyet',
    summary.graduation.ready ? 'Koşullar sağlandı' : 'Henüz değil',
    `AKTS ${summary.graduation.ectsMet ? '✓' : '✗'} · GANO ${summary.graduation.gpaMet ? '✓' : '✗'}`,
    summary.graduation.ready ? 'good' : undefined,
  ));

  for (const warning of summary.warnings) warnHost.append(el('p', null, warning));
}

function renderTarget() {
  const host = $('target-result');
  host.replaceChildren();
  const target = Number($('target-gpa').value);
  if (!Number.isFinite(target)) return;

  const result = requiredAverageForTarget(
    state.transcript,
    state.ruleset.programme,
    state.ruleset.scale,
    target,
  );

  const flag = el('span', `flag ${result.attainable ? 'good' : 'bad'}`,
    result.attainable ? 'Ulaşılabilir' : 'Ulaşılamaz');
  const line = el('p');
  line.append(flag, document.createTextNode(` — ${result.reason}`));
  host.append(line);
  if (result.remainingEcts > 0) {
    host.append(el('p', 'muted',
      `Hesap, kalan ${result.remainingEcts} AKTS'nin tamamının notlandırılacağını varsayar.`));
  }
}

function renderWhatIfPicker() {
  const select = $('whatif-course');
  const previous = select.value;
  select.replaceChildren();
  for (const entry of state.transcript) {
    const option = el('option', null, `${entry.code} — ${entry.title ?? ''} (${entry.grade || 'notsuz'})`);
    option.value = entry.code;
    select.append(option);
  }
  if (previous && state.transcript.some((e) => e.code === previous)) select.value = previous;
}

function renderWhatIf() {
  const host = $('whatif-result');
  host.replaceChildren();

  if (state.transcript.length === 0) {
    host.append(el('p', 'muted', 'Senaryo çalıştırmak için önce ders ekle.'));
    return;
  }

  const code = $('whatif-course').value;
  const grade = $('whatif-grade').value;
  if (!code || !grade) return;

  const result = whatIf(
    state.transcript,
    [{ type: 'set-grade', code, grade }],
    state.ruleset.programme,
    state.ruleset.scale,
  );

  for (const problem of result.problems) host.append(el('p', 'flag bad', problem));

  const before = result.before.gpa === null ? '—' : result.before.gpa.toFixed(2);
  const after = result.after.gpa === null ? '—' : result.after.gpa.toFixed(2);
  host.append(el('p', null, `${code} dersine ${grade} verilirse: GANO ${before} → ${after}`));
  host.append(el('p', null, `Kazanılan AKTS değişimi: ${result.delta.earnedEcts >= 0 ? '+' : ''}${result.delta.earnedEcts}`));

  if (result.delta.conditionalFlipped) {
    const line = el('p');
    line.append(
      el('span', 'flag bad', 'Dikkat:'),
      document.createTextNode(result.after.conditionalCounted
        ? ' bu senaryo, şu an sayılmayan DC/DD kredilerini yeniden geçerli hâle getiriyor.'
        : ' bu senaryo, hâlihazırda kazanılmış DC/DD kredilerinin geçerliliğini KAYBETTİRİYOR.'),
    );
    host.append(line);
  }

  if (result.delta.graduationReadyChanged) {
    host.append(el('p', 'flag unknown', 'Bu senaryo mezuniyet koşullarının sağlanma durumunu değiştiriyor.'));
  }
}

function renderGate() {
  const host = $('gate-result');
  host.replaceChildren();

  const read = (id) => {
    const value = $(id).value;
    return value === '' ? undefined : Number(value);
  };

  const result = evaluateCourse(
    { midterm: read('gate-midterm'), final: read('gate-final'), attendancePercent: read('gate-attendance') },
    state.ruleset,
  );

  const label = {
    [ELIGIBILITY.ELIGIBLE]: ['good', 'Mutlak kapılar geçildi'],
    [ELIGIBILITY.BLOCKED]: ['bad', 'Kapıya takılıyor'],
    [ELIGIBILITY.UNKNOWN]: ['unknown', 'Yetersiz bilgi'],
  }[result.eligibility];

  host.append(el('p', `flag ${label[0]}`, label[1]));
  host.append(el('p', null, `Ham başarı notu: ${result.rawScore === null ? 'hesaplanamıyor' : result.rawScore}`));

  for (const blocker of result.blockers) host.append(el('p', 'flag bad', blocker.detail));
  for (const unknown of result.unknowns) host.append(el('p', 'muted', unknown.reason));

  host.append(el('p', 'muted', result.letterGradeNote));
  host.append(el('p', 'muted',
    'Harf notu bilinçli olarak üretilmez: bağıl değerlendirme tüm sınıfın dağılımını gerektirir ve bu proje o veriyi toplamaz.'));
}

boot();
