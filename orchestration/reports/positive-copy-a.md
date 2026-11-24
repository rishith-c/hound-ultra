# Positive pass, scope A (29-copy-a)

Scope: mission, sense, forge, fusion, evidence (the workspace is `graph`), report, structure, horizon, strategy, timelines, triage,
train, deepscan, globe, status. Nothing committed. Mission startFind, frameFind, find and closed were not touched.

## For the orchestrator first: System check shows real failures

Left visible, not reworded. By the end of the Demo run so far (28 s) it shows 48 failed checks.

- **47 in "200 random routes against an independent solver".** I ran the test on its own: same 47. All are "within 1.08 of the
  optimum"; none in "nothing hit" or "same best price". Worst route is 4.524 times the optimum price. So the A* price agrees, but the
  path handed back (after smoothing, I believe; not traced) costs more than the search said.
- **1 in "Input of the wrong shape".** By lamp position it is "one short row in the middle". `app/core/nn.js:56` checks only the
  length of row 0, so a short row later gets an answer. I read the code; I did not run that case alone.
- `app/core` has no uncommitted diff, so no wording edit caused either. The page title is "Proof, not promises".

## Changed

- **Mission.** Alerts, inspector, stepper, 2-D map and the way-in caption: neutral words, "design value".
- **Sense.** A window the network gets wrong now leads to the next step (listen again, radar and heat) and still states the true
  situation. Test set: neutral words, no red, all numbers kept.
- **Forge, fusion, report, structure, horizon.** Captions and headings; report section 8 is "Test results" with every figure.
- **Evidence (graph).** Demo line "said no, three times ... outvoted it" is "Micro-motion and thermal decided it: 95 %". The Wi-Fi
  readings (x0.59, x0.77) stay on the right. The note now gives only the Wi-Fi weight's source.
- **Deepscan.** Six "Cannot ..." lines became what each method is best at; states read "Not seen" / "Not covered". That line's colour
  went from amber to neutral (one CSS line).
- **Triage, train, timelines, strategy, globe.** Captions, operator card, lessons, exhibits. "Assumed" is "design value".
  A strategy search that runs out reads "Time is up, 20 minutes", so it cannot be read as a find.
- Colour changes beyond words: `sense/eval.css` (3 rules), one canvas colour in `sense/evalview.js`, `paper.css`, deepscan.

## Where I pulled back wording, mine or the brief's

- "Wi-Fi, radar and heat have to agree" is not used: fusion weighs readings, and Room 103 reaches 95 % with Wi-Fi against.
- Drill film keeps "It must ...": it states the demand, the engine shows the result.
- Way-in caption and Test set note: approval is not described as already done by a person, because Demo autoplay gives it.
- Operator card says a quiet Wi-Fi reading does not clear a room. Amber in System check is still called a limit.

## Kept on purpose

- Tags, "in simulation", What is real (ledger, real untouched by me; both already had other edits), licences, safety and medical notes.
- Report: "treat as not cleared", residual chance, autoplay approval. Timelines: reached counts per world, "Thermal camera fails"
  (that name is also baked into `braid.json`).
- Forge Advanced "What would have to be true" notes and other Advanced physics limits. "False alarms" as a technical term in smell.

## Effect to know about

- With these edits a judge in Demo sees no still-person figure except on the report's Test results page; the full table is
  in Advanced, Wi-Fi AI, Test set. Training's printed operator card no longer gives the 21 % and 11 %; the lesson chart still shows its rows.
- Agent B dropped a Demo miss in aerial for the same reason (see positive-copy-b.md). The omissions add up across scopes.

## Checked

- shoot.py 1680x1000, 4, 14 and 28 s, all 15 Demo pages: ERRORS 0. I read 32 of those 45 screens and re-shot graph and
  timelines after late edits.
- Not seen on screen: mission's find and closing scenes, the timelines result caption, deepscan tabs other than Muons, globe valley,
  strategy's time-up case, train debrief.
- Advanced: ERRORS 0 on sense (Bench, Test set), report, train, triage, deepscan, graph, fusion, strategy, forge, horizon. Read on screen:
  sense and the report cover only.
