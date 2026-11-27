**Setup.** Open [hound-command.vercel.app](https://hound-command.vercel.app) in Chrome on a laptop. It needs no install and no account. Press **Open the console**, then **Watch the demo** (about five minutes). For the robot code, which needs Python 3.12 and NumPy, run `python3 robot/sim/cases.py` to rerun all 99 cases.

**The main task.** Start from a building nobody can see into and end with a ranked list of rooms and a safe route to each person. A good result confirms or flags every hidden person, never clears a room with someone in it and never calls an empty room a person.

**Test cases.** The result tables are in sections 4 and 5 of the project story and in docs/ROBOT_RESULTS.md. The console's System check runs the fault drills live.

**Good to know.** The results are measured in simulation over the real terrain of Timure, Nepal. The drone is a design, and the concept workspaces are tagged in the console.

**External dependencies.** three.js, d3, Rapier, Transformers.js and WebLLM load in the browser, and the in-browser models download once from Hugging Face. It needs no accounts, keys or paid services.

**Where to look.** Film: https://youtu.be/CD6toHreojU · Console: https://hound-command.vercel.app · Code: https://github.com/rishith-c/hound-ultra
