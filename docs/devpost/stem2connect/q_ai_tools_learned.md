**The AI tools we used, and what each one contributed**

- **Claude Code (Anthropic)** wrote most of the code. One session planned the work and wrote the briefs, and command-line agents each built one part: a workspace of HOUND Command, or a piece of the rover and drone code. The briefs and reports are in `orchestration/` in the repository.
- **Codex (OpenAI)** made the textures.
- **The AI inside HOUND:** our own Wi-Fi neural network, written from scratch in NumPy; D-FINE, MobileCLIP-S0, Depth Anything V2, SlimSAM, Whisper and AST through Transformers.js; and Qwen2.5, Llama 3.2 and SmolLM2 through WebLLM. All of them are credited in the README.

**Our contribution.** Rishith came up with HOUND and built the rover. He set the goal and the design bar, tested every feature in his own browser, and decided what changed. When the word search failed in his browser, he reported it, the AI-written service worker was fixed, and the fix was checked again in the same browser (commit 6c1c03c). To keep the AI's claims honest, `docs/FACTS.md` limits it to claims backed by test results, and `tools/export_eval.py` refuses to write numbers that do not match them.

### What we learned

- **Simulated data has to be as messy as the real world.** Our first network, trained on a clean simulator, mistook 81 % of empty rooms for a person. When we added the real chip's faults (gain jumps, drift, noise, lost packets and jitter) to the training data, the false alarms fell to 11.1 %. The biggest gain did not come from a bigger model. It came from more realistic data.
- **Never trust one sensor.** A person lying perfectly still barely changes the Wi-Fi signal, so we learned to fuse Wi-Fi with radar and heat by Bayes' rule, and to treat "blind" as different from "empty".
- **Measure before choosing a model.** On 44 held-out copilot requests, hand-written rules got 36 right and the best on-device language model got 26, so the rules run by default and the model can be loaded on request.
- **Writing a neural network from scratch teaches what a framework hides.** Deriving every gradient by hand, and checking each one against finite differences, showed us exactly why each layer is there.
- **Test in a real browser, not only in scripts.** The word search passed every automated check, but it failed in Rishith's own browser because of the service worker. Since then, every change is checked in the browser it will run in.

### What we would do differently, and what we will build next

- **Record real Wi-Fi earlier.** Next comes the first live test, with one person behind one drywall wall and the rover listening, to measure the network on real signals.
- **Connect the console to the rover**, so HOUND Command shows the rover's own readings live.
- **Build and fly the drone**, with the local aviation authority's permission, so it can carry the Wi-Fi source to the far side of a wall.
- **Run the network on the microcontroller itself.** The int8 version (23,716 bytes) is ready for an ESP32.
