# Mimic Studio

A website that watches you through your webcam and learns your gestures.

Hold your hands up and it finds **21 points on each hand** and **33 points on
your body**, live, at camera speed. Record a few seconds of "thumbs up",
record a few seconds of "wave", press **Train**, and it builds a small neural
network that recognises them — then tells you which one you are doing right
now, with a confidence score.

Everything runs **inside your browser**. Your video never leaves your computer.
There is no server, no upload, no account.

---

## How it works

| Piece | What it does |
| --- | --- |
| [MediaPipe Tasks for Web](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) | Finds the hand and body landmarks in each video frame, on your GPU |
| [TensorFlow.js](https://www.tensorflow.org/js) | Trains the gesture classifier, also on your GPU (WebGL / WebGPU) |
| Plain ES modules | No build step, no bundler — the files you edit are the files that ship |

### The important idea: normalization

The models give landmarks as positions **in the picture**. If you feed those
straight into a classifier, it learns nonsense — "thumbs up" becomes "thumbs up
*in the top-left corner, two feet from the camera*". Step back and it breaks.

So before training we **normalize** every hand:

1. **Center** — subtract the wrist position, so the hand sits at (0,0,0).
   Now it doesn't matter *where* in the frame your hand is.
2. **Scale** — divide by the hand's size, so a hand near the camera and the
   same hand across the room produce identical numbers.
3. **Rotate** (optional) — turn the hand upright, so a tilted "thumbs up"
   still counts as a thumbs up.

That lives in `js/normalize.js` as one clearly commented function you can read
and tweak. It is the single most important file in the project.

Run `node tests/math.test.mjs` to check it. The tests prove the useful
properties directly: moving or zooming the hand changes the output by exactly
zero, and a hand tilted 47° normalizes identically to an untilted one once
rotation is on.

### Bend rings

Every joint that can bend wears a little gauge that fills up as it curls,
fading green → orange → red. Measuring a bend needs **three** dots — the joint
plus its two neighbours — and the angle between them comes from the dot
product. `js/angles.js` explains it step by step.

15 joints per hand bend (3 per finger); the wrist and 5 fingertips don't.

---

## Running it

It is a static site, so any web server will do. You cannot just double-click
`index.html` — browsers refuse camera access on `file://` URLs.

```bash
# Python (already on most machines)
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>.

> Cameras only work on `https://` or on `localhost`. Both of the above are
> localhost, so you're fine.

### Deploying

Push to `main`. The workflow in `.github/workflows/deploy.yml` publishes to
GitHub Pages automatically. In your repo settings, set
**Settings → Pages → Source** to **GitHub Actions**.

Because every path in the HTML is relative (`./js/main.js`, not `/js/main.js`),
the site works at `https://user.github.io/mimic-studio/` with no base-path
configuration needed.

---

## Project layout

```
index.html          the studio — camera, recording, training
browse.html         community gesture library                (Stage 4)
css/style.css       dark theme
js/
  camera.js         webcam on/off + friendly error messages
  landmarks.js      loads the MediaPipe hand + pose models
  draw.js           paints the skeleton overlay
  normalize.js      landmark normalization                   (Stage 3)
  recorder.js       gesture recording                        (Stage 2)
  trainer.js        TensorFlow.js model + live training graph (Stage 3)
  datasets.js       save / load / merge gesture JSON files    (Stage 3)
  community.js      shared gesture library + sharing flow     (Stage 4)
gestures/           community gesture JSON files              (Stage 4)
legacy/             archived data from the previous version
```

---

## Build stages

- [x] **Stage 1 — Camera & skeleton.** Webcam, both hands, full body, overlay.
- [x] **Stage 2 — Recording.** Bend rings on every joint, name a gesture,
      record samples with a countdown, live sample counts and balance warnings.
- [ ] **Stage 3 — Training.** Normalize, train on the GPU, live loss/accuracy
      graph, then live prediction.
- [ ] **Stage 4 — Sharing.** Load community gestures, contribute your own.

---

## `legacy/`

The previous version of this project collected **6,904 hand samples across 9
gestures** and trained a model to 98% held-out accuracy. That data is kept in
`legacy/` and will be converted into the community gesture library in Stage 4,
so the shared library ships with real content instead of being empty.

The old normalization was center + scale (no rotation), which is exactly steps
1 and 2 above — so the archived samples are directly reusable.

---

## Licence

MIT — see [LICENSE](LICENSE).
