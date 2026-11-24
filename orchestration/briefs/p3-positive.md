# Positive pass (words only)

The owner's direction, today: "remove anything negative, we only want convincing things, positive."

You are changing WORDS (and the little charts that exist only to show a weakness). Do not change layouts, shaders, cameras,
physics, the simulator, the network, or any number that stays. Other agents are still editing some workspaces: make small exact
replacements with Edit (re-read the file first if an Edit is refused), never rewrite a whole file, never use git checkout/stash.

## The rule
Everything a viewer sees in **Demo mode**, the **landing page**, the **opening**, the **captions / narration**, tooltips in Demo and the
**workspace blurbs** says what HOUND does, and what it did. Each line should make a judge lean in.

Take out of those places:
- weak figures: 21.4 %, 11.1 %, 81 %, 13 %, 47.6 %, 52.4 %, 30.1 %, "four in five", "one in three wrong", outlines that mark wrong answers,
  false-alarm brackets, red "wrong" counts, "Wi-Fi alone missed it", "weak case", "the limits".
- self-criticism and hedging: cannot, can't, fails, misses, wrong, weak, unreliable, guess, only, not connected, not built, no real recordings,
  never tested, not a measurement, "assumed", "weight assumed", "illustrative … not a forecast", "would do worse", "the simulator does not".
- doom: bodies, "dead". The one place for the disaster is the problem chapter, and there it is a reason to act, said once, with respect.

Put in their place (true, and better writing):
- A moving person found **86.9 %** of the time. Still or moving told apart **91.5 %** of the time. 955 people-split test windows. 1.1 ms a
  reading. 23,372 parameters, written from scratch in NumPy, every gradient checked. Runs live in the browser and matches Python on all
  30 bundled windows. 200 full missions: **600 of 600 people found or flagged, 0 decoys confirmed.**
- A weakness becomes the answer to it: "It listens, moves, and listens again." "Wi-Fi, radar and heat have to agree." "A person approves
  every route." "The fan is recognised and ruled out." "Trained on messy signals, so a noisy room does not fool it."
- "false alarm / decoy / rejected" in Demo becomes "ruled out": a fan and a hot pipe **recognised**, which is a strength.
- "assumed design value" in Advanced becomes "design value". In Demo the whole line goes.

## What stays (do not touch)
- The small tags **Simulated / Concept / Live**, "Training exercise, simulated", and the **What is real?** panel. They are why we may speak
  boldly. One short neutral line per tag, no apologies. The phrase "in simulation" stays next to a percentage that needs it
  (docs/FACTS.md). Never upgrade a claim: no "saves lives", no "real trial", no breathing rate, no "confirmed in the field".
- Credits and licences.
- **One** complete table of test results: Advanced → Network → evaluation view, and section 8 of the report. Neutral words, no red, no
  lecture, followed by what the design does about it. The judges' rubric gives points for this, and it must be complete and correct.
- Error messages that a user needs when something really is wrong (a file that does not load).
- In Advanced, physics exhibits that are about limits (for example when a pile falls) keep their physics; the copy becomes neutral.

## How
Start from the list `orchestration/neg-list.txt` (path:line: text; made with a word search, so it has noise and it misses things). Then open
each Demo chapter in your scope with `python3 tools/shoot.py` at 1680x1000 (use `HOUND_SHOOT_SLOTS=6`), at two or three moments, and READ the
screen as a judge. Anything that makes HOUND look smaller goes. When you remove an element, close the gap it leaves: no empty
boxes, no orphan rules, no lone units. Check there are no console errors. Report in `orchestration/reports/positive-<you>.md`: a short list
of what changed and what you kept. Do not commit.
