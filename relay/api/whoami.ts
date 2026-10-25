// Lets the setup command confirm a token works.
import { displayName, unauthorized, whoIs } from "../lib/relay.js";

export function GET(request: Request): Response {
  const me = whoIs(request);
  if (!me) return unauthorized();
  return Response.json({ name: displayName(me) });
}
