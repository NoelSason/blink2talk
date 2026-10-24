// The patient screen's main loop:
//   Listening -> (nurse speaks) -> Loading -> Suggested replies -> Selected -> Speaking -> Listening
// "I want to say something" opens Start a conversation (the urgent options and Spell it).
// "None of these" asks for a fresh set; the second one opens Spell it.
// Replies, word suggestions, and the patient's voice come from the conversation server.

import { PATIENT, QUESTIONS } from './samples.js';
import { createView } from './view.js';
import { createDemoPanel } from './demo.js';
import { onPatientInput, onDemoKey } from './input.js';
import { chime, speak, stopSpeaking } from './sound.js';
import { FALLBACK_URGENT, completeWord, getConfig, getReplies, voiceAudio } from './conversation.js';
import { startEyes } from './eyes.js';

// Timings in ms. Step speed and look pause will become care panel settings.
const TIMING = {
  word: 280,          // sample caption arrives one word at a time
  readPause: 3000,    // new replies: time to read them before the highlight starts stepping
  step: 3000,         // the highlight steps on its own
  stepTired: 4500,    // slower in tired mode
  lookPause: 3000,    // after a look, the highlight waits before stepping again
  cue: 1500,          // how long "Looked right" stays
  holdShow: 200,      // ignore the ring for ordinary blinks
  longBlink: 1000,    // eyes closed this long selects
  shortBlink: 400,    // closures shorter than this count toward a double blink
  doubleBlink: 700,   // two short blinks inside this window undo
  selectedMin: 1500,  // "Selected" stays up at least this long,
  selectedSeen: 1000, // and at least this long after the eyes open, so the patient sees it
  afterSpeech: 1200,  // pause before going back to Listening
};

const END_NONE = { type: 'end', kind: 'none', label: 'None of these', action: 'more' };
const card = (label, extra = {}) => ({ type: 'card', label, action: 'say', ...extra });
const LISTEN_ITEMS = [card('I want to say something', { icon: 'message', action: 'start' })];
const URGENT_ICONS = { "I'm in pain": 'bandage', "I can't breathe": 'wind', 'Call the nurse': 'bell' };
const LETTER_ROWS = ['ETAOINSHR', 'DLCUMWFGY', 'PBVKJXQZ']; // most-used letters first
// Replies and starters sit in a 2×2 grid, cells in reading order. The vision module names them by quadrant.
const GRID = { topLeft: 0, topRight: 1, bottomLeft: 2, bottomRight: 3 };
const SPELL_ACTIONS = ['Space', 'Delete', 'Speak', 'Back'];

const s = {
  stage: 'choose',            // 'choose' | 'spell' | 'speaking'
  caption: { kind: 'waiting' },
  rowKind: 'listen',          // 'listen' | 'starters' | 'replies'
  items: LISTEN_ITEMS,
  replies: [],                // labels of the current reply set
  urgent: FALLBACK_URGENT,
  history: [],                // { role: 'nurse' | 'patient', text }, sent with each reply request
  transcript: '',             // what the nurse last said
  prevPage: null,             // the replies, while "None of these" shows the urgent options
  autoStep: false,
  loading: false,
  hl: 0,
  pace: 'step',               // 'step': moving on its own; 'look': paused after a look or new replies
  progress: 0,
  selected: -1,
  selectedAt: 0,
  cue: null,
  eyesClosed: false,
  spoken: '',
  spell: null,                // { message, prefix, words, level: 'rows' | 'keys', row, key, back }
  tired: false,
  fatigue: 0,
  faceLost: false,
  cam: { engaged: false, closed: false, progress: 0 }, // camera hold: a long blink or held squint in progress
  calibration: null,          // calibration progress while the camera calibrates
};

