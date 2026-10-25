// Care panel: the drawer behind the small corner button, for the nurse or family. Alerts, a summary
// of the conversation, the conversation with who said each line, what the
// app knows about the patient, and a few settings. It never
// opens on its own, because the patient screen belongs to the patient; urgent picks badge the button
// and send a desktop notification instead.

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function createCarePanel({ memory, onAction }) {
  const panel = document.getElementById('care');
  const opener = document.querySelector('.care-button');
  let alerts = []; // { text, t }
  let state = { tired: false, faceLost: false, mic: 'off', light: false };

  const section = (title, ...children) => el('section', { className: 'care__section' }, el('h3', { className: 'care__heading', textContent: title }), ...children);
  const toggle = (text, action) => {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => onAction(action, input.checked));
    return { input, row: el('label', { className: 'care__toggle' }, input, el('span', { textContent: text })) };
  };
  const button = (text, action, extra = '') => {
    const b = el('button', { type: 'button', className: `care__button ${extra}`.trim(), textContent: text });
    b.addEventListener('click', () => onAction(action));
    return b;
  };

  const title = el('h2', { className: 'care__title' });
  const close = el('button', { type: 'button', className: 'care__button', textContent: 'Close' });
  close.addEventListener('click', () => api.close());
  const alertList = el('div', { className: 'care__alerts' });
  const history = el('ol', { className: 'care__history' });
  const summaryList = el('ul', { className: 'care__summary' });
  const summaryNote = el('p', { className: 'care__note', textContent: 'Appears after the first exchange.' });
  const often = el('p', { className: 'care__note' });

  const name = el('input', { type: 'text', className: 'care__input', value: memory.profile.name });
  const notes = el('textarea', {
    className: 'care__input care__notes',
    rows: 4,
    value: memory.profile.notes,
    placeholder: 'Family names, likes and dislikes, what hurts. The suggestions use this.',
  });
  let saveTimer = 0;
  const saveProfile = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => onAction('profile', { name: name.value.trim() || memory.profile.name, notes: notes.value }), 400);
  };
  name.addEventListener('input', saveProfile);
  notes.addEventListener('input', saveProfile);

  const tired = toggle('Tired mode: 2 replies, larger text', 'tired');
  const mic = toggle('Listen for the nurse', 'mic');
  const light = toggle('Light theme', 'theme');
  const micNote = el('p', { className: 'care__note' });
  const local = toggle('Fast replies on this laptop (testing only)', 'local-replies');
  const localNote = el('p', { className: 'care__note' });

  panel.append(
    el('header', { className: 'care__head' }, el('div', {}, title, el('p', { className: 'care__note', textContent: 'Care panel' })), close),
    alertList,
    section('Summary', summaryList, summaryNote, button('Refresh summary', 'summary', 'care__button--quiet')),
    section('Conversation', history, button('Clear conversation', 'clear-history', 'care__button--quiet')),
    section('About the patient',
      el('label', { className: 'care__field' }, el('span', { textContent: 'Name' }), name),
      el('label', { className: 'care__field' }, el('span', { textContent: 'Notes' }), notes),
      often),
    section('Settings', tired.row, mic.row, micNote, light.row, local.row, localNote, button('Calibrate eyes again', 'calibrate')),
  );

  function renderAlerts() {
    const who = memory.profile.name;
    const banners = alerts.map((a, i) => {
      const done = el('button', { type: 'button', className: 'care__button', textContent: 'Got it' });
      done.addEventListener('click', () => {
        alerts.splice(i, 1);
        renderAlerts();
      });
      return el('div', { className: 'care-alert care-alert--strong', role: 'alert' },
        el('p', { textContent: `${who} said “${a.text}”` }), el('p', { className: 'care__note', textContent: clock(a.t) }), done);
    });
    if (state.faceLost) banners.push(el('div', { className: 'care-alert' }, el('p', { textContent: `Can't see ${who}'s face. Check that the laptop faces them.` })));
    if (state.tired) banners.push(el('div', { className: 'care-alert' }, el('p', { textContent: `${who} seems tired. Replies are simplified.` })));
    alertList.replaceChildren(...banners);
    opener.classList.toggle('care-button--alert', alerts.length > 0);
  }

  function renderHistory() {
    const who = memory.profile.name;
    const turns = memory.history.slice(-30).reverse();
    history.replaceChildren(...(turns.length ? turns.map((turn) => el('li', {},
      el('span', { className: 'care__note', textContent: `${clock(turn.t)} · ${turn.role === 'nurse' ? turn.speaker ?? 'Someone' : who}` }),
      el('span', { textContent: turn.text }))) : [el('li', { className: 'care__note', textContent: 'Nothing yet.' })]));
    const said = memory.oftenSays();
    often.textContent = said.length ? `Often says: ${said.join(' · ')}` : '';
  }

  const api = {
    get isOpen() { return panel.dataset.open === 'true'; },
    open() {
      title.textContent = memory.profile.name;
      renderAlerts();
      renderHistory();
      panel.hidden = false;
      requestAnimationFrame(() => { panel.dataset.open = 'true'; });
    },
    close() {
      panel.dataset.open = 'false';
      document.activeElement?.blur();
    },
    toggle() { (api.isOpen ? api.close : api.open)(); },
    alert(text) {
      alerts.unshift({ text, t: Date.now() });
      renderAlerts();
    },
    update(next) {
      state = { ...state, ...next };
      tired.input.checked = state.tired;
      mic.input.checked = state.mic === 'on';
      mic.input.disabled = state.mic === 'unavailable';
      micNote.textContent = state.mic === 'unavailable' ? 'The microphone needs the conversation server and its speech key.' : '';
      local.input.checked = !!state.local;
      local.input.disabled = !state.localAvailable;
      localNote.textContent = !state.localAvailable ? 'For testing only. Not set up on this laptop.'
        : 'For testing only. Suggestions come faster but are less accurate. Not for use with patients.';
      light.input.checked = state.light;
      renderAlerts();
    },
    conversationChanged() {
      if (api.isOpen) renderHistory();
    },
    // summary: { forCaregiver: string[], source, t } or null
    summaryChanged(summary) {
      summaryList.replaceChildren(...(summary?.forCaregiver ?? []).map((line) => el('li', { textContent: line })));
      summaryNote.textContent = !summary ? 'Appears after the first exchange.'
        : `Updated ${clock(summary.t)}${summary.source === 'plain' ? ' · the last few lines (summaries need the conversation server)' : ''}`;
    },
  };
  opener.addEventListener('click', () => {
    opener.blur(); // Space is the eyes-closed stand-in; it must not press a focused button.
    api.toggle();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && api.isOpen) api.close();
  });
  return api;
}
