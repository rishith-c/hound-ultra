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

AGENT NAME: mission
YOUR FILES: app/workspaces/mission/* , app/global/narration.js

YOUR JOB: the Mission workspace: the main screen, where the whole search is run and understood. It embeds the
3-D twin (import ../../twin/index.js; if it fails to load, fall back to your own 2-D tactical map on canvas so the
workspace always works; build that 2-D map properly anyway, it is also the minimap).

LAYOUT (the 3-D view fills the workspace; instruments float over it as .glass panels and can be collapsed)
- Left: the mission stepper (the eight phases from ctx.PHASE_INFO, where we are, what happens next) with exactly
  ONE primary button for the next human decision: Start mission / Check this lead / Plan the rescue route /
  Approve route. With autoplay on, the button shows what will happen and a small countdown; pressing anything
  takes control (sets autoplay off) and says so. Below it, the unit list (rover, drone, team: mode, battery, link).
- Right: the inspector. Shows whatever ctx.selection is: a lead or person (confidence, status, why: the fusion
  steps as a small waterfall, each evidence row with its sensor, what it saw, when, and whether its weight is
  measured or assumed), a room (coverage, reach, residual risk in words: "8 % chance someone was missed"), a unit,
  a hazard, a stop. With nothing selected: the live sensor stack for the rover (Wi-Fi window being collected with
  its progress, last network output against the threshold, radar plot, thermal thumbnail, distances).
- Bottom: the timeline. Tracks for phases, rover activity (drive/listen), readings, leads and people, alerts.
  Scrub by dragging (ctx.sim.seek), play head, zoom, click an event to select and fly to it. Transport and speed
  live in the top bar already; do not duplicate them, but show the simulated-time scale clearly.
- Top of the view: camera mode switch (orbit, top, follow, rover view, cinematic), layer toggles from
  twin.layers(), a minimap, and a compact legend.
- Alerts: when a person is confirmed, an unmissable but dignified moment: the view pushes in, a card says
  "Person found in room 112. 94 % confidence. Wi-Fi network and radar agree." with "Show evidence" and
  "Plan rescue". When a lead is closed, say why in plain words.
- Decisions need a human: route approval is a real dialog showing length, time on foot, each stop, what the
  route avoids and where the team must break through; "All stop" works at every moment.
- narration.js (global): a calm, optional guide that explains what is happening and why in one or two sentences
  as the mission moves (for a first-time viewer and for the demo video), with a toggle; never covers the subject.

Also build: the route options (which hazard types to avoid: planRoute {avoid}), "New hazard" (command newHazard)
as a clearly labelled drill button that shows re-planning, manual mode end to end (autoplay off: every step
needs the operator), and restart. Every piece of text follows docs/FACTS.md.
Test the whole mission at 32x from start to finish in both autoplay and manual modes, plus seeking backwards and
forwards, with zero errors.
