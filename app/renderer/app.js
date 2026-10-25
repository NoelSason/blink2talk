// The patient screen's main loop:
//   Listening -> (nurse speaks) -> Loading -> Suggested replies -> Selected -> Speaking -> Listening
// Every choice sits in a 2×2 grid the eye tracker can hit (the vision module's quadrants): look at a
// box, then hold a long blink or squint. "None of these" opens the urgent options and Spell it; a
// double blink goes back. Replies, word suggestions, the patient's voice, the nurse mic, and the
// conversation summary come from the conversation server; which voice spoke comes from speakers.js.

import { PATIENT, QUESTIONS } from './samples.js';
import { createView } from './view.js';
import { createDemoPanel } from './demo.js';
import { createCarePanel } from './care.js';
import { createMemory } from './memory.js';
import { spellBoxes } from './speller.js';
import { onPatientInput, onDemoKey } from './input.js';
import { chime, speak, stopSpeaking } from './sound.js';
import { FALLBACK_URGENT, completeWord, getConfig, getReplies, getSummary, identifySpeaker, prefetchVoice, sttToken, voiceAudio, warmLocalModel } from './conversation.js';
import { startEyes } from './eyes.js';
import { loadSettings } from './devsettings.js';
import { createDevPanel } from './devpanel.js';
import { startMic } from './mic.js';

const TIMING = {
  word: 280,          // a sample question arrives one word at a time, like the live caption
  keyboard: 3000,     // after an arrow key, the camera's focus waits this long before taking over again
  holdShow: 200,      // ignore the ring for ordinary blinks
  longBlink: 1000,    // eyes closed this long selects (keyboard stand-in; the camera has its own)
  shortBlink: 400,    // closures shorter than this count toward a double blink (keyboard)
  camShortBlink: 800, // the same for the camera: a closure shorter than a select (selectMs) is a blink
  doubleBlink: 1000,  // short blinks less than this apart make a run: two go back or undo,
  thirdBlink: 650,    // three offer calibration again; after two, wait this long for a third
  tripleSpan: 1500,   // and all three must fall inside this, so ordinary blinks never add up to it
  selectedMin: 1500,  // "Selected" stays up at least this long,
  selectedSeen: 1000, // and at least this long after the eyes open, so the patient sees it
  afterSpeech: 1200,  // pause before going back to Listening
  micQuiet: 800,      // the mic stays muted this long after the voice stops, so it doesn't hear the tail
  summaryWait: 2000,  // the summary is redone this long after the conversation last changed
  continueTurn: 6000, // a mic turn starting this soon after the last one, before a pick, continues it
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
  consent: false,             // the current replies answer a high-stakes question (consent, treatment)
  stakesAbout: null,          // what a yes to it agrees to ("more pain medication"), when known
  resting: false,             // eyes closed 3 s: the camera treats it as a rest, not a choice
  mic: 'off',                 // 'off' | 'starting' | 'on' | 'unavailable'
  turn: null,                 // who said the current question: { speaker, voice, given }
  noneCount: 0,               // "None of these" presses for the current question
  rejected: [],               // replies shown for it that the patient said none of
  summary: null,              // { forPatient, forCaregiver, source, t }: the conversation so far
  localReplies: savedLocal(), // testing only: replies from a small model on this laptop (care panel)
  localAvailable: false,      // the conversation server has that model
};
// Claude's name for each voice the speaker-recognition model has heard ("voice key" -> "Dr. Lee").
// Voice ids last one launch, so keys carry the launch, and saved lines from earlier launches keep theirs.
const LAUNCH = Date.now().toString(36);
const voiceNames = new Map();

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
let eyesCalibrated = false;   // has the camera been calibrated at least once this session
const calibButton = document.getElementById('calib-start');
calibButton.addEventListener('click', () => { calibButton.blur(); runAction('calibrate'); });
const driftButton = document.getElementById('drift-start');
driftButton.addEventListener('click', () => { driftButton.blur(); runAction('drift-check'); });
const sourceButton = document.getElementById('source-toggle');
sourceButton.addEventListener('click', () => { sourceButton.blur(); runAction('gaze-source'); });
const sourceBadge = document.getElementById('source-badge');
let sourceBadgeTimer = 0;
// Shows which eye tracker drives the boxes, on the button and briefly mid-screen after a swap.
function showSource({ source, wetReady, wetLabels }, flash) {
  const name = source === 'webeyetrack' ? 'WebEyeTrack' : 'vision';
  sourceButton.textContent = `Eyes: ${name} (G)`;
  window.dispatchEvent(new CustomEvent('eyes-source', { detail: { source } })); // dev panel select
  if (!flash) return;
  sourceBadge.textContent = source === 'webeyetrack'
    ? `Eyes: WebEyeTrack${wetLabels ? '' : ' (not trained yet: calibrate)'}`
    : `Eyes: vision module${wetReady ? '' : ' (WebEyeTrack unavailable)'}`;
  sourceBadge.hidden = false;
  clearTimeout(sourceBadgeTimer);
  sourceBadgeTimer = setTimeout(() => { sourceBadge.hidden = true; }, 1800);
}
let keyboardUntil = 0;
let micQuietUntil = 0;
let micWanted = false; // off at launch: always-on listening picked up room chatter. M or the care panel turns it on.
let mic = null;
let eyes = null;
let camLesson = null;          // { quadrant, look } from the camera's last pick, taught back once the reply is spoken

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

