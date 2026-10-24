// The patient screen's main loop:
//   Listening -> (nurse speaks) -> Loading -> Suggested replies -> Selected -> Speaking -> Listening
// Every choice sits in a 2×2 grid the eye tracker can hit (the vision module's quadrants): look at a
// box, then hold a long blink or squint. "None of these" opens the urgent options and Spell it; a
// double blink goes back. Replies, word suggestions, the patient's voice, and the nurse mic come from
// the conversation server.

import { PATIENT, QUESTIONS } from './samples.js';
import { createView } from './view.js';
import { createDemoPanel } from './demo.js';
import { createCarePanel } from './care.js';
import { createMemory } from './memory.js';
import { spellBoxes } from './speller.js';
import { onPatientInput, onDemoKey } from './input.js';
import { chime, speak, stopSpeaking } from './sound.js';
import { FALLBACK_URGENT, completeWord, getConfig, getReplies, prefetchVoice, sttToken, voiceAudio } from './conversation.js';
import { startEyes } from './eyes.js';
import { startMic } from './mic.js';

const TIMING = {
  word: 280,          // a sample question arrives one word at a time, like the live caption
  keyboard: 3000,     // after an arrow key, the camera's focus waits this long before taking over again
  holdShow: 200,      // ignore the ring for ordinary blinks
  longBlink: 1000,    // eyes closed this long selects (keyboard stand-in; the camera has its own)
  shortBlink: 400,    // closures shorter than this count toward a double blink (keyboard)
  camShortBlink: 700, // the same for the camera: anything that closes the eyes and falls short of a pick
  doubleBlink: 1000,  // two short blinks inside this window go back or undo
  selectedMin: 1500,  // "Selected" stays up at least this long,
  selectedSeen: 1000, // and at least this long after the eyes open, so the patient sees it
  afterSpeech: 1200,  // pause before going back to Listening
  micQuiet: 800,      // the mic stays muted this long after the voice stops, so it doesn't hear the tail
  micRetry: 3000,
};

const END_NONE = { type: 'end', kind: 'none', label: 'None of these', action: 'more' };
const card = (label, extra = {}) => ({ type: 'card', label, action: 'say', ...extra });
const LISTEN_ITEMS = [card('I want to say something', { icon: 'message', action: 'start' })];
const URGENT_ICONS = { "I'm in pain": 'bandage', "I can't breathe": 'wind', 'Call the nurse': 'bell' };
// Grid cells in reading order; the vision module names them by quadrant.
const GRID = { topLeft: 0, topRight: 1, bottomLeft: 2, bottomRight: 3 };
const QUADRANT = Object.keys(GRID); // cell index -> quadrant name

const memory = createMemory({ name: PATIENT });
const s = {
  stage: 'choose',            // 'choose' | 'speaking'
  caption: { kind: 'waiting' },
  rowKind: 'listen',          // 'listen' | 'replies' | 'starters' | 'unaddressed' | 'spell'
  items: LISTEN_ITEMS,
  replies: [],                // the current reply set
  held: [],                   // replies kept back when the speech wasn't meant for the patient
  urgent: FALLBACK_URGENT,
  transcript: '',             // what the nurse last said
  prevPage: null,             // the page a double blink goes back to (it may hold its own prevPage)
  loading: false,
  hl: 0,
  selected: -1,
  selectedAt: 0,
  speakText: '',
  eyesClosed: false,
  spoken: '',
  spell: null,                // { message, prefix, words, path: [level], back }
  tired: false,
  fatigue: 0,
  faceLost: false,
  cam: { engaged: false, closed: false, progress: 0 }, // camera hold: a long blink or held squint in progress
  calibration: null,          // calibration progress while the camera calibrates
  practice: null,             // { order, i, hits, times, shownAt } during the practice round
  consent: false,             // the current replies answer a consent or treatment question
  resting: false,             // eyes closed 3 s: the camera treats it as a rest, not a choice
  gazePoint: null,            // where gaze.js thinks the patient is looking, for the G overlay
  showGaze: false,
  moved: false,               // the head or camera moved since calibration: re-center when quiet
  camPick: null,              // the box the camera picked, taught back to gaze.js once the reply is spoken
  mic: 'off',                 // 'off' | 'starting' | 'on' | 'unavailable'
};

