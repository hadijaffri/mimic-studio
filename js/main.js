/* ==========================================================================
   main.js — wires everything together.

   The shape of this app is a loop:

       grab a frame  ->  find hands & body  ->  draw them  ->  do it again

   It runs about 30-60 times a second. Recording hooks straight into that
   loop: while the record light is on, every frame also becomes a training
   example. Stage 3 will hook prediction in at the same spot.
   ========================================================================== */

import { startCamera, stopCamera, describeCameraError } from "./camera.js";
import {
  createLandmarkers,
  detectFrame,
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
} from "./landmarks.js";
import { resizeCanvas, drawFrame, drawRecordingIndicator, clear } from "./draw.js";
import { fingerCurls } from "./angles.js";
import { Recorder } from "./recorder.js";

/* ---------- grab the bits of the page we need ---------- */
const el = {
  stage:        document.getElementById("stage"),
  video:        document.getElementById("video"),
  canvas:       document.getElementById("overlay"),
  permission:   document.getElementById("permission"),
  permError:    document.getElementById("permission-error"),
  loading:      document.getElementById("loading"),
  loadingText:  document.getElementById("loading-text"),
  btnEnable:    document.getElementById("btn-enable"),
  btnStop:      document.getElementById("btn-stop"),
  toggleHands:  document.getElementById("toggle-hands"),
  togglePose:   document.getElementById("toggle-pose"),
  toggleBends:  document.getElementById("toggle-bends"),
  toggleMirror: document.getElementById("toggle-mirror"),
  statFps:      document.getElementById("stat-fps"),
  statHands:    document.getElementById("stat-hands"),
  statPose:     document.getElementById("stat-pose"),
  handList:     document.getElementById("hand-list"),
  curlBars:     document.getElementById("curl-bars"),

  // recording UI
  newCategory:   document.getElementById("new-category"),
  btnAddCat:     document.getElementById("btn-add-category"),
  addError:      document.getElementById("add-error"),
  categoryList:  document.getElementById("category-list"),
  duration:      document.getElementById("duration"),
  countdownSel:  document.getElementById("countdown"),
  warnings:      document.getElementById("balance-warnings"),
  totalSamples:  document.getElementById("total-samples"),
  totalClasses:  document.getElementById("total-classes"),
  btnClearAll:   document.getElementById("btn-clear-all"),
  recordOverlay: document.getElementById("record-overlay"),
  countNumber:   document.getElementById("countdown-number"),
  recordStatus:  document.getElementById("record-status"),
};

const ctx = el.canvas.getContext("2d");

/* ---------- everything the app needs to remember ---------- */
const state = {
  stream: null,
  landmarkers: null,
  running: false,
  rafId: null,
  lastVideoTime: -1,   // stops us processing the same frame twice
  frameTimes: [],      // recent frame timestamps, for the FPS counter
  latest: { hands: null, pose: null },
  capturedThisRun: 0,
};

/* The recorder owns all the gesture data. Whenever it changes, redraw the UI. */
const recorder = new Recorder({ onChange: renderCategories });

/* ==========================================================================
   Starting the camera
   ========================================================================== */

el.btnEnable.addEventListener("click", async () => {
  el.permError.hidden = true;
  el.btnEnable.disabled = true;
  el.btnEnable.textContent = "Starting…";

  try {
    // 1. Camera first — if the user says no, there is no point loading models.
    state.stream = await startCamera(el.video);
    el.permission.hidden = true;

    // 2. Then download the AI models (a few megabytes, cached afterwards).
    el.loading.hidden = false;
    state.landmarkers = await createLandmarkers((msg) => {
      el.loadingText.textContent = msg;
    });
    el.loading.hidden = true;

    // 3. Go.
    state.running = true;
    el.btnStop.disabled = false;
    loop();
  } catch (err) {
    console.error(err);
    el.loading.hidden = true;
    el.permission.hidden = false;
    el.permError.textContent = describeCameraError(err);
    el.permError.hidden = false;
    el.btnEnable.disabled = false;
    el.btnEnable.textContent = "Try again";
  }
});

el.btnStop.addEventListener("click", () => {
  state.running = false;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  recorder.stop();
  stopCamera(el.video, state.stream);
  state.stream = null;
  clear(ctx);

  el.btnStop.disabled = true;
  el.permission.hidden = false;
  el.btnEnable.disabled = false;
  el.btnEnable.textContent = "Turn my camera back on";
  el.statFps.textContent = "—";
  el.statHands.textContent = "0";
  el.statPose.textContent = "no";
  renderCategories();
});

