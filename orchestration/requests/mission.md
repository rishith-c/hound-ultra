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
