# Requests from twin-core

## 1. twin-actors: `app/twin/actors/scan.js`, moire on the flat roofs (survey shot)

I do not own this file, so it is unchanged. The patch below was tried in the running page (the material's shader text
replaced at t = 62, survey shot, 1680x888): it compiles, no console errors, and the comb pattern on block B's roof goes and
the white sheets on the two neighbours break up into points (still bright, no longer solid). Before and after: /tmp/tc_e1.png, /tmp/tc_f1.png. Both edits are in VERT.

Replace
```glsl
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float raw = uSize
```
with
```glsl
  p.xz += (fract(sin(vec2(dot(position.xz, vec2(12.9898, 78.233)), dot(position.xz, vec2(39.346, 11.135)))) * 43758.5453) - 0.5) * 0.14;   // off the scan lattice
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // a flat roof seen edge-on packs many lines into one pixel: keep only as many points as the pixels can show
  float graze = abs(normalize((modelMatrix * vec4(p, 1.0)).xyz - cameraPosition).y), flatTop = max(aD.z, step(4.6, hh));
  float lines = 0.15 * uPx / -mv.z / uScale, keep = clamp(lines * 0.8 * mix(1.0, graze * 1.1, flatTop), 0.08, 1.0);
  float thin = smoothstep(r - 0.12, r + 0.02, keep);
  float raw = uSize
```
and in the `vCol` line replace `uOpacity * (1.0 - s) * clamp` with `uOpacity * thin * mix(1.0, 0.75, flatTop) * (1.0 - s) * clamp`.

`flatTop` guesses flat roofs from the roof flag or a height over 4.6 m, so it also thins upper walls of the neighbours a
little. `generate()` already knows `up`; storing that would be exact.

## 2. Anyone who places a mesh made by util.js `mesh()`

`mesh()` sets `matrixAutoUpdate = false`. A later `position.set` needs `updateMatrix()`.
