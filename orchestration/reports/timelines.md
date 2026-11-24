# Timelines: report

## What was built
Files: `app/workspaces/timelines/*` (index, demo, braid, island, forkset, braid.json, runner, worker, pool, model, cf, cfview, map, tree, sweeps, regret, style).

**Demo: "One mission, five worlds".** A 3-D braid. Height is mission time. Each block of ground is one world (walls, rooms, rubble and buildings placed from `core/world.js`); the threads under it are that world's real recorded rover, team and drone paths and its leads. Four forks split off: ignore the drone's lead (01:13), thermal camera fails (03:32), dismiss the uncertain lead (06:05), skip the second look (06:58). Found people are warm threads; worlds that lose someone go dark at the end; the best of the five brightens. Plays by itself (43 s loop with a held ending). Drag to turn, click a world to fly to it, Escape or the back button to return, scrub, pause. `braid.json` (44 KB) is the saved output of `forkset.js`, so it starts at once; five seconds in, the same five missions are run in workers and their fingerprints compared on screen ("5/5 replays matched here"). If they ever differ, the fresh runs replace the saved ones.

**Advanced.** Fork anywhere from the live command log (eight kinds of change); river tree with outcome columns; two synced maps with a plain-words difference list; decision sweep (26 forks) and parameter sweeps over common seeds; counterfactuals for a lead from `core/fusion.js`; regret behind a ground-truth switch, choices only (faults and slides are left out as luck); determinism proof, re-checked against the live mission every 15 s.

## Labels
- Workspace and forks: live algorithm + simulated. The mission, people and readings are simulated.
- Ground truth: shown only behind the switch in Advanced, and in the labelled ending of Demo ("known only because this is a simulation").
- Fusion weights: only the Wi-Fi weight is measured; the rest are marked assumed. What counts as the "smallest" change in "Why this lead?" uses my own costs (add 1, same spot 1.2, flip 1.6, remove 2.2, a human check 3).
- Artistic, not data: valley ridges, ground texture, dust, the helix winding of the light filaments, sideways spacing of the worlds, heights drawn 1.45 times taller, units drawn larger than scale.

## Results (one seeded simulated world; not evidence about real searches)
| World | Reached | Ends |
|---|---|---|
| As flown | 3 of 3 | 10:47 |
| Thermal camera fails | 3 of 3 | 11:48 |
| Dismiss the uncertain lead | 2 of 3 | 09:40 |
| Ignore the drone's lead | 2 of 3 | 09:21 |
| Skip the second look | 1 of 3 | 08:14 |

"Best of five" means of these five. Across 16 sets of choices tried in Advanced, visiting D1, D4, D5 ranks slightly ahead of the mission as flown (4 m less inside hazards, but the last person 31 s later), because hazard metres rank before time. The five were chosen by me, from about 35 probed, to tell the story; they are not a random sample. One odd simulator result to know: a hazard dropped in the entrance hall at 04:30 ends the mission 55 s sooner, while the same hazard at 03:20 leaves two people unreached.

## Verified (tools/shoot.py, screenshots opened)
- The browser hang: fixed. The map camera had no size on first paint and became infinite, so a grid loop never ended. This was found by reading the code; after the fix the workspace opened every time, but I did not reproduce the hang first.
- 0 console errors in the runs reported by shoot.py after the last syntax fix, three of them with --strict (two Advanced, one Demo).
- 60 fps (worst frame 16.8 ms) in Demo at the start, in the wide ending and close up, and in Advanced idle and during map playback. Headless Chrome, device pixel ratio 1, on this Mac.
- Same spec twice gives the same fingerprint; trunk matches the live mission mid-flight (02:55) and after two operator commands (all stop, resume).
- Exercised: fork, fork of a parameter change, fork of a fork, hazard placed by clicking the map, delete, arrow keys, Space, playback, all five tabs, ground-truth switch, decision sweep, one parameter sweep (confirm line, 128 missions), re-check, mode switch both ways, Demo focus and Escape, rebuild of the hero. No visible control without a name.
- The loop stops when the workspace is hidden, and under reduced motion (a still of the ending).

## Known gaps
- Looked at: Demo 1680x1000 and 1440x900, Advanced 1680x1000 and (sweeps tab only) 1440x900. 1920x1080 was rendered but not looked at.
- Not run in this pass: the other three parameter sweeps; live seek and reset while forks exist; every option of every fork kind; real Retina pixel ratio. The path where saved and fresh fingerprints differ was not triggered (the rebuild it calls was). After the last layout edits (shorter tree labels at 1440, chart tick fix) only Advanced 1680 was re-looked at.
- While a forked world is still moving away, its lamps float before its ground appears. By design, but it may read as odd.
- Parameter sweeps are heavy: 128 missions took over a minute with the machine at load 160. The default is now 64, on at most four workers.
- "Listening windows" is swept by loading sim.js with one constant rewritten (it is a literal there). See requests/timelines.md.
- Sources: Wachter 2017, O'Callahan 2017 and Deep Green 2008 were opened and checked. Pearl 2009, Savage 1951 and Morris 1991 could not be opened; they rest on search listings and are marked "Listing only" on screen.
- My own server on port 4467 (earlier pass) was stopped by its time limit; nothing is left running from it. The Bash PreToolUse hook [node] timed out on some calls under load; each was repeated once.

## For Devpost
Every rescue in HOUND Command can be forked. Because the simulator is deterministic, we replay the mission from its own command log, change one decision and run the new world to the end; each branch is run twice and must produce the same fingerprint. In our simulated exercise, skipping one second look left two of three people unreached: not a claim about real searches, but a way to see what a decision costs.
