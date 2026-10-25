// Demo controls: a plain operator panel for the team, from the brief. Hidden until D is pressed;
// patients never see it. Every control here also has a key, so the panel can stay closed while recording.

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

export function createDemoPanel({ questions, onAction }) {
  const panel = document.getElementById('demo');

  const button = (text, key, action, arg) => {
    const b = el('button', { type: 'button' }, el('span', { textContent: text }));
    if (key) b.append(el('kbd', { textContent: key }));
    b.addEventListener('click', () => {
      b.blur(); // Space is the eyes-closed stand-in; it must not press a focused button.
      onAction(action, arg);
    });
    return b;
  };
  const toggle = (text, key, action) => {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => {
      input.blur();
      onAction(action, input.checked);
    });
    return { input, row: el('label', {}, input, el('span', { textContent: text }), el('kbd', { textContent: key })) };
  };
  const section = (title, ...rows) => el('section', { className: 'demo__section' }, el('h2', { className: 'demo__heading', textContent: title }), ...rows);

  // For when the microphone is off or the room is too loud.
  const said = el('input', { type: 'text', className: 'demo__input', placeholder: 'Type what the nurse says, then Enter' });
  const send = el('button', { type: 'button', textContent: 'Send' });
  const submit = () => {
    if (!said.value.trim()) return;
    onAction('say', said.value.trim());
    said.value = '';
    said.blur();
  };
  said.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
    if (event.key === 'Escape') said.blur();
  });
  send.addEventListener('click', submit);

  const tired = toggle('Tired mode', 'T', 'tired');
  const face = toggle("Can't see the face", 'F', 'face');
  const light = toggle('Light theme', 'L', 'theme');
  const status = {
    replies: el('span', { textContent: 'Replies: checking…' }),
    voice: el('span', { textContent: 'Voice: checking…' }),
    eyes: el('span', { textContent: 'Eyes: starting the camera…' }),
    mic: el('span', { textContent: 'Mic: starting…' }),
  };

  panel.append(
    el('div', { className: 'demo__head' },
      el('span', { className: 'demo__title', textContent: 'Demo controls' }),
      el('span', { className: 'demo__note', textContent: 'D hides this' })),
    section('Conversation',
      el('div', { className: 'demo__pair' }, said, send),
      ...questions.map((q, i) => button(`Ask: ${q.text}`, i === 0 ? 'Q' : '', 'question', i)),
      button('Back to listening', 'R', 'listen')),
    section('Patient', tired.row, face.row,
      button('Calibrate eyes', 'C', 'calibrate')),
    section('Display', light.row),
    section('Sources',
      status.replies,
      status.voice,
      status.mic,
      status.eyes,
      el('span', { textContent: 'Keyboard also works: arrows, hold Space' })),
  );

  return {
    toggle() { panel.hidden = !panel.hidden; },
    sync(flags) {
      tired.input.checked = flags.tired;
      face.input.checked = flags.faceLost;
      light.input.checked = flags.light;
    },
    setEyes(text) { status.eyes.textContent = text; },
    setMic(text) { status.mic.textContent = text; },
    // config comes from the conversation server's /config, or null when it isn't running.
    setStatus(config) {
      status.replies.textContent = !config ? 'Replies: sample (conversation server not running)'
        : config.mockReplies ? 'Replies: server mock (no Anthropic key)' : 'Replies: Claude';
      status.voice.textContent = !config || config.mockVoice ? 'Voice: system voice (no Cartesia key)'
        : config.clonedVoice ? "Voice: patient's own voice" : 'Voice: Cartesia default voice';
    },
  };
}
