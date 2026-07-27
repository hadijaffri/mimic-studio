/* ==========================================================================
   normalize.js — THE most important file in this project.

   WHY THIS EXISTS
   ---------------
   The camera gives us hand positions "in the picture". If we trained on those
   raw numbers, the model would learn something useless, like:

       "thumbs up = thumb at x 0.31, y 0.62"

   ...which stops working the moment you step back, lean left, or tilt your
   wrist. The model would have memorised WHERE your hand was instead of WHAT
   SHAPE it was making.

   So before any training we rewrite every hand into a standard form. Think of
   it like handwriting: to compare two letter A's you first make them the same
   size and stand them upright. Then you can actually compare the shapes.

   THREE STEPS
   -----------
     1. CENTER  — slide the hand so the wrist sits at (0,0,0).
                  Kills "where in the frame".
     2. SCALE   — shrink/grow so the hand is always the same size.
                  Kills "how close to the camera".
     3. ROTATE  — (optional) stand the hand upright.
                  Kills "which way was my wrist tilted".

   COMPATIBILITY NOTE
   ------------------
   The previous version of Mimic Studio did steps 1 and 2 only, and saved the
   result as a flat list of 63 numbers. This file produces byte-identical
   output in that mode, so the 6,904 archived samples in legacy/ are still
   usable. Because the saved numbers ARE the centered+scaled point cloud,
   step 3 can also be applied to old samples after the fact.
   ========================================================================== */

/* ==========================================================================
   Small 3D helpers
   ========================================================================== */

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
}

function magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function unit(v) {
  const m = magnitude(v) || 1e-6;   // never divide by zero
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * The "cross product" makes a new arrow that points at a right angle to both
 * of the arrows you give it — like your thumb sticking out perpendicular to
 * your fingers. We use it to build a set of three arrows that are all at
 * right angles to each other, which is what "upright" is measured against.
 */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/* ==========================================================================
   Landmark indices we care about
   ========================================================================== */
const WRIST = 0;
const INDEX_KNUCKLE = 5;
const MIDDLE_KNUCKLE = 9;
const PINKY_KNUCKLE = 17;

/* ==========================================================================
   THE MAIN FUNCTION
   ========================================================================== */

/**
 * Turn 21 raw hand landmarks into 63 training-ready numbers.
 *
 * @param {Array<{x,y,z}>} landmarks   21 points straight from MediaPipe
 * @param {object}  options
 * @param {boolean} options.rotate     stand the hand upright (default false,
 *                                     to stay compatible with legacy data)
 * @returns {number[]} 63 numbers: x,y,z, x,y,z, … for all 21 points
 */
export function normalizeHand(landmarks, options = {}) {
  const { rotate = false } = options;
  if (!landmarks || landmarks.length < 21) return null;

  /* ---- STEP 1: CENTER -------------------------------------------------
     Subtract the wrist from every point. The wrist becomes exactly
     (0,0,0) and every other dot is now described as "this far FROM the
     wrist" rather than "this far from the corner of the picture".        */
  const wrist = landmarks[WRIST];
  let points = landmarks.map((p) => subtract(p, wrist));

  /* ---- STEP 2: SCALE --------------------------------------------------
     Find the dot furthest from the wrist — usually the middle fingertip —
     and divide everything by that distance. Now the furthest point always
     sits at distance exactly 1.0, so a hand 20cm from the camera and the
     same hand 3m away produce the same numbers.

     (We use "furthest point" rather than a fixed pair of knuckles because
     it never lands on zero, so it can't blow up the division.)           */
  let scale = 1e-6;
  for (const p of points) {
    const d = magnitude(p);
    if (d > scale) scale = d;
  }
  points = points.map((p) => ({ x: p.x / scale, y: p.y / scale, z: p.z / scale }));

  /* ---- STEP 3: ROTATE (optional) --------------------------------------
     We build our own set of 3 axes glued to the hand itself, then
     re-describe every dot using those axes instead of the camera's.

       up      = wrist  ->  middle knuckle   (along the palm)
       across  = pinky  ->  index knuckle    (across the palm)
       out     = up × across                 (straight out of the palm)

     "across" isn't perfectly at right angles to "up" on a real hand, so we
     rebuild it as out × up. That guarantees all three are mutually
     perpendicular — a proper coordinate system.

     Re-describing a point is then just three dot products: how far along
     each axis does this dot sit?                                          */
  if (rotate) {
    const up = unit(points[MIDDLE_KNUCKLE]);   // wrist is already at origin
    const across = unit(subtract(points[INDEX_KNUCKLE], points[PINKY_KNUCKLE]));

    const out = unit(cross(up, across));       // palm normal
    const right = unit(cross(out, up));        // fixed-up "across"

    points = points.map((p) => ({
      x: dot(p, right),
      y: dot(p, up),
      z: dot(p, out),
    }));
  }

  /* ---- Flatten to one long list, which is what the model wants -------- */
  const vec = [];
  for (const p of points) vec.push(p.x, p.y, p.z);
  return vec;
}

/**
 * Apply ONLY the rotation step to an already centered+scaled vector.
 *
 * This is what lets the archived legacy samples (which were saved after
 * steps 1 and 2) be upgraded to rotated form without the original video.
 *
 * @param {number[]} vec  63 numbers
 * @returns {number[]} 63 numbers, now rotated upright
 */
export function rotateExistingVector(vec) {
  if (!vec || vec.length !== 63) return vec;

  // Rebuild the flat list into points so we can reuse the same maths.
  const points = [];
  for (let i = 0; i < 63; i += 3) {
    points.push({ x: vec[i], y: vec[i + 1], z: vec[i + 2] });
  }

  const up = unit(points[MIDDLE_KNUCKLE]);
  const across = unit(subtract(points[INDEX_KNUCKLE], points[PINKY_KNUCKLE]));
  const out = unit(cross(up, across));
  const right = unit(cross(out, up));

  const rotated = [];
  for (const p of points) {
    rotated.push(dot(p, right), dot(p, up), dot(p, out));
  }
  return rotated;
}

/* ==========================================================================
   BODY POSE
   ==========================================================================
   Same three ideas, different anchor points. A body has no wrist to hang
   everything from, so we use the point midway between the hips as the
   center, and the distance from hips to shoulders (torso length) as the
   scale — that stays reliable whether you're sitting, standing, or waving
   your arms about.
   ========================================================================== */

const LEFT_SHOULDER = 11, RIGHT_SHOULDER = 12;
const LEFT_HIP = 23, RIGHT_HIP = 24;

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: ((a.z || 0) + (b.z || 0)) / 2 };
}

