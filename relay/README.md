# Agent relay

Keeps our Claude Code agents from editing the same files at the same time. When two agents collide, the edit is blocked, both humans are told whose agent is doing what, and you sort it out between you.

Live at `https://agents.blink2talk2.us`. Team tooling only; it isn't part of the product or the demo.

## Set up (once, about 2 minutes)

You need Claude Code, Node 18 or later, and your token. Noel sends each person their own token in a DM; don't post it in the group chat.

1. Get the latest code:

   ```sh
   git pull --rebase
   ```

2. In the Blink2Talk folder, run setup with your token:

   ```sh
   node .claude/hooks/relay.mjs setup <your-token>
   ```

   It prints `Connected as <your name>.`

3. Quit and restart Claude Code in the Blink2Talk folder. If it asks you to review the project's hooks, accept them.

4. To check it works, ask your agent: "show me the relay board."

## What happens once you're set up

- **When a session starts,** your agent sees what every teammate's agent is working on.
- **Before every file edit,** a hook checks the file. If another teammate's agent has claimed it, the edit is blocked, you see who has it, and that teammate is told you tried. Every edit you make adds that file to your own claim, so this works even if your agent never claimed anything.
- **Each time you send a prompt,** your agent sees new updates and messages from teammates' agents. Conflicts also show up for you directly.
- **A claim ends** when your agent calls `release_work`, or after 60 minutes with no edits.

## When an edit is blocked

Talk to the teammate whose agent has the files. Then tell your agent one of these:

- "Work on these other files instead: …" (the agent claims narrower paths)
- "Wait until Marco's agent releases those files."
- "Marco and I agreed to share those files. Go ahead." (the agent claims with `override: true`, and both agents can edit them)

Only say the last one after you've actually agreed. The other teammate's agent is told about the override.

## Tools your agent gets

| Tool | What it does |
| --- | --- |
| `claim_work` | Claims a task and the files or folders it will change. Refused on overlap, with who and what. |
| `release_work` | Frees your files when the task is done. |
| `board` | Shows everyone's current claim. |
| `send` | Messages one teammate's agent, or all of them. |
| `inbox` | Shows unread updates and messages. |

## Limits

- Only Claude Code's file-edit tools are checked. Changes made through shell commands (`sed`, scripts, `git checkout`) aren't.
- Your agent sees updates only when you send it a prompt. Nothing reaches an idle session.
- If the relay can't be reached, edits go ahead. It never blocks work because it's down.
- One claim per person, so two agents on the same laptop share it.
- Two claims made within the same second can both succeed.

## Running it (Noel)

- Code: `relay/api/` (endpoints) and `relay/lib/relay.ts` (claims, conflicts, messages). Hooks: `.claude/hooks/relay.mjs`, wired in `.claude/settings.json`.
- Hosting: Vercel project `blink2talk-relay` on Noel's account, with Upstash Redis for storage. DNS: an A record for `agents` at Porkbun.
- Deploy: `cd relay && vercel deploy --prod`. Typecheck: `cd relay && npm install && npm run typecheck`.
- Tokens: the `RELAY_TOKENS` env var on Vercel, as `name:token,name:token`. Noel's local copy is in `~/.config/blink2talk/team-tokens.txt`, outside the repo.
- Disconnect a laptop: `claude mcp remove blink2talk-relay -s local`, then delete `~/.config/blink2talk/relay-token`.
