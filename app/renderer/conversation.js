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

// body: { transcript, history, patientProfile, fatigue }. `addressed: false` means Claude judged the
// speech wasn't meant for the patient (staff talking to each other); the replies are kept for "Reply anyway".
export async function getReplies(body) {
  if (call) {
    try {
      const d = await call('replies', body);
      return { replies: checkReplies(d.replies), urgent: d.urgent ?? FALLBACK_URGENT, addressed: d.addressed !== false, source: d.source };
    } catch {}
  }
  const sample = QUESTIONS.find((q) => q.text === body.transcript);
  return { replies: sample?.replySets[0] ?? ['Yes', 'No', "I'm not sure"], urgent: FALLBACK_URGENT, addressed: true, source: 'sample' };
}

// Whole-word suggestions for Spell it. body: { prefix, sentenceSoFar, context }
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
    voiceCache.set(text, call('speak', { text }).catch(() => null));
    if (voiceCache.size > MAX_CACHED) voiceCache.delete(voiceCache.keys().next().value);
  }
  return voiceCache.get(text);
}

export function prefetchVoice(texts) {
  for (const text of texts) if (text) voiceAudio(text);
}
