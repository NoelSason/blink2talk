import Anthropic from "@anthropic-ai/sdk";
import { isConsentQuestion, CONSENT_REPLIES } from "./safety.js";
import { mockComplete, mockReplies } from "./mock.js";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";
// Summaries run in the background, so they use the strongest model.
const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "claude-opus-5-5";
const SUMMARY_TIMEOUT_MS = 30000;
const client = new Anthropic(); // reads ANTHROPIC_API_KEY
// Past this the patient gets safe fallback options instead of waiting.
const REPLIES_TIMEOUT_MS = Number(process.env.REPLIES_TIMEOUT_MS ?? 3000);
const mock = () => process.env.MOCK_REPLIES === "1" || !process.env.ANTHROPIC_API_KEY;

export interface Turn {
  role: "nurse" | "patient";
  text: string;
  speaker?: string; // who said a nurse-side line, as last labeled ("Dr. Lee", "Your daughter")
}
// Which voice said the transcript, from the app's speaker-recognition model, and its label so far.
export interface VoiceInfo {
  voice?: string; // "voice-2": the same person keeps the same id for this session
  label?: string; // the label given to this voice before, if any
  isNew?: boolean; // first time this voice is heard
}
export type SpeakerRole = "nurse" | "doctor" | "family" | "visitor" | "staff" | "unknown";
export interface Speaker {
  label: string;
  role: SpeakerRole;
}
export interface PatientProfile {
  name?: string;
  notes?: string; // e.g. "ventilated, ICU bed 4, likes tea, wife Maria"
}
export interface RepliesInput {
  transcript: string;
  history?: Turn[];
  patientProfile?: PatientProfile;
  fatigue?: number; // 0..1, high = offer fewer, shorter options
  speaker?: VoiceInfo;
}

const SYSTEM = `You help a patient who cannot speak or use their hands reply to a nurse or family member. They select a reply with a deliberate blink, so every option must be a complete, natural first-person sentence the patient could say as-is.

Given what was just said to the patient, propose the most likely replies, in order of likelihood.

Rules:
- Output 3 or 4 replies, each under 8 words, written in the patient's voice ("I", "my"). No quotation marks.
- Make the options meaningfully different from each other: usually include a plain yes and a plain no when the question allows it, and one or two specific answers.
- Never invent medical facts, symptoms, or decisions the patient has not signaled. If the question is open-ended, offer short common needs (water, repositioning, family, rest) rather than guessing a diagnosis.
- Use the patient profile and recent conversation only to pick relevant specifics (names, preferences).
- If the patient seems fatigued, give 3 options and keep them very short.
- Set addressed_to_patient to false only when the speech is clearly meant for someone else (staff talking to each other, a phone call, "grab the chart from room 4"). Anything that could plausibly be for the patient, including greetings and statements about their care, counts as addressed. Still fill in replies either way.
- If the message is unintelligible, offer: "Please say that again", "I didn't understand", "Yes", "No".
- Also say who is speaking. A voice model tells voices apart (voice-1, voice-2, …) and gives the label used for this voice before, if any. Keep that label unless this message gives a better one (a name, a title, a relationship). speaker_label is what the patient would call them: "Dr. Lee", "Nurse Sam", "Your daughter", "Nurse", "Doctor", "Family". Use "Someone" only when there is no clue. speaker_role is nurse, doctor, family, visitor, staff, or unknown.`;

const REPLIES_SCHEMA = {
  type: "object",
  properties: {
    addressed_to_patient: { type: "boolean" },
    replies: { type: "array", items: { type: "string" } },
    speaker_label: { type: "string" },
    speaker_role: { type: "string", enum: ["nurse", "doctor", "family", "visitor", "staff", "unknown"] },
  },
  required: ["addressed_to_patient", "replies", "speaker_label", "speaker_role"],
  additionalProperties: false,
} as const;

const COMPLETE_SCHEMA = {
  type: "object",
  properties: { words: { type: "array", items: { type: "string" } } },
  required: ["words"],
  additionalProperties: false,
} as const;

function text(res: Anthropic.Message): string {
  for (const b of res.content) if (b.type === "text") return b.text;
  throw new Error(`no text block (stop_reason=${res.stop_reason})`);
}

const historyLines = (turns: Turn[]) =>
  turns.map((t) => `${t.role === "patient" ? "Patient" : t.speaker || "Caregiver"}: ${t.text}`).join("\n");