const now = () => performance.now();
let stepStart = now();
let lookUntil = 0;
let cueUntil = 0;
let closedAt = null;          // start of the current closure; cleared once a long blink fires
let closeStartedAt = 0;
let openedAt = 0;
let shortBlinks = [];
let timers = [];
let speechToken = 0;
let requestToken = 0;
let beforeSelect = null;      // what to go back to on a double blink
let nextQuestion = 0;
let eyesOn = false;           // the camera is calibrated and reporting where the patient looks
let keyboardUntil = 0;        // arrow keys win over the camera's focus for a moment

const later = (ms, fn) => timers.push(setTimeout(fn, ms));
function reset() {
  timers.forEach(clearTimeout);
  timers = [];
  speechToken++;
  requestToken++;
  stopSpeaking();
}

// The patient looks straight at a box, so the grid doesn't step on its own (Spell it still does).
function setRow(rowKind, items, { hl = 0, pause = 0 } = {}) {
  Object.assign(s, { stage: 'choose', rowKind, items, autoStep: false, hl, loading: false, selected: -1, progress: 0, cue: null });
  restartPace(pause);
}

// With the camera, nothing is highlighted until the patient looks at a box. On the keyboard, start top left.
const startHl = () => (eyesOn ? -1 : 0);

function restartPace(pause) {
  s.pace = pause ? 'look' : 'step';
  lookUntil = now() + pause;
  stepStart = now();
  s.progress = 0;
}

// Three replies and "None of these" bottom right, like the vision module's quadrant demo. Tired mode
// keeps two replies. "Spell it" opens after the second "None of these".
function replyItems(replies) {
  const reply = (i) => (replies[i] != null && !(s.tired && i > 1) ? card(replies[i]) : null);
  return [reply(0), reply(1), reply(2), END_NONE];
}

// ---------- Listening and replies ----------
function toListening() {
  reset();
  s.caption = { kind: 'waiting' };
  s.prevPage = null;
  setRow('listen', LISTEN_ITEMS);
}

// A sample question arrives one word at a time, the way the live caption will.
function playQuestion(q) {
  toListening();
  const words = q.text.split(' ');
  words.forEach((_, i) => later(TIMING.word * (i + 1), () => {
    s.caption = { kind: 'question', speaker: q.speaker, text: words.slice(0, i + 1).join(' ') };
  }));
  later(TIMING.word * words.length + 400, () => nurseSaid(q.text, q.speaker));
}

function nurseSaid(text, speaker = 'Nurse') {
  reset();
  s.caption = { kind: 'question', speaker, text };
  s.transcript = text;
  s.prevPage = null;
  s.history.push({ role: 'nurse', text });
  requestReplies(s.history.slice(0, -1));
}

// Shows the loading outlines until replies arrive. Stale answers are ignored.
async function requestReplies(history) {
  const token = ++requestToken;
  Object.assign(s, {
    stage: 'choose', rowKind: 'replies', items: replyItems(['', '', '', '']),
    autoStep: false, loading: true, hl: -1, selected: -1, cue: null,
  });
  const d = await getReplies({
    transcript: s.transcript,
    history: history.slice(-6),
    patientProfile: { name: PATIENT },
    fatigue: s.tired ? Math.max(s.fatigue, 0.8) : s.fatigue,
  });
  if (token !== requestToken) return;
  s.urgent = d.urgent;
  s.replies = d.replies;
  setRow('replies', replyItems(s.replies), { hl: startHl(), pause: TIMING.readPause });
}

// The conversation server's options that are always offered: its urgent phrases and Spell it.
// Four of them, so they fill the grid.
function starterItems() {
  return [...s.urgent.slice(0, 3).map((u) => card(u, { icon: URGENT_ICONS[u] ?? 'message' })), card('Spell it', { icon: 'keyboard', action: 'spell' })];
}

