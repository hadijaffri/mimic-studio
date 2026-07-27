/* ==========================================================================
   landmarks.js — the two AI models that find your hands and your body.

   We use Google's "MediaPipe Tasks for Web". Two important things about it:

   1. It runs 100% inside your browser tab. Your video never leaves your
      computer — there is no server to send it to.
   2. It uses your graphics card (GPU) through WebGL, which is why it can
      keep up with live video instead of taking a second per frame.

   A "landmark" is just a labelled dot: point 0 is the wrist, point 4 is the
   thumb tip, and so on. The models hand us back lists of those dots.
   ========================================================================== */

import {
  FilesetResolver,
  HandLandmarker,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_ROOT =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

// The trained model files themselves, hosted by Google.
const HAND_MODEL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const POSE_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

/**
 * Download and switch on both models.
 *
 * @param {(msg:string)=>void} onProgress  called with friendly status text
 * @returns {Promise<{handLandmarker, poseLandmarker}>}
 */
export async function createLandmarkers(onProgress = () => {}) {
  onProgress("Loading the AI engine…");

  // The engine itself is WebAssembly — compiled code that runs near-native
  // speed in the browser. This downloads it once (then it is cached).
  const vision = await FilesetResolver.forVisionTasks(WASM_ROOT);

  onProgress("Loading the hand model…");
  const handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL,
      delegate: "GPU",          // use the graphics card
    },
    runningMode: "VIDEO",       // we feed it a stream, not single photos
    numHands: 2,                // <- both hands at once
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  onProgress("Loading the body model…");
  const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: POSE_MODEL,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  onProgress("Ready!");
  return { handLandmarker, poseLandmarker };
}

/**
 * Run both models on one frame of video.
 *
 * `timestampMs` must always go UP, never repeat and never go backwards.
 * The models use it to understand motion between frames — feed them the same
 * number twice and they throw an error. That is why main.js guards it.
 *
 * @returns {{hands: object|null, pose: object|null}}
 */
export function detectFrame(landmarkers, video, timestampMs, opts = {}) {
  const { wantHands = true, wantPose = true } = opts;

  let hands = null;
  let pose = null;

  if (wantHands && landmarkers.handLandmarker) {
    hands = landmarkers.handLandmarker.detectForVideo(video, timestampMs);
  }
  if (wantPose && landmarkers.poseLandmarker) {
    pose = landmarkers.poseLandmarker.detectForVideo(video, timestampMs);
  }

  return { hands, pose };
}

/* Which dots to join with lines, re-exported so draw.js doesn't need to
   import the whole MediaPipe bundle again. */
export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;
export const POSE_CONNECTIONS = PoseLandmarker.POSE_CONNECTIONS;

/* Friendly names for the 21 hand points, handy for debugging and for the
   UI later. Index 0 is the wrist — remember that one, the whole
   normalization step in Stage 3 is built around it. */
export const HAND_POINT_NAMES = [
  "wrist",
  "thumb base", "thumb joint 1", "thumb joint 2", "thumb tip",
  "index base", "index joint 1", "index joint 2", "index tip",
  "middle base", "middle joint 1", "middle joint 2", "middle tip",
  "ring base", "ring joint 1", "ring joint 2", "ring tip",
  "pinky base", "pinky joint 1", "pinky joint 2", "pinky tip",
];
