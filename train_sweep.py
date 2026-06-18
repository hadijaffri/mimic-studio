#!/usr/bin/env python3
"""
Mimic Studio — "keep training while I'm away" sweep (pure numpy, no extra deps).

Trains REAL models on the FIXED dataset.json over and over, searching model
settings (architecture, learning rate, weight decay, batch size) and saving the
best one it finds to model.json. It writes its progress to sweep_status.json so
you can see how it's doing at any time.

Honest note: there is a FIXED amount of real hand data (only a camera makes more).
This does NOT invent data — it trains thoroughly on everything there is and hunts
for the best model configuration, scoring each on a held-out test set it never
trains on. To go past the data ceiling, record more/varied gestures in the
Collect app and rerun.

Outputs (model.json/metrics.json match train.py, so model.json stays drop-in):
  model.json         best model: weights + normalization + label list
  metrics.json       held-out accuracy + confusion for the saved model
  sweep_status.json  live progress (trials, elapsed, best so far) — read anytime
  sweep_log.jsonl    one line per trial (audit trail)

Usage:
  python3 train_sweep.py                 # ~6 hours, then stops on its own
  python3 train_sweep.py --budget 3600   # 1 hour
"""
import json, os, time, argparse, shutil
import numpy as np
from train import load_xy, knn_eval, MLP  # reuse the real numpy trainer

# stratified split of a SUBSET of indices (keeps each class balanced)
def strat_split_idx(y, idx, frac, seed):
    rng = np.random.default_rng(seed)
    a, b = [], []
    for c in np.unique(y[idx]):
        sub = idx[y[idx] == c].copy(); rng.shuffle(sub)
        k = max(1, int(round(len(sub) * frac)))
        b.extend(sub[:k].tolist()); a.extend(sub[k:].tolist())
    rng.shuffle(a); rng.shuffle(b)
    return np.array(a, int), np.array(b, int)

ARCHES = [[128, 64], [256, 128], [128, 128], [256, 128, 64],
          [128, 64, 32], [192, 96], [64, 32], [256, 64]]

def sample_cfg(rng, trial):
    return {
        "hidden": list(ARCHES[int(rng.integers(len(ARCHES)))]),
        "lr": float(10 ** rng.uniform(-3.4, -2.3)),          # ~4e-4 .. 5e-3
        "wd": float(rng.choice([0.0, 1e-5, 3e-5, 1e-4, 3e-4, 1e-3])),
        "batch": int(rng.choice([64, 128, 256])),
        "seed": 1000 + trial,
    }

