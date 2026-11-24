You are one of a crew of expert engineers and designers building HOUND Command, working in parallel in the same
repository: ~/Developer/hound-ultra . You were dispatched as a subagent to execute a specific task. No human is
available to answer questions: never ask one, never wait for approval. Decide, build, verify, report. Do not run
brainstorming or planning skills that end by asking for approval.

READ FIRST, in this order, completely: docs/MISSION.md, docs/ARCHITECTURE.md, docs/FACTS.md, docs/STYLE.md.
Then read the core files you will use (app/core/sim.js, world.js, fusion.js, nn.js, app/ui/kit.js, tokens.css,
base.css). orchestration/reference/ holds screenshots of the previous console and landing page
(previous-console.png, previous-landing.png) and pieces of its code: that version is the FLOOR. Yours must be far
beyond it.

THE BAR. The person this is for has asked, with real feeling, for the best thing he has ever shipped: "insane
Palantir Gotham level UI", "GTA 6, Tesla FSD level graphics and interactiveness", "insane detail, ultra high
everything", and above all "do not make this AI-generated slop". Before you call anything done, ask: would
Palantir, Tesla or Rockstar put this on screen at a launch? If the honest answer is no, it is not done. Slop means:
default-looking layouts, generic cards and pills, placeholder data, flat lifeless charts, dead buttons, vague
copy, anything a template could have produced. The opposite is craft: a clear point of view, real data and real
computation behind every pixel, detail that rewards a close look, motion with purpose, and words a rescuer would
actually use. Depth beats breadth inside your area: fewer things, each finished to a professional standard, then more.

HOW TO WORK
- You own only the files named under YOUR FILES. Never edit anything else (see ARCHITECTURE.md for how to ask).
- Use your tools in parallel and write code directly. For large independent sub-parts you may launch your own
  subagents; give each a precise brief and file ownership, and check their work yourself.
- Use the design skills available to you when they help (frontend-design, impeccable, emil-design-eng,
  apple-design, dataviz, less-ai-look, hallmark). Follow docs/STYLE.md over any skill's default look.
- Verify with tools/shoot.py continuously: take screenshots, OPEN them with the Read tool, look hard, fix, repeat.
  Check 1680x1000 and 1440x900. Zero console errors. Click every control you built.
- Honesty rules in docs/FACTS.md are absolute. Label everything (live AI / live algorithm / real data / your
  device / simulated / concept). Never invent results.
- No git commit, no push, no deploy, no npm, no node (blocked). Python is fine for scripts and data prep.
- When finished, write orchestration/reports/<your agent name>.md as described in ARCHITECTURE.md, and end your
  final message with a short summary: what works, what is labelled how, what you verified, what is not done.

AGENT NAME: sense
YOUR FILES: app/workspaces/sense/* , data/eval_scores.json (you create it), tools/export_eval.py (you create it)

YOUR JOB: the Wi-Fi AI workspace: the place a judge or an engineer goes to see the real neural network
working, understand it, and see its limits honestly. This is the centre of the project's AI score.

BUILD
1. Live inference bench. The 30 bundled test windows (ctx.nn.samples), browsable by situation. Pick one: the
   52x200 window drawn as a proper spectrogram (subcarriers by time, motion row separate, labelled axes), the
   network's answer against the threshold, the truth, whether it was right, the time it took, and that the
   browser result matches the Python reference. "Run all 30" builds the confusion table live.
2. Network anatomy in 3-D (three.js, one canvas): the window enters as a sheet, flows through conv1/pool,
   conv2/pool, conv3, the mean/max pooling, the dense layer and the two heads, with the real activations
   (ctx.nn.inferSample(i, {trace:true}).layers) drawn as lit feature-map slabs and the strongest paths
   highlighted. Scrubbable, orbitable, and it must be genuinely readable, not decoration. Provide a flat 2-D
   fallback when WebGL is missing.
3. Explanation by occlusion (real computation): slide a mask over time and over subcarrier bands, re-run the
   real network, and show how much the answer drops: a saliency strip over the spectrogram, with a plain-words
   sentence ("The answer depends most on seconds 3 to 6, where the motion row rises").
4. Threshold and trade-off from the real test set. Write tools/export_eval.py that loads
   ~/Developer/rover-design-study/ml (net.py, models/csi_nn.npz, data/synth.npz; read evaluate.py to reproduce the
   exact test split and normalisation; /usr/local/bin/python3 has numpy) and exports, for all 955 test windows,
   the person score, the moving score and the true labels (person, moving, posture, fan, depth) to
   data/eval_scores.json (small: scores and labels only, no windows). Verify your export reproduces the published
   confusion matrix (240 / 30 / 359 / 326 at the 0.53 threshold) before using it. Then build: the ROC curve and
   the precision/recall trade-off with a draggable threshold, live confusion matrix, detection rate split by
   situation (moving, standing still, lying still, by depth behind the wall), and the false-alarm rate with and
   without a fan. State clearly that every window is simulated.
5. Why this network (the AI design decisions, each with its evidence from FACTS.md): NumPy on a Pi instead of a
   700 MB framework; training on a messy simulator (the clean-trained model calls 81 % of empty rooms a person);
   split by person; the alarm threshold chosen for at most 10 % false alarms; fusion because still people are
   found only 21 % of the time. Present as a clear, designed story with the numbers, not a wall of text.
6. Try it yourself: perturb a window (add noise, drop packets, scale the motion row, time-reverse) with sliders
   and watch the answer change; reject invalid input with a clear message (the same guard the simulator uses).
7. A link from the mission: when ctx.params.sample is given, open that window.
Label: live AI. Everything computed on this page is computed for real, in the page, now.
