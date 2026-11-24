# Swarm: report

## What was built
Files (all in `app/workspaces/swarm/`): `engine.js` (search engine, no DOM), `live-worker.js` + `live.js` (runs the search in a worker, plays it back with interpolation), `bench-worker.js` (off-screen measuring), `scene.js`, `materials.js`, `models.js` (three.js scene; every texture and model is generated in code), `director.js` (Demo film), `index.js`, `style.css`.

**Demo mode.** A full-window night view of a campus. Six rovers and two drones leave base; headlights and sensor sweeps are drawn with real line of sight against the known map; mist over unknown ground and the building shells dissolve where the fleet has mapped; radio threads sag, snap and re-route when a beacon fails; bids show as arcs to the lead; the run holds on the first confirmed person, pulls back, states the measured time to 95 %, fades and repeats. Controls: Fail a beacon (or click one), Pause, click a machine to follow it, drag to take the camera. The director only picks shots and playback speed; it makes one scripted beacon failure.

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

## Verified (tools/shoot.py, headless Chrome, screenshots opened and inspected)
- Zero console errors with `--strict` at 1680×1000 and 1440×900 in Demo and Advanced, and after a switch to Advanced at 1920×1080.
- Frame rate: Demo 57 to 60 fps in final builds; Advanced race 60 fps. The machine's load average was above 200; under that load one earlier Advanced single-run reading was 51 and one race reading 56, and worst frames reached 133 ms.
- Exercised by script: speed, pause/resume, restart, fail a beacon (re-routes seen in the log), plan/follow/Escape, layers, side tabs, dialog open and Escape, market/hospital/Block B, 2 and 12 robots, random seed, 35 % packs (2 swaps, never fewer than 3 of 8 searching, none ran empty in 264 s), race, Measure all three, Across 8 sites, Demo loop restart, Demo pause and fail, mode switch keeping the run, hide/show stops and resumes, no unnamed buttons, selects, inputs or canvases.
- Reduced motion (emulated in the page): Demo jumps to a still at 4:10 and does not advance.
- 14 campus seeds, after the drone-beacon fix and before the straight-line driving change: no disconnected beacons.

## Found and fixed
Drone beacons were disconnected; planning blocked rendering (now in a worker); a race view came out black once (suspected shader NaN; guarded and not seen in the later race captures, but the cause was not proven); roofs floated after facades dissolved; coplanar shell floors flickered; the clock could show a negative time.

## Known gaps
- Clicking a robot or beacon in the 3-D view, chart hover, high-contrast and colour-blind palettes, real keyboard tabbing and the no-WebGL and no-worker fallbacks were not re-tested after the rewrite.
- A beacon failure in Demo takes effect about a second later, because playback runs behind the worker.
- In the first lead shot the facade in front can hide the floor marker; its label and arcs stay visible.
- Not modelled: robot collisions, wheel slip, stairs, radio multipath, map noise, moving people walking away.
- The scene freeze under reduced motion was added last and not inspected in a screenshot (search time held at 4:10 and Fail a beacon disabled were checked). Four Demo captions were corrected last, because robots do sometimes share a frontier and a drone listens for 10 s, not 20. After the first three, Demo read 60 fps with zero errors over its opening; the fourth ("stops and listens") is a text change made after that. Their layout was not re-screenshotted.

## For the write-up
"Only one HOUND exists, so the fleet is a concept, but the search is real code running live. Across eight generated campuses with eight simulated machines, Hungarian assignment mapped 95 % of the floor in a median 47 % less time than letting each robot chase its nearest frontier; a simpler greedy auction did slightly better still there (median 7:00 against 7:50). When a radio beacon fails, the mesh re-routes or the robots regroup, and the search carries on."
