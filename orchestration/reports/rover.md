# 28-rover: report

## What was built
Chapter 04, "The rover" (`app/workspaces/rover/`, `assets/models/rover_parts.py` and `.bin`).

**Demo.** One 15.5 s move, no cuts: light slides along the closed rover, it comes apart along its axes, five leader lines draw
themselves, a warm pulse goes from the Wi-Fi radio to the computer, it closes, the camera arrives at the photograph's viewpoint,
and a vertical wipe opens the photograph. It holds there: "This one is real." Drag or use the arrow keys (Home, End) to move the
wipe; drag before that to orbit; scroll to scrub; "Take it apart again" replays.

**Advanced.** Parts (click a part or a row), Section, X-ray, Signal, Power, Drive, Safety stop, and "As built" / "CAD design".

## How it is made
- `rover_parts.py` (standard library) bakes the 10.9 MB GLB to 294 kB: all 241 parts kept as nodes, 54 unique meshes.
- The photograph's camera was solved by least squares from four wheel centres and five frame corners picked by hand in the
  photo. All residuals are under 3 px. The solve used the 390 mm frame width for scale and left track and wheelbase free;
  it returned a 480 mm track (the CAD also says 480) and a 321 mm wheelbase (the CAD and the firmware say 250).
- Studio: code-made PMREM, planar reflection at half resolution with roughness and wet patches, sliding strip light, adaptive
  pixel ratio. One WebGL context, stopped in onHide.

## What is CAD and what is not
- From the CAD meshes: wheel plates, cores, supports, axles, roller profile and roller positions, hubs. The wheels are scaled
  from the CAD's 100 mm to the built 80 mm, and the roller treads are ours.
- Modelled in code: rails (2020 profile), motors, brackets, corner brackets, every circuit board, battery, power banks, webcam,
  foam deck, foam mast, cables. Sizes come from assembly.json, part outlines and the photograph.
- Positions follow the photograph where it shows the part. The Pi, the Wi-Fi radio and its bank are hidden in the photograph, so
  their exact positions on the deck are a guess. The thermal camera is placed above the webcam (assembly.json); the photograph
  does not show it clearly. The wiring is simplified.
- Not drawn: the two LD2410C radars, the rear distance sensor, the pan/tilt turret, microphone, fan. None can be seen in the photo.
- The CAD file is titled CONCEPT and is older: UNO R3, A4988 and TB6600 envelopes, a sweeping mast. It is shown whole, unchanged,
  under "CAD design".

## Labels
Workspace: Built. Drive and Safety stop: Live algorithm (firmware maths running in the page). No Live AI here.

## Departures from the brief
- **The pulse does not follow a cable.** wiring.json says the radio talks to the Pi by Wi-Fi (UDP 5005) and its only cable is its
  own power bank. Drawing a data cable would be false, so the pulse crosses the air.
- Demo shows the as-built mast (foam, tape), not the CAD's sweeping bridge, so that the silhouette matches the photograph.
- FACTS says 52 values; Advanced words it as 52 by 200 (51 subcarriers and one motion row), as the design study does.
- The brief gave the GLB as 22 MB; the file on disk is 10.9 MB.

## Verified (tools/shoot.py)
- 0 console errors in every run. 60 fps measured in Demo (opening, photo hold) and Advanced (Signal, Drive) at 1680x1000, and in
  Demo's photo hold at 1440x900. Adaptive ratio was 1.25 when read. This was a headless browser on one busy Mac.
- Looked at 1680x1000 and 1440x900 in both modes. Autoplay reaches the end; wipe by arrow keys and by drag; orbit; wheel scrub;
  replay button; story frozen while hidden and running again on return; reduced motion shows the open still, then the photo.
- Drag and wheel were dispatched as synthetic events, not with a real mouse. Single arrow presses were real key presses.

## Known gaps
- fps was not measured during the exploded hold or in Section, X-ray and Power.
- First frame was seen as ready within about 1 s of the page settling; it was not timed against the 1.5 s target.
- High contrast, the colour-blind palette and the no-WebGL fallback were not looked at. Section cuts are not capped.
- The photograph is 1060 px wide, so it is soft when it fills 1680 px. It is not retouched; a dark scrim sits under the headline.
- 80 mm wheels look slightly smaller than in the photograph (about 76 px against a hand-read 87 px). Not resolved.

## For the write-up
"The last shot of the chapter is a photograph. We solved its camera from nine points on the real machine, so our model lands on the
real rover. The drive page runs the same wheel mixing, ramp and 400 ms stop as the Arduino."
