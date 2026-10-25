import Anthropic from "@anthropic-ai/sdk";
import { isConsentQuestion, CONSENT_REPLIES } from "./safety.js";
import { mockComplete, mockReplies } from "./mock.js";
import { localList, localModelAvailable } from "./local.js";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";
// Summaries run in the background, so they use the strongest model.
const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "claude-opus-5-5";
const SUMMARY_TIMEOUT_MS = 30000;
const client = new Anthropic(); // reads ANTHROPIC_API_KEY
// Past this the patient gets safe fallback options instead of waiting.
// 5 s default: Haiku took 1.5-3.5 s under load and 3 s sent too many patients to the fallback. .env can raise it.
const REPLIES_TIMEOUT_MS = Number(process.env.REPLIES_TIMEOUT_MS ?? 5000);
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
  local?: boolean; // testing only: answer with the small on-laptop model (local.ts)
  rejected?: string[]; // replies the patient already said "none of these" to
  category?: Category; // second "none": patient picked a topic
}

export const CATEGORIES = ["pain", "comfort", "people", "question"] as const;
export type Category = (typeof CATEGORIES)[number];
const CATEGORY_HINT: Record<Category, string> = {
  pain: "pain: where it hurts, how bad, wanting pain relief",
  comfort: "body and comfort: position, temperature, thirst, toilet, tube, sleep",
  people: "people: family, friends, a specific person, wanting company or privacy",
  question: "a question the patient wants to ask: what is happening, when, how long",
};

export interface Option {
  text: string;
  intent: string;
}
const CONSENT_INTENTS = ["yes", "no", "more-time"];
const consentOptions = (): Option[] => CONSENT_REPLIES.map((text, i) => ({ text, intent: CONSENT_INTENTS[i] ?? "other" }));

export const SYSTEM = `You help a patient who cannot speak or use their hands reply to a nurse or family member. They select a reply with a deliberate blink, so every option must be a complete, natural first-person sentence the patient could say as-is.

Given what was just said to the patient, propose the most likely replies, in order of likelihood.

Rules:
- Output exactly 3 replies, each 8 words or fewer, written in the patient's voice ("I", "my"). No quotation marks. The screen adds "None of these" itself; never output it.
- Give each reply a short intent label (e.g. "yes", "no", "water", "reposition", "family", "ask-time"). The three intents must all be different: usually a plain yes, a plain no, and one specific answer when the question allows it.
- If rejected replies are listed, the patient said none of them fit. Stay on what was asked, but give three different answers to it: more specific, partial, conditional, or a question back about it (for "Are you thirsty?" after yes/no/water were rejected: "Just ice chips", "Only a small sip", "Maybe in a little while"). Do not repeat or reword a rejected reply. Do not switch to an unrelated need; the screen has its own topic picker for that.
- If a topic is given, all three replies must be about that topic.
- Never invent medical facts, symptoms, or decisions the patient has not signaled. If the question is open-ended, offer short common needs (water, repositioning, family, rest) rather than guessing a diagnosis.
- Use the patient profile and recent conversation only to pick relevant specifics (names, preferences).
- If the patient seems fatigued, keep the replies very short.
- Set addressed_to_patient to false only when the speech is clearly meant for someone else (staff talking to each other, a phone call, "grab the chart from room 4"). Anything that could plausibly be for the patient, including greetings and statements about their care, counts as addressed. Still fill in replies either way.
- If the message is unintelligible, offer: "Please say that again", "I didn't understand", "Yes", "No".
- high_stakes is true only when a yes or no would make a medical decision: consent to a treatment, procedure, surgery, test, or medication change, or code status (CPR, DNR, life support). Routine questions about comfort, pain level, water, positioning, visitors, or feelings are not high stakes, even if they mention medicine ("are you in pain?" is not; "do you want more pain medication?" is). When high_stakes is true, stakes_about is what a yes would agree to, as a short phrase that fits "You said yes to …" ("more pain medication", "the surgery tomorrow morning", "a breathing tube"); otherwise an empty string.
- Also say who is speaking. A voice model tells voices apart (voice-1, voice-2, …) and gives the label used for this voice before, if any. Keep that label unless this message gives a better one (a name, a title, a relationship). speaker_label is what the patient would call them: "Dr. Lee", "Nurse Sam", "Your daughter", "Nurse", "Doctor", "Family". Use "Someone" only when there is no clue. speaker_role is nurse, doctor, family, visitor, staff, or unknown.`;

