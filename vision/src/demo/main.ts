import { EyeInput, EyePipeline, type FaceTracker, type PipelineEvent, type PipelineOutput, type Point } from "../cv";
import { createLog, createTracker, drawEyeOverlay, el, fpsCounter, loadCalibration, saveJSON, VideoSource } from "./shared";

const STORAGE_KEY = "blink_to_talk.calibration";
const RING_LEN = 2 * Math.PI * 40;
const TRACE_MS = 10_000;
const SCAN_STEP_MS = 1200;
const SCAN_STEP_FATIGUED_MS = 1800;

const video = el<HTMLVideoElement>("video");
const stage = el("stage");
const overlay = el<HTMLCanvasElement>("overlay");
const trace = el<HTMLCanvasElement>("trace");
const statusEl = el("status");
const btnCam = el<HTMLButtonElement>("btn-cam");
const btnCalib = el<HTMLButtonElement>("btn-calib");
const fileInput = el<HTMLInputElement>("file");
const ring = el<SVGCircleElement>("ring");
const blinkStateEl = el("blink-state");
const gazeTiles = { left: el("g-left"), center: el("g-center"), right: el("g-right") };
const gazeStateEl = el("gaze-state");
const fatigueEl = el("fatigue");
const optionEls = [...el("options").querySelectorAll("li")];
const selectMs = el<HTMLInputElement>("select-ms");
const selectMsVal = el("select-ms-val");
const scanOn = el<HTMLInputElement>("scan-on");
const countsEl = el("counts");
const calibEl = el("calib");
const calibTarget = el("calib-target");
const calibText = el("calib-text");
const calibCount = el("calib-count");
const calibBar = el("calib-bar");
const log = createLog(el("log"));

// The spec's fatigue baseline is 5 min; 1 min here so fatigue can be exercised at the bench.
const pipeline = new EyePipeline({ calibration: { layout: "leftRight" }, fatigue: { baselineMs: 60_000 } });
const source = new VideoSource(video);
const fps = fpsCounter();
let tracker: FaceTracker | null = null;
let input: EyeInput | null = null;

const traceBuf: { t: number; o: number; closed: boolean }[] = [];
const counts: Record<string, number> = {};
const scan = { index: 0, lastStep: 0, armed: null as number | null, stepMs: SCAN_STEP_MS };

// ---------- setup ----------

async function init(): Promise<void> {
  try {
    tracker = await createTracker();
    setStatus(`Model ready (${tracker.delegate}). Start the webcam or load a video.`);
  } catch (err) {
    setStatus(`Face model failed to load: ${err}. Run \`npm run assets\`.`, true);
    return;
  }
  const saved = loadCalibration(STORAGE_KEY, "leftRight");
  if (saved) {
    pipeline.useCalibration(saved);
    btnCalib.textContent = "Recalibrate";
    log("Loaded saved calibration. Recalibrate for a new person, camera position or lighting.");
  }
  paintOptions();
}

async function useSource(start: () => Promise<void>, mirror: boolean): Promise<void> {
  if (!tracker) return;
  input?.stop();
  try {
    await start();
  } catch (err) {
    setStatus(`Could not open video: ${err}`, true);
    return;
  }
  stage.classList.toggle("mirror", mirror);
  input = new EyeInput({ video, tracker, pipeline, onFrame: render });
  input.start();
  btnCalib.disabled = false;
  if (pipeline.mode === "idle") log(`Press Calibrate (about ${Math.round(pipeline.calibrationMs / 1000)} s) before blink and gaze detection start.`);
}

btnCam.onclick = () => useSource(() => source.webcam(), true);

// Mock camera: a recorded clip of a consenting teammate, looped.
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (file) useSource(() => source.file(file), false);
};

btnCalib.onclick = () => {
  pipeline.startCalibration();
  log("Calibrating…");
};

selectMs.oninput = () => {
  pipeline.setBlinkConfig({ selectMs: Number(selectMs.value) });
  selectMsVal.textContent = `${selectMs.value} ms`;
};

// ---------- per frame ----------

