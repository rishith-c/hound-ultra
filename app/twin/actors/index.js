// Everything in the twin that moves, glows or tells the story (twin-actors).
// twin-core imports ACTORS and calls actor.create(t) for each one; see docs/ARCHITECTURE.md, "Inside the twin".
//
// Each actor is loaded on its own, so one file that fails to load can never take the others down with it.
const FILES = ['coverage', 'hazards', 'scan', 'routes', 'markers', 'sensing', 'people', 'team', 'drone', 'rover'];

const loaded = await Promise.all(FILES.map((name) =>
  import('./' + name + '.js').then((m) => m.default).catch((err) => { console.warn('[twin] actor "' + name + '" did not load', err); return null; })));

export const ACTORS = loaded.filter((a) => a && typeof a.create === 'function');
export default ACTORS;
