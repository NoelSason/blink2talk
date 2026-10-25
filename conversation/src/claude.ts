import Anthropic from "@anthropic-ai/sdk";
import { isConsentQuestion, questionKind, CLARIFY_REPLIES, CONSENT_REPLIES, FALLBACK_REPLIES, FALLBACK_SPARE } from "./safety.js";
import { mockComplete, mockReplies } from "./mock.js";
import { localList, localModelAvailable } from "./local.js";

// Replies: chosen on 37 labeled nurse phrases (`npm run eval:replies`), see context/conversation.md.
export const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
// Fast mode (research preview, Claude API only): same model, output up to 2.5x faster, at 2x the price.
const FAST = process.env.CLAUDE_FAST !== "0";
// Spell it word suggestions: one short word list per letter typed, so the fastest model.
const COMPLETE_MODEL = process.env.COMPLETE_MODEL ?? "claude-haiku-5-5";
// Summaries run in the background, so they use the strongest model.
const SUMMARY_MODEL = process.env.SUMMARY_MODEL ?? "claude-opus-5-5";
const SUMMARY_TIMEOUT_MS = 30000;
const client = new Anthropic(); // reads ANTHROPIC_API_KEY
// Past this the patient gets safe fallback options instead of waiting.
// 5 s default: replies take about 1.2 s (1.5 s p90) on good Wi-Fi; .env can raise it for slow venue Wi-Fi.
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
const isRejected = (text: string, rejected: string[]) => rejected.some((r) => sameText(r, text));
// Yes / No / I need more time. Once the patient said none of those fit, a fixed set of questions that
// never decide (safety.ts): showing the same three again made "None of these" look broken.
function consentOptions(rejected: string[] = []): Option[] {
  if (!CONSENT_REPLIES.some((c) => isRejected(c, rejected))) {
    return CONSENT_REPLIES.map((text, i) => ({ text, intent: CONSENT_INTENTS[i] ?? "other" }));
  }
  return CLARIFY_REPLIES.find((set) => !set.some((o) => isRejected(o.text, rejected))) ?? CLARIFY_REPLIES[CLARIFY_REPLIES.length - 1];
}