// speaker: a known label (the sample questions say "Nurse"); otherwise Claude names whoever spoke.
// audio: the turn's speech from the mic, for the speaker-recognition model.
function nurseSaid(text, speaker = null, audio = null) {
  reset();
  s.noneCount = 0;
  s.rejected = [];
  s.turn = { text, speaker, voice: null, voiceId: null, given: !!speaker, endedAt: now() };
  s.caption = { kind: 'question', speaker: speaker ?? 'Someone', text };
  s.transcript = text;
  s.prevPage = null;
  requestReplies(audio);
}

// The nurse often pauses mid-question; the mic then ends the turn and the rest arrives as a new one.
// A mic turn that starts within TIMING.continueTurn of the last, before the patient has picked, is
// the same question: the caption and the replies cover both parts. Returns that earlier turn.
let micTurnStartedAt = 0; // when the current mic turn's first words arrived
function continuedTurn() {
  const t = s.turn;
  if (!t?.endedAt || micTurnStartedAt - t.endedAt > TIMING.continueTurn) return null;
  if (s.stage !== 'choose' || s.selected >= 0 || !['replies', 'unaddressed'].includes(s.rowKind)) return null;
  return t;
}

function continueQuestion(prev, text) {
  if (prev.added) memory.popTurn('nurse'); // the first part's line becomes the whole question
  reset();
  s.turn = { ...prev, text: `${prev.text} ${text}`, added: false, endedAt: now() };
  s.caption = { kind: 'question', speaker: prev.speaker ?? 'Someone', text: s.turn.text };
  s.transcript = s.turn.text;
  requestReplies(); // same speaker: the first part's voice print stands
}

// Replies started when the mic thinks the nurse is probably done (turn.eager_end), reused if the
// final transcript matches. Saves the wait between "probably done" and "done".
let prefetch = null; // { text, promise }
function repliesBody(transcript, history, turn) {
  return {
    transcript,
    history: history.slice(-6),
    patientProfile: memory.forClaude(),
    fatigue: s.tired ? Math.max(s.fatigue, 0.8) : s.fatigue,
    speaker: turn?.voiceId ? { voice: turn.voiceId, label: turn.speaker ?? undefined, isNew: turn.isNew } : undefined,
    local: s.localReplies || undefined,
  };
}
function prefetchReplies(text) {
  if (!text || !hearingNurse()) return;
  const prev = continuedTurn();
  const question = prev ? `${prev.text} ${text}` : text;
  const history = prev?.added ? memory.turns().slice(0, -1) : memory.turns();
  prefetch = { text: question, promise: getReplies(repliesBody(question, history, null)) };
}