const now = () => performance.now();
let closedAt = null;          // start of the current keyboard closure; cleared once a long blink fires
let closeStartedAt = 0;
let openedAt = 0;
let shortBlinks = [];
let timers = [];
let speechToken = 0;
let requestToken = 0;
let beforeSelect = null;      // what to go back to on a double blink
let nextQuestion = 0;
let eyesOn = false;           // the camera is calibrated and reporting where the patient looks
let keyboardUntil = 0;
let micQuietUntil = 0;
let micWanted = true;
let mic = null;
let eyes = null;

const later = (ms, fn) => timers.push(setTimeout(fn, ms));
function reset() {
  timers.forEach(clearTimeout);
  timers = [];
  speechToken++;
  requestToken++;
  stopSpeaking();
}

function setRow(rowKind, items, { hl = startHl() } = {}) {
  Object.assign(s, { stage: 'choose', rowKind, items, hl, loading: false, selected: -1 });
}

// With the camera, nothing is highlighted until the patient looks at a box. On the keyboard, start top left.
const startHl = () => (eyesOn ? -1 : 0);

// Three replies and "None of these" bottom right, like the vision module's quadrant demo.
// Tired mode keeps two replies.
function replyItems(replies) {
  const reply = (i) => (replies[i] != null && !(s.tired && i > 1) ? card(replies[i]) : null);
  return [reply(0), reply(1), reply(2), END_NONE];
}

// The conversation server's options that are always offered: its urgent phrases and Spell it.
function starterItems() {
  return [...s.urgent.slice(0, 3).map((u) => card(u, { icon: URGENT_ICONS[u] ?? 'message' })), card('Spell it', { icon: 'keyboard', action: 'spell' })];
}

const sayable = (items) => items.filter((it) => it?.action === 'say').map((it) => it.label);

// ---------- Listening and replies ----------
function toListening() {
  reset();
  s.caption = { kind: 'waiting' };
  s.prevPage = null;
  setRow('listen', LISTEN_ITEMS, { hl: 0 });
}

// A sample question (demo controls) arrives one word at a time, the way the live caption does.
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
  memory.addTurn('nurse', text);
  care.conversationChanged();
  requestReplies();
}

// Shows the loading outlines until replies arrive. Stale answers are ignored.
async function requestReplies() {
  const token = ++requestToken;
  Object.assign(s, { stage: 'choose', rowKind: 'replies', items: replyItems(['', '', '']), loading: true, hl: -1, selected: -1 });
  const d = await getReplies({
    transcript: s.transcript,
    history: memory.turns().slice(0, -1).slice(-6),
    patientProfile: memory.forClaude(),
    fatigue: s.tired ? Math.max(s.fatigue, 0.8) : s.fatigue,
  });
  if (token !== requestToken) return;
  s.urgent = d.urgent;
  s.consent = d.source === 'consent-rule';
  if (!d.addressed) {
    // Room talk ("grab the chart from room 4"): stay quiet, but one blink still gets the replies.
    memory.popTurn('nurse');
    care.conversationChanged();
    s.held = d.replies;
    s.caption = { kind: 'question', speaker: 'In the room', text: s.transcript };
    setRow('unaddressed', [card('Reply anyway', { icon: 'message', action: 'anyway' }), ...starterItems().slice(0, 3)]);
    return;
  }
  showReplies(d.replies);
}

function showReplies(replies) {
  s.replies = replies;
  const items = replyItems(replies);
  prefetchVoice(sayable(items)); // the chosen reply plays without waiting for the voice
  setRow('replies', items);
}

