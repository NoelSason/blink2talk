import { defineConfig } from "vitest/config";

// test/layout.test.ts imports vision's QUADRANTS directly, so that the clockwise-vs-reading-order
// guard breaks if vision ever reorders. That reaches outside this package, so the repo root has to
// be readable. quadrant.ts has no runtime dependencies, so nothing else comes with it.
export default defineConfig({
  server: { fs: { allow: [".."] } },
});
