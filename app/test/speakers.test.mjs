// Unit tests for the voice matching in speakers.js, on synthetic voice prints: `npm test` (node --test).
// The model itself isn't loaded here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { matchVoice } = createRequire(import.meta.url)('../speakers.js');

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const voiceA = Array.from({ length: 192 }, rand);
const voiceB = Array.from({ length: 192 }, rand);
// Another turn by the same person: their print plus some noise (cosine ~0.85 to the clean print).
const turnOf = (v) => v.map((x) => x + 0.35 * rand());

test('the same voice keeps its id; a different voice gets a new one', () => {
  const voices = [];
  const a1 = matchVoice(voices, turnOf(voiceA), 3);
  const b1 = matchVoice(voices, turnOf(voiceB), 3);
  const a2 = matchVoice(voices, turnOf(voiceA), 2.5);
  assert.equal(a1.isNew, true);
  assert.equal(b1.isNew, true);
  assert.notEqual(a1.voice, b1.voice);
  assert.equal(a2.voice, a1.voice);
  assert.equal(a2.isNew, false);
  assert.equal(voices.length, 2);
});

test('a short turn never starts a new voice', () => {
  const voices = [];
  matchVoice(voices, turnOf(voiceA), 3);
  assert.equal(matchVoice(voices, turnOf(voiceB), 0.6), null);
  assert.equal(voices.length, 1);
  assert.equal(matchVoice(voices, voiceA, 0.6)?.voice, 'voice-1');
});

test("a voice's print steadies over its turns", () => {
  const voices = [];
  for (let i = 0; i < 8; i++) matchVoice(voices, turnOf(voiceA), 3);
  assert.equal(voices.length, 1);
  assert.equal(voices[0].n, 8);
  const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0) / Math.hypot(...a) / Math.hypot(...b);
  assert.ok(cos(voices[0].print, voiceA) > 0.95, 'the running mean is closer to the clean print than any one turn');
});