function select(i) {
  const item = s.items[i];
  if (!item) return;
  if (item.action === 'start') {
    chime();
    s.prevPage = page(i);
    s.caption = { kind: 'prompt', text: 'What do you want to say?' };
    setRow('starters', starterItems());
  } else if (item.action === 'more') {
    // "None of these": the grid has room for four boxes, so the urgent options and Spell it are the
    // next page. A double blink goes back to the replies.
    chime();
    s.prevPage = page(i);
    setRow('starters', starterItems());
  } else if (item.action === 'anyway') {
    chime();
    memory.addTurn('nurse', s.transcript);
    care.conversationChanged();
    s.caption = { kind: 'question', speaker: 'Nurse', text: s.transcript };
    showReplies(s.held);
  } else if (item.action === 'spell') {
    chime();
    openSpell();
  } else if (item.action === 'spell-pick') {
    spellPick(item.box, i);
  } else if (item.action === 'practice') {
    practicePick(item);
  } else if (item.action === 'confirmed') {
    choose(i, item.say);
  } else if (item.action === 'unconfirm') {
    goBack();
  } else if (item.action === 'say') {
    // A yes or no to consent or treatment is asked twice before it's spoken.
    if (s.consent && s.rowKind === 'replies' && /^(yes|no)\b/i.test(item.label)) askConfirm(i, item.label);
    else choose(i, item.label);
  }
}

function askConfirm(i, text) {
  chime('tick');
  s.prevPage = page(i);
  s.caption = { kind: 'prompt', text: `You chose “${text}”. Is that right?` };
  setRow('confirm', [card(`Say “${text}”`, { action: 'confirmed', say: text }), card('Go back', { action: 'unconfirm' }), null, null]);
}

// ---------- Practice, right after calibration ----------
// Four boxes; one is marked at a time, each corner once in random order. It shows the patient how
// choosing works, and gives the team a measured hit count (demo controls) instead of a guess.
function startPractice() {
  reset();
  s.practice = { order: [0, 1, 2, 3].sort(() => Math.random() - 0.5), i: 0, hits: 0, times: [], shownAt: 0 };
  showPractice();
}

function showPractice() {
  const p = s.practice;
  const target = p.order[p.i];
  s.caption = { kind: 'prompt', text: `Practice ${p.i + 1} of ${p.order.length}: look at the marked box, then close your eyes for a moment` };
  setRow('practice', [0, 1, 2, 3].map((cell) => (cell === target
    ? card('Look here', { icon: 'eye', action: 'practice', hit: true })
    : card('', { action: 'practice', hit: false }))));
  p.target = QUADRANT[target];
  p.shownAt = now();
}

function practicePick(item) {
  const p = s.practice;
  chime(item.hit ? 'select' : 'undo');
  // The patient was looking at the marked box either way, so a miss teaches the gaze model too.
  eyes?.label(p.target, 2);
  if (item.hit) p.hits++;
  p.times.push(now() - p.shownAt);
  if (++p.i < p.order.length) return showPractice();
  const seconds = p.times.reduce((a, b) => a + b, 0) / p.times.length / 1000;
  demo.setPractice(`Practice: ${p.hits} of ${p.order.length} correct, ${seconds.toFixed(1)} s each${p.hits < p.order.length - 1 ? '. Press C to calibrate again.' : ''}`);
  s.practice = null;
  s.caption = { kind: 'prompt', text: "You're all set" };
  setRow('practice', [null, null, null, null]);
  later(1500, toListening);
}

// Selected: the card turns green with a check and a chime; Speaking follows (see tick).
function choose(i, text) {
  chime();
  beforeSelect = { caption: s.caption, rowKind: s.rowKind, items: s.items, hl: i, spell: s.spell && { ...s.spell } };
  s.selected = i;
  s.selectedAt = now();
  s.speakText = text;
  if (s.urgent.includes(text)) alertCare(text);
}

function toSpeaking(text) {
  s.stage = 'speaking';
  s.spoken = text;
  s.selected = -1;
  memory.addTurn('patient', text);
  memory.picked(text);
  care.conversationChanged();
  const token = ++speechToken;
  // The token check also runs before playback starts, so audio that arrives after an undo stays silent.
  const camPick = s.camPick;
  s.camPick = null;
  speak(text, voiceAudio, () => token === speechToken).then(() => {
    if (token !== speechToken) return;
    if (camPick) eyes?.label(camPick, 0.5); // spoken and not undone: the patient meant that box
    micQuietUntil = now() + TIMING.micQuiet;
    later(TIMING.afterSpeech, toListening);
  });
}

