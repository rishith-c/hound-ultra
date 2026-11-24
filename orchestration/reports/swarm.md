# Swarm: report

## Second pass (2026-11-23)
All five items are built, in `app/workspaces/swarm/` only.

1. **Looks.** Low moon from one side, rim light on parapets, wet-ground reflection (buildings, sky, mesh and lamps only; Demo only), haze, and building shells with windows, sills, pilasters, parapets, floor slabs and broken edges.
2. **Figures.** Display serif, right aligned, bottom right.
3. **The moment.** At 1:40 of search time one scripted beacon failure: links go dark one by one, R1 and D2 lose their path and go dark, the others re-route, new links draw, the two find their own way back and light up, and the shot holds 3.6 s. Later R1 and R4 look at one lead from two sides and their bearings cross on the person in the person colour.
4. **Timeline.** Eight hairlines, driving / listening / relaying, labelled Simulated, with the failure as a vertical break. Relaying means a beacon that machine placed is carrying traffic. A gap means off the mesh, at base or swapping packs.
5. **HOUND.** The rovers use `assets/models/hound01.bin`: the real CAD drive base. Mast, boards and battery are simple blocks at CAD positions. If the file does not load, the old generated rover is used (that fallback is not tested).

What is real in it: the failure time is **Scripted**, everything after it is the **Live algorithm** on a simulated site. The worker picks the beacon whose loss cuts off 1 to 3 machines that can get back within 9 m. The two-sided look is in the engine, Demo runs only (`pair`); benchmarks never use it. Bearing spread (thermal 2°, radar 4°) is **Assumed**. Readings from the two sides are fused as if independent, also assumed.

Drawn, not computed: links all drop at one instant and the film staggers them 0.34 s apart; slow motion is 0.12×; headlights going dark off the mesh is a drawing convention; robots are larger than life.

Checked on the final build, Demo, 1680×1000, `--strict`, one full loop to the restart: **ERRORS 0**; 60 fps (worst frame 16.8 ms) at the opening, the recovery and the crossing; "95 % of the floor mapped in 8:53, 3 people found. Simulated."; about 77 s per loop (sum of the timed steps). Screenshots of recovery, crossing and finish opened.
Checked earlier in this pass: 1440×900 recovery and crossing at 60 fps with no errors; Advanced 60 fps in race and single run at 30× (race read 56.4 at 120× before HOUND shadows were limited to Demo); reduced motion (emulated) holds still at 4:10; the failure scripted at 84, 100, 116 and 132 s on seed 3 ended each time in a real two-bearing confirmation.
Regression: campus, Hungarian, 8 seeds, median 7:50, the same as the table below. It ran before a small change to how the failing beacon is scored and a log-text change ("over 99 %"); benchmarks use neither.

Found and fixed: the follow shot went black because the drone cone shared a colour object that the flash code multiplied every frame. Not the same cause as the unproven black race view of the first pass.

Gaps from this pass:
- The loop is longer than the 45 s first asked for.
- The two-sided look makes the first machine wait (R1 listened a long time for R4) and slows the Demo run: seed 3 took 8:53 against 7:56 in Advanced, where there is also no failure. The Demo time is not a benchmark result.
- The two-sided look was only tried on seed 3.
- Switching from Advanced to Demo keeps that run, so it has no two-sided look.
- With reduced motion switched on after the start, the still keeps the opening camera and shows a frozen dying link.
- The auction panel's fusion text can still round to "100 %". The scene, Demo and the log say "over 99 %".
- Another agent changed some wording in these files during the pass (the Demo button "Switch off a beacon", captions in `director.js`). I kept it.

## What was built
Files (all in `app/workspaces/swarm/`): `engine.js` (search engine, no DOM), `live-worker.js` + `live.js` (runs the search in a worker, plays it back with interpolation), `bench-worker.js` (off-screen measuring), `scene.js`, `materials.js`, `models.js` (three.js scene; textures and models are generated in code, except the HOUND rover), `director.js` (Demo film), `index.js`, `style.css`.

**Demo mode.** A full-window night view of a campus. Six rovers and two drones leave base; headlights and sensor sweeps are drawn with real line of sight against the known map; mist over unknown ground and the building shells dissolve where the fleet has mapped; radio threads sag, snap and re-route when a beacon fails; bids show as arcs to the lead; the run holds on the first confirmed person, pulls back, states the measured time to 95 %, fades and repeats. Controls: Switch off a beacon (or click one), Pause, click a machine to follow it, drag to take the camera. The director only picks shots and playback speed; the run has one scripted beacon failure.

