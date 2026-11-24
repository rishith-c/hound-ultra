# HOUND Ultra: the mission

This file is the goal every agent works toward. Read it first, then `ARCHITECTURE.md`, `FACTS.md` and `STYLE.md`.

## What Rishith asked for (his words, kept)

> "Think of the best improvements we can make... we need to add features, 10x more features... I WANT TO WIN. We need to make the best improvement possible, like insane Palantir Gotham level UI."
>
> "Brainstorm 20 new niche cutting-edge features built on top of this, can be theoretical, we haven't done yet, like taking drone scans then reusing them for people finding, and a custom map. Make all graphics 3D models and everything top tier."
>
> "I'm talking GTA 6, Tesla FSD v15... this level graphics and interactiveness. Make this insane."
>
> "Think of 30+ hella cool stuff, like insane high graphics detail, like Tesla and GTA 6, insane assets, graphics and detail for everything, the animation. You know what I was going for but Codex failed miserably. Make this the craziest of all time. I want you to add tons of theoretical features, this is the tip of the iceberg, but use the most cutting-edge technology. Use theoretical stuff, like use certain drone imaging, repurposing it to find humans for cheap, or crazy stuff. I believe in you. LOCK IN."
>
> "Be 100000000x more ambitious than me."
>
> "What Codex generated was the tip of the iceberg... I need the most hyper-realistic, elite thing. The dashboard
> needs a lot of work: it is too round and bouncy... Palantir Gotham should see this and be like 'I need to recruit
> him'. Don't skimp on features."

## The same goal, ten times bigger

Build **HOUND Command**: the operating picture a rescue team would want in the first hours after a flood or an earthquake, and
the best-looking, most complete student AI project in the Global AI Builder's Challenge.

HOUND is a low-cost rover that drives into buildings that are not safe for people, stops, and senses through walls
with a Wi-Fi neural network, a 24 GHz radar and a thermal camera. HOUND Command is the software around it: a
drone maps the site, the rover searches it, AI turns weak signals into "a person is here, 94 % sure, because…",
and a human approves a safe route in.

The bar:

1. **It looks like nothing else in the gallery.** A real-time 3-D digital twin with the clarity of Tesla's driving
   visualisation and the density of an intelligence analyst's workstation: lit, shadowed, animated, every object
   a model, every number alive. Walls you can see through. Heat behind them. A point cloud that assembles itself
   as the drone flies. Cameras that move like a film.
2. **It is deep.** More than thirty capabilities across sensing, mapping, planning and command (list below). Each
   one does one thing well, with a real algorithm or a real model behind it wherever that is possible in a browser.
