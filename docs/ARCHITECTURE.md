# Architecture and the contract between agents

Static site. No build step, no bundler, no npm. Plain ES modules loaded by the browser; libraries come from a CDN
through the import map in `app/index.html` (`three`, `three/addons/…`, `d3`). Anything else: import a pinned
version from `https://cdn.jsdelivr.net/npm/<pkg>@<exact version>/+esm` inside your own module.
All URLs in the site are **relative** (the site is served from `/ultra/` locally and from `/` when deployed).

## Running and checking

- **Do not start any server.** `tools/shoot.py` serves this repository by itself: pass a bare path such as
  `/app/?mode=demo#/mission` (old localhost addresses also work).
- Look at your work with `python3 tools/shoot.py /app/?mode=demo#/<id> --out /tmp/x.png --do …` (read `tools/shoot.py --help`). It runs
  headless Chrome with the GPU on, prints console errors, runs JavaScript, clicks, and saves screenshots. Open the
  screenshots with the Read tool and actually look at them.
- `node`, `rm` and `curl` are blocked in this shell. Use Python for scripts, `mv <file> ~/.Trash/` to delete.
  `/usr/local/bin/python3` has numpy.
- Do not `git commit`, `git push`, deploy, or install anything. The orchestrator commits.
- Useful URL switches: `…/app/?paused#/sense` starts with the simulation paused. `window.HOUND` is the shared
  context (see below), e.g. `HOUND.sim.seek(420)` jumps the mission to 7:00, `HOUND.sim.setSpeed(32)`.

## Files and who owns them

```
app/index.html, shell.js, shell.css      orchestrator. Do not edit.
app/core/*                               orchestrator. Do not edit. (bus, geometry, world, planner, nn, fusion, sim)
app/ui/tokens.css, base.css, kit.js      orchestrator. Do not edit. Use them.
app/twin/*                               twin agent
app/workspaces/<id>/*                    the agent that owns workspace <id>
app/global/<name>.js                     the agent named in its brief
assets/models, assets/img/gen, data/*    shared, add files; never rename or delete someone else's
tests/*, docs/*                          as assigned
```

If you need something changed in a file you do not own, do not edit it. Write the request in
`orchestration/requests/<your-agent-name>.md` (what, why, the exact change) and work around it in your own files.
The simulator has an extension point for this (`sim.use`, below).

## A workspace module

`app/workspaces/<id>/index.js` (plus any files beside it, including your own CSS):

```js
export default {
  // root: an empty element that fills the main area (position: absolute; inset: 0; display: flex; column).
  // ctx:  the shared context, see below. ctx.params are optional values passed by shell.open(id, params).
  async mount(root, ctx) {
    // build your DOM into root; subscribe to ctx.bus
    return {
      onShow() {},        // the workspace became visible: start animation loops here
      onHide() {},        // hidden: STOP requestAnimationFrame loops and release the microphone etc.
      onParams(p) {},     // optional: shell.open(id, params) called while already mounted
    };
  },
};
```

Load your CSS yourself: `const css = new URL('./style.css', import.meta.url)` and add a `<link>` once. Prefix your
class names with your workspace id (`.sense-…`) so styles never collide.
Workspaces stay mounted when hidden, so pause everything in `onHide`. At most one WebGL canvas per workspace.

## The shared context (`ctx`, also `window.HOUND`)

