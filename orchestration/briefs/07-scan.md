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

AGENT NAME: scan
YOUR FILES: app/workspaces/scan/*

YOUR JOB: the 3-D scan workspace: a drone or phone scan becomes a map the mission can use, and a tool for
finding the spaces where someone could survive inside a collapse.

BUILD (three.js, one canvas, built for 300k+ points at 60 fps)
1. The point cloud. Generate a convincing scan of the site from app/core/world.js (sample points on the ground,
   walls, roofs, rubble, furniture with realistic density, sensor noise, occlusion shadows and holes), render it
   with a custom point shader (size attenuation, eye-dome lighting or similar depth cue, colour by height /
   intensity / classification / time-of-capture), with smooth camera controls and a cross-section plane you can
   drag through the building.
2. Capture replay: watch the cloud build up along the drone's flight lines, with the scanner's fan shown.
3. Classification (live algorithm): ground vs. structure vs. rubble vs. vegetation from local geometry (height
   above ground, planarity from neighbourhood covariance on a voxel grid). Show the classes and their counts.
4. Void finder (live algorithm): voxelise the cloud, flood-fill free space, and find enclosed or sheltered
   pockets big enough for a person inside the collapsed zone ("survivable voids": at least about 0.5 m high and
   1.2 m long, covered above). List them with volume, access direction and distance to the nearest lead; draw
   them as translucent volumes. Explain the idea in two sentences. Label: live algorithm on a simulated scan.
5. From scan to map: derive the occupancy grid and the walkable area from the cloud and compare it with the
   planner's grid (ctx.sim.grid): show agreement and where they differ.
6. Bring your own: drop a .ply (ASCII or binary little-endian) or .xyz file and it is loaded, classified and
   searched for voids the same way; and a simple floor-plan mode: draw walls on a grid to make a custom
   building, then export it as JSON. Handle bad files with a clear message.
7. Measure tool (click two points for distance), screenshots, and a stats panel (points, density, bounds).
