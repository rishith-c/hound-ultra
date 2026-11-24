# Style: one product, one look

The feel: a mission-control workstation crossed with Tesla's driving visualisation. Dark, calm, precise. The 3-D
world is the hero; panels are quiet instruments around it. Nothing shouts except a person being found.

## Rules

1. **Use the tokens** in `app/ui/tokens.css` and the classes in `app/ui/base.css` (`.btn`, `.panel`, `.tag`, `.kv`,
   `.seg`, `.table`, `.note`, `.stat`, `.glass`, `.bar`, `.input`, `.check`). No new colours; no hex codes in your CSS
   except inside 3-D shaders and data ramps (and then start from the token values).
2. **Colour means something.** Orange-red `--person` is only for people and confirmed finds. Amber `--warn` is
   "possible / needs a look". Blue `--accent` is interactive things and routes. Green `--ok` is clear and done.
   Red `--danger` is hazards and stop. Violet `--sim` is the "simulated / concept" label. Colour is never the only
   signal: add a word or an icon.
3. **Type.** System font (`--font`). Sentence case everywhere. **No all-caps labels, no letter-spaced kicker
   text above headings, no monospace headings.** Monospace (`.num`) is for numbers that change. Smallest text 11 px,
   and only for secondary labels; body is 13 px in panels.
4. **One primary action per view** (`.btn-primary`): the thing the operator should do next. Everything else is a
   plain `.btn` or `.btn-ghost`. Destructive or stopping actions use `.btn-danger` and confirm first.
5. **Density with order.** Group related things in panels with a short title. Align numbers right. 4 px grid
   (`--s-*`). Rounded corners from `--r-*`. Panels float over the 3-D view as `.glass` where they overlap it.
6. **Motion.** Fast and physical: 120 to 220 ms, `--ease`. Things enter from where they came from. No bouncing
   decoration. Everything animated must stop under reduced motion and when the workspace is hidden.
7. **Show relationships.** If two things are related (a finding and its evidence, a route and the hazards it avoids,
   a setting and its effect), put them side by side or draw the link. Selecting something anywhere highlights it
   everywhere (`ctx.select`).
8. **Explain in plain words.** Every workspace opens with one sentence saying what it is for. Every chart has a
   title that states its point and labelled axes with units. Abbreviations are spelled out on first use.
9. **States.** Loading (say what is loading), empty (say what to do), error (say what went wrong and what to try),
   success. Never a blank panel.
10. **Reality labels** on every workspace header and on any feature that differs (see `ARCHITECTURE.md`).
11. **Review at desktop sizes only**: 1680×1000 and 1440×900 (and it should not break at 1920×1080). Do not
    design or test phone layouts.

## 3-D look (twin, scan, globe, network anatomy)

- Physically based materials, soft shadows, tone mapping (ACES), a little fog for depth, ambient occlusion and a
  restrained bloom only on emissive signals (a detection, a route, a scan line). No lens flares, no neon overload.
- Palette of the world: graphite ground, concrete greys, silver rover; the only saturated things are people
  (warm orange-red), routes (blue), hazards (red hatch), scan lines (cool white-blue).
- Detail everywhere you look: wheel rollers, rubble pieces, cracked slabs, door frames, cables, dust in a light
  beam. Instancing keeps it fast. Aim for 60 frames per second on an M-series MacBook at 1680×1000.
- The camera moves like a film camera: eased, never snapping, never static for long; it frames the story (follows
  the rover, pulls back for the route, pushes in on a find). The user can always take control.
- Text never sits on top of the subject. Labels are leader-lined, small and legible.

## Charts and data

Use d3 or plain canvas. Start from the tokens: one hue per meaning, direct labels instead of legends where you can,
thin gridlines (`--line`), tabular numbers. A chart must make one point and its title says what the point is.
