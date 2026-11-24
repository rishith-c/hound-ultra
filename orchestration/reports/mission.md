# Mission workspace: report (agent "mission")

Files: app/workspaces/mission/* and app/global/narration.js. Nothing else was edited. Requests to other owners: orchestration/requests/mission.md.

## What was built
- **Demo (film.js).** The 3-D twin fills the stage. Lower left: one serif headline, one line, the reality tags. Lower right: one instrument that changes with the moment (survey points, distance to go, rooms searched, the Wi-Fi strip with the network's output, route length, people reached). Below: a hairline timeline (click, drag, arrow keys) and one button, Take control. A find slows the film to 1x, dims the site and joins the person to each sensor that reported a sign, while the probability climbs through its real fusion steps. The film sets its own pace among the top bar's speeds, stops if you pick a speed, and restarts itself at the end.
- **Advanced.** Stepper with one primary decision, units, inspector, live sensors, timeline, camera modes, layers, drill, guide, alerts, route approval. Minimap collapsed at first; one small alert card at a time; the view keeps its subject clear of the panels and the person card.
- **2-D tactical map** as fallback and minimap. **Guide** (narration.js): an alert is now said at once and held 6 s.

## Labels
| Feature | Label |
|---|---|
| Site, people, rover motion, radar, thermal, distances | Simulated |
| Wi-Fi network output | Live AI: the trained network runs in the page, on simulated test windows |
| Output line while a window is still arriving | Live AI: the same network re-run on the part received, the rest set to zero. Only the whole-window value is the reading |
| Fusion weights | Wi-Fi: measured on 955 simulated windows. All others: assumed, marked where shown |
| Route planner | Live algorithm. Walking speed 1.1 m/s: assumed |
| Drone | Concept. Rescue team: simulated |

The film runs a second copy of the simulation in the background to know the mission's length and which window comes next, with the default scripted seed. After manual changes its tick marks and the strip drawn during collection may not match; the score corrects itself when the real reading arrives.

## Verified (tools/shoot.py, headless Chrome, machine shared with other agents)
- **Demo, 1680x1000, 3-D:** one uninterrupted film from start to complete and into its own restart. 633 brightness samples, 0 near-black. 0 errors.
- **Advanced, 1440x900, 2-D, 32x:** scripted end-to-end test: manual start, battery swap, all stop and resume, dismiss with confirm, skip checks, plan, decide later, reopen, seek closes the dialog, key seek, collapse buttons, guide toggle, reset, autoplay to complete (t = 649.2), seeks to 600, 100, 450, 30, 640. 0 errors.
- **Advanced, 1440x900, 3-D:** manual from Take control to planning, throw away and plan again, approve, corridor drill (1 hazard, 1 replan), five camera modes, 12 layers toggled, five seeks, to Report and back, select a unit. 0 errors. The team's walk was not followed to the end.
- **Earlier session, 2-D:** autoplay to complete (1 error: another agent's missing file) and manual to complete at 1680x1000; timeline drag; path drill; inspector views.
- **Film controls:** rail click, arrow key, Take control, mode switch, All stop headline, reduced motion (held beat shown).
- **Frames a second (--do fps:3, one 3 s sample each):** Demo 1680: 60, 60, 58.3. Demo 1440: 59.3. Advanced 1680: 60. Advanced 1440: 60 and 57. Worst frame 33.4 ms. An early sample of the old layout gave 43.8. Taken at different moments while the twin was being edited.

## Found on the way
- **Black 3-D frames.** Before rover.js was saved at 18:14, 137 of 298 samples were near-black. My first guess (see-through walls) was wrong, and an A/B cleared my lens shift. NaN pixels traced to the HOUND-01 model. Afterwards: 0 NaN in 40 tries, then 0 dark in 633. I did not see the change itself, so the cause is likely, not proven; a guard in post.js is requested.
- **The planned route crosses marked hazards** (unstable slope, deep mud) even with "keep clear" on, because the planner only makes them costlier. The approval dialog and the film now say so.

## Known gaps
- Not run: the full mission at 32x in 3-D; a manual mission to complete in 3-D; high contrast and colour-blind palettes by eye; a full Tab pass; 1920x1080; a measured check that animation stops in onHide.
- The score shows a dash for a window reached within seconds of loading, until its trace is computed.
- Cameras are the twin's: in some finds and listening shots a wall is close to the lens (request filed).
- At 1440 the Advanced toolbar takes two rows and the unit list can need scrolling. A seek clears a held beat.
- The radar range label can touch a ring label; in the 2-D map the Unit and Staging labels can overlap.

## For the Devpost
HOUND Command plays a whole search as a film you can stop and take over at any moment. The trained Wi-Fi network, the sensor fusion and the route planner run live in the browser on a simulated disaster site, and the console says which numbers were measured, assumed or simulated. When a person is found, the film holds and shows which sensors agreed and how the odds rose.
