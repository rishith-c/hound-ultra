# Second pass: the landing page (agent 15)

I looked at all of it at 1680x1000. The opening scroll film (valley, school, corridor, rover) is superb: keep it. The rest must reach that level.

1. **No eyebrow labels, anywhere.** Every section starts with a small row like "02  HOUND, the rover  [Real hardware]" above its headline. The owner
   never wants a small label or number above a heading. Remove the number and the label from all sections (also the login page). Keep the reality tag,
   but put it under the headline block, beside the first line of text. Keep anchors and the top navigation working.
2. **The rover section uses the older CAD model** (grey deck, green blocks, red buttons). It looks like a different, cheaper product than the rover chapter,
   which has a hyper-real studio model made from 241 real parts: `app/workspaces/rover/` (studio.js, and `assets/models/rover_parts.bin`). Reuse that studio and
   model here (import its modules; do not edit them), lit the same way, slowly turning, coming apart a little as the text advances. Drop the "Older CAD
   model" line when the older model is gone. If its module cannot be embedded cleanly, use a pre-rendered sequence captured from the rover chapter.
3. **Length.** The page is 21,000 px. Aim for 12,000 to 14,000: keep the film, the rover, the live network, its true numbers, the live mission, what is real, what existed
   before / built this week, and the ending. Cut or fold the rest: the long evidence table can show the step chart and only its last rows; the workspace list
   becomes two columns of names with one large preview.
4. There is a tall, almost empty black stretch before "The workspaces" (around y = 14,400). No empty screens: each viewport of scroll shows something.
5. The floor photograph of the rover appears on a pale background on a black page. Use the graded one when it exists (agent 28 is making
   `assets/img/landing/rover-real-graded.jpg`); until then darken it in CSS so it sits in the page.
6. Buttons and corners stay square-ish (2 to 4 px). Nothing round, nothing bouncy.
7. Do not re-run `capture.py` yourself: the orchestrator re-shoots every workspace preview at the very end. Reserve the boxes.
8. Check 1440x900, 1680x1000 and 1920x1080. 60 fps while scrolling. Zero errors. Update your report.
