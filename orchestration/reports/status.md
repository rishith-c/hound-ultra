# Status agent: System check

## Built
- **Demo** (`#/status`), three full-bleed scenes: the proof wall (33 strips, one lamp per check, 30 panes that are the real CSI windows), the drill film (a private mission in the twin, broken four ways; the log lines come from the engine), and "What is real" (97 capabilities by label). Runs by itself, moves on by itself, stops for any interaction or reduced motion.
- **Advanced**, five tabs: Self-tests (evidence, plan and parity pictures, copy as Markdown / JSON), Fault drills on the live mission, What is real, Accessibility, Device and offline.
- `tests/index.html` (same suite, standalone), `app/global/a11y.js`, `sw.js`, `manifest.webmanifest`.

## Labels
Self-tests and drills: live-algo (film also sim). Ledger kinds all exist in kit.REALITY and every workspace it names is in the manifest (checked by script: 0 mismatches). Device and offline: device.

## Verified (tools/shoot.py)
- Standalone suite: **33 tests, 2,067 checks: 1,980 passed, 39 known limits, 48 failed (in 2 tests)**, 33.7 s. Monte-Carlo 200 missions: P1 84 confirmed / 116 flagged, P2 200 confirmed, P3 200 flagged, 0 missed, 0 false, 34 wasted visits. Same as docs/FACTS.md.
- Demo 1680x1000 (all scenes) and 1440x900 (film, What is real), Advanced 1680x1000 (all tabs). Wall **60 fps** (worst 16.8 ms), Advanced 60 fps.
- **Drill film: 57.9 fps over 15 s including drill changes, worst frame 67 ms. Not a clean 60.** Measured on a machine at load average about 270.
- High contrast + colour-blind palette + reduced motion + 1.25 text together, wall scene; `?` sheet opens with focus inside.
- Survives the shell's eviction: removed after five other workspaces, rebuilt with one canvas on return.
- Offline: with `?sw=1` on localhost 201 files kept, 0 failed responses kept, state "Ready to work offline"; without it 0 service workers registered.
- Console errors from my files: 0 in the final launches. One 404 remains and is not mine (copilot, below).

## The two red tests are real and were not weakened
Both are core bugs with exact fixes in orchestration/requests/status.md. Planner fix tried on a patched copy: 177 routes, worst 1.033 x optimum, about 2 ms each. On the wall they show red; until they are fixed the Demo says "2 of 33 tests failed".

## Not done / not proved
- Never loaded with the network really off: shoot.py cannot cut it. The cache contents were checked, the fallback path was not.
- "Found in the code" means the module exists and contains a tell-tale word. It is not proof the feature works. Some patterns are loose (for example /mount/, /event/i).
- Not viewed: the wall and Advanced at 1440x900; the film after the readability change (scrims) and the final floor/rover tweak beyond one frame. Not clicked: every drill (one was), Copy buttons, hover tooltip, text size in Advanced.
- WebKit and Firefox not tried. No one who uses a screen reader has tried it.
- docs/FACTS.md mentions "the console's Bluetooth button"; no code in app/ uses Bluetooth, so the ledger says "not built". One of the two needs to change.

## Accessibility audit of every workspace (24 opened, Advanced, 1440x900, once each)
1 control and 60 images without a name, 134 faint texts. Most text over pictures could not be judged and is counted as such.

| Workspace | To look at | First findings |
|---|---|---|
| Report | 87 | dt labels 4.47:1 |
| Timelines | 38 | .tl-dt 2.25, .tl-dk.a 2.77, .tl-dtext 3.07 |
| Wi-Fi AI | 30 | canvases without a name |
| Drone imagery | 21 | input.sr-only no name; canvas.aerial-thumb |
| Model forge | 4 | canvas.forge-plot, .forge-filters |
| Mission | 3 | div.mission-gauge, canvas.mission-radar, .mission-thermal |
| Triage | 3 | .triage-chip 1.04:1 |
| Vision lab | 2 | canvas.vision-vp-base, .vision-vp-over |
| Copilot | 2 | .cop-model-by, span.dim 4.32 |
| System check | 2 | selected row 4.32 (changed since; not re-audited) |
| Search strategy, Structure, Live quakes | 1 each | a canvas without a name |

Valley, Rover, Swarm, Fusion, 3-D scan, Signals, Radio twin, Deep scan, Horizon, Evidence, Training: nothing found. 3-D scan had only 23 items, so it may still have been loading.

## Found in other agents' files
- `app/workspaces/aerial/index.js:816`: TypeError, reading 'bright' of undefined, in renderScore from runBench (seen once, during the audit).
- `app/workspaces/copilot/model-comparison.json`: 404.

## For Devpost
HOUND checks itself in front of you: 33 self-tests and about two thousand checks run in the browser, each one a lamp on a wall, and failures stay red. The browser network matches the Python network on all 30 bundled windows to 0.00001. Every feature carries a label that says whether it is built, live, simulated or only a concept.
