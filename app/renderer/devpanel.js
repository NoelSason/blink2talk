// Dev mode: tune the eye tracker and measure it. Toggle with the backtick key (`). Patients never see it.
// Rows marked "now" apply the moment the slider moves. The rest apply on "Apply & recalibrate".
// The accuracy test shows a corner on the screen and checks where the patient's eyes were. It writes
// nothing to disk; the results show in the panel, and you can copy them from there.

import { DEFAULTS, saveSettings } from './devsettings.js';

const CORNERS = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
const NAME = { topLeft: 'Top left', topRight: 'Top right', bottomLeft: 'Bottom left', bottomRight: 'Bottom right', center: 'Middle (rest)' };
const TRIAL_MS = 2000;
const SAMPLE_FROM_MS = 800; // ignore the first part of a trial: the eyes are still travelling

// Every slider. live: 'blink' goes to the vision module at once; live: true is read every frame;
// no live flag means it is used when the pipeline is built, so it needs a recalibration.
const SCHEMA = [
  { group: 'Calibration', rows: [
    { key: 'calibration.readyMs', label: 'Countdown', min: 1000, max: 6000, step: 250, unit: 'ms' },
    { key: 'calibration.leadMs', label: 'Countdown before the squint', min: 0, max: 6000, step: 250, unit: 'ms' },
    { key: 'calibration.phaseMs', label: 'Time per dot', min: 1000, max: 5000, step: 250, unit: 'ms' },
    { key: 'calibration.settleMs', label: 'Ignore after dot moves', min: 0, max: 1000, step: 50, unit: 'ms' },
  ] },
  { group: 'Box choice', rows: [
    { key: 'quadrant.focusMs', label: 'Look time before highlight', min: 100, max: 800, step: 50, unit: 'ms' },
    { key: 'quadrant.margin', label: 'Hysteresis (share of center-to-side)', min: 0, max: 0.5, step: 0.05, unit: '' },
    { key: 'quadrant.dead', label: 'Rest circle half-width (share of center-to-side)', min: 0.1, max: 0.6, step: 0.05, unit: '' },
    { key: 'quadrant.smoothingFrames', label: 'Smoothing (frames)', min: 1, max: 15, step: 1, unit: '' },
  ] },
  { group: 'Long blink / squint', rows: [
    { key: 'blink.selectMs', label: 'Hold to select', min: 400, max: 1500, step: 50, unit: 'ms', live: 'blink' },
    { key: 'blink.refractoryMs', label: 'Wait after a select', min: 500, max: 2500, step: 100, unit: 'ms', live: 'blink' },
    { key: 'blink.smoothingFrames', label: 'Blink smoothing (frames)', min: 1, max: 8, step: 1, unit: '' },
  ] },
  { group: "Can't see you", rows: [
    { key: 'face.lostMs', label: 'Face gone for', min: 100, max: 1500, step: 50, unit: 'ms', live: true },
    { key: 'face.foundMs', label: 'Face back for', min: 0, max: 500, step: 50, unit: 'ms', live: true },
  ] },
];

const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};
const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
};
const typing = (event) => event.target.matches?.('input, textarea, [contenteditable]');

