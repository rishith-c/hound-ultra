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


YOUR NAME: 28-rover. YOUR FILES: app/workspaces/rover/** , assets/models/rover_parts.* (and the Python that bakes it).
The workspace is already in the shell's MANIFEST (id `rover`) and is chapter 04 "The rover" of Demo mode, between "The
network" and "The search". Read docs/ARCHITECTURE.md "Demo mode and Advanced mode" and the end of docs/STYLE.md first.

WHY IT EXISTS. Every other chapter is simulated. This one is the proof that the machine is real. The judge must leave it
thinking "students built that". Reality label: `built` (already in kit.REALITY), plus `live-ai` nowhere here.

THE DEMO HERO (spend most of your care here). A dark studio, like a car reveal. The rover from our own CAD
(assets/models/rover_cad.glb, 22 MB, too heavy to ship: bake it with a stdlib Python script into one or two binary files
under 2 MB in total, keeping every real part as its own group; assets/models/bake_hound01.py shows the format it was read
with, and app/twin has the loader for hound01.bin) stands on a wet black floor with real reflections, one soft key strip
light sliding along the aluminium extrusion, a rim light, contact shadow. Brushed aluminium, anodised black, rubber
rollers, green PCB, brass: physically based, anisotropic where it is brushed, with bevel highlights so nothing looks like
a flat box. Then, by itself, in one continuous eased move of about 14 s, no cuts:
  1. light slides over the closed rover, camera low and close, wheels first (every mecanum roller visible);
  2. it comes apart along its real axes, slowly, weightless, exactly aligned: frame, four steppers and mecanum wheels,
     deck, electronics (Raspberry Pi 4, Arduino UNO R4, DRV8825 drivers, LiPo), sensor mast, sensors. Thin leader lines
     draw themselves to five labels only: "Wi-Fi radio", "Radar", "Thermal camera", "The computer that runs the network",
     "Mecanum wheels". A pulse of warm light runs from the Wi-Fi radio along its cable to the computer;
  3. it closes again with a soft mechanical settle, the camera arrives at the exact angle and framing of the photograph
     assets/img/landing/rover-real.jpg (the real machine on a wooden floor), and the render dissolves into the photograph
     through a clean vertical wipe that the viewer can drag left and right afterwards (pointer drag, arrow keys). Match
     the silhouette as closely as you can by solving the camera (do it numerically from a handful of wheel and mast
     points, not by eye). Hold there. Headline: "This one is real." One line under it: "Built by students. Driven from a
     laptop over Wi-Fi." Button: "Take it apart again".
  Before that the headline is "The rover that carries it".
The operator can grab and orbit at any time (spring, interruptible, no bounce) and scroll to scrub the explode.
Honesty: the CAD is a design model and the built rover differs in places (foam mast, wiring); say so in one quiet line in
Advanced. The cardboard-and-tape look of the real one is a strength: never hide it, never retouch the photo.

ADVANCED. The same model as an engineering instrument: click any part (or row) to isolate it, see what it is, its role,
its interface, its power rail and its place in the chain (sensor, bus, computer, decision), with only facts from
docs/FACTS.md and the sources it lists (the mecanum rover design study at ~/Developer/rover-design-study is the owner's own
project: read it, never edit it; do not use anything about other robots there or in memory). Views: exploded slider, section
plane, X-ray, signal path (Wi-Fi probe in, 52 values, network, answer out), power path, mecanum kinematics you can drive
with the arrow keys (wheel speeds computed live, rollers really turning), and the 400 ms safety stop shown as a timeline.
Weights, prices and torque only if a source in the repo or design study states them; otherwise leave them out.

GRAPHICS NOTES. three.js r180 from the import map. Build one PMREM environment from a hand-made studio (strip lights,
soft boxes) in code; do not load an HDR. Reflective floor by a planar reflection at half resolution or a screen-space
trick; 60 fps at 1680x1000 (measure with `--do fps:3`). Use only one WebGL context and dispose it or stop rendering on
hide. Adaptive pixel ratio. Respect reduced motion (show the exploded still, then the photo). Show a first frame within
1.5 s of opening and preload the photo.

Be economical: about 90 tool calls, about 20 screenshots, one at a time. `tools/shoot.py` serves the site itself; run
JavaScript checks only inside it (`--do eval:`), never through osascript or another runtime. Do not start servers.
When done write orchestration/reports/rover.md and stop.
