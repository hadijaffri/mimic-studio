/* ==========================================================================
   angles.js — working out how bent each joint is.

   THE IDEA
   --------
   A joint is a corner. To measure a corner you need three dots: the joint
   itself, plus the dot before it and the dot after it.

   For your index finger's middle knuckle:

        A (5) ---- B (6)
                    \
                     \
                      C (7)

   B is the joint. We draw one arrow from B back to A, and another from B out
   to C, then measure the angle between those two arrows.

       - Finger held straight  ->  the arrows point in opposite
                                   directions  ->  angle ≈ 180°
       - Finger curled tight   ->  the arrows point almost the same
                                   way        ->  angle ≈ 20°

   THE MATH
   --------
   The "dot product" of two arrows tells you how much they point the same way:

       dot(u, v) = |u| × |v| × cos(angle)

   Rearranged, that gives us the angle:

       angle = arccos( dot(u, v) / (|u| × |v|) )

   Dividing by the lengths makes it independent of how big the hand is, which
   is exactly what we want — a bent finger is bent whether it's near the
   camera or far away.
   ========================================================================== */

/** Arrow (vector) pointing from point `a` to point `b`, in 3D. */
function vectorBetween(a, b) {
  return { x: b.x - a.x, y: b.y - a.y, z: (b.z || 0) - (a.z || 0) };
}

function dot(u, v) {
  return u.x * v.x + u.y * v.y + u.z * v.z;
}

function length(u) {
  return Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z);
}

/**
 * The angle at corner B, in degrees. 180 = perfectly straight, 0 = folded flat.
 *
 * @returns {number} degrees, or 180 if the points sit on top of each other
 */
export function jointAngle(a, b, c) {
  if (!a || !b || !c) return 180;

  const toA = vectorBetween(b, a);
  const toC = vectorBetween(b, c);

  const lenA = length(toA);
  const lenC = length(toC);
  if (lenA === 0 || lenC === 0) return 180;   // can't measure a zero-length arrow

  // cos of the angle. Floating-point rounding can nudge this to 1.0000000002,
  // and arccos(1.0000000002) is NaN — so we clamp it into [-1, 1] first.
  let cosine = dot(toA, toC) / (lenA * lenC);
  cosine = Math.max(-1, Math.min(1, cosine));

  return (Math.acos(cosine) * 180) / Math.PI;
}

/**
 * Turn an angle into a simple 0..1 "how bent is it" number, which is much
 * easier to draw with than raw degrees.
 *
 *     0 = straight as a board
 *     1 = curled up as far as a finger goes
 *
 * Fingers never actually reach 0°, and they read as "straight" a bit before
 * 180°, so we treat 30° as fully bent and 175° as fully straight and stretch
 * everything in between across the 0..1 range.
 */
export function bendAmount(angleDegrees) {
  const FULLY_BENT = 30;
  const FULLY_STRAIGHT = 175;

  const t = (FULLY_STRAIGHT - angleDegrees) / (FULLY_STRAIGHT - FULLY_BENT);
  return Math.max(0, Math.min(1, t));
}

/* --------------------------------------------------------------------------
   WHICH POINTS FORM A JOINT

   Each entry is [before, joint, after]. The middle number is the dot that
   actually bends; the other two are just there so we can measure the corner.

   A hand has 21 dots. 15 of them bend (3 per finger), and 6 don't:
   the wrist (0) and the five fingertips (4, 8, 12, 16, 20).
   -------------------------------------------------------------------------- */
export const HAND_JOINTS = [
  // thumb
  [0, 1, 2], [1, 2, 3], [2, 3, 4],
  // index
  [0, 5, 6], [5, 6, 7], [6, 7, 8],
  // middle
  [0, 9, 10], [9, 10, 11], [10, 11, 12],
  // ring
  [0, 13, 14], [13, 14, 15], [14, 15, 16],
  // pinky
  [0, 17, 18], [17, 18, 19], [18, 19, 20],
];

/* The body's bendy bits. Same [before, joint, after] pattern.
   MediaPipe's pose model numbers these; 13 is the left elbow, 25 the left
   knee, and so on. */
export const POSE_JOINTS = [
  [11, 13, 15],  // left elbow
  [12, 14, 16],  // right elbow
  [13, 11, 23],  // left shoulder
  [14, 12, 24],  // right shoulder
  [11, 23, 25],  // left hip
  [12, 24, 26],  // right hip
  [23, 25, 27],  // left knee
  [24, 26, 28],  // right knee
];

/**
 * Measure every joint on one hand at once.
 *
 * @returns {Array<{index:number, angle:number, bend:number}>}
 */
export function handJointBends(landmarks) {
  const out = [];
  for (const [a, b, c] of HAND_JOINTS) {
    const angle = jointAngle(landmarks[a], landmarks[b], landmarks[c]);
    out.push({ index: b, angle, bend: bendAmount(angle) });
  }
  return out;
}

/** Same, for a body. */
export function poseJointBends(landmarks) {
  const out = [];
  for (const [a, b, c] of POSE_JOINTS) {
    const angle = jointAngle(landmarks[a], landmarks[b], landmarks[c]);
    out.push({ index: b, angle, bend: bendAmount(angle) });
  }
  return out;
}

/**
 * A quick summary of one hand: how curled each finger is, 0..1.
 *
 * We add up the bend of a finger's three joints and average them, which is a
 * surprisingly good "is this finger open or closed?" detector — handy for the
 * on-screen readout, and a nice sanity check that the maths is working.
 */
export function fingerCurls(landmarks) {
  const bends = handJointBends(landmarks);
  const names = ["thumb", "index", "middle", "ring", "pinky"];
  const curls = {};

  for (let f = 0; f < 5; f++) {
    // The joints are stored in finger order, 3 per finger.
    const three = bends.slice(f * 3, f * 3 + 3);
    const total = three.reduce((sum, j) => sum + j.bend, 0);
    curls[names[f]] = total / 3;
  }
  return curls;
}
