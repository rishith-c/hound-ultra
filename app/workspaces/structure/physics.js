// Structure lab: the rigid-body world. Rapier 3-D (WebAssembly) does the dynamics; this file builds the bay,
// fails its supports, and runs every "what if" (lift, tremor) in a restored copy of the world.
// Units: metres, kilograms, seconds, newtons. y is up.
const RAPIER_URL = new URL('../../../vendor/rapier/dimforge-rapier3d-compat-0.17.3.js', import.meta.url).href;
export const RAPIER_VERSION = '0.17.3';
let R = null;
export async function loadRapier() {
  if (!R) { const m = await import(RAPIER_URL); const lib = m.default || m; await lib.init(); R = lib; }
  return R;
}

export const G = 9.81;
export const DT = 1 / 60;
// Geometry of the bay (a precast frame: columns, ledger beams, hollow-core planks). Sizes are ordinary ones.
export const DIM = { LX: 4.8, LZ: 4.2, COL: 0.4, HC: 2.55, BD: 0.45, BW: 0.7, STEM: 0.2, PT: 0.2, STOREY: 3.2 };
// Densities, kg/m3. Hollow-core planks are about 290 kg per square metre at 200 mm, so about 1450 kg/m3 overall.
export const RHO = { concrete: 2400, plank: 1450, masonry: 1900 };
export const FRICTION = 0.62;   // concrete on concrete, assumed

export const SCENARIOS = [
  { id: 'vshape', label: 'V-shape', fail: 'The middle line of columns goes. Both floor spans drop at the centre and stay tied at the outer walls.' },
  { id: 'leanto', label: 'Lean-to', fail: 'One outer line of columns goes. The floor stays tied along the other side and leans down to the ground.' },
  { id: 'pancake', label: 'Pancake', fail: 'Every column goes. The floors come straight down and stack.' },
  { id: 'cantilever', label: 'Cantilever', fail: 'One outer line goes. The lower floor falls; the roof slab stays fixed at the far side and hangs in the air.' },
];

