// Called by the PreToolUse hook before every file edit: { path } -> { ok, reason? }.
import { checkEdit, unauthorized, whoIs } from "../lib/relay.js";

export async function POST(request: Request): Promise<Response> {
  const me = whoIs(request);
  if (!me) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  if (typeof body.path !== "string") return Response.json({ error: "path is required" }, { status: 400 });
  return Response.json(await checkEdit(me, body.path));
}
