# Report: copilot (agent 10)

## Built
- **Copilot workspace** (`app/workspaces/copilot/`) and **side drawer** (`app/global/copilot-dock.js`, Cmd/Ctrl+J), one shared conversation. Each request becomes one of 19 tool calls (or is declined) and shows: who interpreted it, the call, the checks (schema, allowed now, same room, negation guard, human confirmation), the facts, then the answer. Answers are always written by code from the facts.
- **On-device model**: WebLLM 0.2.89, four small models, loaded only on request, with size, progress, cache and removal. Output is held to a JSON schema rebuilt from the live mission. A loaded model may also re-word an answer, shown below it.
- **Rule-based interpreter**, used whenever no model is loaded. Same tools, same checks.
- **Evaluation** tab (96 requests, "Run evaluation"), **Situation report** tab (facts beside the text), **Tools** tab, optional voice in and out (off by default).
- **Command palette** (`app/global/palette.js`) and **interface sounds** (`app/global/sound.js`, off by default).

## Changed in this pass
- `model-comparison.json` now exists. Its figures come from the recorded run of 23 Nov 2026 (Apple M5 Pro, headless Chrome, other programs running). Nothing was downloaded or re-run for it. Long phrasing samples are cut to 400 characters. My own one-line reading of one wrong wording per model is in `misread`.
- `llm.route` was missing, so a loaded model always fell back to the rules. Restored to the pipeline that was measured. The untested-on-unseen-data second pipeline was deleted.
- A question about a room with no lead explained a different lead (at 05:00, "Why is the lead in room 103 only possible?" explained D1, outdoors). The new "Same room" check stops this for rules and model.
- "Jump to when the first person was found" said it had happened even when an earlier all stop prevented it. It now says so.
- A layer asked for before the 3-D view existed was lost. It is now applied when Mission opens.
- Square chips and palette scopes. The situation report puts the model's paragraph below the lines. Fixed: sitrep fact wrapping, clipped score figures, legend colours, map labels under rubble, transcript not following new answers, Escape in the drawer after clicking a suggestion.

## Labels
Live AI: only when a model is loaded. Live algorithm / "Rule-based (no model loaded)": otherwise. Recorded: model scores not measured in this session. Your device: voice, with a note that this browser sends the audio to a cloud service. Simulated and Concept: units.

## Measured (exact call match, frozen mission at 07:10, nothing executed, one run)
| | Development /52 | Held-out /44 | Median | Wrong actions /96 |
|---|---|---|---|---|
| Rules | 52 | 36 (82 %, 95 % interval 68 to 90 %) | < 0.1 ms | 0 |
| Qwen2.5 1.5B | 33 | 26 | 1980 ms | 1 |
| Llama 3.2 1B | 16 | 16 | 1253 ms | 8 |
| Qwen2.5 0.5B | 15 | 12 | 735 ms | 17 |
| SmolLM2 360M | 5 | 5 | 766 ms | 4 |

- The rules were tuned on the development set. Rules and prompt were frozen before the held-out set was read.
- A second unseen set (48 requests, another author) was run once, rules only: **38 / 48 (79 %, 66 to 88 %), 1 wrong action**. The rules were not changed after it.
- The number check on re-worded answers passed 8, 8, 8 and 6 of 8. It misses misreadings (Qwen 1.5B listed room 112 as not searched), so wording is never the record.

## Verified (tools/shoot.py, screenshots opened)
- Zero console errors in Demo and Advanced at 1680x1000 and 1440x900, on the Copilot workspace. Drawer over Mission: Demo, both sizes. Palette: Advanced, both sizes.
- All nine Ask / Act / See questions in both modes and sizes; answers identical in all four. At 00:00, all but "Jump" (run at 00:00 in Demo at 1680 only, before the last edits). At 05:00, the room 103 and second-look questions. At 07:10, all but "Stop everything". At 10:48, the room 103 question; status, rooms and route also in Advanced.
- "Why is the lead in room 103 only possible?": 00:00 and 05:00 "There is no lead in room 103: not searched yet"; 07:10 D4, 58 %, confirmed at 85 %; 10:48 D4 is confirmed, 95 %.
- Route: planned with mud allowed in the planning phase; refused with the reason in other phases. Approve dialog: Escape declines, confirm approves. "Don't approve the route" is held. Collapse-zone request declined. Link drill start and end.
- Clicked: tabs, test cell, Run evaluation, sitrep, Copy, Try, follow-up chips, model row, voice and re-word switches, drawer open / Escape, palette search, Enter, Escape.

## Not done or not verified
- **No model was loaded in this pass** (brief: no downloads). The restored `route` call is the measured code renamed, but the live path (loading bar, Live AI answers, re-wording) was not run again in this version.
- The rules beat every model tested, and a loaded model replaces them. The page says so. A rules-first hybrid was not built or measured.
- Known misses: misspelt "stop evrything now!! all of them" is declined (use All stop); "turn that one off" about a drill starts it again; "send the drone up for another pass" proposes a rover second look; "all clear, lift the all-stop" is read as all stop. Frontier workspaces have no rule words; the palette finds them.
- Not checked: microphone input, speech output, the sounds by ear, the no-WebGPU message, high contrast, reduced motion, a real screen reader.
- One test run timed out in Chrome while several ran at once; the repeat passed.

## For Devpost
- "We tested four small on-device language models against our own hand-written rules on 44 requests none of them had seen. The rules got 36 right and the best model 26, so the rules run by default."
- "Every answer is written by code from the mission state. A model can re-word it, but we found re-wordings that passed our number check and were still wrong, so the re-wording is never the record."
- "The copilot can plan a rescue route, but it cannot approve one: a person always confirms."
