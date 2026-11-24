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

AGENT NAME: signals
YOUR FILES: app/workspaces/signals/*

YOUR JOB: the Signals workspace: other ways to hear a trapped person, each explained and working.

BUILD
1. Tap detector (your device, live algorithm): uses the computer's microphone (ask politely, explain why, work
   without it using a built-in synthetic recording). Real signal processing: band-limited onset detection
   (spectral flux), an inter-onset interval histogram and autocorrelation to find deliberate, repeated knocking
   (rescuers ask "knock three times"), rejection of steady noise and speech, a live spectrogram and waveform, a
   confidence meter, and a log of detected knock patterns. Test it against synthetic knock sequences mixed with
   noise at several levels and report the measured detection rate and false alarms per minute (real evidence).
   "Send to mission" would add acoustic evidence: show how it would change a lead's probability using
   app/core/fusion.js (import and call fuse; do not write to the mission).
2. Phone finder (concept, with a live algorithm): locating a survivor's phone from Wi-Fi/Bluetooth signal
   strength heard at several rover positions. Simulate received strength with a path-loss model, walls and noise
   on building B; solve position by weighted nonlinear least squares or a particle filter; draw the likelihood
   surface and how it sharpens with each new listening position; show error in metres versus number of positions
   and noise (measured on the simulation). State the privacy point plainly: only signal strength, no contents,
   and it would need permission and rules in real use.
3. Drone as a transmitter (concept): an interactive diagram of bistatic Wi-Fi sensing through rubble (a drone
   overhead transmits, the rover listens), with a simple Fresnel-zone picture that shows why moving the
   transmitter helps a still person be detected. Tie it to the real limitation in FACTS.md (still people are the
   hard case).
4. Breath plume (concept): a small 2-D advection-diffusion simulation of exhaled CO2 leaking from a void, with a
   rover gradient-climbing toward the source; honest about being an idea only.
Each of the four gets its own clearly separated area with its reality label, a two-sentence plain explanation and
controls that all work. Release the microphone in onHide.
