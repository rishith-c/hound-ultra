# evidence-report: Evidence (graph) and Report (report)

## What was built
**Evidence, Demo** (`graph/hero.js`, `graph/run.js`): a 3-D space-time picture. The building is on the floor, height is mission
time. The recorded paths of rover, drone and team climb through it; each reading hangs where and when it was taken; threads run to
the lead it supports or contradicts; rooms light up warm as a person becomes likely. Plays the mission in about 21 s, then holds on
"Why do we believe someone is in room 103?" with the readings, weights and running probability. Drag, hover, scrub, pick a lead.
**Evidence, Advanced** (`index.js`, `model.js`): live link chart (Flow, Time, Clusters), search, lasso, filters, time brush, expand /
isolate / hide, "Why do we believe this?", "What would change our mind?" (re-runs the real fusion), table view.
**Report, Demo** (`report/hero.js`, `raster.js`): the finished report as a bound document on a desk under a lamp. Pages are the same
HTML that prints, rasterised in the page; they turn by themselves; the plan is inked in four passes. Click a page or the stepper.
**Report, Advanced**: live A4 report, plan drawing, INSARAG-style marking, print, Markdown, JSON, reassurance message in six languages.
In Demo both use a finished run: the live mission replayed if it is complete, otherwise a clean run of the same exercise.

## Labels
- Live algorithm: both workspaces (graph, fusion re-run, report writing). Readings, people, damage, team: simulated, said on screen.
- Demo says "complete run" or "your run", so a background run is not mistaken for the live mission.
- Likelihood ratios: "assumed" where shown, except Wi-Fi: measured, on 955 simulated test windows.
- Reassurance message: concept; the voice is "your device". Translations are marked drafts that a native speaker must check.
- INSARAG marking: "simplified training rendering", with what we are not sure of. Desks and loose rubble in the hero are set dressing.

## Verified (tools/shoot.py, headless Chrome, this Mac; screenshots opened)
- --strict, 0 console errors in the runs made: graph Demo and Advanced, report Demo and Advanced, at 1680x1000 and/or 1440x900.
- FPS 60 (worst frame 16.8 ms, 180 frames, pixel ratio 1) for graph Demo playing and resting, graph Advanced, report Demo.
- Background run: 290 ms on first measurement, ends at 649.7 s.
- PDF made by Chrome printToPDF: Print document 11 pages A4; Cmd+P in Demo 11 pages; Cmd+P in Advanced at 05:00, 9 pages marked
  partial. Pages 1 to 6 of the Print document read by eye; only pages 1 and 2 of the two Cmd+P files.
- Clicked: zoom, fit, hide, show everything, unpin, grouping, table; graph stepper, replay, scrub bar; report stepper, Next page,
  Print (window.print stubbed), Markdown preview, JSON download. Run with Wi-Fi faults and a new hazard: 14 pages, faults listed.
- Reduced motion (graph hero), high contrast (no errors only). [ and ] chapter keys still work.

## Errors found and fixed on the way
Cmd+P in Demo printed one blank page; leads showed the wrong closing time; room 103 said "possible" and, after my first fix,
"chance someone was missed 95 %"; a Demo headline over-claimed "no one in room 102" (now "why did we close the lead").

## Known gaps
- Copy as Markdown was blocked in headless Chrome (no clipboard permission, no user gesture): the error message works, success is unproven here.
- Speech was never heard. No Nepali voice was installed in the test browser, so Play is disabled for Nepali there. .md download not clicked.
- Pages are rasterised through SVG foreignObject. Only Chrome was tested; other browsers may refuse it and then get the flat pages. That
  fallback, and WebGL failure, were not exercised. Pixel ratio 2 and 1920x1080 not measured. Report hero: seen still after switching to reduced motion mid-film; a cold start under reduced motion was not tried.
- Pages rasterise one at a time: on a busy machine the cover took several seconds; blank pages show under the lamp meanwhile (not re-timed).
- Person blocks do not split, so pages 3 and 4 have white space. In the last ink pass the route shows a faint dotted edge before it is drawn.
- Real mouse drag-to-pin, real brush drag and "Open the Wi-Fi AI workspace" not tested.
- Subagent note: report-builder was cut off by a usage limit with no summary; its code was reviewed by running it, not line by line.

## For the Devpost write-up
"In our scripted simulation the Wi-Fi network said no three times about the person in room 103. Small-motion radar and thermal outvoted
it, and the console shows every reading, its weight, and which weights are assumed." "The hand-over report is written from the mission
log, prints to A4, and says which room was never searched and that the demo, not a person, approved the route."
