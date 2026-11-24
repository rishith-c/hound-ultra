// The rule-based interpreter: plain patterns, no model. Used when no language model is loaded (or WebGPU is missing)
// and measured against the same test set as the model. It returns one call { tool, args } and the name of the rule
// that fired, or the "none" tool. It goes through exactly the same validation and safety checks afterwards.
//
// These rules were written BEFORE the held-out test phrases were read, and were not changed afterwards, so the
// held-out score in the Evaluation tab is an honest one.
import { HAZARD_KINDS, SPEEDS } from './tools.js';

const has = (s, re) => re.test(s);
const WS_WORDS = [
  ['status', /system check|self.?tests?|what('s| is) real|diagnostics?|health check|ledger|fault drills? (page|screen|workspace)/],
  ['area', /\bvalley\b|terrain|satellite|real map|area map/],
  ['triage', /\btriage\b|who (to reach |goes |do we reach )?first|priorit/],
  ['swarm', /\bswarm\b|multi.?robot|fleet/],
  ['sense', /wi.?fi ai|neural net(work)?|\bcnn\b|\bcsi\b|the network (page|view|screen|workspace)/],
  ['fusion', /\bfusion\b|bayes/],
  ['aerial', /drone (imagery|images?|photos?|pictures?)|aerial/],
  ['scan', /3.?d scan|point cloud|\bvoids?\b|lidar|scan (page|workspace|screen|view)/],
  ['signals', /\bsignals?\b|microphone|tapping|phone finder|acoustic/],
  ['graph', /evidence( graph)?|\bgraph\b/],
  ['report', /hand.?over|\breport\b/],
  ['globe', /quakes?|earthquakes?|\bglobe\b|usgs/],
  ['train', /\btraining\b|practice|practise/],
  ['copilot', /copilot|assistant/],
  ['mission', /\bmission\b|3.?d (view|twin|map)|digital twin|\btwin\b|main (view|screen)/],
];
const LAYER_WORDS = [
  ['walls-xray', /x.?ray|see.?through|transparent|through (the )?walls|walls? (see|trans)|ghost(ed)? walls/],
  ['coverage', /coverage|fog of war|searched area|search(ed)? (overlay|layer)/],
  ['heat', /\bheat\b|thermal (layer|overlay|volumes?)|heat ?map/],
  ['trail', /\btrails?\b|breadcrumbs?|tracks?\b|path taken/],
  ['scan', /point cloud|\bscan\b|swaths?/],
  ['labels', /\blabels?\b|name ?tags|callouts/],
  ['grid', /\bgrid\b/],
  ['sensing', /sensing|sensor (cones?|range|volumes?|reach)|wi.?fi (waves|range|reach)/],
  ['route', /\broute\b|\bpath\b/],
  ['hazards', /hazards?|danger (zones?|areas?)/],
];
const FAULT_WORDS = [
  ['lowBattery', /batter/],
  ['thermalFail', /thermal|ir cam|infra.?red|heat cam/],
  ['badWindow', /corrupt|bad (window|data|input|sample)|garbage|\bnan\b|malformed|bad wi.?fi window/],
  ['csiDropout', /packets?|drop.?outs?|dropping|wi.?fi (loss|drop)|lossy/],
  ['linkLoss', /\blink\b|radio|comms|connection|signal loss|lose (the )?signal|lost (the )?signal|disconnect/],
];
const MOMENT_WORDS = [
  ['route_approved', /approv/],
  ['route_planned', /route|plan(ned|ning)/],
  ['team_arrived', /team (arriv|reach|got|get)|rescuers? (arriv|reach|got|get)|reach(ed|es)? (the )?(first )?(person|survivor)/],
  ['map_ready', /map|survey|drone (finish|was done|is done|land|complet)/],
  ['rover_at_entrance', /entrance|door|rover (arriv|reach|got|get|enter)|went in|goes in/],
  ['first_listen', /listen|first (stop|reading|window)/],
  ['first_possible', /possible|first lead|uncertain|maybe/],
  ['first_person_found', /found|confirm|first (person|survivor|find)|detect(ed|ion)/],
  ['mission_complete', /\bend\b|complete|finish|\bdone\b|\bover\b|last/],
  ['start', /start|begin|zero|\btop\b|launch|kick.?off|0:00|00:00/],
];

function leadRef(s, e, { prefer } = {}) {
  let m = /\bd[\s-]?(\d{1,2})\b/.exec(s); if (m) return 'D' + m[1];
  m = /\bv[\s-]?(\d{1,2})\b/.exec(s); if (m) { const v = e.people.find((p) => p.id === 'V' + m[1]); if (v) return v.detId; }
  m = /\b(10[1-4]|109|11[0-2])\b/.exec(s);
  if (m) { const inRoom = e.leads.filter((d) => d.room === m[1]); const rank = { possible: 0, confirmed: 1, rejected: 2 }; if (inRoom.length) return inRoom.sort((a, b) => rank[a.status] - rank[b.status])[0].id; }
  const one = (list) => (list.length ? list[0].id : null);
  if (has(s, /outdoor|outside|debris|in the open|field|drone (saw|spotted|found|lead|sighting|hit|contact)|aerial (lead|hit|contact)/)) { const r = one(e.leads.filter((d) => d.outdoor)); if (r) return r; }
  if (has(s, /\bfan\b|machine/)) { const r = one(e.leads.filter((d) => d.kind === 'machine')); if (r) return r; }
  if (has(s, /pipe|hot (object|spot|thing)|too hot/)) { const r = one(e.leads.filter((d) => d.kind === 'hot object')); if (r) return r; }
  if (has(s, /false alarm|ruled out|rejected|closed/)) { const r = one(e.leads.filter((d) => d.status === 'rejected')); if (r) return r; }
  if (has(s, /confirmed|survivor|the person|someone is|somebody is|for sure/)) { const r = one(e.leads.filter((d) => d.status === 'confirmed')); if (r) return r; }
  if (has(s, /possible|uncertain|unsure|maybe|unconfirmed|open lead|doubt/)) { const p = e.leads.filter((d) => d.status === 'possible'); const r = one(p.filter((d) => !d.needsTeam && !d.outdoor)) || one(p); if (r) return r; }
  if (prefer === 'possible') { const p = e.leads.filter((d) => d.status === 'possible'); return one(p.filter((d) => !d.needsTeam && !d.outdoor)) || one(p); }
  return null;
}
function thing(s, e) {
  let m = /\bd[\s-]?(\d{1,2})\b/.exec(s); if (m) return { type: 'lead', id: 'D' + m[1] };
  m = /\bv[\s-]?(\d{1,2})\b/.exec(s); if (m) return { type: 'person', id: 'V' + m[1] };
  if (has(s, /rover|hound/)) return { type: 'unit', id: 'HOUND-01' };
  if (has(s, /drone|uav|quad/)) return { type: 'unit', id: 'DRONE-01' };
  if (has(s, /\bteam\b|rescuers|crew|medics/)) return { type: 'unit', id: 'TEAM-1' };
  const hz = (k) => e.hazards.find((h) => h.kind === k);
  if (has(s, /\bgas\b|cylinder|leak/) && hz('gas')) return { type: 'hazard', id: hz('gas').id };
  if (has(s, /\bmud\b/) && hz('mud')) return { type: 'hazard', id: hz('mud').id };
  if (has(s, /slope|landslide|slide/) && hz('slope')) return { type: 'hazard', id: hz('slope').id };
  if (has(s, /collapse|undercut/) && hz('collapse')) return { type: 'hazard', id: hz('collapse').id };
  m = /\b(10[1-4]|109|11[0-2])\b/.exec(s);
  if (m) {
    if (has(s, /person|survivor|victim|casualty/)) { const v = e.people.find((p) => p.room === m[1]); if (v) return { type: 'person', id: v.id }; }
    if (has(s, /lead|detection|contact|possible|hit/)) { const d = e.leads.find((x) => x.room === m[1]); if (d) return { type: 'lead', id: d.id }; }
    return { type: 'room', id: m[1] };
  }
  const id = leadRef(s, e); if (id) { const v = has(s, /survivor|person found|confirmed person/) && e.people.find((p) => p.detId === id); return v ? { type: 'person', id: v.id } : { type: 'lead', id }; }
  return null;
}
function avoidList(s) {
  const word = { slope: /slope|landslide|slide/, mud: /\bmud(dy)?\b/, gas: /\bgas\b|leak|cylinder/, collapse: /collapse|undercut/ };
  const only = /\b(only|just)\b[^.]*\b(avoid|stay (out|clear|away)|keep (out|clear|away))/.test(s);
  if (only) { const keep = HAZARD_KINDS.filter((k) => word[k].test(s)); if (keep.length) return keep; }
  const out = [];
  for (const k of HAZARD_KINDS) {
    const m = word[k].exec(s);
    if (!m) { out.push(k); continue; }
    const before = s.slice(Math.max(0, m.index - 46), m.index), after = s.slice(m.index, m.index + m[0].length + 34);
    const allow = /(ignor\w*|allow\w*|cross\w*|through|accept\w*|never ?mind|don'?t (worry|care|mind) about|do not (worry|care) about|forget( about)?|disregard\w*|risk|straight (over|across)|can (go|cut|pass)|ok to|okay to|fine to|skip(ping)?|not (avoid\w*|worr\w*))[^.;]*$/.test(before) && !/(avoid\w*|stay (out|clear|away)|keep (out|clear|away)|around|not through|no )\s+(of |from )?(the |that |any |all )?(\w+ )?$/.test(before)
      || /^\S+( \w+){0,3} (is|are|'s|s) (fine|ok|okay|acceptable|passable|allowed|not a problem|no problem|safe enough|all right|alright)/.test(after) || /^\S+( \w+){0,2} (doesn'?t|does not|don'?t) matter/.test(after);
    if (!allow) out.push(k);
  }
  return out;
}
function seekTarget(s) {
  let m = /\b(\d{1,2}):([0-5]\d)\b/.exec(s); if (m) return m[1].padStart(2, '0') + ':' + m[2];
  m = /\b(\d{1,2})\s?(m|min|mins|minutes?)\b(?:\s?(?:and\s)?(\d{1,2})\s?(s|sec|secs|seconds?)\b)?/.exec(s); if (m) return m[1].padStart(2, '0') + ':' + String(m[3] || 0).padStart(2, '0');
  m = /\b(\d{1,4})\s?(s|sec|secs|seconds?)\b/.exec(s); if (m) return String(Math.floor(+m[1] / 60)).padStart(2, '0') + ':' + String(+m[1] % 60).padStart(2, '0');
  for (const [id, re] of MOMENT_WORDS) if (re.test(s)) return id;
  return null;
}
const pick = (table, s) => { for (const [id, re] of table) if (re.test(s)) return id; return null; };
const snapSpeed = (x) => SPEEDS.reduce((b, v) => (Math.abs(v - x) < Math.abs(b - x) ? v : b), SPEEDS[0]);

// text: what the operator typed. e: entities (see tools.entitiesOf). Returns { tool, args, rule }.
export function interpret(text, e) {
  const s = ' ' + String(text).toLowerCase().replace(/[’‘]/g, "'").replace(/[“”"]/g, '').replace(/[?!,;]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const call = (tool, args, rule) => ({ tool, args, rule });
  const none = (rule) => call('none', {}, rule);

  // 0. Things this console must not answer or do.
  if (has(s, /(will|going to|gonna|can) (she|he|they|the (person|survivor|victim)) (survive|live|make it|die)|injur|bleed|diagnos|medical|\bpulse\b|heart ?rate|breathing rate|breaths? per|vital signs?|dose|medicat/)) return none('not medical');
  if (has(s, /(drive|go|send|route|cut|walk|path)\b[^.]*\b(into|through|across|over)\b[^.]*\b(collapse|undercut)/) && !has(s, /avoid|around|stay/)) return none('unsafe: collapse zone');
  if (has(s, /\b(delete|erase|wipe|destroy|falsif|fake|hide the (log|evidence)|shut ?down the|format|hack|override the safety|disable (the )?(safety|all.?stop|confirm))/)) return none('destructive');

  // 1. Fault drills (before "stop", "kill", "cut" are read as something else).
  const fault = pick(FAULT_WORDS, s);
  const faulty = fault && has(s, /fault|drill|inject|simulat|fail|dead|dies?\b|offline|lose|lost|loss|drop|corrupt|cut|kill|break|broke|low|restor|clear|fix|back (on|up|online)|recover|reconnect|end|what (happens )?if|pretend|trigger|knock out|take out|jam|unplug|flat|bad|garbage|replace|swap|came back|is back|working again/);
  if (faulty && !has(s, /\b(how much|what('s| is) the|level|percent|status of)\b/)) {
    if (has(s, /\b(clear|restor\w*|fix\w*|end|stop|recover\w*|reconnect\w*|undo|cancel|remove|repair\w*|back (on|up|online)|bring (it |the \w+ )?back|is back|came back|working again|over|finish(ed)? the drill|turn off the|switch off the)\b/) && !has(s, /what (happens )?if|simulat|inject|pretend|trigger/)) return call('clear_fault', { id: fault }, 'clear fault');
    return call('inject_fault', { id: fault }, 'inject fault');
  }

  // 2. The clock (not a safety stop).
  if (has(s, /\b(pause|freeze (time|the (clock|sim\w*|replay|playback))|(stop|hold|halt) (the )?(clock|time|sim\w*|playback|replay))\b/) && !has(s, /unpause/)) return call('set_clock', { running: false }, 'pause clock');
  if (has(s, /\b(unpause|un-pause|play\b|press play|hit play|(start|run|resume|restart|continue) (the )?(clock|time|sim\w*|playback|replay)|let it run|keep (it )?playing|roll (it|the clock))/)) return call('set_clock', { running: true }, 'play clock');

  // 3. Situation report.
  if (has(s, /sit.?rep|situation report|status report|(write|draft|generate|prepare|give me|need|make|compose|put together|type up)\b[^.]*\b(report|brief(ing)?|summary|hand.?over)|brief (me|command|hq|the team)|summary for (command|hq|the chief|the boss)|what do i tell (command|hq)|radio (this|it) in/) && !has(s, /\b(open|go to|switch to|show me the|pull up|bring up)\b[^.]*\breport\b/)) return call('write_sitrep', {}, 'sitrep');

  // 4. Safety stop and resume.
  if (has(s, /\b(all.?stop|stop (everything|all|every|them|it all|now|right now|the (rover|units?|team|mission|search|robot|hound|drone|operation))|halt|freeze|emergency stop|e.?stop|abort|hold (everything|position|all|up|it|your position|fast)|everyone? (stop|hold|freeze)|cease|stand down|kill (the )?(motors|movement)|nobody move|stop stop|\bstop\b\s*$)/)) return call('all_stop', {}, 'all stop');
  if (has(s, /\b(resume|carry on|continue|keep going|release (the )?(hold|stop)|lift (the )?(hold|stop)|back to work|get (going|moving) again|move again|as you were|stand ?down the stop|clear the (stop|hold)|go again|ok(ay)? to (move|go|continue)|all clear|you can (go|move))\b/) && !has(s, /route|plan/)) return call('resume', {}, 'resume');

  // 5. Route: approve, then plan.
  if (has(s, /\b(approv\w*|green.?light|authori[sz]e|sign.?off|sign off on|ok(ay)? the (route|plan)|go with (the|that|this) (route|plan)|send (the |in the )?(team|rescuers|them)( in)?|(route|plan) (is|looks) (good|fine|ok|okay|safe)|accept the (route|plan)|confirm the (route|plan)|execute the (route|plan)|team (is )?(go|clear to (go|move|enter))|go for (the )?(rescue|route)|move the team)/)) return call('approve_route', {}, 'approve route');
  if (has(s, /\bre.?(plan|route)\b|\b(plan|compute|calculate|work out|figure out|find|make|generate|draw|give me|need|get|map out|show me|chart|build)\b[^.]*\b(route|path|way (in|to|there|through)|safest way|approach)\b|\b(route|path|way) (to|for) (the |our )?(person|people|survivors?|them|team|rescuers|casualt)|how (do|can|should) (we|the team|they|i) (get|reach|go)|best way (in|to (reach|get))|safest (way|route|path)|get (the team|us|them|rescuers) (to|in)/) && !has(s, /\b(show|hide|display|turn|toggle)\b[^.]*\b(route|path) (layer|line|overlay)/)) return call('plan_route', { avoid: avoidList(s) }, 'plan route');

  // 6. Replay position.
  if (has(s, /\b(seek|jump|rewind|skip|scrub|fast.?forward|replay|wind|roll) (back |forward |ahead |it |the (mission|replay|clock|tape) )?(to|from|back|forward)?\b|\b(go|take me|bring me|move|get|back|return|cut) (back |forward |ahead |us )?(to|at) (when|where|the (moment|point|time|start|beginning|end|part)|\d)|\bback to (when|the (start|beginning|moment|point))|\bfrom the (start|beginning|top)\b|start over|restart the (mission|replay)|what happened at \d/)) { const ev = seekTarget(s); if (ev) return call('seek_to', { event: ev }, 'seek'); }

  // 7. Speed.
  { let m = /\b(\d{1,2})\s?(x|×|times)\b|\bx\s?(\d{1,2})\b|\bspeed\b[^.\d]{0,12}(\d{1,2})\b/.exec(s);
    if (m) return call('set_speed', { speed: snapSpeed(+(m[1] || m[3] || m[4])) }, 'speed number');
    if (has(s, /real.?time|normal speed|actual speed|1 to 1|one to one|slowest/)) return call('set_speed', { speed: 1 }, 'speed real time');
    if (has(s, /(max\w*|full|top|fastest|highest) (speed|rate)|as fast as|fastest|flat out/)) return call('set_speed', { speed: 32 }, 'speed max');
    if (has(s, /double (the )?speed|twice as fast|two times/)) return call('set_speed', { speed: has(s, /double speed|double the speed$/) && !has(s, /it|up|current/) ? 2 : snapSpeed(e.speed * 2) }, 'speed double');
    if (has(s, /half (the )?speed|half as fast/)) return call('set_speed', { speed: snapSpeed(e.speed / 2) }, 'speed half');
    if (has(s, /speed (it |things |this )?up|go faster|\bfaster\b|hurry (it |this )?up|quicker/)) return call('set_speed', { speed: snapSpeed(e.speed * 2) }, 'speed up');
    if (has(s, /slow (it |things |this )?down|\bslower\b|too fast/)) return call('set_speed', { speed: snapSpeed(e.speed / 2) }, 'slow down'); }

  // 8. What is on screen: a named workspace, a layer, a selected thing.
  const wantsWs = has(s, /\b(open|go to|goto|switch to|take me to|bring up|pull up|navigate to|load|launch|jump to|show me the|show the|let me see the|view the|head to|over to)\b/) || has(s, /workspace|\bpage\b|\btab\b|screen|\bview\b/);
  const ws = pick(WS_WORDS, s), layer = pick(LAYER_WORDS, s);
  const off = has(s, /\b(hide|off|remove|disable|without|lose the|get rid of|drop the|no more|kill the|clear the|solid|opaque|un.?check|stop showing|turn .* off|switch .* off|don'?t show|declutter)\b/);
  const layerVerb = has(s, /\b(show|hide|display|turn|switch|toggle|enable|disable|overlay|layer|see|visible|remove|add|draw|put|without|with|make|let me see|can i see|get rid|lose|drop)\b/);
  if (layer && layerVerb && has(s, /layer|overlay|\bon\b|\boff\b|toggle|enable|disable|hide|see.?through|x.?ray|transparent|visible|turn|switch/) && !(ws && has(s, /workspace|\bpage\b|\btab\b|screen|\bopen\b|go to|switch to/))) return call('set_layer', { layer, on: !off }, 'layer');
  if (ws && wantsWs && !/\bd[\s-]?\d\b/.test(s)) return call('open_workspace', { id: ws }, 'open workspace');

  // 9. A second look at one lead.
  if (has(s, /\b(investigat\w*|second look|closer look|another look|look again|listen again|re.?check|double.?check|go (and )?(look|check|see|listen)|send (the |in the )?(rover|hound|robot|it)|have (a|another) look|take (a|another) look|check (it |that |this |him |her |them )?(out|again)|verify|make sure|get (a |another )?(better|closer|second|another) (look|reading|view|angle)|scan (it |that |this |room \d+ )?again|another (reading|pass|window)|confirm (it|that|this|the (lead|possible|one|contact|detection)|d\d)|go back (to|and))\b/)) { const id = leadRef(s, e, { prefer: 'possible' }); if (id) return call('investigate', { id }, 'investigate'); }

  // 10. Why / how sure about one lead.
  if (has(s, /\b(why|explain|how (sure|confident|certain|reliable|likely|strong)|what makes|evidence|reasons?|reasoning|how do (you|we) know|how did (you|we|it)|what did the sensors|break ?down|tell me (more )?about|details?|what('s| is) (the story|up) with|what do (we|you) (know|have) (about|on)|is (it|that|this|d\d) (really|actually|definitely)|are (you|we) sure|trust|justif|what (is|was|were) (it|that|d\d|(the|that) (thing|one|lead|contact|hit|reading|alarm|signal))|based on what|how come|walk me through|sure about|certain about|confidence (in|on|for))\b/)) { const id = leadRef(s, e); if (id) return call('explain_lead', { id }, 'explain lead'); }

  // 11. What has not been searched.
  if (has(s, /(not|n'?t|never|un)\s?(been |yet )?(searched|checked|covered|cleared|scanned|reached|looked|swept|visited)|(rooms?|areas?|places?|anything|anywhere|where) (are |is )?(left|remaining|still to|outstanding|unchecked|unsearched|to go)|what did we miss|have we missed|did we miss|missed (any|a room|rooms|something|anything)|blind spots?|coverage gaps?|gaps? in (the )?(search|coverage)|left to (search|check|sweep)|chance (someone|anyone|somebody) was missed|residual|still (need|have) to (search|check)|what('s| is) left|search(ed)? everywhere|covered everything|every room|all (the )?rooms (done|searched|clear|checked)|which rooms (are )?(clear|done)/)) return call('list_rooms_not_searched', {}, 'rooms not searched');

  // 12. Select / locate a thing.
  if (has(s, /\b(select|highlight|show|where('s| is| are)?|find|focus|locate|zoom|point|cent(er|re)|look at|track|pick|go to|mark|spot|see|pin|pull up|bring up)\b/) && !has(s, /\b(leads|alarms|detections|contacts|hits|findings|people|survivors|everyone|all of)\b/)) { const th = thing(s, e); if (th) return call('select', th, 'select'); }
  if (ws && has(s, /\b(open|show|see|view|display)\b/)) return call('open_workspace', { id: ws }, 'open workspace (loose)');
  if (layer && layerVerb) return call('set_layer', { layer, on: !off }, 'layer (loose)');

  // 13. Lists of leads.
  if (has(s, /\b(leads?|detections?|contacts?|hits?|findings?|finds?|targets?|alarms?|signs? of life|survivors?|casualt\w+|victims?|people|persons?|anyone|anybody|someone|somebody|who)\b|ruled out|uncertain|possibles?|unconfirmed/)) {
    const st = has(s, /possible|uncertain|\bopen\b|unsure|unconfirmed|pending|maybe|not sure|still need|needs? (a )?(second|check|look)|unresolved|in doubt|doubtful|question/) ? 'possible'
      : has(s, /reject\w*|ruled out|false (alarm|positive)s?|closed|dismiss\w*|decoys?|discard\w*|thrown out|not (a )?(people|person)|wrong/) ? 'rejected'
      : has(s, /found|confirm\w*|survivors?|alive|for sure|definite\w*|certain\b|people|persons?|casualt\w+|victims?|anyone|anybody|someone|somebody|who|located|signs? of life/) && !has(s, /\b(all|every|list (the )?leads|leads)\b/) ? 'confirmed' : 'all';
    return call('list_leads', { status: st }, 'list leads');
  }

  // 14. Status.
  if (has(s, /\b(status|what('s| is) (going on|happening|up|the (state|situation|picture|latest))|where are we|situation|update|overview|progress|how('s| is| are) (it|we|things|the (mission|search|rover|team)) (going|doing|looking)?|what phase|which phase|what now|what next|what should i do|state of|battery|\blink\b|how long|how far|time (is it|elapsed)|catch me up|fill me in|bring me up to speed|report in|talk to me|anything new|what('s| is) new|news)\b/)) return call('get_mission_status', {}, 'status');
  if (has(s, /\b(start|begin|launch|kick off|commence)\b[^.]*\b(mission|search|exercise|operation|survey)\b|^ ?(go|start|begin|launch) ?$/)) return call('start_mission', {}, 'start mission');

  return none('no rule matched');
}
