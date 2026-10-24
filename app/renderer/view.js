// Renders the patient screen from a plain model. Runs every animation frame, so it only touches the
// DOM when a value changed. Nothing here changes overall screen brightness: state changes only
// restyle the highlighted item.

const SVG_NS = 'http://www.w3.org/2000/svg';
const byId = (id) => document.getElementById(id);
const FIT_STEPS = ['', 'reply-card__label--fit-1', 'reply-card__label--fit-2'];
const CALIBRATION_TEXT = {
  ready: 'Get ready to look at the dot',
  center: 'Look at the dot',
  left: 'Look at the dot on the left',
  right: 'Look at the dot on the right',
  squintReady: 'Get ready to squint',
  squint: 'Squint a little, still looking at the dot',
};

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
    screen: byId('screen'),
    stageSpell: byId('stage-spell'),
    messageText: byId('message-text'),
    keyboard: byId('keyboard'),
    eyeIcon: byId('eye-icon'),
    eyeLabel: byId('eye-label'),
    caption: byId('caption'),
    captionWaiting: byId('caption-waiting'),
    captionSpeaker: byId('caption-speaker'),
    captionText: byId('caption-text'),
    stageChoose: byId('stage-choose'),
    roomMessage: byId('room-message'),
    row: byId('reply-row'),
    cue: byId('cue'),
    cueLabel: byId('cue-label'),
    cueIcon: byId('cue-icon'),
    loadingNote: byId('loading-note'),
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
      els.row.replaceChildren(...rowEls);
      els.row.classList.toggle('reply-row--single', model.single);
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
        el.setAttribute('aria-selected', String(!['default', 'dimmed', 'loading'].includes(state)));
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

  // Spell it: rows of keys. Rows highlight first; a long blink then steps through that row's keys.
  let spellSig = null;
  let keyRows = [];
  function renderSpell(sp) {
    const sig = sp.rows.map((r) => r.join('|')).join('/');
    if (sig !== spellSig) {
      spellSig = sig;
      keyRows = sp.rows.map((labels) => {
        const row = document.createElement('div');
        row.className = 'key-row';
        const keys = labels.map((label) => span('key', label));
        row.append(...keys);
        return { row, keys };
      });
      els.keyboard.replaceChildren(...keyRows.map((r) => r.row));
      for (const key of [...last.keys()]) if (key.startsWith('key')) last.delete(key);
    }
    keyRows.forEach(({ row, keys }, i) => {
      const active = i === sp.row;
      const rowState = active ? (sp.level === 'rows' ? 'row' : 'active') : 'default';
      if (changed(`keyrow${i}`, rowState)) row.dataset.state = rowState;
      keys.forEach((key, j) => {
        const state = active && sp.level === 'keys' && j === sp.key ? 'key' : 'default';
        if (changed(`key${i}-${j}`, state)) key.dataset.state = state;
      });
    });
    if (changed('message', sp.text)) els.messageText.textContent = sp.text;
  }

  function renderCalibration(c) {
    const seconds = c ? Math.max(1, Math.ceil(c.remainingMs / 1000)) : 0;
    if (!changed('calibration', c ? `${c.phase}|${seconds}` : '')) return;
    els.calibration.hidden = !c;
    if (!c) return;
    els.calibDot.dataset.at = c.phase === 'left' || c.phase === 'right' ? c.phase : 'center';
    els.calibText.textContent = CALIBRATION_TEXT[c.phase] ?? CALIBRATION_TEXT.center;
    els.calibCount.textContent = String(seconds);
  }

  function render(model) {
    renderCalibration(model.calibration);
    if (changed('screen-lost', model.faceLost)) els.screen.toggleAttribute('data-lost', model.faceLost);
    const eye = model.faceLost ? 'lost' : model.eyesClosed ? 'closed' : 'open';
    if (changed('eye', eye)) {
      els.eyeIcon.className = `icon icon--${{ lost: 'eye-off', closed: 'eye-closed', open: 'eye' }[eye]}`;
      els.eyeLabel.textContent = { lost: "Can't see you", closed: 'Eyes closed', open: 'I can see you' }[eye];
    }

    const cap = model.caption;
    if (changed('caption', `${cap.kind}|${cap.speaker ?? ''}|${cap.text ?? ''}`)) {
      els.caption.classList.toggle('caption--prompt', cap.kind === 'prompt');
      els.captionWaiting.hidden = cap.kind !== 'waiting';
      els.captionSpeaker.hidden = cap.kind !== 'question';
      els.captionText.hidden = cap.kind === 'waiting';
      els.captionSpeaker.textContent = cap.speaker ?? '';
      renderCaptionText(cap.text ?? '', cap.kind === 'question');
    }

    if (changed('stage', model.stage)) {
      els.caption.hidden = model.stage === 'spell';
      els.stageChoose.hidden = model.stage !== 'choose';
      els.stageSpeaking.hidden = model.stage !== 'speaking';
      els.stageSpell.hidden = model.stage !== 'spell';
      els.undoHint.hidden = model.stage !== 'speaking';
      fitNeeded = true;
    }
    if (model.stage === 'speaking' && changed('spoken', model.spoken)) els.spoken.textContent = model.spoken;
    if (model.stage === 'spell') renderSpell(model.spell);
    if (model.stage !== 'choose') return;

    if (changed('lost', model.faceLost)) els.roomMessage.hidden = !model.faceLost;
    renderRow(model);

    if (changed('cue', model.cue ?? '')) {
      els.cue.hidden = !model.cue;
      if (model.cue) {
        els.cue.dataset.dir = model.cue;
        els.cueLabel.textContent = model.cue === 'right' ? 'Looked right' : 'Looked left';
        els.cueIcon.className = `icon icon--arrow-${model.cue}`;
      }
    }
    if (changed('loading', model.loading)) els.loadingNote.hidden = !model.loading;
  }

  return { render };
}
