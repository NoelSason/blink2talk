// Client for the conversation server (../conversation): Claude replies, word completion, the patient's
// voice, and a token for the nurse mic. When the server isn't reachable, sample data keeps the screen working.

import { QUESTIONS } from './samples.js';

const call = window.blink2talk?.conversation;

// Same as conversation/src/safety.ts: hard-coded, never model-generated.
export const FALLBACK_URGENT = ["I'm in pain", "I can't breathe", 'Call the nurse'];

export async function getConfig() {
  if (!call) return null;
  try {
    return await call('config');
  } catch {
    return null;
  }
}

// The server asks Claude for short first-person replies; this checks before anything becomes selectable.
// Long, empty, or repeated replies are dropped, and if none are left the patient gets safe basics.
const SAFE_REPLIES = ['Yes', 'No', 'Please say that again'];
function checkReplies(replies) {
  const seen = new Set();
  const ok = (Array.isArray(replies) ? replies : []).map((r) => String(r).trim()).filter((r) => {
    const key = r.toLowerCase();
    if (!r || r.length > 80 || r.split(/\s+/).length > 10 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return ok.length ? ok.slice(0, 4) : SAFE_REPLIES;
}

// body: { transcript, history, patientProfile, fatigue, speaker }. `addressed: false` means Claude judged
// the speech wasn't meant for the patient (staff talking to each other); the replies are kept for "Reply
// anyway". `speaker` is Claude's { label, role } for who said it ("Dr. Lee", doctor), or null.
export async function getReplies(body) {
  if (call) {
    try {
      const d = await call('replies', body);
      const label = typeof d.speaker?.label === 'string' ? d.speaker.label.trim().slice(0, 40) : '';
      return {
        replies: checkReplies(d.replies),
        urgent: d.urgent ?? FALLBACK_URGENT,
        addressed: d.addressed !== false,
        source: d.source,
        speaker: label ? { label, role: d.speaker.role ?? 'unknown' } : null,
        // A yes or no makes a medical decision; `about` is what a yes agrees to ("more pain medication").
        highStakes: d.highStakes === true,
        about: typeof d.about === 'string' && d.about.trim() ? d.about.trim().slice(0, 80) : null,
      };
    } catch {}
  }
  const sample = QUESTIONS.find((q) => q.text === body.transcript);
  // Without the server: the sample's next reply set for each "None of these" (body.round).
  const set = sample?.replySets[Math.min(body.round ?? 0, sample.replySets.length - 1)];
  return { replies: set ?? ['Yes', 'No', "I'm not sure"], urgent: FALLBACK_URGENT, addressed: true, source: 'sample', speaker: null, highStakes: false, about: null };
}

// Which voice said a nurse-mic turn (the speaker-recognition model in the main process):
// { voice: 'voice-2', similarity, isNew }, or null without the model or for a very short turn.
export async function identifySpeaker(audio) {
  if (!audio || !window.blink2talk?.speaker) return null;
  try {
    return await window.blink2talk.speaker(audio);
  } catch {
    return null;
  }
}

// A summary of the conversation: { forPatient: string, forCaregiver: string[] }, or null when the
// server has no model or isn't running (the app then writes a plain one).
// body: { history: [{ role, text, speaker }], patientProfile }
export async function getSummary(body) {
  if (!call) return null;
  try {
    const d = await call('summary', body);
    if (typeof d?.forPatient !== 'string' || !Array.isArray(d.forCaregiver)) return null;
    return { forPatient: d.forPatient, forCaregiver: d.forCaregiver.map(String), source: d.source };
  } catch {
    return null;
  }
}

// Testing only: loads the small on-laptop model in the server, so the first local reply isn't slow.
export function warmLocalModel() {
  call?.('local-warm', {}).catch(() => {});
}

// Whole-word suggestions for Spell it. body: { prefix, sentenceSoFar, context, local }
export async function completeWord(body) {
  if (!call || !body.prefix) return [];
  try {
    return (await call('complete', body)).words.slice(0, 4);
  } catch {
    return [];
  }
}

// A short-lived, speech-to-text-only Cartesia token for the nurse mic, or null without a Cartesia key.
export async function sttToken() {
  if (!call) return null;
  try {
    return (await call('stt-token'))?.token ?? null;
  } catch {
    return null;
  }
}

// The patient's voice. Audio is generated as soon as replies are on screen (prefetchVoice), so the
// chosen one plays without the ~3 s wait. Each entry is a promise of WAV bytes, or null when the
// server has no voice service.
const voiceCache = new Map();
const MAX_CACHED = 40;

export function voiceAudio(text) {
  if (!call) return Promise.resolve(null);
  if (!voiceCache.has(text)) {
    // A failed fetch (slow network, the server busy) isn't kept: the next ask tries again, so a
    // phrase never sticks to the system voice for the rest of the session.
    const audio = call('speak', { text }).catch(() => null).then((bytes) => {
      if (!bytes && voiceCache.get(text) === audio) voiceCache.delete(text);
      return bytes;
    });
    voiceCache.set(text, audio);
    if (voiceCache.size > MAX_CACHED) voiceCache.delete(voiceCache.keys().next().value);
  }
  return voiceCache.get(text);
}

export function prefetchVoice(texts) {
  for (const text of texts) if (text) voiceAudio(text);
}