| | |
|---|---|
| `ctx.sim` | the mission simulator (below) |
| `ctx.bus` | events: `bus.on(type, fn)` returns an unsubscribe function |
| `ctx.world` | the scenario: `SITE, BUILDING, ROOMS, DOORS, WALLS, OBSTACLES, HAZARDS, STOPS, UNITS, SENSORS`, and `roomAt, roomById, wallsCrossed, lineOfSight, sightline, hazardsAt, buildGrid`. Read `app/core/world.js`. |
| `ctx.nn` | the Wi-Fi network: `weights, samples[30], threshold, byCat, infer(x, {trace}), inferSample(i, {trace})`. Read `app/core/nn.js`. |
| `ctx.kit` | `h()` DOM builder, `icon(name)`, `realityTag(kind)`, `panel()`, `fmt`, `fitCanvas()`, `reducedMotion()`, `cssVar()`, `REALITY` |
| `ctx.shell` | `toast(text, {level})`, `confirm({title, body, confirmLabel, danger})` returns a Promise of true/false, `open(workspaceId, params)`, `current()` |
| `ctx.select(sel)` / `ctx.selection` | the one shared selection, `{ type: 'detection'|'survivor'|'unit'|'room'|'hazard'|'event'|'stop', id }`. Emits `select`. When the user picks something in your view, call it; when you hear `select`, highlight the same thing. This is what links the map, the timeline, the graph and the inspector. |
| `ctx.prefs`, `ctx.setPref(k, v)` | `contrast` ('normal'/'high'), `palette` ('default'/'cb'), `motion` ('auto'/'reduce'). Emits `prefs`. |
| `ctx.PHASE_INFO, ctx.FAULTS, ctx.COMMANDS, ctx.manifest` | labels and descriptions to show to people |

### Bus events

`tick` (state; once per frame while the clock runs, and after any command), `phase` `{from,to}`, `event` (a log
entry), `reading` `{key, unit, csi, detections}`, `detection`, `survivor`, `route`, `fault` `{id,on}`, `reset`,
`seek`, `running` (bool), `speed`, `command` `{name,args}`, `select`, `workspace` (id), `prefs`,
`palette:open`, `escape`. You may emit your own events; prefix them with your workspace id (`aerial:found`).

**Draw from `ctx.sim.state`, not from events.** After `reset` and `seek` the state object is new and nothing is
replayed, so redraw everything from state. Never keep a reference to an old `sim.state`; read it fresh each time.

## The simulator (`ctx.sim`)

Read `app/core/sim.js`; the top comment and `COMMANDS` are the reference. In short:

```js
sim.state            // the mission, read-only for you
sim.command(name, args) -> boolean     // the ONLY way to change the mission
sim.play(); sim.pause(); sim.toggle(); sim.setSpeed(8); sim.reset({autoplay, seed, windows}); sim.seek(seconds)
sim.plan(from, to, {nearest}) -> { ok, path, length, reached, gap }   // the route planner on the current map
sim.grid             // the current planning grid (res 0.5 m): { w, h, res, blocked, cost, toCell, toPoint }
sim.use(plugin)      // extend: { init(api), step(dt, api), commands: { myCommand(args, api) { …; return true } } }
sim.truthOf(detId)   // ground truth for a detection. Tests and the "reveal ground truth" debug view ONLY.
```

`sim.state` (all positions are `[x, y]` in metres, x east, y north, site is 120 by 90):

```js
{ t, running, speed, autoplay, phase,           // phase: standby aerial deploy search assess plan rescue complete
  started, hold,                                // hold = all stop
  units: { 'HOUND-01': { id, kind:'rover', name, built, pos, heading /*rad, 0 = east*/, alt, v, mode, battery, link, path, goal, trail, odo, stop },
           'DRONE-01': { kind:'drone', alt, … }, 'TEAM-1': { kind:'team', … } },
           // mode: idle drive listen hold fault swap takeoff scan return landed
  map: { scan /*0..1 drone survey*/, swaths:[{y,x0,x1,half}], explored /*Uint8Array 120x90, 1 m cells seen by the rover*/, ready },
  sensors: { listen: { stop, window, progress, dur } | null,           // a 10 s window in progress
             csi: { ok, sample /*index into nn.samples*/, person, moving, says, threshold, ms, t, stop } | { ok:false, reason },
             radar: { targets:[{pos, v, kind:'moving'|'periodic'}], t }, micro: { still, t },
             thermal: { ok, ambientC, blobs:[{bearing, dist, tempC, strength:'clear'|'faint'}], heading, t } | { ok:false, reason },
             tof: { front, rear, t }, at, stop },
  detections: [{ id, t, updated, room, pos, posSigma, p /*0..1*/, status /*possible confirmed rejected*/, kind, reason,
                 evidence:[{ t, sensor, result, note, score?, moving?, sample?, vantage, unit }],
                 steps:[{ sensor, result, lr, rawLr, repeat, assumed, p }],   // the fusion working, in order
                 by, stop, outdoor, needsTeam, dismissed, survivorId, windows }],
  survivors: { V1: { id, detId, status /*located reached*/, pos, posSigma, room, outdoor, p, motion /*moving still*/, sensors, foundAt, reachedAt, breathing:null } },
  coverage: { '101': { room, status /*unsearched clear lead person blocked*/, reach /*0..1*/, residual /*chance someone was missed*/, note, stop, t } },
  hazards: [ /* hazards added during the mission (aftershock) */ ],
  routes: { rescue: { legs:[{ det, survivor, ok, path, length, reached, gap, access, kind:'walk in'|'break through', arrivedAt }], length, etaS, avoided:[names], status /*planned approved done*/ } },
  events: [{ id, t, level /*info ok warn alert*/, code, text, det?, unit?, room?, pos? }],
  faults: { linkLoss, csiDropout, badWindow, thermalFail, lowBattery }, operator, stats }
```

