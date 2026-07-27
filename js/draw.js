/* ==========================================================================
   draw.js — painting the skeleton on top of the video.

   The models give every dot as a number between 0 and 1:
       x = 0    is the far left of the picture
       x = 1    is the far right
       y = 0    is the top
       y = 1    is the bottom

   These are called "normalized" coordinates, and they are deliberately NOT
   pixels — that way the same numbers work whether your camera is 640 wide or
   1920 wide. To draw, we just multiply by the canvas size.

   BENDING POINTS
   --------------
   Every joint that can bend gets a ring drawn around it. The ring fills up
   and turns from green to orange to red as the joint curls:

       ○  empty green ring  = straight
       ◐  half orange ring  = half bent
       ●  full red ring     = fully curled

   The maths behind that lives in angles.js.
   ========================================================================== */

import { handJointBends, poseJointBends } from "./angles.js";

const LEFT_COLOR  = "#4f8cff";  // blue
const RIGHT_COLOR = "#22d3a6";  // green
const POSE_COLOR  = "#8b93a7";  // grey, so hands stay the star of the show

/**
 * Make the canvas's internal pixel grid match the video's real size.
 *
 * A canvas has two different sizes: how big it LOOKS on screen (CSS) and how
 * many pixels it actually contains (width/height attributes). If those don't
 * match, drawings come out blurry or stretched. We copy the video's real
 * resolution so our dots land exactly where they should.
 */
export function resizeCanvas(canvas, video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (w && h && (canvas.width !== w || canvas.height !== h)) {
    canvas.width = w;
    canvas.height = h;
  }
}

export function clear(ctx) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

/**
 * Pick a colour for how bent a joint is.
 *
 * We slide along a hue wheel. In HSL colour, hue 140 is green and hue 0 is
 * red, with orange sitting around 30 on the way between them. So multiplying
 * the bend by 140 and subtracting gives us a smooth green -> orange -> red
 * fade with a single number.
 */
function bendColor(bend) {
  const hue = 140 - bend * 140;
  return `hsl(${hue}, 85%, 58%)`;
}

/**
 * Draw the lines between dots (the "bones").
 *
 * `connections` is a list of pairs like {start: 0, end: 1}, meaning
 * "draw a line from dot 0 to dot 1". MediaPipe gives us the correct
 * pairs so the hand looks like a hand and not a scribble.
 */
function drawConnections(ctx, landmarks, connections, color, lineWidth) {
  const { width: W, height: H } = ctx.canvas;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();

  for (const c of connections) {
    const a = landmarks[c.start];
    const b = landmarks[c.end];
    if (!a || !b) continue;
    ctx.moveTo(a.x * W, a.y * H);
    ctx.lineTo(b.x * W, b.y * H);
  }
  ctx.stroke();
}

/**
 * Draw the bend rings on every joint that can bend.
 *
 * The ring is an arc. A full circle is 2π radians, so drawing an arc of
 * `bend × 2π` gives us a ring that fills up in proportion to the bend —
 * like a loading spinner for each knuckle.
 */
function drawBendRings(ctx, landmarks, bends, radius, lineWidth) {
  const { width: W, height: H } = ctx.canvas;

  for (const joint of bends) {
    const p = landmarks[joint.index];
    if (!p) continue;
    if (p.visibility !== undefined && p.visibility < 0.5) continue;

    const cx = p.x * W;
    const cy = p.y * H;

    // Faint full circle behind, so you can see the "empty" part of the gauge.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    if (joint.bend <= 0.02) continue;   // nothing to show for a straight joint

    // The filled part. We start at -π/2 (12 o'clock) so it fills clockwise
    // from the top, which reads more naturally than starting at 3 o'clock.
    ctx.strokeStyle = bendColor(joint.bend);
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + joint.bend * Math.PI * 2);
    ctx.stroke();
  }
}

/**
 * Draw the dots themselves (the "joints").
 *
 * Fingertips are drawn bigger because they are the points you actually watch
 * when you check whether the tracking is any good.
 */
function drawPoints(ctx, landmarks, color, baseRadius, bigIndices = []) {
  const { width: W, height: H } = ctx.canvas;
  const big = new Set(bigIndices);

  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!p) continue;

    // Some models report a "visibility" score — how sure they are the point
    // is really there and not hidden behind your back. Skip the unsure ones
    // so we don't draw a leg that isn't in shot.
    if (p.visibility !== undefined && p.visibility < 0.5) continue;

    const r = big.has(i) ? baseRadius * 1.7 : baseRadius;

    // A dark outline makes the dots readable against a bright background.
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, r + 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

const FINGERTIPS = [4, 8, 12, 16, 20];  // thumb, index, middle, ring, pinky

/* ==========================================================================
   EXTRA DETAIL — more dots, more lines
   ==========================================================================

   MediaPipe gives us 21 dots per hand and that's all it will ever give us.
   But we can *draw* more than we're given, and a denser skeleton is genuinely
   easier to read — you can see twists and bends that a bare stick figure
   hides. Three tricks:

     1. SUB-DOTS   — small dots sprinkled along each bone
     2. LATTICE    — extra lines webbing the fingers together sideways
     3. ROSETTES   — a ring of tick marks around each bending joint

   None of this changes the data we record. It is purely so you can see what
   is happening. The model still trains on the original 21 points.
   ========================================================================== */