/* Mirror toggle — pure CSS, both layers flip together. */
el.toggleMirror.addEventListener("change", () => {
  el.stage.classList.toggle("mirrored", el.toggleMirror.checked);
});
el.stage.classList.toggle("mirrored", el.toggleMirror.checked);

/* ==========================================================================
   Recording controls
   ========================================================================== */

function addCategoryFromInput() {
  const result = recorder.addCategory(el.newCategory.value);
  if (!result.ok) {
    el.addError.textContent = result.error;
    el.addError.hidden = false;
    return;
  }
  el.addError.hidden = true;
  el.newCategory.value = "";
  el.newCategory.focus();
}

el.btnAddCat.addEventListener("click", addCategoryFromInput);
el.newCategory.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addCategoryFromInput();
});

el.duration.addEventListener("change", () => {
  recorder.durationMs = Number(el.duration.value);
});
el.countdownSel.addEventListener("change", () => {
  recorder.countdownMs = Number(el.countdownSel.value);
});

el.btnClearAll.addEventListener("click", () => {
  if (!recorder.totalSamples) return;
  const ok = confirm(
    `Delete all ${recorder.totalSamples} samples across ` +
    `${recorder.labels.length} gestures? This cannot be undone.`
  );
  if (ok) recorder.clearAll();
});

/* The category list is rebuilt from scratch each time, so we use one click
   handler on the container instead of adding listeners to every button. */
el.categoryList.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const label = btn.dataset.label;
  if (!label) return;

  if (btn.dataset.action === "record") {
    if (!state.running) {
      el.addError.textContent = "Turn the camera on first.";
      el.addError.hidden = false;
      return;
    }
    if (recorder.recording || recorder.countdown > 0) {
      recorder.stop();
      return;
    }
    el.addError.hidden = true;
    state.capturedThisRun = 0;
    recorder.start(label);
  }

  if (btn.dataset.action === "delete") {
    const n = recorder.count(label);
    const ok = !n || confirm(`Delete "${label}" and its ${n} samples?`);
    if (ok) recorder.removeCategory(label);
  }
});

/* ==========================================================================
   The main loop
   ========================================================================== */

function loop() {
  if (!state.running) return;

  // requestAnimationFrame asks the browser: "call me again just before you
  // paint the next frame". That keeps us in step with the screen instead of
  // burning CPU on frames nobody will ever see.
  state.rafId = requestAnimationFrame(loop);

  const video = el.video;
  if (video.readyState < 2) return;   // no picture yet

  // Only work when the video has genuinely moved on to a new frame.
  // The screen may refresh at 120Hz while the camera only sends 30 frames a
  // second — without this check we'd run the models 4x more than necessary.
  if (video.currentTime === state.lastVideoTime) return;
  state.lastVideoTime = video.currentTime;

  resizeCanvas(el.canvas, video);

  // MediaPipe demands a timestamp in milliseconds that always increases.
  // performance.now() is a clock that only ever counts up, so it is safe.
  const timestampMs = performance.now();

  try {
    state.latest = detectFrame(state.landmarkers, video, timestampMs, {
      wantHands: el.toggleHands.checked,
      wantPose:  el.togglePose.checked,
    });
  } catch (err) {
    console.error("detect failed:", err);
    return;
  }

  // THIS is where a frame becomes training data.
  if (recorder.recording) {
    state.capturedThisRun += recorder.captureFrame(state.latest);
  }

  drawFrame(ctx, state.latest, { HAND_CONNECTIONS, POSE_CONNECTIONS }, {
    showBends: el.toggleBends.checked,
  });

  if (recorder.recording) {
    drawRecordingIndicator(ctx, recorder.progress);
  }

  updateReadout(state.latest);
  updateCurlBars(state.latest);
  updateRecordOverlay();
  tickFps();
}

/* ==========================================================================
   The numbers in the side panel
   ========================================================================== */

function tickFps() {
  const now = performance.now();
  state.frameTimes.push(now);

  // Keep only the timestamps from the last second, then count them.
  // That count IS the frames-per-second — no division needed.
  while (state.frameTimes.length && now - state.frameTimes[0] > 1000) {
    state.frameTimes.shift();
  }
  el.statFps.textContent = state.frameTimes.length;
}

function updateReadout(results) {
  const hands = (results.hands && results.hands.landmarks) || [];
  const poses = (results.pose && results.pose.landmarks) || [];

  el.statHands.textContent = hands.length;
  el.statPose.textContent = poses.length ? "yes" : "no";

  if (!hands.length) {
    el.handList.innerHTML =
      '<p class="muted">Hold your hands up where the camera can see them.</p>';
    return;
  }

  const handedness = (results.hands && results.hands.handednesses) || [];
  let html = "";

  for (let i = 0; i < hands.length; i++) {
    const info = handedness[i] && handedness[i][0];
    const label = info ? info.categoryName : "Hand";
    const score = info ? Math.round(info.score * 100) : 0;
    const cls = label === "Right" ? "hand-chip right" : "hand-chip";
    html += `<div class="${cls}">
      <span>${label} hand · ${hands[i].length} points</span>
      <span>${score}% sure</span>
    </div>`;
  }
  el.handList.innerHTML = html;
}