function render(out: PipelineOutput, landmarks?: Point[]): void {
  const f = fps(out.t);
  if (f !== null && !statusEl.classList.contains("error")) {
    setStatus(`${tracker?.delegate} · ${f} fps · ${out.mode}${out.faceFound ? "" : " · no face"}`);
  }
  drawEyeOverlay(overlay, video, landmarks);
  pushTrace(out);
  drawTrace(out.t);
  renderCalibration(out);
  for (const e of out.events) handleEvent(e);
  renderBlink(out);
  renderGaze(out);
  renderFatigue(out);
  scanTick(out);
}

function handleEvent(e: PipelineEvent): void {
  counts[e.type] = (counts[e.type] ?? 0) + 1;
  countsEl.textContent = ["select", "blink", "gaze", "rest"].map((k) => `${k} ${counts[k] ?? 0}`).join(" · ");
  switch (e.type) {
    case "holdStart":
      scan.armed = scan.index; // select what was highlighted when the hold started
      return;
    case "select": {
      const i = scan.armed ?? scan.index;
      choose(i);
      log(`select via ${e.via} (${Math.round(e.durationMs)} ms) → "${optionEls[i].textContent}"`);
      return;
    }
    case "rest":
      log("rest: eyes closed 3 s → the app would pause");
      return;
    case "restEnd":
      log(`rest ended (${(e.durationMs / 1000).toFixed(1)} s)`);
      return;
    case "gaze":
      stepScan(e.direction === "left" ? -1 : 1, e.t);
      log(`gaze ${e.direction}`);
      return;
    case "fatigue":
      scan.stepMs = e.level === "elevated" ? SCAN_STEP_FATIGUED_MS : SCAN_STEP_MS;
      log(`fatigue ${e.level}${e.reasons.length ? `: ${e.reasons.join(", ")}` : ""} → scan step ${scan.stepMs} ms`);
      return;
    case "calibrated": {
      const { thresholds: th, openBaseline, gaze, squint, warnings } = e.result;
      saveJSON(STORAGE_KEY, e.result);
      btnCalib.textContent = "Recalibrate";
      log(
        `calibrated: open ${openBaseline.toFixed(3)}, close < ${th.close.toFixed(3)}, reopen > ${th.open.toFixed(3)}` +
          (gaze ? `, gaze L ${gaze.left.toFixed(3)} C ${gaze.center.toFixed(3)} R ${gaze.right.toFixed(3)}` : "") +
          (squint ? `, squint on ${squint.feature} ${squint.on.toFixed(3)}` : ""),
      );
      warnings.forEach((w) => log(`⚠ ${w}`));
      return;
    }
    case "calibrationFailed":
      log(`⚠ calibration failed: ${e.reason}`);
      return;
    case "faceLost":
    case "faceFound":
      log(e.type === "faceLost" ? "face lost" : "face found");
      return;
  }
}

function renderCalibration(out: PipelineOutput): void {
  const c = out.calibration;
  const active = out.mode === "calibrating" && !!c && c.phase !== "done";
  calibEl.classList.toggle("hidden", !active);
  if (!active || !c) return;
  calibTarget.className = c.phase === "left" || c.phase === "right" ? c.phase : "";
  calibText.textContent =
    c.phase === "ready"
      ? "Get ready: look at the dot"
      : c.phase === "squint"
        ? "Squint as if reading small print, and keep looking at the dot"
        : c.phase === "center"
          ? "Look at the dot"
          : `Look at the dot on the ${c.phase.toUpperCase()}`;
  calibCount.textContent = String(Math.max(1, Math.ceil(c.remainingMs / 1000)));
  calibBar.style.width = `${c.progress * 100}%`;
}

function renderBlink(out: PipelineOutput): void {
  const b = out.blink;
  ring.style.strokeDashoffset = String(RING_LEN * (1 - (b?.progress ?? 0)));
  ring.classList.toggle("armed", !!b && b.progress >= 1);
  if (!b) {
    blinkStateEl.textContent = out.mode === "running" ? "no face" : "not calibrated";
    return;
  }
  const ear = Number.isFinite(b.ear) ? b.ear.toFixed(3) : "—";
  const what = b.engaged ? `${b.closed ? "closed" : "squint"} ${Math.round(b.heldMs)} ms` : "open";
  blinkStateEl.textContent = `${what}${b.refractory ? " · refractory" : ""} · ${ear}`;
}

