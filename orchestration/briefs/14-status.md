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

LATEST DIRECTION FROM THE OWNER (his words, after seeing the previous version and an early scaffold):
"What Codex generated was the tip of the iceberg. The live picture animation was OK, the animation was bad. I need
the most hyper-realistic, elite thing. The dashboard needs a lot of work: it is too round and bouncy. Legit make
the best thing ever. This is not even close to what I am aiming for: Palantir Gotham should see this and be like
'I need to recruit him'. Don't skimp on features."
So: hyper-real imagery and lighting; sharp, dense, engineered interface (small radii, hairlines, no bouncy easing,
no pill-shaped candy, no oversized rounded cards); animation that is precise and physical, never floaty; and
completeness: every listed feature present and finished.

AGENT NAME: status
YOUR FILES: app/workspaces/status/* , app/global/a11y.js , tests/* (except tests/smoke.html, which you may read
and extend into your own files), sw.js and manifest.webmanifest at the repository root

YOUR JOB: trust. The System check workspace proves the console works, shows it failing safely, and says exactly
what is real. Most of the reliability and honesty score lives here.

BUILD
1. Self-tests that run in the page (and at tests/index.html standalone), with a results table: what should
   happen, what happened, pass or fail, time taken, and a way to see the evidence.
   - Network parity: the browser network matches Python on all 30 windows (tolerance 0.01).
   - Input guards: wrong shape, NaN, infinities are refused with a clear error.
   - Planner: ordinary route; route around a blocked corridor; unreachable goal returns the closest approach;
     start inside a wall is handled; a demanding case (the longest cross-site route with all hazards, and 200
     random start/goal pairs: every returned path is collision-free and no path is more than a stated factor
     longer than the grid optimum); repeated runs give the same answer.
   - Fusion: prior only; one positive; repeated evidence is discounted; blind evidence changes nothing; the
     thresholds; hand-computed expected values.
   - Mission: the scripted mission completes and finds the three people, rejects both decoys, marks room 104 as
     not searched; running it twice gives identical logs (determinism); seeking to five times reproduces the
     same state as playing to them; the mission with each fault injected still completes safely with the right
     log entries; a new hazard mid-route triggers re-planning.
   - Monte-Carlo summary over 200 random-window missions (people confirmed / flagged / missed, false confirms).
   Group them as: ordinary cases, repeated cases, demanding cases, failure cases (this mirrors the judging rubric).
   Export the results as Markdown for the write-up (copy button) and as JSON.
2. Fault drills: a panel to inject each fault in ctx.FAULTS and "new hazard" into the live mission, with a plain
   explanation of what the system does about it, a live view of the response (the relevant log lines, the rover's
   mode), and a way to clear it. Every drill must be safe to run at any time.
3. The what-is-real ledger: a table of every capability in docs/MISSION.md with its reality label, where it is in
   the console (link), what is real about it, what is simulated or assumed, and the evidence. Read the other
   agents' reports in orchestration/reports/ as they appear and the workspaces themselves; mark anything not
   built as "not built" rather than describing it. Include the list of assumed numbers (fusion likelihoods,
   sensor ranges) and the facts about the network from FACTS.md.
4. Accessibility and preferences (app/global/a11y.js + a panel here): high contrast, colour-blind palette,
   reduced motion, text size; a keyboard shortcut sheet (press ?); focus management for dialogs; a live region
   that announces alerts (person found, fault) to screen readers; make sure the shell's landmarks and names are
   right (request shell changes if needed). Run an automated check of every workspace for images without names,
   buttons without labels and contrast problems, and list what you found for the orchestrator.
5. Offline: a service worker (sw.js at the repository root, registered from a11y.js with a relative path) that
   caches the app shell, modules, data and the CDN libraries after first load so the console opens with no
   network; versioned cache, safe update, and a visible "Ready to work offline" state. Never cache failed
   responses; do not break local development (skip caching on localhost unless ?sw=1).
6. Environment report: WebGL, WebGPU, microphone, Bluetooth, speech, storage availability on this device, each
   with what in the console depends on it and what happens without it.
