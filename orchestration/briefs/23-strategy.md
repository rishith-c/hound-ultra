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

LATEST DIRECTION FROM THE OWNER (his words): "I need the most hyper-realistic, elite thing... too round and bouncy
[was one example]... Palantir Gotham should see this and be like 'I need to recruit him'. Don't skimp on
features." And, about this very wing of the product: "I told you to come up with 30+, 10000x more niche, 1000x
frontier technologies, using the most mind-boggling, what-the-f*** level technologies, and the same goes for every
pixel of this website." He does not want the obvious. He wants a visitor to stop and say "wait, that is real?".

THE FRONTIER WING. You are building one lab in a wing of the console that shows where search and rescue could go:
real frontier science, each idea (a) explained in two plain sentences, (b) tied to real published research or a
real fielded system that YOU VERIFY with WebSearch/WebFetch before citing (author or lab, year, a link; if you
cannot verify it, do not cite it and say "idea" instead), and (c) made tangible by a WORKING interactive
simulation or a real model running in the page, not a picture of one. Every exhibit carries its reality label
(most are "Concept" for the hardware plus "Live algorithm" or "Live AI" for the computation in the page) and one
honest line: what would have to be true for this to work in the field, and what is unknown. No hype, no claims
that HOUND has this hardware. The craft standard is a science museum's best exhibit crossed with a Gotham
workspace: beautiful, exact, instantly graspable, and deep when you lean in. Each exhibit must run its real
maths: when you show a reconstruction, it is reconstructed in the page from simulated measurements, and you show
the error against the simulated truth.

AGENT NAME: strategy
YOUR FILES: app/workspaces/strategy/*
WORKSPACE: id `strategy`, title "Search strategy".
THEME: the mathematics of where to look next. Real decision science, measured.

EXHIBITS
1. Search theory, the method that found lost submarines and the wreck of Air France 447 (verify and cite:
   Koopman's search theory; Stone et al. on AF447). Build it properly for building B and the wider site: a prior
   probability map of where people are (probability of area), sensor probability of detection as a function of
   range and walls (from world.SENSORS and the network's measured rates in docs/FACTS.md), and the Bayesian
   update of the whole map after each unsuccessful look. Show the map evolve as the mission runs
   (ctx.sim.state: stops, readings, coverage) and the cumulative probability of success over time.
2. Where to listen next: for every reachable cell, compute the expected information gain (entropy reduction of
   the map) of stopping there for one 10 s window, minus the travel time cost; draw it as a field with the best
   next stops ranked. Compare with the mission's fixed stops.
3. The mission as a planning problem under uncertainty (POMDP): implement a Monte-Carlo tree search planner
   (POMCP-style, with a rollout policy) that chooses the sequence of stops, second looks and when to hand off to
   the team, and evaluate it against (a) the scripted route and (b) a greedy information-gain policy on many
   randomly generated worlds (random people, decoys and layouts using your own lightweight world generator and
   the same sensor model). Report measured results with confidence intervals: people found per minute, time to
   first find, false alarms chased. Show the search tree growing live for one decision.
4. Many teams, one plan: assign teams to people and order the visits (a small vehicle-routing problem). Solve it
   three ways and compare: exact for small sizes, simulated annealing, and a quantum-inspired annealer
   (path-integral / simulated quantum annealing on the QUBO form), labelled exactly as what it is: a classical
   simulation of the quantum method, no quantum hardware. Show the energy landscape and convergence.
5. The value of a sensor: use the same machinery to answer design questions with numbers: how much does adding
   thermal, or doubling Wi-Fi range, or halving the false-alarm rate, improve people found per hour? A small
   table of measured what-ifs. This is direct evidence that the AI design choices matter.
Make the centrepiece a living probability map of the building that is as beautiful as it is correct.