export function createDevPanel({ settings, onRebuild, onDrift, onBlink }) {
  const panel = el('aside', { className: 'dev', hidden: true });
  const target = el('div', { className: 'dev-target', hidden: true });
  document.body.append(panel, target);

  const sliders = []; // { key, input, value, row }
  let dirty = false;
  const applyBtn = el('button', { type: 'button', className: 'dev__primary', textContent: 'Apply & recalibrate' });
  const live = { looking: el('span'), focus: el('span'), face: el('span'), mode: el('span'), blinks: el('span'), drift: el('span', { textContent: 'not run' }) };
  const recentBlinks = [];
  const results = el('pre', { className: 'dev__results', hidden: true });
  const test = { running: false, order: [], i: 0, target: null, samples: [], shownAt: 0, rows: [], timer: null };

  function markDirty() {
    dirty = true;
    applyBtn.disabled = false;
  }

  function syncSliders() {
    for (const s of sliders) {
      const v = getPath(settings, s.key);
      s.input.value = v;
      s.value.textContent = `${Number(v)}${s.unit ? ` ${s.unit}` : ''}`;
    }
  }

  function rowFor(r) {
    const input = el('input', { type: 'range', min: r.min, max: r.max, step: r.step });
    const value = el('span', { className: 'dev__value' });
    const name = el('span', { className: 'dev__label', textContent: r.label });
    name.append(el('span', { className: r.live ? 'dev__tag dev__tag--now' : 'dev__tag', textContent: r.live ? ' now' : ' recal' }));
    const row = el('label', { className: 'dev__row' }, name, input, value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      setPath(settings, r.key, v);
      value.textContent = `${input.value}${r.unit ? ` ${r.unit}` : ''}`;
      saveSettings(settings);
      if (r.live === 'blink') onBlink?.({ [r.key.split('.')[1]]: v });
      else if (!r.live) markDirty();
    });
    sliders.push({ key: r.key, input, value, unit: r.unit });
    return row;
  }

  const learnInput = el('input', { type: 'checkbox' });
  learnInput.addEventListener('change', () => {
    settings.learnFromPicks = learnInput.checked;
    saveSettings(settings);
  });

  const headInput = el('input', { type: 'checkbox' });
  headInput.addEventListener('change', () => {
    settings.headPose = headInput.checked;
    saveSettings(settings);
    markDirty(); // the head model is trained during calibration
  });

  applyBtn.addEventListener('click', () => {
    dirty = false;
    applyBtn.disabled = true;
    stopTest();
    onRebuild();
  });

  const button = (text, onClick) => {
    const b = el('button', { type: 'button', textContent: text });
    b.addEventListener('click', () => onClick());
    return b;
  };

  // Who is in front of the camera, for the README's Eye accuracy section (eyes.js logs it with each
  // calibration and test). Not saved: every launch starts unnamed, so a new person isn't logged as the last one.
  const testerInput = el('input', { type: 'text', placeholder: 'First name or Guest 1' });
  testerInput.addEventListener('input', () => {
    window.dispatchEvent(new CustomEvent('eyes-tester', { detail: { tester: testerInput.value.trim() || null } }));
  });

  const resetBtn = button('Reset to defaults', () => {
    Object.assign(settings, structuredClone(DEFAULTS));
    headInput.checked = settings.headPose;
    learnInput.checked = settings.learnFromPicks;
    saveSettings(settings);
    syncSliders();
    markDirty();
  });

  panel.append(
    el('div', { className: 'dev__head' },
      el('span', { className: 'dev__title', textContent: 'Dev mode' }),
      el('span', { className: 'dev__note', textContent: '` hides this' })),
    el('section', { className: 'dev__section' },
      el('h2', { className: 'dev__heading', textContent: 'Live' }),
      el('div', { className: 'dev__live' },
        el('span', {}, 'Looking: ', live.looking), el('span', {}, 'Highlight: ', live.focus),
        el('span', {}, 'Face: ', live.face), el('span', {}, 'Tracker: ', live.mode),
        el('span', {}, 'Last blinks: ', live.blinks),
        el('span', {}, 'Last drift: ', live.drift))),
    el('section', { className: 'dev__section' },
      el('h2', { className: 'dev__heading', textContent: 'Learning' }),
      el('label', { className: 'dev__row' }, learnInput,
        el('span', { className: 'dev__label', textContent: 'Learn from spoken picks (teaches the chosen box where the eyes were)' }))),
    el('section', { className: 'dev__section' },
      el('h2', { className: 'dev__heading', textContent: 'Head model' }),
      el('label', { className: 'dev__row' }, headInput,
        el('span', { className: 'dev__label', textContent: 'Correct box picks for head turns (retrains on calibration)' }))),
    ...SCHEMA.map((g) => el('section', { className: 'dev__section' },
      el('h2', { className: 'dev__heading', textContent: g.group }),
      ...g.rows.map(rowFor))),
    el('section', { className: 'dev__section' },
      el('h2', { className: 'dev__heading', textContent: 'Actions' }),
      applyBtn,
      button('Recalibrate, no changes', () => { stopTest(); onRebuild(); }),
      button('Drift check, 8 s (K)', () => { stopTest(); panel.hidden = true; onDrift(); }),
      el('label', { className: 'dev__row dev__row--text' },
        el('span', { className: 'dev__label', textContent: "Who's testing (then recalibrate)" }), testerInput),
      button('Accuracy test (8 corners)', () => startTest()),
      resetBtn,
      button('Copy settings', () => copy(JSON.stringify(settings, null, 2), 'Settings copied')),
      results),
  );
  applyBtn.disabled = true;
  headInput.checked = settings.headPose;
  learnInput.checked = settings.learnFromPicks;
  syncSliders();

  // ---- Accuracy test: a corner is shown on screen; we count which box the vision module says the eyes are on.
  function startTest() {
    if (test.running) return;
    test.running = true;
    test.order = [...CORNERS, ...CORNERS].sort(() => Math.random() - 0.5);
    test.i = 0;
    test.rows = [];
    results.hidden = true;
    panel.hidden = true; // the corners must be visible
    nextTrial();
  }

  function nextTrial() {
    test.target = test.order[test.i];
    test.samples = [];
    test.shownAt = performance.now();
    target.dataset.at = test.target;
    target.textContent = `Look: ${NAME[test.target]} (${test.i + 1} of ${test.order.length})`;
    window.dispatchEvent(new CustomEvent('eyes-label', { detail: { label: `test:${test.target}` } }));
    target.hidden = false;
    test.timer = setTimeout(endTrial, TRIAL_MS);
  }

  function endTrial() {
    const seen = test.samples.filter(Boolean);
    const tally = {};
    for (const v of seen) tally[v] = (tally[v] ?? 0) + 1;
    const guess = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] ?? null;
    test.rows.push({ target: test.target, guess, hit: guess === test.target, frames: seen.length });
    if (++test.i < test.order.length) return nextTrial();
    finishTest();
  }

  function finishTest() {
    test.running = false;
    target.hidden = true;
    panel.hidden = false;
    window.dispatchEvent(new CustomEvent('eyes-label', { detail: { label: null } }));
    const hits = test.rows.filter((r) => r.hit).length;
    const noData = test.rows.filter((r) => r.frames === 0).length;
    const lines = [`Accuracy: ${hits} of ${test.rows.length} (${Math.round((100 * hits) / test.rows.length)}%)`];
    if (noData) lines.push(`No eye data on ${noData} trial(s): the face wasn't seen.`);
    lines.push('', 'Missed trials (looked at → counted as):');
    for (const r of test.rows.filter((x) => !x.hit)) lines.push(`  ${NAME[r.target]} → ${r.guess ? NAME[r.guess] : 'nothing'}`);
    lines.push('', `Settings: ${JSON.stringify(settings)}`);
    results.textContent = lines.join('\n');
    results.hidden = false;
    // eyes.js logs it; main.js adds it to the README's Eye accuracy section (accuracy.js).
    window.dispatchEvent(new CustomEvent('eyes-test', { detail: { rows: test.rows } }));
  }

  function stopTest() {
    if (test.running) window.dispatchEvent(new CustomEvent('eyes-label', { detail: { label: null } }));
    clearTimeout(test.timer);
    test.running = false;
    target.hidden = true;
  }

  function copy(text, done) {
    navigator.clipboard?.writeText(text).then(() => results.prepend(`${done}\n`), () => {});
  }

  // Live readout and test samples, from eyes.js once per camera frame.
  let lastPaint = 0;
  window.addEventListener('eyes-frame', (e) => {
    const d = e.detail;
    if (test.running && performance.now() - test.shownAt >= SAMPLE_FROM_MS) test.samples.push(d.looking);
    const now = performance.now();
    if (panel.hidden || now - lastPaint < 200) return;
    lastPaint = now;
    live.looking.textContent = d.looking ? NAME[d.looking] : '—';
    live.focus.textContent = d.focus ? NAME[d.focus] : 'none';
    live.face.textContent = d.faceFound ? 'seen' : 'lost';
    live.mode.textContent = d.mode;
  });

  // Every blink the camera sees: its length, and whether it counted toward a double blink (back).
  window.addEventListener('blink-seen', (e) => {
    recentBlinks.push(`${Math.round(e.detail.ms)} ms${e.detail.counted ? '' : ' (too long)'}`);
    recentBlinks.splice(0, recentBlinks.length - 4);
    live.blinks.textContent = recentBlinks.join(', ');
  });

  // Drift check result: 1 is about normal eye jitter, 3 or more is a real shift.
  window.addEventListener('eyes-drift', (e) => {
    const worst = Object.entries(e.detail.perTarget).sort((a, b) => b[1] - a[1])[0];
    live.drift.textContent = `${e.detail.size.toFixed(1)}${worst ? ` (most: ${NAME[worst[0]]} ${worst[1].toFixed(1)})` : ''}`;
  });

  const isOpen = () => !panel.hidden;
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Backquote' || event.repeat || typing(event)) return;
    panel.hidden = isOpen() ? true : false;
    if (panel.hidden) stopTest();
  });

  return {
    toggle() { panel.hidden = !panel.hidden; },
  };
}
