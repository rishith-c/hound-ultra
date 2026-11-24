// Evidence: an analyst's link chart of the mission. Every finding, the readings behind it, where they were taken
// from, what the route avoids and who approved it. Built live from ctx.sim.state (see model.js); nothing is replayed
// from events, so reset and seek simply rebuild it.
import * as d3 from 'd3';
import { createGraphHero } from './hero.js';
import { TYPES, TYPE_ORDER, EDGE_KINDS, SENSOR_ORDER, SENSOR_INFO, buildGraph, signature, whyChain, changeMind, clock, pct, PRIOR, THRESHOLDS, LR } from './model.js';

const CSS = new URL('./style.css', import.meta.url);
const COLS = { unit: -34, stop: 100, sensor: 275, reading: 430, lead: 570, person: 715, action: 860, room: 1030, hazard: 1170 };
const COL_HEAD = [[-34, 'Units'], [100, 'Stops'], [275, 'Sensors'], [430, 'Readings'], [570, 'Leads'], [715, 'People'], [860, 'Actions'], [1030, 'Rooms'], [1170, 'Hazards']];
const R = { person: 14, lead: 12, reading: 6, sensor: 9, stop: 9, unit: 12, room: 11, hazard: 10, route: 11, alert: 8, decision: 9 };
const SENSOR_CHART = { csi: 'Wi-Fi network', radar: 'Radar, moving', micro: 'Radar, micro-motion', thermal: 'Thermal camera', signature: 'Motion pattern', temperature: 'Temperature check', aerial: 'Drone detector', human: 'Team, in person', acoustic: 'Tapping or voice' };
const PPS = 1.5; // pixels per mission second in the time layout

