# Style: one product, one look

The feel: a mission-control workstation crossed with Tesla's driving visualisation. Dark, calm, precise. The 3-D
world is the hero; panels are quiet instruments around it. Nothing shouts except a person being found.

**See everything, live, in every state: `app/ui/reference.html`** (http://localhost:4391/ultra/app/ui/reference.html).
Read it before you build. If a component you need is there, use it; do not draw your own.

## Rules

1. **Use the tokens** in `app/ui/tokens.css` and the classes in `app/ui/base.css`. No new colours; no hex codes in
   your CSS except inside 3-D shaders and data ramps (and then start from the token values).
2. **Colour means something.** Orange-red `--person` is only for people and confirmed finds. Amber `--warn` is
   "possible / needs a look". Blue `--accent` is interactive things and routes. Green `--ok` is clear and done.
   Red `--danger` is hazards and stop. Violet `--sim` is the "simulated / concept" label. Colour is never the only
   signal: add a word or an icon. Each hue has a `-soft` fill and a `-line` border (`--person-soft`, `--person-line`).
3. **Type: three voices.**
   - `--font-display` Instrument Serif: workspace titles, headlines, big static numbers. One weight (400). Never
     bold it; use the italic for one word of emphasis. `h1`, `h2`, `.display`, `.title`, `.heading`, `.figure`, `.stat b`.
   - `--font` Instrument Sans: everything you read or press. 400 text, 500 controls, 600 panel titles (`h3`).
   - `--mono` Geist Mono (`.num`): numbers that change, clocks, coordinates, code. Never headings.
   - The serif's digits are not tabular. A number that ticks many times a second goes in `.num` or `.stat.live`.
   - Sentence case everywhere. **No all-caps labels, no letter-spaced kicker text above headings, no monospace
     headings.** Smallest text 11 px, and only for secondary labels; body is 13 px in panels.
   - Ready-made roles: `font: var(--type-title)` (also `-hero -display -heading -figure -panel -body -label -data -caption`).
4. **One primary action per view** (`.btn-primary`): the thing the operator should do next. Everything else is a
   plain `.btn` or `.btn-ghost`. Destructive or stopping actions use `.btn-danger` and confirm first. Toggles carry
   `aria-pressed`; the style follows the attribute.
5. **Density with order.** Group related things in panels with a short title. Align numbers right. 4 px grid
   (`--s-*`). Corners are tight: `--r-1` 2 px tags, `--r-2` 4 px controls, `--r-3` 6 px panels, `--r-4` 10 px dialogs.
   Panels float over the 3-D view as `.glass` (or `.panel.glass`) where they overlap it, and nowhere else.
6. **Depth.** Surfaces step up from `--bg-0` (viewport, wells) to `--bg-5` (pressed). Raised things get the 1 px top
   highlight (`--shadow-0`); inputs and tracks are wells (`--well`). No glow for decoration, no gradients for decoration.
7. **Motion.** Fast and physical: `--t-fast` 120 ms, `--t-med` 220 ms, `--t-slow` 420 ms, `--ease`. Things enter from
   where they came from. No bouncing decoration. Everything animated must stop under reduced motion and when the
   workspace is hidden. Use the duration tokens and reduced motion is handled for you (they become 0 ms).
8. **Show relationships.** If two things are related (a finding and its evidence, a route and the hazards it avoids,
   a setting and its effect), put them side by side or draw the link. Selecting something anywhere highlights it
   everywhere (`ctx.select`). Selected rows, cards and list items all use the same look: accent wash and a 2 px
   accent bar on the left (`aria-selected="true"`).
9. **Explain in plain words.** Every workspace opens with `.ws-head`: its title, one sentence saying what it is for,
   its reality label. Every chart has a title that states its point and labelled axes with units. Abbreviations
   are spelled out on first use. Write what a rescuer would say: "Person confirmed, room 104", "Approve route".
10. **States.** Loading (say what is loading: `.spinner`, `.skeleton`, `.bar.indeterminate`), empty (say what to do:
    `.empty`), error (say what went wrong and what to try), success. Never a blank panel.
11. **Reality labels** on every workspace header and on any feature that differs (see `ARCHITECTURE.md`). The tag's
    marker carries the meaning too: a solid square is real or live, a hollow square on a dashed, hatched ground is
    simulated or concept. Simulated or concept content may sit on `.hatch`.
12. **Accessibility is part of the look.** Text is at least 4.5 : 1 (the reference page measures it live). Do not
    remove focus rings. Check your workspace with high contrast and the colour-blind palette on (the switches are on
    the reference page and write the same preference the console reads).
13. **Review at desktop sizes only**: 1680×1000 and 1440×900 (and it should not break at 1920×1080). Do not
    design or test phone layouts.

## Components (all in `base.css`, all shown on the reference page)

| Need | Use |
|---|---|
| Actions | `.btn` `.btn-primary` `.btn-danger` `.btn-ghost` · sizes `.btn-sm` `.btn-lg` `.btn-icon` · `.btn-group` |
| Pick one / filter many / on-off | `.seg` · `.chip` · `.check`, `.check.switch` · `.tabs` |
| Text and number input | `.field` `.input` `.select` `textarea.input` · `.slider` (set `--p` for the fill) `.slider-row` |
| Containers | `.panel` `.panel-head` `.panel-body` `.panel-foot` · `.card` · `.glass` · `.toolbar` · `.crop` · `.hatch` |
| Labels | `.tag` + `-person -warn -ok -danger -accent -sim` · `.status` · `.badge-count` · `kbd`, `.kbd-hint` |
| Data | `dl.kv` · `.stat`, `.stat-row` · `.table` (`th.num`, `td.num`, `aria-selected`) · `.list`, `.list-item` |
| Levels | `.meter` (`--v` 0..1, `.meter-wrap` `--mark` for a threshold) · `.bar` · `.meter-row` |
| Explaining | `.note` + `.warn .danger .ok .info .quiet` · `.tooltip` or `data-tip="…"` · `.empty` |
| Charts | `.axis` `.axis-title` `.gridline` `.series-label` `.chart-title` `.chart-note` · `.legend` |
| Layout | `.row` `.col` `.grow` `.wrap` `.between` `.end` `.tight` `.loose` · `.divider` · `.ws-head` |
| Icons | `ctx.kit.icon(name, size)`, 117 names, listed on the reference page |

## Brand

`assets/brand/`: `hound-mark.svg`, `hound-mark-small.svg` (below 28 px), `hound-wordmark.svg`, `hound-lockup.svg`,
`-ink` versions for light backgrounds, `hound-app-icon.svg`; brand sheet at `assets/brand/index.html`. The mark is
an H made of two walls and one warm dot between them: a person, found. The dot is always `--person`. Do not
recolour, outline or rotate the mark.

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
thin gridlines (`--line`), tabular numbers in `--mono`. A chart must make one point and its title says what the
point is. Canvas text: `ctx.font = '500 11px ' + kit.cssVar('--mono')`.

## Demo mode: the film version

Demo is the version a judge sees first. Compose it like a frame from a film, not a dashboard.

- One subject. Everything else dims, shrinks or leaves. Leave 40 % of the frame with nothing but the world in it.
- Depth: foreground, subject, background. Light from one side. Real materials, contact shadows, haze that separates
  planes. Fine detail that survives a zoom (rivets, cracks, cables, grain), never a flat coloured box.
- Motion you can follow: one slow camera move, one clear event, one held beat at the end where the answer is readable.
  Eased in and out, nothing bounces, nothing pops. Target 60 frames a second; measure it.
- Text sits in the lower left third, never on the subject: serif headline up to 40 px, one line of Instrument Sans.
- Colour stays rare. The frame is graphite, concrete, mud and steel; the person is the only warm thing in it.
- Moments worth a screenshot: the instant a weak signal becomes a person, a wall turning to glass as radio passes
  through it, the route drawing itself around a hazard. Build to one such moment and hold it.
