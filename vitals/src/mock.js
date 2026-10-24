// MOCK_VITALS: canned pulse/breathing in the exact `vitals` shape from CLAUDE.md.
// Confidence starts at 0 (nurse window renders "measuring") and ramps to ~0.9 over 10 s,
// so the UI's measuring state gets exercised every run.

const RAMP_MS = 10_000;

export function startMockVitals(onVitals, { intervalMs = 1000 } = {}) {
  const t0 = Date.now();
  const timer = setInterval(() => {
    const t = Date.now();
    const age = t - t0;
    const conf = age < 2000 ? 0 : Math.round(Math.min(0.9, 0.9 * (age / RAMP_MS)) * 100) / 100;
    const wobble = (period) => Math.sin((age / period) * 2 * Math.PI);
    onVitals({
      pulse: conf === 0 ? null : Math.round(72 + 4 * wobble(20_000)),
      breathing: conf === 0 ? null : Math.round(15 + 2 * wobble(30_000)),
      confidence: { pulse: conf, breathing: conf },
      t,
    });
  }, intervalMs);
  return () => clearInterval(timer);
}

if (process.argv[1] && process.argv[1].endsWith("mock.js")) {
  const stop = startMockVitals((v) => console.log(JSON.stringify(v)));
  process.on("SIGINT", () => { stop(); process.exit(0); });
}