const poly = (n, r, rot = 0) => 'M' + d3.range(n).map((i) => { const a = rot + (i / n) * Math.PI * 2; return (Math.cos(a) * r).toFixed(2) + ',' + (Math.sin(a) * r).toFixed(2); }).join('L') + 'Z';
const circle = (r) => `M${-r},0a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
const rrect = (w, h, c) => `M${-w / 2 + c},${-h / 2}h${w - 2 * c}a${c},${c} 0 0 1 ${c},${c}v${h - 2 * c}a${c},${c} 0 0 1 ${-c},${c}h${-(w - 2 * c)}a${c},${c} 0 0 1 ${-c},${-c}v${-(h - 2 * c)}a${c},${c} 0 0 1 ${c},${-c}Z`;
function shapeOf(type, r) {
  switch (type) {
    case 'person': case 'reading': case 'decision': return circle(r);
    case 'lead': return poly(4, r * 1.12, 0);
    case 'sensor': return rrect(r * 1.8, r * 1.8, 3);
    case 'stop': return poly(3, r * 1.15, Math.PI / 2);
    case 'unit': return poly(6, r, 0);
    case 'room': return rrect(r * 2.7, r * 1.75, 3);
    case 'hazard': return poly(3, r * 1.2, -Math.PI / 2);
    case 'route': return `M${-r},${-r * 0.72}H${r * 0.3}L${r * 1.15},0L${r * 0.3},${r * 0.72}H${-r}L${-r * 0.35},0Z`;
    case 'alert': return poly(8, r * 1.05, Math.PI / 8);
    default: return circle(r);
  }
}

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag, fmt } = ctx.kit;
    const world = ctx.world;
    if (!document.querySelector('link[data-graph-css]')) document.head.append(h('link', { rel: 'stylesheet', href: CSS.href, 'data-graph-css': '' }));
    const iconD = (name) => icon(name).querySelector('path').getAttribute('d');
    const GLYPH = { person: iconD('person'), rover: iconD('rover'), drone: iconD('drone'), team: iconD('person'), route: iconD('route'), check: iconD('check'), csi: iconD('wifi'), radar: iconD('signals'), micro: iconD('signals'), thermal: iconD('heat'), temperature: iconD('heat'), signature: iconD('fusion'), aerial: iconD('aerial'), human: iconD('eye'), acoustic: iconD('mic') };

    // ---------- state ----------
    let G = { nodes: [], edges: [], byId: new Map() }, sig = '', shown = false, raf = 0, lastBuild = 0;
    const nodeMap = new Map(); let nodes = [], links = [], adj = new Map();
    let view = 'chart', layout = 'flow', group = 'room';
    const typesOn = new Set(TYPE_ORDER); let query = '', timeRange = null, isolated = null; const forced = new Set(), hiddenIds = new Set();
    const sel = new Set(); let primary = null, hoverId = null, lastEmitted = null, userZoomed = false, firstFit = true;
    let scene = { lanes: [], w: 1300, h: 600, hulls: [] }, zoomT = d3.zoomIdentity, sort = { key: 'type', dir: 1 };
    const unsub = [];

    // ---------- DOM ----------
    root.classList.add('graph-root');
    const viewSeg = h('div.seg', { role: 'group', 'aria-label': 'View' }, ...[['chart', 'Link chart'], ['table', 'Table']].map(([id, label]) => h('button', { 'aria-pressed': String(id === view), 'data-view': id, onclick: () => setView(id) }, label)));
    const searchIn = h('input.input.graph-search-in', { type: 'search', placeholder: 'Search: D4, thermal, 103', 'aria-label': 'Search the evidence graph', oninput: (e) => { query = e.target.value.trim().toLowerCase(); applySearch(); }, onkeydown: (e) => { if (e.key === 'Enter') { const hit = matches()[0]; if (hit) select([hit.id], { center: true }); } else if (e.key === 'Escape') { e.target.value = ''; query = ''; applySearch(); } } });
    const searchCount = h('span.graph-search-n.num', { 'aria-live': 'polite' });
    const head = h('header.ws-head.graph-head.adv-only', null,
      h('div', null, h('div.graph-title', null, h('h1', null, 'Evidence'), realityTag('live-algo'), h('span.tag.tag-sim', { title: 'The readings in this chart come from the simulated exercise. The Wi-Fi network that produced the Wi-Fi readings is real and ran in this browser.' }, 'Readings simulated')),
        h('p.graph-lede', null, 'Every finding, linked to the readings that support or contradict it, where they were taken, and who approved what. Pick anything to see why the console believes it.')),
      h('label.graph-search', null, icon('search'), searchIn, searchCount), viewSeg);

    const svg = d3.create('svg').attr('class', 'graph-svg').attr('role', 'application').attr('aria-label', 'Evidence link chart. Use the table view for a list that works with a screen reader.');
    const zoomG = svg.append('g').attr('class', 'graph-zoom');
    const gLanes = zoomG.append('g').attr('class', 'graph-lanes'), gHulls = zoomG.append('g').attr('class', 'graph-hulls'), gEdges = zoomG.append('g').attr('class', 'graph-edges'), gElabels = zoomG.append('g').attr('class', 'graph-elabels'), gNodes = zoomG.append('g').attr('class', 'graph-nodes');
    const lassoPath = svg.append('path').attr('class', 'graph-lasso').attr('display', 'none');
    const stage = h('div.graph-stage');
    stage.append(svg.node());

    const legend = h('div.graph-legend.glass');
    const layoutSeg = h('div.seg', { role: 'group', 'aria-label': 'Layout' }, ...[['flow', 'Flow', 'Left to right: who sensed it, the readings, the lead, the person, the action'], ['time', 'Time', 'Left to right by mission time'], ['clusters', 'Clusters', 'A free force layout, grouped']].map(([id, label, title]) => h('button', { 'aria-pressed': String(id === layout), 'data-layout': id, title, onclick: () => setLayout(id) }, label)));
    const groupSeg = h('div.seg', { role: 'group', 'aria-label': 'Group by' }, ...[['room', 'By room'], ['sensor', 'By sensor']].map(([id, label]) => h('button', { 'aria-pressed': String(id === group), 'data-group': id, onclick: () => setGroup(id) }, label)));
    const tools = h('div.graph-tools.glass', null, layoutSeg, groupSeg, h('span.graph-tools-sep'),
      h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Zoom in', title: 'Zoom in', onclick: () => zoomBy(1.35) }, h('span.graph-pm', null, '+')),
      h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Zoom out', title: 'Zoom out', onclick: () => zoomBy(1 / 1.35) }, h('span.graph-pm', null, '−')),
      h('button.btn.btn-ghost.btn-sm', { 'aria-label': 'Fit the whole chart in view', onclick: () => { userZoomed = false; fit(true); } }, 'Fit'),
      h('button.btn.btn-ghost.btn-sm', { 'aria-label': 'Release every node you dragged back to the layout', title: 'Drag a node to pin it. This lets them all go.', onclick: unpin }, 'Unpin'));
    const selBar = h('div.graph-selbar.glass', { hidden: true });
    
    const tip = h('div.graph-tip.glass', { hidden: true, role: 'tooltip' });
    stage.append(legend, tools, selBar, tip);

    const tableWrap = h('div.graph-tablewrap', { hidden: true });
    const timeBox = h('div.graph-time');
    const main = h('div.graph-main', null, stage, tableWrap, timeBox);
    const detail = h('aside.graph-detail', { 'aria-label': 'Details of the selected object' });
    const heroEl = h('div.graph-hero.demo-only'), hero = createGraphHero(heroEl, ctx);
    root.append(heroEl, head, h('div.graph-body.adv-only', null, main, detail));
    const applyMode = () => { if (shown && ctx.mode === 'demo') hero.show(); else hero.hide(); };
    unsub.push(ctx.bus.on('mode', () => { applyMode(); if (shown && ctx.mode !== 'demo') { rebuild(true); requestAnimationFrame(() => { renderTime(); fit(false); }); } }));
    window.__graphHero = hero;

    // ---------- graph data ----------
    const visible = (n) => { if (hiddenIds.has(n.id)) return false; if (isolated) return isolated.has(n.id); if (forced.has(n.id)) return true; if (!typesOn.has(n.type)) return false; if (timeRange && n.t != null && (n.t < timeRange[0] || n.t > timeRange[1])) return false; return true; };
    const matches = () => (query ? nodes.filter((n) => visible(n) && n.hay.includes(query)) : []);
    const neighbours = (id) => adj.get(id) || [];
    const chartLabel = (n) => (n.type === 'sensor' ? SENSOR_CHART[n.sensor] || n.label : n.type === 'hazard' && n.label.length > 30 ? n.label.slice(0, 28).trimEnd() + '…' : n.label);
    function chartSub(n) {
      switch (n.type) {
        case 'person': return (n.status === 'reached' ? 'Reached' : 'Located') + ' · ' + pct(n.p);
        case 'lead': return (n.status === 'confirmed' ? 'Confirmed' : n.status === 'possible' ? 'Possible' : 'Closed: ' + n.data.kind) + ' · ' + pct(n.p);
        case 'room': { const c = n.data.cov; return ({ unsearched: 'Not searched', clear: 'Clear', lead: 'Possible person', person: 'Person found', blocked: 'Not searched' })[c.status] + ' · ' + pct(c.residual) + (c.status === 'person' || c.status === 'lead' ? '' : ' missed'); }
        case 'route': return n.sub;
        case 'alert': case 'decision': return clock(n.t) + (n.type === 'decision' ? ' · ' + n.by.replace(/ \(.*/, '') : '');
        case 'unit': return n.kind === 'rover' ? 'Rover' : n.kind === 'drone' ? 'Concept' : 'Simulated';
        case 'stop': return n.status === 'planned' ? 'Not reached' : clock(n.t);
        default: return '';
      }
    }
    function radius(n) { return n.type === 'reading' ? 5.5 + Math.min(3.5, (n.w || 0) * 1.5) : R[n.type]; }

    function rebuild(force) {
      const S = ctx.sim.state, s2 = signature(S);
      if (!force && s2 === sig) return false;
      sig = s2; lastBuild = performance.now();
      G = buildGraph(S, world, { commandLog: ctx.sim.commandLog || [] });
      const had = nodeMap.size > 0, fresh = [];
      const keep = new Set();
      for (const m of G.nodes) {
        keep.add(m.id);
        let n = nodeMap.get(m.id);
        if (!n) { n = { isNew: had }; nodeMap.set(m.id, n); fresh.push(n); }
        Object.assign(n, m);
        n.r = radius(n); n.hay = [n.id, n.label, n.long, n.sub, TYPES[n.type].label, n.sensor, n.status, n.lane].filter(Boolean).join(' ').toLowerCase();
      }
      for (const id of [...nodeMap.keys()]) if (!keep.has(id)) { nodeMap.delete(id); sel.delete(id); forced.delete(id); hiddenIds.delete(id); isolated?.delete(id); if (primary === id) primary = null; }
      nodes = [...nodeMap.values()];
      links = G.edges.map((e) => ({ ...e, source: nodeMap.get(e.source), target: nodeMap.get(e.target) }));
      adj = new Map(); for (const l of links) { (adj.get(l.source.id) || adj.set(l.source.id, []).get(l.source.id)).push({ node: l.target, link: l, out: true }); (adj.get(l.target.id) || adj.set(l.target.id, []).get(l.target.id)).push({ node: l.source, link: l, out: false }); }
      computeLayout();
      for (const n of fresh) {
        const near = had && neighbours(n.id).map((a) => a.node).find((m) => m.x != null && !fresh.includes(m));
        if (near) { n.x = near.x + (Math.random() - 0.5) * 8; n.y = near.y + (Math.random() - 0.5) * 8; } else { n.x = n.tx; n.y = n.ty; }
      }
      // While an isolated view is open, new evidence for what is on screen joins it, so the view keeps growing with the mission.
      if (isolated) for (const n of fresh) if (neighbours(n.id).some((a) => isolated.has(a.node.id) && ['supports', 'contradicts', 'neutral', 'confirmed'].includes(a.link.kind))) isolated.add(n.id);
      simulation.nodes(nodes); simulation.force('link').links(links);
      join(); drawScene(); kick(fresh.length && had ? 0.35 : 0.5);
      renderLegend(); renderTime(); if (view === 'table') renderTable(); renderDetail(); applyStates();
      if (!userZoomed) fit(!firstFit);
      return true;
    }

    // ---------- layout: every node gets a target (tx, ty); a light force simulation eases nodes there ----------
    const isAction = (n) => n.type === 'alert' || n.type === 'decision' || n.type === 'route';
    const laneKey = (n) => (group === 'room' ? (isAction(n) && !n.lane ? 'mission' : n.type === 'room' || n.type === 'lead' || n.type === 'person' || n.type === 'reading' || isAction(n) ? n.lane : null)
      : n.type === 'reading' || n.type === 'sensor' ? n.sensor : isAction(n) && (!n.lane || layout === 'time') ? 'mission' : null);
    function spaceOut(list, gap) {
      list.sort((a, b) => a.ty - b.ty); if (list.length < 2) return;
      const before = d3.mean(list, (n) => n.ty);
      for (let i = 1; i < list.length; i++) list[i].ty = Math.max(list[i].ty, list[i - 1].ty + gap);
      const shift = before - d3.mean(list, (n) => n.ty); for (const n of list) n.ty += shift;
    }
    function computeLayout() {
      const S = ctx.sim.state, time = layout === 'time', tmax = Math.max(60, S.t);
      const pool = isolated ? nodes.filter(visible) : nodes; // an isolated view is laid out on its own, so the evidence path is compact
      const of = (t) => pool.filter((n) => n.type === t);
      const headType = group === 'room' ? 'room' : 'sensor';
      for (const n of pool) { n.tx = null; n.ty = null; n.sx = 0.5; n.sy = 0.5; n.lk = laneKey(n); n.left = layout === 'flow' ? n.type === 'unit' || n.type === 'stop' || n.type === 'sensor' : layout === 'time' ? n.type === headType || n.type === 'lead' : false; }
      const ids = group === 'room' ? ['mission', ...(pool.some((n) => n.lk === 'out') ? ['out'] : []), ...of('room').map((n) => n.lane).sort()] : ['mission', ...SENSOR_ORDER.filter((s) => pool.some((n) => n.lk === s))];
      const lanes = ids.map((id) => {
        const mem = pool.filter((n) => n.lk === id), rd = mem.filter((n) => n.type === 'reading'), act = mem.filter(isAction).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
        const rows = group === 'room' ? SENSOR_ORDER.filter((s) => rd.some((n) => n.sensor === s)) : [id];
        const wins = [...new Set(rd.map((n) => n.vantage + '|' + n.t))].sort((a, b) => +a.split('|')[1] - +b.split('|')[1]);
        const hh = Math.max(54, group === 'room' ? rows.length * 21 + 30 + (time ? 22 : 0) : 46, time ? (id === 'mission' ? 76 : 0) : act.length * 34 + 18);
        const room = group === 'room' && world.roomById(id);
        return { id, mem, rd, act, rows, wins, h: hh, label: id === 'mission' ? 'Whole mission' : id === 'out' ? 'Outdoors' : room ? room.name : SENSOR_CHART[id] || id };
      });
      if (isolated) for (let i = lanes.length - 1; i >= 0; i--) if (!lanes[i].mem.length) lanes.splice(i, 1);
      if (!lanes.length) lanes.push({ id: 'mission', mem: [], rd: [], act: [], rows: [], wins: [], h: 54, label: 'Whole mission' });
      let y = 0; for (const L of lanes) { L.top = y; L.y = y + L.h / 2; y += L.h + 6; }
      const H = Math.max(y - 6, 200);

      if (layout === 'clusters') {
        const per = Math.ceil(Math.sqrt(lanes.length * 1.7));
        lanes.forEach((L, i) => { L.cx = (i % per) * 330 + (Math.floor(i / per) % 2) * 120; L.cy = Math.floor(i / per) * 250; });
        const mx = d3.mean(lanes, (L) => L.cx), my = d3.mean(lanes, (L) => L.cy);
        const byLane = new Map(lanes.map((L) => [L.id, L]));
        for (const n of pool) { const L = byLane.get(n.lk); if (L) { n.tx = L.cx; n.ty = L.cy; n.sx = n.sy = 0.16; } else { n.tx = mx; n.ty = my; n.sx = n.sy = 0.012; } }
        scene = { lanes, w: per * 330, h: Math.ceil(lanes.length / per) * 250, mode: 'clusters', x0: 0, x1: 0, tmax };
        return;
      }

      const X = (n) => (time && n.t != null ? n.t * PPS : null);
      for (const L of lanes) {
        const pad = time && group === 'room' ? 11 : 0;
        if (group === 'room') for (const n of L.rd) { const ci = L.wins.indexOf(n.vantage + '|' + n.t), ri = L.rows.indexOf(n.sensor); n.tx = time ? n.t * PPS : COLS.reading + (ci - (L.wins.length - 1) / 2) * 24; n.ty = L.y + pad + (ri - (L.rows.length - 1) / 2) * 21; n.sx = n.sy = 0.9; }
        else { const list = L.rd.slice().sort((a, b) => a.t - b.t), step = Math.min(24, 250 / Math.max(1, list.length)); list.forEach((n, i) => { n.tx = time ? n.t * PPS : COLS.reading + (i - (list.length - 1) / 2) * step; n.ty = L.y + (time ? 0 : (i % 2 ? 5 : -5) * (step < 14 ? 1 : 0)); n.sx = n.sy = 0.9; }); }
        L.act.forEach((n, i) => { n.tx = time ? (n.t ?? tmax) * PPS : COLS.action; n.ty = time ? (L.id === 'mission' ? L.y - 14 + (i % 2) * 22 : L.top + 13) : L.y + (i - (L.act.length - 1) / 2) * 34; n.sx = 0.8; n.sy = 0.6; });
        const leads = L.mem.filter((n) => n.type === 'lead');
        leads.forEach((n, i) => { n.tx = time ? n.t * PPS - 28 : COLS.lead; n.ty = L.y + pad + (i - (leads.length - 1) / 2) * 30; n.sx = 0.8; n.sy = 0.7; });
        for (const n of L.mem) {
          if (n.type === 'room') { n.tx = time ? -40 : COLS.room; n.ty = L.y; n.sx = 0.8; n.sy = 0.8; }
          if (n.type === 'sensor') { n.tx = time ? -40 : COLS.sensor; n.ty = L.y; n.sx = n.sy = 0.8; }
        }
      }
      const ty = (id) => nodeMap.get(id)?.ty;
      const meanN = (n, pred) => { const v = neighbours(n.id).filter((a) => pred(a.node) && a.node.ty != null).map((a) => a.node.ty); return v.length ? d3.mean(v) : null; };
      const spread = (list, x, gap) => { const need = list.filter((n) => n.ty == null); need.forEach((n, i) => { n.ty = H * ((i + 0.5) / need.length); }); for (const n of list) { if (n.tx == null) n.tx = x; } spaceOut(list, gap); };
      // leads and people that have no lane (group by sensor): sit level with their readings
      for (const n of of('lead')) if (n.ty == null) { n.ty = meanN(n, (m) => m.type === 'reading') ?? H / 2; n.tx = time ? n.t * PPS - 28 : COLS.lead; }
      if (group !== 'room') spaceOut(of('lead'), 34);
      const loose = pool.filter((n) => isAction(n) && n.ty == null); // group by sensor: an alert or decision sits level with its lead
      for (const n of loose) { n.ty = meanN(n, (m) => m.type === 'lead' || m.type === 'room') ?? H / 2; n.tx = COLS.action; n.sx = 0.8; n.sy = 0.6; }
      spaceOut(loose, 32);
      for (const n of of('person')) { const ld = nodeMap.get('L:' + n.det); n.ty = ld?.ty ?? H / 2; n.tx = time ? (n.t ?? 0) * PPS + 28 : COLS.person; n.sx = 0.8; n.sy = 0.7; }
      const mission = lanes[0];
      if (time) {
        for (const n of of('stop')) if (n.t != null) { n.tx = n.t * PPS; n.ty = mission.y + 22; n.sx = 0.8; n.sy = 0.5; }
        // Objects with no time of their own are parked in one column after the end of the clock.
        const park = pool.filter((n) => n.tx == null && n.ty == null).sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.label.localeCompare(b.label));
        park.forEach((n, i) => { n.tx = tmax * PPS + 84; n.ty = Math.max(0, H / 2 - park.length * 17) + i * 34 + 12; n.sx = n.sy = 1; });
      } else {
        for (const n of of('room')) if (n.ty == null) n.ty = meanN(n, (m) => m.type === 'lead');
        spread(of('room'), COLS.room, 30);
        for (const n of of('sensor')) if (n.ty == null) n.ty = H * ((SENSOR_ORDER.filter((s) => pool.some((m) => m.id === 'SN:' + s)).indexOf(n.sensor) + 0.5) / Math.max(1, of('sensor').length));
        spread(of('sensor'), COLS.sensor, 30);
        for (const n of of('stop')) n.ty = meanN(n, (m) => m.type === 'reading' || m.type === 'room');
        spread(of('stop'), COLS.stop, 36);
        for (const n of of('hazard')) n.ty = meanN(n, (m) => m.type === 'room');
        spread(of('hazard'), COLS.hazard, 32);
        for (const n of of('unit')) n.ty = meanN(n, (m) => m.type === 'stop' || m.type === 'sensor') ?? null;
        spread(of('unit'), COLS.unit, 56);
      }
      for (const n of pool) { if (n.tx == null) n.tx = COLS.action; if (n.ty == null) n.ty = H / 2; }
      scene = { lanes, w: time ? tmax * PPS : COLS.hazard, h: H, mode: layout, tmax, x0: time ? -66 : (group === 'room' ? COLS.reading - 120 : COLS.sensor - 132), x1: time ? tmax * PPS + 40 : COLS.room + 78 };
    }

    const simulation = d3.forceSimulation([]).alphaDecay(0.045).velocityDecay(0.42)
      .force('x', d3.forceX((n) => n.tx).strength((n) => n.sx)).force('y', d3.forceY((n) => n.ty).strength((n) => n.sy))
      .force('collide', d3.forceCollide((n) => n.r + (n.type === 'reading' ? 1.5 : 7)).strength(0.7).iterations(2))
      .force('link', d3.forceLink([]).id((n) => n.id).distance(54).strength(0))
      .force('charge', d3.forceManyBody().strength(0).distanceMax(320)).stop();
    function retune() {
      const c = layout === 'clusters';
      simulation.force('x').x((n) => n.tx).strength((n) => n.sx); simulation.force('y').y((n) => n.ty).strength((n) => n.sy);
      simulation.force('link').strength(c ? (l) => (['supports', 'contradicts', 'neutral', 'confirmed', 'inRoom'].includes(l.kind) ? 0.5 : 0.05) : 0);
      simulation.force('charge').strength(c ? -190 : 0); simulation.force('collide').radius((n) => n.r + (n.type === 'reading' ? (c ? 4 : 1.5) : c ? 18 : 7));
    }
    function kick(alpha = 0.5) {
      retune();
      if (ctx.kit.reducedMotion() || !shown) { simulation.alpha(alpha); simulation.tick(260); simulation.alpha(0); positions(); return; }
      simulation.alpha(Math.max(simulation.alpha(), alpha));
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function frame() {
      raf = 0; if (!shown) return;
      if (simulation.alpha() > 0.012) { simulation.tick(); positions(); raf = requestAnimationFrame(frame); }
      else { simulation.alpha(0); positions(); if (layout === 'clusters' && !userZoomed) fit(true); }
    }

    // ---------- drawing ----------
    let nodeSel = gNodes.selectAll('g'), edgeSel = gEdges.selectAll('path'), elabelSel = gElabels.selectAll('g');
    const evidenceKinds = new Set(['supports', 'contradicts', 'neutral']);
    function glyph(g, n) {
      g.selectAll('.graph-glyph').remove();
      const txt = (s, cls = '') => g.append('text').attr('class', 'graph-glyph ' + cls).attr('text-anchor', 'middle').attr('dy', '0.36em').text(s);
      const ic = (d, s) => g.append('path').attr('class', 'graph-glyph graph-glyph-icon').attr('d', d).attr('transform', `translate(${-12 * s},${-12 * s}) scale(${s})`);
      if (n.type === 'person') ic(GLYPH.person, 0.72);
      else if (n.type === 'lead') txt(n.status === 'confirmed' ? '✓' : n.status === 'possible' ? '?' : '×');
      else if (n.type === 'reading') txt(n.dir === 'supports' ? '+' : n.dir === 'contradicts' ? '−' : n.dir === 'mixed' ? '±' : '·', 'graph-glyph-sm');
      else if (n.type === 'room') txt(n.label, 'graph-glyph-room');
      else if (n.type === 'unit') ic(GLYPH[n.kind] || GLYPH.rover, 0.58);
      else if (n.type === 'sensor') ic(GLYPH[n.sensor] || GLYPH.radar, 0.52);
      else if (n.type === 'hazard' || n.type === 'alert') txt('!', n.type === 'alert' ? 'graph-glyph-sm' : 'graph-glyph-hz');
      else if (n.type === 'route') ic(GLYPH.route, 0.5);
      else if (n.type === 'decision') ic(GLYPH.check, 0.5);
    }
    function nodeClass(n) { return `graph-node t-${n.type} s-${String(n.status).replace(/[^a-z0-9]/gi, '')}${n.type === 'reading' ? ' dir-' + (n.dir || 'neutral') : ''}${n.type === 'decision' && n.human ? ' by-human' : ''}${n.type === 'unit' ? ' k-' + n.kind : ''}`; }
    function join() {
      edgeSel = edgeSel.data(links, (l) => l.id).join((en) => en.append('path').attr('fill', 'none'));
      edgeSel.attr('class', (l) => 'graph-edge e-' + l.kind + (evidenceKinds.has(l.kind) ? ' e-evidence' : '')).attr('stroke-width', (l) => (evidenceKinds.has(l.kind) ? 1 + Math.min(3, l.w * 1.05) : null));
      nodeSel = nodeSel.data(nodes, (n) => n.id).join((en) => {
        const g = en.append('g').attr('tabindex', (n) => (n.type === 'person' || n.type === 'lead' ? 0 : -1)).attr('role', 'button');
        g.append('path').attr('class', 'graph-back'); g.append('path').attr('class', 'graph-shape'); g.append('circle').attr('class', 'graph-pin').attr('r', 2.4);
        const t = g.append('text').attr('class', 'graph-label'); t.append('tspan').attr('class', 'graph-l1'); t.append('tspan').attr('class', 'graph-l2');
        g.on('click', onNodeClick).on('dblclick', (ev, n) => { ev.stopPropagation(); expand([n.id]); }).on('pointerenter', (ev, n) => setHover(n, ev)).on('pointerleave', () => setHover(null))
          .on('keydown', (ev, n) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select([n.id], { add: ev.shiftKey }); } else if (ev.key.toLowerCase() === 'e') expand([n.id]); })
          .on('focus', (ev, n) => { if (ev.target.matches(':focus-visible')) setHover(n); }).on('blur', () => setHover(null))
          .call(d3.drag().clickDistance(4).on('start', (ev, n) => { n.dragged = false; }).on('drag', (ev, n) => { n.dragged = true; n.fx = ev.x; n.fy = ev.y; n.pinned = true; if (ctx.kit.reducedMotion()) { n.x = ev.x; n.y = ev.y; positions(); } else kick(0.12); }).on('end', (ev, n) => { if (n.dragged) applyStates(); }));
        return g;
      });
      nodeSel.attr('class', nodeClass).attr('aria-label', (n) => TYPES[n.type].label + ': ' + n.label + (n.sub ? ', ' + n.sub : ''))
        .each(function (n) {
          const g = d3.select(this), d = shapeOf(n.type, n.r), left = n.left;
          g.select('.graph-back').attr('d', d); g.select('.graph-shape').attr('d', d); glyph(g, n);
          const off = (n.type === 'room' ? n.r * 1.35 : n.type === 'lead' ? n.r * 1.12 : n.r) + 6, sub = chartSub(n);
          const t = g.select('.graph-label').attr('text-anchor', left ? 'end' : 'start');
          t.select('.graph-l1').attr('x', left ? -off : off).attr('dy', sub ? '-0.25em' : '0.33em').text(chartLabel(n));
          t.select('.graph-l2').attr('x', left ? -off : off).attr('dy', '1.25em').text(sub);
          g.select('.graph-pin').attr('cx', n.r * 0.8).attr('cy', -n.r * 0.8);
          if (n.isNew) { n.isNew = false; g.classed('is-new', true); setTimeout(() => g.classed('is-new', false), 1400); }
        });
    }
    function edgePath(l) {
      const a = l.source, b = l.target;
      if (layout === 'clusters') { const dx = b.x - a.x, dy = b.y - a.y; return `M${a.x.toFixed(1)},${a.y.toFixed(1)}Q${((a.x + b.x) / 2 - dy * 0.1).toFixed(1)},${((a.y + b.y) / 2 + dx * 0.1).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`; }
      const dx = b.x - a.x, c = Math.max(26, Math.abs(dx) * 0.5) * (dx < 0 ? -1 : 1);
      return `M${a.x.toFixed(1)},${a.y.toFixed(1)}C${(a.x + c).toFixed(1)},${a.y.toFixed(1)} ${(b.x - c).toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    }
    function positions() {
      nodeSel.attr('transform', (n) => `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
      edgeSel.attr('d', edgePath);
      elabelSel.attr('transform', (l) => `translate(${((l.source.x + l.target.x) / 2).toFixed(1)},${((l.source.y + l.target.y) / 2).toFixed(1)})`);
      if (layout === 'clusters') drawHulls();
    }
    function drawHulls() {
      const data = scene.lanes.map((L) => { const pts = []; for (const n of L.mem) if (visible(n) && n.x != null) for (let k = 0; k < 8; k++) pts.push([n.x + Math.cos(k * 0.785) * (n.r + 16), n.y + Math.sin(k * 0.785) * (n.r + 16)]); const hull = pts.length > 2 ? d3.polygonHull(pts) : null; return hull && { L, hull, top: d3.min(hull, (p) => p[1]), cx: d3.mean(hull, (p) => p[0]) }; }).filter(Boolean);
      gHulls.selectAll('path').data(data, (d) => d.L.id).join('path').attr('class', 'graph-hull').attr('d', (d) => 'M' + d.hull.join('L') + 'Z');
      gHulls.selectAll('text').data(data, (d) => d.L.id).join('text').attr('class', 'graph-hull-label').attr('text-anchor', 'middle').attr('x', (d) => d.cx).attr('y', (d) => d.top - 8).text((d) => d.L.label);
    }
    function drawScene() {
      gLanes.selectAll('*').remove(); if (layout !== 'clusters') gHulls.selectAll('*').remove();
      svg.attr('data-layout', layout);
      if (layout === 'clusters') return;
      const time = layout === 'time', S = ctx.sim.state;
      const band = gLanes.selectAll('g.graph-lane').data(scene.lanes).join('g').attr('class', (L, i) => 'graph-lane' + (i % 2 ? ' odd' : ''));
      band.append('rect').attr('x', scene.x0).attr('y', (L) => L.top).attr('width', scene.x1 - scene.x0).attr('height', (L) => L.h).attr('rx', 6);
      band.filter((L) => (time ? !nodeMap.has('RM:' + L.id) && !nodeMap.has('SN:' + L.id) : group === 'room' || L.id === 'mission')).append('text').attr('class', 'graph-lane-label').attr('x', scene.x0 + 9).attr('y', (L) => L.top + 15).text((L) => L.label);
      if (!time) {
        const colTypes = { Units: ['unit'], Stops: ['stop'], Sensors: ['sensor'], Readings: ['reading'], Leads: ['lead'], People: ['person'], Actions: ['route', 'alert', 'decision'], Rooms: ['room'], Hazards: ['hazard'] };
        gLanes.selectAll('text.graph-col').data(COL_HEAD.filter((d) => nodes.some((n) => colTypes[d[1]].includes(n.type) && visible(n)))).join('text').attr('class', 'graph-col').attr('x', (d) => d[0]).attr('y', -18).attr('text-anchor', 'middle').text((d) => d[1]);
      } else {
        const ax = gLanes.append('g').attr('class', 'graph-axis');
        for (let t = 0; t <= scene.tmax; t += 60) { ax.append('line').attr('x1', t * PPS).attr('x2', t * PPS).attr('y1', -8).attr('y2', scene.h); ax.append('text').attr('x', t * PPS).attr('y', -14).attr('text-anchor', 'middle').text(clock(t)); }
        const ph = S.events.filter((e) => e.code === 'PHASE');
        ph.forEach((e, i) => { const x0 = e.t * PPS, x1 = (ph[i + 1]?.t ?? S.t) * PPS; if (x1 - x0 < 4) return; ax.append('line').attr('class', 'graph-phase').attr('x1', x0 + 1).attr('x2', x1 - 1).attr('y1', -38).attr('y2', -38); const name = e.text.split('.')[0]; ax.append('text').attr('class', 'graph-phase-label').attr('x', x0 + 2).attr('y', -44).text(x1 - x0 > name.length * 7.5 ? name : ''); });
        ax.append('text').attr('class', 'graph-phase-label').attr('x', -32).attr('y', -14).attr('text-anchor', 'end').text('Mission clock'); ax.append('text').attr('class', 'graph-phase-label').attr('x', scene.tmax * PPS + 70).attr('y', -14).text('No time of their own');
        ax.append('line').attr('class', 'graph-now').attr('x1', S.t * PPS).attr('x2', S.t * PPS).attr('y1', -30).attr('y2', scene.h);
      }
    }

    // ---------- selection, focus, visibility ----------
    function whyPath(n) {
      const out = new Set(); const lead = n.type === 'person' ? nodeMap.get('L:' + n.det) : n; if (!lead) return out;
      out.add(lead.id); out.add(n.id);
      for (const a of neighbours(lead.id)) {
        if (a.link.kind === 'confirmed' || a.link.kind === 'inRoom') out.add(a.node.id);
        if (evidenceKinds.has(a.link.kind)) { out.add(a.node.id); for (const b of neighbours(a.node.id)) if (b.link.kind === 'by' || b.link.kind === 'from') out.add(b.node.id); }
      }
      return out;
    }
    function focusSet() {
      const core = sel.size ? [...sel] : hoverId ? [hoverId] : null; if (!core) return null;
      const out = new Set();
      for (const id of hoverId && sel.size ? [...core, hoverId] : core) { const n = nodeMap.get(id); if (!n) continue; out.add(id); if (n.type === 'person' || n.type === 'lead') for (const x of whyPath(n)) out.add(x); else for (const a of neighbours(id)) out.add(a.node.id); }
      return out;
    }
    function applyStates() {
      const f = focusSet(), q = query;
      nodeSel.attr('display', (n) => (visible(n) ? null : 'none'))
        .classed('is-dim', (n) => (f && !f.has(n.id)) || (!!q && !n.hay.includes(q))).classed('is-sel', (n) => sel.has(n.id)).classed('is-hit', (n) => !!q && n.hay.includes(q)).classed('is-on', (n) => !!f && f.has(n.id)).classed('is-pinned', (n) => !!n.pinned);
      const core = new Set(sel); if (hoverId) core.add(hoverId);
      edgeSel.attr('display', (l) => (visible(l.source) && visible(l.target) ? null : 'none'))
        .classed('is-dim', (l) => !!f && !(f.has(l.source.id) && f.has(l.target.id))).classed('is-on', (l) => !!f && f.has(l.source.id) && f.has(l.target.id) && (core.has(l.source.id) || core.has(l.target.id) || evidenceKinds.has(l.kind) || l.kind === 'confirmed'));
      // Edge labels: only for what is selected, so the chart stays readable.
      let lab = [];
      if (sel.size === 1 && primary && nodeMap.has(primary)) {
        const n = nodeMap.get(primary), set = n.type === 'person' || n.type === 'lead' ? whyPath(n) : null;
        lab = links.filter((l) => visible(l.source) && visible(l.target) && (set ? set.has(l.source.id) && set.has(l.target.id) && (evidenceKinds.has(l.kind) || l.kind === 'confirmed') : l.source.id === primary || l.target.id === primary));
        if (set && lab.length > 7) lab = lab.filter((l) => l.kind === 'confirmed'); // the weights are listed in the panel; a dense fan of labels would only hide the readings
        const perKind = d3.rollup(lab, (v) => v.length, (l) => l.kind); lab = lab.filter((l) => perKind.get(l.kind) <= 4 || (evidenceKinds.has(l.kind) && lab.length <= 12));
      }
      elabelSel = elabelSel.data(lab, (l) => l.id).join((en) => { const g = en.append('g').attr('class', 'graph-elabel'); g.append('rect').attr('rx', 3); g.append('text').attr('text-anchor', 'middle').attr('dy', '0.34em'); return g; });
      elabelSel.attr('class', (l) => 'graph-elabel e-' + l.kind).each(function (l) { const s = evidenceKinds.has(l.kind) && l.kind !== 'neutral' ? '×' + fmtLr(l.lr) : l.label; const w = s.length * 5.6 + 8; const g = d3.select(this); g.select('text').text(s); g.select('rect').attr('x', -w / 2).attr('y', -7).attr('width', w).attr('height', 14); });
      positions();
      selBarRender();
    }
    const fmtLr = (x) => (x >= 10 ? x.toFixed(0) : x >= 1 ? x.toFixed(1) : x.toFixed(2));
    function select(ids, { add = false, center = false, silent = false } = {}) {
      if (!add) sel.clear();
      for (const id of ids) { if (!nodeMap.has(id)) continue; if (add && sel.has(id) && ids.length === 1) { sel.delete(id); continue; } sel.add(id); if (!visible(nodeMap.get(id))) { if (isolated) isolated.add(id); else { hiddenIds.delete(id); forced.add(id); } } }
      primary = sel.size ? (ids.length && sel.has(ids[ids.length - 1]) ? ids[ids.length - 1] : [...sel][sel.size - 1]) : null;
      renderDetail(); applyStates(); if (view === 'table') markTable(true);
      const n = primary && nodeMap.get(primary);
      if (n && center && view === 'chart') centerOn(n);
      if (!silent && n?.ref) { lastEmitted = { ...n.ref }; ctx.select(lastEmitted); }
    }
    function onNodeClick(ev, n) { ev.stopPropagation(); if (n.dragged) { n.dragged = false; return; } select([n.id], { add: ev.shiftKey || ev.metaKey || ev.ctrlKey }); }
    function setHover(n, ev) {
      const id = n?.id || null; if (id === hoverId && !ev) return; hoverId = id;
      if (n) { tip.replaceChildren(h('b', null, TYPES[n.type].label + ' · ' + (n.type === 'room' ? n.long : chartLabel(n))), n.long && n.type !== 'room' ? h('span', null, n.long) : null, h('span.dim', null, n.sub)); tip.hidden = false; const p = zoomT.apply([n.x, n.y]), w = stage.clientWidth; tip.style.left = Math.min(w - 290, Math.max(8, p[0] + 16)) + 'px'; tip.style.top = Math.max(8, p[1] + 18) + 'px'; } else tip.hidden = true;
      applyStates();
    }
    function refreshVisibility(refit = true) { applyStates(); renderLegend(); if (view === 'table') renderTable(); if (layout === 'clusters') drawHulls(); if (refit && !userZoomed) fit(true); }
    function expand(ids) {
      let revealed = 0; const add = [];
      for (const id of ids) for (const a of neighbours(id)) { const m = a.node; if (!visible(m)) { revealed++; if (isolated) isolated.add(m.id); else { hiddenIds.delete(m.id); forced.add(m.id); } m.isNew = true; } add.push(m.id); }
      for (const id of add) sel.add(id);
      if (isolated) relayout(); else join();
      renderDetail(); refreshVisibility();
      ctx.shell.toast(revealed ? `Expanded: ${revealed} hidden ${revealed === 1 ? 'neighbour' : 'neighbours'} brought onto the chart.` : `Neighbours selected (${sel.size} objects). Nothing was hidden.`, { level: 'info' });
    }
    function relayout() { computeLayout(); join(); drawScene(); kick(0.7); }
    function isolate(ids) { isolated = new Set(ids); userZoomed = false; relayout(); refreshVisibility(); }
    function showAll() { isolated = null; forced.clear(); hiddenIds.clear(); for (const t of TYPE_ORDER) typesOn.add(t); userZoomed = false; relayout(); refreshVisibility(); }
    function hide(ids) { for (const id of ids) { hiddenIds.add(id); isolated?.delete(id); forced.delete(id); } sel.clear(); primary = null; if (isolated) relayout(); renderDetail(); refreshVisibility(false); }
    function unpin() { let k = 0; for (const n of nodes) if (n.pinned) { n.pinned = false; n.fx = n.fy = null; k++; } applyStates(); kick(0.4); ctx.shell.toast(k ? `Released ${k} pinned ${k === 1 ? 'node' : 'nodes'}.` : 'Nothing is pinned. Drag a node to pin it.', { level: 'info' }); }
    function selBarRender() {
      const extra = isolated || forced.size || hiddenIds.size;
      if (sel.size < 2 && !extra) { selBar.hidden = true; return; }
      const shownN = nodes.filter(visible).length;
      selBar.hidden = false;
      selBar.replaceChildren(...[
        sel.size > 1 ? h('b.num', null, sel.size + ' selected') : null,
        sel.size > 1 ? h('button.btn.btn-sm', { onclick: () => expand([...sel]) }, 'Expand neighbours') : null,
        sel.size > 1 ? h('button.btn.btn-sm', { onclick: () => isolate([...sel]) }, 'Isolate') : null,
        sel.size > 1 ? h('button.btn.btn-sm', { onclick: () => hide([...sel]) }, 'Hide') : null,
        sel.size > 1 ? h('button.btn.btn-ghost.btn-sm', { onclick: () => select([]) }, 'Clear') : null,
        extra ? h('span.muted', null, `Showing ${shownN} of ${nodes.length} objects`) : null,
        extra ? h('button.btn.btn-sm', { onclick: showAll }, 'Show everything') : null].filter(Boolean));
    }

    // ---------- zoom, pan, lasso ----------
    const zoom = d3.zoom().scaleExtent([0.2, 5]).filter((ev) => !ev.shiftKey && !ev.button && ev.type !== 'dblclick')
      .on('zoom', (ev) => { zoomT = ev.transform; zoomG.attr('transform', zoomT); if (ev.sourceEvent) { userZoomed = true; tip.hidden = true; } const k = zoomT.k; svg.classed('zoom-far', k < 0.64).classed('zoom-near', k > 1.5); zoomG.style('--fs', Math.min(16, Math.max(11, 10.6 / k)).toFixed(2) + 'px'); });
    svg.call(zoom).on('dblclick.zoom', null);
    const moveTo = (t, animate) => { (animate && !ctx.kit.reducedMotion() ? svg.transition().duration(420).ease(d3.easeCubicOut) : svg).call(zoom.transform, t); };
    function zoomBy(f) { userZoomed = true; (ctx.kit.reducedMotion() ? svg : svg.transition().duration(180)).call(zoom.scaleBy, f); }
    function fit(animate) {
      const w = stage.clientWidth, hh = stage.clientHeight; if (!w || !hh || view !== 'chart') return;
      const vis = nodes.filter(visible); if (!vis.length) return;
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const settled = simulation.alpha() < 0.05 && layout === 'clusters';
      for (const n of vis) { const x = settled ? n.x : n.fx ?? n.tx, y = settled ? n.y : n.fy ?? n.ty, left = n.left; x0 = Math.min(x0, x - n.r - (left ? (n.type === 'sensor' ? 150 : 118) : 14)); x1 = Math.max(x1, x + n.r + (left ? 8 : n.type === 'reading' ? 8 : n.type === 'hazard' ? 240 : 120)); y0 = Math.min(y0, y - n.r - 8); y1 = Math.max(y1, y + n.r + 8); }
      if (layout !== 'clusters') { x0 = Math.min(x0, scene.x0); y0 = Math.min(y0, layout === 'time' ? -56 : -34); }
      const padL = 24, padR = 20, padT = 56, padB = legend.offsetHeight + 24 + (selBar.hidden ? 0 : 44);
      const k = Math.min((w - padL - padR) / (x1 - x0), (hh - padT - padB) / (y1 - y0), 1.2);
      const tx = padL + (w - padL - padR - (x1 - x0) * k) / 2 - x0 * k, ty = padT + (hh - padT - padB - (y1 - y0) * k) / 2 - y0 * k;
      moveTo(d3.zoomIdentity.translate(tx, ty).scale(k), animate); firstFit = false;
    }
    function centerOn(n) {
      const w = stage.clientWidth, hh = stage.clientHeight; if (!w) return;
      const p = zoomT.apply([n.x ?? n.tx, n.y ?? n.ty]);
      if (p[0] > 60 && p[0] < w - 80 && p[1] > 70 && p[1] < hh - 110) return; // already comfortably in view
      const k = Math.max(zoomT.k, 0.75);
      moveTo(d3.zoomIdentity.translate(w / 2 - (n.x ?? n.tx) * k, hh / 2 - (n.y ?? n.ty) * k).scale(k), true);
    }
    let lasso = null;
    svg.on('pointerdown.lasso', (ev) => { if (!ev.shiftKey || ev.button || ev.target.closest('.graph-node')) return; lasso = [d3.pointer(ev, svg.node())]; try { svg.node().setPointerCapture(ev.pointerId); } catch { /* synthetic pointer */ } lassoPath.attr('display', null).attr('d', ''); ev.preventDefault(); })
      .on('pointermove.lasso', (ev) => { if (!lasso) return; lasso.push(d3.pointer(ev, svg.node())); lassoPath.attr('d', 'M' + lasso.join('L') + 'Z'); })
      .on('pointerup.lasso', (ev) => { if (!lasso) return; const pts = lasso; lasso = null; lassoPath.attr('display', 'none'); try { svg.node().releasePointerCapture(ev.pointerId); } catch { /* synthetic pointer */ } if (pts.length < 4) return; const ids = nodes.filter((n) => visible(n) && d3.polygonContains(pts, zoomT.apply([n.x, n.y]))).map((n) => n.id); if (ids.length) select(ids, { add: true }); else ctx.shell.toast('The lasso caught nothing. Hold Shift and drag around the nodes you want.', { level: 'info' }); svg.node().__lassoed = true; })
      .on('click', (ev) => { if (svg.node().__lassoed) { svg.node().__lassoed = false; return; } if (!ev.target.closest('.graph-node') && sel.size) select([]); });

    // ---------- legend and type filters ----------
    const mini = (type, cls = '') => { const s = d3.create('svg').attr('class', 'graph-mini ' + cls).attr('viewBox', '-13 -11 26 22').attr('width', 22).attr('height', 18).attr('aria-hidden', 'true'); s.append('path').attr('d', shapeOf(type, type === 'room' ? 7 : type === 'reading' ? 6 : 8)); return s.node(); };
    const edgeKey = (cls, label, means) => h('div.graph-ekey', { title: means }, (() => { const s = d3.create('svg').attr('width', 30).attr('height', 10).attr('aria-hidden', 'true'); s.append('path').attr('class', 'graph-edge is-key ' + cls).attr('d', 'M1,5H29').attr('fill', 'none'); return s.node(); })(), h('span', null, label));
    function renderLegend() {
      const counts = d3.rollup(nodes, (v) => v.length, (n) => n.type);
      legend.replaceChildren(
        h('div.graph-types', { role: 'group', 'aria-label': 'Show or hide object types' }, ...TYPE_ORDER.map((t) => h('button.graph-type', { 'aria-pressed': String(typesOn.has(t)), title: TYPES[t].means + ' Click to show or hide. Alt-click to show only this type.', 'data-type': t, onclick: (ev) => { if (ev.altKey) { const only = typesOn.size === 1 && typesOn.has(t); typesOn.clear(); for (const x of only ? TYPE_ORDER : [t]) typesOn.add(x); } else if (typesOn.has(t)) typesOn.delete(t); else typesOn.add(t); refreshVisibility(); } }, mini(t, 'graph-node t-' + t + ' s-key'), h('span', null, TYPES[t].plural), h('span.num.dim', null, String(counts.get(t) || 0))))),
        h('div.graph-ekeys', null, edgeKey('e-supports e-evidence', 'supports', 'The reading makes a person more likely. Thicker means stronger.'), edgeKey('e-contradicts e-evidence', 'contradicts', 'The reading makes a person less likely.'), edgeKey('e-neutral e-evidence', 'no information', 'The sensor could not see.'), edgeKey('e-confirmed', 'confirmed as', 'A lead that became a located person.'), edgeKey('e-leadsTo', 'route leads to', 'The rescue route.'), edgeKey('e-avoids', 'route avoids', 'A hazard the route was planned around.'), edgeKey('e-from', 'context', 'Observed from, measured by, in room, covers, about.'), ));
    }

    // ---------- time histogram with a brush ----------
    const timeSvg = d3.create('svg').attr('class', 'graph-time-svg').attr('role', 'img'); const tBars = timeSvg.append('g'), tAxis = timeSvg.append('g').attr('class', 'graph-taxis'), tNow = timeSvg.append('line').attr('class', 'graph-now'), tBrush = timeSvg.append('g').attr('class', 'graph-brush');
    const timeRead = h('span.num.graph-time-read'), timeClear = h('button.btn.btn-ghost.btn-sm', { hidden: true, onclick: () => setTime(null) }, 'Clear time filter');
    const CAT = [['supports', 'Readings for a person'], ['contradicts', 'Readings against'], ['neutral', 'No information'], ['alert', 'Alerts'], ['decision', 'Decisions']];
    timeBox.append(h('div.graph-time-head', null, h('h3', null, 'When the evidence came in'), h('span.muted', null, 'Drag across the bars to keep one time window.'), h('div.grow'), ...CAT.map(([c, l]) => h('span.graph-tkey', null, h('i.c-' + c), l)), timeRead, timeClear), timeSvg.node());
    let tx = d3.scaleLinear(), brushGuard = false;
    const brush = d3.brushX().on('brush end', (ev) => { if (brushGuard) return; timeRange = ev.selection ? ev.selection.map(tx.invert) : null; timeReadout(); if (ev.type === 'end') refreshVisibility(); else applyStates(); });
    function setTime(range) { timeRange = range && range[1] > range[0] ? [+range[0], +range[1]] : null; brushGuard = true; tBrush.call(brush.move, timeRange ? timeRange.map(tx) : null); brushGuard = false; timeReadout(); refreshVisibility(); }
    function timeReadout() { timeRead.textContent = timeRange ? clock(timeRange[0]) + ' to ' + clock(timeRange[1]) : ''; timeClear.hidden = !timeRange; }
    function renderTime() {
      const w = timeBox.clientWidth - 24, hh = 64; if (w < 100) return;
      const S = ctx.sim.state, tmax = Math.max(120, Math.ceil(S.t / 60) * 60), bin = 10, m = { l: 26, r: 24, t: 4, b: 16 };
      tx = d3.scaleLinear([0, tmax], [m.l, w - m.r]);
      const bins = d3.range(0, tmax, bin).map((t0) => ({ t0, supports: 0, contradicts: 0, neutral: 0, alert: 0, decision: 0 }));
      for (const n of nodes) { if (n.t == null) continue; const b = bins[Math.min(bins.length - 1, Math.floor(n.t / bin))]; if (!b) continue; if (n.type === 'reading') b[n.dir === 'supports' || n.dir === 'mixed' ? 'supports' : n.dir === 'contradicts' ? 'contradicts' : 'neutral']++; else if (n.type === 'alert' || n.type === 'decision') b[n.type]++; }
      const ymax = Math.max(4, d3.max(bins, (b) => b.supports + b.contradicts + b.neutral + b.alert + b.decision));
      const y = d3.scaleLinear([0, ymax], [hh - m.b, m.t]), bw = Math.max(2, tx(bin) - tx(0) - 1.5);
      const stacked = bins.flatMap((b) => { let a = 0; return CAT.map(([c]) => { const v = b[c], o = { t0: b.t0, c, a, v }; a += v; return o; }).filter((o) => o.v); });
      timeSvg.attr('width', w).attr('height', hh).attr('aria-label', 'Number of readings, alerts and decisions per 10 seconds of mission time');
      tBars.selectAll('rect').data(stacked, (d) => d.t0 + d.c).join('rect').attr('class', (d) => 'c-' + d.c).attr('x', (d) => tx(d.t0) + 0.75).attr('width', bw).attr('y', (d) => y(d.a + d.v)).attr('height', (d) => Math.max(1, y(d.a) - y(d.a + d.v) - 1)).attr('rx', 1.5);
      tAxis.selectAll('*').remove();
      for (let t = 0; t <= tmax; t += tmax > 600 ? 120 : 60) tAxis.append('text').attr('x', tx(t)).attr('y', hh - 3).attr('text-anchor', 'middle').text(clock(t));
      tAxis.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', hh - m.b + 0.5).attr('y2', hh - m.b + 0.5);
      tAxis.append('text').attr('x', 2).attr('y', y(ymax) + 9).text(ymax); tAxis.append('text').attr('x', 2).attr('y', hh - m.b).text('0');
      tNow.attr('x1', tx(S.t)).attr('x2', tx(S.t)).attr('y1', m.t).attr('y2', hh - m.b);
      brush.extent([[m.l, m.t], [w - m.r, hh - m.b]]); brushGuard = true; tBrush.call(brush); tBrush.call(brush.move, timeRange ? timeRange.map(tx) : null); brushGuard = false;
    }

    // ---------- table view ----------
    const valueOf = (n) => { switch (n.type) { case 'person': case 'lead': return [n.p, pct(n.p)]; case 'reading': { const l = n.leads[0]; return [Math.log(l.lr), '×' + fmtLr(l.lr)]; } case 'room': return [n.data.cov.residual, pct(n.data.cov.residual) + ' missed']; case 'route': return [n.data.length, n.data.length.toFixed(0) + ' m']; case 'sensor': return [n.data.n, n.data.n + ' readings']; default: return [-Infinity, '']; } };
    const COLUMNS = [['type', 'Type'], ['label', 'Name'], ['long', 'What it says'], ['t', 'Time'], ['value', 'Value'], ['degree', 'Links']];
    const tableBody = h('tbody'), tableCount = h('p.graph-table-count.muted');
    const table = h('table.table.graph-table', null, h('thead', null, h('tr', null, ...COLUMNS.map(([k, l]) => h('th', { scope: 'col', 'data-key': k, class: k === 'value' || k === 'degree' || k === 't' ? 'r' : '' }, h('button.graph-th', { onclick: () => { sort = { key: k, dir: sort.key === k ? -sort.dir : 1 }; renderTable(); } }, l, h('span.graph-sort', { 'aria-hidden': 'true' })))))), tableBody);
    tableWrap.append(tableCount, h('div.graph-table-scroll', null, table));
    function renderTable() {
      const rows = nodes.filter((n) => visible(n) && (!query || n.hay.includes(query)));
      const key = { type: (n) => TYPE_ORDER.indexOf(n.type) * 1e6 + (n.t ?? 0), label: (n) => n.label.toLowerCase(), long: (n) => (n.long || n.sub || '').toLowerCase(), t: (n) => n.t ?? -1, value: (n) => valueOf(n)[0], degree: (n) => n.degree }[sort.key];
      rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
      table.querySelectorAll('th').forEach((th) => { const on = th.dataset.key === sort.key; th.setAttribute('aria-sort', on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'); th.querySelector('.graph-sort').textContent = on ? (sort.dir > 0 ? '↑' : '↓') : ''; });
      tableCount.textContent = `${rows.length} of ${nodes.length} objects${query ? ', matching “' + query + '”' : ''}${timeRange ? ', between ' + clock(timeRange[0]) + ' and ' + clock(timeRange[1]) : ''}. Click a row to select it; Shift-click adds to the selection.`;
      tableBody.replaceChildren(...rows.map((n) => h('tr', { tabindex: 0, 'data-id': n.id, 'aria-selected': String(sel.has(n.id)), onclick: (ev) => select([n.id], { add: ev.shiftKey || ev.metaKey }), onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select([n.id], { add: ev.shiftKey }); } } },
        h('td', null, h('span.graph-tcell', null, mini(n.type, nodeClass(n)), TYPES[n.type].label)), h('td', null, n.type === 'room' ? n.long : n.label), h('td.graph-td-long', null, n.type === 'room' ? n.sub + '. ' + (n.data.cov.note || '') : n.long || n.sub), h('td.r.num', null, n.t != null ? clock(n.t) : '–'), h('td.r.num', null, valueOf(n)[1] || '–'), h('td.r.num', null, String(n.degree)))));
      if (!rows.length) tableBody.append(h('tr', null, h('td', { colSpan: 6 }, h('div.empty', null, 'Nothing matches. Clear the search or the filters.'))));
    }
    function markTable(scroll) { tableBody.querySelectorAll('tr[data-id]').forEach((tr) => { const on = sel.has(tr.dataset.id); tr.setAttribute('aria-selected', String(on)); if (on && scroll && tr.dataset.id === primary && !tr.matches(':hover')) tr.scrollIntoView({ block: 'nearest' }); }); }
    function applySearch() { const n = matches().length; searchCount.textContent = query ? (n ? n + (n === 1 ? ' match' : ' matches') : 'no match') : ''; applyStates(); if (view === 'table') renderTable(); }
    function setView(v) { view = v; viewSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v))); stage.hidden = v !== 'chart'; tableWrap.hidden = v !== 'table'; if (v === 'table') renderTable(); else { if (!userZoomed) fit(false); kick(0.1); } }
    function setLayout(v) { layout = v; layoutSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === v))); for (const n of nodes) { n.pinned = false; n.fx = n.fy = null; } computeLayout(); join(); drawScene(); userZoomed = false; kick(0.9); applyStates(); fit(true); }
    function setGroup(v) { group = v; groupSeg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.group === v))); setLayout(layout); }

    // ---------- detail panel ----------
    const kv = (rows) => h('dl.kv.graph-kv', null, ...rows.filter(Boolean).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
    const jump = (n, extra) => h('button.graph-jump', { onclick: (ev) => select([n.id], { center: true, add: ev.shiftKey }), onpointerenter: () => setHover(n), onpointerleave: () => setHover(null) }, mini(n.type, nodeClass(n)), h('span.grow', null, n.type === 'room' ? n.long : n.type === 'sensor' ? n.label : chartLabel(n), extra ? h('span.dim', null, ' · ' + extra) : null));
    const statusTag = (n) => { const d = n.type === 'person' ? null : n.data; if (n.type === 'person') return h('span.tag.tag-person', null, n.status === 'reached' ? 'Reached' : 'Located'); if (n.type === 'lead') return h('span.tag.' + (d.status === 'confirmed' ? 'tag-person' : d.status === 'possible' ? 'tag-warn' : ''), null, d.status === 'confirmed' ? 'Confirmed' : d.status === 'possible' ? 'Possible' : 'Closed'); return null; };

    function locator(n) {
      let pos = n.pos, poly = n.type === 'hazard' ? n.data.poly : null; const room = n.type === 'room' ? n.data.room : null;
      if (!pos && !poly && !room) return null;
      const B = world.BUILDING.rect, inB = (p) => p[0] > B[0] - 5 && p[0] < B[2] + 5 && p[1] > B[1] - 5 && p[1] < B[3] + 5;
      const pts = poly || (pos ? [pos] : []);
      const site = pts.some((p) => !inB(p));
      const bx = [B[0], B[2], ...pts.map((p) => p[0])], by = [B[1], B[3], ...pts.map((p) => p[1])];
      const vb = site ? [Math.max(0, Math.min(...bx) - 8), Math.max(0, Math.min(...by) - 8), 0, 0] : [B[0] - 4, B[1] - 4, B[2] - B[0] + 8, B[3] - B[1] + 8];
      if (site) { vb[2] = Math.min(world.SITE.w, Math.max(...bx) + 8) - vb[0]; vb[3] = Math.min(world.SITE.h, Math.max(...by) + 8) - vb[1]; if (vb[3] < vb[2] * 0.5) { const add = vb[2] * 0.5 - vb[3]; vb[1] = Math.max(0, vb[1] - add / 2); vb[3] += add; } }
      const Y = (y) => vb[1] * 2 + vb[3] - y; // flip north up
      const s = d3.create('svg').attr('class', 'graph-loc').attr('viewBox', `${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`).attr('role', 'img').attr('aria-label', 'Where this is on the plan of the exercise site. North is up.');
      const px = vb[2] / 300;
      if (site) for (const o of world.OBSTACLES) if (o.kind === 'building') s.append('path').attr('class', 'graph-loc-other').attr('d', 'M' + o.poly.map((p) => [p[0], Y(p[1])]).join('L') + 'Z');
      for (const r of world.ROOMS) s.append('rect').attr('class', 'graph-loc-room' + (room && r.id === room.id ? ' is-on' : '') + (n.lane === r.id && !room ? ' is-lane' : '')).attr('x', r.rect[0]).attr('y', Y(r.rect[3])).attr('width', r.rect[2] - r.rect[0]).attr('height', r.rect[3] - r.rect[1]);
      for (const w of world.WALLS) s.append('line').attr('class', 'graph-loc-wall w-' + w.state + ' m-' + w.mat).attr('x1', w.a[0]).attr('y1', Y(w.a[1])).attr('x2', w.b[0]).attr('y2', Y(w.b[1])).attr('stroke-width', (w.mat === 'concrete' ? 2.2 : 1.2) * px);
      if (!site) for (const r of world.ROOMS) if (!r.corridor) s.append('text').attr('class', 'graph-loc-num').attr('x', (r.rect[0] + r.rect[2]) / 2).attr('y', Y((r.rect[1] + r.rect[3]) / 2) + 1).attr('text-anchor', 'middle').attr('font-size', 9 * px).text(r.id);
      if (poly) s.append('path').attr('class', 'graph-loc-hz').attr('d', 'M' + poly.map((p) => [p[0], Y(p[1])]).join('L') + 'Z').attr('stroke-width', 1.2 * px);
      if (pos && !poly && !room) {
        const sg = n.data?.posSigma ?? null;
        if (sg) s.append('circle').attr('class', 'graph-loc-sigma').attr('cx', pos[0]).attr('cy', Y(pos[1])).attr('r', Math.max(sg, 2.5 * px)).attr('stroke-width', px);
        s.append('circle').attr('class', 'graph-loc-dot k-' + n.type + ' s-' + n.status).attr('cx', pos[0]).attr('cy', Y(pos[1])).attr('r', (site ? 5 : 4) * px).attr('stroke-width', 1.5 * px);
      }
      const cap = site ? 'Building B and its surroundings. North is up.' : 'Building B. North is up.';
      return h('figure.graph-locfig', null, s.node(), h('figcaption', null, cap + (pos && !poly && !room ? ' At ' + fmt.pos(pos) + ' m' + (n.data?.posSigma ? ', give or take ' + n.data.posSigma.toFixed(1) + ' m.' : '.') : '')));
    }

    function whyBlock(det) {
      const c = whyChain(det), maxLn = Math.max(Math.log(8), ...c.steps.map((s) => Math.abs(s.ln)));
      const W = 296, H = 74, m = { l: 30, r: 8, t: 8, b: 14 }, pts = [c.prior, ...c.steps.map((s) => s.p)];
      const x = d3.scaleLinear([0, Math.max(1, pts.length - 1)], [m.l, W - m.r]), y = d3.scaleLinear([0, 1], [H - m.b, m.t]);
      const sv = d3.create('svg').attr('class', 'graph-spark').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', `Probability after each reading, from ${pct(c.prior)} to ${pct(c.p)}`);
      for (const [v, l] of [[THRESHOLDS.confirmed, 'confirmed'], [THRESHOLDS.possible, 'open']]) { sv.append('line').attr('class', 'graph-spark-th').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(v)).attr('y2', y(v)); sv.append('text').attr('class', 'graph-spark-tx').attr('x', m.l + 4).attr('y', y(v) - 3).text((v * 100).toFixed(0) + ' % ' + l); }
      for (const v of [0, 1]) sv.append('text').attr('class', 'graph-spark-tx').attr('x', m.l - 5).attr('y', y(v) + 3).attr('text-anchor', 'end').text(v * 100 + ' %');
      sv.append('path').attr('class', 'graph-spark-line s-' + det.status).attr('d', d3.line().x((d, i) => x(i)).y((d) => y(d)).curve(d3.curveStepAfter)(pts));
      sv.selectAll('circle').data(pts).join('circle').attr('class', (d, i) => 'graph-spark-dot' + (i === pts.length - 1 ? ' is-last s-' + det.status : '')).attr('cx', (d, i) => x(i)).attr('cy', (d) => y(d)).attr('r', (d, i) => (i === pts.length - 1 ? 3.5 : 2));
      sv.append('text').attr('class', 'graph-spark-tx').attr('x', m.l).attr('y', H - 2).text('prior'); sv.append('text').attr('class', 'graph-spark-tx').attr('x', W - m.r).attr('y', H - 2).attr('text-anchor', 'end').text('reading ' + c.steps.length);
      const verdict = c.cls === 'confirmed' ? `${pct(c.p)}: confirmed (at or above ${pct(THRESHOLDS.confirmed)})` : c.cls === 'possible' ? `${pct(c.p)}: stays open as possible (between ${pct(THRESHOLDS.possible)} and ${pct(THRESHOLDS.confirmed)})` : det.dismissed ? `${pct(c.p)}: dismissed by the operator` : `${pct(c.p)}: closed (below ${pct(THRESHOLDS.possible)})`;
      return h('section.graph-sec', null, h('h4', null, det.status === 'rejected' ? 'Why was this lead closed?' : 'Why do we believe this?'),
        h('p.graph-sec-lede', null, `Bayes’ rule, one step per reading, in the order they arrived. Each reading multiplies the odds by its likelihood ratio.`), sv.node(),
        h('ol.graph-chain', null, h('li.graph-step.is-prior', null, h('span.graph-step-t.num', null, 'start'), h('span.graph-step-main', null, h('b', null, 'Before any reading'), h('span.dim', null, 'Chance that a given room holds a person (assumed)')), h('span.graph-step-p.num', null, pct(c.prior))),
          ...c.steps.map((s) => { const nd = nodeMap.get(s.node); const dir = s.ln > 0.001 ? 'for' : s.ln < -0.001 ? 'against' : 'none', wd = (Math.abs(s.ln) / maxLn) * 50;
            return h('li', null, h('button.graph-step.d-' + dir, { 'aria-label': `${s.name}, ${s.word}. Times ${fmtLr(s.lr)}. Probability now ${pct(s.p)}`, onclick: () => nd && select([nd.id], { center: true }), onpointerenter: () => nd && setHover(nd), onpointerleave: () => setHover(null) },
              h('span.graph-step-t.num', null, clock(s.t), h('i', null, s.vantage === 'aerial' ? 'drone' : s.vantage)),
              h('span.graph-step-main', null, h('b', null, s.name), h('span.dim', null, s.note), h('span.graph-wbar', { 'aria-hidden': 'true' }, h('i', { style: { width: wd + '%', [dir === 'against' ? 'right' : 'left']: '50%' } }))),
              h('span.graph-step-p', null, h('span.num.graph-lr', null, dir === 'none' ? '×1' : '×' + fmtLr(s.lr)), h('span.num', null, pct(s.p)), h('span.graph-flag', null, dir === 'none' ? 'no information' : (s.assumed ? 'design value' : 'measured') + (s.repeat ? ', half weight' : '')))));
          })),
        h('p.graph-verdict.s-' + det.status, null, verdict),
        c.steps.some((s) => s.repeat) ? h('p.graph-fine', null, 'Half weight: a repeat reading by the same sensor from the same spot is not independent, so only the square root of its ratio counts (an assumption).') : null);
    }
    function mindBlock(det) {
      const c = changeMind(det);
      const say = (r) => (!r.flips ? null : r.cls === 'unlikely' ? 'closes the lead' : r.cls === 'confirmed' ? 'confirms' : c.now === 'confirmed' ? 'back to possible' : 'reopens the lead');
      const row = (r) => h('li.graph-mind' + (r.flips ? '.is-flip' : ''), null, h('span.graph-mind-t', null, r.text, h('span.graph-flag', null, r.assumed ? 'design value' : 'measured')), h('span.num.graph-lr', null, '×' + fmtLr(r.lr)), h('span.num.graph-mind-p', null, pct(r.p)), h('span.graph-mind-say', null, say(r) || ''));
      const list = (g) => g.used.map((u) => u.text.charAt(0).toLowerCase() + u.text.slice(1)).join('; ');
      const human = det.evidence.some((e) => e.sensor === 'human');
      return h('section.graph-sec', null, h('h4', null, 'What would change our mind?'),
        h('p.graph-sec-lede', null, 'Each line adds one new reading from a fresh position and runs the same fusion again. Now: ' + pct(c.p) + '.'),
        c.now !== 'unlikely' ? h('div', null, h('h5', null, 'Readings that would count against'), h('ul.graph-minds', null, ...c.against.map(row))) : null,
        c.close ? h('p.graph-verdict', null, c.close.ok ? `To close this lead it would take ${c.close.used.length === 1 ? 'one reading' : c.close.used.length + ' readings together'}: ${list(c.close)}. Result: ${pct(c.close.p)}.` : `Even all ${c.close.used.length} contradicting readings together would leave it at ${pct(c.close.p)}. ${human ? 'A rescuer has seen the person: no sensor reading outweighs that.' : 'Sensors alone cannot close it; someone has to look.'}`) : null,
        c.now !== 'confirmed' ? h('div', null, h('h5', null, c.now === 'unlikely' ? 'Readings that would reopen it' : 'Readings that would count for'), h('ul.graph-minds', null, ...c.forIt.map(row))) : null,
        c.confirm ? h('p.graph-verdict', null, c.confirm.ok ? `Fewest sensor readings that would confirm a person here: ${list(c.confirm)}. Result: ${pct(c.confirm.p)}.` : `No combination of sensor readings would confirm this; only a rescuer on site would.`) : null,
        h('p.graph-fine', null, 'These are computed with the fusion code the mission uses. The Wi-Fi ratio is measured on 955 simulated test windows; every other ratio is a design value.'));
    }
    function connections(n) {
      const groups = d3.groups(neighbours(n.id), (a) => (a.out ? a.link.label : ({ supports: 'supported by', contradicts: 'contradicted by', neutral: 'no information from', confirmed: 'confirmed from', from: 'readings taken here', by: 'readings', inRoom: 'leads here', covers: 'sensed from', carries: 'carried by', visited: a.link.label === 'assigned' ? 'walked by' : 'visited by', threatens: 'affected by', leadsTo: 'reached by', avoids: 'avoided by', approvedBy: 'approves', about: 'mentioned by' })[a.link.kind] || a.link.label));
      if (!groups.length) return null;
      return h('section.graph-sec', null, h('h4', null, 'Linked objects', h('span.num.dim', null, ' ' + n.degree)), ...groups.map(([label, list]) => h('div.graph-conn', null, h('h5', null, label), ...list.sort((a, b) => (a.node.t ?? 0) - (b.node.t ?? 0)).map((a) => jump(a.node, evidenceKinds.has(a.link.kind) && a.link.kind !== 'neutral' ? '×' + fmtLr(a.link.lr) : a.link.note || (a.node.t != null ? clock(a.node.t) : ''))))));
    }
    function bodyFor(n) {
      const S = ctx.sim.state, d = n.data;
      switch (n.type) {
        case 'person': case 'lead': {
          const det = n.type === 'person' ? S.detections.find((x) => x.id === n.det) : d; if (!det) return [];
          const sv = det.survivorId && S.survivors[det.survivorId], leg = S.routes.rescue?.legs.find((l) => l.det === det.id && l.ok);
          return [kv([['Where', n.long], ['How sure', h('b.num', null, pct(det.p))], ['Status', det.status === 'confirmed' ? (sv?.status === 'reached' ? 'Confirmed. Reached by the team at ' + clock(sv.reachedAt) : 'Confirmed, located') : det.status === 'possible' ? (det.needsTeam ? 'Possible. Handed to the rescue team to check' : 'Possible. Needs a second look') : 'Closed: ' + det.kind],
            sv ? ['Seen as', sv.motion === 'moving' ? 'Moving' : 'Still'] : null, ['First reading', clock(det.t)], sv ? ['Confirmed at', clock(sv.foundAt)] : null, ['Readings', String(det.evidence.length) + ' from ' + new Set(det.evidence.map((e) => e.vantage)).size + (new Set(det.evidence.map((e) => e.vantage)).size === 1 ? ' position' : ' positions')],
            leg ? ['Way in', leg.kind === 'walk in' ? 'Walk in, ' + leg.length.toFixed(0) + ' m leg' : 'Break through, ' + leg.gap.toFixed(1) + ' m from the wall'] : null]),
          det.status === 'rejected' ? h('p.note.ok', null, det.reason) : null, locator(n), whyBlock(det), mindBlock(det)];
        }
        case 'reading': {
          const info = SENSOR_INFO[n.sensor] || {}, table = LR[n.sensor] || {};
          return [kv([['Sensor', info.name || n.sensor], ['Says', n.long], ['Taken', clock(n.t) + ', from ' + (nodeMap.get('ST:' + n.vantage)?.long || n.vantage)], ['Reality', realityTag(info.real || 'sim')],
            d.score != null ? ['Network output', h('span.num', null, d.score.toFixed(3) + ' (alarm above ' + ctx.nn.threshold.toFixed(2) + ')')] : null, d.moving != null ? ['Moving head', h('span.num', null, d.moving.toFixed(3))] : null, d.sample != null ? ['Test window', h('span.num', null, '#' + d.sample + ' of 30, ' + (ctx.nn.samples[d.sample]?.cat || '').toLowerCase())] : null]),
            h('section.graph-sec', null, h('h4', null, 'What it is worth'), ...n.leads.map((l) => { const ld = nodeMap.get('L:' + l.det); const dir = l.lr > 1.001 ? 'supports' : l.lr < 0.999 ? 'contradicts' : 'says nothing about'; return h('p.graph-worth', null, h('b.num', null, '×' + fmtLr(l.lr)), ' ', dir, ' ', ld ? jump(ld) : l.det, h('span.dim', null, Math.abs(l.lr - 1) < 0.001 ? 'The sensor could not see, so the odds do not move.' : `This result is ${l.lr > 1 ? fmtLr(l.raw) + ' times more' : fmtLr(1 / l.raw) + ' times less'} likely when a person is there than when no one is${l.repeat ? ' (counted at half weight as a repeat)' : ''}. After it: ${pct(l.p)}.`)); }),
              h('p.graph-fine', null, table.assumed === false ? 'Measured: on the 955 simulated test windows the network says "person" for 47.6 % of person windows and 11.1 % of empty ones.' : 'This ratio is a design value. The sensor has not been characterised yet.')),
            n.sensor === 'csi' && d.sample != null ? h('button.btn.btn-sm', { onclick: () => ctx.shell.open('sense', { sample: d.sample }) }, icon('wifi'), 'Open the Wi-Fi AI workspace') : null];
        }
        case 'sensor': { const t = d.lr || {}; return [h('p.graph-para', null, d.info.what), kv([['Reality', realityTag(d.info.real)], ['Readings so far', String(d.n)], ...Object.entries(t).filter(([k, v]) => typeof v === 'number').map(([k, v]) => ['If it says "' + ({ pos: 'positive', neg: 'negative', faint: 'faint', machine: 'machine-like', tooHot: 'too hot' }[k] || k) + '"', h('span.num', null, 'odds ×' + fmtLr(v))])]), h('p.graph-fine', null, t.assumed === false ? 'Ratios measured on 955 simulated test windows.' : 'Ratios are assumed design values, not measurements.')]; }
        case 'stop': return [kv([['Place', n.long], n.pos ? ['Position', fmt.pos(n.pos) + ' m'] : null, ['Status', n.status === 'planned' ? 'Planned, not reached yet' : 'Readings taken from ' + clock(n.t)], d.covers ? ['Can sense', d.covers.map((r) => 'room ' + r).join(', ')] : null]), locator(n), d.covers ? h('p.graph-fine', null, 'The rover must stop to listen: the Wi-Fi network needs a 10 second window and cannot listen while driving.') : null];
        case 'unit': { const u = S.units[d.id]; return [h('p.graph-para', null, n.sub), kv([['Doing', u.mode], ['Position', fmt.pos(u.pos) + ' m'], ['Distance covered', u.odo.toFixed(0) + ' m'], u.kind === 'rover' ? ['Battery', pct(u.battery)] : null, u.kind === 'rover' ? ['Radio link', pct(u.link)] : null, ['Reality', realityTag(u.kind === 'drone' ? 'concept' : 'sim')]]), locator(n)]; }
        case 'room': { const c = d.cov; return [kv([['Search status', n.sub], ['Sensor reach', h('span', null, h('span.num', null, Math.round((c.reach || 0) * 100) + ' %'), ' of the room')], c.status === 'person' || c.status === 'lead' ? ['Chance a person is here', h('b.num', null, pct(c.residual))] : ['Chance someone was missed', h('b.num', null, pct(c.residual))], c.stop ? ['Searched from', c.stop + (c.t != null ? ' at ' + clock(c.t) : '')] : null]), c.status === 'person' || c.status === 'lead' ? null : h('div.graph-resbar', { title: 'Chance someone was missed, on a scale to 20 %' }, h('i', { style: { width: Math.min(100, c.residual * 100 / 0.2 * 1) + '%' } })), h('p.graph-fine', null, (c.note || '') + (c.status === 'person' || c.status === 'lead' ? ' Others in the same room cannot be ruled out.' : ' The bar is scaled to 20 %. Before any search the chance is 10 % per room (assumed).')), locator(n)]; }
        case 'hazard': return [kv([['What', n.long], ['Effect on routes', n.sub], d.t != null ? ['Appeared at', clock(d.t)] : null]), locator(n)];
        case 'route': { const r = d; return [kv([['Status', n.sub.split(' · ')[0]], ['Length', r.length.toFixed(0) + ' m'], ['On foot', 'about ' + Math.max(1, Math.round(r.etaS / 60)) + ' min (1.1 m/s, design value)'], ['Planned at', clock(r.plannedAt)], r.approvedAt != null ? ['Approved', clock(r.approvedAt) + ' by ' + (r.approvedBy === 'autoplay' ? 'autoplay (demo)' : r.approvedBy)] : ['Approved', 'Not yet. A person must approve it.']]),
          h('section.graph-sec', null, h('h4', null, 'Legs'), h('ol.graph-legs', null, ...r.legs.map((l) => h('li', null, l.ok ? `${l.survivor || l.det}: ${l.length.toFixed(0)} m, ${l.kind}${l.reached ? '' : ' (' + l.gap.toFixed(1) + ' m of wall and debris to the person)'}${l.arrivedAt != null ? ', arrived ' + clock(l.arrivedAt) : ''}` : `${l.det}: no safe path (${l.reason})`)))),
          h('p.graph-fine', null, 'Planned by a live A* search over the hazard map. The team that walks it is simulated.')]; }
        case 'alert': case 'decision': return [h('p.graph-para', null, n.long), kv([['Time', clock(n.t)], n.type === 'decision' ? ['Decided by', n.by] : ['Level', d.level === 'alert' ? 'Alert' : 'Warning'], ['Log entry', d.id + ' · ' + d.code]]), n.type === 'decision' && !n.human ? h('p.graph-fine', null, /Autoplay/.test(n.by) ? 'Autoplay made this routine choice so the demo runs by itself. Turn autoplay off and the operator must make it.' : 'Made by a fixed rule of the software, not by a person.') : null];
        default: return [];
      }
    }
    function nodePanel(n) {
      const isLead = n.type === 'person' || n.type === 'lead';
      return h('div.graph-dwrap', null,
        h('header.graph-dhead', null, mini(n.type, nodeClass(n) + ' graph-mini-lg'), h('div.grow', null, h('div.graph-dtype', null, TYPES[n.type].label, statusTag(n)), h('h3', null, n.type === 'room' ? n.long : n.label)), h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Clear the selection', onclick: () => select([]) }, icon('close'))),
        h('div.graph-dactions', null,
          isLead ? h('button.btn.btn-primary.btn-sm', { onclick: () => { isolate([...whyPath(n)]); ctx.shell.toast('Showing only the evidence path for ' + n.label + '. “Show everything” brings the rest back.', { level: 'info' }); } }, 'Trace the evidence') : h('button.btn.btn-primary.btn-sm', { onclick: () => expand([n.id]) }, 'Expand neighbours'),
          isLead ? h('button.btn.btn-sm', { onclick: () => expand([n.id]) }, 'Expand') : null,
          h('button.btn.btn-sm', { onclick: () => hide([n.id]) }, 'Hide'),
          n.ref && n.type !== 'reading' ? h('button.btn.btn-sm', { title: 'Open the 3-D mission view with this selected', onclick: () => { ctx.select({ ...n.ref }); ctx.shell.open('mission'); } }, 'Show in mission') : null),
        h('div.graph-dbody', null, ...bodyFor(n).filter(Boolean), connections(n)));
    }
    function multiPanel() {
      const list = [...sel].map((id) => nodeMap.get(id)).filter(Boolean), by = d3.groups(list, (n) => n.type).sort((a, b) => TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]));
      return h('div.graph-dwrap', null, h('header.graph-dhead', null, h('div.grow', null, h('div.graph-dtype', null, 'Selection'), h('h3', null, list.length + ' objects')), h('button.btn.btn-ghost.btn-sm.btn-icon', { 'aria-label': 'Clear the selection', onclick: () => select([]) }, icon('close'))),
        h('div.graph-dactions', null, h('button.btn.btn-primary.btn-sm', { onclick: () => expand([...sel]) }, 'Expand neighbours'), h('button.btn.btn-sm', { onclick: () => isolate([...sel]) }, 'Isolate'), h('button.btn.btn-sm', { onclick: () => hide([...sel]) }, 'Hide')),
        h('div.graph-dbody', null, ...by.map(([t, ns]) => h('div.graph-conn', null, h('h5', null, TYPES[t].plural + ' · ' + ns.length), ...ns.map((n) => jump(n, n.t != null ? clock(n.t) : ''))))));
    }
    function overviewPanel() {
      const S = ctx.sim.state, rd = nodes.filter((n) => n.type === 'reading'), cov = Object.values(S.coverage);
      const leads = nodes.filter((n) => n.type === 'lead').sort((a, b) => a.t - b.t), people = nodes.filter((n) => n.type === 'person');
      const stat = (v, l) => h('div.stat', null, h('b', null, String(v)), h('span', null, l));
      return h('div.graph-dwrap', null, h('header.graph-dhead', null, h('div.grow', null, h('div.graph-dtype', null, 'Nothing selected'), h('h3', null, 'The case so far'))),
        h('div.graph-dbody', null,
          h('div.graph-stats', null, stat(people.length, people.length === 1 ? 'person located' : 'people located'), stat(leads.filter((n) => n.status === 'possible').length, 'leads open'), stat(leads.filter((n) => n.status === 'rejected').length, 'leads closed'), stat(rd.filter((n) => n.dir === 'supports' || n.dir === 'mixed').length, 'readings for'), stat(rd.filter((n) => n.dir === 'contradicts').length, 'readings against'), stat(cov.filter((c) => c.status === 'unsearched' || c.status === 'blocked').length + ' of ' + cov.length, 'rooms not searched')),
          leads.length ? h('section.graph-sec', null, h('h4', null, 'Start with a person or a lead'), h('p.graph-sec-lede', null, 'Pick one to see the readings behind it, each with its weight, and what would change the answer.'), ...people.map((n) => jump(n, n.sub)), ...leads.filter((n) => n.status !== 'confirmed').map((n) => jump(n, n.sub)))
            : h('p.note', null, icon('info'), h('span', null, 'No readings yet. The chart already holds the units, rooms, planned stops and hazards; leads and their evidence appear as the drone and the rover report.')),
          h('section.graph-sec', null, h('h4', null, 'How to read it'), h('ul.graph-how', null, h('li', null, 'Shapes are kinds of object; the legend on the chart lists them and filters them.'), h('li', null, 'A filled amber reading with a plus pushes towards "a person is here". A hollow green one with a minus pushes away. Size is how hard it pushes.'), h('li', null, 'Nothing here uses ground truth. The chart only knows what the sensors and the log recorded.'))), h('section.graph-sec', null, h('h4', null, 'Working the chart'), h('dl.graph-keys', null, ...[['Click', 'select, and see why'], ['Shift + click', 'add to the selection'], ['Shift + drag', 'lasso a group'], ['Double-click', 'expand neighbours'], ['Drag a node', 'pin it in place'], ['/', 'search']].flatMap(([k, v]) => [h('dt', null, h('kbd', null, k)), h('dd', null, v)])))));
    }
    function renderDetail() {
      const keep = detail.querySelector('.graph-dbody')?.scrollTop || 0, was = detail.dataset.for;
      const n = primary && nodeMap.get(primary);
      detail.replaceChildren(sel.size > 1 ? multiPanel() : n ? nodePanel(n) : overviewPanel());
      detail.dataset.for = sel.size > 1 ? 'multi' : n ? n.id : '';
      if (was === detail.dataset.for) { const b = detail.querySelector('.graph-dbody'); if (b) b.scrollTop = keep; }
    }

    // ---------- wiring ----------
    const fromSelection = (s) => { if (!s) return null; const id = ({ survivor: 'P:', detection: 'L:', unit: 'U:', room: 'RM:', hazard: 'HZ:', stop: 'ST:' })[s.type]; if (id) return nodeMap.has(id + s.id) ? id + s.id : null; if (s.type === 'event') { if (nodeMap.has('AL:' + s.id)) return 'AL:' + s.id; if (nodeMap.has('DC:' + s.id)) return 'DC:' + s.id; const ev = ctx.sim.state.events.find((e) => e.id === s.id); if (ev?.det && nodeMap.has('L:' + ev.det)) return 'L:' + ev.det; } return null; };
    function onSelect(s) { if (s === lastEmitted) return; const id = fromSelection(s); if (!id || (sel.size === 1 && sel.has(id))) return; select([id], { silent: true, center: shown }); }
    let tickGate = 0, firstShow = true;
    unsub.push(ctx.bus.on('tick', () => { if (!shown) return; const now = performance.now(); if (now - tickGate < 300) return; tickGate = now; if (!rebuild() && layout === 'time') gLanes.select('.graph-now').attr('x1', ctx.sim.state.t * PPS).attr('x2', ctx.sim.state.t * PPS); tNow.attr('x1', tx(ctx.sim.state.t)).attr('x2', tx(ctx.sim.state.t)); }));
    for (const ev of ['reset', 'seek']) unsub.push(ctx.bus.on(ev, () => { sig = ''; if (ev === 'reset') { isolated = null; forced.clear(); hiddenIds.clear(); timeRange = null; timeReadout(); } if (shown) rebuild(true); }));
    unsub.push(ctx.bus.on('select', onSelect));
    unsub.push(ctx.bus.on('escape', () => { if (shown && sel.size) select([]); }));
    unsub.push(ctx.bus.on('prefs', () => { if (shown) kick(0.05); }));
    const onKey = (e) => { if (!shown || e.metaKey || e.ctrlKey || e.altKey) return; const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName); if (e.key === '/' && !typing) { e.preventDefault(); searchIn.focus(); } };
    window.addEventListener('keydown', onKey);
    const ro = new ResizeObserver(() => { if (!shown) return; renderTime(); if (!userZoomed) fit(false); });
    ro.observe(stage); ro.observe(timeBox);

    renderLegend(); renderDetail();
    const applyParams = (p) => { if (!p) return; if (p.view) setView(p.view); if (p.layout) setLayout(p.layout); if (p.group) setGroup(p.group); if (p.time !== undefined) setTime(p.time); if (p.q != null) { searchIn.value = p.q; query = String(p.q).toLowerCase(); applySearch(); } if (p.select) { const id = fromSelection(p.select) || (nodeMap.has(p.select) ? p.select : null); if (id) select([id], { center: true, silent: true }); } };
    return {
      onShow() { shown = true; applyMode(); rebuild(true); if (ctx.selection && !sel.size) onSelect(ctx.selection); if (firstShow) { firstShow = false; applyParams(ctx.params); } requestAnimationFrame(() => { renderTime(); if (!userZoomed) fit(false); }); },
      onHide() { shown = false; hero.hide(); cancelAnimationFrame(raf); raf = 0; tip.hidden = true; simulation.alpha(0); },
      onParams: applyParams,
      // For tests and other workspaces.
      api: { select, expand, isolate, showAll, setLayout, setGroup, setView, setTime, get graph() { return G; } },
    };
  },
};
