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

AGENT NAME: evidence-report
YOUR FILES: app/workspaces/graph/* , app/workspaces/report/*

YOUR JOB: two workspaces that make the mission understandable and trustworthy.

A. Evidence (id: graph). An analyst's link chart, the Palantir Gotham signature view, done properly.
   - Nodes: people, leads, readings (each piece of evidence), sensors, units, stops, rooms, hazards, routes,
     alerts, decisions (who approved what, when). Edges: "supports", "contradicts", "observed from", "in room",
     "avoids", "leads to", "approved by". Built live from ctx.sim.state; grows as the mission runs.
   - A real graph layout (d3-force with sensible constraints, or a layered layout by time), smooth, stable when
     nodes are added, with clustering by room or by sensor, edge bundling or clean orthogonal routing, zoom and
     pan, lasso or shift-click multi-select, a search box, filters by type and time (a histogram brush under the
     chart), and an "expand neighbours" interaction. Node shapes carry meaning; legend included.
   - Select a node: a detail side panel, and ctx.select() so the mission view, timeline and map show the same
     thing. Listen for 'select' to highlight from elsewhere.
   - "Why do we believe this?" for a person: a clean evidence path from the person back to every reading, with
     each reading's weight, in order. "What would change our mind?": the readings that would close the lead.
   - A table view of the same objects (sortable, filterable) for people who prefer rows.
B. Report (id: report). The hand-over document for the rescue team, written from the mission log, live.
   - Sections: summary in plain words; people found (where, how sure, by which sensors, how to reach them, where
     to break through); leads closed and why; what was NOT searched and the residual risk per room; hazards and
     the approved route; timeline of key moments; faults that occurred and how they were handled; the limits of
     the sensing (from FACTS.md); who approved what.
   - A plan drawing of the building generated in SVG (rooms, walls, people, route, hazards), print quality.
   - An INSARAG-style search marking for the block (the standard square with team, hazards, victims, time):
     render it as SVG from the mission data, with a note explaining the fields and that this is a simplified
     training rendering of the convention.
   - Export: print to PDF with a dedicated print stylesheet (A4, proper page breaks, light theme for paper), copy
     as Markdown, download JSON of the full mission log. Works at any point in the mission (partial reports say so).
   - A reassurance message for trapped people in several languages (Nepali, Hindi, English, plus a few more) that
     can be played through the browser's speech synthesis, labelled as a concept for the rover's speaker.