/* Lines ACROSS the hand, joining the matching joint on each finger. MediaPipe
   only connects dots along each finger and around the palm, so these sideways
   rungs are new — they turn the hand from 5 separate sticks into a mesh. */
const HAND_LATTICE = [
  // knuckle row (some of this the palm already covers, but it thickens nicely)
  [5, 9], [9, 13], [13, 17],
  // first joint row
  [6, 10], [10, 14], [14, 18],
  // second joint row
  [7, 11], [11, 15], [15, 19],
  // fingertip row
  [8, 12], [12, 16], [16, 20],
  // thumb tied into the index finger, so it stops floating on its own
  [2, 5], [3, 6],
];

/* Cross-bracing for the body: diagonals through the torso, plus lines that
   tie the arms to the opposite hip. Makes twisting really obvious. */
const POSE_LATTICE = [
  [11, 24], [12, 23],   // torso diagonals (an X across the chest)
  [11, 12], [23, 24],   // shoulder line and hip line, drawn again to thicken
  [13, 23], [14, 24],   // elbow to same-side hip
  [25, 26],             // knee to knee
];

/**
 * Walk part of the way from point `a` to point `b`.
 *
 * t = 0   gives you exactly a
 * t = 0.5 gives you the midpoint
 * t = 1   gives you exactly b
 *
 * This is called "linear interpolation", or lerp. It's just:
 * start + (how far you're going) × (what fraction of the way).
 */
function lerpPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * t,
  };
}

/**
 * Sprinkle small dots evenly along each bone.
 *
 * For `count` dots we step t through 1/(count+1), 2/(count+1), … so the dots
 * are evenly spaced with a gap at each end — otherwise the first and last
 * would land right on top of the real landmarks.
 */