function select(i) {
  const item = s.items[i];
  if (!item) return;
  if (item.action === 'start') {
    chime();
    s.caption = { kind: 'prompt', text: 'What do you want to say?' };
    s.prevPage = null;
    setRow('starters', starterItems(), { hl: startHl(), pause: TIMING.readPause });
  } else if (item.action === 'more') {
    // "None of these": the grid has room for four boxes, so the urgent options and Spell it are the
    // next page. A double blink goes back to the replies.
    chime();
    s.prevPage = { caption: s.caption, rowKind: s.rowKind, items: s.items, hl: i };
    setRow('starters', starterItems(), { hl: startHl(), pause: TIMING.readPause });
  } else if (item.action === 'spell') {
    chime();
    openSpell();
  } else if (item.action === 'say') {
    chime();
    beforeSelect = { stage: 'choose', caption: s.caption, rowKind: s.rowKind, items: s.items, hl: i };
    s.selected = i;
    s.selectedAt = now();
  }
}

function toSpeaking(text) {
  s.stage = 'speaking';
  s.spoken = text;
  s.selected = -1;
  s.history.push({ role: 'patient', text });
  const token = ++speechToken;
  speak(text, voiceAudio).then(() => {
    if (token === speechToken) later(TIMING.afterSpeech, toListening);
  });
}

// Double blink: back to where the reply was picked.
function undo() {
  if (!beforeSelect || (s.stage !== 'speaking' && s.selected < 0)) return;
  reset();
  chime('undo');
  const b = beforeSelect;
  beforeSelect = null;
  if (s.history.at(-1)?.role === 'patient') s.history.pop();
  if (b.stage === 'spell') {
    s.stage = 'spell';
    s.spell = b.spell;
    restartPace(TIMING.lookPause);
    return;
  }
  s.caption = b.caption;
  setRow(b.rowKind, b.items, { hl: b.hl, pause: TIMING.lookPause });
}

// ---------- Spell it ----------
function spellRows() {
  return [s.spell.words, ...LETTER_ROWS.map((r) => [...r]), SPELL_ACTIONS];
}
// The predicted-words row is skipped while it's empty.
const usableRow = (i) => i !== 0 || s.spell.words.length > 0;
const firstRow = () => (usableRow(0) ? 0 : 1);

function openSpell() {
  const back = s.prevPage
    ?? (s.rowKind === 'replies' && s.replies.length ? { caption: s.caption, rowKind: s.rowKind, items: replyItems(s.replies) } : null);
  s.prevPage = null;
  reset();
  s.stage = 'spell';
  s.spell = { message: '', prefix: '', words: [], level: 'rows', row: 1, key: 0, back };
  s.cue = null;
  restartPace(TIMING.readPause);
}

