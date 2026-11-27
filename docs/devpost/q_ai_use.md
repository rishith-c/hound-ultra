**A Wi-Fi neural network written from scratch.** It is a 1-D convolutional network with 23,372 parameters, written in NumPy, with every gradient derived by hand. It reads ten seconds of Wi-Fi channel readings on 51 subcarriers and answers two questions: is someone behind the wall, and are they moving? It takes 0.22 ms per window and runs on a Raspberry Pi or in the browser.

**The decision that made it work.** No dataset of people behind walls exists, so we built 900 people in Blender and simulated the Wi-Fi channel around each of them. Then we trained the network on the real chip's faults, which cut the false alarms from 81 % to **11.1 %**. On 955 held-out windows it finds **86.9 %** of moving people (AUC 0.941). The best hand-written rule finds 44.9 % at the same false-alarm rate (simulated signals).

**Five more models, all in the browser:** D-FINE, MobileCLIP-S0, Depth Anything V2, SlimSAM and Whisper. There is also an on-device copilot, and nothing leaves the laptop.

**A person checked the AI's work.** Claude Code wrote most of the code from written briefs. When Rishith ran the word search in his own browser, it failed. The AI-written service worker was blocking the model download. We fixed the service worker, kept the search code and checked again: "a red jacket" found its best match at 0.94 (commit 6c1c03c).

The full details are in sections 3 and 6 of the project story.
