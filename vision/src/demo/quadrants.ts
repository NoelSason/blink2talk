import {
  EyeInput,
  EyePipeline,
  QUADRANTS,
  QUADRANT_TARGETS,
  TARGET_POSITIONS,
  type FaceTracker,
  type PipelineEvent,
  type PipelineOutput,
  type Point,
  type Quadrant,
} from "../cv";
import { createLog, createTracker, drawEyeOverlay, el, fpsCounter, loadCalibration, loadJSON, saveJSON, VideoSource } from "./shared";

const CALIB_KEY = "blink_to_talk.quadrantCalibration";
const OPTIONS_KEY = "blink_to_talk.quadrantOptions";
const LABEL: Record<Quadrant, string> = {
  topLeft: "TOP LEFT",
  topRight: "TOP RIGHT",
  bottomRight: "BOTTOM RIGHT",
  bottomLeft: "BOTTOM LEFT",
};

const video = el<HTMLVideoElement>("video");
const overlay = el<HTMLCanvasElement>("overlay");
const statusEl = el("status");
const btnCam = el<HTMLButtonElement>("btn-cam");
const btnCalib = el<HTMLButtonElement>("btn-calib");
const btnEdit = el<HTMLButtonElement>("btn-edit");
const fileInput = el<HTMLInputElement>("file");
const selectMs = el<HTMLInputElement>("select-ms");
const selectMsVal = el("select-ms-val");
const showCam = el<HTMLInputElement>("show-cam");
const layoutEl = el("layout");
const quadsEl = el("quads");
const restZone = el("rest-zone");
const lastEl = el("last");
const readoutEl = el("readout");
const restEl = el("rest");
const calibEl = el("calib");
const calibTarget = el("calib-target");
const calibText = el("calib-text");
const calibCount = el("calib-count");
const calibBar = el("calib-bar");
const log = createLog(el("log"));

const boxes = {} as Record<Quadrant, { box: HTMLElement; text: HTMLElement; bar: HTMLElement }>;
for (const q of QUADRANTS) {
  const box = quadsEl.querySelector<HTMLElement>(`[data-q="${q}"]`)!;
  boxes[q] = { box, text: box.querySelector(".text")!, bar: box.querySelector(".hold-bar")! };
}

const pipeline = new EyePipeline({ calibration: { layout: "quadrants" }, fatigue: { baselineMs: 60_000 } });
const source = new VideoSource(video);
const fps = fpsCounter();
let tracker: FaceTracker | null = null;
let input: EyeInput | null = null;
/** Box that had focus when the current hold started; its bar fills. */
let holdingOn: Quadrant | null = null;
let editing = false;

/** Area coordinates ([-1, 1], +y down) → viewport pixels. */
function toViewport(x: number, y: number): { left: number; top: number } {
  const rect = quadsEl.getBoundingClientRect();
  return { left: rect.left + ((x + 1) / 2) * rect.width, top: rect.top + ((y + 1) / 2) * rect.height };
}

// ---------- setup ----------

async function init(): Promise<void> {
  const saved = loadJSON<Partial<Record<Quadrant, string>>>(OPTIONS_KEY);
  if (saved) for (const q of QUADRANTS) if (typeof saved[q] === "string") boxes[q].text.textContent = saved[q]!;

  try {
    tracker = await createTracker();
    setStatus(`Model ready (${tracker.delegate}). Start the webcam or load a video.`);
  } catch (err) {
    setStatus(`Face model failed to load: ${err}. Run \`npm run assets\`.`, true);
    return;
  }
  const cal = loadCalibration(CALIB_KEY, "quadrants");
  // A calibration saved by the short-lived corner model has no centroids; recalibrate instead.
  if (cal?.quadrants?.centroids) {
    pipeline.useCalibration(cal);
    btnCalib.textContent = "Recalibrate";
    log("Loaded saved calibration. Recalibrate for a new person, camera position or lighting.");
  }
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
  el("stage").classList.toggle("mirror", mirror);
  input = new EyeInput({ video, tracker, pipeline, onFrame: render });
  input.start();
  btnCalib.disabled = false;
  if (pipeline.mode === "idle") log(`Press Calibrate (about ${Math.round(pipeline.calibrationMs / 1000)} s) to start.`);
}

btnCam.onclick = () => useSource(() => source.webcam(), true);
fileInput.onchange = () => {
  const file = fileInput.files?.[0];
  if (file) useSource(() => source.file(file), false);
};

btnCalib.onclick = () => {
  pipeline.startCalibration();
  log("Calibrating: center, each box, then a squint.");
};

btnEdit.onclick = () => {
  editing = !editing;
  btnEdit.textContent = editing ? "Done editing" : "Edit options";
  for (const q of QUADRANTS) boxes[q].text.contentEditable = String(editing);
  if (editing) boxes.topLeft.text.focus();
  else {
    saveJSON(OPTIONS_KEY, Object.fromEntries(QUADRANTS.map((q) => [q, boxes[q].text.textContent?.trim() ?? ""])));
    log("Options saved.");
  }
};

selectMs.oninput = () => {
  pipeline.setBlinkConfig({ selectMs: Number(selectMs.value) });
  selectMsVal.textContent = `${selectMs.value} ms`;
};

