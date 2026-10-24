# Product context (owner: Noel)

Updated: 2026-10-24 (skeleton written by Marco from `app/README.md` and `docs/worklog.md`; Noel, correct and own this)

## Now
- Working on:
- Next:
- Blocked on:

## Build-order status
- Step 1: Electron app runs the loop on keyboard stand-ins and on Julian's tracker, with Samarth's server for replies and voice.
- Step 3 (nurse window): not started. Care-panel corner button exists but does nothing. Marco owns the vitals feed.

## Interfaces as built
Replies in one horizontal row with left/right gaze (Figma design), not the 2x2 grid in CLAUDE.md. "None of these" twice opens Spell it (CLAUDE.md cuts free text and uses four fixed categories instead). Page served from `app://`, own `preload.js`, requests to the conversation server go through `main.js`.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | 2x2 grid, corner gaze | One row, left/right gaze | Figma design predates the 10-25 input decision | Input, Conversation | No. Needs a team call: move to 2x2 or amend CLAUDE.md. |
| 2026-10-24 | Free text cut; second "none" shows 4 categories | Second "none" opens Spell it with word suggestions | Built before the cut | Conversation (`/complete`) | No. Same team call. |

## Decisions (newest first)
- 2026-10-24: Local Claude timeout raised to 8 s after Opus took 3.4 to 5.5 s against the server's 3 s (from worklog).

## Open questions / needs from others
- @Marco asks: nurse window as a second `BrowserWindow` or the care drawer? OK to require the Presage preload from `preload.js` and add `worker-src blob:` to the CSP?

## Run and check
```sh
cd app && npm install && npm run windowed
```
