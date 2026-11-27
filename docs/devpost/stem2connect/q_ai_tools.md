**The AI tools we used, and what each one contributed**

- **Claude Code (Anthropic)** wrote most of the code. One session planned the work and wrote the briefs, and command-line agents each built one part: a workspace of HOUND Command, or a piece of the rover and drone code. The briefs and reports are in `orchestration/` in the repository.
- **Codex (OpenAI)** made the textures.
- **The AI inside HOUND:** our own Wi-Fi neural network, written from scratch in NumPy; D-FINE, MobileCLIP-S0, Depth Anything V2, SlimSAM, Whisper and AST through Transformers.js; and Qwen2.5, Llama 3.2 and SmolLM2 through WebLLM. All of them are credited in the README.

**Our contribution.** Rishith came up with HOUND and built the rover. He set the goal and the design bar, tested every feature in his own browser, and decided what changed. When the word search failed in his browser, he reported it, the AI-written service worker was fixed, and the fix was checked again in the same browser (commit 6c1c03c). To keep the AI's claims honest, `docs/FACTS.md` limits it to claims backed by test results, and `tools/export_eval.py` refuses to write numbers that do not match them.
