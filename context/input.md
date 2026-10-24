# Input context (owner: Julian)

Updated: 2026-10-24 (skeleton written by Marco from `vision/README.md`; Julian, correct and own this)

## Now
- Working on:
- Next:
- Blocked on:

## Build-order status
- Step 1 (main loop, 2x2 + squint): quadrants page exists with 4-box focus and hold-to-select. Integration state in `app/` per Noel's worklog: left/right layout, not 2x2.

## Interfaces as built
From `vision/README.md`: `EyePipeline` emits `quadrantSelect { quadrant, via }`, `rest`, `fatigue`; `out.quadrant.focus` and `out.blink.progress` for UI. The `app/` integration uses `window.blinkvoice.gazeLeft/gazeRight/select/setFatigue` and `patient-input` CustomEvents.
CLAUDE.md table says `gaze { corner, t }`, `confirm { t }`, `rest { t }`, `fatigue { score, blinkRate, baseline }` over `ipcRenderer`. These don't match yet; see Deviations once you've decided which way to go.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |

## Decisions (newest first)

## Open questions / needs from others
- @Marco asks: can `vision/` expose the camera `MediaStream` so Presage reads the same stream?

## Run and check
```sh
cd vision && npm install --legacy-peer-deps && npm test && npm run dev   # /quadrants.html
```
