// Training: practise being the operator. Lessons first, then drills on the real mission engine, then a debrief
// that compares your choices with the autoplay policy and with ground truth. Progress is kept in this browser.
import { LEVELS } from './scenario.js';

export const LESSON_META = [
  { id: 'wifi', title: 'How Wi-Fi sensing works, and where it stops', minutes: 4, screens: 3, blurb: 'Drag a person through the echoes, then try to beat the network on real test windows.' },
  { id: 'fusion', title: 'Why three sensors beat one', minutes: 3, screens: 2, blurb: 'Build a finding one reading at a time and watch the odds move.' },
  { id: 'probability', title: 'Reading a probability', minutes: 3, screens: 2, blurb: 'What 21 % asks of you, and why an alarm is not an answer.' },
  { id: 'approval', title: 'Why a person approves the route', minutes: 3, screens: 2, blurb: 'Run the planner yourself, then catch the route it should not have proposed.' },
];
const KEY = 'hound.train.v1';
function load() { try { const v = JSON.parse(localStorage.getItem(KEY)); if (v && v.v === 1) return { lessons: {}, levels: {}, runs: [], ...v }; } catch { /* no storage, or damaged: start clean */ } return { v: 1, lessons: {}, levels: {}, runs: [] }; }
function save(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); return true; } catch { return false; } }

