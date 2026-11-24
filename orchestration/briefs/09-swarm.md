You are one of a crew of expert engineers and designers building HOUND Command, working in parallel in the same
repository: ~/Developer/hound-ultra . You were dispatched as a subagent to execute a specific task. No human is
available to answer questions: never ask one, never wait for approval. Decide, build, verify, report. Do not run
brainstorming or planning skills that end by asking for approval.

READ FIRST, in this order, completely: docs/MISSION.md, docs/ARCHITECTURE.md, docs/FACTS.md, docs/STYLE.md.
Then read the core files you will use (app/core/sim.js, world.js, fusion.js, nn.js, app/ui/kit.js, tokens.css,
base.css). orchestration/reference/ holds screenshots of the previous console and landing page
(previous-console.png, previous-landing.png) and pieces of its code: that version is the FLOOR. Yours must be far
beyond it.

THE BAR. The person this is for has asked, with real feeling, for the best thing he has ever shipped: "insane
Palantir Gotham level UI", "GTA 6, Tesla FSD level graphics and interactiveness", "insane detail, ultra high
everything", and above all "do not make this AI-generated slop". Before you call anything done, ask: would
Palantir, Tesla or Rockstar put this on screen at a launch? If the honest answer is no, it is not done. Slop means:
default-looking layouts, generic cards and pills, placeholder data, flat lifeless charts, dead buttons, vague
copy, anything a template could have produced. The opposite is craft: a clear point of view, real data and real
computation behind every pixel, detail that rewards a close look, motion with purpose, and words a rescuer would
actually use. Depth beats breadth inside your area: fewer things, each finished to a professional standard, then more.

HOW TO WORK
- You own only the files named under YOUR FILES. Never edit anything else (see ARCHITECTURE.md for how to ask).
- Use your tools in parallel and write code directly. For large independent sub-parts you may launch your own
  subagents; give each a precise brief and file ownership, and check their work yourself.
- Use the design skills available to you when they help (frontend-design, impeccable, emil-design-eng,
  apple-design, dataviz, less-ai-look, hallmark). Follow docs/STYLE.md over any skill's default look.
- Verify with tools/shoot.py continuously: take screenshots, OPEN them with the Read tool, look hard, fix, repeat.
  Check 1680x1000 and 1440x900. Zero console errors. Click every control you built.
- Honesty rules in docs/FACTS.md are absolute. Label everything (live AI / live algorithm / real data / your
  device / simulated / concept). Never invent results.
- No git commit, no push, no deploy, no npm, no node (blocked). Python is fine for scripts and data prep.
- When finished, write orchestration/reports/<your agent name>.md as described in ARCHITECTURE.md, and end your
  final message with a short summary: what works, what is labelled how, what you verified, what is not done.

AGENT NAME: swarm
YOUR FILES: app/workspaces/swarm/*

YOUR JOB: the Swarm workspace: what happens when there are several rovers and drones instead of one. Only one
rover exists, so the hardware side is a Concept and must say so; the algorithms are real and run live in a
sandbox simulation of their own (do not change the main mission).

BUILD
1. A sandbox world: a larger procedurally generated multi-building site (seeded; several layouts to choose from,
   plus building B's block) on a grid, with unknown interior until explored.
2. Multi-robot exploration (live algorithm): frontier-based exploration with 2 to 12 robots, each with a limited
   sensor range and line of sight, building a shared occupancy map; frontier clustering and assignment that avoids
   two robots chasing the same frontier (compare nearest-frontier vs. auction/Hungarian-style assignment and show
   the difference in time to full coverage as a measured result).
3. Task auction: when a lead appears, robots bid (distance, battery, sensor fit) and the winner goes for the
   second look while the others keep searching; show the bids.
4. Radio mesh: a signal model (distance and walls) and automatic relay-beacon drops so every robot keeps a path
   to base; draw the mesh, show link quality, and what happens when a relay fails (re-routing or regroup).
5. Energy: per-robot battery model, return-and-swap scheduling so coverage never stops, total energy used.
6. A proper visualisation: a real-time 3-D or 2.5-D scene (three.js) with the map being revealed, robots with
   trails, frontiers pulsing, relay beacons, the mesh as lit links, and a coverage-over-time chart comparing
   strategies; controls for number of robots, strategy, speed, seed; a "race" mode that runs two strategies
   side by side. Metrics: time to 95 % coverage, distance driven, time to first lead.
7. A clear statement of what is real: the algorithms and the measurements on this sandbox are real; the fleet is
   a concept.