export function rng32(seed) { let a = (seed >>> 0) || 1; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const colliderFor = (b, density, m) => R.ColliderDesc.cuboid(b.h[0], b.h[1], b.h[2]).setTranslation(b.o[0], b.o[1], b.o[2])
  .setDensity(density).setFriction(FRICTION).setRestitution(0.02)
  .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(m);

function boxesVolume(boxes) { let v = 0; for (const b of boxes) v += 8 * b.h[0] * b.h[1] * b.h[2]; return v; }

// ---------------------------------------------------------------- the bay
// The same bay as geometry only, before the engine has loaded: buildPile against a stand-in that records nothing.
export function blueprint(opts) {
  const real = R; let n = 1; const stub = new Proxy(function () {}, { get: (t, k) => (k === 'handle' ? n++ : k === Symbol.toPrimitive ? () => 0 : stub), apply: () => stub, construct: () => stub, set: () => true });
  try { R = stub; return buildPile(opts); } finally { R = real; }
}
export function buildPile({ seed = 7, scenario = 'vshape', tie = 1 } = {}) {
  const rnd = rng32(seed * 2654435761 + 17);
  const world = new R.World({ x: 0, y: -G, z: 0 });
  world.timestep = DT; world.numSolverIterations = 8;
  const ground = world.createCollider(R.ColliderDesc.cuboid(60, 1, 60).setTranslation(0, -1, 0).setFriction(0.75).setRestitution(0.0));
  const pile = { R, world, seed, scenario, pieces: [], ties: [], shores: [], t: 0, state: 'intact', ground: ground.handle, byBody: new Map(), info: {}, rnd, dustClock: new Map() };
  pile.byBodyAny = (w, h) => { const i = pile.byBody.get(h); return i == null ? -1 : i; };
  const { LX, LZ, COL, HC, BD, BW, STEM, PT, STOREY } = DIM;
  const xs = [-LX, 0, LX], zs = [-LZ, 0, LZ];
  const failLine = scenario === 'vshape' ? 1 : scenario === 'pancake' ? -1 : (rnd() < 0.5 ? 0 : 2);
  const side = failLine === 0 ? -1 : 1;
  pile.info = { failLine, side, xs, zs };
  const standing = (j) => scenario !== 'pancake' && j !== failLine;

  const add = (spec) => {
    const idx = pile.pieces.length;
    const vol = boxesVolume(spec.boxes), mass = vol * spec.density;
    const desc = (spec.fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic().setLinearDamping(0.04).setAngularDamping(0.08)).setTranslation(spec.p[0], spec.p[1], spec.p[2]);
    if (spec.q) desc.setRotation({ x: spec.q[0], y: spec.q[1], z: spec.q[2], w: spec.q[3] });
    const body = world.createRigidBody(desc);
    const thresh = spec.kind === 'content' ? spec.capacity : 14 * mass * G;
    for (const b of spec.boxes) world.createCollider(colliderFor(b, spec.density, thresh), body);
    let r = 0; for (const b of spec.boxes) r = Math.max(r, Math.hypot(Math.abs(b.o[0]) + b.h[0], Math.abs(b.o[1]) + b.h[1], Math.abs(b.o[2]) + b.h[2]));
    const piece = { idx, alive: true, fixed: !!spec.fixed, handle: body.handle, mass, radius: r, home: [...spec.p], level: 0, ...spec };
    pile.pieces.push(piece); pile.byBody.set(body.handle, idx);
    return piece;
  };
  const LET = 'ABC';
  // columns: two segments each when the line fails (it breaks there), one fixed piece when it stands
  for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const yb = s * STOREY, name = 'Column ' + LET[i] + (j + 1) + (s ? ', upper storey' : ', ground storey');
    if (standing(j)) add({ kind: 'column', id: 'C' + LET[i] + (j + 1) + (s ? 'u' : 'g'), name, level: s, fixed: true, density: RHO.concrete, p: [xs[i], yb + HC / 2, zs[j]], boxes: [{ o: [0, 0, 0], h: [COL / 2, HC / 2, COL / 2] }], meta: { i, j, s } });
    else if (s === 1) add({ kind: 'column', id: 'C' + LET[i] + (j + 1) + 'u', name, level: s, density: RHO.concrete, p: [xs[i], yb + HC / 2, zs[j]], boxes: [{ o: [0, 0, 0], h: [COL / 2, HC / 2, COL / 2] }], meta: { i, j, s } });
    else {
      // a ground-storey column on the failed line bursts at mid-height: a stub, four chunks of the burst zone, and the top
      const h1 = HC * (0.24 + rnd() * 0.16), hb = 0.5, h2 = HC - h1 - hb, c = COL / 4;
      add({ kind: 'column', id: 'C' + LET[i] + (j + 1) + 'g-a', name: name + ' (stub)', level: s, density: RHO.concrete, p: [xs[i], h1 / 2, zs[j]], boxes: [{ o: [0, 0, 0], h: [COL / 2, h1 / 2, COL / 2] }], meta: { i, j, s, seg: 0 }, broken: 'top' });
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) add({ kind: 'debris', id: 'X' + pile.pieces.length, name: 'Concrete chunk', level: s, density: RHO.concrete, p: [xs[i] + (a - 0.5) * 2 * c, h1 + hb / 2, zs[j] + (b - 0.5) * 2 * c], boxes: [{ o: [0, 0, 0], h: [c - 0.004, hb / 2 - 0.01, c - 0.004] }], meta: { i, j, s, a, b } });
      add({ kind: 'column', id: 'C' + LET[i] + (j + 1) + 'g-b', name: name + ' (upper part)', level: s, density: RHO.concrete, p: [xs[i], h1 + hb + h2 / 2, zs[j]], boxes: [{ o: [0, 0, 0], h: [COL / 2, h2 / 2, COL / 2] }], meta: { i, j, s, seg: 1 }, broken: 'bottom' });
    }
  }
  // ledger beams along x on every column line: a wide ledge the planks bear on, and a stem between the plank ends
  const beamAt = {};
  for (let s = 0; s < 2; s++) for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) {
    const yb = s * STOREY, hx = LX / 2 - 0.012;
    const b = add({ kind: 'beam', id: 'B' + (j + 1) + LET[i] + LET[i + 1] + (s ? 'r' : 'f'), name: (s ? 'Roof' : 'First-floor') + ' beam, line ' + (j + 1) + ', ' + LET[i] + ' to ' + LET[i + 1], level: s + 1, fixed: standing(j), density: RHO.concrete,
      p: [(xs[i] + xs[i + 1]) / 2, yb + HC + BD / 2, zs[j]], boxes: [{ o: [0, 0, 0], h: [hx, BD / 2, BW / 2] }, { o: [0, BD / 2 + STEM / 2, 0], h: [hx, STEM / 2, COL / 2] }], meta: { i, j, s } });
    beamAt[s + ':' + j + ':' + i] = b;
  }
  // hollow-core planks spanning z between the beam ledges, nine across
  const NP = 9, total = 2 * LX + COL, pw = total / NP, len = LZ - COL - 0.02;
  for (let s = 0; s < 2; s++) for (let sp = 0; sp < 2; sp++) for (let k = 0; k < NP; k++) {
    const yb = s * STOREY, x = -total / 2 + pw * (k + 0.5), z = (zs[sp] + zs[sp + 1]) / 2;
    const pl = add({ kind: 'plank', id: (s ? 'R' : 'F') + (sp + 1) + '-' + String(k + 1).padStart(2, '0'), name: (s ? 'Roof' : 'First-floor') + ' plank ' + (k + 1) + ', span ' + (sp + 1), level: s + 1, density: RHO.plank,
      p: [x, yb + HC + BD + PT / 2, z], boxes: [{ o: [0, 0, 0], h: [pw / 2 - 0.006, PT / 2, len / 2] }], meta: { s, sp, k } });
    // ties at both ends (dowels and topping steel): a pin to the beam beneath. They break on a hard impact.
    for (const end of [0, 1]) {
      const j = sp + end, beam = beamAt[s + ':' + j + ':' + (x < 0.01 ? 0 : 1)];
      if (scenario !== 'pancake' && j === failLine) continue;              // the connection at the failed line is what failed
      const moment = scenario === 'cantilever' && s === 1 && Math.abs(sp + 0.5 - failLine) < 1;   // roof slab continuous over the standing support
      const aw = [x, yb + HC + BD, zs[j] + (end ? -1 : 1) * (BW / 2)];   // the pin sits on the edge of the ledge, where a dropping plank would hinge
      const a1 = { x: 0, y: -PT / 2, z: aw[2] - z }, a2 = { x: aw[0] - beam.p[0], y: aw[1] - beam.p[1], z: aw[2] - beam.p[2] };
      const I = { x: 0, y: 0, z: 0, w: 1 };
      const jd = moment ? R.JointData.fixed(a1, I, a2, I) : R.JointData.spherical(a1, a2);
      const joint = world.createImpulseJoint(jd, world.getRigidBody(pl.handle), world.getRigidBody(beam.handle), false);
      pile.ties.push({ handle: joint.handle, a: pl.idx, b: beam.idx, alive: true, moment, strength: moment ? Infinity : (22 + rnd() * 60) * tie, at: aw });
    }
  }
  // masonry infill on some perimeter bays, four blocks each
  const bays = [];
  for (const j of [0, 2]) for (let i = 0; i < 2; i++) bays.push({ along: 'x', i, j });
  for (const i of [0, 2]) for (let j = 0; j < 2; j++) bays.push({ along: 'z', i, j });
  for (let s = 0; s < 2; s++) for (const bay of bays) {
    const hit = scenario !== 'pancake' && (bay.along === 'x' ? bay.j === failLine : (failLine === 1 || bay.j === (failLine === 0 ? 0 : 1)));
    if (rnd() > (s ? 0.4 : 0.62) || hit) continue;   // no infill where the frame is about to fail: a wall there would prop it
    const yb = s * STOREY, T = 0.19;
    const w = bay.along === 'x' ? LX - COL - 0.04 : LZ - COL - 0.04, hgt = (bay.along === 'x' ? HC : HC + BD) - 0.03;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const u = (a - 0.5) * w / 2, y = yb + hgt / 4 + b * hgt / 2 + 0.002 * (b + 1);
      const cx = bay.along === 'x' ? (xs[bay.i] + xs[bay.i + 1]) / 2 + u : xs[bay.i], cz = bay.along === 'x' ? zs[bay.j] : (zs[bay.j] + zs[bay.j + 1]) / 2 + u;
      add({ kind: 'wall', id: 'W' + (pile.pieces.length), name: 'Masonry panel, ' + (s ? 'upper' : 'ground') + ' storey', level: s, density: RHO.masonry, p: [cx, y, cz],
        boxes: [{ o: [0, 0, 0], h: bay.along === 'x' ? [w / 4 - 0.004, hgt / 4 - 0.002, T / 2] : [T / 2, hgt / 4 - 0.002, w / 4 - 0.004] }], meta: { ...bay, s } });
    }
  }
  // contents: desks and steel cabinets. They hold a slab up until the load passes what they can carry, then they crush.
  for (let s = 0; s < 2; s++) for (let n = 0; n < 7; n++) {
    const cab = rnd() < 0.42, yb = s ? HC + BD + PT : 0;
    const h = cab ? [0.45, 0.66, 0.23] : [0.7, 0.37, 0.36];
    const x = (rnd() * 2 - 1) * (LX - 0.9), z = (rnd() < 0.5 ? -1 : 1) * (0.7 + rnd() * (LZ - 1.6)), yaw = rnd() < 0.5 ? 0 : Math.PI / 2;
    add({ kind: 'content', sub: cab ? 'cabinet' : 'desk', id: (cab ? 'K' : 'D') + (pile.pieces.length), name: cab ? 'Steel cabinet' : 'Desk', level: s, density: cab ? 130 : 60, capacity: cab ? 26000 : 7000,
      p: [x, yb + h[1] + 0.002, z], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], boxes: [{ o: [0, 0, 0], h }] });
  }
  pile.massTotal = pile.pieces.reduce((a, p) => a + (p.fixed ? 0 : p.mass), 0);
  return pile;
}

