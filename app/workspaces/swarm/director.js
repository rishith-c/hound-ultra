// The director for Demo mode: reads the live run, picks shots and a playback speed, and says what is happening.
// It never changes the search, except for one scripted beacon failure that shows the mesh re-routing.
const DEG = Math.PI / 180;
export function createDirector({ scene, live, world, onCaption, onEnd, failBeacon, reduced }) {
  const S = live.state, [bx, by] = world.base, cx = world.W * world.RES / 2, cy = world.H * world.RES / 2, out = Math.atan2(bx - cx, -(by - cy));
  let phase = '', t = 0, lastEv = 0, lead = null, seenLeads = new Set(), failed = false, failAsked = false, done = false, speed = 4, want = 4, total = 0, sinceLead = 9, confirmed = false, relay = null, az = out;
  // the direction the camera can look from with the fewest known walls in the way, near a preferred angle
  const openAz = (p, want) => { let best = want, bs = -1e9; for (let q = 0; q < 24; q++) { const a = (q / 24) * Math.PI * 2, dx = Math.sin(a), dy = -Math.cos(a); let d = 0.6; for (; d < 5; d += 0.25) { const i = Math.floor((p[0] + dx * d) / world.RES), j = Math.floor((p[1] + dy * d) / world.RES); if (S.known[j * world.W + i] === 2) break; } const s = d - 0.9 * Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want))); if (s > bs) { bs = s; best = a; } } return best; };
  const toC = (k) => [bx + (cx - bx) * k, by + (cy - by) * k];
  const rovers = () => S.robots.filter((r) => r.kind === 'rover' && (r.mode === 'explore' || r.mode === 'lead'));
  const near = (b, R) => S.robots.filter((r) => Math.hypot(r.x - b.x, r.y - b.y) < R);
  function go(p, extra) {
    phase = p; t = 0;
    if (p === 'open') { scene.film({ p: toC(0.02), y: 0.9, d: 13, el: 13 * DEG, az: out + 0.95, st: 2.2, drift: -0.035 }, true); want = 3.2; onCaption(S.mix.rovers + ' rovers and ' + S.mix.drones + ' drones leave base. What is inside the buildings is unknown.'); }
    else if (p === 'crane') { az = out + 0.42; scene.film({ p: toC(0.62), y: 2, d: 88, el: 31 * DEG, az, st: 4.6, drift: -0.02 }); want = 9; onCaption('Each machine takes a different edge of the unknown, so no two search the same room.'); }
    else if (p === 'follow') { const inside = rovers().filter((r) => world.indoor[(Math.floor(r.y / world.RES) * world.W) + Math.floor(r.x / world.RES)]); const c = (inside.length ? inside : rovers()).sort((a, b) => Math.hypot(b.x - bx, b.y - by) - Math.hypot(a.x - bx, a.y - by))[0]; if (!c) return go('wide'); scene.film({ id: c.id, d: 25, el: 34 * DEG, az: az + 0.35, st: 2.4, drift: 0.045 }); want = 6.5; onCaption(c.id + (inside.includes(c) ? ' is inside.' : ' takes the far edge.') + ' Walls appear only where its sensor has looked.'); }
    else if (p === 'wide') { scene.film({ p: toC(1.02), y: 2, d: 108, el: 40 * DEG, az: out + 0.2, st: 3.6, drift: -0.02 }); want = 12; onCaption('One shared map. Every radio thread is a live path back to base.'); }
    else if (p === 'fail') { const a = extra; scene.film({ p: [a.x, a.y], y: 1.4, d: 40, el: 33 * DEG, az: out + 0.55, st: 1.8, drift: 0.03 }); want = 2.6; const n = a.load || 0; onCaption('Beacon ' + a.id.slice(1) + ' fails. It was carrying ' + n + ' machine' + (n === 1 ? '' : 's') + '.'); }
    else if (p === 'lead') { lead = extra; seenLeads.add(lead.id); scene.film({ p: lead.pos, y: 0.8, d: 40, el: 53 * DEG, az: openAz(lead.pos, out + 0.6), st: 2.1, drift: 0.05 }); want = 3; const n = (lead.bids || []).filter((b) => b.eligible).length; onCaption('Possible person, ' + Math.round(lead.p * 100) + ' %. ' + (n ? n + ' machine' + (n === 1 ? '' : 's') + ' bid for the second look.' : 'Bids open.')); }
    else if (p === 'hold') { scene.film({ p: lead.pos, y: 0.7, d: 16.5, el: 37 * DEG, az: openAz(lead.pos, out + 0.9) - 0.12, st: 2.8, drift: 0.035 }); want = 1.2; onCaption('Person confirmed, ' + Math.round(lead.p * 100) + ' %. Marked for the rescue team.'); }
    else if (p === 'final') { scene.film({ p: [cx, cy - 2], y: 0, d: 128, el: 46 * DEG, az: out + 0.1, st: 4.2, drift: -0.03 }); want = 24; onCaption('The others never stopped searching.'); }
  }
  const api = {
    phase: () => phase,
    update(dt) {
      if (done) return speed; t += dt; total += dt; sinceLead += dt;
      if (!phase) go('open'); if (S.t < 1 && live.buffered() < 1) { t = 0; return 0; }
      let fresh = null; for (const e of S.events) if (e.id > lastEv) { lastEv = e.id; if (e.relay && e.level === 'alert') fresh = S.relays.find((b) => b.id === e.relay); }
      if (fresh) { failed = true; relay = fresh; if (phase !== 'hold' && phase !== 'final' && !(phase === 'lead')) go('fail', fresh); }
      const L = S.leads.find((l) => !seenLeads.has(l.id) && l.winner && (l.status === 'assigned' || l.status === 'listening'));
      const canLead = L && L.indoor && !confirmed && (phase === 'wide' || phase === 'follow' || (phase === 'crane' && t > 4) || (phase === 'fail' && t > 4.5));
      if (canLead) go('lead', L);
      if (phase === 'open' && t > 5.2) go('crane');
      else if (phase === 'crane' && t > 8.5) go('follow');
      else if (phase === 'crane' && t > 6 && !failed && !failAsked) { failAsked = true; failBeacon(); }
      else if (phase === 'follow' && t > 7) { if (!failed && !failAsked) { failAsked = true; failBeacon(); } if (t > 8.5) go('wide'); }
      else if (phase === 'fail') { const ev = S.events.filter((e) => /re-routed|lost its path/.test(e.text) && e.t >= relay.failedAt).pop(); if (ev && t > 1.4 && !api.said) { api.said = true; onCaption(ev.text.replace(/^(\w+) re-routed: beacon \d+ failed, now through/, '$1 re-routed through')); } if (t > 6) { api.said = false; go(S.m.coverage < 0.6 ? 'follow' : 'wide'); } }
      else if (phase === 'wide') { if (!failed && !failAsked && t > 2) { failAsked = true; failBeacon(); } if (t > 16 && !confirmed) { go(S.m.coverage > 0.9 ? 'final' : 'follow'); } }
      else if (phase === 'lead') {
        const l = S.leads.find((x) => x.id === lead.id);
        if (l) { if (l.status === 'assigned' && t > 2.6) { if (!l.told) { l.told = lead.told = true; } want = 7; if (!api.w || api.w !== l.id) { api.w = l.id; onCaption(l.winner + ' wins and goes. The others keep searching.'); scene.film({ p: l.pos, y: 0.8, d: 29, el: 36 * DEG, az: out + 0.75, st: 3, drift: 0.05 }); } }
          if (l.status === 'listening') { want = 5.5; if (api.l !== l.id) { api.l = l.id; onCaption(l.winner + ' stands still and listens for 20 s.'); scene.film({ p: l.pos, y: 0.8, d: 22, el: 38 * DEG, az: openAz(l.pos, out + 0.8) - 0.3, st: 3, drift: 0.04 }); } }
          if (l.status === 'confirmed') { confirmed = true; lead = l; go('hold'); }
          else if (l.status === 'rejected' || l.status === 'open') { if (api.r !== l.id) { api.r = l.id; t = 0; want = 2; onCaption(l.status === 'open' ? 'Still only possible. Left for a person to decide.' : 'Ruled out: the second look found no one.'); } else if (t > 2.4) go('wide'); }
          if (t > 30) go('wide'); }
      }
      else if (phase === 'hold' && t > 7) go('final');
      else if (phase === 'final') { if (S.m.t95 && !api.f) { api.f = true; want = 6; t = 0; onCaption('95 % of the floor mapped in ' + Math.floor(S.m.t95 / 60) + ':' + String(Math.floor(S.m.t95 % 60)).padStart(2, '0') + ', ' + (S.m.confirmed === 1 ? 'one person' : S.m.confirmed + ' people') + ' found. Simulated.'); } if ((api.f && t > 5) || S.done || t > 26) { done = true; onEnd(); } }
      speed += (want - speed) * (1 - Math.exp(-dt * 1.8)); return speed;
    },
  };
  return api;
}
