---
name: handoff
description: Update the user's context doc in context/ (and CLAUDE.md if they deviated from it) before a git push. Use before any push, when the user says "handoff", "sync context", or "update my context doc", or when the pre-push hook refuses a push.
---

# Handoff

Goal: the push carries an honest record of what changed and why, in the owner's `context/<file>.md`.

1. Work out which subsystem the user owns from `context/README.md` and the paths they changed. If unclear, ask once.
2. Collect the change: `git diff origin/main...HEAD --stat` plus `git status --short` for uncommitted work, limited to their directory.
3. Read `CLAUDE.md` (Build order, Cut, Interfaces, State machine, Claude contract) and their context file.
4. Classify each change:
   - **Deviation:** `CLAUDE.md` specifies something different. Add a row to the Deviations table (date, what the doc says, what was done, why, who it affects, whether `CLAUDE.md` was updated).
   - **Decision:** `CLAUDE.md` is silent. Add one line under Decisions, newest first, with the rejected alternative.
   - **Cut item re-added:** stop and tell the user. Don't write it up as a deviation; it needs a team call.
5. Rewrite "Now" (3 lines), update "Build-order status" and "Interfaces as built" to match the code, set `Updated:`.
6. If a deviation changes an interface another owner consumes, edit the `CLAUDE.md` Interfaces table and append to its decisions log (date, who, one line). Tell the user which owner to ping.
7. Show the doc diff. On approval, commit the docs with the code (same commit if the code is uncommitted, otherwise one `context: ...` commit). Don't push; the user pushes.

Keep every line short. No prose paragraphs in context files.
