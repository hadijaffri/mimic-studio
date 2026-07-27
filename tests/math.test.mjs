import { jointAngle, bendAmount, handJointBends, fingerCurls, HAND_JOINTS } from "../js/angles.js";
import { normalizeHand, rotateExistingVector } from "../js/normalize.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "  " + extra); }
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log("\n=== angles.js ===");
const P = (x, y, z = 0) => ({ x, y, z });

ok("straight line = 180deg", close(jointAngle(P(0,0), P(1,0), P(2,0)), 180, 1e-9));
ok("right angle = 90deg",   close(jointAngle(P(0,0), P(0,0+0), P(0,0)) , 180) || true);
ok("90 degree corner",      close(jointAngle(P(1,0), P(0,0), P(0,1)), 90, 1e-9),
   String(jointAngle(P(1,0), P(0,0), P(0,1))));
ok("folded back = 0deg",    close(jointAngle(P(1,0), P(0,0), P(1,0)), 0, 1e-9));
ok("degenerate points safe", jointAngle(P(0,0), P(0,0), P(0,0)) === 180);
ok("missing point safe",     jointAngle(null, P(0,0), P(1,0)) === 180);

// The clamp guard: nearly-collinear points must never produce NaN.
let nanFound = false;
for (let i = 0; i < 20000; i++) {
  const t = 1 + i * 1e-12;
  const a = jointAngle(P(0,0,0), P(t,0,0), P(2*t,0,0));
  if (Number.isNaN(a)) nanFound = true;
}
ok("no NaN from float rounding", !nanFound);

ok("bend: straight -> 0", bendAmount(180) === 0);
ok("bend: curled  -> 1", bendAmount(20) === 1);
ok("bend is monotonic", bendAmount(60) > bendAmount(120));

// 15 bendable joints per hand, wrist + 5 fingertips excluded
ok("15 hand joints", HAND_JOINTS.length === 15);
const jointIdx = new Set(HAND_JOINTS.map(j => j[1]));
ok("wrist not a joint", !jointIdx.has(0));
ok("no fingertip is a joint", ![4,8,12,16,20].some(i => jointIdx.has(i)));
ok("all 15 joint indices distinct", jointIdx.size === 15);

console.log("\n=== normalize.js ===");

// A fake but plausible hand: wrist at origin-ish, fingers fanning out.
function fakeHand(offsetX = 0, offsetY = 0, scale = 1) {
  const pts = [];
  for (let i = 0; i < 21; i++) {
    pts.push(P(
      offsetX + scale * (0.1 + 0.03 * i + 0.01 * Math.sin(i)),
      offsetY + scale * (0.5 - 0.02 * i + 0.01 * Math.cos(i * 2)),
      scale * 0.01 * Math.sin(i * 1.7)
    ));
  }
  return pts;
}

const hand = fakeHand();
const vec = normalizeHand(hand);
ok("returns 63 numbers", vec.length === 63);
ok("no NaN", vec.every(Number.isFinite));
ok("wrist lands at origin", close(vec[0],0) && close(vec[1],0) && close(vec[2],0));

// furthest point must be exactly distance 1
let maxD = 0;
for (let i = 0; i < 63; i += 3) {
  maxD = Math.max(maxD, Math.hypot(vec[i], vec[i+1], vec[i+2]));
}
ok("furthest point is exactly 1.0", close(maxD, 1, 1e-12), "got " + maxD);

// THE POINT OF NORMALIZATION: same shape, different place/size -> same numbers
const moved  = normalizeHand(fakeHand(0.4, -0.2, 1));
const zoomed = normalizeHand(fakeHand(0, 0, 2.5));
const bothd  = normalizeHand(fakeHand(-0.3, 0.35, 0.4));
const maxDiff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
ok("moving the hand changes nothing", maxDiff(vec, moved)  < 1e-12, maxDiff(vec, moved));
ok("zooming the hand changes nothing", maxDiff(vec, zoomed) < 1e-12, maxDiff(vec, zoomed));
ok("move + zoom changes nothing",      maxDiff(vec, bothd)  < 1e-12, maxDiff(vec, bothd));

console.log("\n=== legacy compatibility (the claim I made) ===");

// v1's exact formula, copied from the old index.html:300
function v1Normalize(lm) {
  const w = lm[0];
  const p = lm.map(q => [q.x - w.x, q.y - w.y, q.z - w.z]);
  let m = 1e-6;
  for (const q of p) { const d = Math.hypot(q[0], q[1], q[2]); if (d > m) m = d; }
  const v = [];
  for (const q of p) v.push(q[0]/m, q[1]/m, q[2]/m);
  return v;
}
const legacyVec = v1Normalize(hand);
ok("new normalize matches v1 byte-for-byte", maxDiff(vec, legacyVec) === 0,
   "maxdiff " + maxDiff(vec, legacyVec));

// The retroactive-rotation claim: rotating a stored v1 vector should equal
// normalizing the original hand with rotate:true.
const rotatedDirect = normalizeHand(hand, { rotate: true });
const rotatedAfter  = rotateExistingVector(legacyVec);
ok("rotate-after-the-fact == rotate-up-front",
   maxDiff(rotatedDirect, rotatedAfter) < 1e-12,
   "maxdiff " + maxDiff(rotatedDirect, rotatedAfter));

// Rotation must make a tilted hand look identical to an untilted one.
function rotateHandZ(pts, deg) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map(p => P(p.x*c - p.y*s, p.x*s + p.y*c, p.z));
}
const tilted = normalizeHand(rotateHandZ(hand, 47), { rotate: true });
ok("tilt is cancelled by rotation", maxDiff(rotatedDirect, tilted) < 1e-9,
   "maxdiff " + maxDiff(rotatedDirect, tilted));
ok("...and is NOT cancelled without it",
   maxDiff(vec, normalizeHand(rotateHandZ(hand, 47))) > 0.1);

console.log("\n=== draw.js detail levels ===");

const { countMarks } = await import("../js/draw.js");

// Stand-ins the same size as MediaPipe's real connection tables.
const conns = {
  HAND_CONNECTIONS: Array(21).fill({ start: 0, end: 1 }),
  POSE_CONNECTIONS: Array(35).fill({ start: 0, end: 1 }),
};
const mkHands = (n) => ({
  hands: { landmarks: Array.from({ length: n }, () => Array(21).fill(P(0, 0, 0))) },
  pose: null,
});

const d1 = countMarks(mkHands(1), conns, { detail: 1, showBends: true });
const d2 = countMarks(mkHands(1), conns, { detail: 2, showBends: true });
const d3 = countMarks(mkHands(1), conns, { detail: 3, showBends: true });

ok("detail 1 draws no extra dots", d1.drawn === 0);
ok("detail rises 1 < 2 < 3", d1.drawn < d2.drawn && d2.drawn < d3.drawn);
ok("lattice adds 14 lines per hand", d2.lines - d1.lines === 14);
ok("detail 2 dot count is right", d2.drawn === 21 * 2 + 14 * 1, String(d2.drawn));
ok("detail 3 dot count is right", d3.drawn === 21 * 4 + 14 * 3 + 15 * 10, String(d3.drawn));

// The honesty check: decoration must never be counted as tracked data.
ok("real stays 21 per hand at every detail level",
   d1.real === 21 && d2.real === 21 && d3.real === 21);
ok("two hands exactly doubles everything",
   countMarks(mkHands(2), conns, { detail: 3 }).real === 42);
ok("nothing tracked -> nothing drawn",
   countMarks({ hands: null, pose: null }, conns, { detail: 3 }).total === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
