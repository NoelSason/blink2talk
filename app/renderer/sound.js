// Selection chime and spoken replies.

let audio = null;

// Soft chimes. The patient's eyes are closed when they select, so sound is their confirmation.
// 'select' rises, 'undo' falls, and 'tick' is one quiet note for each pick in Spell it.
const CHIMES = {
  select: [[659.25, 0], [880, 0.14]],
  undo: [[880, 0], [587.33, 0.14]],
  tick: [[784, 0]],
  alert: [[987.77, 0], [987.77, 0.2], [1318.5, 0.4]], // urgent pick, for the people in the room
};
export function chime(kind = 'select') {
  audio ??= new AudioContext();
  const start = audio.currentTime;
  const notes = CHIMES[kind];
  for (const [freq, delay] of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start + delay);
    gain.gain.linearRampToValueAtTime(0.18, start + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.6);
    osc.connect(gain).connect(audio.destination);
    osc.start(start + delay);
    osc.stop(start + delay + 0.65);
  }
}

// Until the patient's own voice is wired in, use the clearest installed English voice:
// a Premium or Enhanced voice if one is downloaded, then Samantha, then the system default.
let voice = null;
function rankVoice(v) {
  if (/Premium/i.test(v.name)) return 3;
  if (/Enhanced/i.test(v.name)) return 2;
  if (/^Samantha/i.test(v.name)) return 1;
  return 0;
}
function pickVoice() {
  const english = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
  const best = english
    .filter((v) => rankVoice(v) > 0)
    .sort((a, b) => rankVoice(b) - rankVoice(a) || Number(b.lang === 'en-US') - Number(a.lang === 'en-US'))[0];
  voice = best ?? null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener('voiceschanged', pickVoice);
}

let playing = null;

function playWav(bytes) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    playing = new Audio(url);
    const done = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    playing.onended = done;
    playing.onerror = done;
    playing.onpause = done;
    playing.play().catch(done);
  });
}

function systemVoice(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.rate = 0.92;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    speechSynthesis.speak(utterance);
  });
}

// Speaks in the patient's own voice when the conversation server has one (getAudio returns WAV
// bytes), otherwise with the system voice. Resolves when speech ends, or after a fallback delay
// if the platform never reports an end.
export async function speak(text, getAudio) {
  const fallbackMs = Math.max(2500, text.split(/\s+/).length * 450);
  const bytes = getAudio ? await getAudio(text) : null;
  const spoken = bytes ? playWav(bytes) : systemVoice(text);
  return Promise.race([spoken, new Promise((resolve) => setTimeout(resolve, fallbackMs + (bytes ? 4000 : 0)))]);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (playing) {
    playing.pause();
    playing = null;
  }
}