// Shows the loading outlines until replies arrive. Stale answers are ignored.
async function requestReplies(audio = null) {
  const token = ++requestToken;
  const turn = s.turn;
  Object.assign(s, { stage: 'choose', rowKind: 'replies', items: replyItems(['', '', '']), loading: true, hl: -1, selected: -1 });
  const early = prefetch?.text === s.transcript ? prefetch.promise : null;
  prefetch = null;
  // Which voice it was (about 50 ms). A voice Claude has named before gets that name right away.
  const v = await identifySpeaker(audio);
  if (token !== requestToken) return;
  if (v) {
    Object.assign(turn, { voice: `${LAUNCH}/${v.voice}`, voiceId: v.voice, isNew: v.isNew });
    if (!turn.given) turn.speaker = voiceNames.get(turn.voice) ?? null;
    s.caption = { ...s.caption, speaker: turn.speaker ?? 'Someone' };
  }
  memory.addTurn('nurse', s.transcript, { speaker: turn.speaker, voice: turn.voice });
  turn.added = true;
  conversationChanged();
  const d = await (early ?? getReplies(repliesBody(s.transcript, memory.turns().slice(0, -1), turn)));
  if (token !== requestToken) return;
  nameSpeaker(turn, d.speaker);
  s.urgent = d.urgent;
  s.consent = d.highStakes;
  s.stakesAbout = d.about;
  if (!d.addressed) {
    // Room talk ("grab the chart from room 4"): stay quiet, but one blink still gets the replies.
    memory.popTurn('nurse');
    turn.added = false;
    conversationChanged();
    s.held = d.replies;
    s.caption = { kind: 'question', speaker: 'In the room', text: s.transcript };
    setRow('unaddressed', [card('Reply anyway', { icon: 'message', action: 'anyway' }), ...starterItems().slice(0, 3)]);
    return;
  }
  showReplies(d.replies);
}

// A fresh set of replies to the same question, without the ones already rejected.
const NONE_REASKS = 2;
async function reaskReplies() {
  const token = ++requestToken;
  Object.assign(s, { stage: 'choose', rowKind: 'replies', items: replyItems(['', '', '']), loading: true, hl: -1, selected: -1 });
  const d = await getReplies({ ...repliesBody(s.transcript, memory.turns().slice(0, -1), s.turn), rejected: s.rejected, round: s.noneCount });
  if (token !== requestToken) return;
  s.urgent = d.urgent;
  s.consent = d.highStakes;
  s.stakesAbout = d.about;
  showReplies(d.replies);
}

// Claude's guess at who spoke ({ label, role }): it names this line, the caption, and every line of
// the same voice this launch. A label given up front (sample questions) stays.
function nameSpeaker(turn, guess) {
  if (!guess || guess.label === 'Someone' || turn.given || guess.label === turn.speaker) return;
  turn.speaker = guess.label;
  if (turn.voice) voiceNames.set(turn.voice, guess.label);
  memory.relabel(guess.label, turn.voice);
  if (s.turn === turn && s.caption.kind === 'question') s.caption = { ...s.caption, speaker: guess.label };
  conversationChanged();
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
    // "None of these": up to NONE_REASKS fresh sets of replies (the server is told what was already
    // shown, so it doesn't repeat them), then the urgent options and Spell it. A double blink goes
    // back one page.
    chime();
    s.prevPage = page(i);
    if (s.noneCount < NONE_REASKS) {
      s.noneCount++;
      s.rejected.push(...sayable(s.items));
      reaskReplies();
    } else {
      setRow('starters', starterItems());
    }
  } else if (item.action === 'anyway') {
    chime();
    memory.addTurn('nurse', s.transcript, { speaker: s.turn?.speaker, voice: s.turn?.voice });
    conversationChanged();
    s.caption = { kind: 'question', speaker: s.turn?.speaker ?? 'Someone', text: s.transcript };
    showReplies(s.held);
  } else if (item.action === 'spell') {
    chime();
    openSpell();
  } else if (item.action === 'spell-pick') {
    spellPick(item.box, i);
  } else if (item.action === 'confirmed') {
    choose(i, item.say);
  } else if (item.action === 'recalibrate') {
    chime();
    runAction('calibrate');
  } else if (item.action === 'unconfirm') {
    goBack();
  } else if (item.action === 'say') {
    // A yes or no to consent or treatment is asked twice before it's spoken.
    if (s.consent && s.rowKind === 'replies' && /^(yes|no)\b/i.test(item.label)) askConfirm(i, item.label);
    else choose(i, item.label);
  }
}

