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

AGENT NAME: globe-area
YOUR FILES: app/workspaces/globe/* , app/workspaces/area/*

YOUR JOB: the two "real world" views. Reference code from the previous version is in
orchestration/reference/geo-map.js, flood.js and terrain.js (MapLibre terrain setup, sources); reuse what is good.

A. Valley (id: area): the real valley in 3-D, far beyond the previous console's map (see
   orchestration/reference/previous-console.png).
   - MapLibre GL JS (pin a 5.x version from jsDelivr) with real terrain (terrarium elevation tiles
     https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png), Esri World Imagery satellite tiles
     (https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}), OpenFreeMap
     vector tiles for rivers, roads and buildings (https://tiles.openfreemap.org/planet), sky and fog, hillshade,
     3-D buildings. Credit Esri, Maxar, Mapzen/AWS terrain tiles and OpenStreetMap on screen.
   - Centre on Timure, Nepal (world.SITE.anchor: 28.25285 N, 85.36667 E), cinematic opening fly-in from high
     altitude down the Bhote Koshi valley to the block, then free control. Pitch, bearing, terrain exaggeration.
   - A flood model on the real terrain (live algorithm, labelled "illustrative simulation, not a forecast and not
     a reconstruction of the real event"): read the elevation tiles into a height grid, raise a water level from
     the river with a slider and an animated surge, flood-fill connected cells below the level, and draw the
     inundated area as animated water with depth shading; show flooded area in hectares and which mapped
     buildings and road segments are cut off.
   - The exercise on the map: the site footprint (world.SITE, 120 by 90 m placed at the anchor) with building B,
     staging, the drone's survey lines and live positions of the rover, drone and team from ctx.sim.state, leads
     and people as markers; sectors of the wider search drawn as a grid with status; a button "Enter the
     building" that opens the mission workspace (ctx.shell.open('mission')).
   - Tools: measure distance, terrain profile along a drawn line (elevation chart), slope shading to show
     landslide-prone slopes (computed from the elevation grid), sun position by time of day.
   - Offline or blocked tiles: detect it and fall back to a drawn schematic so the workspace is never blank.
B. Live quakes (id: globe): real data.
   - A beautiful 3-D globe (three.js): night-side city lights or a clean vector earth, atmosphere glow, slow
     rotation, plate boundaries. Earthquakes from the USGS live feed
     (https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson and 4.5_month.geojson; CORS is
     open) as pulses sized by magnitude, coloured by depth, with a time scrubber that replays the last week.
   - A sortable list with magnitude, place, time and depth; click to fly there; link to the USGS event page.
   - "How many people may need searching for?" is NOT something to invent: instead show only what the feed gives
     (magnitude, depth, felt reports, alert level, tsunami flag) and explain in one line why magnitude alone does
     not tell you damage.
   - Handle a failed fetch (cached last result in memory, clear message, retry). Label: real data, with the fetch
     time shown. This shows the console could be pointed at a real event; say that the exercise itself is simulated.
