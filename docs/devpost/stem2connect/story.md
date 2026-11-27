**Watch:** [the film](https://youtu.be/CD6toHreojU) · **Try it:** [hound-command.vercel.app](https://hound-command.vercel.app) · **Code:** [github.com/rishith-c/hound-ultra](https://github.com/rishith-c/hound-ultra) · **Track:** Community Impact

## Someone is alive behind that wall. The Wi-Fi signal already knows it.

When a building collapses, rescuers face one question at every wall: **is anyone alive in there, and where?** Cameras need a gap. Dogs tire. Listening devices need the survivor to make a sound, and an unconscious survivor cannot.

A human body changes Wi-Fi as it passes through a wall, on all 51 subcarriers at once. **We built a neural network from scratch that reads that change** and says "person, moving" from ten seconds of signal. We also built the whole rescue system around it:

- a rover that listens at the wall;
- a drone designed to carry the Wi-Fi source to the far side;
- **HOUND Command**, a 24-workspace console that turns every reading into one answer: **open this room first.**

| **86.9 %** | **2.0 vs 4.0** | **99 / 99** | **11** |
|---|---|---|---|
| of moving people found through a wall | rooms opened before everyone is found, against a random order | practice cases met by the real robot code | AI models running in the browser, on the rescuer's own laptop |

*Results are measured in simulation, over the real terrain of Timure, Nepal. The drone is a design, flown in the simulator.*

## The problem

The Bhote Koshi flood of 26 August 2026 left **more than 1,400 dead and more than 5,000 missing** by late September (NDRRMA, Nepal's disaster authority), many of them under mud, rock and buildings. At every building, the first hours go to one question nobody outside can answer.

HOUND is for the person who has to decide where to dig: the leader of a district rescue team or a volunteer fire brigade, standing at a building nobody can see into. Here is what those teams can use today:

| Tool | Through a wall? | Cost | Source |
|---|---|---|---|
| Camera or fibrescope | No, it needs a gap | Low | |
| Search dog | Scent only | 6 months to 2 years to certify | [FireRescue1](https://www.firerescue1.com/fema/inside-the-world-of-fema-usar-canines), [FEMA](https://webarchive.library.unt.edu/web/20161122181913/https://www.fema.gov/canine-handler-certification) |
| Acoustic listening device (Delsar LD3) | Only if the person makes a sound | $42,978.83 | [Safeware](https://www.safewarecontracts.com/itemdetail/SAV%206020-01-016) |
| Through-wall radar (Range-R) | Yes, up to about 15 m | About $6,000 | [Wikipedia](https://en.wikipedia.org/wiki/Range-R), [IPVM](https://ipvm.com/forums/video-surveillance/topics/radar-r-new-technology-allows-surveillance-thru-walls/posts/68829) |
| **HOUND** | **Yes: Wi-Fi, radar and heat, and it ranks the rooms** | **Rover parts bought: $261.37** | our parts list |

HOUND is the only tool in that table that both sees through the wall and tells the team where to start, and the survivor never has to make a sound.

## How HOUND solves it

A team reaches a house with five rooms and no roof:

1. The drone maps the house from above.
2. The rover drives to the first wall and listens for ten seconds while the drone sends Wi-Fi through the room from the far side.
3. Radar and heat add their readings.
4. HOUND Command shows one chance for each room, the evidence behind it and a safe way in.
5. The team opens the most likely room first, and a person approves every route.

(Video 0:50 to 3:14.)

**The impact.** In 20 searches of a simulated five-room building with two hidden people, the team opened **2.0 rooms** before everyone was found, against **4.0** in a random order. **Half the digging, at every building.** HOUND's Bayesian search finds a hidden person in **8:49 on average, against 14:04** for a fixed route, and finds **84 % within 20 minutes, against 36 %**.

**Built for people under pressure.**

- Every screen leads with one chance per room and the reason for it.
- One list puts the most likely room first, so nobody compares raw signals.
- The hand-over report writes itself from the mission ([live](https://hound-command.vercel.app/app/#/report)).
- The odds rise reading by reading, next to the reading that moved them.

## How we used AI

**The core: a Wi-Fi neural network written from scratch.** It is a 1-D convolutional network with 23,372 parameters, written in NumPy, with every gradient derived by hand and checked against finite differences. It reads ten seconds of Wi-Fi channel readings on 51 subcarriers and answers two questions: **is someone there, and are they moving?** It takes **0.22 ms** per window and runs on a Raspberry Pi or in the browser, with the same weights.

**Why a neural network.** A body changes all 51 subcarriers at once, in a pattern that is different in every room, and a rule on one number misses it. All methods were tested on the same 955 held-out windows, each set to the same false-alarm rate:

| Method | Moving person found | Score (AUC) |
|---|---|---|
| **HOUND network** | **86.9 %** | **0.941** |
| Logistic regression on 306 hand-made features | 66.4 % | 0.86 |
| Best hand-written rule | 44.9 % | 0.754 |

**It beats a classic machine-learning model by 20 points and the best hand-written rule by 42.**

**No dataset of people behind walls exists. So we made one.** We built **900 people in Blender** (1.20 to 1.95 m tall, standing and lying, breathing and walking) and simulated the Wi-Fi channel around each of them. A network trained on a clean simulator mistook 81 % of realistic empty rooms for a person. So we trained it on the real chip's faults (gain jumps, drift, noise, lost packets and jitter), and the false alarms fell to **11.1 %**. You can train both versions in the console and watch the difference.

**How we checked it.** We tested it on 955 windows from people it never saw in training:

- it finds a moving person **86.9 %** of the time;
- it calls an empty room empty **88.9 %** of the time;
- it tells still from moving correctly **91.5 %** of the time.

HOUND never trusts one sensor. It fuses the network with a breathing radar and heat by Bayes' rule, listens from more than one wall, and never clears a room it could not cover.

**More AI models, all running in the browser.**

- D-FINE finds people in drone pictures.
- MobileCLIP-S0 searches those pictures by words ("a red jacket").
- Depth Anything V2 turns one photo into 3-D ground.
- SlimSAM outlines a slab in one click.
- Whisper listens for calls for help.
- AST names the sounds it hears.

A copilot turns plain words into one of 19 console actions, and on-device language models (Qwen2.5, Llama 3.2 and SmolLM2 through WebLLM) can be loaded on request. **Nothing leaves the laptop.** Every model and its measured results are in "Under the hood" below.

**AI coding assistants (disclosure).** Claude Code (Anthropic) wrote most of the code. One session planned the work and wrote briefs, and command-line agents each built one workspace. Codex (OpenAI) made the textures. Rishith set the goal and the design bar, tested every feature, and decided what changed. One example: on 25 November he ran the word search in his own browser, and it failed because the AI-written service worker blocked the model download. We kept the search code, limited the service worker to our own files and added a second source for the runtime. We checked again in the same browser: "a red jacket" found its best match at 0.94, with 331 tiles searched in 5.5 s (commit 6c1c03c). To keep the AI honest, `docs/FACTS.md` lists the only claims the agents were allowed to make, and `tools/export_eval.py` refuses to write numbers that do not match the test results.

## It works: try it now

**Open one link, and the whole search runs in front of you.** Open [hound-command.vercel.app](https://hound-command.vercel.app) in Chrome, press **Open the console**, then **Watch the demo** (about five minutes). It needs no install, no account and no payment, and it works offline after one visit. The network runs live in the page. For the robot code, `python3 robot/sim/cases.py` reruns every case.

**Results across cases.** The real rover and drone code runs in a practice building (docs/ROBOT_RESULTS.md):

| Case | Result |
|---|---|
| A person walking behind the wall (console, video 2:17) | "Person, moving" |
| An empty room, and a desk fan with no one there | Stays quiet, and is not fooled |
| Search 1: two people, a fan and a hot pipe, 20 runs | 39 of 40 confirmed, 1 flagged, 0 wrongly cleared, 0 false, 0 wall touches |
| Search 2: the people, fan and pipe moved, 20 runs | 40 of 40 confirmed |
| Hard: three people (one standing still), two fans, 5 m/s gusts and 10 % damaged packets, 20 runs | 42 of 60 confirmed, 18 flagged for the team, **0 wrongly cleared, 0 false** |
| 200 full missions, each with three people and two decoys | **600 of 600 people found or flagged, 0 decoys confirmed** |

**Built to fail safe.** In every failure we threw at it, HOUND ended in a safe state, and no room was ever wrongly cleared (each case was run 3 times, and all were met):

| What goes wrong | What HOUND does |
|---|---|
| The cable to the motor board is cut while driving | The board's own watchdog stops the wheels in **0.64 s, within 0.13 m**. The search resumes when the cable is back |
| The operator's link drops | It holds 1.3 s after the last command, keeps the finished rooms and resumes when the link is back |
| The Wi-Fi goes silent | It reports "no probe heard". Blind is never counted as empty |
| 30 % of the radio packets are garbage | About 2,900 broken packets are thrown out, with no false person |
| The drone's map arrives damaged | The map is refused and a new one is requested |
| The drone loses its position | It comes down level, at 0.22 to 0.57 m/s |
| The drone's battery fails halfway | It flies home and keeps every reading |

## What we learned

- **Simulated data has to be as messy as the real world.** Our first network, trained on a clean simulator, mistook 81 % of empty rooms for a person. When we added the real chip's faults (gain jumps, drift, noise, lost packets and jitter) to the training data, the false alarms fell to 11.1 %. The biggest gain did not come from a bigger model. It came from more realistic data.
- **Never trust one sensor.** A person lying perfectly still barely changes the Wi-Fi signal, so we learned to fuse Wi-Fi with radar and heat by Bayes' rule, and to treat "blind" as different from "empty".
- **Measure before choosing a model.** On 44 held-out copilot requests, hand-written rules got 36 right and the best on-device language model got 26, so the rules run by default and the model can be loaded on request.
- **Writing a neural network from scratch teaches what a framework hides.** Deriving every gradient by hand, and checking each one against finite differences, showed us exactly why each layer is there.
- **Test in a real browser, not only in scripts.** The word search passed every automated check, but it failed in Rishith's own browser because of the service worker. Since then, every change is checked in the browser it will run in.

## What we would do differently, and what we will build next

- **Record real Wi-Fi earlier.** Next comes the first live test, with one person behind one drywall wall and the rover listening, to measure the network on real signals.
- **Connect the console to the rover**, so HOUND Command shows the rover's own readings live.
- **Build and fly the drone**, with the local aviation authority's permission, so it can carry the Wi-Fi source to the far side of a wall.
- **Run the network on the microcontroller itself.** The int8 version (23,716 bytes) is ready for an ESP32.

## Built during this hackathon

Almost all of HOUND was built inside the STEM2Connect program (11 October to 29 November 2026):

- **15 November:** the Wi-Fi channel simulator, the 900 people made in Blender, and the neural network trained on them.
- **23 to 28 November:** HOUND Command (all 24 workspaces), the rover and drone code, the practice building with its 99 cases, and the film. Every commit in the repository is dated in this period.

**Existed before 11 October:** the rover hardware, its CAD and its first drive firmware (September 2026). The open-source libraries, models and map data we used are credited in the README.

## Under the hood

**The signal chain.** One ESP32-S3 sends 100 Wi-Fi probes a second. A second ESP32-S3 on the rover records how each probe arrives on 51 subcarriers (channel state information, or CSI). The Raspberry Pi runs the network on 10-second windows.

**The network.** The same weights run in the browser (`app/core/nn.js`) and in NumPy on the Pi:

| Layer | Shape |
|---|---|
| Convolution, 9 taps, ReLU, average pool 4 | 52 → 24 channels |
| Convolution, 9 taps, ReLU, average pool 2 | 24 → 24 |
| Convolution, 9 taps, ReLU | 24 → 24 |
| Mean and max over time | → 48 |
| Dense, ReLU | 48 → 32 |
| Two heads | person (2); still or moving (2) |

It has 23,372 parameters, and every gradient was derived by hand and checked against finite differences. We used NumPy instead of PyTorch because the Pi already has NumPy and PyTorch is a 700 MB install. The browser copy matches the Python output to within 0.00001 on all 30 bundled test windows.

**The training data.** A Blender script builds 900 people behind a wall, 1.20 to 1.95 m tall, 70 % standing and 30 % lying. A channel simulator computes the Wi-Fi signal:

- the direct path, 3 to 8 room echoes, and every body point as a reflector;
- breathing at 7 to 30 breaths a minute and walking at 0.3 to 1.0 m/s;
- a fan in a third of the empty rooms;
- the ESP32's own faults: gain jumps, drift, noise, lost packets and jitter.

There are 4,384 training windows, 961 validation and 955 test, split by person so that no test person is seen in training. Training takes 23 s on a laptop CPU. The person threshold (0.53) is set on the validation set.

### Every AI model in HOUND

All of them run on the user's own machine: the network on the Pi or in the page, and the rest in the browser through Transformers.js or WebLLM. The results were measured on simulated signals and test scenes.

| Model | Its job | Measured |
|---|---|---|
| **HOUND Wi-Fi network** (ours: 1-D CNN, 23,372 parameters) | Is someone behind the wall, and are they moving? | **86.9 %** of moving people found, **88.9 %** of empty rooms called empty, **91.5 %** still or moving correct, **AUC 0.941**, 0.22 ms per window |
| HOUND network, int8 | Fit on a microcontroller | **23,716 bytes** instead of 93,488. Finds 88.3 % of moving people and calls 88.1 % of empty rooms empty. Bit for bit in the page on 320 windows |
| HOUND network, pruned | Fewer weights | **40 %** of weights cut with no retraining; **70 %** cut with three epochs of retraining, AUC within 0.01 |
| HOUND network, calibrated and conformal | Say how sure it is | Calibration error **9.4 % → 7.3 % → 2.5 %** (temperature scaling, then scale and offset). Conformal sets at a 90 % target cover **89.2 %** |
| HOUND network, spiking | A neuromorphic version | **97 %** agreement with the original at 256 time steps |
| RX colour-anomaly detector | Spot people in overhead pictures | **74 to 77 %** of 96 overhead figures found |
| D-FINE nano | People and objects in drone pictures | Runs live in the browser |
| MobileCLIP-S0 | Search drone pictures by words | **331 tiles in 4.3 s**, 272 ms per query; "a red jacket" best match **0.94** |
| SlimSAM (77 % uniform) | Outline a slab in one click | **24 to 35 ms** per click; slab area within **3 %**, pond within **1.9 %** |
| Depth Anything V2 small | Ground in 3-D from one photo | **3.9 %** mean depth error (scale and shift aligned) |
| Whisper tiny | Hear calls for help, and in which language | Language right **7 of 7**; letter error **0 %** in German, **8 %** in Spanish |
| AST (AudioSet) | Name sounds | 527 sound classes, live in the page |
| Copilot (rules, plus Qwen2.5 1.5B and 0.5B, Llama 3.2 1B and SmolLM2 360M through WebLLM 0.2.89, 4-bit) | Plain words to one of 19 console actions | **36 of 44** held-out requests right |

### The algorithms, measured in simulation

- **Bayesian search.** Every empty look updates a live probability map of the site. The mean time to find a hidden person is **8:49 against 14:04** for a fixed route, and **84 % are found within 20 minutes, against 36 %** (computed exactly and checked with 8,000 sampled people).
- **Multi-robot coordination.** Frontier exploration with a greedy auction or Hungarian assignment was tested against nearest-frontier, with 8 robots, 8 seeds and two sites. It cut the time to cover 95 % of the floor by a median **30 to 47 %** on **8 of 8 seeds**. The time robots spent chasing a frontier another robot already had fell from 62–96 % to **11–33 %**.
- **Fusion.** Bayes' rule runs per room, with every step on screen. In 50 console missions, **150 of 150** people were found or flagged, with **0** false confirmations. In 200 full missions, **600 of 600**.
- **Route planning.** A* over a hazard map, so a route never crosses a hazard. In Training, turning off one rule makes the planner draw a 23 m route over an unstable slope instead of the 8 m safe route.
- **3-D scan.** Point-cloud classification and a void finder found **9 survivable voids (92 m³)** in the rubble scan.
- **Radio twin.** It solves the wave equation for Wi-Fi in the browser and shows the signal passing through a building and a wall, then changing when a person walks in. Each of its seven exhibits, from a ray-traced building to a synthetic aperture and a reflecting panel, is scored against its simulated truth.
- **Signals.** The tap detector found three knocks **23 of 24** times at +6 dB over steady noise, with **0** false alarms in 23 minutes. The phone finder, working from signal strength, had a median error of **2.3 m** over 160 phones.
- **Change detection.** Comparing before and after drone imagery found **45 of 45** known changes with **0** false areas. Plain subtraction gives 151 false areas.
- **Timelines.** The simulator is deterministic. Any mission replays from its command log, any moment can be forked, and every branch runs twice and must give the same fingerprint.
- **Structure.** Rigid-body physics (Rapier) of the rubble pile lets you try a lift, a tremor or a shore on copies of the pile before anyone touches a slab.
- **Triage.** Every find gets a priority score that can be taken apart term by term and overruled.
- **System check.** **33** self-tests and about **2,000** checks run in the browser.

**The rover.** It has an aluminium extrusion frame, four NEMA 17 steppers on 80 mm mecanum wheels, an Arduino UNO R4 with DRV8825 drivers, a Raspberry Pi 4 and a 3S 2200 mAh LiPo. The Arduino stops the motors by itself 400 ms after the Pi goes quiet. The sensors are:

- an HLK-LD2450 24 GHz radar for the position and speed of a moving person;
- two HLK-LD2410C radars for range and breathing;
- an MLX90640 thermal camera (32 × 24);
- a USB webcam;
- two VL53L1X distance sensors.

**Robot and drone code, written in the event.**

- `robot/drive`: the UNO R4 drive firmware, its serial link and the stop-on-silence watchdog.
- `robot/radio`: the ESP32 Wi-Fi listener and probe.
- `robot/pi/hound`: radar, heat, network, fusion, planner, safety, mission and the operator page. Every request needs a key read from the HOUND_KEY environment variable.
- `robot/sim`: the practice building and its 99 cases.
- `drone/fc`: the ESP32-S3 flight firmware.
- `drone/companion`: survey, laser map, rooms, and landing as the Wi-Fi probe.
- `drone/sim`: the flight simulator.

**The console.** It uses plain ES modules, with no framework and no bundler. three.js and WebGL draw the 3-D twin of the real valley (Mapzen terrain tiles, Esri and Maxar imagery), and Web Workers run the heavy maths. Transformers.js runs D-FINE, MobileCLIP, Depth Anything, SlimSAM, Whisper and AST in the page, and WebLLM runs the language models. A service worker keeps the last good copy for offline use.

## HOUND Command, all 24 workspaces

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
