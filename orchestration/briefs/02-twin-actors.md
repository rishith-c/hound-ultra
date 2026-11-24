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

AGENT NAME: twin-actors
YOUR FILES: everything under app/twin/actors/ (index.js and one file per actor), plus assets/models/* additions.

YOUR JOB: everything in the 3-D twin that moves, glows or tells the story. twin-core builds the renderer and
the static world and hands every actor the `t` object described in docs/ARCHITECTURE.md ("Inside the twin").
Implement app/twin/actors/index.js exporting ACTORS exactly as documented. Until twin-core's test page exists
(app/twin/test.html), develop against your own minimal harness page app/twin/actors/harness.html that builds a
bare three.js scene, a `t` object and a ground plane, runs ctx.sim, and mounts your actors; keep it working.

ACTORS TO BUILD (each finished to film quality)
1. rover: HOUND-01 as a detailed model. Try assets/models/rover_cad.glb first (GLTFLoader; it is a CAD export in
   millimetres, Z up; decimate or simplify if it is too heavy, merge by material); if it does not look right,
   model it procedurally from assets/img/rover_white.png: aluminium extrusion frame, deck, four mecanum wheels
   with individual angled rollers that spin correctly for the direction of travel, mast with the Wi-Fi antenna,
   radar, thermal camera on a tilt bracket, Raspberry Pi and battery, cables, status LED. Suspension-free but give
   it weight: tiny pitch on start and stop. Headlight cone in fog. Mode shown on the model (listening = a calm
   pulsing ring on the ground; fault = amber; all stop = red).
2. sensing: what the rover senses, made visible only while it happens. While state.sensors.listen is active:
   Wi-Fi wavefronts expanding from the mast and passing through walls (attenuating per wall crossed), the radar's
   120 degree fan sweeping, the thermal camera's view frustum with the low-res image projected on what it sees.
   When a reading lands, a brief pulse to each detection it touched. Tie everything to real state, never loop
   decorative effects when nothing is being sensed.
3. people and leads: detections as they are KNOWN, not as they are: 'possible' = an amber uncertainty volume the
   size of posSigma with a soft question-mark glyph; 'confirmed' = a warm heat-figure (standing or lying
   silhouette built from volumetric-looking shells, breathing subtly) visible through walls, with a ground ring
   and a confidence arc; 'rejected' = fades to a small grey cross. Never read world.TRUTH for these. A separate
   'truth' layer (off by default) may show the real positions as thin white outlines, labelled "ground truth".
4. drone: a quadcopter with spinning props (motion-blur discs), navigation lights, a downward camera frustum
   sweeping the ground as a bright scan line, and the survey swaths (state.map.swaths) painting onto the ground.
5. scan: the point cloud. As the drone covers ground, tens of thousands of points assemble (GPU points with a
   custom shader: size attenuation, height colouring, reveal by swath) forming the site's surfaces; when
   state.map.ready the cloud settles into the solid world. Layer 'scan'.
6. coverage: fog of war from state.map.explored and room coverage from state.coverage, drawn on the floor
   (searched = clear, lead = amber, person = warm, blocked = hatched), with the residual-risk percentage per room
   as a floor label. Layer 'coverage'.
7. hazards: world.HAZARDS and state.hazards as ground-hugging hatched zones with low animated edges; a new hazard
   arrives with a dust burst and falling debris. Layer 'hazards'.
8. routes and trails: the rover's planned path (unit.path) as a thin lit ribbon, its trail as fading breadcrumbs;
   the rescue route as a wide, flowing, unmistakable blue ribbon with direction chevrons, leg numbers, and a
   distinct "break through here" marker where a leg ends at a wall (leg.kind === 'break through'). Layers 'route',
   'trail'.
9. team: Rescue team 1 as three simple, well-made figures with helmets and packs that walk the route (walk cycle,
   ground contact), plus arrival moments.
10. markers: stops S1..S4 as numbered ground markers with listen progress rings; the staging area and drone pad
    labels; selection highlight for whatever ctx.selection is.
Everything reads fresh ctx.sim.state each frame, survives 'reset' and 'seek', honours t.reduced (reduced motion:
no pulsing, no particle bursts) and t.quality, and disposes cleanly. Budget: all actors together under 4 ms per
frame.