// The question stays on screen, so the patient can check what they're answering. Two tall boxes,
// left and right only: left/right is the direction the eye tracker reads best (Noel's recorded
// session: about 4x the separation of up/down), so the step guarding a consent answer uses only that.
// Only on a high-stakes question (the conversation server classifies it): the caption says what the
// pick agrees to, "You said “Yes” to more pain medication. Is that correct?"
function askConfirm(i, text) {
  chime('tick');
  s.prevPage = page(i);
  const to = s.stakesAbout ? ` to ${s.stakesAbout}` : '';
  s.caption = { kind: 'prompt', text: `You said “${text}”${to}. Is that correct?` };
  setRow('confirm', [
    card("Yes, that's right", { icon: 'volume', action: 'confirmed', say: text }),
    { type: 'end', kind: 'back', label: 'No, go back', action: 'unconfirm' },
  ]);
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
  conversationChanged();
  const token = ++speechToken;
  const lesson = camLesson;
  camLesson = null;
  // The token check also runs before playback starts, so audio that arrives after an undo stays silent.
  speak(text, voiceAudio, () => token === speechToken).then(() => {
    if (token !== speechToken) return;
    micQuietUntil = now() + TIMING.micQuiet;
    later(TIMING.afterSpeech, toListening);
    // Spoken and not undone: the patient meant that box. Teaching the eye tracker must never keep the
    // screen on Speaking, so it runs after the way back to Listening is scheduled, and can't throw out.
    if (lesson && eyeSettings.learnFromPicks) {
      try {
        eyes?.learn(lesson.quadrant, lesson.look);
      } catch (err) {
        console.warn('eye learning failed:', err);
      }
    }
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
  } else if (s.rowKind === 'replies' || s.rowKind === 'unaddressed') {
    // The replies are the first page after a question; going back from them is "not now".
    // Noel's log: double blinks there were seen but did nothing, so it felt broken.
    chime('undo');
    toListening();
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
    conversationChanged();
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
  const words = await completeWord({ prefix, sentenceSoFar: sp.message.trim(), context: s.transcript, local: s.localReplies || undefined });
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
// What the nurse mic hears (mic.js). Also driven directly by test/e2e.js.
const heard = {
  onPartial(text) {
    if (!text || !hearingNurse()) return;
    micTurnStartedAt ||= now();
    const prev = continuedTurn();
    s.caption = { kind: 'question', speaker: prev ? prev.speaker ?? 'Someone' : 'Someone', text: prev ? `${prev.text} ${text}` : text };
  },
  onEagerEnd: (text) => prefetchReplies(text),
  onResume() { prefetch = null; },
  onTurn(text, audio) {
    micTurnStartedAt ||= now();
    const prev = continuedTurn();
    micTurnStartedAt = 0;
    // Don't wipe a half-spelled message or a pick in progress.
    if (!text || !hearingNurse()) return;
    if (prev) continueQuestion(prev, text);
    else nurseSaid(text, null, audio);
  },
};

const hearingNurse = () => s.stage === 'choose' && !['spell', 'confirm', 'recalibrate'].includes(s.rowKind) && s.selected < 0 && !s.calibration;

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
      ...heard,
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

// The box a camera quadrant means. On the two-column confirm screen only left or right counts.
function cellFor(quadrant) {
  if (!quadrant) return -1;
  return twoColumns() ? (quadrant.endsWith('Left') ? 0 : 1) : GRID[quadrant];
}
const twoColumns = () => s.rowKind === 'confirm' || s.rowKind === 'recalibrate';

function gridMove(hl, dir) {
  if (hl < 0) return s.items.findIndex(Boolean);
  if (twoColumns()) return { left: 0, right: 1 }[dir] ?? hl;
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

let backTimer = 0;
function shortBlink(t) {
  if (shortBlinks.length && t - shortBlinks.at(-1) >= TIMING.doubleBlink) shortBlinks = [];
  shortBlinks.push(t);
  clearTimeout(backTimer);
  if (shortBlinks.length >= 3 && t - shortBlinks.at(-3) <= TIMING.tripleSpan) {
    shortBlinks = [];
    offerRecalibrate();
  } else if (shortBlinks.length >= 2) {
    backTimer = setTimeout(() => {
      shortBlinks = [];
      goBack();
    }, TIMING.thirdBlink);
  }
}

// Three quick blinks: "Calibrate your eyes again?" on two tall boxes, like the consent confirm.
// Anywhere else than a choice screen (speaking, a pick showing), it's an undo, like two blinks.
function offerRecalibrate() {
  if (s.stage !== 'choose' || s.selected >= 0 || s.loading || s.calibration || s.rowKind === 'recalibrate') return goBack();
  chime('tick');
  s.prevPage = page(s.hl);
  s.caption = { kind: 'prompt', text: 'Calibrate your eyes again?' };
  setRow('recalibrate', [
    card('Calibrate again', { icon: 'eye', action: 'recalibrate' }),
    { type: 'end', kind: 'back', label: 'Go back', action: 'unconfirm' },
  ]);
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
  calibrated: () => { eyesCalibrated = true; toListening(); },
  rest: (on) => { s.resting = on; },
  hold: (b) => {
    const wasEngaged = s.cam.engaged;
    s.cam = { engaged: !!b?.engaged, closed: !!b?.closed, progress: b?.progress ?? 0 };
    if (wasEngaged && !s.cam.engaged) openedAt = now();
  },
  // The box the patient is looking at gets the highlight; the middle band (the question) highlights nothing.
  focus: (quadrant) => {
    eyesOn = true;
    if (!gridShown() || now() < keyboardUntil) return;
    const i = cellFor(quadrant);
    s.hl = i >= 0 && s.items[i] ? i : -1;
  },
  // Selects the box that had focus when the hold started. Listening has one item, so any hold picks it.
  select: (quadrant, look) => {
    openedAt = now();
    if (s.stage !== 'choose' || s.loading || s.selected >= 0 || s.faceLost || s.calibration) return;
    if (s.rowKind === 'listen') return select(0);
    const i = cellFor(quadrant);
    if (i >= 0 && s.items[i]) {
      s.hl = i;
      camLesson = look ? { quadrant, look } : null;
      select(i);
    }
  },
  blink: (ms) => {
    const counted = ms < TIMING.camShortBlink;
    window.dispatchEvent(new CustomEvent('blink-seen', { detail: { ms, counted } })); // dev panel readout
    if (counted) shortBlink(now());
  },
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
  // Selected moves on to Speaking once it has been on screen long enough for the patient to see it.
  if (s.selected >= 0 && s.stage === 'choose' && !s.eyesClosed && !s.cam.engaged
      && t - s.selectedAt >= TIMING.selectedMin && t - Math.max(s.selectedAt, openedAt) >= TIMING.selectedSeen) {
    toSpeaking(s.speakText);
  }

  const holdShown = choosing() && ((closedAt != null && t - closedAt > TIMING.holdShow) || (s.cam.engaged && s.cam.progress > 0.25));
  // The Calibrate button: hidden while the dots run, highlighted until the first calibration.
  calibButton.hidden = !!s.calibration;
  calibButton.dataset.needed = String(!eyesCalibrated);
  driftButton.hidden = !!s.calibration || !eyesCalibrated; // needs a calibration to correct
  view.render({
    name: memory.profile.name,
    eyesClosed: s.eyesClosed || s.cam.closed,
    resting: s.resting,
    calibration: s.calibration,
    faceLost: s.faceLost,
    caption: s.caption,
    stage: s.stage,
    single: s.rowKind === 'listen',
    grid: s.rowKind !== 'listen',
    columns: twoColumns(),
    tiredRow: s.tired && s.rowKind === 'replies',
    items: s.items,
    itemStates: s.items.map((_, i) => itemState(i, holdShown)),
    paused: s.faceLost && !s.loading && s.selected < 0 ? s.hl : -1,
    progress: 0,
    hold: Math.min(1, hold),
    cue: null,
    backHint: s.stage === 'choose' && s.selected < 0 && !twoColumns() && (!!s.prevPage || s.rowKind === 'spell'),
    summary: s.stage === 'choose' && s.rowKind === 'listen' ? s.summary?.forPatient ?? null : null,
    loading: s.loading,
    spoken: s.spoken,
  });
  requestAnimationFrame(tick);
}

// ---------- Summary ----------
// A couple of seconds after the conversation changes, Claude summarizes it twice: for the patient
// (on Listening) and for a caregiver (care panel). Without the server, the last few lines as said.
let summaryTimer = 0;
let summaryToken = 0;

function conversationChanged() {
  care.conversationChanged();
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(refreshSummary, TIMING.summaryWait);
}

async function refreshSummary() {
  const token = ++summaryToken;
  const turns = memory.turns().slice(-40);
  const summary = turns.length
    ? (await getSummary({ history: turns, patientProfile: memory.forClaude() })) ?? plainSummary(turns)
    : null;
  if (token !== summaryToken) return;
  s.summary = summary && { ...summary, t: Date.now() };
  care.summaryChanged(s.summary);
}

function plainSummary(turns) {
  const line = (t, you) => `${t.role === 'patient' ? (you ? 'You' : memory.profile.name) : t.speaker ?? 'Someone'} said “${t.text}”`;
  return {
    forPatient: turns.slice(-3).map((t) => `${line(t, true)}.`).join(' '),
    forCaregiver: turns.slice(-5).map((t) => line(t, false)),
    source: 'plain',
  };
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
  if (action === 'drift-check') eyes?.driftCheck();
  if (action === 'gaze-source' && eyes) showSource(arg ? eyes.setSource(arg) : eyes.toggleSource(), true);
  if (action === 'profile') memory.setProfile(arg);
  if (action === 'summary') refreshSummary();
  if (action === 'local-replies') setLocalReplies(arg ?? !s.localReplies);
  if (action === 'clear-history') {
    memory.clearHistory();
    conversationChanged();
  }
  syncPanels();
}

function syncPanels() {
  const light = document.documentElement.dataset.theme === 'light';
  demo.sync({ tired: s.tired, faceLost: s.faceLost, light });
  care.update({
    tired: s.tired, faceLost: s.faceLost, mic: s.mic === 'starting' ? (micWanted ? 'on' : 'off') : s.mic, light,
    local: s.localReplies, localAvailable: s.localAvailable,
  });
}

// Testing only (care panel): replies and word suggestions from a small model on this laptop instead
// of Claude. Kept between launches on this machine. Off by default.
function savedLocal() {
  try {
    return localStorage.getItem('blink2talk.localReplies') === 'on';
  } catch {
    return false;
  }
}
function setLocalReplies(on) {
  s.localReplies = on && s.localAvailable;
  try {
    localStorage.setItem('blink2talk.localReplies', s.localReplies ? 'on' : 'off');
  } catch {}
  if (s.localReplies) warmLocalModel(); // load it now, not on the next question
}

const demo = createDemoPanel({ questions: QUESTIONS, onAction: runAction });
const care = createCarePanel({ memory, onAction: runAction });

// The server may still be starting; check until it answers (about 15 s), then start the mic.
async function loadConfig(tries = 15) {
  const config = await getConfig();
  demo.setStatus(config);
  s.localAvailable = !!config?.localModel;
  setLocalReplies(s.localReplies);
  if (config) {
    s.urgent = config.urgent ?? FALLBACK_URGENT;
    prefetchVoice(s.urgent);
    if (micWanted) startNurseMic();
    else demo.setMic('Mic: off (M or the care panel turns it on)');
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
if (new URLSearchParams(location.search).has('test')) window.__test = { camera, heard, state: s };
toListening();
syncPanels();
loadConfig();
if (memory.history.length) refreshSummary(); // the conversation from before this launch
requestAnimationFrame(tick);
const eyeSettings = loadSettings();
const devPanel = createDevPanel({
  settings: eyeSettings,
  onRebuild: () => eyes?.rebuild(),
  onDrift: () => eyes?.driftCheck(),
  onBlink: (patch) => eyes?.setBlink(patch),
  onSource: (source) => runAction('gaze-source', source),
});
const devButton = document.getElementById('dev-open');
devButton.addEventListener('click', () => { devButton.blur(); devPanel.toggle(); });
startEyes(camera, eyeSettings).then((handle) => {
  eyes = handle;
  if (eyes) showSource({ source: eyeSettings.gazeSource }, false);
});
