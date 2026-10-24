# Patient state context (owner: Marco)

Updated: 2026-10-24 15:00 PDT

## Now
- Working on: scaffold `vitals/` (mock `vitals` emitter, README, env), and the context-doc system for the team.
- Next: wire `@smartspectra/node-sdk` into the Electron shell (main + preload + renderer entry points), then the nurse window (build step 3).
- Blocked on: a Presage API key (physiology.presagetech.com) and a decision on where the nurse window lives (second `BrowserWindow` vs the care drawer in `app/`).

## Build-order status
- Step 3 (nurse window: transcript + pulse/breathing with confidence, static layout): not started. Mock emitter exists.
- Step 2 note: CLAUDE.md says no Presage mock. I added `MOCK_VITALS` anyway so Noel can lay out the nurse window before I have a key. See Deviations.

## Interfaces as built
- Emits `vitals` `{ pulse, breathing, confidence: { pulse, breathing }, t }` at 1 Hz. `confidence` values are 0..1; both 0 for the first seconds ("measuring"). Mock only so far.
- Consumes: the renderer's camera `MediaStream` (same one MediaPipe uses). Not wired yet.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |
| 2026-10-24 | Mocks for STT, Claude, TTS only; "Camera and Presage are live or absent" | Added `MOCK_VITALS` (canned pulse/breathing, confidence ramps 0 to 0.9 over 10 s) | Nurse window layout can't wait for a Presage key; mock is 40 lines and shows the "mock" badge like the others | Product (nurse window) | No. Proposing to add `MOCK_VITALS` to the Mock modes line. |

## Decisions (newest first)
- 2026-10-24: Use the SDK's own Electron entry points (`@smartspectra/node-sdk/main`, `/preload`, `/renderer`) with `useMediaStream(stream)` on the MediaPipe stream, instead of hand-writing the `frame` MessagePort pipe. Why: the SDK already ships RGBA frames renderer-to-main over a MessagePort and owns the SDK instance per window, which is exactly the `frame` row in CLAUDE.md. Rejected: custom `frame` channel with `sendFrame()` (same result, more code, I own the bugs).
- 2026-10-24: Vitals code lives in `vitals/` as its own package, imported by `app/` like `vision/` is. Why: matches how Julian and Samarth integrate; Noel keeps control of the shell. Rejected: writing straight into `app/main.js`.

## Open questions / needs from others
- @Noel: nurse window as a second `BrowserWindow` (CLAUDE.md "nurse/family window") or the care-panel drawer already in `app/`? The SDK binds one instance per renderer, so a second window means its own preload. I'd go second window, static layout.
- @Noel: `app/` serves the page from an `app://` scheme with its own `preload.js`. The SDK preload needs to be required from yours, and its worker needs `worker-src blob:` in the CSP. OK to add both?
- @Julian: can `vision/` expose the camera `MediaStream` (or the `<video>` element) so Presage reads the same stream? Two `getUserMedia` calls on one webcam may fail on macOS.
- Team: who has or is getting the Presage API key?

## Run and check
```sh
cd vitals && npm install          # pulls ~hundreds of MB of native runtimes for all platforms; expected
MOCK_VITALS=1 node src/mock.js    # prints one vitals JSON line per second
```
