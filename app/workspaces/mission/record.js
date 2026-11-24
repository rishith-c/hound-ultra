// A small simulator plug-in that keeps the history the timeline needs: what each unit was doing, and every reading.
// It runs inside the simulator (sim.use), so it is rebuilt exactly when the mission is replayed by sim.seek().
let installed = false;
export function installRecorder(sim) {
  if (installed) return; installed = true;
  sim.use({
    init(api) { api.state.rec = { act: {}, readings: [], tele: [], lastAt: null, teleT: -99 }; },
    step(dt, api) {
      const S = api.state, rec = S.rec; if (!rec) return;
      for (const u of Object.values(S.units)) {
        const mode = S.hold && u.mode !== 'landed' && u.mode !== 'idle' ? 'hold' : u.mode, list = (rec.act[u.id] ||= []), last = list[list.length - 1];
        if (last && last.mode === mode) last.t1 = S.t; else list.push({ mode, t0: S.t - dt, t1: S.t });
      }
      if (S.sensors.at != null && S.sensors.at !== rec.lastAt) {
        rec.lastAt = S.sensors.at; const c = S.sensors.csi || {};
        rec.readings.push({ t: S.sensors.at, stop: S.sensors.stop, ok: !!c.ok, person: c.person, moving: c.moving, says: !!c.says, sample: c.sample, ms: c.ms, reason: c.reason, radar: S.sensors.radar.targets.length, thermal: S.sensors.thermal?.ok ? S.sensors.thermal.blobs.length : -1 });
      }
      if (S.t - rec.teleT >= 5) { rec.teleT = S.t; const r = S.units['HOUND-01']; rec.tele.push([S.t, r.battery, r.link]); }
    },
  });
}
