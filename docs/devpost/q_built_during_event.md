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