function spellText() {
  const t = s.spell.message + s.spell.prefix;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

async function suggestWords() {
  const sp = s.spell;
  const prefix = sp.prefix;
  sp.words = [];
  if (!prefix) return;
  const words = await completeWord({ prefix, sentenceSoFar: sp.message.trim(), context: s.transcript });
  if (s.spell === sp && sp.prefix === prefix) sp.words = words;
}

function spellPick() {
  const sp = s.spell;
  if (sp.level === 'rows') {
    chime('tick');
    sp.level = 'keys';
    sp.key = 0;
    restartPace(TIMING.lookPause);
    return;
  }
  const label = spellRows()[sp.row][sp.key];
  if (label == null) {
    // The suggested words changed under the highlight; go back to choosing a row.
    sp.level = 'rows';
    return;
  }
  if (sp.row === 0) {
    sp.message += `${label} `;
    sp.prefix = '';
    sp.words = [];
  } else if (sp.row <= LETTER_ROWS.length) {
    sp.prefix += label.toLowerCase();
    suggestWords();
  } else if (label === 'Space') {
    sp.message += sp.prefix ? `${sp.prefix} ` : '';
    sp.prefix = '';
    sp.words = [];
  } else if (label === 'Delete') {
    if (sp.prefix) sp.prefix = sp.prefix.slice(0, -1);
    else sp.message = sp.message.trimEnd().slice(0, -1);
    suggestWords();
  } else if (label === 'Speak') {
    const text = spellText().trim();
    if (!text) return;
    chime();
    beforeSelect = { stage: 'spell', spell: { ...sp, level: 'rows', row: firstRow() } };
    return toSpeaking(text);
  } else if (label === 'Back') {
    chime('undo');
    if (!sp.back) return toListening();
    s.caption = sp.back.caption;
    return setRow(sp.back.rowKind, sp.back.items, { hl: startHl(), pause: TIMING.readPause });
  }
  chime('tick');
  sp.level = 'rows';
  sp.row = firstRow();
  restartPace(TIMING.lookPause);
}

// Moves the spelling highlight. Stepping past the last key of a row goes back to choosing rows.
function spellMove(d, wrap) {
  const sp = s.spell;
  const rows = spellRows();
  if (sp.level === 'keys') {
    const next = sp.key + d;
    if (next >= rows[sp.row].length && wrap) {
      sp.level = 'rows';
      return;
    }
    sp.key = Math.max(0, Math.min(rows[sp.row].length - 1, next));
    return;
  }
  let next = sp.row;
  for (let tries = 0; tries < rows.length; tries++) {
    next = wrap ? (next + d + rows.length) % rows.length : next + d;
    if (next < 0 || next >= rows.length) return;
    if (usableRow(next)) {
      sp.row = next;
      return;
    }
  }
}

// ---------- Patient state (demo controls now, tracker and care panel later) ----------
function setTired(on) {
  s.tired = on;
  if (s.stage !== 'choose' || s.rowKind !== 'replies' || s.selected >= 0) return;
  if (s.loading) {
    s.items = replyItems(['', '', '', '']);
    return;
  }
  const label = s.items[s.hl]?.label;
  const items = replyItems(s.replies);
  setRow('replies', items, { hl: items.findIndex((it) => it && it.label === label), pause: TIMING.lookPause });
}

function setFaceLost(on) {
  s.faceLost = on;
  if (on) {
    // Nothing the eyes do counts while the app can't see them; the highlight pauses where it is.
    s.eyesClosed = false;
    closedAt = null;
    s.cue = null;
  } else {
    restartPace(TIMING.lookPause);
  }
}

// ---------- Patient input ----------
const choosing = () => s.stage === 'choose' && !s.loading && s.selected < 0 && s.hl >= 0 && !s.faceLost;
const spelling = () => s.stage === 'spell' && !s.faceLost;

const gridShown = () => s.stage === 'choose' && s.rowKind !== 'listen' && !s.loading && s.selected < 0 && !s.faceLost;

// Arrow keys (or gazeLeft/gazeRight): move around the grid, or through the rows and keys of Spell it.
function onLook(dir) {
  if (s.eyesClosed) return;
  if (spelling()) spellMove(dir === 'right' || dir === 'down' ? 1 : -1, false);
  else if (gridShown()) s.hl = gridMove(s.hl, dir);
  else return;
  keyboardUntil = now() + TIMING.lookPause;
  s.pace = 'look';
  lookUntil = now() + TIMING.lookPause;
  s.progress = 0;
}

function gridMove(hl, dir) {
  if (hl < 0) return s.items.findIndex(Boolean);
  const col = hl % 2;
  const row = Math.floor(hl / 2);
  const next = { left: row * 2, right: row * 2 + 1, up: col, down: 2 + col }[dir];
  return s.items[next] ? next : hl;
}

function onEyes(closed) {
  const t = now();
  if (s.faceLost || closed === s.eyesClosed) return;
  s.eyesClosed = closed;
  if (closed) {
    closedAt = t;
    closeStartedAt = t;
    return;
  }
  openedAt = t;
  closedAt = null;
  stepStart = t; // the highlight held still while the eyes were closed; restart this step
  s.progress = 0;
  if (t - closeStartedAt < TIMING.shortBlink) shortBlink(t);
}

// Two short blinks close together undo, or go back from the urgent options to the replies.
function shortBlink(t) {
  shortBlinks = shortBlinks.filter((x) => t - x < TIMING.doubleBlink);
  shortBlinks.push(t);
  if (shortBlinks.length < 2) return;
  shortBlinks = [];
  if (s.stage === 'choose' && s.prevPage && s.selected < 0) {
    chime('undo');
    const p = s.prevPage;
    s.prevPage = null;
    s.caption = p.caption;
    setRow(p.rowKind, p.items, { hl: p.hl, pause: TIMING.lookPause });
  } else {
    undo();
  }
}

// ---------- Camera (vision module) ----------
// The camera pipeline detects the long blink or held squint itself and selects when the eyes open
// again, so it drives the ring and the selection directly instead of going through onEyes.
const camera = {
  status: (text) => demo.setEyes(text),
  calibration: (progress) => { s.calibration = progress; },
  hold: (b) => {
    const wasEngaged = s.cam.engaged;
    s.cam = { engaged: !!b?.engaged, closed: !!b?.closed, progress: b?.progress ?? 0 };
    if (wasEngaged && !s.cam.engaged) {
      openedAt = now();
      restartPace(TIMING.lookPause);
    }
  },
  // The box the patient is looking at gets the highlight; the center (rest circle) highlights nothing.
  focus: (quadrant) => {
    eyesOn = true;
    if (!gridShown() || now() < keyboardUntil) return;
    const i = quadrant ? GRID[quadrant] : -1;
    s.hl = i >= 0 && s.items[i] ? i : -1;
  },
  // Selects the box that had focus when the hold started. Listening has one item, so any hold picks it.
  select: (quadrant) => {
    openedAt = now();
    if (spelling()) return spellPick();
    if (s.stage !== 'choose' || s.loading || s.selected >= 0 || s.faceLost) return;
    if (s.rowKind === 'listen') return select(0);
    const i = quadrant ? GRID[quadrant] : -1;
    if (i >= 0 && s.items[i]) {
      s.hl = i;
      select(i);
    }
  },
  blink: (ms) => { if (ms < TIMING.shortBlink) shortBlink(now()); },
  face: (found) => runDemo('face', !found),
  fatigue: (level) => window.blinkvoice.setFatigue(level === 'elevated' ? 0.8 : 0),
};

// Picks whatever is highlighted now: a long blink, or select() from a gaze module.
function pickHighlighted() {
  if (spelling()) spellPick();
  else if (choosing()) select(s.hl);
}

// Input contract from conversation/public/patient.html, for the blink/gaze module:
//   window.blinkvoice.select() / .gazeLeft() / .gazeRight() / .setFatigue(0..1)
window.blinkvoice = {
  select: pickHighlighted,
  gazeLeft: () => onLook('left'),
  gazeRight: () => onLook('right'),
  setFatigue: (f) => {
    s.fatigue = Math.max(0, Math.min(1, Number(f) || 0));
    if ((s.fatigue >= 0.6) !== s.tired) runDemo('tired', s.fatigue >= 0.6);
  },
};

// ---------- Frame loop ----------
function itemState(i, holdShown) {
  const item = s.items[i];
  if (!item) return 'empty';
  if (s.loading) return item.type === 'card' ? 'loading' : 'default';
  if (i === s.selected) return item.type === 'card' ? 'selected' : 'highlighted';
  if (s.faceLost) return 'dimmed';
  if (i !== s.hl || s.selected >= 0) return 'default';
  if (holdShown) return 'hold';
  if (item.type === 'card' && s.autoStep && s.pace === 'step') return 'progress';
  return 'highlighted';
}

const view = createView();

function tick() {
  const t = now();
  let hold = 0;
  const active = choosing() || spelling();
  if (active && s.eyesClosed && closedAt != null) {
    // Long blink: the highlight holds still and the ring fills.
    hold = (t - closedAt) / TIMING.longBlink;
    if (hold >= 1) {
      closedAt = null;
      hold = 0;
      pickHighlighted();
    }
  } else if (active && s.cam.engaged) {
    hold = s.cam.progress; // the camera's hold; it selects when the eyes open again
  } else if (active && (s.stage === 'spell' || s.autoStep) && !s.eyesClosed) {
    if (s.pace === 'look' && t >= lookUntil) {
      s.pace = 'step';
      stepStart = t;
    }
    if (s.pace === 'step') {
      const stepMs = s.tired ? TIMING.stepTired : TIMING.step;
      s.progress = (t - stepStart) / stepMs;
      if (s.progress >= 1) {
        if (s.stage === 'spell') spellMove(1, true);
        else s.hl = (s.hl + 1) % s.items.length;
        stepStart = t;
        s.progress = 0;
      }
    }
  }
  // Selected moves on to Speaking once it has been on screen long enough for the patient to see it.
  if (s.selected >= 0 && s.stage === 'choose' && !s.eyesClosed
      && t - s.selectedAt >= TIMING.selectedMin && t - Math.max(s.selectedAt, openedAt) >= TIMING.selectedSeen) {
    toSpeaking(s.items[s.selected].label);
  }
  if (s.cue && t >= cueUntil) s.cue = null;

  const holdShown = choosing() && ((closedAt != null && t - closedAt > TIMING.holdShow) || (s.cam.engaged && s.cam.progress > 0.25));
  view.render({
    eyesClosed: s.eyesClosed || s.cam.closed,
    calibration: s.calibration,
    faceLost: s.faceLost,
    caption: s.caption,
    stage: s.stage,
    single: s.rowKind === 'listen',
    grid: s.rowKind !== 'listen',
    tiredRow: s.tired && s.rowKind === 'replies',
    items: s.items,
    itemStates: s.items.map((_, i) => itemState(i, holdShown)),
    paused: s.faceLost && !s.loading && s.selected < 0 ? s.hl : -1,
    progress: Math.min(1, s.progress),
    hold: Math.min(1, hold),
    cue: s.cue,
    backHint: s.stage === 'choose' && !!s.prevPage && s.selected < 0,
    loading: s.loading,
    spoken: s.spoken,
    spell: s.spell && { text: spellText(), rows: spellRows(), level: s.spell.level, row: s.spell.row, key: s.spell.key },
  });
  requestAnimationFrame(tick);
}

// ---------- Start ----------
const demo = createDemoPanel({ questions: QUESTIONS, onAction: runDemo });
function runDemo(action, arg) {
  const root = document.documentElement;
  if (action === 'panel') demo.toggle();
  if (action === 'next-question') playQuestion(QUESTIONS[nextQuestion++ % QUESTIONS.length]);
  if (action === 'question') playQuestion(QUESTIONS[arg]);
  if (action === 'say') nurseSaid(arg);
  if (action === 'listen') toListening();
  if (action === 'tired') setTired(arg ?? !s.tired);
  if (action === 'face') setFaceLost(arg ?? !s.faceLost);
  if (action === 'theme') root.dataset.theme = (arg ?? root.dataset.theme !== 'light') ? 'light' : 'dark';
  if (action === 'calibrate') eyes?.calibrate();
  demo.sync({ tired: s.tired, faceLost: s.faceLost, light: root.dataset.theme === 'light' });
}
let eyes = null;

// The server may still be starting; check until it answers (about 15 s), then keep its urgent options.
async function loadConfig(tries = 15) {
  const config = await getConfig();
  demo.setStatus(config);
  if (config) s.urgent = config.urgent ?? FALLBACK_URGENT;
  else if (tries > 0) setTimeout(() => loadConfig(tries - 1), 1000);
}

document.getElementById('patient-name').textContent = PATIENT;
onPatientInput((event) => {
  if (event.type === 'look') onLook(event.dir);
  if (event.type === 'eyes') onEyes(Boolean(event.closed));
});
onDemoKey((action) => runDemo(action));
loadConfig();
toListening();
requestAnimationFrame(tick);
startEyes(camera).then((handle) => { eyes = handle; });
