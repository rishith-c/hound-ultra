# Radio twin (workspace `radio`)

Files: everything in `app/workspaces/radio/`. Nothing outside it was edited. No commit, push, deploy or download of a third-party file. (Three.js comes from the console's CDN: with no internet the live picture cannot start. That happened once during this pass.)

## What it is

**Demo (chapter 02, "The idea").** A long lens looks along the partition between classrooms 111 and 112. A 2-D wave equation is solved on the GPU twice per step, with and without the person; the wave is drawn blue on the floor and on the wall, and the difference is drawn as orange rings. Headline: "Wi-Fi passes through walls. A living body changes it." One line changes with the beat. The story loops every 33 s. The person and both radios can be dragged.

**Advanced.** Seven exhibits: 01 ray-traced twin, 02 person in the channel, 03 Fresnel dither, 04 synthetic aperture, 05 sparse reconstruction, 06 reflecting surface, 07 IEEE 802.11bf. Unchanged in this pass.

## Second pass: the six points

1. **Words.** Done. Left 40 px, bottom edge 60 px above the dock, tags above the headline. "The network hears the change." is only shown while the network's score is above its threshold.
2. **Frame.** New camera (about 23 degrees, 20 degree lens, slow push). Person's box in every reading taken (1440, 1680, 1920): 0.589 to 0.731 of the width in the final framing's runs, so more than 25 % from the right edge; head at 0.063 of the stage height or lower. The closest vertical margin is the first step of the story, about 6 %, so the 8 % rule holds sideways but not at the top at that moment. The rover is true to its plan size, about 90 px wide at 1440. A warm lamp lights the radios; the blue wave tints it, so it reads only faintly warm.
3. **Instrument.** 51 bars. Height = strength of each subcarrier in the simulated channel; the change is drawn 100 times larger and receiver noise is left out, both said on screen. With noise included the change was not visible at this scale: a typical change here is 0.3 to 0.8 %, and the simulated ESP32 rounding alone is larger. The network still gets the noisy packets. The bars move smoothly together because the echo is only a few metres longer than the direct path; they buckle gently, not chaotically.
4. **Wave and materials.** One fixed brightness law for amplitude, so loss is visible. Solver peak amplitude read back: 0.31 at 0.5 m in room 111, 0.165 at 0.6 m beyond the probe through the partition, 0.075 at 3.8 m. Set is new (`stage.js`): tiled dusty floor, wood-grain desks with metal legs, rubble, bricks, paper. The person is one smooth ray-marched body.
5. **Exhibit numbers.** Slim stepper at the bottom right under the instrument.
6. **Opening.** The twin's heavy builders are no longer used in the hero. The set, solver grid and shaders are built in slices, and the page waits for the graphics chip between first draws. A poster of the opening frame (`poster.webp`, 95 KB, captured from this scene) is behind the canvas from the start. Measured in the last timed run (1440, load falling from about 250 to 77): live picture 1.47 s after navigation (0.93 s after the hero starts), no long task from the hero; one 158 ms task at 0.1 s, before the hero starts. Earlier in this pass, at higher load, the live picture took 2.0 to 4.8 s and single tasks reached 426 ms, before the last change.

The partition is drawn whole. The plan calls it "damaged", and the solver treats it as whole. It is drawn 2.2 m high and cut, for the camera.

## Labels

- Hero: Live algorithm (the wave solver), Live AI (the network, same weights and code as elsewhere), Simulated person (tooltips give the detail).
- 01 planning tool: concept. 02 Live AI on simulated packets. 03 Live algorithm, HOUND design decision, not yet tried on a real person. 04, 05, 06 Concept + Live algorithm. 07 Concept + Live algorithm; the standard is published, its final text was not read.
- Header: hardware is concept unless an exhibit says otherwise. Nothing claims HOUND owns a wideband radar, a reflecting panel or 802.11bf.

## Verified

| Check | Result |
|---|---|
| Hero 60 fps (3 s), Demo | 1680: 60, worst 16.8 ms. 1440: 60, worst 16.8 ms |
| Opening at 1440, last timed run | live picture 1.47 s, hero long tasks over 50 ms: none |
| Errors in the last runs | 0 (Demo, Advanced 01, exhibits 02 and 05 in Demo) |
| Looked at this pass | Demo hero at 1440, 1680, 1920; Demo 02 and 05; Advanced 01 at 1440 |
| First pass (not repeated) | Advanced 01 to 07 at 1440; frame rates of 03 and 07; drag of person and probe |
| Drag this pass | one radio moved: the line changes to "Radios moved: the network was never trained on this layout." The eval printed the receiver unchanged, so the probe or neither was moved; the receiver drag is still not confirmed |
| Network, one story run | 0.19 to 0.49 with nobody, 0.57 to 1.00 with the person (threshold 0.53). A demonstration on packets made in the page, not an evaluation |

Numbers shown on screen: SAR peak error 0.0 cm on reflector A, blur 3.8 cm against the rule 3.6 cm at 6 m aperture; sparse L1 error 0.07 with 0 false peaks against back-projection 2.64 with 188 (256 of 1,280 samples); RIS +28.7 dB over a plain mirror, spot 16.3 cm against 16.5 cm; 802.11bf echo found at +2.94 m against +3.4 m; Fresnel 17.5 / 30.9 / 32.7 % against the project's Python 16.5 / 32.5 / 35.0 %.

## Fixed in the first pass

- `twin.js` had a line break inside a quoted shader string, so Advanced 01 did not start at all. It was in the committed file and came from my own earlier edit. Fixed and seen running.
- A failed exhibit stayed visible behind the others. Not re-tested, because nothing fails now.
- The twin's rover model put black pixels in the hero. Replaced by a small rover drawn here; the exact cause inside the model is not known.
- The transmitter's white core in Advanced 01, label collisions in 02, 03 and 07.

## Not done or not known

- The wave solver's wall loss has **not** been compared with the slab formula (concrete 14.76 dB, drywall 2.60 dB). `field.probe` exists for the comparison.
- It is 2-D, on a plan, with assumed wall thicknesses and an assumed body (relative permittivity 50, conductivity 1.7). It is a picture of how radio moves, not a prediction.
- The 20-window tallies of exhibit 02 were not run. The first two seconds of its shown window sit off the rest; a gain step meeting int8 rounding is the likely cause, not confirmed.
- Reduced motion, keyboard (arrows, Space, R) and `--strict` were not exercised this session. The hero's receiver drag was not tried. Load time on a quiet machine is not measured; the last timed run was on a machine under moderate load.
- The code of 04 to 07 was written by two subagents that ran out; I looked at it on screen and fixed layout, but did not read it all.
- `#/radio?exhibit=sar` opened 01 in one Demo run, so that deep link may not work. The stepper does.
- Some Advanced controls sit below the placard, so the sidebar must be scrolled.
- Not re-screenshotted after the first pass: exhibits 03, 04, 06 and 07 in Demo with the new stepper position, and Advanced 02 to 07.
- A faint seam can show at the person's elbow or leg in some frames. Not removed completely.
- In exhibit 07 at 1680 the AP "measures CSI" label ran over Station 1's frame in the first pass. Not changed.
- The poster is a still of one run; its blue light is a little stronger than the first live frame.
- The 4427 server from the earlier session was stopped and is not needed.

## For Devpost

HOUND's Radio twin solves the wave equation for a Wi-Fi signal in the browser and shows it passing through a simulated building, passing through a wall and changing when a person walks in. Seven exhibits, from a ray-traced building to a synthetic aperture and a reflecting panel, compute their results live and show their errors against a simulated truth. Every one is labelled, and the ones that need hardware HOUND does not have say so.
