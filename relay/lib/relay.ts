// State for the Blink2Talk agent relay: which teammate's agent is working on which files,
// and messages between agents. Stored in Upstash Redis over its REST API, so no client library.
import { timingSafeEqual } from "node:crypto";

export type Claim = { task: string; paths: string[]; t: number; agreed: string[] };
export type RelayEvent = {
  id: number;
  t: number;
  from: string;
  to: string; // a teammate's name or "all"
  kind: "claim" | "release" | "conflict" | "override" | "message";
  text: string;
};
type Conflict = { owner: string; claim: Claim; paths: string[] };
type RedisCommand = (string | number)[];

const KEY = "b2t-relay:";
export const CLAIM_IDLE_MINUTES = 60;
const MAX_EVENTS = 500;

async function redis(...commands: RedisCommand[]): Promise<unknown[]> {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Redis is not configured");
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`Redis request failed: ${response.status}`);
  const replies = (await response.json()) as { result?: unknown; error?: string }[];
  return replies.map((reply) => {
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  });
}

// RELAY_TOKENS is "name:token,name:token", one token per teammate. The token decides who is posting.
function tokenTable(): [string, string][] {
  return (process.env.RELAY_TOKENS ?? "")
    .split(",")
    .map((pair) => pair.trim().split(":") as [string, string])
    .filter(([name, token]) => Boolean(name && token));
}

export function teammates(): string[] {
  return tokenTable().map(([name]) => name);
}

export function whoIs(request: Request): string | null {
  const presented = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  for (const [name, token] of tokenTable()) {
    const expected = Buffer.from(token);
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) return name;
  }
  return null;
}

export function unauthorized(): Response {
  return Response.json({ error: "Missing or unknown relay token" }, { status: 401 });
}

export const displayName = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}

// A folder overlaps everything inside it.
function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function ago(t: number): string {
  const minutes = Math.round((Date.now() - t) / 60000);
  return minutes < 1 ? "just now" : `${minutes} min ago`;
}

async function loadClaims(): Promise<Map<string, Claim>> {
  const [flat] = (await redis(["HGETALL", `${KEY}claims`])) as [string[] | null];
  const list = flat ?? [];
  const cutoff = Date.now() - CLAIM_IDLE_MINUTES * 60000;
  const claims = new Map<string, Claim>();
  for (let i = 0; i + 1 < list.length; i += 2) {
    const claim = JSON.parse(list[i + 1]) as Claim;
    if (claim.t > cutoff) claims.set(list[i], claim);
  }
  return claims;
}

async function saveClaim(name: string, claim: Claim): Promise<void> {
  await redis(["HSET", `${KEY}claims`, name, JSON.stringify(claim)]);
}

function findConflicts(me: string, paths: string[], claims: Map<string, Claim>): Conflict[] {
  const mine = claims.get(me);
  const conflicts: Conflict[] = [];
  for (const [owner, claim] of claims) {
    if (owner === me || mine?.agreed.includes(owner) || claim.agreed.includes(me)) continue;
    const hit = claim.paths.filter((claimed) => paths.some((path) => overlaps(path, claimed)));
    if (hit.length) conflicts.push({ owner, claim, paths: hit });
  }
  return conflicts;
}

async function addEvent(from: string, to: string, kind: RelayEvent["kind"], text: string): Promise<void> {
  const [id] = (await redis(["INCR", `${KEY}seq`])) as [number];
  const event: RelayEvent = { id, t: Date.now(), from, to, kind, text };
  await redis(["RPUSH", `${KEY}events`, JSON.stringify(event)], ["LTRIM", `${KEY}events`, -MAX_EVENTS, -1]);
}

// Tell the other owner once per 10 minutes, not on every blocked edit.
async function notifyConflict(me: string, conflict: Conflict, wants: string): Promise<void> {
  const [fresh] = await redis(["SET", `${KEY}notified:${me}:${conflict.owner}`, "1", "NX", "EX", 600]);
  if (fresh !== "OK") return;
  const who = displayName(me);
  await addEvent(
    me,
    conflict.owner,
    "conflict",
    `${who}'s agent wants to ${wants}, which overlaps your claim on ${conflict.paths.join(", ")} ("${conflict.claim.task}"). ` +
      `It has stopped and asked ${who}. Talk to ${who} and decide who goes ahead.`,
  );
}

function conflictReport(me: string, conflicts: Conflict[]): string {
  const owners = conflicts.map((c) => displayName(c.owner)).join(" and ");
  return [
    "Conflict: another teammate's agent has claimed these files. Don't edit them, and don't work around this by changing other files toward the same goal.",
    ...conflicts.map(
      (c) => `- ${displayName(c.owner)}'s agent: "${c.claim.task}" on ${c.paths.join(", ")} (active ${ago(c.claim.t)})`,
    ),
    `Tell ${displayName(me)} exactly who is doing what, and ask them to sort it out with ${owners}, who ${conflicts.length > 1 ? "have" : "has"} been told too.`,
    "Once they agree: claim narrower paths with claim_work, wait for the other agent to call release_work, " +
      "or call claim_work with override: true if your human says they agreed to share the files.",
  ].join("\n");
}