The scripted mission (about 11 simulated minutes; 80 s on screen at 8×): drone survey (finds a possible person
outdoors) → rover drives in → four listening stops (a fan and a hot pipe are correctly rejected; a still person
is "possible"; a moving person behind a wall is confirmed) → second look confirms the still person → rescue route
planned, approved, walked. With `autoplay` on the mission makes the routine choices itself; turn it off
(`setAutoplay {on:false}`) and the operator must start, investigate, plan and approve.

Never read `world.TRUTH` or `sim.truthOf` to decide what the operator sees. The console only knows what its
sensors found. Ground truth may appear only in a clearly labelled "Reveal ground truth" debug toggle and in tests.

## The 3-D twin (`app/twin/index.js`)

Other workspaces embed the twin through this API (the twin agent implements it; if it is not there yet, catch the
import error and show a flat fallback):

```js
import { createTwin } from '../../twin/index.js';
const twin = await createTwin(hostElement, ctx, { interactive: true, quality: 'high' });
twin.setCamera('orbit' | 'top' | 'follow' | 'fpv' | 'cinematic');   twin.focus({ type, id });
twin.setLayer(name, on);   // walls-xray, hazards, coverage, heat, route, trail, scan, labels, truth, grid
twin.layers()              // [{ id, label, on }]
twin.start(); twin.stop(); twin.resize(); twin.dispose();
twin.setSafeArea({ left, top, right, bottom });   // pixels covered by your panels: framing and labels stay in what is left
twin.screenshot() -> dataURL;    twin.three -> { scene, camera, renderer } for advanced use
```

The twin reads `ctx.sim.state` every frame and listens for `select`, `reset`, `seek`. It calls `ctx.select()` when
something is clicked. Coordinates: world `[x, y]` maps to three.js `(x, height, -y)`.

## Demo mode and Advanced mode (required for every workspace)

The console opens in **Demo**. Rishith's words: "it shouldn't be super overloaded; advanced mode shows all that, but
only the sexy thing in the non-advanced demo." A switch in the top bar changes mode at any time.

- Read it: `ctx.mode` is `'demo'` or `'advanced'` (always current). Hear it: `bus.on('mode', ({ mode }) => …)`.
  Style it: `:root[data-mode="demo"]` / `:root[data-mode="advanced"]`, and the classes `.adv-only` (hidden in Demo)
  and `.demo-only` (hidden in Advanced). Test with `?mode=demo` and `?mode=advanced`.
- In Demo the rail, search and telemetry are gone: your workspace is the full window between the top bar and a 60 px
  row of chapters (about 1680×888 and 1440×788).
- **What Demo shows.** One hero visual that fills the whole workspace edge to edge, already moving within a second,
  no click needed, looping or playing a short story by itself. Over it, at most: a title block (serif title, one
  sentence, the reality tag), one primary action, one caption saying what is happening right now, and up to three
  live figures. About 40 words on screen in total. No tables, no sliders, no settings, no tabs full of text, no
  stacked panels. If your workspace has several exhibits, Demo shows the best one as the hero with a quiet stepper
  (numbered dots or short names) to the others, each also full-bleed.
