// Eye-accuracy record, shown in the root README. After every calibration and every accuracy test
// (dev mode), main.js hands the logged event here. Each launch keeps one file in docs/accuracy/
// (tracked, one per session, so teammates' results merge without conflicts), and docs/accuracy.md
// and the README's "Eye accuracy" section are rewritten from all of them.
//   npm run accuracy               rebuild docs/accuracy.md and the README section
//   npm run accuracy -- --import   first add the calibrations and tests already in app/logs/
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const START = '<!-- accuracy:start';
const END = '<!-- accuracy:end -->';
const BOXES = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const TARGETS = ['center', ...BOXES];
const COLUMNS = ['farLeft', 'midLeft', 'midRight', 'farRight']; // the row layout's boxes, left to right
const NAME = {
  center: 'Center', topLeft: 'Top left', topRight: 'Top right', bottomLeft: 'Bottom left', bottomRight: 'Bottom right',
  farLeft: 'Far left', midLeft: 'Middle left', midRight: 'Middle right', farRight: 'Far right',
};
// The row layout is scored by its left-right picker, the 2x2 layouts by the vision module's classifier,
// so their results are kept apart. Tests from before the row layout existed were all 2x2.
const LAYOUT = { row: 'row of 4', grid: '2x2' };
const layoutOf = (t) => (t.layout === 'row' ? 'row' : 'grid');
const TRACKER = { vision: 'vision module', 'vision+head': 'vision + head model' };
const README_ROWS = 5; // newest runs and calibrations shown in the README; docs/accuracy.md has all

const files = (root) => ({
  sessions: path.join(root, 'docs', 'accuracy'),
  report: path.join(root, 'docs', 'accuracy.md'),
  readme: path.join(root, 'README.md'),
});

// Launch time from a session id ("2026-10-25T01-08-46-198Z", the eye log's file name).
function sessionStart(id) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(id);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
}

const parseLines = (text) => String(text).split('\n').flatMap((line) => {
  try {
    return line.trim() ? [JSON.parse(line)] : [];
  } catch {
    return [];
  }
});

// Adds the calibrations and accuracy tests in `text` (eye-log JSON lines) to the session's file.
// Events already in the file (same `t`) are skipped, so importing a log twice changes nothing.
// `firstT`: the log's first `t`, used to date events from before they carried a wall-clock `at`.
function addToSession(root, session, text, firstT) {
  const { sessions } = files(root);
  const file = path.join(sessions, `${session}.json`);
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { session, calibrations: [], tests: [] };
  const at = (e) => e.at ?? sessionStart(session) + (e.t - (firstT ?? e.t));
  let added = 0;
  for (const e of parseLines(text)) {
    const tester = e.tester ?? e.settings?.tester ?? null;
    if (e.event === 'calibrated' && e.accuracy && !data.calibrations.some((c) => c.t === e.t)) {
      data.calibrations.push({ t: e.t, at: at(e), tester: tester || null, fit: e.accuracy, warnings: e.warnings ?? [] });
      added++;
    } else if (e.event === 'test' && Array.isArray(e.rows) && !data.tests.some((x) => x.t === e.t)) {
      data.tests.push({ t: e.t, at: at(e), tester: tester || null, source: e.source ?? 'vision', layout: layoutOf(e), rows: e.rows });
      added++;
    }
  }
  if (!added) return false;
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return true;
}

// From main.js: one batch of eye-log lines that holds a calibration or a test.
function record(session, text, { root = ROOT } = {}) {
  if (addToSession(root, session, text)) rebuild({ root });
}

// Every eyes-*.jsonl in `dir` (app/logs/) becomes, or tops up, a session file.
function importLogs(dir, { root = ROOT } = {}) {
  let n = 0;
  for (const name of fs.readdirSync(dir).filter((f) => /^eyes-.+\.jsonl$/.test(f)).sort()) {
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    const firstT = parseLines(text.slice(0, 2000)).find((e) => Number.isFinite(e.t))?.t;
    if (addToSession(root, name.slice(5, -6), text, firstT)) n++;
  }
  return n;
}

function loadSessions(root) {
  const { sessions } = files(root);
  if (!fs.existsSync(sessions)) return [];
  return fs.readdirSync(sessions).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(sessions, f), 'utf8')));
}