export default {
  async mount(root, ctx) {
    const { h, icon, realityTag } = ctx.kit;
    if (!document.getElementById('train-css')) document.head.append(h('link', { id: 'train-css', rel: 'stylesheet', href: new URL('./style.css', import.meta.url).href }));
    root.classList.add('train');
    let progress = load(), view = null, visible = false, saved = true;
    const body = h('div.train-body');
    root.append(body);

    function swap(next) { try { view?.destroy?.(); } catch (e) { console.error(e); } view = null; body.replaceChildren(); body.className = 'train-body'; body.scrollTop = 0; return next(); }
    const seedFor = (level) => (level.windows === 'scripted' ? ctx.world.SEED : 1000 + level.id * 7919 + ((progress.levels[level.id]?.runs || 0) + 1) * 104729);
    const recommend = () => { const l = LESSON_META.find((x) => !progress.lessons[x.id]); if (l) return { type: 'lesson', id: l.id }; const lv = LEVELS.find((x) => (progress.levels[x.id]?.best ?? -1) < 75) || LEVELS[LEVELS.length - 1]; return { type: 'drill', id: lv.id }; };

    // ---------- home: the syllabus ----------
    function home() {
      swap(() => {
        const rec = recommend(), doneLessons = LESSON_META.filter((l) => progress.lessons[l.id]).length;
        const row = (n, o) => h('li.train-row', { 'data-next': String(!!o.next), 'data-done': String(!!o.done) },
          h('span.train-node', { 'aria-hidden': 'true' }, o.done ? icon('check', 14) : String(n)),
          h('div.train-rowmain', null, h('h3', null, o.title), h('p', null, o.blurb), o.facts ? h('div.train-facts', null, ...o.facts.map((f) => h('span', null, f))) : null),
          h('div.train-rowstate', null, o.state),
          h('button.btn' + (o.next ? '.btn-primary' : ''), { onclick: o.go, 'aria-label': o.action + ': ' + o.title }, o.action, icon('arrow-right', 14)));
        const lessons = LESSON_META.map((l, i) => row(i + 1, { title: l.title, blurb: l.blurb, done: progress.lessons[l.id], next: rec.type === 'lesson' && rec.id === l.id,
          state: h('span.train-meta', null, l.screens + ' screens · ' + l.minutes + ' min'), action: progress.lessons[l.id] ? 'Again' : 'Open', go: () => lesson(l.id) }));
        const drills = LEVELS.map((lv, i) => { const p = progress.levels[lv.id]; return row(i + 1, { title: 'Level ' + lv.id + ': ' + lv.name, blurb: lv.sub, facts: lv.facts, done: (p?.best ?? -1) >= 75, next: rec.type === 'drill' && rec.id === lv.id,
          state: p ? h('div.train-best', { title: p.runs + (p.runs === 1 ? ' run' : ' runs') }, h('b.num', null, String(p.best)), h('span', null, 'best of ' + p.runs)) : h('span.train-meta', null, 'Not run yet'), action: p ? 'Run again' : 'Start drill', go: () => drill(lv.id) }); });
        const runs = progress.runs.slice(-6).reverse();
        const record = h('aside.train-record', { 'aria-label': 'Your record' },
          h('h3', null, 'Your record'),
          h('div.train-recgrid', null,
            h('div.stat', null, h('b', null, doneLessons + ' / ' + LESSON_META.length), h('span', null, 'lessons finished')),
            h('div.stat', null, h('b', null, String(progress.runs.length ? Math.max(...progress.runs.map((r) => r.score)) : '–')), h('span', null, 'best drill score'))),
          h('div.train-levels', null, ...LEVELS.map((lv) => { const p = progress.levels[lv.id]; return h('div.meter-row', null, h('span', null, 'Level ' + lv.id), h('span.meter-wrap', { style: '--mark:0.75' }, h('div.meter' + (p && p.best >= 75 ? '.ok' : ''), { style: '--v:' + (p?.best || 0) / 100, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': p?.best || 0, 'aria-label': 'Best score, level ' + lv.id })), h('span', null, p ? String(p.best) : '–')); })),
          h('p.caption', null, 'The tick marks 75, the score that counts as a pass.'),
          runs.length ? h('div.train-runs', null, h('h4', null, 'Last runs'), h('table.table.dense', null, h('tbody', null, ...runs.map((r) => h('tr', null, h('td', null, 'Level ' + r.level), h('td.num', null, 'scenario ' + r.seed), h('td.num', null, r.clock), h('td.num', null, h('b', null, String(r.score)))))))) : h('p.train-norun', null, 'No drills yet. Your scores will be kept here, in this browser only.'),
          h('div.train-recfoot', null,
            h('button.btn', { onclick: card }, icon('print', 14), 'Operator card'),
            progress.runs.length || doneLessons ? h('button.btn.btn-ghost', { onclick: async () => { if (await ctx.shell.confirm({ title: 'Clear your training record?', body: 'Lesson ticks and drill scores saved in this browser will be removed.', confirmLabel: 'Clear record', danger: true })) { progress = { v: 1, lessons: {}, levels: {}, runs: [] }; saved = save(progress); home(); } } }, 'Clear record') : null),
          saved ? null : h('p.note.warn', null, icon('alert'), h('span', null, 'This browser is not letting the page save. Your record lasts until you close the tab.')),
          h('div.train-who', null, h('h4', null, 'Who this is for'), h('p', null, 'Volunteer and student teams. The rover is cheap enough to build; the judgement is the hard part. Here a new operator can meet a false alarm, a silent sensor and a bad route before any of them is real.')));
        body.classList.add('train-home');
        body.append(
          h('header.ws-head', null, h('div', null, h('div.row', null, h('h1', null, 'Training'), realityTag('live-algo')), h('p', null, 'Practise the operator’s decisions on the real mission engine, with the real network, and get a debrief that shows what you could not see. The scenario and its people are simulated.'))),
          h('div.train-homegrid', null,
            h('div.train-syllabus', null,
              h('section', { 'aria-label': 'Lessons' }, h('div.train-sechead', null, h('h2', null, 'Learn'), h('span.train-meta', null, 'four short lessons, about ' + LESSON_META.reduce((a, l) => a + l.minutes, 0) + ' minutes, each built on a figure you can move')), h('ol.train-track', null, ...lessons)),
              h('section', { 'aria-label': 'Drills' }, h('div.train-sechead', null, h('h2', null, 'Drill'), h('span.train-meta', null, 'you decide; the clock fast-forwards between decisions; a new scenario every run')), h('ol.train-track', null, ...drills))),
            record));
        view = { destroy() {} };
      });
    }

    // ---------- the other views are loaded when first opened ----------
    async function lesson(id, screen) {
      let mod; try { mod = await import('./lessons.js'); } catch (e) { console.error(e); ctx.shell.toast('The lesson could not be loaded: ' + (e.message || e), { level: 'alert' }); return; }
      swap(() => { body.classList.add('train-lesson'); view = mod.openLesson(body, ctx, id, { screen, onExit: home, onDone: (done) => { progress.lessons[done] = true; saved = save(progress); const i = LESSON_META.findIndex((l) => l.id === done), nextL = LESSON_META[i + 1]; ctx.shell.toast(nextL ? 'Lesson finished. Next: ' + nextL.title + '.' : 'All four lessons finished. Level 1 is ready.', { level: 'ok' }); home(); } }); });
    }
    async function drill(levelId, seed) {
      const level = LEVELS.find((l) => l.id === +levelId) || LEVELS[0];
      let mod; try { mod = await import('./drill.js'); } catch (e) { console.error(e); ctx.shell.toast('The drill could not be loaded: ' + (e.message || e), { level: 'alert' }); return; }
      swap(() => { body.classList.add('train-drill'); view = mod.openDrill(body, ctx, { level, seed: seed ?? seedFor(level), visible: () => visible,
        onExit: home,
        onScore: (res) => { const p = progress.levels[level.id] || { best: 0, runs: 0 }; p.runs++; p.best = Math.max(p.best, res.total); progress.levels[level.id] = p; progress.runs.push({ level: level.id, seed: res.seed, score: res.total, clock: res.clock }); progress.runs = progress.runs.slice(-24); saved = save(progress); },
        onAgain: (sameSeed) => drill(level.id, sameSeed), onNext: () => drill(Math.min(LEVELS.length, level.id + 1)), onLesson: (id) => lesson(id) }); });
    }
    async function card() {
      let mod; try { mod = await import('./card.js'); } catch (e) { console.error(e); ctx.shell.toast('The operator card could not be loaded.', { level: 'alert' }); return; }
      swap(() => { body.classList.add('train-cardview'); view = mod.openCard(body, ctx, { onExit: home }); });
    }

    const q = new URLSearchParams(location.search);
    if (q.get('lesson')) await lesson(q.get('lesson'), +q.get('screen') || 1);
    else if (q.get('drill')) await drill(q.get('drill'), q.get('seed') ? +q.get('seed') : undefined);
    else if (q.has('card')) await card();
    else home();
    if (!view) home();

    return {
      onShow() { visible = true; view?.resume?.(); },
      onHide() { visible = false; view?.pause?.(); },
      onParams(p) { if (p?.lesson) lesson(p.lesson); else if (p?.drill) drill(p.drill); else if (p?.card) card(); },
    };
  },
};
