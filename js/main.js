/* ==========================================================================
   main.js — wires everything together.

   The shape of this app is a loop:

       grab a frame  ->  find hands & body  ->  draw them  ->  do it again

   It runs about 30-60 times a second. Later stages hook into the same loop:
   Stage 2 records landmarks from it, Stage 3 predicts from it.
   ========================================================================== */

import { startCamera, stopCamera, describeCameraError } from "./camera.js";
import {
  createLandmarkers,
  detectFrame,
  HAND_CONNECTIONS,
  POSE_CONNECTIONS,
} from "./landmarks.js";
import { resizeCanvas, drawFrame, clear } from "./draw.js";

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
  toggleMirror: document.getElementById("toggle-mirror"),
  statFps:      document.getElementById("stat-fps"),
  statHands:    document.getElementById("stat-hands"),
  statPose:     document.getElementById("stat-pose"),
  handList:     document.getElementById("hand-list"),
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
  latest: { hands: null, pose: null },  // Stages 2-4 will read this
};

/* ==========================================================================
   Starting up
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
});

/* Mirror toggle — pure CSS, both layers flip together. */
el.toggleMirror.addEventListener("change", () => {
  el.stage.classList.toggle("mirrored", el.toggleMirror.checked);
});
el.stage.classList.toggle("mirrored", el.toggleMirror.checked);

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

  drawFrame(ctx, state.latest, { HAND_CONNECTIONS, POSE_CONNECTIONS });
  updateReadout(state.latest);
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

/* Expose state for poking around in DevTools — genuinely useful while
   building the later stages. Try: mimic.latest.hands.landmarks[0][8] */
window.mimic = state;
