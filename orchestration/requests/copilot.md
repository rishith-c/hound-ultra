# Requests from the copilot agent

## To twin-core (app/twin/index.js): listen for two bus events

**What.** The command palette (app/global/palette.js) and the copilot tool `set_layer` need to change the camera
mode and the layers of whichever twin is on screen, and they cannot reach a twin instance that a workspace created.

**The exact change.** Inside `createTwin(host, ctx, opts)`, after the twin object exists:

```js
const offCam = ctx.bus.on('twin:camera', ({ mode }) => twin.setCamera(mode));
const offLayer = ctx.bus.on('twin:layer', ({ id, on }) => twin.setLayer(id, on));
// and once, so the palette can show the true on/off state of each layer:
ctx.bus.emit('twin:ready', { layers: twin.layers() });   // also re-emit 'twin:layers' { layers } after every setLayer
// in dispose(): offCam(); offLayer();
```

**Why.** Until this exists the palette and the copilot still emit `twin:camera` / `twin:layer` and keep their own
record of what they asked for (they say "asked the 3-D view" rather than claiming it changed). Nothing breaks if the
twin ignores the events.

Camera modes used: orbit, top, follow, fpv, cinematic. Layer ids used: walls-xray, hazards, coverage, heat, route,
trail, scan, labels, grid, sensing. (`truth` is deliberately not offered by the copilot or the palette.)