// Fail the supports: the chosen ground-storey columns burst at mid-height (the chunks fly out, the halves are pushed
// off line) and gravity does the rest.
export function trigger(pile) {
  const { world, rnd, info, scenario } = pile;
  const sway = rnd() * Math.PI * 2;
  for (const p of pile.pieces) {
    if (p.fixed || p.meta?.s !== 0 || (p.kind !== 'column' && p.kind !== 'debris')) continue;
    const b = world.getRigidBody(p.handle);
    if (p.kind === 'debris') {
      const ang = Math.atan2(p.meta.b - 0.5, p.meta.a - 0.5) + (rnd() - 0.5) * 0.9, v = 2.6 + rnd() * 3.2;
      b.setLinvel({ x: Math.cos(ang) * v, y: rnd() * 1.2, z: Math.sin(ang) * v }, true); b.setAngvel({ x: (rnd() - 0.5) * 8, y: (rnd() - 0.5) * 8, z: (rnd() - 0.5) * 8 }, true);
      continue;
    }
    const ang = scenario === 'pancake' ? sway + (rnd() - 0.5) * 1.1 : info.failLine === 1 ? (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 1.2 : (info.side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rnd() - 0.5) * 0.9;
    const v = (p.meta.seg === 0 ? 0.6 : 2.7) * (0.75 + rnd() * 0.5), wv = p.meta.seg ? 3.4 : 0.8;
    b.setLinvel({ x: Math.cos(ang) * v, y: 0, z: Math.sin(ang) * v }, true);
    b.setAngvel({ x: Math.sin(ang) * wv, y: 0, z: -Math.cos(ang) * wv }, true);
  }
  for (const p of pile.pieces) if (!p.fixed) world.getRigidBody(p.handle).wakeUp();
  pile.state = 'collapsing'; pile.t = 0;
}

const events = () => (events.q || (events.q = new R.EventQueue(true)));
export function cutTies(pile, world, idx) {
  let n = 0;
  for (const t of pile.ties) if (t.alive && (t.a === idx || t.b === idx)) { const j = world.getImpulseJoint(t.handle); if (j) world.removeImpulseJoint(j, true); if (world === pile.world) t.alive = false; n++; }
  return n;
}

// One step of the live world. Impacts break ties, crush contents and raise dust (dust is drawn only, never measured).
export function stepPile(pile, dust) {
  const { world, pieces } = pile, q = events();
  world.step(q); pile.t += world.timestep;
  q.drainContactForceEvents((ev) => {
    const c1 = world.getCollider(ev.collider1()), c2 = world.getCollider(ev.collider2());
    const f = ev.maxForceMagnitude();
    for (const c of [c1, c2]) {
      const body = c && c.parent(); if (!body) continue;
      const idx = pile.byBody.get(body.handle); if (idx == null) continue;
      const p = pieces[idx]; if (!p.alive || p.fixed) continue;
      if (p.kind === 'content') { if (!p.crushed) crush(pile, p); continue; }
      const k = f / (p.mass * G);
      if (p.kind === 'plank') for (const t of pile.ties) if (t.alive && t.a === idx && k > t.strength) { const j = world.getImpulseJoint(t.handle); if (j) world.removeImpulseJoint(j, true); t.alive = false; pile.tiesBroken = (pile.tiesBroken || 0) + 1; }
      if (dust && k > 20) {
        const last = pile.dustClock.get(idx) || -1; if (pile.t - last < 0.12) continue; pile.dustClock.set(idx, pile.t);
        const tr = body.translation(); dust.push({ x: tr.x, y: Math.max(0.05, tr.y - 0.2), z: tr.z, s: Math.min(1, k / 120), r: p.radius });
      }
    }
  });
}
function crush(pile, p) {
  const { world } = pile, body = world.getRigidBody(p.handle); if (!body) return;
  const old = body.collider(0), b = p.boxes[0], nh = b.h[1] * 0.28;
  const tr = body.translation();
  world.removeCollider(old, true);
  p.boxes = [{ o: [0, 0, 0], h: [b.h[0] * 1.06, nh, b.h[2] * 1.06] }];
  world.createCollider(R.ColliderDesc.cuboid(p.boxes[0].h[0], nh, p.boxes[0].h[2]).setMass(p.mass).setFriction(FRICTION).setRestitution(0), body);
  body.setTranslation({ x: tr.x, y: Math.max(nh, tr.y - (b.h[1] - nh)), z: tr.z }, true);
  p.crushed = true; p.radius = Math.hypot(p.boxes[0].h[0], nh, p.boxes[0].h[2]); pile.crushed = (pile.crushed || 0) + 1; p.dirty = true;
}

// Fastest-moving loose piece, m/s (rotation counted at the piece's corner).
export function maxSpeed(pile, world = pile.world, alive = null) {
  let m = 0;
  for (const p of pile.pieces) { if (!(alive ? alive[p.idx] : p.alive) || p.fixed) continue; const b = world.getRigidBody(p.handle); if (!b || b.isSleeping() || !b.isDynamic()) continue; const v = b.linvel(), w = b.angvel(); const s = Math.hypot(v.x, v.y, v.z) + Math.hypot(w.x, w.y, w.z) * p.radius * 0.5; if (s > m) m = s; }
  return m;
}
// Once the pile is only creeping, raise the damping (dust, crushing and grinding eat the last of the energy) and let it sleep.
export function calm(pile, on = true) {
  for (const p of pile.pieces) { if (!p.alive || p.fixed) continue; const b = pile.world.getRigidBody(p.handle); if (!b) continue; b.setLinearDamping(on ? 2.2 : 0.04); b.setAngularDamping(on ? 3 : 0.08); }
  pile.calmed = on;
}
export function sleepAll(pile) { for (const p of pile.pieces) { if (!p.alive || p.fixed) continue; const b = pile.world.getRigidBody(p.handle); if (b && b.isDynamic()) { b.setLinvel({ x: 0, y: 0, z: 0 }, false); b.setAngvel({ x: 0, y: 0, z: 0 }, false); b.sleep(); } } }
export function activeCount(world) { let n = 0; world.forEachActiveRigidBody(() => { n++; }); return n; }
export function kinetic(pile, world = pile.world) {
  let ke = 0;
  for (const p of pile.pieces) { if (!p.alive || p.fixed) continue; const b = world.getRigidBody(p.handle); if (!b || b.isSleeping()) continue; const v = b.linvel(), w = b.angvel(); ke += 0.5 * p.mass * (v.x * v.x + v.y * v.y + v.z * v.z) + 0.5 * p.mass * 0.2 * p.radius * p.radius * (w.x * w.x + w.y * w.y + w.z * w.z); }
  return ke;
}
// poses: 7 numbers per piece (x y z, quaternion x y z w)
export function readPoses(pile, world = pile.world, out = new Float32Array(pile.pieces.length * 7)) {
  for (const p of pile.pieces) {
    const b = p.alive ? world.getRigidBody(p.handle) : null, o = p.idx * 7;
    if (!b) { out[o + 6] = out[o + 6] || 1; continue; }
    const t = b.translation(), r = b.rotation();
    out[o] = t.x; out[o + 1] = t.y; out[o + 2] = t.z; out[o + 3] = r.x; out[o + 4] = r.y; out[o + 5] = r.z; out[o + 6] = r.w;
  }
  return out;
}
export function poseShift(A, B, o, radius) {
  const d = Math.hypot(B[o] - A[o], B[o + 1] - A[o + 1], B[o + 2] - A[o + 2]);
  const dot = Math.abs(A[o + 3] * B[o + 3] + A[o + 4] * B[o + 4] + A[o + 5] * B[o + 5] + A[o + 6] * B[o + 6]);
  return d + 2 * Math.acos(Math.min(1, dot)) * radius * 0.6;
}

// ---------------------------------------------------------------- snapshots: the "copy of the world"
export function snapshot(pile) {
  return { bytes: pile.world.takeSnapshot(), alive: pile.pieces.map((p) => p.alive), ties: pile.ties.map((t) => t.alive), boxes: pile.pieces.map((p) => p.boxes), crushed: pile.pieces.map((p) => !!p.crushed), nPieces: pile.pieces.length, shores: pile.shores.slice(), t: pile.t };
}
export function restoreWorld(snap) { const w = R.World.restoreSnapshot(snap.bytes); w.timestep = DT; return w; }
export function rollback(pile, snap) {
  pile.world.free(); pile.world = restoreWorld(snap);
  pile.pieces.length = snap.nPieces;
  pile.pieces.forEach((p, i) => { p.alive = snap.alive[i]; p.boxes = snap.boxes[i]; p.crushed = snap.crushed[i]; p.dirty = true; });
  pile.ties.forEach((t, i) => { t.alive = snap.ties[i]; });
  pile.shores = snap.shores.slice(); pile.byBody = new Map(pile.pieces.map((p) => [p.handle, p.idx])); pile.t = snap.t;
}

// ---------------------------------------------------------------- contact forces (the load path)
// Wake the pile, solve a few steps, and read every contact's normal impulse. force = impulse / dt.
// One step's contact impulses jitter, so the forces are averaged over `samples` readings taken two steps apart.
export function measureContacts(pile, world = pile.world, { warm = 12, samples = 24, wake = true } = {}) {
  const { pieces } = pile, n = pieces.length;
  if (wake) for (const p of pieces) if (p.alive && !p.fixed) world.getRigidBody(p.handle)?.wakeUp();
  for (let k = 0; k < warm; k++) world.step();
  const acc = new Map(), loadAbove = new Float32Array(n), support = new Float32Array(n);
  for (let k = 0; k < samples; k++) { if (k) { world.step(); world.step(); } readContacts(pile, world, acc, 1 / samples); }
  return foldContacts(pile, acc, loadAbove, support);
}
// Add one reading of every contact's normal force (impulse / dt) into acc, weighted.
export function readContacts(pile, world, acc, w = 1) {
  const { pieces } = pile, dt = world.timestep;
  const visit = (p, c) => {
    world.contactPairsWith(c, (c2) => {
      const b2 = c2.parent(); const j = b2 ? pile.byBodyAny(world, b2.handle) : -1;
      if (j >= 0 && (j < p.idx || !pieces[j].alive)) return;
      if (p.fixed && j < 0) return;
      world.contactPair(c, c2, (man, flipped) => {
        let imp = 0; const m = man.numContacts(); for (let i = 0; i < m; i++) imp += man.contactImpulse(i);
        if (!(imp > 0)) return;
        const nrm = man.normal(), sgn = flipped ? 1 : -1, F = imp / dt * w;   // force on p = sgn * normal * F
        let e = acc.get(p.idx * 4096 + j); if (!e) { e = { a: p.idx, b: j, F: 0, fy: 0, pt: null, np: 0, n: null }; acc.set(p.idx * 4096 + j, e); }
        e.F += F; e.fy += sgn * nrm.y * F; e.n = [nrm.x * sgn, nrm.y * sgn, nrm.z * sgn];
        const ns = man.numSolverContacts();
        for (let i = 0; i < ns; i++) { const s = man.solverContactPoint(i); if (!s) continue; if (!e.pt) e.pt = [0, 0, 0]; e.np++; e.pt[0] += (s.x - e.pt[0]) / e.np; e.pt[1] += (s.y - e.pt[1]) / e.np; e.pt[2] += (s.z - e.pt[2]) / e.np; }
      });
    });
  };
  for (const p of pieces) { if (!p.alive) continue; const body = world.getRigidBody(p.handle); if (!body) continue; for (let k = 0; k < body.numColliders(); k++) visit(p, body.collider(k)); }
  return acc;
}
function foldContacts(pile, acc, loadAbove, support) {
  const { pieces } = pile; let ground = 0, weight = 0; const edges = [...acc.values()];
  for (const e of edges) {
    const p = pieces[e.a], j = e.b, fy = e.fy;
    if (fy < 0) loadAbove[p.idx] += -fy; else support[p.idx] += fy;
    if (j >= 0) { if (fy > 0) loadAbove[j] += fy; else support[j] += -fy; }
    if (!p.fixed && (j < 0 || pieces[j].fixed)) ground += fy; else if (p.fixed && j >= 0 && !pieces[j].fixed) ground -= fy;
  }
  for (const p of pieces) if (p.alive && !p.fixed) weight += p.mass * G;
  return { edges, loadAbove, support, ground, weight };
}

// ---------------------------------------------------------------- the protected volume (where a person is believed to be)
// box = { c: [x, y, z], h: [hx, hy, hz], yaw }. Returns intrusion (share of the volume now inside a piece), headroom
// (smallest free height above it), and which pieces form its roof.
export function protectedMetrics(pile, world, box) {
  if (!box) return null;
  world.updateSceneQueries?.();
  const cy = Math.cos(box.yaw || 0), sy = Math.sin(box.yaw || 0);
  const W = (u, v, w) => ({ x: box.c[0] + u * cy + w * sy, y: box.c[1] + v, z: box.c[2] - u * sy + w * cy });
  let inside = 0, total = 0; const within = new Set();
  const nx = Math.max(2, Math.round(box.h[0] * 2 / 0.14)), ny = Math.max(2, Math.round(box.h[1] * 2 / 0.14)), nz = Math.max(2, Math.round(box.h[2] * 2 / 0.14));
  for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) for (let c = 0; c < nz; c++) {
    const pt = W(((a + 0.5) / nx * 2 - 1) * box.h[0], ((b + 0.5) / ny * 2 - 1) * box.h[1], ((c + 0.5) / nz * 2 - 1) * box.h[2]);
    let hit = false; world.intersectionsWithPoint(pt, (col) => { if (col.handle !== pile.ground) { hit = true; const b = col.parent(), i = b ? pile.byBodyAny(world, b.handle) : -1; if (i >= 0) within.add(i); return false; } return true; });
    total++; if (hit) inside++;
  }
  let headroom = Infinity; const roof = new Set(); let open = 0, rays = 0;
  for (let a = 0; a < 5; a++) for (let c = 0; c < 3; c++) {
    const o = W((a / 4 * 2 - 1) * box.h[0] * 0.9, box.h[1] * 0.2, (c / 2 * 2 - 1) * box.h[2] * 0.9);
    const hit = world.castRay(new R.Ray(o, { x: 0, y: 1, z: 0 }), 8, false); rays++;
    if (!hit) { open++; continue; }
    const d = hit.timeOfImpact - box.h[1] * 0.8; headroom = Math.min(headroom, Math.max(0, d));
    const b = hit.collider.parent(); if (b) { const i = pile.byBodyAny(world, b.handle); if (i >= 0) roof.add(i); }
  }
  return { intrusion: inside / total, headroom: headroom === Infinity ? 8 : headroom, roof: [...roof], open: open / rays, within: [...within] };
}

