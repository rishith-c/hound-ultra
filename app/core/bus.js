// Tiny publish/subscribe bus. One instance is shared by the whole console (ctx.bus).
// bus.on(type, fn) returns an unsubscribe function. bus.emit(type, payload) calls listeners synchronously.
// A listener that throws is logged and does not stop the others.
export function createBus() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);
    },
    once(type, fn) {
      const off = this.on(type, (p) => { off(); fn(p); });
      return off;
    },
    emit(type, payload) {
      const set = map.get(type);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(payload); } catch (e) { console.error(`[bus] listener for "${type}" failed`, e); }
      }
    },
  };
}
