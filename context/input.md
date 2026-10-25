# Input context (owner: Julian)

Updated: 2026-10-24 18:30 PDT (skeleton written by Marco from `vision/README.md`; Julian, correct and own this)

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
- 2026-10-25 (Julian): `phaseMs` 2000 → 3000 (app `devsettings.js` and the `calibration.ts` default), one more second per calibration dot. Usable samples per dot go from about 1.5 s to 2.5 s (`settleMs` still 500). The squint phase shares `phaseMs`, so it also grows by 1 s. Total calibration is about 23 s. Why: more samples per corner, so one noisy dot shifts the centroids less.
- 2026-10-24 (Noel, submission audit): `rolldown` added to `vision/package.json` devDependencies (`npm run eyes` in app/ used it only through vite); README test count 52 → 54. No code change.
- 2026-10-24 (Marco, for Julian to check): `quadrant.ts` decides left/right and top/bottom on separate axes (`axisPosition`), each from its own features, with a rest zone (`dead`, 0.3 of center-to-side) and hysteresis (`margin`, now a share of center-to-side, default 0.15). `TARGET_POSITIONS` moved from box centers (±0.5) to box corners (±0.9). `learnTarget` + `EyePipeline.learn(quadrant, look)` nudge a box's centroid toward the look before a kept pick (rate 0.2); `quadrantSelect` now carries `look`. Spread floor raised to 0.1 of the target range. 54 tests pass. Why: Marco's recorded session (6 min): left/right separation 17 to 23x noise, top/bottom under 2x, and vertical features drifted 2 to 7 half-gaps within 100 s (r = -0.94 with eyelid opening), which in the joint nearest-centroid flipped picks that the horizontal features had right. Rejected: raising the noise floor alone (drift in a weak axis still dominated).
- 2026-10-24 (Marco): `leadMs` now applies only before the squint (dots no longer have a lead-in; the start keeps `readyMs`). Total is `readyMs + (phases-2) * phaseMs + leadMs`. Tests updated (54 pass). Why: the patient asked for a countdown only before the start and the squint.
- 2026-10-24 (Marco, for Julian to check): `CalibrationConfig.leadMs` (default 0, so your defaults are unchanged) adds a pause before each dot and the squint. The progress reports `leadRemainingMs` during it and takes no samples. The app sets 2000. `totalMs` now includes the lead-in. Tests added in `test/calibration.test.ts` (54 pass). Why: the patient needs to read which dot comes next before it appears.

## Open questions / needs from others
- @Marco asks: can `vision/` expose the camera `MediaStream` so Presage reads the same stream?

## Run and check
```sh
cd vision && npm install --legacy-peer-deps && npm test && npm run dev   # /quadrants.html
```