**Advanced mode.** Four seeded layouts, seed, 2 to 12 robots, three strategies, speed 1 to 120×, starting battery, race of two strategies, overview/plan/follow cameras, layers including a labelled hidden-map debug layer, coverage chart, task auction with every bid and the fusion steps, measured table, fleet, mesh and energy, log, and "Model and assumptions".

## Labels
- Workspace: **Concept** (one rover exists; the fleet, drones and beacons do not) and **Live algorithm**.
- Live algorithm: frontier detection and clustering, shortest paths, nearest / greedy auction / Hungarian assignment, task auction, mesh routing, battery scheduling, Bayesian fusion.
- Simulated: site, sensors, people, radio. Second-look Wi-Fi rates are the network's measured ones on simulated windows.
- Assumed, and marked so in the dialog: mapping sensor, power draw, radio constants, drone, bid weights, other sensor likelihoods, and that a drone's beacon stands on a high point.
- Scenery, never read by the robots: building outlines and heights, damage to the shells, the city around the site. The person figure is a symbol at the estimated position, not a claim about pose.

## Measured (simulation only)
Method: "Across 8 sites" in Advanced, seeds 11, 23, 37, 41, 59, 67, 73, 89, 8 robots (6 rovers + 2 drones), full packs, final engine except for a one-word log text ("hop"). Time to 95 % of the reachable floor, median in simulated time.

| Site | Nearest | Greedy auction | Hungarian | Hungarian vs nearest |
|---|---|---|---|---|
| School campus | 14:48 | 7:00 | 7:50 | faster on 8 of 8, median 47 % less time |
| Block B | 9:03 | 6:20 | 6:09 | faster on 8 of 8, median 30 % less time |

Median distance: campus 5.6 / 3.9 / 3.8 km; Block B 3.9 / 3.3 / 3.2 km. **Hungarian is not always best**: greedy has the better campus median. Coordination is what matters. Robot time spent chasing a frontier another robot already had: 62 to 96 % for nearest, 11 to 33 % for the two coordinated strategies.
Earlier figures from before this engine version are void.

## Verified in the first pass (tools/shoot.py, headless Chrome, screenshots opened and inspected)
- Zero console errors with `--strict` at 1680×1000 and 1440×900 in Demo and Advanced, and after a switch to Advanced at 1920×1080.
- Frame rate: Demo 57 to 60 fps in final builds; Advanced race 60 fps. The machine's load average was above 200; under that load one earlier Advanced single-run reading was 51 and one race reading 56, and worst frames reached 133 ms.
- Exercised by script: speed, pause/resume, restart, fail a beacon (re-routes seen in the log), plan/follow/Escape, layers, side tabs, dialog open and Escape, market/hospital/Block B, 2 and 12 robots, random seed, 35 % packs (2 swaps, never fewer than 3 of 8 searching, none ran empty in 264 s), race, Measure all three, Across 8 sites, Demo loop restart, Demo pause and fail, mode switch keeping the run, hide/show stops and resumes, no unnamed buttons, selects, inputs or canvases.
- Reduced motion (emulated in the page): Demo jumps to a still at 4:10 and does not advance.
- 14 campus seeds, after the drone-beacon fix and before the straight-line driving change: no disconnected beacons.

## Found and fixed
Drone beacons were disconnected; planning blocked rendering (now in a worker); a race view came out black once (suspected shader NaN; guarded and not seen in the later race captures, but the cause was not proven); roofs floated after facades dissolved; coplanar shell floors flickered; the clock could show a negative time.

## Known gaps
- Clicking a robot or beacon in the 3-D view, chart hover, high-contrast and colour-blind palettes, real keyboard tabbing and the no-WebGL and no-worker fallbacks were not re-tested after the rewrite.
- A beacon you switch off in Demo takes effect about a second later, because playback runs behind the worker.
- In the first lead shot the facade in front can hide the floor marker; its label and arcs stay visible.
- Not modelled: robot collisions, wheel slip, stairs, radio multipath, map noise, moving people walking away.

## For the write-up
"Only one HOUND exists, so the fleet is a concept, but the search is real code running live. Across eight generated campuses with eight simulated machines, Hungarian assignment mapped 95 % of the floor in a median 47 % less time than letting each robot chase its nearest frontier; a simpler greedy auction did slightly better still there (median 7:00 against 7:50). When a radio beacon fails, the mesh re-routes or the robots regroup, and the search carries on. In the simulated film, two machines take a second look from two sides and their bearings cross on the same person."
