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
   ========================================================================== */

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
 */
export function drawFrame(ctx, results, conns) {
  clear(ctx);

  // Scale the line thickness with the picture size, so it looks the same
  // whether the camera is 480p or 1080p.
  const scale = ctx.canvas.width / 640;

  /* ---- body first, so it sits BEHIND the hands ---- */
  if (results.pose && results.pose.landmarks) {
    for (const person of results.pose.landmarks) {
      drawConnections(ctx, person, conns.POSE_CONNECTIONS, POSE_COLOR, 3 * scale);
      drawPoints(ctx, person, POSE_COLOR, 3.5 * scale);
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
      drawPoints(ctx, list[i], color, 4 * scale, FINGERTIPS);
    }
  }
}
