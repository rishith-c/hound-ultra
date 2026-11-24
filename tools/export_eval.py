#!/usr/bin/env python3
"""Export the Wi-Fi network's scores on the held-out test windows, for the Wi-Fi AI workspace.

    /usr/local/bin/python3 tools/export_eval.py [--ml ~/Developer/rover-design-study/ml] [--out data/eval_scores.json]

Reproduces ml/evaluate.py exactly: the same loader and normalisation (train.load -> csi_window.normalise), the same
split by person (train.split_of(group) == 2), the same network (models/csi_nn.npz) and its stored threshold.
Writes scores and labels only, never the windows:

    test   955 windows: person score, moving score, and the truth (person, moving, kind, posture, fan, depth, group)
    val    961 validation windows: person score and the truth. The alarm threshold was chosen here.
    clean  the same 955 test windows scored by the network trained on a clean simulator (models/csi_nn_clean.npz)

Before writing, it checks the export against the published results (ml/results/synthetic.md): the confusion matrix
240 / 30 / 359 / 326 and the headline rates. If any check fails it stops and writes nothing.
Every window is simulated (Blender people in a channel simulator). None was recorded with the rover.
"""
import argparse
import json
import os
import sys

import numpy as np


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ml", default=os.path.expanduser("~/Developer/rover-design-study/ml"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "eval_scores.json"))
    a = ap.parse_args()
    sys.path.insert(0, a.ml)
    from net import CsiNet           # noqa: E402
    from train import load, split_of  # noqa: E402

    X, y, meta = load(os.path.join(a.ml, "data", "synth.npz"))
    split = split_of(meta["group"])
    te, va = split == 2, split == 1
    net = CsiNet.load(os.path.join(a.ml, "models", "csi_nn.npz"))
    thr = float(net.meta["person_threshold"])
    p = net.predict(X[te])
    person, moving = p["person"][:, 1], p["moving"][:, 1]
    kind, fan, lying, depth = (meta[k][te] for k in ("kind", "fan", "lying", "depth"))
    truth = y["person"][te]
    said = (person > thr).astype(int)

    # ---- checks against ml/results/synthetic.md -------------------------------------------------------------
    conf = [int(((truth == i) & (said == j)).sum()) for i in (0, 1) for j in (0, 1)]
    checks = {
        "windows": (int(te.sum()), 955),
        "confusion": (conf, [240, 30, 359, 326]),
        "moving found %": (round(100 * said[kind == 2].mean(), 1), 86.9),
        "still found %": (round(100 * said[kind == 1].mean(), 1), 21.4),
        "still standing %": (round(100 * said[(kind == 1) & (lying == 0)].mean(), 1), 25.5),
        "still lying %": (round(100 * said[(kind == 1) & (lying == 1)].mean(), 1), 12.4),
        "fan false alarm %": (round(100 * said[(kind == 0) & (fan == 1)].mean(), 1), 7.9),
        "no-fan false alarm %": (round(100 * said[(kind == 0) & (fan == 0)].mean(), 1), 13.0),
        "validation windows": (int(va.sum()), 961),
    }
    pres = kind > 0
    checks["still/moving accuracy %"] = (round(100 * ((moving > 0.5).astype(int)[pres] == y["moving"][te][pres]).mean(), 1), 91.5)
    bad = [k for k, (got, want) in checks.items() if got != want]
    for k, (got, want) in checks.items():
        print(f"{'ok ' if got == want else 'BAD'} {k:26s} got {got}  published {want}")
    if bad:
        sys.exit("The export does not reproduce the published results. Nothing written.")

    pv = net.predict(X[va])["person"][:, 1]
    val_empty = pv[y["person"][va] == 0]
    print(f"validation: {len(val_empty)} empty windows, false alarms at the threshold {100 * (val_empty > thr).mean():.1f} %")

    clean = CsiNet.load(os.path.join(a.ml, "models", "csi_nn_clean.npz"))
    pc = clean.predict(X[te])
    cthr = float(clean.meta["person_threshold"])
    csaid = pc["person"][:, 1] > cthr
    cconf = [int(((truth == i) & (csaid == j)).sum()) for i in (0, 1) for j in (0, 1)]
    print("clean-trained model confusion", cconf, "(published 52 / 218 / 15 / 670)")
    if cconf != [52, 218, 15, 670]:
        sys.exit("The clean-trained model does not reproduce its published confusion matrix. Nothing written.")

    r4 = lambda v: [round(float(x), 6) for x in v]          # noqa: E731  (6 places: a score just above the threshold must stay above it)
    ints = lambda v: [int(x) for x in v]                    # noqa: E731
    doc = {
        "about": "Scores of HOUND's Wi-Fi network on held-out SIMULATED windows (Blender people in a channel simulator). "
                 "No window was recorded with the rover. Written by tools/export_eval.py; reproduces ml/results/synthetic.md.",
        "simulated": True,
        "threshold": thr,
        "params": net.n_params(),
        "windows": net.meta.get("windows"),
        "published": {"confusion": [240, 30, 359, 326]},
        "checks": {k: {"got": got, "published": want} for k, (got, want) in checks.items()},
        "test": {
            "n": int(te.sum()),
            "person_score": r4(person), "moving_score": r4(moving),
            "person": ints(truth), "moving": ints(y["moving"][te]),
            "kind": ints(kind),            # 0 empty room, 1 still person, 2 moving person
            "lying": ints(lying),          # posture: 0 standing, 1 lying on the floor (people only)
            "fan": ints(fan),              # 1 = an oscillating fan in the (empty) room
            "depth": [round(float(d), 2) for d in depth],   # metres behind the wall (0 for empty rooms)
            "group": ints(meta["group"][te]),               # which simulated person or empty room the window came from
        },
        "val": {"n": int(va.sum()), "person_score": r4(pv), "person": ints(y["person"][va]), "fan": ints(meta["fan"][va])},
        "clean": {"threshold": cthr, "person_score": r4(pc["person"][:, 1]), "moving_score": r4(pc["moving"][:, 1]),
                  "published": {"confusion": [52, 218, 15, 670]}},
    }
    with open(a.out, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    # read the file back and check it the way the page will: score > threshold on the rounded numbers
    back = json.load(open(a.out))
    t, th = back["test"], back["threshold"]
    conf2 = [sum(1 for s, p in zip(t["person_score"], t["person"]) if p == i and (s > th) == bool(j)) for i in (0, 1) for j in (0, 1)]
    cconf2 = [sum(1 for s, p in zip(back["clean"]["person_score"], t["person"]) if p == i and (s > back["clean"]["threshold"]) == bool(j)) for i in (0, 1) for j in (0, 1)]
    if conf2 != [240, 30, 359, 326] or cconf2 != [52, 218, 15, 670]:
        sys.exit(f"The written file does not reproduce the published tables: {conf2} {cconf2}")
    print("the written file reproduces 240 / 30 / 359 / 326 and 52 / 218 / 15 / 670")
    print("wrote", a.out, f"({os.path.getsize(a.out) / 1024:.0f} kB)")


if __name__ == "__main__":
    main()
