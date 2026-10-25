# Submission + evidence context (owner: Marco)

Updated: 2026-10-24 16:20 PDT

Was "Patient state" (Presage vitals + nurse window). Presage is cut (CLAUDE.md decisions log, 2026-10-24). This file keeps its name so links don't break.

## Now
- Working on: eyes adapter back to the vision module only (branch `marco/vision-only-eyes`, see Decisions).
- Next: backup video, Devpost, root README, consent note; human test with numbers (4 people, 2 lighting conditions, hit rate + false selects); CLAUDE.md reconciled with the build.
- Blocked on: nothing.

## Build-order status
- Step 3 (nurse view): Noel's care drawer covers transcript + alerts. No vitals, by decision.
- Step 5 (video, README, Devpost, consent note): not started. Mine.

## Interfaces as built
None. This role emits docs, not events.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |

## Decisions (newest first)
- 2026-10-24: Presage cut. Why: ICU patients are on monitors, a vented patient's breathing rate is the ventilator's, and one sponsor track out of six isn't worth bending the product. Rejected: keep it as a family-facing comfort signal.
- 2026-10-24: App eye input follows the vision module only (its calibration, quadrant focus, `quadrantSelect`); the app-side gaze model, auto re-center, and practice round come out. Why: two classifiers answering "which box" and a second dot sequence the patient didn't ask for. Rejected: disable re-center only. Noel's head-turn concern goes to the vision module, where the fix belongs.

## Open questions / needs from others
- @Noel: vitals tiles in the care drawer can go ("Not connected" forever otherwise). Your "blocked on Marco" line is clear.
- `vision/`: Noel found the quadrant classifier mis-picks on head turns. If that's real, the fix belongs in `vision/` (head pose in the feature vector), not in `app/`.

## Run and check
```sh
./start                       # whole app
cd app && npm test            # e2e checks
```