- **What Advanced shows.** Everything you have built. Nothing is lost; it moves behind `.adv-only`.
- Switching keeps state, never reloads, and resizes the canvas smoothly (a `resize` event is fired for you).
- Direct manipulation is welcome in Demo (drag the person, fly the camera, scrub the time); forms are not.

## Reality labels (required)

Every workspace shows `ctx.kit.realityTag(kind)` in its header, and every feature inside it that differs from the
workspace's label shows its own. Kinds: `live-ai`, `live-algo`, `real-data`, `device`, `sim`, `concept`.
Assumed numbers (anything not measured) are marked "assumed" where they are shown. See `FACTS.md`.

## Definition of done for every agent

1. Your workspace opens with no console errors (`tools/shoot.py … --strict`), at 1680×1000 and 1440×900, in Demo and
   in Advanced, and holds 60 frames a second while its hero animates (`--do fps:3`).
2. Every control does what its label says. Nothing is a stub. Empty, loading and error states exist.
3. Keyboard works (Tab reaches everything, Enter/Space activate, Escape closes); buttons have accessible names.
4. Animation stops in `onHide` and under reduced motion (`ctx.kit.reducedMotion()`).
5. You looked at your own screenshots and fixed what looked wrong.
6. You wrote `orchestration/reports/<agent>.md`: what you built, how each feature is labelled (real/simulated/
   concept), what you verified and how, known gaps, and 2 or 3 sentences the Devpost write-up can quote.

## Inside the twin: engine and actors (for the two twin agents)

`app/twin/index.js`, `engine.js`, `environment.js`, `cameras.js`, `post.js` belong to the **twin-core** agent.
`app/twin/actors/*` belongs to the **twin-actors** agent. The seam between them:

```js
// app/twin/actors/index.js  (twin-actors)
export const ACTORS = [ roverActor, droneActor, teamActor, peopleActor, sensingActor, routeActor, scanActor, coverageActor, hazardActor, markerActor ];
// each actor:
export default {
  id: 'rover',
  layers: ['trail'],                     // layer ids this actor responds to (see twin.setLayer)
  create(t) { /* build objects, add them to t.scene */ return {
    update(state, dt, time) {},          // every frame; state = ctx.sim.state (fresh), dt in real seconds
    setLayer(id, on) {},                 // optional
    onSelect(sel) {},                    // optional: highlight
    dispose() {},
  }; },
};
// t (given by twin-core to every actor):
t = { THREE, scene, camera, renderer, ctx /* shared context */, world, quality /* 'high'|'low' */, reduced /* reduced motion */,
      v3(p, h = 0) -> THREE.Vector3(p[0], h, -p[1]),         // world [x, y] + height -> three.js position
      pickable(object3D, sel),                                // clicking it calls ctx.select(sel)
      label(text, opts) -> { el, setPosition(v3), setText(s), remove() },   // a leader-lined HTML label
      glow(object3D),                                         // include in the bloom pass
      groundY: 0, addUpdate(fn) }
```

twin-core builds the static world (ground, streets, buildings A/B/C, the walls of building B from `world.WALLS`
with door openings, rubble, furniture, props, sky, lights), the renderer, post-processing, cameras, picking, labels
and layers, then imports `./actors/index.js` inside a try/catch and creates each actor. If an actor throws, log it
and carry on without it. twin-actors must not create a renderer or touch the camera.
Layers handled by twin-core: `walls-xray` (walls of building B turn translucent), `grid`, `labels`.
Layers handled by actors: `hazards`, `coverage`, `heat`, `route`, `trail`, `scan`, `truth`, `sensing`.
A CAD export of the real rover is at `assets/models/rover_cad.glb` (millimetres, Z up, from the older CAD; use it
if it looks right, otherwise model the rover procedurally from `assets/img/rover_white.png` as reference).
