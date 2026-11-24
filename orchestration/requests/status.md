# Requests from the status agent

The first two were found by the new self-tests (tests/index.html). The tests stay red until the fix is in; I have not weakened them.

## 1. app/core/planner.js: the corner-removal pass can cross far more hazardous ground than the route A* chose

**What.** `plan-200` compares 200 random routes with an independent Dijkstra. A* itself agrees every time. After corner
removal 47 of 200 routes cost more than 1.08 times the optimum; the worst 4.52 times. Cause: a shortcut is allowed
through any cell no dearer than the dearest cell on the piece it replaces, so a route that had to touch a few metres of
mud may then be straightened through twenty.

**The exact change.** In the last loop of `planPath`, accept a shortcut only when its own price is not higher:

```js
  const out = [pts[0]];
  const lineCost = (a, b) => { const l = dist(a, b), n = Math.max(1, Math.ceil(l / (grid.res * 0.25))); let s = 0; for (let k = 0; k < n; k++) { const t = (k + 0.5) / n, c = grid.toCell([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); s += (l / n) * grid.cost[key(c[0], c[1])]; } return s; };
  const upTo = new Float64Array(pts.length); for (let k = 1; k < pts.length; k++) upTo[k] = upTo[k - 1] + lineCost(pts[k - 1], pts[k]);
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !(gridClear(grid, pts[i], pts[j]) && lineCost(pts[i], pts[j]) <= upTo[j] - upTo[i] + 1e-6)) j--;
    out.push(pts[j]); i = j;
  }
```
(replaces the `maxTo` bookkeeping). Verified on a patched copy: see orchestration/reports/status.md.

## 2. app/core/nn.js: a window with one short row gets through the guard

**What.** `infer` checks only the first row's length. With row 30 cut to 10 samples the network answers NaN instead of
refusing (`nn-shape`).
**The exact change.**
```js
if (!Array.isArray(x) || x.length !== 52 || x.some((r) => !r || r.length !== 200)) throw new Error('A Wi-Fi window must be 52 rows by 200 samples.');
```

## 4. Seen in other workspaces (details in orchestration/reports/status.md)

- aerial/index.js:816: TypeError reading 'bright' of undefined (renderScore, from runBench).
- copilot/model-comparison.json: 404.
- docs/FACTS.md mentions the console's Bluetooth button; no code in app/ uses Bluetooth.
- Faint text and unnamed canvases per workspace: table in the report (worst: Report 87, Timelines 38, Wi-Fi AI 30, Drone imagery 21).

## 3. app/index.html: link the web app manifest (one line, optional)

`<link rel="manifest" href="../manifest.webmanifest">` in `<head>`. app/global/a11y.js adds it at run time if it is missing.