export async function claimWork(
  me: string,
  task: string,
  rawPaths: string[],
  override: boolean,
): Promise<{ ok: boolean; text: string }> {
  const paths = [...new Set(rawPaths.map(normalizePath).filter(Boolean))];
  if (!task.trim() || paths.length === 0) {
    return { ok: false, text: "Give a short task description and at least one file or folder path, relative to the repo root." };
  }
  const claims = await loadClaims();
  const conflicts = findConflicts(me, paths, claims);
  if (conflicts.length && !override) {
    await Promise.all(conflicts.map((c) => notifyConflict(me, c, `work on "${task}" (${paths.join(", ")})`)));
    return { ok: false, text: conflictReport(me, conflicts) };
  }
  const agreed = [...new Set([...(claims.get(me)?.agreed ?? []), ...conflicts.map((c) => c.owner)])];
  await saveClaim(me, { task, paths, t: Date.now(), agreed });
  for (const c of conflicts) {
    await addEvent(
      me,
      c.owner,
      "override",
      `${displayName(me)} says you agreed to share ${c.paths.join(", ")}. ${displayName(me)}'s agent is going ahead with "${task}"; both agents can edit those files now.`,
    );
  }
  await addEvent(me, "all", "claim", `${displayName(me)}'s agent started "${task}" (${paths.join(", ")}).`);
  return { ok: true, text: `Claimed. Call release_work when the task is done.\n\n${await board()}` };
}

// Every edit keeps the editor's claim alive and covering the file, so a conflict is caught
// even when an agent never called claim_work.
export async function checkEdit(me: string, rawPath: string): Promise<{ ok: boolean; reason?: string }> {
  const path = normalizePath(rawPath);
  if (!path) return { ok: true };
  const claims = await loadClaims();
  const conflicts = findConflicts(me, [path], claims);
  if (conflicts.length) {
    await Promise.all(conflicts.map((c) => notifyConflict(me, c, `edit ${path}`)));
    return { ok: false, reason: conflictReport(me, conflicts) };
  }
  const mine = claims.get(me);
  if (!mine) {
    await saveClaim(me, { task: "(no task given)", paths: [path], t: Date.now(), agreed: [] });
    await addEvent(me, "all", "claim", `${displayName(me)}'s agent started editing ${path} without claiming a task.`);
  } else {
    const covered = mine.paths.some((claimed) => path === claimed || path.startsWith(`${claimed}/`));
    await saveClaim(me, { ...mine, paths: covered ? mine.paths : [...mine.paths, path], t: Date.now() });
  }
  return { ok: true };
}

export async function releaseWork(me: string, note: string): Promise<string> {
  const mine = (await loadClaims()).get(me);
  await redis(["HDEL", `${KEY}claims`, me]);
  if (!mine) return "You had nothing claimed.";
  const free = `${mine.paths.join(", ")} ${mine.paths.length > 1 ? "are" : "is"} free`;
  await addEvent(me, "all", "release", `${displayName(me)}'s agent finished "${mine.task}"; ${free}.${note ? ` Note: ${note}` : ""}`);
  return `Released "${mine.task}".`;
}

export async function board(): Promise<string> {
  const claims = await loadClaims();
  const lines = teammates().map((name) => {
    const claim = claims.get(name);
    if (!claim) return `- ${displayName(name)}: nothing claimed`;
    const shared = claim.agreed.length ? ` (sharing with ${claim.agreed.map(displayName).join(", ")})` : "";
    return `- ${displayName(name)}'s agent: "${claim.task}" on ${claim.paths.join(", ")}, active ${ago(claim.t)}${shared}`;
  });
  return [`Who is working on what (a claim ends after ${CLAIM_IDLE_MINUTES} min without edits):`, ...lines].join("\n");
}

export async function send(me: string, to: string, text: string): Promise<{ ok: boolean; text: string }> {
  const target = to.trim().toLowerCase();
  if (target !== "all" && !teammates().includes(target)) {
    return { ok: false, text: `Unknown teammate "${to}". Use one of: ${[...teammates(), "all"].join(", ")}.` };
  }
  if (!text.trim()) return { ok: false, text: "The message is empty." };
  await addEvent(me, target, "message", text);
  return { ok: true, text: `Sent to ${target === "all" ? "everyone" : displayName(target)}. Replies arrive in inbox.` };
}

// Returns events addressed to me (or everyone) that I haven't seen, and marks them seen.
export async function readInbox(me: string): Promise<RelayEvent[]> {
  const [raw, cursor] = (await redis(["LRANGE", `${KEY}events`, -200, -1], ["GET", `${KEY}cursor:${me}`])) as [
    string[],
    string | null,
  ];
  const since = Number(cursor ?? 0);
  const events = raw.map((line) => JSON.parse(line) as RelayEvent);
  const last = events.at(-1)?.id ?? 0;
  if (last > since) await redis(["SET", `${KEY}cursor:${me}`, last]);
  return events.filter((e) => e.id > since && e.from !== me && (e.to === "all" || e.to === me));
}

export function formatEvents(events: RelayEvent[]): string {
  return events
    .map((e) => {
      const body =
        e.kind === "message"
          ? `${displayName(e.from)}'s agent${e.to === "all" ? " (to everyone)" : ""}: ${e.text}`
          : e.text;
      return `- [${ago(e.t)}] ${body}`;
    })
    .join("\n");
}
