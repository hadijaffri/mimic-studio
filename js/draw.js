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

/**
 * Draw everything for one frame.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} results  { hands, pose } from detectFrame()
 * @param {object} conns    { HAND_CONNECTIONS, POSE_CONNECTIONS }
 * @param {object} opts     { showBends }
 */
export function drawFrame(ctx, results, conns, opts = {}) {
  const { showBends = true } = opts;
  clear(ctx);

  // Scale the line thickness with the picture size, so it looks the same
  // whether the camera is 480p or 1080p.
  const scale = ctx.canvas.width / 640;

  /* ---- body first, so it sits BEHIND the hands ---- */
  if (results.pose && results.pose.landmarks) {
    for (const person of results.pose.landmarks) {
      drawConnections(ctx, person, conns.POSE_CONNECTIONS, POSE_COLOR, 3 * scale);
      drawPoints(ctx, person, POSE_COLOR, 3.5 * scale);

      if (showBends) {
        drawBendRings(ctx, person, poseJointBends(person), 11 * scale, 3 * scale);
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

      drawConnections(ctx, list[i], conns.HAND_CONNECTIONS, color, 4 * scale);

      if (showBends) {
        drawBendRings(ctx, list[i], handJointBends(list[i]), 9 * scale, 2.5 * scale);
      }

      drawPoints(ctx, list[i], color, 4 * scale, FINGERTIPS);
    }
  }
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
