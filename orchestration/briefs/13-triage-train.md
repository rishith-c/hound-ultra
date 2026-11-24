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

AGENT NAME: triage-train
YOUR FILES: app/workspaces/triage/* , app/workspaces/train/*

YOUR JOB: two workspaces about decisions.

A. Triage (id: triage): who first, and how to reach them. A planning aid, NOT a medical tool; say so on screen.
   - The board: every person found and every open lead as a card (where, how sure, moving or still, how long
     since found, access: walk in or break through and how far, hazards on the way), in a priority order.
   - The priority model, explained and adjustable (live algorithm): a transparent score from confidence, signs
     of life observed (motion; still people rank higher because they may be less able to help themselves), time
     elapsed, access difficulty and hazard exposure of the route, with weights the operator can change and see
     the order change at once. Show the formula and each card's score breakdown. Let the operator override the
     order by dragging; overrides are marked as human decisions.
   - Breakthrough planner: for a person behind a wall (route leg kind 'break through'), show the wall section
     from world.WALLS nearest the approach point, its material (drywall or concrete) and state, the straight-line
     distance to the person's estimated position with its uncertainty, a safe stand-off suggestion, and a simple
     cross-section drawing. Use ctx.sim.plan(from, to, {nearest:true}) to compare alternative approach sides and
     rank them by distance and hazard.
   - Send the chosen order to the route planner: ctx.sim.command('planRoute', { order: [...] }) when the mission
     is in the planning phase, with clear feedback when it is not.
   - Resource sketch: with N teams (1 to 4), which team takes whom and the projected time to reach everyone
     (a small assignment problem solved exactly for these sizes); label team counts above one as "what if".
B. Training (id: train): practise being the operator. This is also the answer to "who is this for": volunteer
   and student teams can rehearse before they ever touch a rover.
   - Scenario drills generated from the simulator with random Wi-Fi windows and different seeds
     (createEngine from app/core/sim.js with autoplay off, driven by your own loop): the trainee must start,
     decide which leads to check, when to stop checking, which hazards to avoid, approve or reject routes, and
     react to an injected fault. Fast-forward between decisions.
   - Scoring that teaches: people found by sensors vs. left to the team, false alarms chased, rooms left
     unsearched and their residual risk, time, whether the trainee approved a route through a hazard, fault
     response time. A debrief screen compares the trainee's choices with the autoplay policy and with ground
     truth (now it is fine to reveal truth, labelled), with one concrete lesson per mistake.
   - Short lessons before drills (each two or three screens with an interactive figure, not slides): how Wi-Fi
     sensing works and its limits; why fusion; reading a probability; why a human approves routes.
   - Progress saved in this browser (localStorage, guarded), with levels of difficulty (more decoys, faults,
     random windows). A printable one-page "operator card" of the procedure.
