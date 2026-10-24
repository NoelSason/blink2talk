// Renders the patient screen from a plain model. Runs every animation frame, so it only touches the
// DOM when a value changed. Nothing here changes overall screen brightness: state changes only
// restyle the highlighted item.

import { TARGETS } from './gaze.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const byId = (id) => document.getElementById(id);
const FIT_STEPS = ['', 'reply-card__label--fit-1', 'reply-card__label--fit-2'];
const CALIBRATION_TEXT = {
  ready: 'Get ready to look at each dot. Turning your head a little is fine',
  center: 'Look at the dot',
  topLeft: 'Look at the dot',
  topRight: 'Look at the dot',
  bottomLeft: 'Look at the dot',
  bottomRight: 'Look at the dot',
  squint: 'Squint a little, still looking at the dot',
};
// Calibration dots sit where the boxes will be (gaze.js TARGETS, matched by the .reply-grid layout).
const DOT_AT = TARGETS;

function icon(name, extra = '') {
  const el = document.createElement('span');
  el.className = `icon icon--${name} ${extra}`.trim();
  el.setAttribute('aria-hidden', 'true');
  return el;
}

function span(className, text) {
  const el = document.createElement('span');
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

// The ring that fills during a long blink. It is for the people in the room; the patient's eyes are closed.
function holdRing() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'reply-card__hold');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['reply-card__hold-track', 'reply-card__hold-fill']) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '24');
    circle.setAttribute('cy', '24');
    circle.setAttribute('r', '19');
    if (cls === 'reply-card__hold-fill') circle.setAttribute('transform', 'rotate(-90 24 24)');
    svg.append(circle);
  }
  return svg;
}

function buildItem(item) {
  const el = document.createElement('div');
  if (!item) {
    el.className = 'grid-empty';
    return el;
  }
  el.setAttribute('role', 'option');
  if (item.type === 'end') {
    el.className = 'end-option';
    el.append(icon(item.kind === 'none' ? 'refresh' : 'keyboard'), span('', item.label));
    return el;
  }
  el.className = 'reply-card';
  if (item.icon) el.append(icon(item.icon, 'icon--l reply-card__icon'));
  const badge = span('reply-card__badge');
  badge.append(icon('check'), 'Selected');
  const progress = document.createElement('div');
  progress.className = 'reply-card__progress';
  progress.setAttribute('aria-hidden', 'true');
  const fill = document.createElement('div');
  fill.className = 'reply-card__progress-fill';
  progress.append(fill);
  el.append(badge, span('reply-card__label', item.label), progress, holdRing());
  return el;
}

// Steps a reply's text down until it fits on 2 lines, so nothing is ever cut off.
function fitLabels(cards) {
  for (const card of cards) {
    const label = card.querySelector('.reply-card__label');
    if (!label || !label.textContent) continue;
    for (const step of FIT_STEPS) {
      label.classList.remove(...FIT_STEPS.filter(Boolean));
      if (step) label.classList.add(step);
      const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
      if (label.offsetHeight <= lineHeight * 2.2) break;
    }
  }
}

