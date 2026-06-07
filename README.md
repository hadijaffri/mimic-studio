# Mimic Studio

Teach a machine your **hand motions**, **voice**, and **device movement** — directly from your browser — then export a clean, labeled, multimodal dataset to train AI and robots.

Everything runs **on-device**. Nothing is uploaded anywhere unless *you* export the JSON file.

![status](https://img.shields.io/badge/runtime-browser-5eead4) ![ml](https://img.shields.io/badge/learning-on--device%20kNN-7c9cff) ![deps](https://img.shields.io/badge/build-none%20(single%20file)-34d399)

## 🔴 Live

- **App (GitHub Pages):** https://hadijaffri.github.io/mimic-studio/
- **App (Vercel):** import this repo at **[vercel.com/new](https://vercel.com/new)** → pick `mimic-studio` → **Deploy** (auto-redeploys on every push).
- **Repo:** https://github.com/hadijaffri/mimic-studio

Want your own copy on Vercel in one click?

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/hadijaffri/mimic-studio)

Anyone can open the link, record gestures, and **contribute them back** — see [Contributing](#contributing--the-shared-dataset).

---

## What it actually does

| Modality | Tech | What you get |
|---|---|---|
| **Hand tracking** | [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe) `HandLandmarker` | 21 3D landmarks per hand, up to 2 hands, in real time |
| **Live learning** | k-nearest-neighbors over normalized landmark vectors | Records gestures into categories and classifies your live hand instantly |
| **Speech** | Web Speech API | Live transcript; final phrases tagged to a category |
| **Movement** | Device Motion / Orientation API | Accelerometer + gyroscope snapshots (best on a phone) |
| **Dataset** | JSON export/import + `localStorage` | One labeled, multimodal file ready for a training pipeline |

The hand features are **translation- and scale-invariant** (re-centered on the wrist and normalized), so the model generalizes across where your hand is in frame and how close you are to the camera.

---

## Honest scope (read this)

- **"Unlimited categories."** The app puts no cap on how many gesture categories you create — add as many as you can teach. But there is no meaningful set of *700,000* distinct hand gestures, and a from-scratch model would need millions of labeled examples to support that. For reference, ImageNet uses ~1,000 classes. **Start with a handful of well-chosen categories and grow.**
- **k-NN is "instant training" but simple.** It's perfect for live demos and small/medium datasets and needs zero training time. For a production robot policy, export the dataset and train a real model (see below).
- **Camera/mic need a secure context.** Use `https://` (GitHub Pages) or `http://localhost`. Opening the file directly with `file://` will block the camera.
- **Claude artifact caveat.** The single HTML file works as a Claude artifact, but the artifact sandbox often blocks camera/microphone. For full use, run it from GitHub Pages or localhost.

---

## Run it

### Option A — locally
```bash
# from this folder; any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

### Option B — GitHub Pages
Push this repo, then in **Settings → Pages** set the source to the `main` branch (root). Your app goes live at `https://<user>.github.io/<repo>/`.

### Option C — Vercel (recommended for sharing)
This repo is a zero-config static site. Import it at [vercel.com/new](https://vercel.com/new),
pick this GitHub repo, and deploy — you get a public `*.vercel.app` URL that anyone can use,
and it redeploys automatically on every push (including bot updates to `dataset.json`).

### Option D — Claude artifact
Open [claude.ai](https://claude.ai), paste the contents of `index.html`, and ask Claude to render it as an HTML artifact. (Camera may be sandboxed — see caveat above.)

---

## Dataset format

`Export dataset (.json)` produces:

```jsonc
{
  "meta": { "app": "Mimic Studio", "version": 1, "exported": "…", "schema": "…" },
  "gestures": {
    "grab":  [ { "vec": [/* 63 numbers: 21 × (x,y,z) normalized */], "hand": "Right", "t": 1733000000000 } ],
    "open":  [ /* … */ ]
  },
  "speech": [ { "text": "pick it up", "label": "grab", "t": 1733000000000 } ],
  "motion": [ { "acc": {"x":..,"y":..,"z":..}, "rot": {...}, "ori": {...}, "label": "grab", "t": ... } ]
}
```

### From dataset → real model (example)
```python
import json, numpy as np
from sklearn.neural_network import MLPClassifier

data = json.load(open("mimic-dataset.json"))
X, y = [], []
for label, samples in data["gestures"].items():
    for s in samples:
        X.append(s["vec"]); y.append(label)
X, y = np.array(X), np.array(y)

clf = MLPClassifier(hidden_layer_sizes=(128, 64), max_iter=500).fit(X, y)
print("classes:", clf.classes_)
```
From there it's standard supervised learning / behavior cloning — feed the time-stamped, labeled samples into whatever policy or classifier your robot stack uses.

---

## How it works (1 paragraph)

Each video frame, MediaPipe returns 21 hand landmarks. They're re-centered on the wrist and scaled by the farthest landmark distance to make a 63-dimensional, position/size-invariant vector. In **Collect** mode those vectors are stored under the active category. In **Recognize** mode the live vector is compared (Euclidean distance) to every stored sample; the 5 nearest vote, inverse-distance-weighted, and the winner is shown with a confidence score. Speech and motion are captured separately and tagged with the same category labels so a single command can span all three modalities.

---

## AI sort with Claude (vision)

Capture camera frames and let **Claude** (`claude-opus-4-8`, vision) label and group them into gesture categories — "send a lot of pictures, Claude sorts it out."

**Setup (one-time, needs the Vercel deployment):**
1. In **Vercel → Project → Settings → Environment Variables** add: `ANTHROPIC_API_KEY = sk-ant-…`
2. Redeploy. The serverless function lives at [`api/sort.js`](api/sort.js); it uses the official `@anthropic-ai/sdk` with structured JSON output.

In the app: **Capture frame** (or **Auto-capture**) → **Sort captures with Claude**. Frames are downscaled to 320×240 and sent in batches of 20; results are grouped by predicted label with confidence. It won't work on GitHub Pages or as a Claude artifact — those are static, with no server to hold your key.

### Honest throughput reality — *not* 10,000 images/sec
A vision LLM is the wrong tool for 10,000 images/second, and no API can do that:
- **Latency:** each request is ~1–5s, not microseconds. Cameras capture ~30–60 fps, not 10,000.
- **Rate limits:** the API caps requests- and tokens-per-minute — nowhere near 600,000,000 images/minute.
- **Cost:** each image is ~hundreds–1,500 input tokens; 10k/sec would be millions of dollars per minute.

What works: capture locally, **sample** a subset, and batch them. For a *large* backlog, use the **[Message Batches API](https://platform.claude.com/docs/en/build-with-claude/batch-processing)** — up to 100,000 requests per batch, ~50% cheaper, results within ~1 hour. That's the real "send a big pile, Claude sorts it out afterward" path; the in-app button is the live, interactive version. For real-time per-frame recognition, keep using the on-device k-NN — Claude is best for labeling/auditing/auto-categorizing batches, not the realtime loop.

## Contributing — the shared dataset

This is a **community dataset**. The app loads the shared `dataset.json` so you start from
everyone's motions; when you record more and hit **Contribute**, it opens a Pull Request that
adds a file under `contributions/`. Once merged, a GitHub Action rebuilds `dataset.json`
automatically — no backend, no tokens.

```
record in app → contributions/<you>.json (PR) → merge → Action rebuilds dataset.json → everyone gets it
```

Full guide: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
