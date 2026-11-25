# Devpost draft (Global AI Builder's Challenge)

Not submitted. Every number here is in docs/FACTS.md, docs/ROBOT_RESULTS.md or data/baselines.json. Video times are for cut 13; check them again after the final cut.
Replace the three links at the end before use.

**Name:** HOUND
**Tagline (max 200):** A drone, a robot and a Wi-Fi neural network that tell a rescue team which room to open first, and HOUND Command, the console they run it from.

---

## 1. Who is it for, and why would they use it?

**The people:** the leader of a small rescue team (a district team, a volunteer fire brigade) at a building that has collapsed or filled
with mud. They have to decide which room to open first, and they can't see inside.

**V1, the need.** On 26 August 2026 the Bhote Koshi flood hit the Nepal–Tibet border. By late September, Nepal's disaster authority (NDRRMA) counted
more than 1,400 dead and more than 5,000 missing ([OnlineKhabar](https://english.onlinekhabar.com/bhotekoshi-relief-remains-stalled.html),
[Himalayan Times, 4 Sept: 1,290 dead, 4,798 missing](https://thehimalayantimes.com/nepal/bhotekoshi-flood-1290-dead-8197-rescued-4800-missing-so-far),
[ADRC report](https://www.adrc.asia/publications/disaster_report/pdf/2026/ADRC_FL_NPL_Rasuwa_20260826_EN.pdf)). Many of the missing were under mud,
rock and buildings. At every building, the first question is: is anyone in there, and where?

**V1, a use example.** A team reaches a house with five rooms and the roof gone. The drone flies first and maps it from above. The rover drives to
the wall of the first room and stops. The drone lands on the far side of the room and sends Wi-Fi through it, and the rover listens for ten seconds.
Radar and heat add their readings. HOUND Command shows one chance for each room, every reading behind it, and the safe way in. The team opens the
most likely room first, and a person approves every route. (Video 0:50 to 3:14.)

**V2, the comparison.** What a team can use today, for the same question:

| Tool | Through a wall? | What it needs | Cost or effort | Source |
|---|---|---|---|---|
| Camera or fibrescope | No: it needs a gap | A hole or a gap | Low | how they work |
| Search dog | Smell only, not through closed rubble | A handler; the dog tires | 6 months to 2 years to certify, and again every 3 years | [FireRescue1](https://www.firerescue1.com/fema/inside-the-world-of-fema-usar-canines), [FEMA](https://webarchive.library.unt.edu/web/20161122181913/https://www.fema.gov/canine-handler-certification) |
| Seismic and acoustic listening device | Yes | The person has to make a sound or a tap | Delsar LD3 kit: $42,978.83 list price | [Safeware](https://www.safewarecontracts.com/itemdetail/SAV%206020-01-016) |
| Handheld through-wall radar (Range-R) | Yes, up to about 15 m | Sold to police, military and rescue services | Reported at about $6,000 | [Wikipedia](https://en.wikipedia.org/wiki/Range-R), [IPVM forum](https://ipvm.com/forums/video-surveillance/topics/radar-r-new-technology-allows-surveillance-thru-walls/posts/68829) |
| **HOUND** | Yes: Wi-Fi, plus radar and heat | A laptop with Chrome; the rover; the drone (a design) | Rover parts bought: $261.37, plus a Pi, motors, radars and ESP32 boards we already had | our parts list |

**V2, the benefit.** HOUND hears a moving person through a wall without the person making a sound, for the cost of a school robot. It also tells
the team where to start. In 20 simulated searches of a five-room building with two hidden people, the team opened **2.0 rooms before everyone was
found, against 4.0 in a random order**. In the hard case (three people, one standing still, strong wind, damaged radio packets), it was 3.65
against 4.5. This is simulation only (docs/ROBOT_RESULTS.md).

**V3, can a team really use it?** The console runs in Chrome on a laptop, with nothing to install and no account, and works offline after one visit.
The rover is built from a public parts list, and its code compiles for the stock boards (Arduino Uno R4 WiFi, ESP32-S3, Raspberry Pi). The Wi-Fi
receiver is a $10 class ESP32 board. Two things still stand in the way, and here is how they get met. First, the rover and the console have not been
connected yet, and the rover's new code has not run on the rover. The next step is one person behind one drywall wall. Second, the drone is a
design. Until it is built, the first trial places the Wi-Fi probe on the far side by hand. Flying a drone needs the local aviation authority's
permission.

## 2. What did we build or improve during the hackathon?

HOUND is **based on existing work**. Here is the line.

**Before 21 November 2026:** the rover hardware and its first firmware, the Wi-Fi channel simulator, the neural network and its trained weights
(trained 15 November), the rover CAD and photographs, and a short film. At EvoHacks 2 (closed 22 November), a one-page concept of the console.

**During this event (21 to 28 November), all in this repository:**

- **HOUND Command**, the console (video 0:37 onward): 24 workspaces in two modes, Demo and Advanced. It has a 3-D twin of the real valley at Timure,
  a mission simulator, Bayesian fusion that writes out every step, a route planner that won't cross a hazard, and the network running and training
  in the browser. It also has the word search over drone pictures (1:12), a hand-over report that writes itself, and fault drills with a system check.
- **The robot and drone code, written from scratch** (robot/, drone/). Rover: motor-board firmware, the Wi-Fi listener and probe, and the search on
  the Pi (radar, heat, network, fusion, planner, safety, mission, operator page). Drone: flight-board firmware and the companion code (survey,
  laser map, rooms, setting down as the Wi-Fi probe). The firmware compiles. None of it has been flashed, driven or flown.
- **A practice building** where the real rover and drone code runs over a made-up world, with **99 cases** (section 4).
- **A comparison** of our network against simpler methods on the same test windows (tools/ml/baselines.py, section 3).
- The film.

**Not ours:** three.js, d3, Rapier, Transformers.js and the models it runs (named in section 3), WebLLM, the terrain tiles, imagery and map data
(credited in the README), and textures made with Codex.

## 3. How did we use AI?

### AI in the finished project

**Our network (the main AI).** A 1-D convolutional network with 23,372 parameters, written from scratch in NumPy, with every gradient derived by hand
and checked against finite differences. It reads ten seconds of Wi-Fi channel readings on 51 subcarriers and answers two questions: is someone
there, and are they moving?

**A1, why this AI.** A body changes the signal on all 51 subcarriers at once, in a pattern that's different in every room. A rule on one number
misses that, and a big network won't run on a Raspberry Pi with only NumPy. A small network is quick enough: **0.22 ms per window** on a laptop.
The comparison, on the same 955 test windows from people the network never saw, with every method cut at the same 11.1 % false alarms on empty
rooms (data/baselines.json):

| Method | Moving person found | Still person found | Fan called a person | Score (AUC, moving vs empty) |
|---|---|---|---|---|
| **Our network** | **86.9 %** | 21.4 % | 6.9 % | **0.941** |
| Logistic regression on 306 hand-made features | 66.4 % | 13.9 % | 8.9 % | 0.86 |
| Rule: how fast the signal changes | 44.9 % | 2.7 % | 22.8 % | 0.754 |
| Rule: share of energy at walking speed | 15.3 % | 1.2 % | 27.7 % | 0.637 |
| Rule: how much the signal varies | 7.7 % | 1.0 % | 27.7 % | 0.636 |

**A2, the decision that made it work.** We had no recordings, so we made 900 people in Blender and simulated the channel. Trained on a clean
simulator, the network called **81 % of realistic empty rooms a person**. So we trained it on the real chip's faults: gain jumps, drift, noise, lost
packets and jitter. The false alarms fell to **11.1 %**. You can train both versions in the console and watch the difference.

A second decision is built into the robot: it never decides from one window. It moves, listens from another wall, and adds radar and heat. Blind
is never counted as empty, and a "no" only counts where the sensor could reach.

**A3, how we checked it, and what it can't do.** On 955 simulated test windows from people it never saw:

- a moving person behind the wall is found **86.9 %** of the time;
- still or moving is right **91.5 %** of the time;
- an empty room is called empty **88.9 %** of the time;
- a person who only breathes is found **21.4 %** of the time.

A breath changes the signal by 0.05 to 0.4 %, and the chip's noise is about 0.5 %. So Wi-Fi alone can't be trusted to clear a room with a still
person in it. That's why the robot adds a breath radar and never closes a room it couldn't cover. Wi-Fi strength can't tell left from right, so
position comes from radar. Every number is on simulated signals and simulated people. Real walls and real people come next.

**Other AI in the console**, each labelled with where it fails: D-FINE (nano) finds people and objects in drone pictures. MobileCLIP-S0 searches
them by words ("a red jacket"). Depth Anything V2 (small) works out ground in 3-D from one photo. SlimSAM cuts out what was found. Whisper (tiny)
listens for calls for help. A small language model (Qwen2.5 or Llama 3.2, through WebLLM) answers questions about the mission. All of them run in
the browser, so nothing leaves the laptop.

### AI during development

Claude (Claude Code) wrote most of the code. The briefs it worked from and its reports are in the repository. Codex made textures.

**A4, a person checked it, and here is what changed.** On 25 November, Rishith opened the live console in his own browser and ran the word search.
It failed: "The model runtime (Transformers.js 3.8.1) did not download". The check found that our service worker, which AI wrote, was passing
the download from the model site through itself, and his browser refused it. The same download worked from a plain page.

- **Decision:** we kept the AI's search code and changed the service worker so it only handles our own files. We also added a second source for
  the model runtime.
- **Checked again in the same browser:** "a red jacket" found its best picture at a 0.94 match, 331 tiles in 5.5 s, 109 ms per search.
  (Commit 6c1c03c.)

## 4. How can people access and use it, and what results does it achieve?

**Access.** Open the link on a laptop in Chrome. Nothing to install, no account, no cost, and it works offline after one full visit. Press **Open
the console**, then **Watch the demo** (about five minutes). The robot code needs Python 3.12, NumPy and a C++ compiler:
`python3 robot/sim/cases.py` runs every case and writes the table.

**The main task:** from a building nobody can see into, to a ranked list of rooms with a safe route to each person, approved by a person.
**A good result** confirms or flags every hidden person, never closes a room with a person in it as empty, never calls an empty room a person, and
never touches a wall.

**R1, the whole process.** In the console's demo, the whole search runs from the first map to the hand-over report (video 2:40 to 3:14).
In the practice building, the real rover and drone code does the same from take-off to report. The world, the people and every reading are
simulated, and the console is not yet connected to the rover.

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

**Design choices that cut effort (D1 to D4).** The main thing on every screen is the chance for each room and the reason for it. Details sit one
level down, in Advanced. One list puts the most likely room first, so the team doesn't compare raw signals. **D3:** the hand-over report
writes itself from the mission: positions, chances, every reading behind each chance, and the route. Nobody copies readings onto paper. **D4:**
the odds rise reading by reading next to the reading that moved them (video 2:33 to 3:09), so the link between a finding and its evidence is on
screen.

## 5. Limits, and what is simulated

- **No result here comes from real people or real walls.** The buildings, people, hazards and readings are simulated. The terrain, imagery and map
  of the valley are real. The network and its numbers are real, measured on simulated signals.
- **The console is not connected to the rover.** The rover's new code has not run on the rover. The drone is a design and has only flown in the
  simulator. The extra rovers, beacons, gas sensing and deep scans in the console are concepts, and each one carries a tag that says so.
- **A still person is the hard case:** 21.4 % on Wi-Fi alone. In the practice building they were never closed as empty, but they were confirmed only
  2 times in 20.
- **The radar and heat likelihoods are assumed design values,** taken from the makers' sheets, not measured. So are the 200 simulated missions in the
  film.
- **What breaks the drone:** a motor or gyro failure cuts the motors, and it falls.
- In the film, the real-wall clip is real video, but its signal is simulated from that video.
- Not a medical tool, and no substitute for a trained team.

---

**Built with:** JavaScript, three.js, WebGL, d3, Web Workers, Rapier, Transformers.js, WebLLM, Python, NumPy, C++, Arduino, ESP32-S3, Raspberry Pi, Blender
**Categories to tick:** AI Hardware and Robotics, AI Engineering, AI Data and Prediction, Design and UX, Originality, Demo
**Links:** live site, GitHub repository, video