// The current page, to come back to. Its own back page comes along, so double blinks walk back one
// page at a time: Spell it → the urgent options → the replies.
function page(hl) {
  return { caption: s.caption, rowKind: s.rowKind, items: s.items, hl, prevPage: s.prevPage };
}

function showPage(p) {
  s.prevPage = p.prevPage ?? null;
  s.caption = p.caption;
  setRow(p.rowKind, p.items, { hl: p.hl ?? startHl() });
}

// Double blink: undo a pick (on Selected or Speaking), go up a level in Spell it, or go back to the
// previous page (Spell it → where it was opened from, the urgent options → the replies or Listening).
function goBack() {
  if (s.stage === 'speaking' || s.selected >= 0) return undo();
  if (s.stage !== 'choose') return;
  if (s.rowKind === 'spell' && s.spell.path.length) {
    chime('undo');
    s.spell.path.pop();
    showSpell();
  } else if (s.rowKind === 'spell') {
    leaveSpell();
  } else if (s.prevPage) {
    chime('undo');
    showPage(s.prevPage);
  }
}

function undo() {
  if (!beforeSelect) return;
  reset();
  chime('undo');
  const b = beforeSelect;
  beforeSelect = null;
  if (s.stage === 'speaking') {
    memory.popTurn('patient');
    care.conversationChanged();
  }
  s.spell = b.spell;
  s.caption = b.caption;
  setRow(b.rowKind, b.items, { hl: b.hl });
}

// ---------- Spell it (speller.js) ----------
function openSpell() {
  const back = page(s.hl);
  s.prevPage = null;
  reset();
  s.spell = { message: '', prefix: '', words: [], path: [], back };
  showSpell();
}

// Back (the action box) or a double blink at the top level: the page Spell it was opened from.
function leaveSpell() {
  chime('undo');
  showPage(s.spell.back);
}

