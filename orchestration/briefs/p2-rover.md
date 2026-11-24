# Second pass: the rover (agent 28)

I looked at your Demo at 1680x1000. The exploded view is excellent: keep it exactly as good. The reveal is the weak half.

1. **The photograph reveal looks like a blown-up phone snap on a pale floor and breaks the film.** It must land as the most moving
   beat of the chapter: this thing exists. Keep it the true photograph (no painting in, no generated pixels on the rover), but:
   - Treat it like a studio plate: in a shader or a pre-made graded copy (Python, PIL/numpy are available; write it to
     `assets/img/landing/rover-real-graded.jpg` or similar), take the wooden floor and background down to near black with a hand-made
     mask and a soft falloff, keep a pool of light around the wheels with their true contact shadow, cool the shadows, keep the rover's own
     colours. The edge of the photo must dissolve into the same dark studio floor as the model: no rectangle, no hard border.
   - Size it so the photo is not enlarged beyond its own pixels (about 60 to 70 % of the frame height), and place it so the subject
     stands exactly where the model stood, same size, same angle: match-move the model's final pose to the photo first, then dissolve
     model to photo on a slow sweep of light (left to right, about 2.5 s). The viewer should feel the render become real.
   - The compare handle ends in the middle of the rover (model on the left half, photograph on the right half), draggable, with the
     two small labels. Then it can rest there. Never park it where one side is empty.
2. "Take it apart again" is a plain `.btn`, not blue: the one blue button on screen belongs to the dock.
3. Caption stays: "This one is real." / "Built by students. Driven from a laptop over Wi-Fi."
4. Check at 1440x900 too. Label leaders must never cross the headline block.

Screens wait their turn for a browser; use few, well-chosen screenshots. Update your report with what changed.
