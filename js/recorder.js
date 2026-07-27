/* ==========================================================================
   recorder.js — collecting training examples.

   HOW RECORDING WORKS
   -------------------
   You type a name ("thumbs up"), press Record, and for a few seconds we grab
   the shape of your hand on every single frame. At ~30 frames a second, three
   seconds gives about 90 examples — plenty for the model to learn from.

   We do NOT save video, or pictures, or anything you could look at. Each
   example is just 63 numbers describing the shape of one hand. You could post
   them on a billboard and nobody would learn anything about you.

   There's a countdown before recording starts, because otherwise every sample
   set begins with three frames of you reaching for the mouse.
   ========================================================================== */

import { normalizeHand } from "./normalize.js";

const STORAGE_KEY = "mimic-studio-dataset-v2";

export class Recorder {
  constructor(options = {}) {
    /* categories = { "thumbs up": [ {vec, hand, t}, … ], … }
       Exactly the shape the old project used, so the two are interchangeable. */
    this.categories = {};

    this.recording = false;
    this.activeLabel = null;
    this.countdown = 0;
    this.recordStartedAt = 0;

    // How long to record for, and how long to count down first.
    this.durationMs = options.durationMs ?? 3000;
    this.countdownMs = options.countdownMs ?? 3000;

    // Should the normalizer also rotate hands upright?
    this.rotate = options.rotate ?? false;

    // Called whenever anything changes, so the UI can redraw itself.
    this.onChange = options.onChange ?? (() => {});

    this._timer = null;
    this.load();
  }

  /* ======================================================================
     Categories
     ====================================================================== */

  addCategory(name) {
    const clean = String(name || "").trim().toLowerCase();
    if (!clean) return { ok: false, error: "Give the gesture a name first." };
    if (this.categories[clean]) return { ok: false, error: `"${clean}" already exists.` };

    this.categories[clean] = [];
    this.save();
    this.onChange();
    return { ok: true, name: clean };
  }

  removeCategory(name) {
    delete this.categories[name];
    if (this.activeLabel === name) this.activeLabel = null;
    this.save();
    this.onChange();
  }

  clearCategory(name) {
    if (this.categories[name]) this.categories[name] = [];
    this.save();
    this.onChange();
  }

  get labels() {
    return Object.keys(this.categories);
  }

  count(name) {
    return (this.categories[name] || []).length;
  }

  get totalSamples() {
    return this.labels.reduce((sum, l) => sum + this.count(l), 0);
  }

  /* ======================================================================
     Recording
     ====================================================================== */

  /**
   * Start the countdown, then record. Returns false if we can't start.
   */
  start(label) {
    if (this.recording || this.countdown > 0) return false;
    if (!this.categories[label]) return false;

    this.activeLabel = label;

    // "Countdown: none" means start capturing this instant.
    if (this.countdownMs <= 0) {
      this._beginCapture();
      return true;
    }

    this.countdown = Math.ceil(this.countdownMs / 1000);
    this.onChange();

    // Tick the countdown once a second, then begin for real.
    this._timer = setInterval(() => {
      this.countdown -= 1;
      if (this.countdown <= 0) {
        clearInterval(this._timer);
        this._timer = null;
        this._beginCapture();
      }
      this.onChange();
    }, 1000);

    return true;
  }

  _beginCapture() {
    this.recording = true;
    this.recordStartedAt = performance.now();
    this.onChange();

    this._timer = setTimeout(() => this.stop(), this.durationMs);
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      clearInterval(this._timer);
      this._timer = null;
    }
    this.recording = false;
    this.countdown = 0;
    this.save();
    this.onChange();
  }

  /** 0..1, how far through the recording we are — drives the progress bar. */
  get progress() {
    if (!this.recording) return 0;
    const elapsed = performance.now() - this.recordStartedAt;
    return Math.min(1, elapsed / this.durationMs);
  }

  /**
   * Called from the main loop on every frame. If we're recording, this is
   * where a frame actually becomes a training example.
   *
   * Both hands get recorded as separate examples — if you record "wave" with
   * two hands up, you get two examples per frame, which is a free doubling of
   * your data.
   *
   * @param {object} results  the { hands, pose } from detectFrame()
   * @returns {number} how many samples were captured this frame
   */
  captureFrame(results) {
    if (!this.recording || !this.activeLabel) return 0;

    const hands = (results.hands && results.hands.landmarks) || [];
    if (!hands.length) return 0;

    const handedness = (results.hands && results.hands.handednesses) || [];
    let captured = 0;

    for (let i = 0; i < hands.length; i++) {
      const vec = normalizeHand(hands[i], { rotate: this.rotate });
      if (!vec) continue;

      const info = handedness[i] && handedness[i][0];
      this.categories[this.activeLabel].push({
        vec,
        hand: info ? info.categoryName : "Unknown",
        t: Date.now(),
      });
      captured++;
    }

    return captured;
  }

  /* ======================================================================
     Balance checking

     A model trained on 500 "wave" and 12 "thumbs up" will just guess "wave"
     constantly and still look 97% accurate. Catching that early saves a lot
     of confusion later, so we flag it as soon as it happens.
     ====================================================================== */

  checkBalance() {
    const labels = this.labels.filter((l) => this.count(l) > 0);
    if (labels.length < 2) return { ok: true, warnings: [] };

    const counts = labels.map((l) => this.count(l));
    const most = Math.max(...counts);
    const fewest = Math.min(...counts);
    const warnings = [];

    // More than 3x difference between biggest and smallest is trouble.
    if (most > fewest * 3) {
      const weakest = labels.filter((l) => this.count(l) === fewest);
      warnings.push(
        `"${weakest[0]}" has ${fewest} samples but the biggest set has ${most}. ` +
        `Record more of "${weakest[0]}" or the model will learn to ignore it.`
      );
    }

    for (const l of labels) {
      if (this.count(l) < 30) {
        warnings.push(`"${l}" only has ${this.count(l)} samples — aim for 60+.`);
      }
    }

    return { ok: warnings.length === 0, warnings };
  }

  /* ======================================================================
     Saving

     localStorage keeps your work across a page refresh. It's per-browser and
     has a size limit (usually ~5MB), so Stage 3 adds proper JSON download —
     that's the real way to keep a dataset.
     ====================================================================== */

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        rotate: this.rotate,
        categories: this.categories,
      }));
      return true;
    } catch (err) {
      // Almost always "quota exceeded" — the dataset outgrew localStorage.
      console.warn("Could not save to localStorage:", err);
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.categories) {
        this.categories = data.categories;
        if (typeof data.rotate === "boolean") this.rotate = data.rotate;
      }
    } catch (err) {
      console.warn("Saved data was unreadable, starting fresh:", err);
    }
  }

  clearAll() {
    this.categories = {};
    this.activeLabel = null;
    localStorage.removeItem(STORAGE_KEY);
    this.onChange();
  }
}