/**
 * Turn 33 body landmarks into 99 training-ready numbers.
 *
 * @returns {number[]|null} 99 numbers, or null if the key points are missing
 */
export function normalizePose(landmarks, options = {}) {
  const { rotate = false } = options;
  if (!landmarks || landmarks.length < 33) return null;

  const hipCenter = midpoint(landmarks[LEFT_HIP], landmarks[RIGHT_HIP]);
  const shoulderCenter = midpoint(landmarks[LEFT_SHOULDER], landmarks[RIGHT_SHOULDER]);

  /* STEP 1: center on the hips */
  let points = landmarks.map((p) => subtract(p, hipCenter));

  /* STEP 2: scale by torso length (hips -> shoulders) */
  const torso = magnitude(subtract(shoulderCenter, hipCenter)) || 1e-6;
  points = points.map((p) => ({ x: p.x / torso, y: p.y / torso, z: p.z / torso }));

  /* STEP 3: stand the body upright and face it forward */
  if (rotate) {
    const up = unit(points[LEFT_SHOULDER] && points[RIGHT_SHOULDER]
      ? midpoint(points[LEFT_SHOULDER], points[RIGHT_SHOULDER])
      : { x: 0, y: -1, z: 0 });
    const across = unit(subtract(points[LEFT_SHOULDER], points[RIGHT_SHOULDER]));
    const out = unit(cross(up, across));
    const right = unit(cross(out, up));

    points = points.map((p) => ({
      x: dot(p, right),
      y: dot(p, up),
      z: dot(p, out),
    }));
  }

  const vec = [];
  for (const p of points) vec.push(p.x, p.y, p.z);
  return vec;
}
