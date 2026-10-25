// What the app remembers between launches: the patient's profile (edited in the care panel), the
// conversation, how often the patient picks each phrase, and what they asked for on their own
// ("I want to say something"). All of it goes to Claude, so suggestions get personal.
//
// In the app it lives in patient_memory.json at the repo root (written by the main process,
// patient-memory.js); for now everyone using the app on this computer is one patient. Without the
// app's preload (tests, a plain browser) it stays in this page's localStorage.

const KEY = 'blink2talk.memory';
// Claude gets the last VERBATIM turns word for word, each with its time. Older ones are folded, BATCH at
// a time, into `earlier`: a short list of lasting facts (the conversation server's /condense). If that
// keeps failing, the oldest go past HARD_CAP anyway, so the file stays small.
const VERBATIM = 100;
const BATCH = 20;
const HARD_CAP = 300;

// When a line was said, in the patient's local time: "Sat, Oct 24, 22:41".
export const timeLabel = (t) =>
  new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const file = window.blink2talk?.memory;

function parse(text) {
  try {
    const saved = JSON.parse(text ?? 'null');
    return saved && typeof saved === 'object' ? saved : null;
  } catch {
    return null;
  }
}

// The file first. Before the file existed, memory was kept in localStorage: picked up once from there.
// inFile: false when the file has to be written (the first launch, or memory moving over).
function load() {
  let fromFile = null;
  try {
    fromFile = file ? parse(file.load()) : null;
  } catch {}
  if (fromFile) return { saved: fromFile, inFile: true };
  try {
    return { saved: parse(localStorage.getItem(KEY)) ?? {}, inFile: !file };
  } catch {
    return { saved: {}, inFile: !file };
  }
}

export function createMemory({ name }) {
  const { saved, inFile } = load();
  const m = {
    profile: { name, notes: '', ...saved.profile },
    history: Array.isArray(saved.history) ? saved.history : [], // { role: 'nurse' | 'patient', text, t, speaker?, voice? }
    picks: saved.picks ?? {},
    requests: saved.requests ?? {}, // text -> { n, last, cat }: what the patient started, not answers to a question
    earlier: saved.earlier ?? { text: '', through: 0 }, // condensed turns from before `history`; through: the last one's time
  };
  const save = () => {
    try {
      if (file) file.save(JSON.stringify(m, null, 2)); // readable: one patient's file
      else localStorage.setItem(KEY, JSON.stringify(m));
    } catch {
      // Storage unavailable: memory still works until the app closes.
    }
  };

  if (!inFile) save();

  return {
    get profile() { return m.profile; },
    get history() { return m.history; },
    setProfile(patch) {
      Object.assign(m.profile, patch);
      save();
    },
    // speaker: who said a nurse-side line ("Dr. Lee"); voice: the voice model's id for them this launch.
    // request: the patient started this line; its category ('need' | 'say'), so it counts toward pastRequests.
    addTurn(role, text, { speaker, voice, request } = {}) {
      m.history.push({ role, text, t: Date.now(), ...(speaker && { speaker }), ...(voice && { voice }), ...(request && { request }) });
      if (request) m.requests[text] = { n: (m.requests[text]?.n ?? 0) + 1, last: Date.now(), cat: request };
      if (m.history.length > HARD_CAP) m.history.splice(0, m.history.length - HARD_CAP);
      save();
    },
    // Takes back the last turn if it was `role`: an undone reply (and the pick it counted), or speech
    // that wasn't meant for the patient.
    popTurn(role) {
      const last = m.history.at(-1);
      if (last?.role !== role) return;
      m.history.pop();
      if (role === 'patient' && m.picks[last.text] > 0) m.picks[last.text]--;
      if (last.request && m.requests[last.text]) {
        if (--m.requests[last.text].n <= 0) delete m.requests[last.text];
      }
      save();
    },
    // Claude named a voice: relabel this launch's lines from that voice, or just the last line.
    relabel(speaker, voice) {
      const lines = voice ? m.history.filter((h) => h.voice === voice) : m.history.slice(-1);
      for (const h of lines) if (h.role === 'nurse') h.speaker = speaker;
      save();
    },
    picked(text) {
      m.picks[text] = (m.picks[text] ?? 0) + 1;
      save();
    },
    oftenSays(n = 5) {
      return Object.entries(m.picks).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([text]) => text);
    },
    // What the patient asked for before, most likely first: how often, halved for each day since the
    // last time. { text, n, agoMin, cat } for the conversation server's /starters.
    pastRequests(n = 8) {
      const at = Date.now();
      const score = ({ n: count, last }) => count / (1 + (at - last) / 86400000);
      return Object.entries(m.requests)
        .sort((a, b) => score(b[1]) - score(a[1]))
        .slice(0, n)
        .map(([text, r]) => ({ text, n: r.n, agoMin: Math.round((at - r.last) / 60000), ...(typeof r.cat === 'string' && { cat: r.cat }) }));
    },
    clearHistory() {
      m.history = [];
      m.earlier = { text: '', through: 0 };
      save();
    },
    // The conversation server's `history` (with each line's time) and `earlier` fields.
    turns: () => m.history.map(({ role, text, speaker, t }) => ({ role, text, ...(speaker && { speaker }), at: timeLabel(t) })),
    earlier: () => m.earlier,
    // The oldest BATCH turns once there are more than VERBATIM + BATCH - 1; null until then.
    toCondense() {
      return m.history.length >= VERBATIM + BATCH ? m.history.slice(0, BATCH) : null;
    },
    // Claude folded `batch` into `text`: drop those turns, if the history still starts with them.
    condensed(text, batch) {
      if (!batch.length || batch.some((b, i) => m.history[i]?.t !== b.t || m.history[i]?.text !== b.text)) return false;
      m.history.splice(0, batch.length);
      m.earlier = { text: String(text).trim(), through: batch.at(-1).t };
      save();
      return true;
    },
    forClaude() {
      const often = this.oftenSays();
      const asks = this.pastRequests(5).map((r) => r.text);
      const notes = [
        m.profile.notes.trim(),
        often.length ? `Often says: ${often.join('; ')}` : '',
        asks.length ? `Often asks for: ${asks.join('; ')}` : '',
      ].filter(Boolean).join('. ');
      return notes ? { name: m.profile.name, notes } : { name: m.profile.name };
    },
  };
}