// ---------- Counting ----------
const side = (box) => ({ x: box.endsWith('Left') ? -1 : 1, y: box.startsWith('top') ? -1 : 1 });
const counted = (row) => (row.guess && row.guess !== 'center' ? side(row.guess) : null);

// Trials across tests of one layout: right overall, per box, and for 2x2 per axis (a guess of the
// middle or no eye data is wrong on both axes).
function tally(tests, layout = 'grid') {
  const rows = tests.flatMap((t) => t.rows);
  const boxes = layout === 'row' ? COLUMNS : BOXES;
  const out = { hits: 0, total: rows.length, x: 0, y: 0, box: Object.fromEntries(boxes.map((b) => [b, { hits: 0, total: 0 }])) };
  for (const r of rows) {
    if (r.hit) out.hits++;
    if (layout === 'grid') {
      const want = side(r.target);
      const got = counted(r);
      if (got?.x === want.x) out.x++;
      if (got?.y === want.y) out.y++;
    }
    if (out.box[r.target]) {
      out.box[r.target].total++;
      if (r.hit) out.box[r.target].hits++;
    }
  }
  return out;
}

// ---------- Writing ----------
const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const when = (at) => (Number.isFinite(at)
  ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  : '—');
const cell = (s) => String(s).replace(/\|/g, '\\|');
const newest = (a, b) => b.at - a.at;