function spellText() {
  const t = s.spell.message + s.spell.prefix;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function spellItems() {
  const level = s.spell.path.at(-1) ?? { kind: 'root' };
  return spellBoxes(level, s.spell.words).map((box) => box && card(box.label, { action: 'spell-pick', box }));
}

function showSpell(hl = startHl()) {
  s.caption = { kind: 'message', text: spellText(), placeholder: 'Spell your message' };
  setRow('spell', spellItems(), { hl });
}

async function suggestWords() {
  const sp = s.spell;
  const prefix = sp.prefix;
  sp.words = [];
  if (!prefix) return;
  const words = await completeWord({ prefix, sentenceSoFar: sp.message.trim(), context: s.transcript });
  if (s.spell !== sp || sp.prefix !== prefix) return;
  sp.words = words;
  // The suggestions box fills in when they arrive; nothing else moves.
  if (s.rowKind === 'spell' && s.selected < 0 && sp.path.length === 0) s.items = spellItems();
}

function spellPick(box, i) {
  const sp = s.spell;
  if (box.pick === 'action' && box.label === 'Speak') {
    const text = spellText().trim();
    if (text) choose(i, text);
    return;
  }
  if (box.pick === 'action' && box.label === 'Back') return leaveSpell();
  chime('tick');
  if (box.pick === 'group') sp.path.push({ kind: 'letters', letters: box.letters });
  else if (box.pick === 'words') sp.path.push({ kind: 'words' });
  else if (box.pick === 'actions') sp.path.push({ kind: 'actions' });
  else {
    if (box.pick === 'letter') sp.prefix += box.label.toLowerCase();
    else if (box.pick === 'word') {
      sp.message += `${box.label} `;
      sp.prefix = '';
    } else if (box.label === 'Space') {
      sp.message += sp.prefix ? `${sp.prefix} ` : '';
      sp.prefix = '';
    } else if (box.label === 'Delete') {
      if (sp.prefix) sp.prefix = sp.prefix.slice(0, -1);
      else sp.message = sp.message.trimEnd().slice(0, -1);
    }
    sp.path = [];
    suggestWords();
  }
  showSpell();
}

// ---------- Patient state ----------
function setTired(on) {
  s.tired = on;
  if (s.stage !== 'choose' || s.rowKind !== 'replies' || s.selected >= 0 || s.loading) return;
  const label = s.items[s.hl]?.label;
  const items = replyItems(s.replies);
  setRow('replies', items, { hl: items.findIndex((it) => it && it.label === label) });
}

function setFaceLost(on) {
  s.faceLost = on;
  if (on) {
    // Nothing the eyes do counts while the app can't see them; the highlight pauses where it is.
    s.eyesClosed = false;
    closedAt = null;
  }
}

// An urgent pick: a badge on the care button, a sound for the room, and a desktop notification.
function alertCare(text) {
  const name = memory.profile.name;
  care.alert(text);
  setTimeout(() => chime('alert'), 350);
  try {
    new Notification(`${name} needs attention`, { body: `${name} said “${text}”`, silent: true });
  } catch {
    // Notifications unavailable: the badge and the sound still show it.
  }
}

// ---------- Nurse mic (mic.js, Cartesia Ink-2 through the conversation server's token) ----------
const hearingNurse = () => s.stage === 'choose' && !['spell', 'practice', 'confirm'].includes(s.rowKind) && s.selected < 0 && !s.calibration;

async function startNurseMic() {
  if (mic || !micWanted) return;
  s.mic = 'starting';
  syncPanels();
  const token = await sttToken();
  if (!token) {
    s.mic = 'unavailable';
    demo.setMic('Mic: off (needs the conversation server and a Cartesia key)');
    return syncPanels();
  }
  try {
    mic = await startMic({
      token,
      muted: () => s.stage === 'speaking' || now() < micQuietUntil,
      onPartial: (text) => {
        if (text && hearingNurse()) s.caption = { kind: 'question', speaker: 'Nurse', text };
      },
      onTurn: (text) => {
        // Don't wipe a half-spelled message or a pick in progress.
        if (text && hearingNurse()) nurseSaid(text);
      },
      onError: (message) => {
        mic = null;
        s.mic = 'off';
        demo.setMic(`Mic: reconnecting (${message})`);
        syncPanels();
        setTimeout(startNurseMic, TIMING.micRetry);
      },
    });
    s.mic = 'on';
    demo.setMic('Mic: listening for the nurse');
  } catch (err) {
    s.mic = 'off';
    demo.setMic(`Mic: off (${err?.message ?? err})`);
  }
  syncPanels();
}

function setMic(on) {
  micWanted = on;
  if (on) return startNurseMic();
  mic?.stop();
  mic = null;
  s.mic = s.mic === 'unavailable' ? 'unavailable' : 'off';
  demo.setMic('Mic: off');
  syncPanels();
}

// ---------- Patient input ----------
const choosing = () => s.stage === 'choose' && !s.loading && s.selected < 0 && s.hl >= 0 && !s.faceLost;
const gridShown = () => s.stage === 'choose' && s.rowKind !== 'listen' && !s.loading && s.selected < 0 && !s.faceLost;

// Arrow keys (or gazeLeft/gazeRight): move around the grid.
function onLook(dir) {
  if (s.eyesClosed || !gridShown()) return;
  s.hl = gridMove(s.hl, dir);
  keyboardUntil = now() + TIMING.keyboard;
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
  if (t - closeStartedAt < TIMING.shortBlink) shortBlink(t);
}

function shortBlink(t) {
  shortBlinks = shortBlinks.filter((x) => t - x < TIMING.doubleBlink);
  shortBlinks.push(t);
  if (shortBlinks.length < 2) return;
  shortBlinks = [];
  goBack();
}

// Picks whatever is highlighted now: a long blink, or select() from a gaze module.
function pickHighlighted() {
  if (choosing()) select(s.hl);
}

// ---------- Camera (eyes.js, the vision module) ----------
// The camera pipeline detects the long blink or held squint itself and selects when the eyes open
// again, so it drives the ring and the selection directly instead of going through onEyes.
const camera = {
  status: (text) => demo.setEyes(text),
  calibration: (progress) => { s.calibration = progress; },
  calibrated: () => startPractice(),
  rest: (on) => { s.resting = on; },
  gaze: (point) => { s.gazePoint = point; },
  moved: () => { s.moved = true; },
  recentered: () => { s.moved = false; },
  hold: (b) => {
    const wasEngaged = s.cam.engaged;
    s.cam = { engaged: !!b?.engaged, closed: !!b?.closed, progress: b?.progress ?? 0 };
    if (wasEngaged && !s.cam.engaged) openedAt = now();
  },
  // The box the patient is looking at gets the highlight; the middle band (the question) highlights nothing.
  focus: (quadrant) => {
    eyesOn = true;
    if (!gridShown() || now() < keyboardUntil) return;
    const i = quadrant ? GRID[quadrant] : -1;
    s.hl = i >= 0 && s.items[i] ? i : -1;
  },
  // Selects the box that had focus when the hold started. Listening has one item, so any hold picks it.
  select: (quadrant) => {
    openedAt = now();
    if (s.stage !== 'choose' || s.loading || s.selected >= 0 || s.faceLost || s.calibration) return;
    s.camPick = quadrant;
    if (s.rowKind === 'listen') return select(0);
    const i = quadrant ? GRID[quadrant] : -1;
    if (i >= 0 && s.items[i]) {
      s.hl = i;
      select(i);
    }
  },
  blink: (ms) => { if (ms < TIMING.camShortBlink) shortBlink(now()); },
  face: (found) => runAction('face', !found),
  fatigue: (level) => window.blinkvoice.setFatigue(level === 'elevated' ? 0.8 : 0),
};

// Input contract from conversation/public/patient.html, for any blink/gaze module:
//   window.blinkvoice.select() / .gazeLeft() / .gazeRight() / .setFatigue(0..1)
window.blinkvoice = {
  select: pickHighlighted,
  gazeLeft: () => onLook('left'),
  gazeRight: () => onLook('right'),
  setFatigue: (f) => {
    s.fatigue = Math.max(0, Math.min(1, Number(f) || 0));
    if ((s.fatigue >= 0.6) !== s.tired) runAction('tired', s.fatigue >= 0.6);
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
  return holdShown ? 'hold' : 'highlighted';
}

const view = createView();

function tick() {
  const t = now();
  let hold = 0;
  if (choosing() && s.eyesClosed && closedAt != null) {
    // Keyboard long blink: the highlight holds still and the ring fills.
    hold = (t - closedAt) / TIMING.longBlink;
    if (hold >= 1) {
      closedAt = null;
      hold = 0;
      pickHighlighted();
    }
  } else if (choosing() && s.cam.engaged) {
    hold = s.cam.progress; // the camera's hold; it selects when the eyes open again
  }
  // The head or camera moved: re-center at the next quiet moment (not mid-pick, not during practice).
  if (s.moved && s.stage === 'choose' && s.selected < 0 && !s.loading && !s.calibration && s.rowKind !== 'practice' && !s.eyesClosed && !s.cam.engaged) {
    s.moved = false;
    eyes?.recenter();
  }
  // Selected moves on to Speaking once it has been on screen long enough for the patient to see it.
  if (s.selected >= 0 && s.stage === 'choose' && !s.eyesClosed && !s.cam.engaged
      && t - s.selectedAt >= TIMING.selectedMin && t - Math.max(s.selectedAt, openedAt) >= TIMING.selectedSeen) {
    toSpeaking(s.speakText);
  }

  const holdShown = choosing() && ((closedAt != null && t - closedAt > TIMING.holdShow) || (s.cam.engaged && s.cam.progress > 0.25));
  view.render({
    name: memory.profile.name,
    eyesClosed: s.eyesClosed || s.cam.closed,
    resting: s.resting,
    gazeDot: s.showGaze && !s.calibration ? s.gazePoint : null,
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
    progress: 0,
    hold: Math.min(1, hold),
    cue: null,
    backHint: s.stage === 'choose' && s.selected < 0 && (!!s.prevPage || s.rowKind === 'spell'),
    loading: s.loading,
    spoken: s.spoken,
  });
  requestAnimationFrame(tick);
}

// ---------- Panels and start ----------
// One handler for the demo controls, the care panel, and the operator keys.
function runAction(action, arg) {
  const root = document.documentElement;
  if (action === 'panel') demo.toggle();
  if (action === 'care') care.toggle();
  if (action === 'next-question') playQuestion(QUESTIONS[nextQuestion++ % QUESTIONS.length]);
  if (action === 'question') playQuestion(QUESTIONS[arg]);
  if (action === 'say') nurseSaid(arg);
  if (action === 'listen') toListening();
  if (action === 'tired') setTired(arg ?? !s.tired);
  if (action === 'face') setFaceLost(arg ?? !s.faceLost);
  if (action === 'mic') setMic(arg ?? !micWanted);
  if (action === 'theme') root.dataset.theme = (arg ?? root.dataset.theme !== 'light') ? 'light' : 'dark';
  if (action === 'calibrate') eyes?.calibrate();
  if (action === 'recenter') eyes?.recenter();
  if (action === 'gaze-dot') s.showGaze = !s.showGaze;
  if (action === 'more-sensitive' || action === 'less-sensitive') {
    setSensitivity((eyes?.sensitivity ?? savedSensitivity()) + (action === 'more-sensitive' ? 0.1 : -0.1));
  }
  if (action === 'profile') memory.setProfile(arg);
  if (action === 'clear-history') {
    memory.clearHistory();
    care.conversationChanged();
  }
  syncPanels();
}

// Eye sensitivity ([ and ]): how small a look reaches a box. Kept between launches on this machine.
const SENSITIVITY_KEY = 'blink2talk.sensitivity';
function savedSensitivity() {
  try {
    return Number(localStorage.getItem(SENSITIVITY_KEY)) || 1.2;
  } catch {
    return 1.2;
  }
}
function setSensitivity(value) {
  if (!eyes) return;
  eyes.sensitivity = Math.round(value * 10) / 10;
  try {
    localStorage.setItem(SENSITIVITY_KEY, String(eyes.sensitivity));
  } catch {}
  demo.setSensitivity(eyes.sensitivity);
}

function syncPanels() {
  const light = document.documentElement.dataset.theme === 'light';
  demo.sync({ tired: s.tired, faceLost: s.faceLost, light });
  care.update({ tired: s.tired, faceLost: s.faceLost, mic: s.mic === 'starting' ? (micWanted ? 'on' : 'off') : s.mic, light });
}

const demo = createDemoPanel({ questions: QUESTIONS, onAction: runAction });
const care = createCarePanel({ memory, onAction: runAction });

// The server may still be starting; check until it answers (about 15 s), then start the mic.
async function loadConfig(tries = 15) {
  const config = await getConfig();
  demo.setStatus(config);
  if (config) {
    s.urgent = config.urgent ?? FALLBACK_URGENT;
    prefetchVoice(s.urgent);
    startNurseMic();
  } else if (tries > 0) {
    setTimeout(() => loadConfig(tries - 1), 1000);
  } else {
    s.mic = 'unavailable';
    demo.setMic('Mic: off (conversation server not running)');
    syncPanels();
  }
}

onPatientInput((event) => {
  if (event.type === 'look') onLook(event.dir);
  if (event.type === 'eyes') onEyes(Boolean(event.closed));
});
onDemoKey((action) => runAction(action));
// test/e2e.js loads the page with ?test and drives the camera handlers with recorded-style events.
if (new URLSearchParams(location.search).has('test')) window.__test = { camera, state: s };
toListening();
syncPanels();
loadConfig();
requestAnimationFrame(tick);
startEyes(camera).then((handle) => {
  eyes = handle;
  if (eyes) setSensitivity(savedSensitivity());
});
