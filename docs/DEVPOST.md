# Devpost draft (Global AI Builder's Challenge)

Not submitted. Every number here is in docs/FACTS.md. Replace the two links at the end before use.

**Name:** HOUND Command
**Tagline (max 200):** We built a way to find people trapped behind walls and under rubble with a Wi-Fi neural network, and the console a rescue team would run it from.

---

## 1. The problem, and who has it

On 26 August 2026 the Bhote Koshi flood hit the border of Nepal and Tibet. By 15 September, Nepal's disaster authority counted
about 1,399 people dead and about 5,130 missing. In the first hours after a flood or an earthquake a rescue team asks one
question at every building: is anyone in there, and where?

A camera cannot see through a wall. A dog needs a handler and gets tired. A listening device needs the person to make a sound.
Radar that sees through walls exists and costs thousands of dollars, so a volunteer fire department or a district team usually
does not own one. People are sent in blind, or not at all.

HOUND is a small robot built from parts a school team can buy. We built it, trained its neural network, and designed and
simulated a drone to fly ahead of it. A rescuer drives it into a space that is not safe for people. It
stops, goes quiet, and listens with Wi-Fi. HOUND Command is the operating picture for the person running that search: where to
look first, what each reading means, how sure we are, and the safe way to the person.

## 2. What we built, and what existed before

**Before 21 November 2026:** the rover and its firmware, the channel simulator and the first version of the network, with its
weights, and a short film. During EvoHacks 2, which closed on 22 November, we made a one-page operator console as a concept.

**During this event:** everything in this repository. 24 workspaces in one console with two modes, Demo and Advanced; a 3-D twin
of a real valley; a deterministic mission simulator; Bayesian fusion that writes out every step; a route planner that will not
cross a hazard; the network running and training in the browser; a hand-over report that draws its own plan; fault drills; and a
system check that runs in front of you. The trained weights, the rover CAD and the rover photographs are the parts we brought in.

## 3. How AI is used

**Inside HOUND.** The main AI is ours: a 1-D convolutional network with 23,372 parameters, written from scratch in NumPy, with
every gradient derived by hand and checked against finite differences. It reads ten seconds of Wi-Fi channel state on 51
subcarriers and answers two questions: is someone there, and are they moving? We chose a small network over rules because the
change a body makes is spread across all 51 subcarriers and looks different in every room, and over a large network because it
has to run on a Raspberry Pi with nothing but NumPy.

The decision that mattered most was the training data. We had no recordings, so we made 900 people in Blender and simulated the
channel. Trained on a clean simulator, the network called **81 % of realistic empty rooms a person**. So we added the real chip's
faults: gain jumps, drift, noise, lost packets and jitter. You can train both networks in the browser and see the difference.

On 955 simulated test windows, from people the network never saw:

- a moving person behind the wall is found **86.9 %** of the time;
- still or moving is right **91.5 %** of the time;
- an empty room is called empty **88.9 %** of the time.

A person who only breathes is the hard case: a breath changes the signal by 0.05 to 0.4 %, and the chip's noise is about 0.5 %
(the full table is in section 5). That shaped the product. HOUND never
decides from one window. It moves, listens again, and fuses Wi-Fi with radar and thermal evidence. In 200 simulated
missions, with three people and two decoys in each, all 600 people were found or flagged for a team check (284 confirmed by
sensors alone), no decoy was ever confirmed as a person, and 34 team visits found no one. The radar and thermal likelihoods in
that run are assumed design values.

Other models that run in the page: an object detector and open-vocabulary labels on aerial pictures, depth from one image, and a
speech detector for calls for help. Each says where it came from and where it fails.

**Building HOUND.** Claude wrote most of the code as a set of command-line agents, one for each workspace, directed by one session. Their
briefs and reports are in the repository. Codex made the textures. We set the goal, the story, the look and the honesty rules, and
checked the results: exported numbers must match the published test matrix or the export refuses to write, every screen was
opened and looked at, and frame rate was measured.

## 4. How to try it

1. Open the link on a laptop in Chrome. Press **Open the console**, then **Watch the demo** (recommended, about five minutes).
2. Press the blue button at the bottom right to walk the story. Do not miss the last five chapters: drone eyes, inside the
   rubble, many rovers, the collapse, the horizon.
3. In **The network**, five real test windows run through the real network: a person walking, an empty room, the first one again,
   a fan, and the hard one, a person standing still. In **The search**, let a full mission play.
4. The last chapter's button opens the full instrument. **Showcase**, bottom right, brings the big scenes back. Open
   **System check** and run the drills: lost link, dropped packets, dead camera, low battery, an aftershock that blocks the
   route. HOUND stops, says what it lost, and plans again.

Expect 60 frames a second on a recent laptop. Nothing needs to be installed, and after one full visit it works offline.

## 5. Limits, and what is simulated

- On Wi-Fi alone, over the same 955 windows: a moving person is found 86.9 %, a still person who only breathes 21.4 %, an empty
  room raises a false alarm 11.1 %. That is why HOUND adds radar and heat before it confirms anyone.
- No result here comes from real people. The first trial is one person behind one drywall wall.
- The buildings, people, hazards, readings and the movement of every machine are simulated. The terrain, imagery and map of the
  valley are real. The network and its measured results are real, on simulated signals.
- The console is not connected to the rover. The drone, extra rovers, beacons, gas sensing and the deep scans are concepts, and
  each one carries a tag that says so.
- Wi-Fi amplitude cannot tell left from right, so position comes from radar. We do not show a breathing rate, because the network
  cannot measure it reliably.
- Not a medical tool, and no substitute for a trained team.

---

**Built with:** JavaScript (ES modules), three.js, WebGL, GLSL, d3, Web Workers, Web Audio, Rapier, Transformers.js, Python, NumPy, Blender, ESP32-S3, Raspberry Pi, Arduino
**Categories to tick:** AI Hardware and Robotics, AI Engineering, Design and UX, Originality, Demo, Community Impact
**Links:** live site, GitHub repository, video
