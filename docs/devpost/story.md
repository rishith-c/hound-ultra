**Watch:** [the film](https://youtu.be/CD6toHreojU) · **Try it:** [hound-command.vercel.app](https://hound-command.vercel.app) · **Code:** [github.com/rishith-c/hound-ultra](https://github.com/rishith-c/hound-ultra)

## Finding people trapped behind rubble, with Wi-Fi and a neural network.

After a flood or an earthquake, every collapsed building asks the same question: **is anyone alive in there, and where?** Cameras need a gap. Dogs tire. Listening devices only work if the person can make a sound.

A human body changes how Wi-Fi passes through a wall, on every subcarrier at once. **We built a neural network from scratch that reads that change** and answers "person, moving" from ten seconds of signal. Around it we built a whole rescue system: a rover that listens at the wall, a drone designed to map from above and set down on the far side as the Wi-Fi source, and **HOUND Command**, the console the rescue team runs it from. Then HOUND tells the team **which room to open first**.

*Results are measured in simulation, over the real terrain of Timure, Nepal. The drone is a design, flown in the simulator.*

## 1. Who is your project for, and why would they use it?

**V1, the need.** On 26 August 2026 the Bhote Koshi flood hit the Nepal–Tibet border. By late September, Nepal's disaster authority (NDRRMA) counted **more than 1,400 dead and more than 5,000 missing**, many of them under mud, rock and buildings. HOUND is for the leader of a small rescue team, such as a district team or a volunteer fire brigade, standing at a building nobody can see into.

**V1, a use example.** A team reaches a house with five rooms and the roof gone. The drone maps it from above. The rover drives to the first wall and listens for ten seconds while the drone sends Wi-Fi through the room from the far side. Radar and heat add their readings. HOUND Command shows one chance for each room, the evidence behind it and a safe way in. The team opens the most likely room first, and a person approves every route. (Video 0:50 to 3:14.)

**V2, the comparison.**

| Tool | Through a wall? | Cost | Source |
|---|---|---|---|
| Camera or fibrescope | No, it needs a gap | Low | |
| Search dog | Scent only | 6 months to 2 years to certify | [FireRescue1](https://www.firerescue1.com/fema/inside-the-world-of-fema-usar-canines), [FEMA](https://webarchive.library.unt.edu/web/20161122181913/https://www.fema.gov/canine-handler-certification) |
| Acoustic listening device (Delsar LD3) | Only if the person makes a sound | $42,978.83 | [Safeware](https://www.safewarecontracts.com/itemdetail/SAV%206020-01-016) |
| Through-wall radar (Range-R) | Yes, up to about 15 m | About $6,000 | [Wikipedia](https://en.wikipedia.org/wiki/Range-R), [IPVM](https://ipvm.com/forums/video-surveillance/topics/radar-r-new-technology-allows-surveillance-thru-walls/posts/68829) |
| **HOUND** | **Yes: Wi-Fi, radar and heat, and it ranks the rooms** | **Rover parts: $261.37** | our parts list |

**V2, the benefit.** HOUND hears a moving person through a wall without that person making a sound, for the cost of a school robot, and it tells the team where to start. In 20 searches of a simulated five-room building with two hidden people, the team opened **2.0 rooms** before everyone was found, against **4.0** in a random order. That is half the digging.

**V3, can a team really use it?** The console runs in Chrome on any laptop. There is nothing to install and no account, and it works offline after one visit. The rover is built from a public parts list on stock boards (Arduino UNO R4 WiFi, ESP32-S3, Raspberry Pi), and the Wi-Fi receiver is a $10-class ESP32. Next comes the first live test, with one person behind one drywall wall, and then the drone build (flying it needs the local aviation authority's permission).

## 2. What did your team build or improve during the hackathon?

The event opened on 21 November 2026. **This repository starts on 23 November, and every commit in it is dated during the event.** In seven days we built:

- **HOUND Command:** 24 workspaces in Demo and Advanced modes. It has a 3-D twin of the real valley at Timure, a mission simulator, Bayesian fusion that writes out every step, a route planner that never crosses a hazard, and the network running and training live in the browser. It also has word search over drone pictures, a hand-over report that writes itself, and fault drills.
- **The rover and drone code, from scratch:** motor firmware, the ESP32 Wi-Fi listener and probe, and the Pi search stack (radar, heat, network, fusion, planner, safety, mission), plus the drone's flight firmware and companion code. All four firmware builds compile.
- **A practice building**, where the real rover and drone code runs in a simulated world: **99 cases, 99 met**.
- **A head-to-head test** of our network against simpler methods.
- **The film.**

Made before the event: the network's first trained weights (15 November), the Wi-Fi channel simulator, the rover hardware and its first firmware, the CAD and photos, and a one-page console concept from EvoHacks 2. The libraries and map data we used are credited in the README.

## 3. How did your team use AI?

**The core: a Wi-Fi neural network written from scratch.** It is a 1-D convolutional network with 23,372 parameters, written in NumPy, with every gradient derived by hand and checked against finite differences. It reads ten seconds of Wi-Fi channel readings on 51 subcarriers and answers two questions: **is someone there, and are they moving?** It takes **0.22 ms** per window and runs on a Raspberry Pi or in the browser, with the same weights.

**A1, why this AI.** A body changes all 51 subcarriers at once, in a pattern that is different in every room, and a rule on one number misses it. All methods were tested on the same 955 held-out windows, each set to the same false-alarm rate:

| Method | Moving person found | Score (AUC) |
|---|---|---|
| **HOUND network** | **86.9 %** | **0.941** |
| Logistic regression on 306 hand-made features | 66.4 % | 0.86 |
| Best hand-written rule | 44.9 % | 0.754 |

**A2, the decision that made it work.** No dataset of people behind walls exists, so we made one. We built **900 people in Blender** (1.20 to 1.95 m tall, standing and lying, breathing and walking) and simulated the Wi-Fi channel around each of them. A network trained on a clean simulator mistook 81 % of realistic empty rooms for a person. So we trained it on the real chip's faults (gain jumps, drift, noise, lost packets and jitter), and the false alarms fell to **11.1 %**. You can train both versions in the console and watch the difference.

**A3, how we checked it.** We tested it on 955 windows from people it never saw in training (simulated signals):

- it finds a moving person **86.9 %** of the time;
- it calls an empty room empty **88.9 %** of the time;
- it tells still from moving correctly **91.5 %** of the time.

A person lying perfectly still barely changes the Wi-Fi. So HOUND never trusts one sensor: it adds a breathing radar and heat, listens from more than one wall, and never clears a room it could not cover.

**Five more AI models, all running in the browser.**

- D-FINE finds people in drone pictures.
- MobileCLIP-S0 searches those pictures by words ("a red jacket").
- Depth Anything V2 turns one photo into 3-D ground.
- SlimSAM outlines a slab in one click.
- Whisper listens for calls for help.

A copilot turns plain words into one of 19 console actions, and an on-device language model (WebLLM) can be loaded on request. **Nothing leaves the laptop.**

**Shrunk to fit a microcontroller.** Quantised to int8, the network fits in **23,716 bytes** instead of 93,488 and still finds 88.3 % of moving people. It matches bit for bit in the browser.

**AI during development.** Claude Code wrote most of the code, working from written briefs. docs/FACTS.md lists the only claims it was allowed to make, and a script refuses to publish numbers that do not match the test results. Codex made the textures.

**A4, a person checked it.** On 25 November, Rishith ran the word search in his own browser, and it failed because the model runtime did not download. The cause was the AI-written service worker, which passed the model download through itself. We kept the search code, limited the service worker to our own files and added a second source for the runtime. We checked again in the same browser: "a red jacket" found its best match at 0.94, with 331 tiles searched in 5.5 s (commit 6c1c03c).

## 4. How can people access and use the project, and what results does it achieve?

**Access.** Open [hound-command.vercel.app](https://hound-command.vercel.app) in Chrome, press **Open the console**, then **Watch the demo** (about five minutes). It needs no install, no account and no payment. For the robot code, `python3 robot/sim/cases.py` reruns every case.

**The main task:** start from a building nobody can see into and end with a ranked list of rooms and a safe route to each person. **A good result** confirms or flags every hidden person, never clears a room with someone in it, never calls an empty room a person and never touches a wall.

**R1, the whole process.** The console's demo runs the whole search, from the first drone map to the hand-over report (video 2:40 to 3:14). In the practice building, the real rover and drone code does the same, from take-off to report.

**R2, results across cases** (practice building, docs/ROBOT_RESULTS.md):

| Case | Result |
|---|---|
| A person walking behind the wall (console, video 2:17) | "Person, moving" |
| An empty room, and a desk fan with no one there | Stays quiet, and is not fooled |
| Search 1: two people, a fan and a hot pipe, 20 runs | 39 of 40 confirmed, 1 flagged, 0 wrongly cleared, 0 false, 0 wall touches |
| Search 2: the people, fan and pipe moved, 20 runs | 40 of 40 confirmed |
| Hard: three people (one standing still), two fans, 5 m/s gusts and 10 % damaged packets, 20 runs | 42 of 60 confirmed, 18 flagged for the team, **0 wrongly cleared, 0 false** |
| 200 full missions, each with three people and two decoys | **600 of 600 people found or flagged, 0 decoys confirmed** |

**A smarter search.** HOUND's Bayesian search updates a live probability map after every empty look. The mean time to find a hidden person is **8:49 against 14:04** for a fixed route, and **84 % are found within 20 minutes, against 36 %**. When eight simulated robots share one search, coordination covers the site **30 to 47 % faster**.

**Design choices that cut effort (D1 to D4).**

- **D1:** every screen leads with one chance per room and the reason for it. The details sit one level down, in Advanced.
- **D2:** one list puts the most likely room first, so nobody compares raw signals.
- **D3:** the hand-over report writes itself from the mission, with the positions, the chances, the readings behind each chance and the route ([live](https://hound-command.vercel.app/app/#/report)).
- **D4:** the odds rise reading by reading, next to the reading that moved them (video 2:33 to 3:09).

## 5. What are the current limitations, and what happens when something goes wrong?

**Where it stands.** Every result here was measured in simulation, over the real terrain of Timure. The drone is a design flown in the simulator. The swarm, deep scan and horizon workspaces are concepts, and each carries a tag in the console. Next comes the first live wall test with the rover. HOUND supports a trained team; it does not replace one.

**R3, built to fail safe** (each case run 3 times, all met):

| What goes wrong | What HOUND does |
|---|---|
| The cable to the motor board is cut while driving | The board's own watchdog stops the wheels in **0.64 s, within 0.13 m**. The search resumes when the cable is back |
| The operator's link drops | It holds 1.3 s after the last command, keeps the finished rooms and resumes when the link is back |
| The Wi-Fi goes silent | It reports "no probe heard". Blind is never counted as empty |
| 30 % of the radio packets are garbage | About 2,900 broken packets are thrown out, with no false person |
| The drone's map arrives damaged | The map is refused and a new one is requested |
| The drone loses its position | It comes down level, at 0.22 to 0.57 m/s |
| The drone's battery fails halfway | It flies home and keeps every reading |

## 6. Under the hood

**The signal chain.** One ESP32-S3 sends 100 Wi-Fi probes a second. A second ESP32-S3 on the rover records how each probe arrives on 51 subcarriers (channel state information, or CSI). The Raspberry Pi runs the network on 10-second windows.

**The network.** It has three 9-tap convolution layers (52 → 24 → 24 → 24 channels, with pooling), mean and max over time, a 32-unit dense layer and two output heads (person; still or moving), with 23,372 parameters in all. We used NumPy instead of PyTorch because the Pi already has NumPy and PyTorch is a 700 MB install. The browser copy matches the Python output to within 0.00001 on every bundled test window.

**The rover.** It has an aluminium extrusion frame, four NEMA 17 steppers on 80 mm mecanum wheels, an Arduino UNO R4 with DRV8825 drivers, a Raspberry Pi 4 and a 3S LiPo. The sensors are:

- an HLK-LD2450 24 GHz radar for position and speed;
- two HLK-LD2410C radars for breathing;
- an MLX90640 thermal camera;
- a webcam;
- two VL53L1X distance sensors.

**Fusion and planning.** Each reading updates its room's odds by Bayes' rule, and every step is shown. The A* routes never cross a hazard. The mission simulator is deterministic, so you can replay any mission from its log, fork it at any moment, change one decision and compare the two outcomes.

**The console.** It uses plain ES modules, with no framework and no bundler. three.js and WebGL draw the 3-D twin of the real valley, and Web Workers run the heavy maths. Rapier simulates the rubble pile, so a lift can be tested before anyone touches a slab. A radio twin solves the wave equation for Wi-Fi through a building, live. The browser runs 33 self-tests and about 2,000 checks.

## 7. HOUND Command

The console has 24 workspaces in five groups:

- **Operate:** Valley, Mission, Rover, Triage, Swarm (concept)
- **Sense:** Wi-Fi AI, Fusion, Drone imagery, 3-D scan, Signals
- **Frontier:** Radio twin, Deep scan (concept), Vision lab, Search strategy, Timelines, Model forge, Structure, Horizon (concept)
- **Understand:** Evidence, Report, Live quakes, Training
- **System:** Copilot, System check

**Valley:** the real valley in 3-D, with the terrain, the satellite imagery, the flood and the search.

![Valley](https://hound-command.vercel.app/assets/img/landing/ws-area.jpg)

**Wi-Fi AI:** the network that senses people through walls, running live.

![Wi-Fi AI](https://hound-command.vercel.app/assets/img/landing/ws-sense.jpg)

**Fusion:** Wi-Fi, radar and heat combine into one confident answer.

![Fusion](https://hound-command.vercel.app/assets/img/landing/ws-fusion.jpg)

**Mission:** the whole search in the 3-D twin, from the drone survey to the rescue.

![Mission](https://hound-command.vercel.app/assets/img/landing/ws-mission.jpg)

**Vision lab:** search a photo by words and turn one photo into 3-D, with real models running in the page.

![Vision lab](https://hound-command.vercel.app/assets/img/landing/ws-vision.jpg)

**Model forge:** train the network in your browser and shrink it for a microcontroller.

![Model forge](https://hound-command.vercel.app/assets/img/landing/ws-forge.jpg)
