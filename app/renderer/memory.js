// What the app remembers between launches, stored on this machine only: the patient's profile (edited
// in the care panel), the conversation, and how often the patient picks each phrase. The profile and
// the phrases they pick most go to Claude, so suggestions get personal.

const KEY = 'blink2talk.memory';
const MAX_TURNS = 100;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function createMemory({ name }) {
  const saved = load();
  const m = {
    profile: { name, notes: '', ...saved.profile },
    history: Array.isArray(saved.history) ? saved.history : [], // { role: 'nurse' | 'patient', text, t, speaker?, voice? }
    picks: saved.picks ?? {},
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(m));
    } catch {
      // Storage unavailable: memory still works until the app closes.
    }
  };

  return {
    get profile() { return m.profile; },
    get history() { return m.history; },
    setProfile(patch) {
      Object.assign(m.profile, patch);
      save();
    },
    // speaker: who said a nurse-side line ("Dr. Lee"); voice: the voice model's id for them this launch.
    addTurn(role, text, { speaker, voice } = {}) {
      m.history.push({ role, text, t: Date.now(), ...(speaker && { speaker }), ...(voice && { voice }) });
      if (m.history.length > MAX_TURNS) m.history.splice(0, m.history.length - MAX_TURNS);
      save();
    },
    // Takes back the last turn if it was `role`: an undone reply (and the pick it counted), or speech
    // that wasn't meant for the patient.
    popTurn(role) {
      const last = m.history.at(-1);
      if (last?.role !== role) return;
      m.history.pop();
      if (role === 'patient' && m.picks[last.text] > 0) m.picks[last.text]--;
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
    clearHistory() {
      m.history = [];
      save();
    },
    // The conversation server's `history` and `patientProfile` fields.
    turns: () => m.history.map(({ role, text, speaker }) => (speaker ? { role, text, speaker } : { role, text })),
    forClaude() {
      const often = this.oftenSays();
      const notes = [m.profile.notes.trim(), often.length ? `Often says: ${often.join('; ')}` : ''].filter(Boolean).join('. ');
      return notes ? { name: m.profile.name, notes } : { name: m.profile.name };
    },
  };
}
