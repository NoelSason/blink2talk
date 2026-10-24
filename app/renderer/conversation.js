// Client for the conversation server (../conversation): Claude replies, word completion, and the
// patient's voice. When the server isn't reachable, sample data keeps the screen working.

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

// body: { transcript, history, patientProfile, fatigue }. `attempt` counts "None of these" for samples.
export async function getReplies(body, attempt = 0) {
  if (call) {
    try {
      const d = await call('replies', body);
      return { replies: d.replies.slice(0, 4), urgent: d.urgent ?? FALLBACK_URGENT, source: d.source };
    } catch {}
  }
  const sample = QUESTIONS.find((q) => q.text === body.transcript);
  const replies = sample
    ? sample.replySets[attempt % sample.replySets.length]
    : ['Yes', 'No', "I'm not sure", 'Please say that again'];
  return { replies, urgent: FALLBACK_URGENT, source: 'sample' };
}

// Whole-word suggestions for Spell it. body: { prefix, sentenceSoFar, context }.
export async function completeWord(body) {
  if (!call || !body.prefix) return [];
  try {
    return (await call('complete', body)).words.slice(0, 4);
  } catch {
    return [];
  }
}

// WAV bytes in the patient's voice, or null when the server has no voice service.
export async function voiceAudio(text) {
  if (!call) return null;
  try {
    return await call('speak', { text });
  } catch {
    return null;
  }
}
