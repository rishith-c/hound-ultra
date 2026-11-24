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

AGENT NAME: structure
YOUR FILES: app/workspaces/structure/*
WORKSPACE: id `structure`, title "Structure".
THEME: the pile is a physics problem. Before anyone lifts a slab, test the lift.

BUILD (real rigid-body physics in the page: Rapier 3-D via @dimforge/rapier3d-compat from jsDelivr/esm.sh, pinned;
three.js rendering with proper materials, shadows and dust; 60 fps)
1. The collapse, simulated: generate a seeded two-storey bay (columns, beams, slabs with realistic sizes and
   mass), fail chosen supports, and let it collapse under physics into a rubble pile with real voids. Several
   starting failures give the textbook collapse patterns (pancake, lean-to, V-shape, cantilever; verify with
   WebSearch against USAR / FEMA structural collapse references and cite). After settling, classify the pattern
   from the geometry and mark where voids typically form for that pattern.
2. Test the lift: pick any slab or beam; the simulator removes or lifts it in a copy of the world and reports what
   moves: which pieces shift, by how much, whether a void shrinks, whether load transfers onto the space where a
   person is believed to be (place a protected volume). Rank every candidate piece from "safe to move" to "do not
   touch", and propose an extraction order (greedy with look-ahead, each step verified by simulation).
3. Shake test: apply a second tremor or slide load of chosen strength and show the probability the pile shifts
   (many seeded trials), as a stability score for the plan.
4. Shoring: place virtual props or cribbing and see the stability score and the protected void respond.
5. Counting voids with topology: voxelise the settled pile and compute its Betti numbers (connected pieces,
   tunnels, enclosed cavities) with a correct cubical-homology or union-find method; show the enclosed cavities
   it finds and explain in two sentences why topology is the right tool (verify a citation on persistent homology
   for porous or granular media).
6. Routes for robots that go where rovers cannot (concept, with a live planner): a vine robot that grows from its
   tip through gaps (verify and cite Stanford's everting vine robot, Science Robotics 2017) and a snake robot;
   plan their paths through the void network with their real constraints (minimum bend radius, gap size) and
   show which voids each could reach.
State what is real: the physics engine and every measurement on this simulated pile are real computation; the
pile is not a real building and this is not an engineering assessment.