export async function getReplies(
  inp: RepliesInput,
): Promise<{ replies: string[]; source: string; addressed: boolean; speaker: Speaker | null }> {
  if (isConsentQuestion(inp.transcript)) return { replies: CONSENT_REPLIES, source: "consent-rule", addressed: true, speaker: null };
  if (mock()) return { replies: mockReplies(inp.transcript), source: "mock", addressed: true, speaker: null };

  const history = historyLines((inp.history ?? []).slice(-6));
  const v = inp.speaker;
  const voice = v?.voice ? `Voice: ${v.voice}${v.isNew ? " (first time heard)" : ""}${v.label ? `, labeled "${v.label}" before` : ""}` : "";
  const prompt = [
    inp.patientProfile ? `Patient profile: ${JSON.stringify(inp.patientProfile)}` : "",
    inp.fatigue !== undefined ? `Fatigue (0-1): ${inp.fatigue.toFixed(2)}` : "",
    history ? `Recent conversation:\n${history}` : "",
    voice,
    `Just said to the patient: "${inp.transcript}"`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: "low", format: { type: "json_schema", schema: REPLIES_SCHEMA } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  }, { timeout: REPLIES_TIMEOUT_MS, maxRetries: 0 });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  const parsed = JSON.parse(text(res)) as {
    addressed_to_patient: boolean;
    replies: string[];
    speaker_label: string;
    speaker_role: SpeakerRole;
  };
  const replies = parsed.replies.map((r) => r.trim()).filter(Boolean).slice(0, 4);
  if (replies.length === 0) throw new Error("empty replies");
  // Replies are kept even when not addressed, so "Reply anyway" is instant.
  const label = parsed.speaker_label?.trim();
  const speaker = label ? { label, role: parsed.speaker_role ?? "unknown" } : null;
  return { replies, source: MODEL, addressed: parsed.addressed_to_patient !== false, speaker };
}

const SUMMARY_SYSTEM = `You summarize a conversation in an ICU room. The patient cannot speak; they answer by choosing one of a few suggested replies with their eyes, and the app speaks it for them. Each line is labeled with who said it.

Return:
- for_patient: at most 3 short sentences, under 45 words in all, written to the patient ("you"), in plain words: the most important things people told them, and what the patient said or asked for. Calm and factual.
- for_caregiver: 2 to 5 short bullet points for a nurse or family member arriving now: who said what that matters, what the patient asked for or answered, and anything still open.

Never add facts, symptoms, or plans that are not in the conversation. Use the speakers' labels as given. Don't guess anyone's gender: use their label or "they".`;

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    for_patient: { type: "string" },
    for_caregiver: { type: "array", items: { type: "string" } },
  },
  required: ["for_patient", "for_caregiver"],
  additionalProperties: false,
} as const;

export interface Summary {
  forPatient: string;
  forCaregiver: string[];
  source: string;
}

// null in mock mode (no API key): the app writes a plain summary itself.
export async function summarize(inp: { history: Turn[]; patientProfile?: PatientProfile }): Promise<Summary | null> {
  if (mock()) return null;
  const prompt = [
    inp.patientProfile ? `Patient profile: ${JSON.stringify(inp.patientProfile)}` : "",
    `Conversation, oldest first:\n${historyLines(inp.history.slice(-40))}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 2048,
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  }, { timeout: SUMMARY_TIMEOUT_MS, maxRetries: 1 });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  const parsed = JSON.parse(text(res)) as { for_patient: string; for_caregiver: string[] };
  return {
    forPatient: parsed.for_patient.trim(),
    forCaregiver: parsed.for_caregiver.map((b) => b.trim()).filter(Boolean).slice(0, 5),
    source: SUMMARY_MODEL,
  };
}

export async function completeWord(inp: {
  prefix: string;
  sentenceSoFar?: string;
  context?: string;
}): Promise<string[]> {
  if (mock()) return mockComplete(inp.prefix);
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    output_config: { effort: "low", format: { type: "json_schema", schema: COMPLETE_SCHEMA } },
    system:
      "A patient is spelling a message letter by letter with their eyes. Given the letters typed so far for the current word, the sentence so far, and what they were last asked, return the 4 most likely whole words, most likely first. Every word must start with the given prefix (case-insensitive). Lowercase unless it is a proper noun.",
    messages: [
      {
        role: "user",
        content: `Last asked: ${inp.context ?? "(unknown)"}\nSentence so far: ${inp.sentenceSoFar ?? ""}\nPrefix: ${inp.prefix}`,
      },
    ],
  }, { timeout: REPLIES_TIMEOUT_MS, maxRetries: 0 });
  const parsed = JSON.parse(text(res)) as { words: string[] };
  const p = inp.prefix.toLowerCase();
  return parsed.words.filter((w) => w.toLowerCase().startsWith(p)).slice(0, 4);
}
