# Context docs

One file per owner. You write only yours. Everyone reads everyone's.

| File | Owner | Code |
| --- | --- | --- |
| `input.md` | Team (no owner) | `vision/` |
| `conversation.md` | Samarth | `conversation/` |
| `patient-state.md` | Marco | `docs/` submission files (not gated) |
| `product.md` | Noel | `app/`, `design/` (`docs/` is shared, not gated) |

## Why this shape

- **One file per person, not per decision.** Four files never conflict on merge. A shared log conflicts on every push.
- **`CLAUDE.md` stays the contract.** It says what we agreed. Your context file says what you actually did and why. Reviewers diff the two.
- **Deviation is allowed, silent deviation is not.** You may do something `CLAUDE.md` doesn't say. You must write it down in the same commit.

## The rules

1. **Session start:** read `CLAUDE.md`, your own context file in full, and the "Now" + "Deviations" sections of the other three.
2. **Follow `CLAUDE.md` by default.** When it specifies X and you did Y, that's a *deviation*: add a row to your Deviations table. When it specifies nothing and you chose something, that's a *decision*: add a line to your Decisions list.
3. **Deviation that changes an interface someone else consumes** (event name, payload, route, timing): fix the `CLAUDE.md` Interfaces table and append to its decisions log in the same commit, then tell the owner it affects. Otherwise `CLAUDE.md` stays untouched and only your file changes.
4. **Every push that touches your code touches your context file.** `.githooks/pre-push` refuses otherwise. Nothing worth noting? Bump `Updated:` and rewrite "Now"; that still counts. Escape hatch: `SKIP_CONTEXT=1 git push`.
5. **Keep it short.** "Now" is 3 lines. A deviation row is one line. Longer explanations go in your subsystem README.
6. **Run `/handoff` in Claude Code before pushing.** It diffs your code since `origin/main`, compares it with `CLAUDE.md`, and drafts the updates for you to approve.

## Setup (once per clone)

```sh
git config core.hooksPath .githooks
```

## Agent relay (so agents don't edit the same files)

Once per laptop: `git pull --rebase`, then `node .claude/hooks/relay.mjs setup <your-token>` (Noel DMs you the token), then restart Claude Code. Details and what to do when an edit is blocked: `relay/README.md`.

## Checking each other's work

Open someone's context file and `CLAUDE.md` side by side:

- Does every Deviations row have a "why" you'd accept?
- Does "Interfaces as built" match the `CLAUDE.md` table? Anything different that is *not* in Deviations is a bug in the doc or the code.
- Is anything from the `CLAUDE.md` "Cut" list showing up in their "Now"?

## Template

```markdown
# <Subsystem> context (owner: <Name>)

Updated: YYYY-MM-DD HH:MM PDT

## Now
- Working on:
- Next:
- Blocked on:

## Build-order status
Which CLAUDE.md build-order steps touch this subsystem, and whether each is done.

## Interfaces as built
What this subsystem emits and consumes today, exact names and payloads.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |

## Decisions (newest first)
- YYYY-MM-DD: <decision>. Why: <one line>. Rejected: <alternative>.

## Open questions / needs from others
- @<owner>: <question>

## Run and check
Commands to run this subsystem alone and see it working.
```
