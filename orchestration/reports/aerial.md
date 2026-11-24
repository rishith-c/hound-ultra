# Drone imagery (agent: aerial)

Third pass (flight film). Route `#/aerial`. Files: `app/workspaces/aerial/*`, `data/aerial/recorded.json`, `assets/img/aerial/*`.

## What it is

Demo: a self-playing film in three parts (`hero.js`).
- **Find**: a forward flight over four AI-generated frames, stacked into one strip. Tilted camera, hand-made relief, haze, dust and cloud shade for parallax, gentle bank. Heading tape and horizon at the top, height and speed tapes at the sides, a false-colour strip that trails the scan bar, and the detection score along the flight as a ridge with the crop that caused each peak. The camera comes down on each find, holds two seconds, and climbs away. It ends on the relief where height is how unusual the colour is. The floating magnified crop is gone.
- **Place**: the survey mosaic over the site model, flat then raised, pins at plan coordinates. If the mission has not flown, the button is "Fly the survey"; when the simulated drone flags someone it becomes "Send to the mission".
- **Compare**: a before/after light table with a draggable line.

Advanced: the three tools (Find people, Colour anomaly, Before / after) on real photos, synthetic frames, AI-generated frames, the site mosaic, or a dropped image, plus a scoreboard and the mission link.

## Labels on screen

| What | Label |
|---|---|
| D-FINE nano boxes and score ridge in the film | Recorded AI run, Illustration frames ("One frame live, the rest recorded" after a live run). The Live AI tag was dropped here: a replay is not live |
| Height, speed, heading, horizon, flight | Simulated flight. Worked out from the film's own camera at an assumed 0.045 m per pixel; the heading's base (47) is made up |
| False-colour strip | "False colour of the same frame". It is a colour mapping of the RGB picture. It is **not thermal** and is not called thermal |
| Relief | Made from picture brightness and noise by hand-set rules, not measured |
| D-FINE nano in Advanced | Recorded run until "Run it live" |
| RX colour test, change detection | Live algorithm |
| Compare pair, S frames, scoreboards | Synthetic |
| Site mosaic, D1 | Simulated |
| G frames | AI-generated / Illustration |
| Two extra uses of the drone | Concept, not built |

## Measured, and how

Every time below was taken on a shared machine at load average 300 to 445 (timings vary several-fold between runs). Do not quote them as benchmarks.

Synthetic people set: 12 frames drawn by the page, 96 figures, 24 per class, seeds 101-112. RX counts a hit on box overlap with 2 px pad; the network on IoU > 0.1.

| Method | Bright | Shadow | Covered | Earth-tone | All | False/frame |
|---|---|---|---|---|---|---|
| RX whole frame, threshold 8 | 24 | 23 | 24 | 0 | 71 (74 %) | 0.0 |
| RX local window, threshold 8 | 24 | 24 | 24 | 2 | 74 (77 %) | 0.4 |
| Network, one pass, score 0.3 | 0 | 0 | 0 | 1 | 1 (1 %) | 0.25 |
| Network, plus 448 px tiles, 0.3 | 0 | 2 | 0 | 1 | 3 (3 %) | 1.1 |

The network was trained on ground-level photographs and nearly fails on these overhead drawings. RX nearly fails on earth-tone clothing. Both are shown.

Change set: 8 synthetic pairs, seeds 201-208, threshold 0.6: 45 of 45 known changes, 0 false areas, shift recovered to 0 px. Plain subtraction: 45 found, 151 false areas. The generator that draws the pairs was written for this page, so this is an easy test. The Demo pair (seed 305/306) shows 5 of 5 found and 8 areas flagged, because one change breaks into several areas.

Recorded network boxes at score 0.3 or more, whole frame then whole plus tiles: G-01 0, 2; G-02 0, 1; G-03 0, 0; G-04 0, 3; G-05 0, 0; R-01 3, 5; R-02 0, 14. **No ground truth exists for G or R frames**, so these are not accuracy.

Live run (one frame, 36 tiles): finished, 0.54 s per tile. Its result left three strip boxes (0.50, 0.34, 0.50); I did not compare them with the recording one by one.

## Choices made after seeing results

- The score cut 0.3, the 0.4 tile overlap and the rule that drops boxes cut by a tile edge were chosen while looking at output on these same G and R frames. The cut rule removed a spurious third box on G-01. I tried 256, 448 and 640 px tiles on R-01, 320 and 640 on G, and earlier models, before settling.
- The hero strip (G-01, 03, 02, 05) was picked after seeing results; G-04 (oblique) was left out of it. The real beach photo was rejected as hero partly because detection was weak there and partly because enlarging real sunbathers is in poor taste. It is in Advanced.
- RX threshold 8 and change threshold 0.6 were set by judgement before any benchmark and not tuned on it.
- The 10 px rim that is not judged in change detection was added after seeing an edge artefact on S-03 and the Compare pair. The change benchmark before that rule was not kept.
- The tile order in the replay follows the camera, not the recorded order. The ridge draws each recorded score (0.2 and up) as a smooth bump of fixed width; only its height and place are data. The colour trace under it has its own scale.

