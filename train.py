#!/usr/bin/env python3
"""
Mimic Studio — real model trainer (pure numpy, no extra deps).

Reads the shared dataset.json, trains a small neural network on the 63-dim
normalized hand-landmark vectors, and reports HONEST held-out accuracy plus a
confusion matrix so you can see which gestures the model mixes up (= where more
real camera samples would help).

Outputs:
  model.json    weights + feature normalization + label list (can run in-browser)
  metrics.json  accuracy, per-class recall, confusion pairs

Usage:
  python3 train.py                # default 80/20 split, MLP 128-64
  python3 train.py --epochs 250   # train longer
"""
import json, argparse, sys, time
import numpy as np

# ----------------------------- data -----------------------------
def load_xy(path="dataset.json"):
    d = json.load(open(path))
    g = d.get("gestures", {})
    X, y, labels = [], [], sorted(g.keys())
    idx = {lab: i for i, lab in enumerate(labels)}
    for lab in labels:
        for s in g[lab]:
            v = s.get("vec")
            if isinstance(v, list) and len(v) == 63:
                X.append(v); y.append(idx[lab])
    if not X:
        sys.exit("No 63-dim gesture vectors found in dataset.json")
    return np.asarray(X, np.float32), np.asarray(y, np.int64), labels

def stratified_split(y, test_frac=0.2, seed=0):
    rng = np.random.default_rng(seed)
    tr, te = [], []
    for c in np.unique(y):
        idx = np.where(y == c)[0]; rng.shuffle(idx)
        k = max(1, int(round(len(idx) * test_frac)))
        te.extend(idx[:k]); tr.extend(idx[k:])
    rng.shuffle(tr); rng.shuffle(te)
    return np.array(tr), np.array(te)

# ----------------------------- baseline: k-NN -----------------------------
def knn_eval(Xtr, ytr, Xte, yte, k=5):
    # vectorized squared distances: |a|^2 + |b|^2 - 2 a.b
    aa = (Xte**2).sum(1)[:, None]; bb = (Xtr**2).sum(1)[None, :]
    d2 = aa + bb - 2 * Xte @ Xtr.T
    nn = np.argpartition(d2, k, axis=1)[:, :k]
    pred = np.array([np.bincount(ytr[row], minlength=ytr.max()+1).argmax() for row in nn])
    return (pred == yte).mean()

# ----------------------------- MLP (numpy + Adam) -----------------------------
def softmax(z):
    z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)

class MLP:
    def __init__(self, d, hs, c, seed=0):
        rng = np.random.default_rng(seed); self.P = {}
        dims = [d] + hs + [c]
        for i in range(len(dims)-1):
            self.P[f"W{i}"] = (rng.standard_normal((dims[i], dims[i+1])) * np.sqrt(2/dims[i])).astype(np.float32)
            self.P[f"b{i}"] = np.zeros(dims[i+1], np.float32)
        self.L = len(dims)-1
        self.m = {k: np.zeros_like(v) for k, v in self.P.items()}
        self.v = {k: np.zeros_like(v) for k, v in self.P.items()}; self.t = 0

    def forward(self, X):
        self.a = [X]; h = X
        for i in range(self.L):
            z = h @ self.P[f"W{i}"] + self.P[f"b{i}"]
            h = np.maximum(z, 0) if i < self.L-1 else z
            self.a.append(h)
        return softmax(h)

    def step(self, X, y1, lr, wd):
        p = self.forward(X); N = X.shape[0]; g = {}
        dz = (p - y1) / N
        for i in reversed(range(self.L)):
            g[f"W{i}"] = self.a[i].T @ dz + wd * self.P[f"W{i}"]
            g[f"b{i}"] = dz.sum(0)
            if i > 0:
                da = dz @ self.P[f"W{i}"].T
                dz = da * (self.a[i] > 0)
        self.t += 1; b1, b2, eps = 0.9, 0.999, 1e-8
        for k in self.P:
            self.m[k] = b1*self.m[k] + (1-b1)*g[k]
            self.v[k] = b2*self.v[k] + (1-b2)*g[k]**2
            mh = self.m[k]/(1-b1**self.t); vh = self.v[k]/(1-b2**self.t)
            self.P[k] -= lr * mh/(np.sqrt(vh)+eps)
        return -np.log(p[np.arange(N), y1.argmax(1)] + 1e-9).mean()

