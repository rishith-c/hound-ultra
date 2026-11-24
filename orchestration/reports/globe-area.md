# globe-area report (Valley `area`, Live quakes `globe`)

## What was built

### Valley, Demo: the film (new: `film.js`, `film-glsl.js`, `film-tiles.js`, `film-assets.js`, `demo.js`)
A 72 s loop in three.js: first light over the Lende Khola, down the Bhote Koshi behind a breaking surge front, then an orbit of the search block.
- Ground: the live 1024 x 1024 elevation grid in 256 frustum-culled pieces with four levels of detail; 52 km of surrounding mountains from zoom-12 elevation tiles.
- Imagery: Esri tiles streamed coarse to fine (zoom 14 everywhere, 16 over the block of tiles, 17 and 18 only round the search block). A missing tile falls back to the coarser level, and with no imagery to a colour from slope and height.
- Surface: rock, soil, vegetation and snow response by slope, height and image colour; detail normals; bumps from the image.
- Light: the sun's real position for the time shown, terrain shadows marched on the GPU through both elevation grids, volumetric mist, aerial perspective, bloom, 4x MSAA.
- Water: the same flood model as Advanced (same cells, same connectivity), moved as a front; depth shading, flow, foam, spray.
- Also: up to 163,973 tree sprites (count seen in one run), OpenStreetMap buildings extruded, the exercise block and its boundary.
- Drag, scroll, arrow keys and +/- move the camera. It returns to the film after 5 s.

### Valley, Advanced
MapLibre map, flood slider and surge, slope, sun and shadows, layers, measure and profile, exercise panel, schematic fallback. It starts only when Advanced is first opened, so the film and the map never run together.

### Live quakes
Advanced: globe, list, filters, scrubber, detail card, feed and layer controls (as built before). Demo (new): full-bleed Earth, the week replayed in 64 s, real sun and terminator, camera drifting to Nepal, three figures, then a 9 s hold.

## Labels
| Feature | Label |
|---|---|
| Elevation, imagery, rivers, roads, buildings; USGS feed | Real data |
| Flood reach, hectares, slope, sun, shadows, distances | Live algorithm |
| The water itself | "illustrative simulation, not a forecast and not a reconstruction of the real event", on screen in both modes |
| Block, units, leads, people | Simulated; drone Concept |
| Drawn, not data | Trees (placed where the image is green), mist, building heights, and block shapes. The Demo credit line says trees, mist and building heights are drawn |
| Assumed | Surge shape, 15 m height, on-screen speed; 1.7 m normal river and 3.2 m level left behind; 4 m crossing clearance; 0.3 m road depth. The film's river bed is also cut about 1.1 m so water shows (not stated on screen) |

## Corrected while finishing
- **"Cut off" was an empty figure.** In every earlier run Advanced showed 0 buildings cut off because the chosen exit (the south end of NH42) is an unconnected fragment in the OpenStreetMap extract: 0 of 675 buildings linked to it. The exit is now every road or path node within 250 m of the grid's south edge; 644 of 675 link, the rest are not counted, and the panel says so. Cut off at +2/5/10/15/18/20/30/45 m: 0/0/0/2/2/2/1/0 (it falls as buildings go under water).
- "About 100 times faster than a real flood wave" had no source and is gone.
- Unnamed peaks no longer read "Summit". Steep-camera limit lowered from 76 to 68 degrees. Compass no longer under the credit at 1440. Panels nearly solid, so map labels do not show through.
- Reduced motion did not stop a running film; it does now.
- In two earlier progress notes I called the server on port 4438 mine. My launch had failed (address in use); it was another agent's server.

## Verified (tools/shoot.py, headless Chrome with GPU, pixel ratio 1, one run each)
- Frame rate, 3 s each: film settle 60 fps and mid-flight 60 fps (worst frame 16.8 ms both) at 1680x1000; after switching back to Demo at 1440x900, 60; Valley Advanced idle 60; globe Demo 60 (1440x900). The old Demo measured 42.9.
- 0 console errors in every run that completed. Looked at: film at about 10 moments, 1680x1000 and one at 1440x900; Valley Advanced at both sizes; globe Demo at both, globe Advanced at 1440x900 (and 1680x1000 before the last changes).
- Real clicks: a measure point on the map, Enter the building (opens mission), quake list row, Replay. Called by script: replay-flight button, the mode switch both ways (state kept), and the flood slider. Escape leaves measuring.
- `?schematic` start. Film time stops in `onHide`. Reduced motion shows a still frame at 58 s.
- All 604 imagery tiles loaded, 0 failed, in the two runs where it was read.

## Not verified, and known gaps
- Really blocked tiles in the film or the map; jsDelivr blocked (three and d3 come from it, so the workspace would not start).
- Globe Demo under reduced motion; the globe Demo's final hold over Nepal (not seen on screen); the film's loop point.
- Frame rate on a 2x display (the film caps at 1.25 and lowers itself); 1920x1080; high contrast and colour-blind palettes; a full Tab order; film drag, wheel and keys; the Advanced 16 s fly-in to its end; the surge's end toast; a failed USGS fetch since the Demo was added.
- A live/saved grid difference: water reaches the block at +41.9 m on the live grid and +40.8 m on the saved one.
- Look: imagery on steep walls is stretched (true of any overhead photograph); tree sprites go dark against the sun; trees stand in flood water; the block sits on a slope, so its walls show deep plinths; unit labels crowd in Advanced.
- Screenshot runs timed out twice under load (load average near 300), so some checks rest on one run.

## For the owner: a hook to look at
PreToolUse hooks timed out and refused calls repeatedly under load: Bash, Edit and Write `[node]`, and once Read `[bash]`. Each refused write was retried, and landed; nothing was written around the hook. A longer `timeout` in settings would help; I did not change it.

## Quotable
- "The opening shot is the real Bhote Koshi valley: real elevation, real satellite imagery, and the sun where it truly stands at that minute, with a labelled illustrative surge computed on the same ground."
- "On our terrain grid the river would have to rise 41.9 m to reach the exercise block, so the 15 m illustrative surge passes below it, and the console says so."
- "Live quakes replays the last week of USGS data and refuses to guess how many people need finding: magnitude is energy, not damage."
