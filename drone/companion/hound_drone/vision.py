"""What the camera saw, taken slowly. One frame is never believed: the same spot on the ground has to look like a person in most of the frames that could see it."""
import math

KEEP, NEED, WINDOW, NEAR = .30, 6, 10, 1.2                              # score kept, frames needed, out of the last so many, metres between two sightings of one thing


class Sightings:
    def __init__(self): self.tracks = []

    def frame(self, boxes, sees):
        """boxes: [(x, y, label, score)] already on the ground. sees(x, y) says whether this frame had that spot in view."""
        used = set()
        for tr in self.tracks:
            if not sees(tr['x'], tr['y']): continue
            hits = [(math.hypot(b[0] - tr['x'], b[1] - tr['y']), i) for i, b in enumerate(boxes) if i not in used and b[2] == tr['label'] and b[3] >= KEEP]
            d, i = min(hits, default=(9, None)); ok = d < NEAR; tr['seen'].append(boxes[i][3] if ok else 0.0); del tr['seen'][:-WINDOW]
            if ok: used.add(i); n = sum(s > 0 for s in tr['seen']); tr['x'] += (boxes[i][0] - tr['x']) / n; tr['y'] += (boxes[i][1] - tr['y']) / n
        for i, (x, y, label, score) in enumerate(boxes):
            if i not in used and score >= KEEP: self.tracks.append(dict(x=x, y=y, label=label, seen=[score]))

    def sure(self, label='person'):
        """The ones that held up, best first: (x, y, mean score, frames)."""
        out = [(t['x'], t['y'], sum(t['seen']) / len(t['seen']), sum(s > 0 for s in t['seen'])) for t in self.tracks if t['label'] == label and sum(s > 0 for s in t['seen']) >= NEED]
        return sorted(out, key=lambda o: -o[2])

    def flickers(self, label='person'):
        """Seen, but not often enough: a tarp, a shadow, a coat on a hook. Shown to the operator, never counted."""
        return [(t['x'], t['y'], sum(s > 0 for s in t['seen']), len(t['seen'])) for t in self.tracks if t['label'] == label and sum(s > 0 for s in t['seen']) < NEED and len(t['seen']) >= WINDOW]


def for_rooms(rooms, sight, views, label='person'):
    """One answer for each room: 'pos' when something that held up is in it, 'neg' when it was looked at often enough and nothing was, otherwise nothing: not looking is not an answer."""
    sure = sight.sure(label)
    for r in rooms:
        x0, y0, x1, y1 = r['box']
        if any(x0 <= s[0] <= x1 and y0 <= s[1] <= y1 for s in sure): r['aerial'] = ['pos']
        elif views.get(r['id'], 0) >= WINDOW: r['aerial'] = ['neg']
        else: r['aerial'] = []
    return rooms
