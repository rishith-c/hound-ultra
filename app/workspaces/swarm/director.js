// The director for Demo mode: reads the live run, picks shots and a playback speed, and says what is happening.
// It never changes the search, except that the Demo run is started with one scripted beacon failure at a fixed time (failAt).
const DEG = Math.PI / 180;
export function createDirector({ scene, live, world, onCaption, onEnd, failAt = 0 }) {
  const S = live.state, [bx, by] = world.base, cx = world.W * world.RES / 2, cy = world.H * world.RES / 2, out = Math.atan2(bx - cx, -(by - cy));
  let phase = '', t = 0, lastEv = 0, lead = null, seenLeads = new Set(), failed = false, done = false, speed = 4, want = 4, total = 0, sinceLead = 9, confirmed = false, relay = null, az = out, lost = [], said = '', backAt = 0;
  // the direction the camera can look from with the fewest known walls in the way, near a preferred angle
  const openAz = (p, want) => { let best = want, bs = -1e9; for (let q = 0; q < 24; q++) { const a = (q / 24) * Math.PI * 2, dx = Math.sin(a), dy = -Math.cos(a); let d = 0.6; for (; d < 5; d += 0.25) { const i = Math.floor((p[0] + dx * d) / world.RES), j = Math.floor((p[1] + dy * d) / world.RES); if (S.known[j * world.W + i] === 2) break; } const s = d - 0.9 * Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want))); if (s > bs) { bs = s; best = a; } } return best; };
  const pct = (p) => (p > 0.99 ? 'over 99 %' : Math.round(p * 100) + ' %');
  // aim beside a point, so that it sits up and to the left of the words and figures
  const aside = (p, az, d, k = 1) => [p[0] + (Math.cos(az) * 0.11 + Math.sin(az) * 0.07) * d * k, p[1] + (Math.sin(az) * 0.11 - Math.cos(az) * 0.07) * d * k];
  const toC = (k) => [bx + (cx - bx) * k, by + (cy - by) * k];
  const rovers = () => S.robots.filter((r) => r.kind === 'rover' && (r.mode === 'explore' || r.mode === 'lead'));
  const near = (b, R) => S.robots.filter((r) => Math.hypot(r.x - b.x, r.y - b.y) < R);
  function go(p, extra) {
    phase = p; t = 0;
    if (p === 'open') { scene.film({ p: toC(0.02), y: 0.9, d: 13, el: 13 * DEG, az: out + 0.95, st: 2.2, drift: -0.035 }, true); want = 3.2; onCaption(S.mix.rovers + ' rovers and ' + S.mix.drones + ' drones leave base. What is inside the buildings is unknown.'); }
    else if (p === 'crane') { az = out + 0.42; scene.film({ p: toC(0.62), y: 2, d: 88, el: 31 * DEG, az, st: 4.6, drift: -0.02 }); want = 9; onCaption('Assignment spreads the machines over the edges of the unknown.'); }
    else if (p === 'follow') { const inside = rovers().filter((r) => world.indoor[(Math.floor(r.y / world.RES) * world.W) + Math.floor(r.x / world.RES)]); const c = (inside.length ? inside : rovers()).sort((a, b) => Math.hypot(b.x - bx, b.y - by) - Math.hypot(a.x - bx, a.y - by))[0]; if (!c) return go('wide'); scene.film({ id: c.id, d: 25, el: 34 * DEG, az: az + 0.35, st: 2.4, drift: 0.045 }); want = 6.5; onCaption(c.id + (inside.includes(c) ? ' is inside.' : ' takes the far edge.') + ' Walls appear only where its sensor has looked.'); }
    else if (p === 'wide') { scene.film({ p: toC(1.02), y: 2, d: 108, el: 40 * DEG, az: out + 0.2, st: 3.6, drift: -0.02 }); want = 12; onCaption('One shared map. Every radio thread is a live path back to base.'); }
    else if (p === 'fail') { const a = extra, n = a.load || 0; lost = S.robots.filter((r) => S.events.some((e) => e.robot === r.id && e.t >= a.failedAt && e.t < a.failedAt + 1 && /lost its path/.test(e.text))); let x = a.x, y = a.y, span = 8; for (const r of lost) { x += r.x; y += r.y; span = Math.max(span, Math.hypot(r.x - a.x, r.y - a.y)); } x /= 1 + lost.length; y /= 1 + lost.length; const dd = Math.min(74, 30 + span * 1.2); scene.film({ p: aside([x, y], out + 0.5, dd), y: 1.6, d: dd, el: 34 * DEG, az: out + 0.5, st: 1.7, drift: 0.03 }); speed = Math.min(speed, 0.12); want = 0.12; said = 'fail'; backAt = 0; onCaption('Beacon ' + a.id.slice(1) + ' goes silent. It was carrying ' + n + ' machine' + (n === 1 ? '' : 's') + '.'); }
    else if (p === 'lead') { lead = extra; seenLeads.add(lead.id); scene.film({ p: lead.pos, y: 0.8, d: 40, el: 53 * DEG, az: openAz(lead.pos, out + 0.6), st: 2.1, drift: 0.05 }); want = 3; const n = (lead.bids || []).filter((b) => b.eligible).length; onCaption('Possible person, ' + pct(lead.p) + '. ' + (lead.second ? lead.winner + ' and ' + lead.second + ' go, from two sides.' : n ? n + ' machine' + (n === 1 ? '' : 's') + ' bid for the second look.' : 'Bids open.')); }
    else if (p === 'hold') { const ha = openAz(lead.pos, out + 0.9) - 0.12, hd = lead.fix ? 20 : 16.5; scene.film({ p: aside(lead.pos, ha, hd, 0.7), y: 0.7, d: hd, el: (lead.fix ? 48 : 37) * DEG, az: ha, st: 2.2, drift: 0.035 }); speed = Math.min(speed, 1); want = lead.fix ? 0.3 : 1.2; onCaption((lead.fix ? 'Two bearings cross. Person, ' : 'Person confirmed, ') + pct(lead.p) + ', marked for the rescue team.'); }
    else if (p === 'final') { scene.film({ p: [cx, cy - 2], y: 0, d: 128, el: 46 * DEG, az: out + 0.1, st: 4.2, drift: -0.03 }); want = 24; onCaption('The search goes on until the floor is mapped.'); }
  }
  const api = {
    phase: () => phase,
    update(dt) {
      if (done) return speed; t += dt; total += dt; sinceLead += dt;
      if (!phase) go('open'); if (S.t < 1 && live.buffered() < 1) { t = 0; return 0; }
      let fresh = null; for (const e of S.events) if (e.id > lastEv) { lastEv = e.id; if (e.relay && e.level === 'alert') fresh = S.relays.find((b) => b.id === e.relay); }
      if (fresh) { failed = true; relay = fresh; if (phase !== 'hold' && phase !== 'final' && phase !== 'lead') go('fail', fresh); }
      const L = S.leads.find((l) => !seenLeads.has(l.id) && l.winner && (l.status === 'assigned' || l.status === 'listening'));
      const canLead = L && L.indoor && !confirmed && failed && (L.second || S.m.coverage > 0.9) && (phase === 'wide' || phase === 'follow' || (phase === 'crane' && t > 4));
      if (canLead) go('lead', L);
      if (phase === 'open' && t > 5.2) go('crane');
      else if (phase === 'crane' && t > 8.5) go('follow');
      else if (phase === 'follow') { if (t > 10 && (failed || S.t > failAt + 70)) go('wide'); }
      else if (phase === 'fail') {
        const still = lost.filter((r) => r.link.ok === false);
        if (said === 'fail' && t > 1.8) { said = 'lost'; want = lost.length ? 0.14 : 1.6; if (lost.length) onCaption(lost.map((r) => r.id).join(' and ') + (lost.length === 1 ? ' drops' : ' drop') + ' off the mesh and ' + (lost.length === 1 ? 'plans its' : 'plan their') + ' own way back.'); }
        if (said === 'lost' && t > 4.2) want = Math.min(2, want + dt * 0.5); if (said === 'lost' && t > 4.2 && (!still.length || t > 13)) { said = 'back'; backAt = t; want = 0.35; const ev = S.events.filter((e) => /re-routed/.test(e.text) && e.t >= relay.failedAt).length; onCaption(lost.length ? (still.length ? 'Still out of reach: ' + still.map((r) => r.id).join(', ') + '.' : lost.map((r) => r.id).join(' and ') + (lost.length === 1 ? ' finds its' : ' find their') + ' own way back onto the mesh.') : ev + ' machine' + (ev === 1 ? '' : 's') + ' re-routed. No one was cut off.'); }
        if (said === 'back' && t > backAt + 3.6) go(S.m.coverage < 0.4 ? 'follow' : 'wide');
      }
      else if (phase === 'wide') { if (t > 16 && !confirmed) { go(S.m.coverage > 0.9 ? 'final' : 'follow'); } }
      else if (phase === 'lead') {
        const l = S.leads.find((x) => x.id === lead.id);
        if (l) { if (l.status === 'assigned' && t > 2.6) { want = 9; if (!api.w || api.w !== l.id) { api.w = l.id; onCaption(l.second ? l.winner + ' and ' + l.second + ' close in. The search continues.' : l.winner + ' wins and goes. The search continues.'); scene.film({ p: l.pos, y: 0.8, d: 29, el: 36 * DEG, az: out + 0.75, st: 3, drift: 0.05 }); } }
          if (l.status === 'listening') { want = 5.5; if (api.l !== l.id) { api.l = l.id; onCaption(l.second ? l.winner + ' and ' + l.second + ' listen from two sides.' : l.winner + ' stops and listens.'); scene.film({ p: l.pos, y: 0.8, d: 22, el: 38 * DEG, az: openAz(l.pos, out + 0.8) - 0.3, st: 3, drift: 0.04 }); } }
          if (l.status === 'confirmed') { confirmed = true; lead = l; go('hold'); }
          else if (l.status === 'rejected' || l.status === 'open') { if (api.r !== l.id) { api.r = l.id; t = 0; want = 2; onCaption(l.status === 'open' ? 'A possible person. A person decides.' : 'Ruled out: the second look found no one.'); } else if (t > 2.4) go('wide'); }
          if (t > 30) go('wide'); }
      }
      else if (phase === 'hold' && t > (lead.fix ? 9 : 7)) go('final');
      else if (phase === 'final') { if (S.m.t95 && !api.f) { api.f = true; want = 6; t = 0; onCaption('95 % of the floor mapped in ' + Math.floor(S.m.t95 / 60) + ':' + String(Math.floor(S.m.t95 % 60)).padStart(2, '0') + ', ' + (S.m.confirmed === 1 ? 'one person' : S.m.confirmed + ' people') + ' found. Simulated.'); } if ((api.f && t > 5) || S.done || t > 26) { done = true; onEnd(); } }
      if (!failed && failAt && S.t > failAt - 7 && S.t < failAt + 2 && phase !== 'lead' && phase !== 'hold') want = Math.min(want, 1.4);      // ease down before the failure
      speed += (want - speed) * (1 - Math.exp(-dt * 1.8)); return speed;
    },
  };
  return api;
}