## Not evidence

- The mosaic figure is drawn where the simulator put D1, so RX marking it is **circular**. The screen now says "colour test also marks it", and the log says it is not independent confirmation. The "2 of 2 methods agree" figure and the "rover can drive to" line were removed.
- D1 itself is simulated. This page does not read `world.TRUTH` or `sim.truthOf`.

## Departures from the brief

- WebGPU was tested and refuses this model (MaxPool with ceil). The detector is WASM only.
- Plan coordinates in Place come from the simulated mosaic's known scale, not from camera pose.

## Edited by someone else while I worked (about 19:55)

The positive pass (`orchestration/briefs/p3-positive.md`) edited `hero.js`, `index.js` and `concepts.js`. It removed the "missed by both" stop, mark and thumbnail, and the caption that the network does not flag the decoys. I kept the removals.
- **Consequence:** Demo still flies over G-05, where a figure in mud-brown clothing is plainly visible, and says nothing. The frames were asked to contain four people; three are marked. The network and the colour test both found nothing there. The report and the Advanced score table are now the only places the weak results show.
- I changed one line that pass had added, "shape rules them out": the network gave no boxes on G-03, but it also gave none on G-05, so it has not been shown to rule anything out. It now reads "Bright objects. Colour marks each one for a look."

## Workers and stalls (item 5)

- The detector starts only on a press ("Run it live", or Load / Score live in Advanced). Opening Demo no longer starts the analysis worker or loads the 1.8 MB beach photo; that waits for Advanced.
- `onHide` ends the film worker, the benchmark worker and the detector. Interrupted film work starts again on return; a live run is cancelled quietly. The Advanced analysis worker stays alive but idle once opened, because it holds the loaded frames. `dispose()` ends everything and frees WebGL.
- Building Place behind Find blocked the page for up to 369 ms (longtask, instrumented run). It is now split up: no long tasks over 12 s, ground mesh 360x270 to 300x225. Opening Place itself still had one 108 ms task.
- **The 40 s hang was not reproduced**, so I cannot say these changes cure it.

## Verified this pass

- Screens at 1440x900 and 1680x1000. Console errors 0 in all nine runs.
- `fps:3` or `fps:6` gave 60 in Find (1680, cruise and hold), Find while Place builds (1440), Place, Compare, and during a live run. One earlier reading, before the stall fix, was 53.7 with a 283 ms frame.
- Live run on G-01: 36 tiles, 0.58 s each. Boxes at the same corners as the recording (365,519 and 895,577), scores 0.504 and 0.345. One frame, one run.
- Leaving to Mission: detector ended, live run cancelled, no toast; the film went on when I came back. `hero.dispose()` removes the canvases; the workspace `dispose()` around it was not called.
- Advanced at 1440 opens and starts measuring. Its 60 fps was not measured again.

From the pass before, not repeated: Fly the survey, D1, Send to the mission (Demo and Advanced); the dropped flat image; the wipe by pointer events; Advanced at 1680x1000.

## Not verified

- The last leg over G-05, the finale pins' fade and the new captions were seen in stills at 1440 only. The flight was checked in stills and frame rates; nobody has watched it through as a film.
- The cleanup was not tested with a worker cut off mid-job, except the detector. The benchmark and film-worker restarts were not seen.
- Zoomed holds show the 1254 px frames at about twice their size, so they are a little soft. Tile outlines are flat and lie slightly off the relief.
- Reduced motion; keyboard on the wipe; simulator reset while the film plays; two-photo user flow end to end.
- The network dropped once during a run, so the failure text was seen; the still image and hidden button I then added for that case have not been seen.
- The detector's own download failure in Advanced.
- At 1440 the missed-figure text is below the fold of its card (scrolls). Distant ground in Place is plain.
- Phones were not checked, as instructed.

## Devpost

HOUND reads every drone frame twice: a pretrained person detector running in the browser, and a colour-anomaly test that looks for clothing that does not belong in rubble. On a synthetic test of 96 drawn figures the colour test found 77 %, missing almost all earth-tone clothing; the off-the-shelf detector found 3 %, which is why we show both and their misses. A before/after comparison aligns two flights and marks what moved; a lead on the survey mosaic gets a plan position and can be sent to the mission for a ground check.