// Keep the camera panel rendered when hidden (moved off-screen, not display:none) so the video keeps decoding.
showCam.onchange = () => layoutEl.classList.toggle("no-cam", !showCam.checked);

// ---------- per frame ----------

function render(out: PipelineOutput, landmarks?: Point[]): void {
  const f = fps(out.t);
  if (f !== null && !statusEl.classList.contains("error")) {
    setStatus(`${tracker?.delegate} · ${f} fps · ${out.mode}${out.faceFound ? "" : " · no face"}`);
  }
  if (showCam.checked) drawEyeOverlay(overlay, video, landmarks);
  renderCalibration(out);
  for (const e of out.events) handleEvent(e, out);
  renderQuads(out);
  renderReadout(out);
}

function handleEvent(e: PipelineEvent, out: PipelineOutput): void {
  switch (e.type) {
    case "holdStart":
      holdingOn = out.quadrant?.focus ?? null;
      return;
    case "quadrantSelect":
      if (editing) return;
      if (e.quadrant) {
        const text = boxes[e.quadrant].text.textContent?.trim() ?? "";
        flash(e.quadrant);
        lastEl.textContent = `Selected: "${text}"`;
        log(`select via ${e.via} → ${e.quadrant} "${text}"`);
      } else {
        lastEl.textContent = "Held at the center: nothing selected";
        log(`select via ${e.via} with no box focused (center): ignored`);
      }
      return;
    case "rest":
      restEl.classList.remove("hidden");
      log("rest: eyes closed 3 s");
      return;
    case "restEnd":
      restEl.classList.add("hidden");
      log(`rest ended (${(e.durationMs / 1000).toFixed(1)} s)`);
      return;
    case "fatigue":
      log(`fatigue ${e.level}${e.reasons.length ? `: ${e.reasons.join(", ")}` : ""}`);
      return;
    case "calibrated": {
      saveJSON(CALIB_KEY, e.result);
      btnCalib.textContent = "Recalibrate";
      const acc = e.result.quadrants?.accuracy;
      log(
        `calibrated: close < ${e.result.thresholds.close.toFixed(3)}` +
          (acc ? `; accuracy ${QUADRANT_TARGETS.map((k) => `${k} ${Math.round(acc[k] * 100)}%`).join(", ")}` : "") +
          `; squint ${e.result.squint ? `on (${e.result.squint.feature})` : "off"}`,
      );
      e.result.warnings.forEach((w) => log(`⚠ ${w}`));
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

function renderQuads(out: PipelineOutput): void {
  const q = out.quadrant;
  const b = out.blink;
  if (!b?.engaged) holdingOn = null;
  for (const k of QUADRANTS) {
    const { box, bar } = boxes[k];
    const focused = q?.focus === k;
    box.classList.toggle("focus", focused);
    // Light fill while a look is settling on a box that isn't focused yet.
    box.style.setProperty("--look", String(q?.looking === k && !focused ? q.focusProgress : 0));
    const holding = holdingOn === k && b ? b.progress : 0;
    bar.style.width = `${holding * 100}%`;
    bar.classList.toggle("armed", holding >= 1);
  }
  restZone.classList.toggle("active", q?.looking === "center");
}

function renderReadout(out: PipelineOutput): void {
  const q = out.quadrant;
  const b = out.blink;
  const cal = pipeline.calibration?.quadrants;
  const lines = [
    `mode ${out.mode}${out.faceFound ? "" : " · no face"}`,
    q ? `looking ${q.looking ?? "—"} · focus ${q.focus ?? "none"}` : "not calibrated",
    b ? `eyes ${b.engaged ? `${b.closed ? "closed" : "squint"} ${Math.round(b.heldMs)} ms` : "open"} · EAR ${Number.isFinite(b.ear) ? b.ear.toFixed(3) : "—"}` : "",
    cal ? `features ${cal.dims.join(", ")}` : "",
    out.fatigue && out.fatigue.level !== "baseline" ? `fatigue ${out.fatigue.level}` : "",
  ];
  readoutEl.innerHTML = lines.filter(Boolean).join("<br>");
}

function renderCalibration(out: PipelineOutput): void {
  const c = out.calibration;
  const active = out.mode === "calibrating" && !!c && c.phase !== "done";
  calibEl.classList.toggle("hidden", !active);
  if (!active || !c) return;
  const box = (QUADRANTS as readonly string[]).includes(c.phase) ? (c.phase as Quadrant) : null;
  const [x, y] = TARGET_POSITIONS[box ?? "center"];
  const v = toViewport(x, y);
  calibTarget.style.left = `${v.left}px`;
  calibTarget.style.top = `${v.top}px`;
  calibText.textContent =
    c.phase === "ready"
      ? "Get ready: look at the center dot"
      : c.phase === "squint"
        ? "Squint as if reading small print, and keep looking at the dot"
        : box
          ? `Look at the dot in the ${LABEL[box]} box`
          : "Look at the center dot";
  calibCount.textContent = String(Math.max(1, Math.ceil(c.remainingMs / 1000)));
  calibBar.style.width = `${c.progress * 100}%`;
}

function flash(q: Quadrant): void {
  boxes[q].box.classList.add("chosen");
  setTimeout(() => boxes[q].box.classList.remove("chosen"), 1500);
}

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", error);
}

init();
