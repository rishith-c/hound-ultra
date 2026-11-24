# twin-actors report

Everything here is **simulated**. The drone and the gas sensor are **concept**. The rover drive base is the team's own CAD; its electronics are modelled at the CAD positions. No figure, wave or point is a measurement.

## Built (app/twin/actors/)
- **sensing.js**: crests cross the floor, lose strength through each wall, scatter off detections already made, and return to the rover as 9 subcarrier threads. twin-core turns the wall to glass.
- **people.js**: a hairline error ellipse and a flickering volume while uncertain; a section-scanned warm body, a 100-mark probability scale and one pulse when confirmed. Uses detections only. `TRUTH` is read only by the "truth" layer. Posture comes from the rover's Wi-Fi readings.
- **rover.js** + `assets/models/hound01.bin` (0.99 MB, baked by `assets/models/bake_hound01.py`): CAD drive base, 32 rollers, mecanum kinematics, cables, antennas, headlights, spray.
- **drone.js, scan.js, coverage.js, markers.js**: rebuilt (sub-agent), then lit and toned by me.
- **hazards.js, routes.js, team.js**: rebuilt (sub-agent).

## Display conventions
Rover drawn 1.5x. Wavelength drawn 4x and slow. Body shape, yaw and pose are a symbol, not an image: the sensors give a position and a probability. Lying unless a Wi-Fi window shows movement.

## Verified by me on screen or by script
- Lock sequence of D4 58 % to 95 % at 472.2 s, then the pulse, then settled (test page, demo, 1680x1000).
- D5 at 74 %, standing volume. Clicking it selects detection D5.
- Team kneeling on the mound with the third person, figure at mound height.
- Wheels: over 1.05 m driven, 13.2 rad turned at a drawn radius of 0.075 m gives 0.99 m, 6 % short. The spin limit caused most of it and was raised from 15 to 22 rad/s; **not re-measured**.
- Low quality + reduced motion at 1440x900, new hazard, seek, reset, every layer toggled twice, dispose: 0 errors; 0 canvases left. One run, palette preference set in the same run.
- Mission workspace, advanced, `--strict`, 1680x1000: 0 errors, seek 47 to 520 gives a correct frame.

## Frame rate (`--do fps`, machine load average 250 to 550 from other agents)
| View | fps | slowest 5 % |
|---|---|---|
| Lock close-up, demo | 60 | 16.7 ms |
| Overview, demo | 60 | 16.7 ms |
| Team indoors, demo | 60 | 16.7 ms |
| Scan, demo | 60 | 16.8 ms |
| Listening, low + reduced, 1440x900 | 60 | 16.8 ms |
| Mission advanced at about 535 s, 8x | 59.3 | 16.8 ms, worst 33.4 |
| Mission advanced at about 427 s, 8x | 60 | 16.7 ms |
| Rover outdoors, demo | 59.5 | 16.7 ms, worst 33.4 |

Most are short views on a paused mission. Earlier runs this session measured 33 to 56 fps at high load. Pixel ratio is adaptive, so 60 fps can come with a lower internal resolution; I did not record the ratio with these numbers. Helper-measured update cost, per call: hazards 0.010, routes 0.025, team 0.122 ms; scan, drone, coverage and markers 0.004 ms or less (paused). Rover, people and sensing were not measured on their own.

## Not verified
- **Mission demo in the app**: one picture (drone survey, 00:51, 1440x900) is good. Two `--strict` runs then failed with a browser screenshot timeout under heavy load, so strict in demo and the demo listening and lock views in the app are **not passed**.
- The black frame after a long seek: cause not isolated. Clamps were added (beam, normals, output), and the rover spotlight no longer toggles, which recompiled every lit shader. It did not recur in one replay.
- Spray, antenna flex, body bob and suspension in motion; thread landing flash; live toggle of reduced motion; colour-blind palette by eye; gait at 8x; hammer swing; coverage wave; `harness.html` (not re-run).
- After the last edits (posture, mound height, scan colours, wheel limit): two launches, one clean and one stopped by my own click syntax.

## Known weak points
Rescuers go dark when backlit. The ring of a person on a slope is flat, so one edge floats. Wave rings are still round. The rover shows aliasing in close reflections. Gas has no refraction. Hazards are faint from overview in demo.

## For Devpost
HOUND's Wi-Fi network is trained and tested on simulated signals from people behind a wall; a still person is the hard case. In the console you see the wave leave the rover, cross the wall, meet something that moves the signal, and come back; the figure stays a cloud until independent sensors agree. The mission shown is a simulated training exercise, and the console labels what is live AI and what is simulated.
