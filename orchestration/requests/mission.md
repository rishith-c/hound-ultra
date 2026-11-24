# Requests from the mission agent

## 1. shell.js: do not toast PERSON_FOUND (and other alerts) while the Mission workspace is showing

**What.** In `boot()`: `bus.on('event', (ev) => { if (ev.level === 'alert') toast(...) })`.
**Why.** Mission shows its own "Person found" card with the evidence and the next action. The shell toast repeats
the same sentence on top of the inspector header for six seconds.
**Exact change.**
```js
bus.on('event', (ev) => { if (ev.level === 'alert' && current !== 'mission') toast(ev.text, { level: 'alert', ms: 6000 }); });
```
Worked around: nothing to do in my files; both show for now.

## 2. shell.js: workspaces get a copy of ctx, so `ctx.selection` is always stale inside a workspace

**What.** `mod.default.mount(root, { ...ctx, params, manifestEntry: m })` copies `selection` by value at mount time.
`ctx.select()` then updates only the original object (`window.HOUND`). ARCHITECTURE.md tells agents to read
`ctx.selection`, which never changes for them.
**Exact change (one of).** Pass a prototype-linked context: `Object.assign(Object.create(ctx), { params, manifestEntry: m })`,
or define `selection` as a getter on the copy.
Worked around in Mission: `index.js` keeps its own selection from the `select` event and redefines `ctx.selection` as a getter.

## 3. Note for the twin agents: backdrop blur over the 3-D canvas

Measured in headless Chrome at 1680x1000: glass panels with `backdrop-filter: blur(20px)` over a canvas that redraws
every frame ran at 3.5 frames a second; the same page without the blur ran at 60. Mission therefore overrides
`.glass` inside `.mission` to a denser tint with no blur. Other workspaces that float `.glass` over a live canvas
may want the same.

## To twin-core, twin-actors (resumed session)

4. **Black frames (twin-actors, rover.js).** A full-size 3-D run sampled 137 near-black frames out of 298 (mean brightness under 8 of 255),
   at 1680x1000. Ruled out by A/B in one page: the lens shift (57 of 73 dark with it off, 42 of 50 with it on) and 'walls-xray' (still dark
   with it never used). Reading sceneRT (half float) found NaN pixels, 261 at t=215 and 408 at t=415; hiding HOUND-01, then its inner
   Group, removed them. One NaN pixel is enough for bloom to blacken the frame. rover.js was saved at 18:14:00 on 23 November, after those
   two runs; the next run found no NaN in 40 tries over about 35 s of mission time. Please confirm that edit was the fix. A guard in post.js
   (replace non-finite colours before bloom) would stop any material from doing this again (twin-core). Earlier text here blamed 'walls-xray': that was wrong.
5. **setSafeArea (twin-core).** Not there yet. Until it is, Mission shifts the lens with camera.setViewOffset and switches over by itself.
6. **Listen shot (twin-core).** yaw0 = C.yaw + 0.5 can put a wall between the camera and the rover (seen at S1 and S2). Please pick
   the yaw with a clear line to the rover.
7. **Room decal (twin-actors).** Room 103 keeps "Possible person" on the floor after the person is confirmed: the simulator does not update
   coverage after a second look. roomCover() in mission/map2d.js shows the fix.
8. **Simulator (foundation).** The planned rescue route enters "Unstable slope above the block" with avoid.slope on (2 of 18 path points). Mission
   says so in the approval dialog and the film.