export function createView() {
  const els = {
    calibration: byId('calibration'),
    calibDot: byId('calib-dot'),
    calibText: byId('calib-text'),
    calibCount: byId('calib-count'),
    gazeDot: byId('gaze-dot'),
    screen: byId('screen'),
    eyeIcon: byId('eye-icon'),
    eyeLabel: byId('eye-label'),
    caption: byId('caption'),
    captionWaiting: byId('caption-waiting'),
    captionSpeaker: byId('caption-speaker'),
    captionText: byId('caption-text'),
    stageChoose: byId('stage-choose'),
    gazeArea: byId('gaze-area'),
    statusLine: byId('status-line'),
    roomMessage: byId('room-message'),
    row: byId('reply-row'),
    cue: byId('cue'),
    cueLabel: byId('cue-label'),
    cueIcon: byId('cue-icon'),
    loadingNote: byId('loading-note'),
    backHint: byId('back-hint'),
    stageSpeaking: byId('stage-speaking'),
    spoken: byId('spoken'),
    undoHint: byId('undo-hint'),
  };
  const last = new Map();
  const changed = (key, value) => {
    if (last.get(key) === value) return false;
    last.set(key, value);
    return true;
  };

  let rowItems = null;
  let rowEls = [];
  let fitNeeded = true;
  window.addEventListener('resize', () => { fitNeeded = true; });
  document.fonts.addEventListener('loadingdone', () => { fitNeeded = true; });

  // New words in a live caption fade in; anything else replaces the text outright.
  function renderCaptionText(text, live) {
    const words = text ? text.split(' ') : [];
    const shown = [...els.captionText.children].map((n) => n.textContent.trim());
    const extends_ = live && shown.length <= words.length && shown.every((w, i) => w === words[i]);
    if (!extends_) els.captionText.replaceChildren();
    for (let i = extends_ ? shown.length : 0; i < words.length; i++) {
      els.captionText.append(span(extends_ ? 'word word--new' : 'word', (i ? ' ' : '') + words[i]));
    }
  }

  function renderRow(model) {
    if (model.items !== rowItems) {
      rowItems = model.items;
      rowEls = model.items.map(buildItem);
      // On the 2×2 screens the middle band (the question) is where the patient rests: no box.
      els.row.replaceChildren(...rowEls, ...(model.grid ? [middle] : []));
      els.row.classList.toggle('reply-row--single', model.single);
      els.row.classList.toggle('reply-grid', model.grid);
      for (const key of [...last.keys()]) if (key.startsWith('item')) last.delete(key);
      fitNeeded = true;
    }
    if (changed('tired', model.tiredRow)) {
      els.row.classList.toggle('reply-row--tired', model.tiredRow);
      fitNeeded = true;
    }
    rowEls.forEach((el, i) => {
      const state = model.itemStates[i];
      if (changed(`item${i}`, state)) {
        el.dataset.state = state;
        if (state !== 'empty') el.setAttribute('aria-selected', String(!['default', 'dimmed', 'loading'].includes(state)));
      }
      if (changed(`item${i}-paused`, i === model.paused)) el.toggleAttribute('data-paused', i === model.paused);
      if (state === 'progress' && changed(`item${i}-progress`, model.progress.toFixed(3))) {
        el.style.setProperty('--progress', model.progress.toFixed(3));
      }
      if (state === 'hold' && changed(`item${i}-hold`, model.hold.toFixed(3))) {
        el.style.setProperty('--hold', model.hold.toFixed(3));
      }
    });
    if (fitNeeded) {
      fitNeeded = false;
      fitLabels(rowEls);
    }
  }

  // The caption and status line live in the grid's middle band on the 2×2 screens, and above the
  // stage everywhere else (Listening, Speaking).
  const middle = document.createElement('div');
  middle.className = 'grid-middle';
  function placeCaption(inGrid) {
    if (inGrid) {
      middle.append(els.caption, els.statusLine);
      if (middle.parentNode !== els.row) els.row.append(middle);
    } else {
      els.gazeArea.prepend(els.caption);
      els.stageChoose.append(els.statusLine);
      middle.remove();
    }
  }

  // A point on the gaze area (x and y in [-1, 1]; gaze.js TARGETS) placed in screen coordinates.
  function placeOnGrid(node, x, y) {
    const screen = els.screen.getBoundingClientRect();
    let area = els.gazeArea.getBoundingClientRect();
    if (!area.width) area = screen;
    node.style.left = `${area.left - screen.left + area.width * (0.5 + x / 2)}px`;
    node.style.top = `${area.top - screen.top + area.height * (0.5 + y / 2)}px`;
  }

  function renderCalibration(c) {
    const seconds = c ? Math.max(1, Math.ceil(c.remainingMs / 1000)) : 0;
    if (!changed('calibration', c ? `${c.phase}|${seconds}` : '')) return;
    els.calibration.hidden = !c;
    if (!c) return;
    // Dots go where the grid's boxes are, so calibration matches what the patient will look at.
    const [x, y] = DOT_AT[c.phase] ?? DOT_AT.center;
    placeOnGrid(els.calibDot, x, y);
    els.calibText.textContent = CALIBRATION_TEXT[c.phase] ?? CALIBRATION_TEXT.center;
    els.calibCount.textContent = String(seconds);
  }

  function placeCaptionIfChanged(inGrid) {
    if (changed('caption-in-grid', inGrid)) placeCaption(inGrid);
    else if (inGrid && middle.parentNode !== els.row) els.row.append(middle); // the row was rebuilt
  }

  function render(model) {
    renderCalibration(model.calibration);
    const g = model.gazeDot;
    if (changed('gaze-dot', g ? `${g[0].toFixed(3)},${g[1].toFixed(3)}` : '')) {
      els.gazeDot.hidden = !g;
      if (g) placeOnGrid(els.gazeDot, Math.max(-1, Math.min(1, g[0])), Math.max(-1, Math.min(1, g[1])));
    }
    if (changed('screen-lost', model.faceLost)) els.screen.toggleAttribute('data-lost', model.faceLost);
    const eye = model.faceLost ? 'lost' : model.resting ? 'rest' : model.eyesClosed ? 'closed' : 'open';
    if (changed('eye', eye)) {
      els.eyeIcon.className = `icon icon--${{ lost: 'eye-off', rest: 'eye-closed', closed: 'eye-closed', open: 'eye' }[eye]}`;
      els.eyeLabel.textContent = { lost: "Can't see you", rest: 'Resting', closed: 'Eyes closed', open: 'I can see you' }[eye];
    }

    // Caption kinds: waiting (Listening), question (what was said), prompt, and message (what the
    // patient is spelling, with a caret; the placeholder shows while it's empty).
    const cap = model.caption;
    if (changed('caption', `${cap.kind}|${cap.speaker ?? ''}|${cap.text ?? ''}`)) {
      els.caption.classList.toggle('caption--prompt', cap.kind === 'prompt' || cap.kind === 'message');
      els.caption.classList.toggle('caption--message', cap.kind === 'message');
      els.caption.classList.toggle('caption--empty', cap.kind === 'message' && !cap.text);
      els.captionWaiting.hidden = cap.kind !== 'waiting';
      els.captionSpeaker.hidden = cap.kind !== 'question';
      els.captionText.hidden = cap.kind === 'waiting';
      els.captionSpeaker.textContent = cap.speaker ?? '';
      renderCaptionText(cap.text || cap.placeholder || '', cap.kind === 'question');
    }

    if (changed('stage', model.stage)) {
      els.stageChoose.hidden = model.stage !== 'choose';
      els.stageSpeaking.hidden = model.stage !== 'speaking';
      els.undoHint.hidden = model.stage !== 'speaking';
      fitNeeded = true;
    }
    if (model.stage === 'speaking' && changed('spoken', model.spoken)) els.spoken.textContent = model.spoken;
    if (model.stage !== 'choose' || !model.grid) placeCaptionIfChanged(false);
    if (model.stage !== 'choose') return;

    if (changed('lost', model.faceLost)) els.roomMessage.hidden = !model.faceLost;
    renderRow(model);
    placeCaptionIfChanged(model.grid);

    if (changed('cue', model.cue ?? '')) {
      els.cue.hidden = !model.cue;
      if (model.cue) {
        els.cue.dataset.dir = model.cue;
        els.cueLabel.textContent = model.cue === 'right' ? 'Looked right' : 'Looked left';
        els.cueIcon.className = `icon icon--arrow-${model.cue}`;
      }
    }
    if (changed('loading', model.loading)) els.loadingNote.hidden = !model.loading;
    if (changed('back', model.backHint)) els.backHint.hidden = !model.backHint;
    if (changed('name', model.name)) byId('patient-name').textContent = model.name;
  }

  return { render };
}
