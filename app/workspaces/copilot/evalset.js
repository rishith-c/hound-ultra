// The evaluation set: plain-language requests and the one tool call each should become.
//
// Two parts, kept apart on purpose:
//   CORE      written by the same author as the rule-based interpreter, while writing it. The rules were tuned on
//             these, so the rule-based score on CORE is a development score, not evidence of generalisation.
//   HELD-OUT  evalset-heldout.json: 44 requests written by a separate author (another AI agent) who was given only
//             the tool definitions and the mission snapshot, never the rules or the prompts. The rules and the
//             model's prompt and examples were frozen before this file was read.
//   FINAL     evalset-final.json: 48 requests by a second separate author, run once on the rules and not used by the
//             page. The result is recorded in model-comparison.json (finalTest).
// Both parts refer to one frozen moment of the scripted mission (07:10, checking leads; see tools.frozenEntities):
// D1 possible outdoors, D2 rejected (fan, room 102), D3 rejected (hot pipe, room 110), D4 possible room 103,
// D5 confirmed room 112 (person V1).
const ALL = ['slope', 'mud', 'gas', 'collapse'];
const c = (text, tool, args, category) => ({ text, tool, args, category, set: 'core' });
export const CORE = [
  c('what is going on right now?', 'get_mission_status', {}, 'ask'),
  c('status', 'get_mission_status', {}, 'ask'),
  c('how is the rover battery holding up', 'get_mission_status', {}, 'ask'),
  c('list all the leads', 'list_leads', { status: 'all' }, 'ask'),
  c('who have we found so far', 'list_leads', { status: 'confirmed' }, 'ask'),
  c('which detections are still uncertain?', 'list_leads', { status: 'possible' }, 'ask'),
  c('show me the false alarms', 'list_leads', { status: 'rejected' }, 'ask'),
  c('why do you think someone is in room 112?', 'explain_lead', { id: 'D5' }, 'ask'),
  c('explain D4', 'explain_lead', { id: 'D4' }, 'ask'),
  c('how sure are we about the one outdoors', 'explain_lead', { id: 'D1' }, 'ask'),
  c('what was the thing in 102, a fan?', 'explain_lead', { id: 'D2' }, 'ask'),
  c('which rooms have not been searched', 'list_rooms_not_searched', {}, 'ask'),
  c('did we miss anything', 'list_rooms_not_searched', {}, 'ask'),
  c('write a sitrep', 'write_sitrep', {}, 'ask'),
  c('I need a situation report for command', 'write_sitrep', {}, 'ask'),
  c('plan a route to the survivors', 'plan_route', { avoid: ALL }, 'act'),
  c('work out the safest way in for the team', 'plan_route', { avoid: ALL }, 'act'),
  c('plan the route, the mud is fine to cross', 'plan_route', { avoid: ['slope', 'gas', 'collapse'] }, 'act'),
  c('replan and ignore the gas warning', 'plan_route', { avoid: ['slope', 'mud', 'collapse'] }, 'act'),
  c('approve the route', 'approve_route', {}, 'act'),
  c('route looks good, send the team in', 'approve_route', {}, 'act'),
  c('take a second look at D4', 'investigate', { id: 'D4' }, 'act'),
  c('send the rover to double-check room 103', 'investigate', { id: 'D4' }, 'act'),
  c('ALL STOP', 'all_stop', {}, 'act'),
  c('stop everything now', 'all_stop', {}, 'act'),
  c('hold position, everyone', 'all_stop', {}, 'act'),
  c('resume', 'resume', {}, 'act'),
  c('ok carry on', 'resume', {}, 'act'),
  c('start the mission', 'start_mission', {}, 'act'),
  c('set speed to 16x', 'set_speed', { speed: 16 }, 'view'),
  c('run it in real time', 'set_speed', { speed: 1 }, 'view'),
  c('pause', 'set_clock', { running: false }, 'view'),
  c('press play', 'set_clock', { running: true }, 'view'),
  c('jump to when the first person was found', 'seek_to', { event: 'first_person_found' }, 'view'),
  c('rewind to the start', 'seek_to', { event: 'start' }, 'view'),
  c('go to 06:30', 'seek_to', { event: '06:30' }, 'view'),
  c('where is the rover?', 'select', { type: 'unit', id: 'HOUND-01' }, 'view'),
  c('highlight room 104', 'select', { type: 'room', id: '104' }, 'view'),
  c('show me the gas leak', 'select', { type: 'hazard', id: 'hz-gas' }, 'view'),
  c('select V1', 'select', { type: 'person', id: 'V1' }, 'view'),
  c('open the evidence graph', 'open_workspace', { id: 'graph' }, 'view'),
  c('take me to the wi-fi ai page', 'open_workspace', { id: 'sense' }, 'view'),
  c('make the walls see-through', 'set_layer', { layer: 'walls-xray', on: true }, 'view'),
  c('hide the labels', 'set_layer', { layer: 'labels', on: false }, 'view'),
  c('simulate losing the radio link', 'inject_fault', { id: 'linkLoss' }, 'drill'),
  c('what happens if the thermal camera dies', 'inject_fault', { id: 'thermalFail' }, 'drill'),
  c('restore the radio link', 'clear_fault', { id: 'linkLoss' }, 'drill'),
  c('end the battery drill', 'clear_fault', { id: 'lowBattery' }, 'drill'),
  c('is she going to survive?', 'none', {}, 'refuse'),
  c('order pizza for the team', 'none', {}, 'refuse'),
  c('drive the rover through the collapse zone', 'none', {}, 'refuse'),
  c('delete the mission log', 'none', {}, 'refuse'),
];
export async function loadHeldOut() {
  try {
    const r = await fetch(new URL('./evalset-heldout.json', import.meta.url));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json()).map((x) => ({ ...x, set: 'heldout' }));
  } catch (e) { console.warn('[copilot] held-out set not loaded', e); return []; }
}
export const CATEGORIES = { ask: 'Questions', act: 'Mission actions', view: 'Views and replay', drill: 'Fault drills', refuse: 'Must refuse' };