3. **It is honest, and proud of it.** Every feature carries a label: Live AI, Live algorithm, Real data, Your device,
   Simulated, or Concept. Honesty is not a footnote here; it is a feature judges score (the rules require
   simulations and concepts to be disclosed, and the rubric rewards showing an AI's limits).
4. **It works the first time, for a stranger.** Open the page: the mission plays by itself, explains itself, and
   every control does something sensible. No dead buttons. No console errors.

## How we win: the judging rubric (100 points)

Judges score from a 2 to 4 minute video and the written description. They reward things that demonstrably work.

| Section | Points | What earns it | What we build for it |
|---|---|---|---|
| Problem value | 20 | A real need, a realistic use, an advantage over the current way | Searching unsafe buildings after the 2026 Bhote Koshi flood in Nepal; cost vs. commercial through-wall radar; the Training workspace makes it usable for volunteer teams |
| AI | 30 | A justified AI choice, a project-specific AI design decision with evidence, an honest check of AI quality and limits | The Wi-Fi CNN running live; "messy simulator" training decision with before/after numbers; fusion that rescues the network's weak case; saliency; ROC; Monte-Carlo mission statistics; an on-device language model; an in-browser image detector |
| Function and reliability | 30 | The whole main task works; correct results in ordinary, repeated and demanding cases; two different failures handled safely | The full mission from survey to rescue; System check with self-tests and evidence tables; fault drills (lost link, dropped packets, corrupt input, dead camera, low battery) |
| Design and experience | 20 | The main action stands out; consistent design; less user effort; relationships made visible | One primary action per step; one design system; autoplay and a command palette; every finding linked to its evidence, on the map, the timeline and the graph |

Eligibility facts that shape the work: improving an existing project is allowed if we say what existed before and
what was built during the event (21 to 28 November 2026); simulated, mocked and unfinished features must be
labelled; a public GitHub repository and a 2 to 4 minute video are required.

## The capability list (target: all of these)

Reality labels: **AI** live AI, **ALG** live algorithm on simulated input, **DATA** real data, **DEV** your device,
**SIM** simulated, **CON** concept (visualised, not built).

Sensing and AI
1. Wi-Fi CSI neural network, live in the browser on held-out test windows (AI)
2. Explanation: which subcarriers and moments drove the answer, by occlusion on the real network (AI)
3. Threshold tuning with the real ROC curve from the 955-window test set (AI)
4. Network anatomy in 3-D: watch a window flow through the layers (AI)
5. Bayesian fusion of Wi-Fi, radar and thermal, every step shown (ALG)
6. Probability map of the building with residual risk per room: "3 % chance someone was missed" (ALG)
7. Monte-Carlo missions: run the search hundreds of times, see how often each person is found (ALG)
8. Aerial person detector: a real object detector in the browser on drone photos, or your own image (AI)
9. Colour-anomaly search (RX detector): the classic trick for spotting clothing in rubble from a cheap drone camera (ALG)
10. Before/after change detection: which buildings moved (ALG)
11. Thermal view with blob tracking (SIM)
12. Breathing-band analysis of a radar signal, with its honest error bars (ALG)
13. Tap and voice listening with your microphone (DEV)
14. Phone finder: locate survivors' phones from Wi-Fi/Bluetooth signal strength (CON, live trilateration)
15. Drone as a flying Wi-Fi transmitter for through-rubble sensing (CON)
16. Exhaled-CO2 plume tracing (CON)

Mapping and 3-D
17. The 3-D digital twin: site, building, rubble, rover, drone, people, hazards (SIM)
18. See-through walls and heat volumes behind them (SIM)
19. Drone scan to point cloud, assembling live (SIM)
20. Void finder: survivable spaces inside a collapse, from the scan (ALG)
21. Fog of war: what has and has not been searched (ALG)
22. Bring your own scan or floor plan (DEV)
23. Live earthquakes on a 3-D globe from the USGS feed (DATA)

Planning and autonomy
24. Hazard-aware route planning, with a human approval step (ALG)
25. Second slide: a new blockage appears and every route is planned again (ALG)
26. Closest safe approach and where to break through a wall (ALG)
27. Who first: a priority order for the people found (ALG)
28. Multi-robot search: frontier exploration and task auction (ALG, hardware CON)
29. Radio mesh: where to drop relay beacons so the link survives (ALG, hardware CON)
30. Battery-aware planning and return (ALG)

Command and trust
31. Evidence graph: every finding linked to the readings behind it (ALG)
32. Timeline you can scrub; the mission replays exactly (ALG)
33. Command palette and keyboard control (ALG)
34. Copilot: plain-language commands, answered by a language model running on this computer (AI)
35. Voice in and spoken alerts (DEV)
36. Hand-over report, generated from the log, ready to print (ALG)
37. INSARAG-style search marking for the building (ALG)
38. Reassurance message for survivors in several languages (DEV)
39. Fault drills: break things on purpose and watch the system stay safe (ALG)
40. System check: self-tests with pass/fail evidence (ALG)
41. What-is-real ledger: every feature, its label and its proof (ALG)
42. Training mode: practise the operator's decisions and get scored (ALG)
43. Accessibility: keyboard, screen reader labels, high contrast, colour-blind palette, reduced motion
44. Works offline after first load (DEV)
45. Bluetooth link to a real rover (DEV; the rover firmware side is not written yet)

## The frontier wing (added on his instruction: "30+, far more niche, frontier, what-the-f*** level")

His words: "These are my ideas. I told you to come up with 30+, 10000x more niche, 1000x frontier technologies,
using the most mind-boggling technologies, and the same goes for every pixel of this website."

Eight labs, each a set of working exhibits tied to verified research (workspace ids in brackets):

- **Radio twin** [radio]: ray-traced Wi-Fi digital twin; a person in the channel fed to the real network; the
  quarter-wavelength Fresnel dither (the project's own idea); synthetic-aperture imaging through a wall;
  compressive sensing; intelligent reflecting surfaces; Wi-Fi sensing as a standard.
- **Deep scan** [deepscan]: muon tomography; quantum gravity gradiometry; ground-penetrating radar migration;
  fibre-optic distributed acoustic sensing; seismic tap location; echolocation of a void.
- **Vision lab** [vision]: search an image by words (CLIP); Segment Anything; one photo to 3-D; pulse from pixels
  and Eulerian magnification; event-camera view; short-wave infrared skin index; audio events and Whisper.
- **Search strategy** [strategy]: Bayesian search theory; information-gain "where to listen next"; Monte-Carlo
  tree search on the mission as a POMDP, measured; quantum-inspired annealing for team routing; the value of a sensor.
- **Timelines** [timelines]: fork the mission, decide differently, compare worlds; sensitivity sweeps;
  counterfactuals; regret against the best branch.
- **Model forge** [forge]: train the network in the browser; int8 for a microcontroller; pruning; calibration,
  conformal prediction and out-of-distribution detection; a spiking version; clean vs. messy simulator.
- **Structure** [structure]: collapse by rigid-body physics; test the lift; shake test; shoring; topological void
  count; vine and snake robot routes.
- **Horizon** [horizon]: cyborg-insect searchers; dandelion sensor seeds; the chemical signature of a person; laser
  vibrometry; passive radar; InSAR damage maps; Rydberg and diamond sensors; phones as beacons; legged carriers;
  Earth foundation models.

## Non-negotiables

- Never claim a real-world result. Every machine-learning number comes from simulated people (see `FACTS.md`).
- No dead controls, no console errors, no layout that breaks at 1440 by 900 or 1920 by 1080.
- One design system (`STYLE.md`). No invented colours, no decorative clutter, no tiny all-caps labels.
- Do your own part completely and verify it yourself with `tools/shoot.py` before you report.
