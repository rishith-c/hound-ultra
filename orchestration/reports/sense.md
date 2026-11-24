# Wi-Fi AI workspace (agent: sense)

## What was built

**Demo** (`hero.js`, `hero.css`, `attribution.js`). One full-bleed 3-D set. A real 10-second window (52 rows by 200 time
bins) is a relief of 10,400 steel pins. A scan head reads it, the real activations of every layer rise behind it in
turn, threads carry the strongest weight x input products, and the answer comes out of a concrete wall as
letters cut from the brand serif, filled to the score against the alarm line. On an alarm, warm light runs back to the
pins that pushed the answer towards "person" (gradient x activation by back-propagation). It plays five windows by itself,
8.8 s each: moving (right), empty (right), fan (right), standing (right), lying (a miss, stated plainly: "Wrong, a miss").
Stepper for the five situations (press again for the next window of that kind), pause, drag / wheel / arrow keys to
orbit, hover a pin for its value and its push on the answer. Without WebGL the same story plays over the flat 2-D view.

**Advanced** (`bench.js`, `anatomy.js`, `fastnet.js`, `evalview.js`, `story.js`).
- Bench: 30 bundled windows, spectrogram with a separate motion row, answer, truth, time, match to Python, Run all 30 with
  a live confusion table, 3-D network anatomy (scrub, play, orbit, hover, flat fallback), occlusion explanation by real
  re-runs, and "Try to break it" (noise, lost packets, motion scale, play backwards, corrupt value) with the rover's guard.
- Test set: 955 held-out windows, ROC, precision / recall, draggable threshold, live confusion, splits.
- Why this network: five decisions with evidence and a caveat each.
- `tools/export_eval.py` writes and re-checks `data/eval_scores.json`.

`ctx.open('sense', { sample: n })` opens window n in either mode; an unknown n shows a message. `root.senseHero()` is a
hook for the automated checks (seek, hold).

## Labels
- Workspace: **Live AI**. All forward passes, occlusion, back-propagation and timings run in the page.
- **Simulated**: every window. Stated in the Demo title block, the Advanced header, the test view and the decisions view.
- The 10 % prior and the radar / thermal ratios in the decisions view are marked assumed.

## Measured and verified
- Export reproduces 240 / 30 / 359 / 326, 86.9 / 21.4 / 25.5 / 12.4 %, 7.9 / 13.0 %, 91.5 %, and the clean-trained 52 / 218 / 15 / 670
  (by running the script). The file is re-read and both tables recomputed.
- Run all 30: 20 right, 30 of 30 match Python (seen on screen, earlier in the work). Fast loop against `ctx.nn.infer`: largest difference 0.
- Back-propagation: 300 input gradients over 5 windows against central differences (step 1e-3), and the dense shares
  plus bias against the log-odds: worst difference 8.3e-5.
- Demo: 60.0 fps over 9 s, worst frame 16.8 ms, across a window change (headless Chrome, 1680x1000, pixel ratio 1).
  Advanced bench: 60 fps at 1440x900 and 59.3 (worst 33.4 ms) at 1680x1000, just after a window change.
- Looked at: Demo at 1680x1000, 1440x900, 1920x1080; bench, test and decisions views at 1440x900; bench and test at 1680x1000
  (decisions at 1680x1000 earlier in the work). No console errors in any run.
- Operated in Demo: stepper (Fan, Lying), drag orbit, hover tip, pause button, and wheel plus arrow key (together: the camera moved), mode switch both ways (the hero stops and resumes), hidden
  workspace stops the loop, reduced motion (final frame, camera still), WebGL missing, first mount with
  `sample`, unknown sample message.
- Operated in Advanced: Play, hover tip, time mask with a live re-run, motion slider, Play it backwards,
  Reset, "How?", `sample` while mounted, orbit drag (turn limited so labels stay beside the terraces); the panels that used to scroll at 1440x900 fit, and Match is fully visible.
- Reported by the subagents that built them and not repeated by me: threshold drag and keys in the test view, and
  the buttons in the decisions view.

## Known gaps
- Not checked on a pixel-ratio-2 display: the pixel ratio starts at up to 1.75 and steps down by itself if frames run slow.
- Mouse hover on the right-hand band strip of the bench was not exercised (the keyboard band mask was).
- At a wide orbit the Advanced 3-D view can run past the edges of its panel and the "0.83" label meets its pillar; Reset view restores it.
- With "How?" open the explanation panel scrolls.
- Warm light marks positive gradient x activation, scaled per layer. It is a first-order share, not proof of cause;
  occlusion in Advanced is the stronger test.
- The mask read-out covers part of the top saliency strip. Dots in the test view are mouse-only. Story chart details are tooltips.
- The shell does not read `?sample=` from the address; only `ctx.open` carries it.

## For the Devpost write-up
"HOUND's 23,372-parameter network runs live in the page: you watch ten seconds of simulated Wi-Fi pass through every layer, and
the answer lights back along the exact signals that caused a higher score. Every bundled window matches our Python reference, and
you can hide, corrupt or reverse the signal and the real network answers again. On 955 held-out simulated windows
it finds 86.9 % of moving people but only 21.4 % of still ones, and the page says so."
