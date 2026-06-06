# Contributing to Mimic Studio

The whole point of this project is a **shared, community-grown library** of hand motions
(plus speech and movement). Here's how the pieces fit and how to add yours.

## How the data flow works

```
  You record in the app
          │
          ▼
  contributions/<you>-<ts>.json   ← one file per contribution (no conflicts)
          │   (Pull Request → merged to main)
          ▼
  scripts/merge.mjs  (run by GitHub Action)
          │
          ▼
  dataset.json   ← the shared base everyone's app loads on startup
```

Because every contribution is a **separate file**, two people contributing at the same
time never conflict. The merge step concatenates them all and tags each sample with the
contributor handle.

## Add your data (no setup)

1. Open the live app and record gestures (Collect mode → hold **record**). Optionally add
   speech phrases and motion snapshots, tagged to the same category.
2. Click **⬆ Contribute my data (open Pull Request)**.
3. Paste into the GitHub file that opens, commit, and **start a pull request**.

A maintainer reviews and merges; the Action then rebuilds `dataset.json` and your motions
go live for everyone.

## Run the merge yourself (optional)

```bash
node scripts/merge.mjs   # reads contributions/*.json -> writes dataset.json
```

## Guidelines

- **Quality over quantity.** A handful of clean, consistent samples per category beats
  hundreds of noisy ones. Vary angle/distance a little so the gesture generalizes.
- **Name categories clearly and lowercase**: `grab`, `open-palm`, `point`, `thumbs-up`.
- **Don't hand-edit `dataset.json`** — it's generated.
- **Only contribute data you're comfortable making public** (it's an open dataset). No PII
  in speech phrases.

## Local development

It's a single static file — no build. Serve the folder and open it over http:

```bash
npx serve .        # or: python3 -m http.server 8000
```

Then visit the printed `http://localhost:...` URL (the camera needs https or localhost).
