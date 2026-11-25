# The buried room

The first shot of the film, the shot after the first black, and the shot on "One question". One room, seen from the floor under a table:
the ceiling comes down, the table holds, the light goes out; daylight finds the cracks; at night a searchlight does.

Nothing here is a real place or a real event. Every use in the film carries the tag Simulated.

- `ph_get.py`, `ph_get2.py` fetch the materials and furniture: [Poly Haven](https://polyhaven.com), all CC0.
- `buried.py sim` builds the room, breaks the ceiling into 717 pieces and lets them fall (Blender's rigid bodies), and saves `fall.blend`.
- `look.py` is the light, the dust, the materials and the camera; `guides.py` gives the denoiser clean guides from a second layer without dust.
- `go.sh` draws all 354 frames with Cycles (path tracing, motion blur, real depth of field): the first shot at 3840 × 1608, the dark dusty shots partly at
  2880 × 1206 and scaled up in 16 bits (49 to 58 dB from the full size, measured). `guard.py` is the worker: two run at once, each closes Blender every
  eight frames and stops before the memory of the machine runs low. Finished frames are kept, so it can be stopped and started again.
- `assemble.py` makes the three clips.

Blender 5.2. The blend file and the pictures are not in this repository.
