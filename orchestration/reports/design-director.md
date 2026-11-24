# design-director: report

## What I built

**Identity**
- A HOUND mark, wordmark and lockup, drawn as SVG in `assets/brand/` (ivory and ink versions, a small cut for
  under 28 px, an app icon) and a brand sheet at `assets/brand/index.html`. The mark is an H made of two walls
  with one warm dot between them (a person, found); rings pass through the walls. The favicon
  `assets/img/icon.svg` is replaced with it.
- Type in three voices, self-hosted in `assets/brand/fonts/` (SIL Open Font License, licence files beside them,
  `font-display: swap`, works offline): Instrument Serif (display), Instrument Sans (interface, variable weight and
  width), Geist Mono (changing numbers). Versions fetched: @fontsource 5.3.0 of each.

**Tokens (`app/ui/tokens.css`)**: every old variable name still exists. Values refined (graphite surfaces, tighter
radii, a real depth model). Added: `--bg-5`, `--line-3`, `--hi`, `--hi-2`, `--accent-2`, `--focus`, a `-line` border
tint for every meaning colour, `--hatch`, `--hatch-danger`, `--dots`, `--fs-18/24/32/56/72`, ten `--type-*` role
shorthands, `--s-12`, `--s-16`, `--shadow-0`, `--well`, `--glass-line`, `--ease-in-out`, `--t-slow`, a `--z-*` scale.
High-contrast and colour-blind variants extended to the new tokens; reduced motion zeroes all three durations.

**Components (`app/ui/base.css`)**: every old class still works. Redrawn: buttons (rest, hover, pressed, on, focus,
disabled), panels, glass, tags (instrument labels; solid square = real or live, hollow square on a dashed hatched
ground = simulated or concept), key/value rows, stats, segmented control, inputs, custom checkbox/radio, tables,
notes, empty state, bars, kbd, scrollbars. New: `.meter` (+ `.meter-wrap`, `.meter-row`), `.tooltip` and
`data-tip`, `.slider`, `.divider`, `.badge-count`, `.kbd-hint`, `.card`, `.list` / `.list-item`, `.chip`, `.legend`,
`.axis` and other chart text defaults, plus `.tabs`, `.status`, `.check.switch`, `.field`, `.btn-group`,
`.panel-foot`, `.stat-row`, `.stat.live`, `.skeleton`, `.spinner.sm`, `.bar.indeterminate`, `.toolbar`, `.ws-head`,
`.crop`, `.hatch`, type helpers (`.display .title .heading .figure .lede .label .caption .unit`).

**Shell chrome (`app/shell.css`)**: brand lockup (mark, drawn wordmark, "Command" in the serif italic), transport
controls as a recessed deck of keys with a T+ clock, the mission phase as the serif headline of the bar, unit
readouts, a search well, an All stop that is larger than everything else with a guard ring; a rail with ruled groups,
a strong current item (raised key, accent bar, accent icon) that tightens on short screens so all 23 workspaces fit
at 900 px without scrolling; a status bar with the last event in monospace; toasts with a level bar that enter from
the right; a blurred scrim and a dialog with a ruled action row; the "not built yet" state on a survey-dot ground.
All element ids used by `shell.js` are unchanged; no markup was edited.

**Icons (`app/ui/kit.js`, ICONS only)**: five redrawn (rover, drone, swarm, fusion, graph), 79 added (117 in all).
No export, name or signature changed.

**Reference page (`app/ui/reference.html`)**: every token and component in every state, live: contrast ratios are
measured in the page, the three accessibility switches write the same `hound.prefs` the console reads, controls
respond, icon names copy on click.

**`docs/STYLE.md`** refined: the three voices, depth, the tag marker rule, a component table, brand rules.

## Labels (real / simulated / concept)

- Nothing I built makes a claim about the rover. The reference page uses the published test numbers from
  `docs/FACTS.md` (86.9 %, 25.5 %, 12.4 %, 13.0 %, 7.9 %, 21.4 %, 23,372, 0.53, 1.1 ms) and every panel that shows
  them carries a "Simulated people" tag. "Empty room called empty 87.0 % / 92.1 %" are 100 minus the published
  false-alarm rates.
- The meter and list examples (0.81, 94 %, "room 104") are layout examples and say so on the page.
- The photo behind the glass demo is the existing `assets/img/nepal-flood.webp`, captioned as a photo with
  simulated readings.

## What I verified, and how

- `tools/shoot.py` on the reference page at 1680×1000 and 1440×900: 0 console errors; every section looked at.
- Clicked and checked by script: motion Play, segmented control, chips, tabs, table row select, list select,
  icon copy, the reduced-motion switch (`--t-med` reads 0 ms), high contrast, colour-blind palette.
- The app at 1440×900, 1680×1000 and 1920×1080 with other agents' workspaces (Wi-Fi AI, Evidence): 0 errors from
  my files; confirm dialog, alert and ok toasts, All stop to Resume, collapsed rail, all screenshotted and checked.
- Contrast computed for every text and meaning colour on every surface: text 16.0, secondary 8.8, quiet 5.4,
  person 6.6, warn 10.3, accent 7.6, ok 10.1, danger 5.7, sim 8.2 (to 1, on `--bg-2`).
- All five font files load (checked `document.fonts`).

## Known gaps

- Instrument Serif has no tabular figures, so `.stat b` shifts slightly when its digits change. Use `.stat.live` or
  `.num` for numbers that tick quickly (documented in STYLE.md and on the reference page).
- The phase track and the red "all stop" headline need two small markup changes in `shell.js`; exact code is in
  `orchestration/requests/design-director.md` and the CSS is already in place (tested by injecting the markup).
- "Mission status as the centre of the bar" is done by order and scale, not by geometric centring: with the
  current markup the status sits between the transport and the right-hand cluster.
- Hover states cannot be shown statically on the reference page; they are live there.
- The local server (`:4391`) sometimes resets connections when many files load at once; those show as
  ERR_CONNECTION_RESET in shoot.py and are not from these files.
- Not checked: Firefox and Safari rendering of the range slider and `color-mix()` (Chrome only here).
- `body` no longer synthesises bold (`font-synthesis-weight: none`), so a rule that asks for a bold serif gets
  the regular serif instead of a smeared fake bold.

## For the Devpost write-up

"HOUND Command has one design system: a serif for headlines, a precise sans for the interface and a monospace for
numbers that move, on graphite surfaces where colour is reserved for meaning. Orange-red is only ever a person."

"Honesty is built into the components: a solid marker means real or live, a hollow marker on a hatched ground
means simulated or concept, so a simulation can never pass for a reading."

"Every token and component is documented on a living reference page that measures its own contrast and switches
to high-contrast, colour-blind and reduced-motion variants."
