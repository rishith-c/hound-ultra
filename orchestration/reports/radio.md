# Radio twin (workspace `radio`)

Files: everything in `app/workspaces/radio/`. Nothing outside it was edited. No commit, push, deploy or download.

## What it is

**Demo.** A full-bleed building at night with the Wi-Fi wave running through it. A 2-D wave equation is solved on the GPU twice per step, with and without the person; the difference is drawn orange. The room is lit by that field. The story loops every 33 s: the probe speaks, the wave crosses the partitions, a person walks in, the 51 subcarriers along the bottom react, and HOUND's network scores the last ten seconds. The person and both radios can be dragged. A stepper opens exhibits 02 to 07, each with one line, its tags and its own motion.

**Advanced.** Seven exhibits: 01 ray-traced twin, 02 person in the channel, 03 Fresnel dither, 04 synthetic aperture, 05 sparse reconstruction, 06 reflecting surface, 07 IEEE 802.11bf. Each has two plain sentences, citations, live computation, labels, the field conditions, one unknown, and its error against simulated truth where there is one.

## Labels

- Hero: Live algorithm (the wave solver), Live AI (the network, same weights and code as elsewhere), Simulated person (tooltips give the detail).
- 01 planning tool: concept. 02 Live AI on simulated packets. 03 Live algorithm, HOUND design decision, not yet tried on a real person. 04, 05, 06 Concept + Live algorithm. 07 Concept + Live algorithm; the standard is published, its final text was not read.
- Header: hardware is concept unless an exhibit says otherwise. Nothing claims HOUND owns a wideband radar, a reflecting panel or 802.11bf.

## Verified in this session (tools/shoot.py, machine load 250 to 430)

| Check | Result |
|---|---|
| Hero frame rate, 1680x1000, Demo | 60 fps, worst frame 16.8 ms (last run) |
| Hero at 1440x900 | 60 fps, worst 16.8 ms |
| 03 in Demo, stepping by itself | 60 fps, worst 16.8 ms in the last run at 1680 (51.7, then 56 with a 50 ms worst frame, before the map was made cheaper) |
| Advanced 01 and 07 at 1440 | 60 fps, worst 16.8 ms |
| Advanced 03 at 1440 | 60 fps, worst 16.8 ms |
| Errors in the last two runs | 0 |
| Drag | person, moved 0.6 m; probe radio, moved 1.5 m; the caption then says the network was never trained on this layout |
| Story restart | seen on screen (score falls back, clock restarts) |
| Demo screens looked at | 01 to 07, at 1680 and 1440 in part |
| Advanced screens looked at | 01 to 07 at 1440; 01 and 07 again at 1680 |

Numbers shown on screen: SAR peak error 0.0 cm on reflector A, blur 3.8 cm against the rule 3.6 cm at 6 m aperture; sparse L1 error 0.07 with 0 false peaks against back-projection 2.64 with 188 (256 of 1,280 samples); RIS +28.7 dB over a plain mirror, spot 16.3 cm against 16.5 cm; 802.11bf echo found at +2.94 m against +3.4 m; Fresnel 17.5 / 30.9 / 32.7 % against the project's Python 16.5 / 32.5 / 35.0 %.

Network in the hero: about 0.35 to 0.50 with nobody, 0.76 and up to 1.00 once the person has walked in (threshold 0.53). A demonstration on packets made in the page, not an evaluation, and one run of one story.

## Fixed this session

- `twin.js` had a line break inside a quoted shader string, so Advanced 01 did not start at all. It was in the committed file. Fixed and seen running.
- A failed exhibit stayed visible behind the others. Not re-tested, because nothing fails now.
- The twin's rover model put black pixels in the hero. Replaced by a small rover drawn here. Earlier diagnosis (bad values from that model spread by bloom) was a single diagnostic run; the exact cause inside the model is not known.
- The transmitter's white core in Advanced 01, label collisions in 02, 03 and 07.

## Not done or not known

- The wave solver's wall loss has **not** been compared with the slab formula (concrete 14.76 dB, drywall 2.60 dB). The hero caption quotes the slab formula, not the solver. `field.probe` exists for the comparison.
- It is 2-D, on a plan, with assumed wall thicknesses and an assumed body (relative permittivity 50, conductivity 1.7). It is a picture of how radio moves, not a prediction.
- The 20-window tallies of exhibit 02 were not run. The first two seconds of its shown window sit off the rest; a gain step meeting int8 rounding is the likely cause, not confirmed.
- Reduced motion, keyboard (arrows, Space, R) and `--strict` were not exercised this session. The hero's receiver drag was not tried. Load time on a quiet machine is not measured; under load the detailed building replaced the plain one after 15 s.
- The code of 04 to 07 was written by two subagents that ran out; I looked at it on screen and fixed layout, but did not read it all.
- `#/radio?exhibit=sar` opened 01 in one Demo run, so that deep link may not work. The stepper does.
- Some Advanced controls sit below the placard, so the sidebar must be scrolled.
- The 4427 server from the earlier session was stopped and is not needed.

## For Devpost

HOUND's Radio twin solves the wave equation for a Wi-Fi signal in the browser and shows it passing through a simulated building, bending at door frames and changing when a person walks in. Seven exhibits, from a ray-traced building to a synthetic aperture and a reflecting panel, compute their results live and show their errors against a simulated truth. Every one is labelled, and the ones that need hardware HOUND does not have say so.
