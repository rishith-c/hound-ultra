**Watch the demo:** [youtu.be/CD6toHreojU](https://youtu.be/CD6toHreojU) · **Live console:** [hound-command.vercel.app](https://hound-command.vercel.app) · **Code:** [github.com/rishith-c/hound-ultra](https://github.com/rishith-c/hound-ultra)

Every result below is labelled. The buildings, people and readings are simulated; the valley terrain is real; the drone is a design. Details in the last section.

## 1. Who is your project for, and why would they use it?

**The people:** the leader of a small rescue team (a district team, a volunteer fire brigade) at a building that has collapsed or filled with mud. They have to decide which room to open first, and they can't see inside.

**V1, the need.** On 26 August 2026 the Bhote Koshi flood hit the Nepal–Tibet border. By late September, Nepal's disaster authority (NDRRMA) counted more than 1,400 dead and more than 5,000 missing ([OnlineKhabar](https://english.onlinekhabar.com/bhotekoshi-relief-remains-stalled.html), [Himalayan Times, 4 Sept: 1,290 dead, 4,798 missing](https://thehimalayantimes.com/nepal/bhotekoshi-flood-1290-dead-8197-rescued-4800-missing-so-far), [ADRC report](https://www.adrc.asia/publications/disaster_report/pdf/2026/ADRC_FL_NPL_Rasuwa_20260826_EN.pdf)). Many of the missing were under mud, rock and buildings. At every building, the first question is: is anyone in there, and where?

**V1, a use example.** A team reaches a house with five rooms and the roof gone. The drone flies first and maps it from above. The rover drives to the wall of the first room and stops. The drone lands on the far side of the room and sends Wi-Fi through it, and the rover listens for ten seconds. Radar and heat add their readings. HOUND Command shows one chance for each room, every reading behind it, and the safe way in. The team opens the most likely room first, and a person approves every route. (Video 0:50 to 3:14.)

**V2, the comparison.** What a team can use today, for the same question:

| Tool | Through a wall? | What it needs | Cost or effort | Source |
|---|---|---|---|---|
| Camera or fibrescope | No: it needs a gap | A hole or a gap | Low | how they work |
| Search dog | Smell only, not through closed rubble | A handler; the dog tires | 6 months to 2 years to certify, and again every 3 years | [FireRescue1](https://www.firerescue1.com/fema/inside-the-world-of-fema-usar-canines), [FEMA](https://webarchive.library.unt.edu/web/20161122181913/https://www.fema.gov/canine-handler-certification) |
| Seismic and acoustic listening device | Yes | The person has to make a sound or a tap | Delsar LD3 kit: $42,978.83 list price | [Safeware](https://www.safewarecontracts.com/itemdetail/SAV%206020-01-016) |
| Handheld through-wall radar (Range-R) | Yes, up to about 15 m | Sold to police, military and rescue services | Reported at about $6,000 | [Wikipedia](https://en.wikipedia.org/wiki/Range-R), [IPVM forum](https://ipvm.com/forums/video-surveillance/topics/radar-r-new-technology-allows-surveillance-thru-walls/posts/68829) |
| **HOUND** | Yes: Wi-Fi, plus radar and heat | A laptop with Chrome; the rover; the drone (a design) | Rover parts bought: $261.37, plus a Pi, motors, radars and ESP32 boards we already had | our parts list |

**V2, the benefit.** HOUND hears a moving person through a wall without the person making a sound, for the cost of a school robot. It also tells the team where to start. In 20 simulated searches of a five-room building with two hidden people, the team opened **2.0 rooms before everyone was found, against 4.0 in a random order**. In the hard case (three people, one standing still, strong wind, damaged radio packets), it was 3.65 against 4.5. This is simulation only (docs/ROBOT_RESULTS.md).

**V3, can a team really use it?** The console runs in Chrome on a laptop, with nothing to install and no account, and works offline after one visit. The rover is built from a public parts list, and its code compiles for the stock boards (Arduino Uno R4 WiFi, ESP32-S3, Raspberry Pi). The Wi-Fi receiver is a $10 class ESP32 board. Two things still stand in the way, and here is how they get met. First, the rover and the console have not been connected yet, and the rover's new code has not run on the rover. The next step is one person behind one drywall wall. Second, the drone is a design. Until it is built, the first trial places the Wi-Fi probe on the far side by hand. Flying a drone needs the local aviation authority's permission.

## 2. What did your team build or improve during the hackathon?

The event opened on 21 November 2026 at 12:00 am PST. **Most of HOUND was written after that.** This repository starts on 23 November, and every commit in it is dated during the event.

**Written during this event (21 to 28 November), all in this repository:**

- **HOUND Command**, the console (video 0:37 onward): 24 workspaces in two modes, Demo and Advanced. It has a 3-D twin of the real valley at Timure, a mission simulator, Bayesian fusion that writes out every step, a route planner that won't cross a hazard, and the network running and training in the browser. It also has the word search over drone pictures (1:12), a hand-over report that writes itself, and fault drills with a system check.
- **The robot and drone code, written from scratch** (robot/, drone/). Rover: motor-board firmware, the Wi-Fi listener and probe, and the search on the Pi (radar, heat, network, fusion, planner, safety, mission, operator page). Drone: flight-board firmware and the companion code (survey, laser map, rooms, setting down as the Wi-Fi probe). The firmware compiles. None of it has been flashed, driven or flown.
- **A practice building** where the real rover and drone code runs over a made-up world, with **99 cases** (section 4).
- **A comparison** of our network against simpler methods on the same test windows (tools/ml/baselines.py, section 3).
- The film.

**Team:** Rishith Chennupati. The voices in the film are Rishith, Mario and Junsu.

**Made before the event:** the neural network and its trained weights (trained 15 November), the Wi-Fi channel simulator it learned from, the rover hardware and its first firmware, the rover CAD and photographs, and a short film. At EvoHacks 2 (closed 22 November), a one-page concept of the console.

**Not ours:** three.js, d3, Rapier, Transformers.js and the models it runs (named in section 3), WebLLM, the terrain tiles, imagery and map data (credited in the README), and textures made with Codex.

## 3. How did your team use AI?

### AI in the finished project

**Our network (the main AI).** A 1-D convolutional network with 23,372 parameters, written from scratch in NumPy, with every gradient derived by hand and checked against finite differences. It reads ten seconds of Wi-Fi channel readings on 51 subcarriers and answers two questions: is someone there, and are they moving?

**A1, why this AI.** A body changes the signal on all 51 subcarriers at once, in a pattern that's different in every room. A rule on one number misses that, and a big network won't run on a Raspberry Pi with only NumPy. A small network is quick enough: **0.22 ms per window** on a laptop. The comparison, on the same 955 test windows from people the network never saw, with every method cut at the same 11.1 % false alarms on empty rooms (data/baselines.json):

| Method | Moving person found | Still person found | Fan called a person | Score (AUC, moving vs empty) |
|---|---|---|---|---|
| **Our network** | **86.9 %** | 21.4 % | 6.9 % | **0.941** |
| Logistic regression on 306 hand-made features | 66.4 % | 13.9 % | 8.9 % | 0.86 |
| Rule: how fast the signal changes | 44.9 % | 2.7 % | 22.8 % | 0.754 |
| Rule: share of energy at walking speed | 15.3 % | 1.2 % | 27.7 % | 0.637 |
| Rule: how much the signal varies | 7.7 % | 1.0 % | 27.7 % | 0.636 |

**A2, the decision that made it work.** We had no recordings, so we made 900 people in Blender and simulated the channel. Trained on a clean simulator, the network called **81 % of realistic empty rooms a person**. So we trained it on the real chip's faults: gain jumps, drift, noise, lost packets and jitter. The false alarms fell to **11.1 %**. You can train both versions in the console and watch the difference.

A second decision is built into the robot: it never decides from one window. It moves, listens from another wall, and adds radar and heat. Blind is never counted as empty, and a "no" only counts where the sensor could reach.

**A3, how we checked it, and what it can't do.** On 955 simulated test windows from people it never saw:

- a moving person behind the wall is found **86.9 %** of the time;
- still or moving is right **91.5 %** of the time;
- an empty room is called empty **88.9 %** of the time;
- a person who only breathes is found **21.4 %** of the time.

A breath changes the signal by 0.05 to 0.4 %, and the chip's noise is about 0.5 %. So Wi-Fi alone can't be trusted to clear a room with a still person in it. That's why the robot adds a breath radar and never closes a room it couldn't cover. Wi-Fi strength can't tell left from right, so position comes from radar. Every number is on simulated signals and simulated people. Real walls and real people come next.

**Other AI in the console**, each labelled with where it fails: D-FINE (nano) finds people and objects in drone pictures. MobileCLIP-S0 searches them by words ("a red jacket"). Depth Anything V2 (small) works out ground in 3-D from one photo. SlimSAM cuts out what was found. Whisper (tiny) listens for calls for help. The copilot turns plain words into one of 19 tool calls. Hand-written rules run by default, because on 44 held-out requests they got 36 right and the best on-device language model (Qwen2.5 1.5B, through WebLLM) got 26. A model can be loaded on request. All of them run in the browser, so nothing leaves the laptop.

### AI during development

Claude (Claude Code) wrote most of the code. The briefs it worked from and its reports are in the repository. Codex made textures.

**A4, a person checked it, and here is what changed.** On 25 November, Rishith opened the live console in his own browser and ran the word search. It failed: "The model runtime (Transformers.js 3.8.1) did not download". The check found that our service worker, which AI wrote, was passing the download from the model site through itself, and his browser refused it. The same download worked from a plain page.

- **Decision:** we kept the AI's search code and changed the service worker so it only handles our own files. We also added a second source for the model runtime.
- **Checked again in the same browser:** "a red jacket" found its best picture at a 0.94 match, 331 tiles in 5.5 s, 109 ms per search. (Commit 6c1c03c.)

## 4. How can people access and use the project, and what results does it achieve?

**Access.** Open [hound-command.vercel.app](https://hound-command.vercel.app) on a laptop in Chrome. Nothing to install, no account, no cost, and it works offline after one full visit. Press **Open the console**, then **Watch the demo** (about five minutes). The robot code needs Python 3.12, NumPy and a C++ compiler: `python3 robot/sim/cases.py` runs every case and writes the table. Code and setup: [github.com/rishith-c/hound-ultra](https://github.com/rishith-c/hound-ultra) (README).

**The main task:** from a building nobody can see into, to a ranked list of rooms with a safe route to each person, approved by a person. **A good result** confirms or flags every hidden person, never closes a room with a person in it as empty, never calls an empty room a person, and never touches a wall.

**R1, the whole process.** In the console's demo, the whole search runs from the first map to the hand-over report (video 2:40 to 3:14). In the practice building, the real rover and drone code does the same from take-off to report. The world, the people and every reading are simulated, and the console is not yet connected to the rover.

**R2, results across cases** (the network chapter of the console; the practice building, docs/ROBOT_RESULTS.md):

| Case | What should happen | What happened |
|---|---|---|
| A person walking behind the wall (console, video 2:17) | The network says "person, moving" | It does |
| An empty room (console) | It stays quiet | It does |
| The first window again (console) | The same answer | The same answer |
| A desk fan, no one there (console) | It isn't fooled | It isn't fooled |
| Ordinary search 1: two people walking, a fan, a hot pipe (20 runs) | Every rule in "a good result" | 39 of 40 people confirmed, 1 flagged, 0 closed as empty, 0 false, 0 wall touches; 20 of 20 met |
| Ordinary search 2: two other people, the fan and pipe moved (20 runs) | The same | 40 of 40 confirmed; 20 of 20 met |
| Repeat: each search 20 times, with new wind and noise | The same every time | 40 of 40 runs met |
| Hard: three people, one standing still, two fans, 5 m/s gusting wind, 10 % damaged packets (20 runs) | The same | 42 of 60 confirmed, 18 flagged, 0 closed as empty, 0 false; 20 of 20 met. The still person was confirmed 2 times and flagged 18 |

**Design choices that cut effort (D1 to D4).** The main thing on every screen is the chance for each room and the reason for it. Details sit one level down, in Advanced. One list puts the most likely room first, so the team doesn't compare raw signals. **D3:** the hand-over report writes itself from the mission: positions, chances, every reading behind each chance, and the route. Nobody copies readings onto paper (gallery picture "Three people, on paper"; live at [hound-command.vercel.app/app/#/report](https://hound-command.vercel.app/app/#/report)). **D4:** the odds rise reading by reading next to the reading that moved them (video 2:33 to 3:09), so the link between a finding and its evidence is on screen.

## 5. What are the current limitations, and what happens when something goes wrong?

**Limits, and what is simulated**

- **No result here comes from real people or real walls.** The buildings, people, hazards and readings are simulated. The terrain, imagery and map of the valley are real. The network and its numbers are real, measured on simulated signals.
- **The console is not connected to the rover.** The rover's new code has not run on the rover. The drone is a design and has only flown in the simulator. The extra rovers, beacons, gas sensing and deep scans in the console are concepts, and each one carries a tag that says so.
- **A still person is the hard case:** 21.4 % on Wi-Fi alone. In the practice building they were never closed as empty, but they were confirmed only 2 times in 20.
- **The radar and heat likelihoods are assumed design values,** taken from the makers' sheets, not measured. So are the 200 simulated missions in the film.
- **What breaks the drone:** a motor or gyro failure cuts the motors, and it falls.
- In the film, the real-wall clip is real video, but its signal is simulated from that video.
- Not a medical tool, and no substitute for a trained team.

**R3, when something goes wrong** (each run 3 times, all met; more in docs/ROBOT_RESULTS.md and the console's System check):

| What goes wrong | How it's caught and handled |
|---|---|
| The cable to the motor board is cut while driving | The board's own watchdog stops the wheels in 0.64 s and 0.13 m. When the cable is back, the search goes on and finishes |
| The operator's link drops | It holds 1.3 s after the last word, keeps the finished rooms, and goes on when the link is back |
| The Wi-Fi goes silent for good | "Wi-Fi: no probe heard". Blind, not empty: no room is called empty, and every room goes to the team |
| 30 % of the radio packets are garbage | About 2,900 broken packets are thrown away. No false person, and no one is closed as empty |
| The drone's map arrives damaged, twice | Both are refused and a new one is asked for, then the search runs |
| The drone loses its position in flight | It comes down level (0.22 to 0.57 m/s) with the motors off |
| The drone's pack fails halfway | It goes home, the readings so far are kept, and no room is called empty |

## 6. Technical details

**Signal chain.** One ESP32-S3 sends 100 Wi-Fi probes a second. A second ESP32-S3 on the rover records how each one arrives on 51 subcarriers (channel state information, CSI). The Raspberry Pi reads a 10 s window and runs the network.

**The network** (`app/core/nn.js` in the browser, NumPy on the Pi, the same weights):

| Layer | Shape |
|---|---|
| Convolution, 9 taps, ReLU, average pool 4 | 52 → 24 channels |
| Convolution, 9 taps, ReLU, average pool 2 | 24 → 24 |
| Convolution, 9 taps, ReLU | 24 → 24 |
| Mean and max over time | → 48 |
| Dense, ReLU | 48 → 32 |
| Two heads | person (2), still or moving (2) |

23,372 parameters, written from scratch in NumPy, with every gradient derived by hand and checked against finite differences. NumPy rather than PyTorch, because the Pi already has NumPy and PyTorch is a 700 MB install. The JavaScript copy matches the Python output on all 30 bundled test windows.

**Training data.** A Blender script builds 900 people (1.20 to 1.95 m tall, 70 % standing, 30 % lying) behind a wall. A channel simulator computes the Wi-Fi signal: the direct path, 3 to 8 room echoes, each body point a reflector, breathing at 7 to 30 a minute, walking at 0.3 to 1.0 m/s, and a fan in a third of the empty rooms. Then it adds the ESP32's own faults: gain jumps, drift, noise, lost packets and jitter. 4,384 training windows, 961 validation, 955 test, split by person, so the test people were never seen in training. Training takes 23 s on a laptop CPU. The person threshold (0.53) was set on validation, so at most 10 % of empty rooms raise an alarm.

**The rover.** Aluminium extrusion frame, four NEMA 17 steppers on 80 mm mecanum wheels, an Arduino UNO R4 with DRV8825 drivers, a Raspberry Pi 4, and a 3S 2200 mAh LiPo. Sensors: an HLK-LD2450 24 GHz radar (x, y and speed of a moving person), two HLK-LD2410C radars (range, and the slow motion of breathing), an MLX90640 thermal camera (32 × 24), a USB webcam and two VL53L1X distance sensors. The Arduino stops the motors by itself 400 ms after the Pi goes quiet.

**Fusion.** Each reading updates the odds for its room by Bayes' rule, and the console writes out every step. The Wi-Fi likelihood is measured on the network's test set; the radar, heat, drone and sound likelihoods are assumed design values. A lead stays "possible" until the evidence is in, and a person confirms it. A sensor that was blind never counts as "empty".

**Planning and missions.** A* routes that will not cross a hazard, coverage and leftover risk per room, and a deterministic mission simulator (same seed, same mission). Over 200 simulated missions with three hidden people and two decoys each, 600 of 600 people were found or flagged for a team check (284 by sensors alone), no decoy was ever confirmed as a person, and the team checked 34 more places on foot and found no one there.

**The console.** Plain ES modules, with no framework and no bundler. three.js and WebGL draw a 3-D twin of the real valley (Mapzen terrain tiles, Esri and Maxar imagery). Web Workers run the heavy maths, and Rapier does the rubble physics. Transformers.js runs D-FINE nano, MobileCLIP-S0, Depth Anything V2 small, SlimSAM and Whisper tiny in the page, and WebLLM runs Qwen2.5 or Llama 3.2. A service worker keeps the last good copy for use offline. Unit tests are at `/tests/`, and the live System check runs the same tests and the fault drills in front of you.

### Every AI model in HOUND, and how well it did

All run on the user's own computer: the network on the Pi or in the page, the rest in the browser through Transformers.js or WebLLM. Every result here is on simulated signals or AI-made test scenes, never on real people.

| Model | Its job | Measured | Where it fails |
|---|---|---|---|
| **HOUND Wi-Fi network** (ours, 1-D CNN, 23,372 parameters) | Is someone behind the wall, and are they moving? From 10 s of CSI | 86.9 % of moving people found, 88.9 % of empty rooms called empty, AUC 0.941, on 955 held-out windows | A still person: 21.4 % |
| The same network, **int8** for a microcontroller | Fit in 23,716 bytes instead of 93,488 | Moving 88.3 %, still 24.1 %, empty 88.1 %; 31 of 955 answers changed; bit for bit on 320 windows in the page | Needs the quantisation settings searched on validation |
| The same network, **pruned** | Fewer weights | 40 % cut with no retraining; 70 % with three more epochs, AUC within 0.01 | Past 70 % |
| The same network, **calibrated** and **conformal** | Say how sure it is | Calibration error 9.4 % → 7.3 % (temperature) → 2.5 % (scale and offset). Conformal at 90 %: 89.2 % covered | Says "not sure" for 71 % of still people; out-of-distribution flag is weak (6 % against a 5 % base rate) |
| The same network, **spiking** | A neuromorphic version | 97 % agreement at 256 steps | 5.2 M synaptic events against 271 k multiply-adds: worse, and we say so |
| **D-FINE nano** (`dfine_n_coco`) | People and objects in drone pictures | Beside it, our RX colour-anomaly detector finds 74 to 77 % of 96 drawn overhead figures | D-FINE was trained on ground-level photos and finds 1 to 3 % from above; RX misses earth-tone clothing. Both are shown |
| **MobileCLIP-S0** | Search drone pictures by words | 331 tiles in 4.3 s, 272 ms a query; "a red jacket" best match 0.94 | A red cloth can outscore a real red jacket |
| **SlimSAM** (`slimsam-77-uniform`) | Outline a slab with one click | Click 24 to 35 ms; slab area +3 %, pond −1.9 % | A tin roof: −97.5 % with one click, +6.2 % with two |
| **Depth Anything V2 small** | Ground in 3-D from one photo | 3.9 % mean error, after fitting scale and shift to the truth | Read a slope on a flat frame |
| **Whisper tiny** | Hear calls for help, and which language | Language right 7 of 7; letter errors English 12 %, Spanish 8 %, German 0 % | Hindi 100 %, Chinese 27 % |
| **AST** (AudioSet) | Name sounds | Runs live in the page | A drawn cough ranked 155 of 527; a knock was called "Wood block" |
| **Qwen2.5 1.5B / 0.5B, Llama 3.2 1B, SmolLM2 360M** (WebLLM 0.2.89, 4-bit) | Copilot: plain words to one of 19 tool calls | Held-out 44: rules 36, Qwen 1.5B 26, Llama 16, Qwen 0.5B 12, SmolLM2 5. So the rules run by default | A model's re-wording passed our number check and was still wrong, so wording is never the record |

### The algorithms behind each lab, measured in simulation

- **Bayesian search (Search strategy).** Every empty look reshapes a live probability map of the site. Mean time to find a hidden person: **8:49 against 14:04** for a fixed route; found within 20 min, 84 % against 36 % (computed exactly, checked with 8,000 sampled people). A Monte-Carlo tree search on the mission as a POMDP, run on 600 fresh worlds with settings fixed first, **did not beat** the greedy rule (41 % against 59 % of people found). We report that.
- **Multi-robot search (Swarm, concept hardware).** Frontier exploration with a greedy auction or Hungarian assignment, against "go to the nearest frontier": 8 robots, 8 seeds, two sites. Coordination cut the time to cover 95 % of the floor by a median **30 to 47 %** on 8 of 8 seeds, and robots chasing a frontier another robot had already taken fell from 62 to 96 % of their time to 11 to 33 %.
- **Fusion.** 50 missions through the console: 150 of 150 people found or flagged, 0 false confirmations.
- **3-D scan and void finder.** Point cloud classified at **95.6 %** agreement; 9 voids (92 m³), about 79 % of their volume really empty. These were tuned on the same site they are scored on, and the page says so.
- **Radio twin.** Solves the wave equation for a Wi-Fi signal in the browser and shows it passing through a simulated building and a wall, and changing when a person walks in. Seven exhibits, from a ray-traced building to a synthetic aperture and a reflecting panel, each shows its error against a simulated truth.
- **Signals (your device).** Tap detector on 336 simulated clips: three knocks found 23 of 24 times at +6 dB over steady noise, 0 false alarms in 23 min; random debris raises 0.26 false alarms a minute. Phone finder from signal strength, 160 simulated phones: median error 2.3 m at 4 dB noise.
- **Drone imagery.** Before-and-after change detection: 45 of 45 known changes, 0 false areas, where plain subtraction gives 151 false areas (an easy test: we wrote the generator).
- **Timelines.** The simulator is deterministic, so the mission replays from its own command log. Fork any moment, change one decision, and run the new world to the end; each branch runs twice and must give the same fingerprint. In the exercise, skipping one second look left 2 of 3 people unreached.
- **Structure.** Rigid-body physics (Rapier) of the rubble pile: try a lift, a tremor or a shore in copies of the pile before anyone touches a slab, including the case where a shore does not help. The demo case was chosen by search.
- **Triage and Training.** Every find gets a priority score you can take apart term by term and overrule. Training shows the route the planner draws when one rule is left off: 23 m on an unstable slope instead of 8 m.
- **Deep scan and Horizon (concepts).** Muon tomography, gravity gradiometry, ground-penetrating radar, fibre-optic sensing, seismic and echo, then eleven far-frontier ideas. Each runs its mathematics in the browser against a simulated truth, errors included. None of this hardware is on HOUND.
- **System check.** 33 self-tests and about 2,000 checks run in the browser, and failures stay red. The browser network matches the Python network on all 30 bundled windows to 0.00001.

**Robot and drone code, written in the event:**

- `robot/drive`: Uno R4 drive firmware, its serial link and the stop-on-silence watchdog.
- `robot/radio`: the ESP32 Wi-Fi listener and probe.
- `robot/pi/hound`: radar, heat, network, fusion, planner, safety, mission and the operator page. Every request needs a key read from the `HOUND_KEY` environment variable, never from a file.
- `robot/sim`: the practice building and its 99 cases.
- `drone/fc`: the ESP32-S3 flight firmware. `drone/companion`: survey, laser map, rooms, and landing as the Wi-Fi probe. `drone/sim`: the flight simulator.

All four firmware sketches compile. None of them has been flashed, driven or flown.

**How AI wrote it, and how it was held to the truth.** Claude Code agents each owned one workspace, working from written briefs (`orchestration/`). `docs/FACTS.md` lists the only claims they were allowed to make, and `tools/export_eval.py` refuses to write numbers that do not match the published test results.

## 7. HOUND Command, all 24 workspaces

The console opens in **Demo** (one scene per chapter) and has an **Advanced** switch with all 24 workspaces. Every workspace carries a tag that says what it is: built, real data, live AI, a live algorithm on simulated input, simulated, or a concept. **What is real?** (bottom left of the console) lists all of them.

### Operate

**Valley** · _Real data_. The real valley in 3-D: terrain, satellite imagery, the flood, and where the search is.

![Valley](https://hound-command.vercel.app/assets/img/landing/ws-area.jpg)

**Mission** · _Simulated_. Run the search in the 3-D twin, from drone survey to rescue.

![Mission](https://hound-command.vercel.app/assets/img/landing/ws-mission.jpg)

**Rover** · _Built_. The rover we built, part by part, from our own CAD to the real photograph.

![Rover](https://hound-command.vercel.app/assets/img/landing/ws-rover.jpg)

**Triage** · _Live algorithm, simulated input_. Who to reach first, and where to break through.

![Triage](https://hound-command.vercel.app/assets/img/landing/ws-triage.jpg)

**Swarm** · _Concept_. Several rovers and drones sharing one search.

![Swarm](https://hound-command.vercel.app/assets/img/landing/ws-swarm.jpg)

### Sense

**Wi-Fi AI** · _Live AI_. The neural network that senses people through walls, running live.

![Wi-Fi AI](https://hound-command.vercel.app/assets/img/landing/ws-sense.jpg)

**Fusion** · _Live algorithm, simulated input_. How Wi-Fi, radar and heat add up to one confident answer.

![Fusion](https://hound-command.vercel.app/assets/img/landing/ws-fusion.jpg)

**Drone imagery** · _Live AI_. Find people in aerial photos with a detector that runs in the browser.

![Drone imagery](https://hound-command.vercel.app/assets/img/landing/ws-aerial.jpg)

**3-D scan** · _Live algorithm, simulated input_. Turn a drone scan into a map and look for survivable spaces.

![3-D scan](https://hound-command.vercel.app/assets/img/landing/ws-scan.jpg)

**Signals** · _Uses your device_. Listen for tapping with your microphone; locate phones by signal strength.

![Signals](https://hound-command.vercel.app/assets/img/landing/ws-signals.jpg)

### Frontier

**Radio twin** · _Live algorithm, simulated input_. Ray-traced Wi-Fi through the building, the quarter-wavelength trick, and radar images through a wall.

![Radio twin](https://hound-command.vercel.app/assets/img/landing/ws-radio.jpg)

**Deep scan** · _Concept_. Cosmic rays, gravity, ground radar and fibre optics: six kinds of physics for seeing inside a collapse.

![Deep scan](https://hound-command.vercel.app/assets/img/landing/ws-deepscan.jpg)

**Vision lab** · _Live AI_. Search a photo by words, turn one photo into 3-D, read a pulse from pixels. Real models, in the page.

![Vision lab](https://hound-command.vercel.app/assets/img/landing/ws-vision.jpg)

**Search strategy** · _Live algorithm, simulated input_. The mathematics of where to look next, measured against the scripted search.

![Search strategy](https://hound-command.vercel.app/assets/img/landing/ws-strategy.jpg)

**Timelines** · _Live algorithm, simulated input_. Fork the mission at any moment, decide differently, and compare the worlds side by side.

![Timelines](https://hound-command.vercel.app/assets/img/landing/ws-timelines.jpg)

**Model forge** · _Live AI_. Train the network in your browser, shrink it for a microcontroller, and measure how sure it is.

![Model forge](https://hound-command.vercel.app/assets/img/landing/ws-forge.jpg)

**Structure** · _Live algorithm, simulated input_. Rigid-body physics of the rubble pile: test a lift before anyone touches a slab.

![Structure](https://hound-command.vercel.app/assets/img/landing/ws-structure.jpg)

**Horizon** · _Concept_. The far frontier: ideas that sound like science fiction, each anchored in real research.

![Horizon](https://hound-command.vercel.app/assets/img/landing/ws-horizon.jpg)

### Understand

**Evidence** · _Live algorithm, simulated input_. Every finding linked to the readings that support it.

![Evidence](https://hound-command.vercel.app/assets/img/landing/ws-graph.jpg)

**Report** · _Live algorithm, simulated input_. The hand-over report for the rescue team, written from the mission log.

![Report](https://hound-command.vercel.app/assets/img/landing/ws-report.jpg)

**Live quakes** · _Real data_. Real earthquakes from the USGS feed, on a 3-D globe.

![Live quakes](https://hound-command.vercel.app/assets/img/landing/ws-globe.jpg)

**Training** · _Live algorithm, simulated input_. Practise the operator's decisions and get scored.

![Training](https://hound-command.vercel.app/assets/img/landing/ws-train.jpg)

### System

**Copilot** · _Live AI_. Ask in plain words. An on-device language model turns it into actions.

![Copilot](https://hound-command.vercel.app/assets/img/landing/ws-copilot.jpg)

**System check** · _Live algorithm, simulated input_. Self-tests, fault drills and the list of what is real.

![System check](https://hound-command.vercel.app/assets/img/landing/ws-status.jpg)

No sponsor tools (Prune, Momen) were used.