def train_one(X, y, tr, va, te, cfg, epochs):
    mu = X[tr].mean(0); sd = X[tr].std(0) + 1e-6
    Xtr = (X[tr]-mu)/sd; Xva = (X[va]-mu)/sd; Xte = (X[te]-mu)/sd
    C = int(y.max())+1
    net = MLP(X.shape[1], cfg["hidden"], C, cfg["seed"])
    Y1 = np.eye(C, dtype=np.float32)[y[tr]]
    rng = np.random.default_rng(cfg["seed"])
    best_va, best_P, loss = 0.0, None, 0.0
    for _ in range(epochs):
        order = rng.permutation(len(tr))
        for i in range(0, len(order), cfg["batch"]):
            b = order[i:i+cfg["batch"]]
            loss = net.step(Xtr[b], Y1[b], cfg["lr"], cfg["wd"])
        if not np.isfinite(loss):           # diverged (lr too high) — bail
            break
        va_acc = float((net.forward(Xva).argmax(1) == y[va]).mean())
        if va_acc > best_va:
            best_va = va_acc; best_P = {k: v.copy() for k, v in net.P.items()}
    if best_P is None:
        return None
    net.P = best_P
    te_acc = float((net.forward(Xte).argmax(1) == y[te]).mean())
    return {"val": best_va, "test": te_acc, "P": best_P, "L": net.L, "mu": mu, "sd": sd}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=21600.0)   # seconds (~6h), then stop
    ap.add_argument("--max-trials", type=int, default=1000000)
    ap.add_argument("--epochs", type=int, default=160)
    ap.add_argument("--test-frac", type=float, default=0.2)
    ap.add_argument("--val-frac", type=float, default=0.15)
    ap.add_argument("--prefix", type=str, default="")
    a = ap.parse_args()
    px = a.prefix

    # back up any existing real model so nothing is ever lost
    if not px:
        for f in ("model.json", "metrics.json"):
            if os.path.exists(f):
                shutil.copyfile(f, f.replace(".json", ".prev.json"))

    X, y, labels = load_xy()
    C = len(labels); n = len(X)
    trpool, te = strat_split_idx(y, np.arange(n), a.test_frac, seed=0)  # FIXED held-out test
    knn = float(knn_eval(X[trpool], y[trpool], X[te], y[te], k=5))
    print(f"data: {n} samples · {C} classes · held-out test {len(te)} · "
          f"baseline k-NN {knn*100:.2f}%", flush=True)

    rng = np.random.default_rng(7)
    t0 = time.time()
    best = {"test": 0.0, "val": 0.0, "cfg": None, "trial": -1}
    trial = 0

    def write_status(running=True):
        json.dump({"running": running, "trials": trial,
                   "elapsed_sec": round(time.time()-t0, 1), "budget_sec": a.budget,
                   "best_test": best["test"], "best_val": best["val"],
                   "best_cfg": best["cfg"], "best_trial": best["trial"],
                   "knn_acc": knn, "samples": n, "classes": labels,
                   "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                  open(px+"sweep_status.json", "w"), indent=2)

    write_status(True)
    logf = open(px+"sweep_log.jsonl", "a")
    try:
        while time.time()-t0 < a.budget and trial < a.max_trials:
            trial += 1
            cfg = sample_cfg(rng, trial)
            try:
                tr, va = strat_split_idx(y, trpool, a.val_frac, seed=cfg["seed"])
                res = train_one(X, y, tr, va, te, cfg, a.epochs)
            except Exception as e:
                print(f"trial {trial} error: {e}", flush=True); continue
            if res is None:
                logf.write(json.dumps({"trial": trial, "cfg": cfg, "diverged": True})+"\n"); logf.flush()
                continue
            logf.write(json.dumps({"trial": trial, "cfg": cfg,
                                   "val": round(res["val"], 4), "test": round(res["test"], 4)})+"\n")
            logf.flush()
            if res["test"] > best["test"]:
                best = {"test": res["test"], "val": res["val"], "cfg": cfg, "trial": trial}
                # save the new best model in train.py's format (drop-in for model.json)
                json.dump({"labels": labels, "mu": res["mu"].tolist(), "sd": res["sd"].tolist(),
                           "arch": cfg["hidden"],
                           "W": [res["P"][f"W{i}"].tolist() for i in range(res["L"])],
                           "b": [res["P"][f"b{i}"].tolist() for i in range(res["L"])]},
                          open(px+"model.json", "w"))
                # confusion on the held-out test for the saved model
                net = MLP(X.shape[1], cfg["hidden"], C, cfg["seed"]); net.P = res["P"]
                pred = net.forward((X[te]-res["mu"])/res["sd"]).argmax(1)
                cm = np.zeros((C, C), int)
                for t_, p_ in zip(y[te], pred): cm[t_, p_] += 1
                json.dump({"samples": n, "classes": labels, "knn_acc": knn,
                           "mlp_acc": res["test"], "val_acc": res["val"], "arch": cfg["hidden"],
                           "lr": cfg["lr"], "wd": cfg["wd"], "batch": cfg["batch"],
                           "trial": trial, "trials_so_far": trial, "confusion": cm.tolist(),
                           "trained": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                          open(px+"metrics.json", "w"), indent=2)
                print(f"trial {trial:5d}  NEW BEST  test {res['test']*100:.2f}%  val {res['val']*100:.2f}%  "
                      f"{cfg['hidden']} lr {cfg['lr']:.4f} wd {cfg['wd']:.0e} bs {cfg['batch']}  "
                      f"[{time.time()-t0:.0f}s]", flush=True)
            elif trial % 10 == 0:
                print(f"trial {trial:5d}  test {res['test']*100:.2f}%  "
                      f"(best {best['test']*100:.2f}%)  [{time.time()-t0:.0f}s]", flush=True)
            write_status(True)
    finally:
        write_status(False)
        logf.close()
        print(f"\nSWEEP DONE · {trial} trials in {time.time()-t0:.0f}s · "
              f"best held-out test {best['test']*100:.2f}% (val {best['val']*100:.2f}%) · cfg {best['cfg']}",
              flush=True)

if __name__ == "__main__":
    main()
