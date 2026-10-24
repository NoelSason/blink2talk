# blink_to_talk

Computer-vision input (long blink, squint, gaze) for the Blink-to-Speak ICU communicator.
TypeScript; MediaPipe FaceLandmarker runs in the browser / Electron renderer.

## Code style

- Be concise. Write the least code that does the job.
- Delete code that isn't used. Don't keep alternatives "just in case".
- No options, fallbacks or safeguards without a real failure mode, named in a comment or a test.
- Reuse before adding: check `src/cv/` and `src/demo/shared.ts` for an existing helper first.
- `src/cv/` stays free of DOM and MediaPipe imports, except `tracker.ts` and `input.ts`.

## Commands

Run in WSL from `~/research/blink2talk/vision`:

- `npm install --legacy-peer-deps` (npm 10.8 crashes without the flag)
- `npx --no-install tsc --noEmit`
- `npx --no-install vitest run`
- `npx --no-install vite --port 5173`, then open `/` (bench) or `/quadrants.html` in Chrome on Windows
