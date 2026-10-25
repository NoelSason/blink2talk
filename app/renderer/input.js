// Patient input. The eye tracker reports two things: which way the patient looked, and whether
// their eyes are open or closed. Long blinks and double blinks are worked out in app.js from the
// open/closed timing, so a tracker only has to send these raw events.
//
// Until the tracker is wired in, the keyboard stands in (same keys as the Figma prototype):
//   Arrow keys           look at the next box in that direction
//   Space (hold)         eyes closed while held; hold about 1 s for a long blink
//   Space, Space         double blink
//
// A tracker in this page can send the same events:
//   window.dispatchEvent(new CustomEvent('patient-input', { detail: { type: 'look', dir: 'right' } }))
//   window.dispatchEvent(new CustomEvent('patient-input', { detail: { type: 'eyes', closed: true } }))

// Typing in the demo panel's text box isn't patient input or a shortcut.
const typing = (event) => (event.target instanceof HTMLInputElement && event.target.type === 'text') || event.target instanceof HTMLTextAreaElement;

export function onPatientInput(handler) {
  window.addEventListener('patient-input', (event) => handler(event.detail));

  window.addEventListener('keydown', (event) => {
    if (typing(event)) return;
    const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.code];
    if (dir) {
      event.preventDefault();
      if (!event.repeat) handler({ type: 'look', dir });
    } else if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) handler({ type: 'eyes', closed: true });
    }
  });
  window.addEventListener('keyup', (event) => {
    if (typing(event)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      handler({ type: 'eyes', closed: false });
    }
  });
}

// Operator shortcuts for the demo. Patients never use these.
const DEMO_KEYS = {
  KeyD: 'panel',         // show or hide the demo controls
  KeyQ: 'next-question', // play the next sample question
  KeyR: 'listen',        // back to Listening
  KeyT: 'tired',         // tired mode on or off
  KeyF: 'face',          // pretend the app lost the patient's face
  KeyL: 'theme',         // dark or light
  KeyC: 'calibrate',     // recalibrate the camera eye tracker
  KeyK: 'drift-check',   // 8 s drift check: center and two corners, shifts the boxes back
  KeyN: 'care',          // open or close the care panel
  KeyM: 'mic',           // nurse microphone on or off
  KeyG: 'gaze-source',   // swap which eye tracker drives the boxes: vision module / WebEyeTrack
};
export function onDemoKey(handler) {
  window.addEventListener('keydown', (event) => {
    if (typing(event) || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const action = DEMO_KEYS[event.code];
    if (action) handler(action);
  });
}