export const SYSTEM = `You write reply options for a patient in an ICU who is awake but cannot speak or use their hands. Someone in the room has just said something to them. The screen shows your three replies, the patient picks one with their eyes, and the app speaks it aloud in their voice. The patient reads slowly and every pick takes effort, so each reply has to earn its place.

Write exactly 3 replies the patient could say as-is: first person, natural spoken English, 2 to 6 words (never more than 8), no quotation marks, most likely first. Each reply must tell the listener something the other two don't. The screen adds a fourth box, "None of these", itself; never write it. Give each reply a short intent label ("yes", "no", "partial", "water", "family", "ask-time"); the three intents must differ.

Fit the replies to what was said:
- Yes/no question: one plain yes, one plain no, and the most useful in-between or follow-up answer about the same thing ("Just a little", "Ice chips only", "Later, please"). Lead with the answer and don't repeat the question back: "Yes, please" rather than "Yes, I'm thirsty". Never two replies that both mean yes, or both mean no.
- Either/or question: each option offered, then the most likely third answer ("Neither", "Both", or a common alternative).
- Number scale (pain 0-10 and similar): three ranges that cover the scale, each with its numbers: "Mild, about 2", "Medium, about 5", "Severe, 8 or more".
- Where, what, or who question: the three most common answers for an ICU patient. Never invent a symptom, a person, or a relative that the conversation or patient profile doesn't mention; use a general word instead ("my family", "my back").
- Open question or greeting: short answers to what was asked, then a common need (water, repositioning, pain, family, rest).
- News or a statement: a short acknowledgement, a short question back about it, and a short feeling or need.

Other rules:
- If rejected replies are listed, the patient said none of them fit. Stay on what was asked, but each new reply must add something the rejected ones didn't: a reason, a when or how ("Call her after lunch", "Just send her a text"), a different person or thing ("Call my son instead"), or a message to pass on ("Tell her I love her"). Use a question back only when a patient would naturally ask it; don't force one in. If a yes and a no were rejected, no new reply may be a plain yes or no in other words: "Call her now" is just yes, "Not right now" is just no. A yes or no with its reason is fine, and the patient may mean either side, so cover both: "Comfortable since you turned me", "My heels are sore". Never repeat or reword a rejected reply. Do not switch to an unrelated need; the screen has its own topic picker for that.
- If a topic is given, all three replies must be about that topic.
- Never invent medical facts, symptoms, or decisions the patient has not signaled.
- Never contradict what the patient already said in the recent conversation: if they said the pain is gone, don't offer "My back hurts".
- Use the patient profile and recent conversation only to pick relevant specifics (names, preferences), and only when they answer what was asked. Never bring in a profile detail to fill a box (a favorite drink in an answer about pain), never read the profile back to the speaker ("My son lives in Fresno"), and never offer what the patient's condition rules out (food or drink to someone intubated).
- Fatigue 0.8 or more: the screen shows only your first two replies. Keep every reply to 1 to 3 words, and make the first two the pair that answers on its own: yes and no, both choices, or the two halves of a scale with their numbers ("Under 5", "5 or more").
- Set addressed_to_patient to false only when the speech is clearly meant for someone else (staff talking to each other, a phone call, "grab the chart from room 4"). Anything that could plausibly be for the patient, including greetings and statements about their care, counts as addressed. When it isn't addressed, still write replies: what the patient might say to join in ("I can hear you", "Is that about me?", "Please talk to me").
- If the message is unintelligible, offer: "Please say that again", "I didn't understand", "Yes". If those were rejected, don't guess what it was about; offer ways to get the question again ("Ask me yes or no", "Please speak slower", "Come back in a minute").
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

// Server-side refusal fallback: a declined request re-runs inside the same call on the model Anthropic
// recommends for that refusal category, instead of the patient getting the safe Yes / No replies.
// Claude Haiku 5.5 has no server-side fallback.
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);
const FAST_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-opus-4-8"]);
type AskParams = Omit<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "betas" | "fallbacks" | "speed">;

// One structured-output call; returns its JSON text. Fast mode has its own rate limit: on a 429 the
// same request runs once more at standard speed.
async function ask(params: AskParams, opts: { timeout: number; maxRetries: number }, fast = false): Promise<string> {
  const fallback = FALLBACK_MODELS.has(params.model);
  const speedUp = fast && FAST_MODELS.has(params.model);
  const betas: Anthropic.Beta.AnthropicBeta[] = [];
  if (fallback) betas.push("server-side-fallback-2026-07-01");
  if (speedUp) betas.push("fast-mode-2026-02-01");
  try {
    const res = await client.beta.messages.create({
      ...params,
      ...(betas.length ? { betas } : {}),
      ...(fallback ? { fallbacks: "default" as const } : {}),
      ...(speedUp ? { speed: "fast" as const } : {}),
    }, opts);
    if (res.stop_reason === "refusal") throw new Error("model refused");
    for (const b of res.content) if (b.type === "text") return b.text;
    throw new Error(`no text block (stop_reason=${res.stop_reason})`);
  } catch (err) {
    if (speedUp && err instanceof Anthropic.RateLimitError) return ask(params, opts, false);
    throw err;
  }
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
export function ruleReplies(transcript: string, options: Option[], source: string, rejected: string[] = []): RepliesOut {
  const highStakes = isConsentQuestion(transcript);
  const opts = highStakes ? consentOptions(rejected) : options;
  return { replies: opts.map((o) => o.text), options: opts, source: highStakes ? "consent-rule" : source, addressed: true, speaker: null, highStakes, about: null };
}

/**
 * Fallback when the model fails: fixed replies for the kind of thing said (yes/no question, open
 * question, statement), never one the patient already rejected, so a failed "None of these" still
 * changes the screen. High stakes only if the keyword rule says so.
 */
export function fallbackReplies(transcript: string, rejected: string[] = []): RepliesOut {
  const kind = questionKind(transcript);
  const all = [...FALLBACK_REPLIES[kind], ...FALLBACK_SPARE]
    .filter((o, i, list) => list.findIndex((x) => x.text === o.text) === i)
    .filter((o) => !(kind === "yesNo" && o.intent === "yes-no")); // "Ask me yes or no" after a yes/no question
  const fresh = all.filter((o) => !isRejected(o.text, rejected));
  // Always three (the contract): a client that rejected every one of them gets the first ones back.
  const options = [...fresh, ...all.filter((o) => !fresh.includes(o))].slice(0, 3);
  return ruleReplies(transcript, options, "fallback", rejected);
}

// The re-ask after "None of these". With a topic (patient.html's topic picker) the topic leads; without
// one the replies stay on the question. Covering both sides fixes re-asks that only gave bad-night
// reasons after "Did you sleep ok?": the patient who rejects "Yes" and "No" may mean either.
function rejectedBlock(inp: RepliesInput): string {
  const listed = `The patient rejected all of these: ${inp.rejected!.map((r) => `"${r}"`).join(", ")}. Don't repeat or reword them.`;
  if (inp.category) return listed;
  const answers = earlierAnswers(inp.history ?? []);
  return [
    listed,
    `They want to say something more specific about "${inp.transcript}". Each new reply must still answer it and add what the rejected ones didn't: a reason, when, how much, which one, or a different person or thing.`,
    // Quoted here, next to the rules, because a rule pointing back at the conversation above was
    // ignored: after "Yes, pretty well" to a sleep question, re-asks still offered "the alarms woke me".
    answers ? `The patient already answered ${answers}. Those answers stand: every new reply, its reason included, must still be true for someone who said them. Find another reason rather than contradict them.` : "",
    `If the rejected replies include an answer and its opposite (yes and no, good and bad, on and off), cover both sides in your first two replies (a tired patient sees only two), each with its reason.`,
    `Don't change the subject.`,
  ].filter(Boolean).join("\n");
}

