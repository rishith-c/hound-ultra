"""Find by words: an operator types what to look for, an open-vocabulary model scores every box in every frame against it, and this turns the scores into places on the ground.
The model (OWLv2 in the console) runs on the ground station. What matters here is the comparison: a box only counts when the words fit it clearly better than a list of things that are always there."""
import math

EVERYDAY = ('rubble', 'broken concrete', 'dust', 'a wall', 'a shadow', 'wood', 'a cloth')


def iou(a, b):
    w, h = min(a[2], b[2]) - max(a[0], b[0]), min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0: return 0.0
    i = w * h; return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i)


def margin(scores, words):
    """scores: {phrase: 0..1} for one box. How much better the words fit than the best everyday thing, as a ratio."""
    best = max((scores.get(p, 0.0) for p in EVERYDAY), default=0.0)
    return scores.get(words, 0.0) / max(best, .02)


def best_boxes(boxes, words, floor=.10, ratio=1.5):
    """boxes: [(x0, y0, x1, y1, {phrase: score})] of one frame. Keeps the clear ones, and one box for one thing."""
    keep = sorted((b for b in boxes if b[4].get(words, 0) >= floor and margin(b[4], words) >= ratio), key=lambda b: -b[4][words]); out = []
    for b in keep:
        if all(iou(b, o) < .5 for o in out): out.append(b)
    return out


def places(found, near=1.0, frames=3):
    """found: [(frame, x, y, sd, score)] on the ground, from all frames. Puts sightings of one thing together, weights each by how well it was placed, and ranks by score. A thing seen in fewer than `frames` frames is dropped."""
    out = []
    for f, x, y, sd, s in sorted(found, key=lambda o: -o[4]):
        w = 1 / max(sd, .05) ** 2
        for p in out:
            if math.hypot(p['x'] - x, p['y'] - y) < near:
                W = p['w'] + w; p['x'] += (x - p['x']) * w / W; p['y'] += (y - p['y']) * w / W; p['w'] = W; p['frames'].add(f); p['score'].append(s); break
        else: out.append(dict(x=x, y=y, w=w, frames={f}, score=[s]))
    done = [dict(x=p['x'], y=p['y'], sd=p['w'] ** -.5, frames=len(p['frames']), score=sum(p['score']) / len(p['score'])) for p in out if len(p['frames']) >= frames]
    return sorted(done, key=lambda p: -p['score'])