export const REPLIES_SCHEMA = {
  type: "object",
  properties: {
    addressed_to_patient: { type: "boolean" },
    replies: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, intent: { type: "string" } },
        required: ["text", "intent"],
        additionalProperties: false,
      },
    },
    speaker_label: { type: "string" },
    speaker_role: { type: "string", enum: ["nurse", "doctor", "family", "visitor", "staff", "unknown"] },
    high_stakes: { type: "boolean" },
    stakes_about: { type: "string" },
  },
  required: ["addressed_to_patient", "replies", "speaker_label", "speaker_role", "high_stakes", "stakes_about"],
  additionalProperties: false,
} as const;

// The local model's short prompts (see getReplies and completeWord): plain lists, not JSON.
const LOCAL_SYSTEM =
  "A patient who can't speak picks a reply with their eyes. Write 3 different short first-person replies they could say, at most 5 words each, separated by ' | '. Write only the replies. Never repeat a rejected reply.\n" +
  "Examples:\n" +
  "Are you in pain? -> Yes | No | A little\n" +
  "Do you want the doctor or the nurse? -> The doctor | The nurse | Both\n" +
  "Would you like tea or water? -> Tea | Water | Neither\n" +
  "Who should I call? -> My mother | My brother | No one\n" +
  "How did you sleep? -> Well | Badly | I'm tired";
const LOCAL_COMPLETE_SYSTEM =
  "A patient is spelling a word with their eyes. Write the 4 most likely whole words that start with the letters typed so far, separated by ' | '. Write only the words.";

