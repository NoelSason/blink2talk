#!/usr/bin/env node
// Blink2Talk agent relay hooks (see relay/README.md).
//   check    PreToolUse: blocks an edit to a file another teammate's agent has claimed.
//   inbox    UserPromptSubmit: shows teammates' updates to the agent; conflicts to the human too.
//   session  SessionStart: the board plus unread updates.
//   setup <token>  one-time: saves your token and adds the MCP server to Claude Code.
// Does nothing until setup has run, and allows the edit if the relay can't be reached.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const RELAY = process.env.B2T_RELAY_URL ?? "https://agents.blink2talk2.us";
// Outside the repo so agent worktrees find it too.
const TOKEN_FILE = path.join(homedir(), ".config", "blink2talk", "relay-token");
// `claude mcp add --scope local` is keyed by folder, so setup runs it from the repo root.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

function readToken() {
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

async function relay(route, token, init = {}) {
  const response = await fetch(`${RELAY}${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`${route}: ${response.status}`);
  return response.json();
}

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data ? JSON.parse(data) : {};
}

// Repo-relative path, or null for files outside the repo. Agent worktrees map to the same paths.
function repoPath(file, input) {
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const relative = path.relative(root, path.resolve(root, file)).split(path.sep).join("/");
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.replace(/^\.claude\/worktrees\/[^/]+\//, "");
}

function emit(fields) {
  process.stdout.write(JSON.stringify(fields));
}

async function check(token) {
  const input = await readStdin();
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const target = file && repoPath(file, input);
  if (!target) return;
  const result = await relay("/check", token, { method: "POST", body: JSON.stringify({ path: target }) });
  if (result.ok) return;
  const owners = result.reason.split("\n").filter((line) => line.startsWith("- ")).join("\n");
  emit({
    systemMessage: `Relay blocked an edit to ${target}. Another teammate's agent has it:\n${owners}\nTalk to them and decide who goes ahead.`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: result.reason,
    },
  });
}

async function inbox(token, eventName, withBoard) {
  await readStdin();
  const { context, alert } = await relay(withBoard ? "/inbox?board=1" : "/inbox", token);
  if (!context) return;
  emit({
    ...(alert ? { systemMessage: alert } : {}),
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
  });
}

async function setup(token) {
  if (!token) {
    console.error("Usage: node .claude/hooks/relay.mjs setup <your-token>");
    process.exit(1);
  }
  const { name } = await relay("/whoami", token).catch(() => {
    console.error("That token didn't work. Check you copied all of it.");
    process.exit(1);
  });
  mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });

  const add = [
    "mcp", "add", "--transport", "http", "--scope", "local", "blink2talk-relay", `${RELAY}/mcp`,
    "--header", `Authorization: Bearer ${token}`,
  ];
  try {
    try {
      execFileSync("claude", ["mcp", "remove", "blink2talk-relay", "--scope", "local"], { cwd: REPO_ROOT, stdio: "ignore" });
    } catch {
      // Not added yet.
    }
    execFileSync("claude", add, { cwd: REPO_ROOT, stdio: "ignore" });
    console.log(`Connected as ${name}. Restart Claude Code in this folder to pick it up.`);
  } catch {
    console.log(`Token saved for ${name}, but the claude command isn't on your PATH. Run this in ${REPO_ROOT}:`);
    console.log(`claude ${add.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ")}`);
  }
}

const [mode, arg] = process.argv.slice(2);
if (mode === "setup") {
  await setup(arg);
} else {
  const token = readToken();
  if (token) {
    try {
      if (mode === "check") await check(token);
      else if (mode === "inbox") await inbox(token, "UserPromptSubmit", false);
      else if (mode === "session") await inbox(token, "SessionStart", true);
    } catch {
      // Relay unreachable: never block work because of it.
    }
  }
}