/** Live bar chart of how curled each finger is. */
function updateCurlBars(results) {
  const hands = (results.hands && results.hands.landmarks) || [];
  if (!hands.length) {
    el.curlBars.innerHTML =
      '<p class="muted">Hold a hand up to see every joint measured live.</p>';
    return;
  }

  const handedness = (results.hands && results.hands.handednesses) || [];
  let html = "";

  for (let i = 0; i < hands.length; i++) {
    const info = handedness[i] && handedness[i][0];
    const label = info ? info.categoryName : "Hand";
    const curls = fingerCurls(hands[i]);

    html += `<div class="curl-group"><h4>${label} hand</h4>`;
    for (const [finger, amount] of Object.entries(curls)) {
      const pct = Math.round(amount * 100);
      // Same green -> red idea as the rings, in CSS this time.
      const hue = 140 - amount * 140;
      html += `<div class="curl-row">
        <span class="curl-name">${finger}</span>
        <span class="curl-track">
          <span class="curl-fill" style="width:${pct}%;background:hsl(${hue},85%,58%)"></span>
        </span>
        <span class="curl-pct">${pct}%</span>
      </div>`;
    }
    html += `</div>`;
  }
  el.curlBars.innerHTML = html;
}

/** The big countdown / REC banner over the video. */
function updateRecordOverlay() {
  if (recorder.countdown > 0) {
    el.recordOverlay.hidden = false;
    el.countNumber.textContent = recorder.countdown;
    el.recordStatus.textContent = `Get ready to do "${recorder.activeLabel}"`;
  } else if (recorder.recording) {
    el.recordOverlay.hidden = false;
    el.countNumber.textContent = "●";
    el.countNumber.classList.add("rec");
    el.recordStatus.textContent =
      `Recording "${recorder.activeLabel}" — ${state.capturedThisRun} samples`;
  } else {
    el.recordOverlay.hidden = true;
    el.countNumber.classList.remove("rec");
  }
}

/* ==========================================================================
   The category list
   ========================================================================== */

function renderCategories() {
  const labels = recorder.labels;

  el.totalSamples.textContent = recorder.totalSamples;
  el.totalClasses.textContent = labels.length;

  if (!labels.length) {
    el.categoryList.innerHTML =
      '<p class="muted">Add a gesture name above, then press its <b>Record</b> ' +
      'button and do the gesture for 3 seconds.</p>';
    el.warnings.hidden = true;
    return;
  }

  // The biggest count sets the width of every bar, so they're comparable.
  const most = Math.max(...labels.map((l) => recorder.count(l)), 1);
  const busy = recorder.recording || recorder.countdown > 0;

  let html = "";
  for (const label of labels) {
    const n = recorder.count(label);
    const width = Math.round((n / most) * 100);
    const isActive = recorder.activeLabel === label && busy;

    html += `<div class="cat ${isActive ? "active" : ""}">
      <div class="cat-head">
        <span class="cat-name">${escapeHtml(label)}</span>
        <span class="cat-count">${n} <span class="muted-inline">samples</span></span>
      </div>
      <div class="cat-bar"><span style="width:${width}%"></span></div>
      <div class="cat-actions">
        <button class="btn btn-small ${isActive ? "btn-danger" : "btn-primary"}"
                data-action="record" data-label="${escapeHtml(label)}">
          ${isActive ? "Stop" : "● Record"}
        </button>
        <button class="btn btn-small" data-action="delete"
                data-label="${escapeHtml(label)}" ${busy ? "disabled" : ""}>
          Delete
        </button>
      </div>
    </div>`;
  }
  el.categoryList.innerHTML = html;

  // Balance warnings
  const balance = recorder.checkBalance();
  if (balance.warnings.length) {
    el.warnings.innerHTML = balance.warnings
      .map((w) => `<div class="warning">⚠️ ${escapeHtml(w)}</div>`)
      .join("");
    el.warnings.hidden = false;
  } else {
    el.warnings.hidden = true;
  }
}

/* Gesture names go straight into HTML, so escape them. Without this, naming a
   gesture `<img onerror=…>` would run code — the classic XSS mistake. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/* Draw the saved categories on first load. */
renderCategories();

/* Expose state for poking around in DevTools. */
window.mimic = { state, recorder };
