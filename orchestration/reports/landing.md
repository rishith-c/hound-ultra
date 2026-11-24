# Landing page and sign-in: report

Files: index.html, login.html, landing/* , assets/img/landing/*. Nothing else was edited.

## What was built
- **Opening film** (landing/film.js). Four stills in one pinned move: valley, school block, corridor, rover. Each has a depth map, so the camera pushes in with real parallax, the cursor moves a light, rain and fog sit between the planes, and one shot dissolves into the next through fog. In the last shot wavefronts leave the rover's antenna and travel over the scene. No black frame between sections. H1 is the owner's sentence; "Is anyone alive in there?" opens the next beat. No eyebrow.
- **Live network card** in the hero. All 30 windows play once: right ones first, then wrong ones in their true share (10 of 30), each with a plain reason.
- **The rover**: CAD turntable with five steps and a real film frame.
- **The network**: 30-window picker, layer maps, Python comparison, the window drawn as 52 ridges, true numbers, and a fusion worked example computed in the page.
- **The mission, live**: the real simulator drawn by the 3-D twin full width, with a small map. The plan view plays while the twin loads and replaces it if it fails. A finding lists only sensors that raised its odds, and says when Wi-Fi said no one.
- **Tour**: every workspace in the shell's manifest that could be captured, with a real capture and its label.
- **What is real**, **Built before / built this week**, closing links.
- **login.html**: name only, kept in this browser, skippable, says so, can be forgotten.

## Labels
- Live AI: hero card, network section. Live algorithm: planner, fusion, worked example. Simulated: mission, all windows and readings. Built / real footage: rover and film frame.
- All four stills and the staging tent are captioned "Illustration"; the wave is captioned as drawn to show the idea. The turntable says "Older CAD model, not the rover as built".
- The earlier console (EvoHacks 2, handed in 22 November) is listed as existing before, including its first browser version of the network. The dates come from the old Devpost text, file dates and git.

## Verified
Headless Chrome through tools/shoot.py, screenshots opened and looked at.
- Sizes: 1680x1000, 1440x900, 1920x1080. Console errors: 0 in every landing run counted here.
- Frame rate at 1680x1000: 60 fps for 3 s at the hero, in a dissolve, in the rover scene, and with the twin running (worst frame 16.8 ms). An earlier twin run measured 54.3 fps with one 233 ms frame.
- Scripted scroll of the first 5000 px: 125 frames, mean 17.0 ms, one frame over 25 ms (67 ms).
- Layout shift over a scripted walk: 0.296 before, caused by the plan view becoming the small map; 0.0001 after the fix.
- Clicked with a real mouse: all six nav links (each lands under the bar), a picker cell, stop/start stepping, Pause, Play, Restart, 16x, 3-D/Plan, tour items. No in-page link points nowhere.
- Login: empty name message, "Asha Tamang" reaches app/ with that operator, continue-as, forget.
- Reduced motion (Chrome's own flag): stills stacked, nothing plays by itself, 0 errors. Seen before its caption and step-button wording were corrected; not re-run since.
- Computed in the page: 20 of 30 windows right, 30 of 30 match Python.

## Not verified, known gaps
- **/ultra/ not re-tested.** The tool serves / only. The links in both pages are written relative.
- Enter in the login field was not confirmed: the tool's synthetic Enter did not submit. The button does.
- Sensor wording in findings ("Wi-Fi said no one") was seen only before a person was confirmed.
- ?twin=0 and a forced twin failure were not exercised after the last change. The 4x and 8x buttons, the hero card link and the closing buttons were not clicked. Keyboard Tab order and colour-contrast modes were not checked.
- The machine's load was near 300 and some calls were refused by a hook; each refused call was retried.
- og:image is relative: some sites need an absolute address, and none is known. There is no video link because no address exists.
- Captures are a moment in time: signals, forge and copilot still showed their full layout in Demo mode. Re-run landing/capture.py after the last workspace change.
- **For the orchestrator:** the capture of System check shows 47 failed checks, with "200 random routes against an independent solver" in red, taken mid-run. Please look before the film. copilot/model-comparison.json returns 404.
- The origin of nepal-flood.webp is undocumented. It is captioned as an illustration.

## Method note
The depth maps were estimated once with Depth Anything V2 small (the model the Vision lab loads), run in headless Chrome from its public CDN. Only the four small depth pictures were saved. The page does not load the model.

## Sentences for Devpost
1. "The first AI a visitor meets is the real one: our 23,372-parameter Wi-Fi network answers held-out simulated windows on the landing page, right and wrong, and says why when it is wrong."
2. "It finds a moving person in 86.9 % of simulated windows and a still one in 21.4 %, so HOUND fuses it with radar and thermal, looks twice, and leaves the decision to a person."
3. "The mission on the page is not a video: the simulator, the planner and the fusion run in the visitor's browser."
