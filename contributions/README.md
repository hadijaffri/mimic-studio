# contributions/

This folder is how **anyone can add hand motions, speech, and movement data** to the shared library.

Each file here is one person's contribution. A GitHub Action merges them all into the
top-level [`dataset.json`](../dataset.json) automatically whenever a Pull Request is merged.

## The easy way (from the app)

1. Open the live app, record some gestures (and optionally speech / motion).
2. Click **⬆ Contribute my data (open Pull Request)**.
3. Your data is copied to your clipboard and a GitHub "new file" tab opens here.
4. Paste, **Commit changes**, choose **Create a new branch and start a pull request**.

That's it — no setup, no tokens. GitHub forks the repo for you if needed.

## The manual way

Add a file named `your-handle-<timestamp>.json` in this folder shaped like:

```json
{
  "meta": { "contributor": "your-handle", "created": "2026-06-06T00:00:00.000Z" },
  "gestures": {
    "grab": [ { "vec": [/* 63 numbers */], "hand": "Right", "t": 1733000000000 } ]
  },
  "speech": [ { "text": "pick it up", "label": "grab", "t": 1733000000000 } ],
  "motion": [ { "acc": {"x":0,"y":0,"z":0}, "rot": {}, "ori": {}, "label": "grab", "t": 1733000000000 } ]
}
```

- `vec` is 21 hand landmarks × (x, y, z) = **63 numbers**, re-centered on the wrist and
  scaled so it's position/size-invariant (the app produces this for you).
- All three sections are optional — include whatever you captured.
- Don't edit `dataset.json` directly; it is regenerated from these files.