function shortWarning(w) {
  if (/^Hard to tell apart: (.+?)\./.test(w)) return `hard to tell apart: ${w.match(/^Hard to tell apart: (.+?)\./)[1].split(', ').map((k) => NAME[k]?.toLowerCase() ?? k).join(', ')}`;
  if (/narrow noticeably/.test(w)) return 'eyes narrow looking down';
  if (/^Squint couldn't/.test(w)) return 'squint not found, full blinks select';
  if (/^Face not visible/.test(w)) return 'face not seen';
  return w.length > 50 ? `${w.slice(0, 47)}…` : w;
}

function testsTable(tests) {
  const lines = ['| When | Tester | Layout | Tracker | Right | Missed (looked at → counted as) |', '|---|---|---|---|---|---|'];
  for (const t of tests) {
    const hits = t.rows.filter((r) => r.hit).length;
    const missed = t.rows.filter((r) => !r.hit).map((r) => `${NAME[r.target]} → ${r.frames === 0 ? 'no eye data' : NAME[r.guess] ?? 'nothing'}`);
    lines.push(`| ${when(t.at)} | ${cell(t.tester ?? '—')} | ${LAYOUT[layoutOf(t)]} | ${TRACKER[t.source] ?? t.source} | ${hits} of ${t.rows.length} | ${cell(missed.join('; ') || 'none')} |`);
  }
  return lines.join('\n');
}

function calibrationsTable(cals) {
  const lines = [`| When | Tester | ${TARGETS.map((k) => NAME[k]).join(' | ')} | Notes |`, `|---|---|${TARGETS.map(() => '---|').join('')}---|`];
  for (const c of cals) {
    const fit = TARGETS.map((k) => {
      const v = c.fit?.[k];
      if (!Number.isFinite(v)) return '—';
      const p = `${Math.round(100 * v)}%`;
      return v < 0.7 ? `**${p}**` : p;
    });
    lines.push(`| ${when(c.at)} | ${cell(c.tester ?? '—')} | ${fit.join(' | ')} | ${cell(c.warnings.map(shortWarning).join('; ') || '')} |`);
  }
  return lines.join('\n');
}

function headline(tests) {
  if (!tests.length) return '**Accuracy test: none recorded yet.**';
  return Object.keys(LAYOUT)
    .map((layout) => [layout, tests.filter((t) => layoutOf(t) === layout)])
    .filter(([, ts]) => ts.length)
    .map(([layout, ts]) => layoutHeadline(ts, layout))
    .join('\n\n');
}

function layoutHeadline(tests, layout) {
  const s = tally(tests, layout);
  const people = new Set(tests.map((t) => t.tester).filter(Boolean));
  const unnamed = tests.filter((t) => !t.tester).length;
  const trackers = Object.entries(Object.groupBy(tests, (t) => t.source)).map(([src, ts]) => {
    const n = tally(ts, layout);
    return `${TRACKER[src] ?? src} ${n.hits} of ${n.total}`;
  });
  return [
    `**Accuracy test, ${LAYOUT[layout]}: ${s.hits} of ${s.total} looks counted in the right box (${pct(s.hits, s.total)})**, over ${tests.length} run${tests.length === 1 ? '' : 's'}`
      + ` by ${people.size} tester${people.size === 1 ? '' : 's'}${unnamed ? ` (${unnamed} run${unnamed === 1 ? '' : 's'} with no tester named)` : ''}.`,
    '',
    (layout === 'grid' ? `Left/right ${pct(s.x, s.total)} · top/bottom ${pct(s.y, s.total)} · ` : '')
      + Object.entries(s.box).map(([b, n]) => `${NAME[b].toLowerCase()} ${n.hits}/${n.total}`).join(' · ')
      + (trackers.length > 1 ? ` · ${trackers.join(' · ')}` : ''),
  ].join('\n');
}

const FIT_NOTE = 'How well each calibration\'s own looks sort back into the right box. This checks the fit, not accuracy: under 70% (bold) on any box means calibrate again. It sorts into the 2x2 boxes (the default layout).';
const TEST_NOTE = 'Each run names a box 8 times (every box twice, in random order) for 2 s each, and counts the box the eyes were on most in the last 1.2 s. A look counted in the middle (2x2 only), or with no eye data, is a miss. 2x2 runs (the default layout) score the 2x2 classifier; row-of-4 runs (a Dev mode layout) score its left-right picker.';

function readmeBlock(sessions) {
  const tests = sessions.flatMap((s) => s.tests).sort(newest);
  const cals = sessions.flatMap((s) => s.calibrations).sort(newest);
  const parts = [headline(tests)];
  if (tests.length) parts.push(`${TEST_NOTE}\n\n${testsTable(tests.slice(0, README_ROWS))}`);
  parts.push(cals.length
    ? `**Calibrations (${cals.length} recorded, newest first).** ${FIT_NOTE}\n\n${calibrationsTable(cals.slice(0, README_ROWS))}`
    : '**Calibrations:** none recorded yet.');
  parts.push('Updated automatically after every calibration and accuracy test. Full history: [docs/accuracy.md](docs/accuracy.md).');
  return parts.join('\n\n');
}

function report(sessions) {
  const tests = sessions.flatMap((s) => s.tests).sort(newest);
  const cals = sessions.flatMap((s) => s.calibrations).sort(newest);
  return [
    '# Eye accuracy log',
    'Written by `app/accuracy.js` after every calibration and every dev-mode accuracy test; don\'t edit it by hand. Each launch\'s raw results are in `docs/accuracy/`. `npm run accuracy` (in `app/`) rebuilds this page and the README section.',
    'To add a run: open Dev mode (backtick), type who\'s testing, recalibrate, then run **Accuracy test (8 looks)**. It tests the layout chosen in Dev mode.',
    '## Accuracy tests',
    headline(tests),
    ...(tests.length ? [TEST_NOTE, testsTable(tests)] : []),
    '## Calibrations',
    FIT_NOTE,
    cals.length ? calibrationsTable(cals) : 'None recorded yet.',
  ].join('\n\n') + '\n';
}

// The README section between the accuracy markers; null when the markers are missing.
function replaceBlock(readme, block) {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) return null;
  const startLine = readme.slice(a, readme.indexOf('\n', a) + 1);
  return `${readme.slice(0, a)}${startLine}${block}\n${readme.slice(b)}`;
}

function rebuild({ root = ROOT } = {}) {
  const f = files(root);
  const sessions = loadSessions(root);
  fs.mkdirSync(path.dirname(f.report), { recursive: true });
  fs.writeFileSync(f.report, report(sessions));
  const readme = fs.existsSync(f.readme) ? fs.readFileSync(f.readme, 'utf8') : null;
  const next = readme && replaceBlock(readme, readmeBlock(sessions));
  if (next) fs.writeFileSync(f.readme, next);
  else console.error('accuracy: README.md has no accuracy markers; only docs/accuracy.md was updated');
}

module.exports = { record, importLogs, rebuild, readmeBlock, replaceBlock, tally };
