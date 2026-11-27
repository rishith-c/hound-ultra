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

The full table of every model, its measured result and where it fails is in section 6 of the project story.