// The patient's own answers in the recent conversation, each with what it answered:
// "Yes, pretty well" (to "Did you sleep ok?").
function earlierAnswers(history: Turn[]): string {
  const recent = history.slice(-6);
  return recent
    .flatMap((t, i) => {
      if (t.role !== "patient") return [];
      const asked = recent.slice(0, i).reverse().find((x) => x.role !== "patient");
      return [`"${t.text}"${asked ? ` (to "${asked.text}")` : ""}`];
    })
    .join(", ");
}

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
    inp.rejected?.length ? rejectedBlock(inp) : "",
    inp.category && CATEGORY_HINT[inp.category] ? `Topic the patient chose: ${CATEGORY_HINT[inp.category]}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // Testing only: the small on-laptop model, when the caregiver switched it on. Built for speed
  // (median 87 ms on an M3 Max): a short prompt and three replies as plain text (local.ts), because
  // writing tokens is what takes the time. High stakes comes from the keyword rule, and there's no
  // speaker label. Claude if it fails.
  if (inp.local && localModelAvailable()) {
    if (isConsentQuestion(inp.transcript)) return ruleReplies(inp.transcript, [], "local", inp.rejected);
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
  if (mock()) return ruleReplies(inp.transcript, mockReplies(inp.transcript, inp.category), "mock", inp.rejected);

  const json = await ask({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "low", format: { type: "json_schema", schema: REPLIES_SCHEMA } },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  }, { timeout: REPLIES_TIMEOUT_MS, maxRetries: 0 }, FAST);
  return toReplies(JSON.parse(json) as ParsedReplies, MODEL, inp.rejected);
}

interface ParsedReplies {
  addressed_to_patient: boolean;
  replies: Option[];
  speaker_label: string;
  speaker_role: SpeakerRole;
  high_stakes: boolean;
  stakes_about: string;
}

const sameText = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

function toReplies(parsed: ParsedReplies, source: string, rejected: string[] = []): RepliesOut {
  const highStakes = parsed.high_stakes === true;
  const about = highStakes ? parsed.stakes_about?.trim() || null : null;
  // The small local model sometimes returns plain strings; accept both.
  const options = highStakes
    ? consentOptions(rejected)
    : parsed.replies
        .map((r) => (typeof r === "string" ? { text: r, intent: "" } : r))
        .map((o) => ({ text: String(o.text ?? "").trim(), intent: String(o.intent ?? "").trim() }))
        .filter((o) => o.text && !/^none of these/i.test(o.text))
        .filter((o, i, all) => all.findIndex((x) => sameText(x.text, o.text)) === i) // a repeat wastes a box
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
  const json = await ask({
    model: SUMMARY_MODEL,
    max_tokens: 4096,
    output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
    system: SUMMARY_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  }, { timeout: SUMMARY_TIMEOUT_MS, maxRetries: 1 });
  const parsed = JSON.parse(json) as { for_patient: string; for_caregiver: string[] };
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
    const json = await ask({
      model: COMPLETE_MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: { type: "json_schema", schema: COMPLETE_SCHEMA } },
      system: COMPLETE_SYSTEM,
      messages: [{ role: "user", content: user }],
    }, { timeout: REPLIES_TIMEOUT_MS, maxRetries: 0 });
    parsed = JSON.parse(json) as { words: string[] };
  }
  const p = inp.prefix.toLowerCase();
  return parsed.words.filter((w) => w.toLowerCase().startsWith(p)).slice(0, 4);
}
