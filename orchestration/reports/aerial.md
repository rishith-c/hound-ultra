# Drone imagery (agent: aerial)

Second pass. Route `#/aerial`. Files: `app/workspaces/aerial/*`, `data/aerial/recorded.json`, `assets/img/aerial/*`.

## What it is

Demo: a self-playing film in three parts (`hero.js`).
- **Find**: a flight over four AI-generated frames. Tiles light ahead of the drone, person-like shapes lock with corner brackets and a loupe, colour heat breathes, the frame tilts into a relief where height is how unusual the colour is.
- **Place**: the survey mosaic over the site model, flat then raised, pins at plan coordinates. If the mission has not flown, the button is "Fly the survey"; when the simulated drone flags someone it becomes "Send to the mission".
- **Compare**: a before/after light table with a draggable line.

Advanced: the three tools (Find people, Colour anomaly, Before / after) on real photos, synthetic frames, AI-generated frames, the site mosaic, or a dropped image, plus a scoreboard and the mission link.

## Labels on screen

| What | Label |
|---|---|
| D-FINE nano boxes in the film | Live AI, Illustration frames, Recorded run ("One frame live, the rest recorded" after a live run) |
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
- The tile order in the replay follows the camera, not the recorded order. The "missed by both" mark on G-05 and the decoy wording were placed by eye on an illustration.

## Not evidence

- The mosaic figure is drawn where the simulator put D1, so RX marking it is **circular**. The screen now says "colour test also marks it", and the log says it is not independent confirmation. The "2 of 2 methods agree" figure and the "rover can drive to" line were removed.
- D1 itself is simulated. This page does not read `world.TRUTH` or `sim.truthOf`.

## Departures from the brief

- WebGPU was tested and refuses this model (MaxPool with ceil). The detector is WASM only.
- Plan coordinates in Place come from the simulated mosaic's known scale, not from camera pose.

## Verified this session

- "Run it live" in Demo finishes. It used to fail because the scoreboard redraw threw when no benchmark had run; fixed.
- "Fly the survey", D1 appearing in Place, "Send to the mission" from Demo and from Advanced (AL1 in mission state).
- Demo to Advanced and back. Advanced at 1680x1000 and 1440x900. RX and Before / after panels fill in.
- A dropped flat image (used to crash RX), and Before / after on a user's single photo. "Before / after" from a lone real photo now opens S-03.
- The wipe, by dispatched pointer events on the overlay.
- Console errors 0 in the last full run. `fps:3` gave 60 in Find, Place, Compare and Advanced. Two earlier, lower readings: 59.3 in Place (one 33 ms frame) and 54 across Place to Compare (one 317 ms frame, probably the Compare build; not confirmed).

## Not verified

- Reduced motion; keyboard on the wipe; simulator reset while the film plays; two-photo user flow end to end.
- The network dropped once during a run, so the failure text was seen; the still image and hidden button I then added for that case have not been seen.
- The detector's own download failure in Advanced.
- At 1440 the missed-figure text is below the fold of its card (scrolls). Distant ground in Place is plain.
- Phones were not checked, as instructed.

## Devpost

HOUND reads every drone frame twice: a pretrained person detector running in the browser, and a colour-anomaly test that looks for clothing that does not belong in rubble. On a synthetic test of 96 drawn figures the colour test found 77 %, missing almost all earth-tone clothing; the off-the-shelf detector found 3 %, which is why we show both and their misses. A before/after comparison aligns two flights and marks what moved; a lead on the survey mosaic gets a plan position and can be sent to the mission for a ground check.
