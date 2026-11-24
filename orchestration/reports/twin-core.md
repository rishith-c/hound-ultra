# Report: twin-core (3-D digital twin)

## What is built (all in app/twin/, plus data/twin_terrain.bin and data/twin_terrain.json)
- First light after the flood: photographed dawn sky, low warm sun from behind the right-hand ridge, cool fill, height-fog valley mist, reflections from a map made of the same sky. `twin.setLight('dawn' | 'day' | 'night')`; `t.light` for actors. Floodlight mast and tent bulb as working lights.
- Image pipeline (post.js): 4x MSAA HDR, ambient occlusion, screen-space reflections on wet ground only, height fog, restrained bloom, depth of field in the cinematic camera only, ACES, vignette, grain. NaN pixels are cleaned before bloom.
- Place: real heights around Timure with the levelled exercise pad, river, pines, stone houses, footbridge, prayer flags. Photo materials from assets/img/gen and assets/img/gen/twin (normal and height derived in code).
- Debris: half-buried truck, bus shelter, silt against block B, trunks, sheets, branches, bricks, planks, paper, desks (instanced).
- Block B: walls within a few metres of the rover (and of the team, or a person being found) become fresnel glass, with whatever hangs on them; the roof dissolves along a swept edge; wet floor; tin awning; notice board.
- Cameras: critically damped springs, shot director, terrain and wall avoidance, `twin.setSafeArea`. Labels de-collide, respect the safe area, fade with distance, at most five in Demo.
- Bus: `twin:camera`, `twin:layer` in; `twin:ready`, `twin:layers`, `twin:camera:changed` out. Demo hides coverage and grid, and holds hazards until the route needs them.

## Labels and facts
- Simulated: the site, buildings, damage, people and every mission event (caption on the canvas; Mission shows its own badge). Scout drone is labelled concept.
- Real: terrain heights (Mapzen terrain tiles), river course and some house footprints (OpenStreetMap contributors, ODbL). Invented: the levelled pad, extra houses and trees, all debris.
- The ground, wall and sky pictures are generated images, not photographs of Timure. Files named "photos" should not be presented as photographs of the place.
- Credit still to be shown in the product: Mapzen / OpenStreetMap contributors. The twin caption does not carry it.

## Second pass (orchestrator's five points)
1. Corrugated iron: the wide stripes were 10 ridges stretched over 5 m. New shared sheet (util.js ironSheet): 76 mm ridges in the normal map, dull zinc, rust runs, dents, torn edges. Used for the awning, bus shelter, flood debris, rubble and block B's roof; the loose sheets in site.js and massing.js get the new material only. The photo tin on the town roofs is rescaled (13 or so ridges to 1 m). Found on the way: the awning and the entrance notice board had always been drawn at the site origin (a frozen matrix); both are now where they belong.
2. Conifers: roughly half to two thirds the size, none on rock faces, thinned to none by about 50 m above the pad, set into the slope, darkened where the hill shades them at first light, haze with distance.
3. Survey points: NOT fixed in the product. The fix is in actors/scan.js, which I do not own. A tested patch is in orchestration/requests/twin-core.md. On my side, roof puddles and reflections now fade out with distance (roof 25 to 55 m, reflections 32 to 75 m), which removed dithered white patches.
4. Wall-mounted things (boards, charts, clocks, hooks and their bags, notice boards, extinguisher) use the same reveal as the walls and go with them. Floor-standing shelves and cupboards stay on purpose.
5. NaN guard before bloom: was already in post.js. setSafeArea: was already there. Listening and find shots now choose the yaw with the fewest walls in the way (cameras.js clearYaw).

## Verified in the second pass (tools/shoot.py, headless Chrome, device pixel ratio 1, no console errors in any run that completed)
- Mission page, --do fps:3, render scale read before and after as 1.000: Demo 60 fps at 1680x888 (worst 16.8 ms), Advanced 59.3 fps at 1464x922 (worst 33.4 ms). Phases deploy and search only.
- Test page 1680x888, the engine's own average: survey 60 at scale 1 (262 calls), listen 60 at scale 1 (132 calls), find 60 at scale 1. Two other survey runs fell to scale 0.875 (60 fps) and 0.75 (47.6 fps). One was preceded by load averages above 300, so I do not know how much is the twin and how much the machine.
- Sight line at the five listening positions (t = 251, 281, 347, 401, 464): no wall within 3 m of the rover at any; one wall further out at the last; sightline clear at three, low furniture partly in the way at two.
- Looked at: survey with points (before and after the patch), awning, bus shelter, notice board, two listening shots, one find (an injected test detection), Mission Advanced.

## Corrections to the first report
- Its frame rates were headed "pixel ratio 1". The render scale was not logged then and the floor had just been lowered to 0.75, so those figures (60 / 60 / 54 to 60 / 54 / 53) may be at reduced scale. With a floor of 1.0 the last runs measured 29 to 30 fps.
- It said slow runs happened while other agents shared the GPU. I had no evidence for that.
- The cause of the black frames was never proven; they have not come back since the guards.

## Known gaps
- 60 fps is not guaranteed: the render scale drops to 0.75 under load. Device pixel ratio 1.5 and 2 not measured.
- First draw compiles about 150 shader programs: slow first load, possible stall when seeking.
- Not looked at: day light, reduced motion, roof dissolve part-way, mouse and keyboard since the camera rewrite, low quality by eye, the footbridge and river close up, the sheets in the rubble and on roofs close up, Mission Demo by eye in this pass.
- clearYaw picks once per shot; the view then drifts about 0.03 rad/s, so a long stop can swing a wall back in. It also counts walls, not tall furniture along the whole line.
- Debris, rubble and roof pieces sit in slightly different places than before: the new sheets draw from the same seeded random stream.
- Received from twin-actors (requests/twin-actors.md) and not done, as outside the five points: rim of the glass cut too bright and blob-shaped, screen-door dither in floor reflections (visible in close puddles too), room labels in Demo, fog coverage in Demo. Their floating-posters item is done.
- scan.js: twin-actors dimmed its colours at 19:08, before my test pictures; jitter and fade are still missing.
- A small dot of a label leader at the top-left corner of the canvas. The glass rim shows several strands where wall layers overlap. Weak drone leads still take the find shot for 3.6 s.
- Conifers are still stylised close up. Night keeps the far west wall very dark. The floodlight casts no shadow.
- One full-page screenshot timed out (300 s) at load average about 430; stopping the render loop before each picture avoided it. An earlier fpv timeout is unexplained.
- Hook: PreToolUse:Bash "[node]" timed out once in this pass (PreToolUse:Write and Edit did in the first). It needs a longer timeout in the owner's settings.
- Screenshots: far over 20 in the first pass; 19 pictures in this one.

## For Devpost
HOUND's mission runs inside a live 3-D twin built on the real terrain of Timure, Rasuwa, drawn in the browser with no build step. When the rover listens, the walls around it turn to glass, so you can see where radio passes and where a weak signal becomes a person. The terrain is real; the buildings, the people and the damage are invented.
