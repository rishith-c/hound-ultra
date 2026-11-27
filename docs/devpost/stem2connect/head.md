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