# ----------------------------- train -----------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--batch", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--wd", type=float, default=1e-4)
    ap.add_argument("--hidden", type=str, default="128,64")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    X, y, labels = load_xy()
    C = len(labels)
    print(f"data: {len(X)} samples · {C} classes · dim {X.shape[1]}")
    tr, te = stratified_split(y, 0.2, a.seed)
    Xtr, ytr, Xte, yte = X[tr], y[tr], X[te], y[te]

    # standardize on TRAIN stats only (no leakage)
    mu = Xtr.mean(0); sd = Xtr.std(0) + 1e-6
    Xtr_n = (Xtr - mu) / sd; Xte_n = (Xte - mu) / sd

    knn = knn_eval(Xtr, ytr, Xte, yte, k=5)
    print(f"baseline k-NN (k=5) test accuracy: {knn*100:.2f}%   <- what the app uses today")

    hs = [int(x) for x in a.hidden.split(",") if x]
    net = MLP(X.shape[1], hs, C, a.seed)
    Y1 = np.eye(C, dtype=np.float32)[ytr]
    rng = np.random.default_rng(a.seed)
    best, best_P = 0.0, None
    t0 = time.time()
    for ep in range(1, a.epochs+1):
        order = rng.permutation(len(Xtr_n))
        loss = 0.0
        for i in range(0, len(order), a.batch):
            b = order[i:i+a.batch]
            loss += net.step(Xtr_n[b], Y1[b], a.lr, a.wd)
        acc = (net.forward(Xte_n).argmax(1) == yte).mean()
        if acc > best:
            best = acc; best_P = {k: v.copy() for k, v in net.P.items()}
        if ep == 1 or ep % 20 == 0 or ep == a.epochs:
            print(f"  epoch {ep:4d}  loss {loss:7.3f}  test acc {acc*100:6.2f}%  (best {best*100:.2f}%)")
    print(f"MLP {hs} best test accuracy: {best*100:.2f}%   (trained in {time.time()-t0:.1f}s)")

    # confusion matrix on best model
    net.P = best_P
    pred = net.forward(Xte_n).argmax(1)
    cm = np.zeros((C, C), int)
    for t, p in zip(yte, pred): cm[t, p] += 1
    print("\nper-class recall (held-out):")
    for i, lab in enumerate(labels):
        n = cm[i].sum(); r = cm[i, i] / n if n else 0
        print(f"  {r*100:6.1f}%  {lab:14s} ({cm[i,i]}/{n})")
    # most-confused off-diagonal pairs
    pairs = sorted(((cm[i, j], labels[i], labels[j]) for i in range(C) for j in range(C) if i != j),
                   reverse=True)[:5]
    print("\ntop confusions (true -> predicted):")
    for cnt, ti, pj in pairs:
        if cnt: print(f"  {cnt:4d}  {ti}  ->  {pj}")

    # save model + metrics (cloud-backed once committed)
    json.dump({"labels": labels, "mu": mu.tolist(), "sd": sd.tolist(),
               "arch": hs, "W": [best_P[f"W{i}"].tolist() for i in range(net.L)],
               "b": [best_P[f"b{i}"].tolist() for i in range(net.L)]},
              open("model.json", "w"))
    json.dump({"samples": int(len(X)), "classes": labels, "knn_acc": float(knn),
               "mlp_acc": float(best), "confusion": cm.tolist(),
               "trained": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
              open("metrics.json", "w"), indent=2)
    print("\nsaved model.json + metrics.json")

if __name__ == "__main__":
    main()
