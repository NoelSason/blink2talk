// Client for the conversation server (../conversation): Claude replies, word completion, the patient's
// voice, and the nurse's speech-to-text. When the server isn't reachable, sample data keeps the screen working.

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

// body: { transcript, history, patientProfile, fatigue }
export async function getReplies(body) {
  if (call) {
    try {
      const d = await call('replies', body);
      return { replies: d.replies.slice(0, 4), urgent: d.urgent ?? FALLBACK_URGENT, source: d.source };
    } catch {}
  }
  const sample = QUESTIONS.find((q) => q.text === body.transcript);
  return { replies: sample?.replySets[0] ?? ['Yes', 'No', "I'm not sure"], urgent: FALLBACK_URGENT, source: 'sample' };
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

// Text of one WAV clip of the nurse speaking, or null when it can't be transcribed.
export async function transcribe(wav) {
  if (!call) return null;
  try {
    return (await call('transcribe', wav))?.text ?? null;
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
