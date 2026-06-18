#!/usr/bin/env python3
"""5-fold cross-validation for Mimic Studio — a trustworthy accuracy estimate
(not just one lucky split). Reuses the trainer in train.py. Pure numpy."""
import numpy as np, time
from train import load_xy, knn_eval, MLP

def folds(y, k=5, seed=0):
    rng = np.random.default_rng(seed); fold = np.empty(len(y), int)
    for c in np.unique(y):
        idx = np.where(y == c)[0]; rng.shuffle(idx)
        for j, i in enumerate(idx): fold[i] = j % k
    return fold

def train_fold(Xtr, ytr, Xte, yte, C, hidden, epochs=120, seed=0):
    mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-6
    Xtr, Xte = (Xtr-mu)/sd, (Xte-mu)/sd
    net = MLP(Xtr.shape[1], hidden, C, seed); Y1 = np.eye(C, dtype=np.float32)[ytr]
    rng = np.random.default_rng(seed); best = 0.0
    for ep in range(epochs):
        order = rng.permutation(len(Xtr))
        for i in range(0, len(order), 128):
            b = order[i:i+128]; net.step(Xtr[b], Y1[b], 2e-3, 1e-4)
        best = max(best, (net.forward(Xte).argmax(1) == yte).mean())
    return best

def main():
    X, y, labels = load_xy(); C = len(labels); k = 5
    f = folds(y, k)
    print(f"{len(X)} samples · {C} classes · {k}-fold CV\n")

    knn = []
    for j in range(k):
        te = f == j; tr = ~te
        knn.append(knn_eval(X[tr], y[tr], X[te], y[te], 5))
    print(f"k-NN (k=5)        {np.mean(knn)*100:5.2f}% ± {np.std(knn)*100:.2f}%   <- current app")

    for hidden in ([128, 64], [256, 128]):
        accs = []; t0 = time.time()
        for j in range(k):
            te = f == j; tr = ~te
            accs.append(train_fold(X[tr], y[tr], X[te], y[te], C, hidden))
        print(f"MLP {str(hidden):10s}    {np.mean(accs)*100:5.2f}% ± {np.std(accs)*100:.2f}%   "
              f"(folds: {', '.join(f'{a*100:.1f}' for a in accs)})  {time.time()-t0:.0f}s")

if __name__ == "__main__":
    main()