function drawSubDots(ctx, landmarks, connections, color, count, radius) {
  const { width: W, height: H } = ctx.canvas;
  ctx.fillStyle = color;

  for (const c of connections) {
    const a = landmarks[c.start !== undefined ? c.start : c[0]];
    const b = landmarks[c.end !== undefined ? c.end : c[1]];
    if (!a || !b) continue;
    if (a.visibility !== undefined && a.visibility < 0.5) continue;
    if (b.visibility !== undefined && b.visibility < 0.5) continue;

    for (let i = 1; i <= count; i++) {
      const p = lerpPoint(a, b, i / (count + 1));
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Draw the sideways lattice lines. Thin and semi-transparent so they read as
 * scaffolding behind the real skeleton rather than competing with it.
 */
function drawLattice(ctx, landmarks, pairs, color, lineWidth) {
  const { width: W, height: H } = ctx.canvas;

  ctx.save();
  ctx.globalAlpha = 0.38;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();

  for (const [i, j] of pairs) {
    const a = landmarks[i];
    const b = landmarks[j];
    if (!a || !b) continue;
    if (a.visibility !== undefined && a.visibility < 0.5) continue;
    if (b.visibility !== undefined && b.visibility < 0.5) continue;
    ctx.moveTo(a.x * W, a.y * H);
    ctx.lineTo(b.x * W, b.y * H);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * A ring of little tick marks around each bending joint.
 *
 * To place `n` ticks evenly around a circle we space them a full turn (2π)
 * divided by n apart, then use cos/sin to turn each angle into a position:
 * x = center + radius × cos(angle), y = center + radius × sin(angle).
 *
 * The ticks that fall inside the "how bent" portion light up in the bend
 * colour; the rest stay dim. So the rosette is a second, chunkier read-out of
 * the same measurement the ring shows.
 */
function drawJointRosettes(ctx, landmarks, bends, radius, tickCount, tickSize) {
  const { width: W, height: H } = ctx.canvas;

  for (const joint of bends) {
    const p = landmarks[joint.index];
    if (!p) continue;
    if (p.visibility !== undefined && p.visibility < 0.5) continue;

    const cx = p.x * W;
    const cy = p.y * H;
    const lit = Math.round(joint.bend * tickCount);

    for (let i = 0; i < tickCount; i++) {
      // Start at 12 o'clock (-π/2) and go clockwise, matching the ring.
      const angle = -Math.PI / 2 + (i / tickCount) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;

      ctx.fillStyle = i < lit ? bendColor(joint.bend) : "rgba(255,255,255,0.28)";
      ctx.beginPath();
      ctx.arc(x, y, tickSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Draw everything for one frame.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} results  { hands, pose } from detectFrame()
 * @param {object} conns    { HAND_CONNECTIONS, POSE_CONNECTIONS }
 * @param {object} opts     { showBends }
 */
export function drawFrame(ctx, results, conns, opts = {}) {
  const { showBends = true, detail = 2 } = opts;
  clear(ctx);

  // Scale the line thickness with the picture size, so it looks the same
  // whether the camera is 480p or 1080p.
  const scale = ctx.canvas.width / 640;

  /* How much extra stuff to draw. Everything below reads these, so changing
     the level changes the whole picture consistently.

       1 = simple    the bare 21-point skeleton
       2 = detailed  + lattice + 2 sub-dots per bone
       3 = maximum   + more sub-dots + rosettes around every joint          */
  const subDots     = detail >= 3 ? 4 : detail >= 2 ? 2 : 0;
  const showLattice = detail >= 2;
  const showRosette = detail >= 3;

  /* ---- body first, so it sits BEHIND the hands ---- */
  if (results.pose && results.pose.landmarks) {
    for (const person of results.pose.landmarks) {
      if (showLattice) {
        drawLattice(ctx, person, POSE_LATTICE, POSE_COLOR, 2 * scale);
      }
      drawConnections(ctx, person, conns.POSE_CONNECTIONS, POSE_COLOR, 3 * scale);

      if (subDots) {
        drawSubDots(ctx, person, conns.POSE_CONNECTIONS, POSE_COLOR, subDots, 1.6 * scale);
      }

      drawPoints(ctx, person, POSE_COLOR, 3.5 * scale);

      if (showBends) {
        const bends = poseJointBends(person);
        drawBendRings(ctx, person, bends, 11 * scale, 3 * scale);
        if (showRosette) {
          drawJointRosettes(ctx, person, bends, 17 * scale, 12, 1.5 * scale);
        }
      }
    }
  }

  /* ---- then hands on top ---- */
  if (results.hands && results.hands.landmarks) {
    const list = results.hands.landmarks;
    const handedness = results.hands.handednesses || [];

    for (let i = 0; i < list.length; i++) {
      // MediaPipe tells us "Left" or "Right". Note it means YOUR real left
      // and right hand, which is already corrected for the mirror.
      const label = handedness[i] && handedness[i][0] ? handedness[i][0].categoryName : "Left";
      const color = label === "Right" ? RIGHT_COLOR : LEFT_COLOR;
      const hand = list[i];

      if (showLattice) {
        drawLattice(ctx, hand, HAND_LATTICE, color, 2.5 * scale);
      }
      drawConnections(ctx, hand, conns.HAND_CONNECTIONS, color, 4 * scale);

      if (subDots) {
        // Sub-dots go along the real bones AND along the lattice rungs, so
        // the whole mesh is dotted rather than just the fingers.
        drawSubDots(ctx, hand, conns.HAND_CONNECTIONS, color, subDots, 1.8 * scale);
        if (showLattice) {
          ctx.save();
          ctx.globalAlpha = 0.5;
          drawSubDots(ctx, hand, HAND_LATTICE, color, Math.max(1, subDots - 1), 1.4 * scale);
          ctx.restore();
        }
      }

      if (showBends) {
        const bends = handJointBends(hand);
        drawBendRings(ctx, hand, bends, 9 * scale, 2.5 * scale);
        if (showRosette) {
          drawJointRosettes(ctx, hand, bends, 14 * scale, 10, 1.4 * scale);
        }
      }

      drawPoints(ctx, hand, color, 4 * scale, FINGERTIPS);
    }
  }
}

/**
 * Count what we're putting on screen, split into what the camera actually
 * found versus what we drew on top. Purely for the readout under the video —
 * it keeps the distinction honest.
 */
export function countMarks(results, conns, opts = {}) {
  const { showBends = true, detail = 2 } = opts;

  const subDots     = detail >= 3 ? 4 : detail >= 2 ? 2 : 0;
  const showLattice = detail >= 2;
  const showRosette = detail >= 3;

  const hands = (results.hands && results.hands.landmarks) || [];
  const poses = (results.pose && results.pose.landmarks) || [];

  let real = 0, dots = 0, lines = 0;

  for (const h of hands) {
    real  += h.length;                                   // 21 tracked points
    lines += conns.HAND_CONNECTIONS.length;
    if (showLattice) lines += HAND_LATTICE.length;
    dots  += conns.HAND_CONNECTIONS.length * subDots;
    if (subDots && showLattice) {
      dots += HAND_LATTICE.length * Math.max(1, subDots - 1);
    }
    if (showBends && showRosette) dots += 15 * 10;        // 15 joints, 10 ticks
  }

  for (const p of poses) {
    real  += p.length;                                   // 33 tracked points
    lines += conns.POSE_CONNECTIONS.length;
    if (showLattice) lines += POSE_LATTICE.length;
    dots  += conns.POSE_CONNECTIONS.length * subDots;
    if (showBends && showRosette) dots += 8 * 12;         // 8 joints, 12 ticks
  }

  return { real, drawn: dots, lines, total: real + dots };
}

/**
 * A big red dot + border while recording, so it's obvious the app is
 * capturing and you're not just waving at nothing.
 */
export function drawRecordingIndicator(ctx, progress) {
  const { width: W, height: H } = ctx.canvas;
  const scale = W / 640;

  ctx.strokeStyle = "#ff5d6c";
  ctx.lineWidth = 6 * scale;
  ctx.strokeRect(0, 0, W, H);

  // Progress bar along the bottom.
  ctx.fillStyle = "rgba(255,93,108,0.9)";
  ctx.fillRect(0, H - 8 * scale, W * progress, 8 * scale);
}