function renderGaze(out: PipelineOutput): void {
  const g = out.gaze;
  const calibratedWithoutGaze = out.mode === "running" && !pipeline.calibration?.gaze;
  for (const [dir, tile] of Object.entries(gazeTiles)) {
    tile.classList.toggle("active", g?.direction === dir);
    tile.classList.toggle("off", calibratedWithoutGaze);
    tile.style.setProperty("--p", String(g?.direction === dir ? g.dwellProgress : 0));
  }
  gazeStateEl.textContent = g
    ? `${g.direction} · ratio ${Number.isFinite(g.ratio) ? g.ratio.toFixed(3) : "—"}`
    : calibratedWithoutGaze
      ? "off (recalibrate)"
      : "—";
}

function renderFatigue(out: PipelineOutput): void {
  const f = out.fatigue;
  if (!f) {
    fatigueEl.textContent = "—";
    return;
  }
  const n = (v: number, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : "—");
  const lines = [
    f.level === "baseline"
      ? `measuring baseline… ${Math.ceil(f.baselineRemainingMs / 1000)} s left`
      : `<span class="level-${f.level}">${f.level}</span>${f.reasons.length ? ` (${f.reasons.join(", ")})` : ""}`,
    `blinks/min ${n(f.blinksPerMin, 1)}${f.baseline ? ` (base ${n(f.baseline.blinksPerMin, 1)})` : ""}`,
    `mean blink ${n(f.meanBlinkMs)} ms${f.baseline ? ` (base ${n(f.baseline.meanBlinkMs)})` : ""}`,
    `openness ${n(f.openness, 3)}${f.baseline ? ` (base ${n(f.baseline.openness, 3)})` : ""}`,
  ];
  fatigueEl.innerHTML = lines.join("<br>");
}

// ---------- scan test ----------

function scanTick(out: PipelineOutput): void {
  if (!scanOn.checked || out.mode !== "running") return;
  if (out.blink?.engaged) {
    scan.lastStep = out.t; // keep the highlight still during a hold
    return;
  }
  if (out.t - scan.lastStep >= scan.stepMs) stepScan(1, out.t);
}

function stepScan(delta: number, t: number): void {
  scan.index = (scan.index + delta + optionEls.length) % optionEls.length;
  scan.lastStep = t;
  paintOptions();
}

function paintOptions(): void {
  optionEls.forEach((li, i) => li.classList.toggle("current", i === scan.index));
}

function choose(i: number): void {
  optionEls[i].classList.add("chosen");
  setTimeout(() => optionEls[i].classList.remove("chosen"), 1000);
}

// ---------- trace ----------

function pushTrace(out: PipelineOutput): void {
  if (Number.isFinite(out.ear)) traceBuf.push({ t: out.t, o: out.ear, closed: !!out.blink?.engaged });
  while (traceBuf.length && traceBuf[0].t < out.t - TRACE_MS) traceBuf.shift();
}

function drawTrace(now: number): void {
  const dpr = devicePixelRatio || 1;
  const w = Math.round(trace.clientWidth * dpr);
  const h = Math.round(trace.clientHeight * dpr);
  if (trace.width !== w || trace.height !== h) {
    trace.width = w;
    trace.height = h;
  }
  const ctx = trace.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const cal = pipeline.calibration;
  const yMax = 0.45;
  const x =(t: number) => w - ((now - t) / TRACE_MS) * w;
  const y = (v: number) => h - (Math.min(v, yMax) / yMax) * (h - 8) - 4;

  ctx.fillStyle = css.getPropertyValue("--closed");
  for (let i = 1; i < traceBuf.length; i++) {
    if (traceBuf[i].closed) ctx.fillRect(x(traceBuf[i - 1].t), 0, x(traceBuf[i].t) - x(traceBuf[i - 1].t) + 1, h);
  }

  if (cal) {
    ctx.strokeStyle = css.getPropertyValue("--muted");
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.lineWidth = dpr;
    const lines = [cal.thresholds.close, cal.thresholds.open];
    if (cal.squint?.feature === "ear") lines.push(cal.squint.on);
    for (const v of lines) {
      ctx.beginPath();
      ctx.moveTo(0, y(v));
      ctx.lineTo(w, y(v));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = css.getPropertyValue("--accent");
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  traceBuf.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.o)) : ctx.moveTo(x(p.t), y(p.o))));
  ctx.stroke();
}

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
}

init();