export const COMPLETE_SCHEMA = {
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

export interface RepliesOut {
  replies: string[]; // same texts as options, kept for existing clients
  options: Option[]; // exactly 3 {text, intent} (CLAUDE.md contract)
  source: string;
  addressed: boolean;
  speaker: Speaker | null;
  // A yes or no here makes a medical decision (consent, treatment, code status): the replies are
  // CONSENT_REPLIES and the app confirms the pick ("You said yes to <about>. Is that correct?").
  highStakes: boolean;
  about: string | null;
}

// Without a model answer (mock mode, or the model failed): the keyword rule decides high stakes.
export function ruleReplies(transcript: string, options: Option[], source: string): RepliesOut {
  const highStakes = isConsentQuestion(transcript);
  const opts = highStakes ? consentOptions() : options;
  return { replies: opts.map((o) => o.text), options: opts, source: highStakes ? "consent-rule" : source, addressed: true, speaker: null, highStakes, about: null };
}

/** Fallback when the model fails: yes / no / more time, high stakes only if the keyword rule says so. */
export const fallbackReplies = (transcript: string) => ruleReplies(transcript, consentOptions(), "fallback");

export async function getReplies(inp: RepliesInput): Promise<RepliesOut> {

  const history = historyLines((inp.history ?? []).slice(-6));
  const v = inp.speaker;
  const voice = v?.voice ? `Voice: ${v.voice}${v.isNew ? " (first time heard)" : ""}${v.label ? `, labeled "${v.label}" before` : ""}` : "";
  const prompt = [
    inp.patientProfile ? `Patient profile: ${JSON.stringify(inp.patientProfile)}` : "",
    inp.fatigue !== undefined ? `Fatigue (0-1): ${inp.fatigue.toFixed(2)}` : "",
    history ? `Recent conversation:\n${history}` : "",
    voice,
    `Just said to the patient: "${inp.transcript}"`,
    inp.rejected?.length ? `Rejected replies (none of these fit): ${inp.rejected.map((r) => `"${r}"`).join(", ")}` : "",
    inp.category && CATEGORY_HINT[inp.category] ? `Topic the patient chose: ${CATEGORY_HINT[inp.category]}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Testing only: the small on-laptop model, when the caregiver switched it on. Built for speed
  // (median 87 ms on an M3 Max): a short prompt and three replies as plain text (local.ts), because
  // writing tokens is what takes the time. High stakes comes from the keyword rule, and there's no
  // speaker label. Claude if it fails.
  if (inp.local && localModelAvailable()) {
    if (isConsentQuestion(inp.transcript)) return ruleReplies(inp.transcript, consentOptions(), "local");
    try {
      const rejected = inp.rejected?.length ? `\nRejected (none of these fit): ${inp.rejected.join(", ")}` : "";
      const replies = (await localList(LOCAL_SYSTEM, `Just said to the patient: "${inp.transcript}"${rejected}`, 3)).slice(0, 3);
      // The local list has no intents; the contract still gets {text, intent}.
      const options = replies.map((text) => ({ text, intent: "" }));
      if (replies.length) return { replies, options, source: "local", addressed: true, speaker: null, highStakes: false, about: null };
    } catch (err) {
      console.error("local replies failed, using Claude:", err);
    }
  }
  if (mock()) return ruleReplies(inp.transcript, mockReplies(inp.transcript, inp.category), "mock");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: "low", format: { type: "json_schema", schema: REPLIES_SCHEMA } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  }, { timeout: REPLIES_TIMEOUT_MS, maxRetries: 0 });
  if (res.stop_reason === "refusal") throw new Error("model refused");
  return toReplies(JSON.parse(text(res)) as ParsedReplies, MODEL);
}

interface ParsedReplies {
  addressed_to_patient: boolean;
  replies: Option[];
  speaker_label: string;
  speaker_role: SpeakerRole;
  high_stakes: boolean;
  stakes_about: string;
}

function toReplies(parsed: ParsedReplies, source: string): RepliesOut {
  const highStakes = parsed.high_stakes === true;
  const about = highStakes ? parsed.stakes_about?.trim() || null : null;
  // The small local model sometimes returns plain strings; accept both.
  const options = highStakes
    ? consentOptions()
    : parsed.replies
        .map((r) => (typeof r === "string" ? { text: r, intent: "" } : r))
        .map((o) => ({ text: String(o.text ?? "").trim(), intent: String(o.intent ?? "").trim() }))
        .filter((o) => o.text && !/^none of these/i.test(o.text))
        .slice(0, 3);
  if (options.length < 3) throw new Error(`expected 3 replies, got ${options.length}`);
  const replies = options.map((o) => o.text);
  // Replies are kept even when not addressed, so "Reply anyway" is instant.
  const label = parsed.speaker_label?.trim();
  const speaker = label ? { label, role: parsed.speaker_role ?? "unknown" } : null;
  return { replies, options, source, addressed: parsed.addressed_to_patient !== false, speaker, highStakes, about };
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

const COMPLETE_SYSTEM =
  "A patient is spelling a message letter by letter with their eyes. Given the letters typed so far for the current word, the sentence so far, and what they were last asked, return the 4 most likely whole words, most likely first. Every word must start with the given prefix (case-insensitive). Lowercase unless it is a proper noun.";

export async function completeWord(inp: {
  prefix: string;
  sentenceSoFar?: string;
  context?: string;
  local?: boolean; // testing only (local.ts)
}): Promise<string[]> {
  const user = `Last asked: ${inp.context ?? "(unknown)"}\nSentence so far: ${inp.sentenceSoFar ?? ""}\nPrefix: ${inp.prefix}`;
  let parsed: { words: string[] } | null = null;
  if (inp.local && localModelAvailable()) {
    parsed = await localList(LOCAL_COMPLETE_SYSTEM, user, 4).then((words) => ({ words })).catch((err) => {
      console.error("local completion failed, using Claude:", err);
      return null;
    });
  }
  if (!parsed && mock()) return mockComplete(inp.prefix);
  if (!parsed) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: { type: "json_schema", schema: COMPLETE_SCHEMA } },
      system: COMPLETE_SYSTEM,
      messages: [{ role: "user", content: user }],
    }, { timeout: REPLIES_TIMEOUT_MS, maxRetries: 0 });
    parsed = JSON.parse(text(res)) as { words: string[] };
  }
  const p = inp.prefix.toLowerCase();
  return parsed.words.filter((w) => w.toLowerCase().startsWith(p)).slice(0, 4);
}
