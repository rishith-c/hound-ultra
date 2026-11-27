**A Wi-Fi neural network written from scratch.** It is a 1-D convolutional network with 23,372 parameters, written in NumPy, with every gradient derived by hand. It reads ten seconds of Wi-Fi channel readings on 51 subcarriers and answers two questions: is someone behind the wall, and are they moving? It takes 0.22 ms per window and runs on a Raspberry Pi or in the browser.

**The decision that made it work.** No dataset of people behind walls exists, so we built 900 people in Blender and simulated the Wi-Fi channel around each of them. Then we trained the network on the real chip's faults, which cut the false alarms from 81 % to **11.1 %**. On 955 held-out windows it finds **86.9 %** of moving people (AUC 0.941). The best hand-written rule finds 44.9 % at the same false-alarm rate (simulated signals).

**Every model, measured:**

| Model | Measured |
|---|---|
| HOUND Wi-Fi network (ours) | 86.9 % of moving people found, 88.9 % of empty rooms called empty, AUC 0.941 |
| HOUND network, int8 | 23,716 bytes, 88.3 % of moving people found, bit for bit in the page |
| HOUND network, pruned | 70 % of weights cut, AUC within 0.01 |
| HOUND network, calibrated | Calibration error 9.4 % → 2.5 %; conformal coverage 89.2 % at a 90 % target |
| HOUND network, spiking | 97 % agreement with the original |
| MobileCLIP-S0 | 331 tiles in 4.3 s; "a red jacket" best match 0.94 |
| SlimSAM | 24 to 35 ms per click; slab area within 3 % |
| Depth Anything V2 | 3.9 % mean depth error |
| Whisper tiny | Language right 7 of 7 |
| D-FINE nano, AST | Live in the browser |
| Copilot (rules + WebLLM: Qwen2.5, Llama 3.2, SmolLM2) | 36 of 44 held-out requests right |

All of them run on the user's own machine, so nothing leaves the laptop.

**A person checked the AI's work.** Claude Code wrote most of the code from written briefs. When Rishith ran the word search in his own browser, it failed. The AI-written service worker was blocking the model download. We fixed the service worker, kept the search code and checked again: "a red jacket" found its best match at 0.94 (commit 6c1c03c).

The full details are in sections 3 and 6 of the project story.