// Every loose piece that lies anywhere above the protected volume (rays straight up through the whole stack).
export function overhead(pile, world, box, alive = null) {
  world.updateSceneQueries?.();
  const cy = Math.cos(box.yaw || 0), sy = Math.sin(box.yaw || 0), set = new Set();
  for (let a = 0; a < 5; a++) for (let c = 0; c < 3; c++) {
    const u = (a / 4 * 2 - 1) * box.h[0] * 0.9, w = (c / 2 * 2 - 1) * box.h[2] * 0.9;
    const o = { x: box.c[0] + u * cy + w * sy, y: box.c[1] + box.h[1] * 0.2, z: box.c[2] - u * sy + w * cy };
    world.intersectionsWithRay(new R.Ray(o, { x: 0, y: 1, z: 0 }), 12, false, (hit) => { const b = hit.collider.parent(); if (b) { const i = pile.byBodyAny(world, b.handle); if (i >= 0 && (!alive || alive[i]) && !pile.pieces[i].fixed && pile.pieces[i].kind !== 'shore') set.add(i); } return true; });
  }
  return [...set];
}

// ---------------------------------------------------------------- trials in a copy of the world
// A generator so the caller can spread the work over frames: it yields every few steps and returns the result.
export function* liftTrial(pile, snap, idx, { box = null, base = null, keepPoses = true, keep = false } = {}) {
  const world = restoreWorld(snap), pieces = pile.pieces, p = pieces[idx];
  const body = world.getRigidBody(p.handle);
  const before = readPoses(pile, world);
  pile.ties.forEach((t, k) => { if (snap.ties[k] && (t.a === idx || t.b === idx)) { const j = world.getImpulseJoint(t.handle); if (j) world.removeImpulseJoint(j, true); } });
  body.setBodyType(R.RigidBodyType.KinematicVelocityBased, true);
  body.setLinvel({ x: 0, y: 0.6, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  let peak = 0, steps = 0, quiet = 0;
  for (let s = 0; s < 80; s++) { world.step(); steps++; if (s % 8 === 7) peak = Math.max(peak, keOthers(pile, world, idx, snap)); if (s % 20 === 19) yield; }
  world.removeRigidBody(body);
  for (let s = 0; s < 260; s++) { world.step(); steps++; if (s % 8 === 7) peak = Math.max(peak, keOthers(pile, world, idx, snap)); if (s > 24 && s % 6 === 0) { quiet = maxSpeed(pile, world, snap.alive) < 0.035 ? quiet + 1 : 0; if (quiet >= 3) break; } if (s % 20 === 19) yield; }
  const settled = quiet >= 3;
  const res = summarise(pile, world, snap, before, idx, box, base);
  res.idx = idx; res.peakKE = peak; res.steps = steps; res.settled = settled; res.before = keepPoses ? before : null; if (!keepPoses) res.after = null;
  if (keep) { const alive = snap.alive.slice(); alive[idx] = false; res.snap = { ...snap, bytes: world.takeSnapshot(), alive, ties: snap.ties.map((a, k) => a && pile.ties[k].a !== idx && pile.ties[k].b !== idx) }; }
  world.free();
  return res;
}
function keOthers(pile, world, skip, snap) {
  let ke = 0;
  for (const p of pile.pieces) { if (p.idx === skip || p.fixed || !snap.alive[p.idx]) continue; const b = world.getRigidBody(p.handle); if (!b || b.isSleeping()) continue; const v = b.linvel(); ke += 0.5 * p.mass * (v.x * v.x + v.y * v.y + v.z * v.z); }
  return ke;
}
function summarise(pile, world, snap, before, skip, box, base) {
  const saveAlive = pile.pieces.map((p) => p.alive);
  pile.pieces.forEach((p, i) => { p.alive = snap.alive[i] && i !== skip; });
  const after = readPoses(pile, world);
  const moved = []; let maxDisp = 0, energy = 0;
  for (const p of pile.pieces) {
    if (!p.alive || p.fixed) continue; const o = p.idx * 7;
    const d = poseShift(before, after, o, p.radius);
    energy += p.mass * G * (before[o + 1] - after[o + 1]);
    if (d > 0.02) moved.push({ idx: p.idx, d });
    if (d > maxDisp) maxDisp = d;
  }
  moved.sort((a, b) => b.d - a.d);
  let prot = null, roofLoad = null;
  if (box) {
    prot = protectedMetrics(pile, world, box);
    const con = measureContacts(pile, world, { warm: 4, samples: 10 });
    roofLoad = 0; for (const i of (base?.roof || prot.roof)) if (pile.pieces[i].alive) roofLoad += con.loadAbove[i];
  }
  pile.pieces.forEach((p, i) => { p.alive = saveAlive[i]; });
  return { moved, nMoved: moved.length, maxDisp, energy: Math.max(0, energy), prot, roofLoad, after };
}

// The control run: restore the copy, touch nothing, let it sit for the same time. Whatever moves here is the
// solver's own creep, and it is subtracted from every trial.
export function* controlTrial(pile, snap, { box = null } = {}) {
  const world = restoreWorld(snap), before = readPoses(pile, world);
  for (const p of pile.pieces) if (snap.alive[p.idx] && !p.fixed) world.getRigidBody(p.handle)?.wakeUp();
  for (let s = 0; s < 150; s++) { world.step(); if (s % 20 === 19) yield; }
  const res = summarise(pile, world, snap, before, -1, box, null);
  world.free();
  return res;
}

// Tremor or slide: a horizontal ground acceleration, applied to every loose piece as the inertial force -m a(t).
export function* shakeTrial(pile, snap, { pga = 0.2, kind = 'tremor', seed = 1, box = null, base = null, onStep = null } = {}) {
  const world = restoreWorld(snap), rnd = rng32(seed * 7919 + 13);
  const before = readPoses(pile, world);
  const th = rnd() * Math.PI * 2, f1 = 1.2 + rnd() * 2.6, f2 = 2.5 + rnd() * 4, ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, dur = kind === 'tremor' ? 2.4 : 1.4;
  const dx = Math.cos(th), dz = Math.sin(th);
  const bodies = [];
  for (const p of pile.pieces) if (snap.alive[p.idx] && !p.fixed) { const b = world.getRigidBody(p.handle); if (b) bodies.push([b, p.mass]); }
  const n = Math.round(dur / DT);
  for (let s = 0; s < n; s++) {
    const t = s * DT, env = Math.min(1, t / 0.3, (dur - t) / 0.3);
    let ax, az, ay = 0;
    if (kind === 'tremor') { const a = pga * G * env, s1 = Math.sin(2 * Math.PI * f1 * t + ph1), s2 = Math.sin(2 * Math.PI * f2 * t + ph2); ax = a * (dx * s1 - dz * 0.45 * s2); az = a * (dz * s1 + dx * 0.45 * s2); ay = a * 0.3 * s2; }
    else { const a = pga * G * Math.sin(Math.PI * t / dur) ** 2; ax = a * dx; az = a * dz; }
    for (const [b, m] of bodies) { b.resetForces(true); b.addForce({ x: m * ax, y: m * ay, z: m * az }, true); }
    world.step(); onStep?.(world, s, ax, az); if (s % 20 === 19) yield;
  }
  for (const [b] of bodies) b.resetForces(true);
  for (let s = 0, quiet = 0; s < 220; s++) { world.step(); onStep?.(world, n + s, 0, 0); if (s > 20 && s % 6 === 0) { quiet = maxSpeed(pile, world, snap.alive) < 0.035 ? quiet + 1 : 0; if (quiet >= 3) break; } if (s % 20 === 19) yield; }
  const res = summarise(pile, world, snap, before, -1, box, base);
  res.dir = th; res.seed = seed; res.pga = pga; res.before = before;
  world.free();
  return res;
}

// ---------------------------------------------------------------- shoring
// Rated working loads from the US&R Shoring Operations Guide (FEMA / US Army Corps of Engineers): a 6x6 timber post
// up to 12 ft carries 20,000 lb; a 4x4 box crib about 24,000 lb (6,000 lb at each of four bearing points).
export const SHORES = {
  post: { label: '6×6 timber post shore', rated: 89000, maxH: 3.66, half: 0.07, note: 'rated 20,000 lb (89 kN) up to 12 ft' },
  crib: { label: '4×4 box crib', rated: 107000, maxH: 1.2, half: 0.3, note: 'about 24,000 lb (107 kN); kept under 1.2 m tall here' },
};
// Find the gap under a clicked point and build the shore to fit it. Returns null with a reason when it cannot.
export function probeShore(pile, pt, type) {
  const { world } = pile, S = SHORES[type]; world.updateSceneQueries?.();
  const down = world.castRay(new R.Ray({ x: pt[0], y: pt[1] - 0.03, z: pt[2] }, { x: 0, y: -1, z: 0 }), 12, false);
  let top = pt[1] - 0.03, bottom = 0;
  // if the click was on top of a piece, drop through it to its underside first
  const start = { x: pt[0], y: pt[1] + 0.02, z: pt[2] };
  let inside = false; world.intersectionsWithPoint({ x: pt[0], y: pt[1] - 0.03, z: pt[2] }, (c) => { if (c.handle !== pile.ground) inside = true; return true; });
  if (inside) {
    let y = pt[1] - 0.03, guard = 0;
    while (guard++ < 60) { y -= 0.04; let still = false; world.intersectionsWithPoint({ x: pt[0], y, z: pt[2] }, (c) => { if (c.handle !== pile.ground) still = true; return true; }); if (!still || y <= 0) break; }
    top = y + 0.04;
    const d2 = world.castRay(new R.Ray({ x: pt[0], y: top - 0.045, z: pt[2] }, { x: 0, y: -1, z: 0 }), 12, false);
    bottom = d2 ? top - 0.045 - d2.timeOfImpact : 0;
  } else { if (!down) return { ok: false, why: 'Nothing to stand a shore on here.' }; bottom = pt[1] - 0.03 - down.timeOfImpact; const up = world.castRay(new R.Ray(start, { x: 0, y: 1, z: 0 }), 12, false); if (!up) return { ok: false, why: 'There is nothing above this point to hold up.' }; top = start.y + up.timeOfImpact; }
  const h = top - bottom;
  if (h < 0.18) return { ok: false, why: 'The gap here is under 18 cm. Nothing to shore.' };
  if (h > S.maxH) return { ok: false, why: 'The gap is ' + h.toFixed(2) + ' m. Too tall for a ' + S.label.toLowerCase() + '.' };
  return { ok: true, x: pt[0], z: pt[2], bottom, top, h };
}
export function addShore(pile, probe, type) {
  const S = SHORES[type], { world } = pile, hy = probe.h / 2 - 0.004;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(probe.x, probe.bottom + probe.h / 2, probe.z));
  world.createCollider(R.ColliderDesc.cuboid(S.half, hy, S.half).setFriction(0.8).setRestitution(0), body);
  const idx = pile.pieces.length;
  const piece = { idx, alive: true, fixed: true, handle: body.handle, mass: 0, radius: Math.hypot(S.half, hy), kind: 'shore', sub: type, id: 'SH' + (pile.shores.length + 1), name: S.label, level: 0, density: 0, p: [probe.x, probe.bottom + probe.h / 2, probe.z], home: [probe.x, probe.bottom + probe.h / 2, probe.z], boxes: [{ o: [0, 0, 0], h: [S.half, hy, S.half] }], rated: S.rated, height: probe.h };
  pile.pieces.push(piece); pile.byBody.set(body.handle, idx); pile.shores.push(idx);
  for (const p of pile.pieces) if (p.alive && !p.fixed) world.getRigidBody(p.handle)?.wakeUp();
  return piece;
}
export function removePiece(pile, idx) {
  const p = pile.pieces[idx]; if (!p || !p.alive) return;
  cutTies(pile, pile.world, idx);
  const b = pile.world.getRigidBody(p.handle); if (b) pile.world.removeRigidBody(b);
  p.alive = false;
  for (const q of pile.pieces) if (q.alive && !q.fixed) pile.world.getRigidBody(q.handle)?.wakeUp();
}
// Start a real lift in the live world: cut the ties, then raise the piece on a crane at 0.6 m/s.
export function beginLift(pile, idx) {
  const p = pile.pieces[idx], b = pile.world.getRigidBody(p.handle); if (!b) return false;
  cutTies(pile, pile.world, idx);
  b.setBodyType(R.RigidBodyType.KinematicVelocityBased, true); b.setLinvel({ x: 0, y: 0.6, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true);
  return true;
}

// A second pile object on a restored copy of the world, so the live step (ties that break, furniture that crushes)
// runs there too and the original is never touched.
export function fork(pile, snap) {
  const f = { ...pile, world: restoreWorld(snap), pieces: pile.pieces.slice(0, snap.nPieces).map((p, i) => ({ ...p, alive: snap.alive[i], boxes: snap.boxes[i], crushed: snap.crushed[i] })), ties: pile.ties.map((t, i) => ({ ...t, alive: snap.ties[i] })), shores: snap.shores.slice(), dustClock: new Map(), t: snap.t, tiesBroken: 0, crushed: 0 };
  f.byBody = new Map(f.pieces.map((p) => [p.handle, p.idx])); f.byBodyAny = (w, h) => { const i = f.byBody.get(h); return i == null ? -1 : i; };
  return f;
}
// A jack: a steel head driven up at a set speed under one point of a piece. It is a real body in the world, so the
// force it carries is the solver's contact force.
export const JACK = { half: [0.13, 0.03, 0.13], speed: 0.11, rise: 0.34 };
export function addJack(pile, at) {
  const { world } = pile, hy = JACK.half[1];
  const body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(at.x, at.top - hy - 0.004, at.z));
  const col = world.createCollider(R.ColliderDesc.cuboid(...JACK.half).setFriction(0.9).setRestitution(0), body);
  return { body, col, y0: at.top - hy - 0.004 };
}
export function forceOn(world, col) {
  let F = 0; const dt = world.timestep;
  world.contactPairsWith(col, (c2) => world.contactPair(col, c2, (man) => { const m = man.numContacts(); for (let i = 0; i < m; i++) F += man.contactImpulse(i) * Math.abs(man.normal().y); }));
  return F / dt;
}
