// Workspace "report": the hand-over document for the rescue team, written live from ctx.sim.state.
// A document viewer: A4 paper on a dark desk, an outline on the left, export and the reassurance message on the right.
import { buildReport, outlineOf, missionLog, clock } from './model.js';
import { buildBlocks, paginate } from './paper.js';
import { toMarkdown } from './markdown.js';
import { createReassurance } from './speech.js';
import { createReportHero } from './hero.js';
import { inlineFonts } from './raster.js';
import { finishedRun } from '../graph/run.js';

const SHEET_W = 794;
let cssLoaded = false, paperCss = '';
async function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  for (const f of ['./style.css', './paper.css']) {
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL(f, import.meta.url).href;
    document.head.append(link);
    await new Promise((res) => { link.onload = res; link.onerror = res; });
  }
  try { paperCss = await (await fetch(new URL('./paper.css', import.meta.url))).text(); } catch { paperCss = ''; }
}
const PRINT_CSS = '@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  '.report-sheet{width:210mm;height:297mm;margin:0;break-after:page;page-break-after:always;break-inside:avoid;--rp-paper:#fff}.report-sheet:last-child{break-after:auto;page-break-after:auto}' +
  '.report-blk,.report-person,.report-sigs,tr{break-inside:avoid}thead{display:table-header-group}h2,h3{break-after:avoid}' +
  '@media screen{body{background:#8b9198}.report-sheet{margin:16px auto;box-shadow:0 2px 14px rgba(0,0,0,.35)}}';
const FONT = (f) => new URL('../../../assets/brand/fonts/' + f, import.meta.url).href;
const FONT_CSS = '@font-face{font-family:"Instrument Sans";src:url("' + FONT('instrument-sans-latin-wdth-normal.woff2') + '") format("woff2");font-weight:400 700;font-stretch:75% 100%}' +
  '@font-face{font-family:"Instrument Serif";src:url("' + FONT('instrument-serif-latin-400-normal.woff2') + '") format("woff2");font-weight:400}' +
  '@font-face{font-family:"Geist Mono";src:url("' + FONT('geist-mono-latin-wght-normal.woff2') + '") format("woff2");font-weight:100 900}';
const bytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' kB' : (n / 1048576).toFixed(2) + ' MB');

export default {
  async mount(root, ctx) {
    await loadCss();
    const { h, icon, realityTag, panel } = ctx.kit;
    const sim = ctx.sim;
    let shown = false, dirty = true, R = null, lastSig = '', lastBuild = 0, timer = 0, pages = 0, selection = null, ownSelect = false, mdOn = false, md = '', log = null, printing = false, flashT = 0;
    const offs = []; let fontsSeen = false;

    // ---------- chrome ----------
    root.classList.add('report');
    const stamp = h('span.report-stamp', { role: 'status', title: 'Mission clock at the last rewrite of the report' }, 'Updated at ', h('b.num', null, '00:00'));
    const head = h('header.ws-head.adv-only', null,
      h('div', null, h('h1', null, 'Hand-over report'), h('p', null, 'What the incoming rescue team needs on one document: who was found and where, what is left to search, the way in, and every test result. Rewritten live from the mission log.')),
      realityTag('live-algo'), stamp);
    const outlineList = h('ol.list.report-ol');
    const pageNow = h('span.num', null, '1');
    const outline = h('nav.report-outline', { 'aria-label': 'Report sections' }, h('h3.report-ol-title', null, 'Sections'), outlineList,
      h('p.report-ol-foot', null, 'Page ', pageNow, ' of ', h('span.num.report-ol-pages', null, '1'), h('br'), h('span', null, 'A4, as it will print')));
    const stack = h('div.report-stack');
    const mdView = h('pre.report-md', { tabindex: 0, 'aria-label': 'Markdown source of the report', hidden: true });
    const scroll = h('div.report-scroll', { tabindex: 0, 'aria-label': 'Report pages' }, stack, mdView);
    const press = h('div.report-press', { 'aria-hidden': 'true' });

    // export panel
    const printBtn = h('button.btn.btn-primary.btn-lg.report-print', { type: 'button', onclick: () => printReport() }, icon('report'), h('span', null, 'Print / save as PDF'));
    const copyBtn = h('button.btn', { type: 'button', onclick: () => copyMarkdown() }, 'Copy as Markdown');
    const mdDl = h('button.btn', { type: 'button', 'aria-label': 'Download the report as a Markdown file', onclick: () => download(R.meta.file + '.md', md, 'text/markdown') }, icon('download'), h('span', null, '.md'));
    const mdToggle = h('button.btn', { type: 'button', 'aria-pressed': 'false', onclick: () => setMd(!mdOn) }, 'Preview Markdown');
    const jsonBtn = h('button.btn', { type: 'button', onclick: () => { const s = JSON.stringify(log, null, 1); download(R.meta.file + '.json', s, 'application/json'); ctx.shell.toast('Mission log saved as ' + R.meta.file + '.json (' + bytes(new Blob([s]).size) + ').', { level: 'ok' }); } }, icon('download'), h('span', null, 'Download JSON log'));
    const st = { status: h('dd'), pages: h('dd'), words: h('dd'), md: h('dd'), json: h('dd'), file: h('dd.report-file') };
    const exportPanel = panel('Export', {},
      h('p.report-side-lead', null, 'Works at any point in the mission. A report made before the end is marked partial on every page and in the file name.'),
      printBtn,
      h('dl.kv.report-kv', null, h('dt', null, 'Status'), st.status, h('dt', null, 'Print'), st.pages, h('dt', null, 'Text'), st.words, h('dt', null, 'File name'), st.file),
      h('div.report-exp-group', null, h('h4', null, 'Markdown'), h('div.row.wrap', null, copyBtn, mdDl, mdToggle), h('dl.kv.report-kv', null, h('dt', null, 'Size'), st.md)),
      h('div.report-exp-group', null, h('h4', null, 'Full mission log'), h('div.row.wrap', null, jsonBtn), h('dl.kv.report-kv', null, h('dt', null, 'Size'), st.json),
        h('p.dim.report-exp-note', null, 'Detections with every fusion step, coverage, routes, hazards, all events, faults, the command log and the test results. Ground truth is not in it.')));
    exportPanel.classList.add('report-export');
    const reassure = createReassurance(ctx);
    const side = h('aside.report-side', { 'aria-label': 'Export and reassurance message' }, exportPanel, reassure.el);
    const bodyEl = h('div.report-body.adv-only', null, outline, scroll, side), heroEl = h('div.report-hero.demo-only');
    root.append(heroEl, head, bodyEl, press);
    // Demo: the finished document of a complete run (heroRun). Advanced: the live mission.
    let heroRun = null, heroLost = false, lastSheets = [], heroFonts = '';
    const hero = createReportHero(heroEl, ctx, { print: () => printReport() });
    const isDemo = () => ctx.mode === 'demo' && !heroLost;
    async function buildForHero() {
      const run = await finishedRun(ctx); if (run === heroRun || !isDemo()) return null;
      heroRun = run; if (!heroFonts) heroFonts = await inlineFonts(FONT_CSS); await document.fonts?.ready; rebuild();
      return { sheets: lastSheets, report: R, fontCss: heroFonts, paperCss, press, live: run.live };
    }
    async function applyMode() {
      if (!shown) { hero.hide(); return; }
      if (!isDemo()) { hero.hide(); return; }
      if (!(await hero.show(buildForHero))) { heroLost = true; heroEl.remove(); bodyEl.classList.remove('adv-only'); outline.classList.add('adv-only'); side.classList.add('adv-only'); bodyEl.classList.add('report-alone'); heroRun = heroRun || null; dirty = true; rebuild(); }
    }
    window.__reportHero = hero;

    // ---------- build ----------
    function signature(S) {
      const r = S.routes.rescue, u = S.units;
      return [S.phase, S.events.length, S.hold ? 1 : 0, S.operator, S.autoplay ? 1 : 0, Math.floor(S.t / 30), Math.floor(u['HOUND-01'].odo / 4), Math.round((S.map.scan || 0) * 20),
        S.detections.map((d) => d.id + d.status[0] + (d.p * 100).toFixed(0) + (d.needsTeam ? 't' : '')).join(','), Object.values(S.survivors).map((v) => v.id + v.status[0]).join(','),
        r ? r.status + r.legs.length + r.legs.filter((l) => l.arrivedAt != null).length + r.length.toFixed(0) : '-', S.hazards.length, Object.entries(S.faults).filter((e) => e[1]).map((e) => e[0]).join(','),
        Object.values(S.coverage).map((c) => c.status[0]).join('')].join('|');
    }
    function rebuild() {
      const demoRun = ctx.mode === 'demo' && heroRun, S = demoRun ? heroRun.state : sim.state, cmdLog = demoRun ? heroRun.commandLog : sim.commandLog; // always fresh
      dirty = false; lastSig = signature(S); lastBuild = performance.now();
      const keepTop = scroll.scrollTop, focusSel = document.activeElement?.closest?.('.report-stack [data-sel]')?.dataset.sel;
      R = buildReport(S, { PHASE_INFO: ctx.PHASE_INFO, FAULTS: ctx.FAULTS, commandLog: cmdLog });
      const ol = outlineOf(R);
      const out = paginate(buildBlocks(S, R, ol), R, press);
      pages = out.pages;
      for (const s of out.sheets) { s.querySelectorAll('[data-fill="pages"]').forEach((e) => { e.textContent = pages + ', A4'; }); s.querySelectorAll('[data-toc]').forEach((e) => { e.textContent = out.pageOf(e.dataset.toc); }); }
      stack.replaceChildren(...out.sheets); lastSheets = out.sheets;
      scroll.scrollTop = keepTop;
      if (focusSel) stack.querySelector('[data-sel="' + focusSel + '"]')?.focus({ preventScroll: true });
      // outline
      const curId = outlineList.querySelector('[aria-current="true"]')?.dataset.id;
      outlineList.replaceChildren(...ol.map((o) => h('li', null, h('button.list-item.report-ol-item', { type: 'button', 'data-id': o.id, 'aria-current': String(o.id === curId), 'aria-label': 'Go to ' + (/\d/.test(o.n) ? 'section ' : 'drawing ') + o.n + ', ' + o.title + '. ' + o.mark.text + '. Page ' + out.pageOf(o.id), onclick: () => goTo(o.id) },
        h('span.report-ol-n.num', null, o.n), h('span.report-ol-t', null, o.title, h('span.sub.report-ol-m' + (o.mark.tone ? '.report-om-' + o.mark.tone : ''), null, o.mark.text)), h('span.meta', { title: 'Page' }, String(out.pageOf(o.id)))))));
      outline.querySelector('.report-ol-pages').textContent = String(pages);
      // exports
      md = toMarkdown(S, R); log = missionLog(S, R, cmdLog);
      const words = stack.textContent.split(/\s+/).filter(Boolean).length, mdB = new Blob([md]).size, jsB = new Blob([JSON.stringify(log, null, 1)]).size;
      st.status.replaceChildren(h('span.tag.' + (R.meta.partial ? 'tag-warn' : 'tag-ok'), null, R.meta.partial ? 'Partial, ' + R.meta.phaseLabel.toLowerCase() : 'Final'));
      st.pages.textContent = pages + ' pages, A4 portrait'; st.words.textContent = words.toLocaleString('en') + ' words, 2 drawings';
      st.file.textContent = R.meta.file + '.pdf'; st.file.title = 'Suggested name. Also used for the .md and .json files.';
      st.md.textContent = bytes(mdB) + ', ' + md.split('\n').length + ' lines'; st.json.textContent = bytes(jsB) + ', ' + S.events.length + ' events';
      stamp.lastChild.textContent = R.meta.clock;
      stamp.title = 'Mission clock at the last rewrite of the report. ' + (R.meta.partial ? 'Partial: the mission is still in progress.' : 'Final.');
      if (mdOn) mdView.textContent = md;
      applySelection(false); onScroll();
      root.dataset.pages = String(pages); root.dataset.builtAt = R.meta.clock;
    }
    function maybeRebuild(force) {
      if (!shown || printing || (ctx.mode === 'demo' && heroRun)) { dirty = true; return; }
      const sel = window.getSelection?.();
      if (!force && sel && !sel.isCollapsed && stack.contains(sel.anchorNode)) { schedule(800); return; } // do not pull text out from under a selection
      if (force || dirty || signature(sim.state) !== lastSig) rebuild();
    }
    function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => { timer = 0; maybeRebuild(false); }, ms); }
    function onTick() {
      if (!shown || (ctx.mode === 'demo' && heroRun)) { dirty = true; return; }
      if (timer) return;
      schedule(Math.max(60, 700 - (performance.now() - lastBuild)));
    }

    // ---------- navigation ----------
    function scrollToEl(el, where = 'start') {
      const a = el.getBoundingClientRect(), b = scroll.getBoundingClientRect();
      const top = scroll.scrollTop + (a.top - b.top) - (where === 'center' ? Math.max(24, (b.height - a.height) / 2) : 20);
      scroll.scrollTo({ top, behavior: ctx.kit.reducedMotion() ? 'auto' : 'smooth' });
    }
    function goTo(id) {
      if (mdOn) setMd(false);
      const el = stack.querySelector('[data-sec="' + id + '"]'); if (!el) return;
      scrollToEl(el); setCurrent(id);
    }
    function setCurrent(id) { outlineList.querySelectorAll('.report-ol-item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === id))); }
    let scrollRaf = 0;
    function onScroll() {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0; if (!shown || mdOn) return;
        const b = scroll.getBoundingClientRect(); let cur = null;
        for (const el of stack.querySelectorAll('[data-sec]')) { if (el.getBoundingClientRect().top - b.top <= 140) cur = el.dataset.sec; else break; }
        setCurrent(cur || 's1');
        let pg = 1; for (const s of stack.children) { if (s.getBoundingClientRect().top - b.top <= b.height / 2) pg = +s.dataset.page; else break; }
        pageNow.textContent = String(pg);
      });
    }
    scroll.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => { const z = Math.max(0.5, Math.min(1, (scroll.clientWidth - 24) / SHEET_W)); stack.style.zoom = z.toFixed(4); root.dataset.zoom = z.toFixed(3); onScroll(); });
    ro.observe(scroll);

    // ---------- selection ----------
    function targetsOf(sel) {
      if (!sel || !R) return [];
      const keys = [sel.type + ':' + sel.id];
      if (sel.type === 'detection') { const p = R.people.find((x) => x.det === sel.id); if (p?.sv) keys.push('survivor:' + p.sv); }
      if (sel.type === 'survivor') { const p = R.people.find((x) => x.sv === sel.id); if (p) keys.push('detection:' + p.det); }
      return [...stack.querySelectorAll('[data-sel],[data-alt]')].filter((e) => keys.includes(e.dataset.sel) || keys.includes(e.dataset.alt));
    }
    function applySelection(reveal) {
      stack.querySelectorAll('.report-selected').forEach((e) => e.classList.remove('report-selected'));
      const t = targetsOf(selection); t.forEach((e) => e.classList.add('report-selected'));
      if (!reveal || !shown || !t.length || mdOn) return;
      const main = t.find((e) => e.matches('.report-person, tr')) || t[0];
      scrollToEl(main, 'center');
      stack.querySelectorAll('.report-flash').forEach((e) => e.classList.remove('report-flash'));
      main.classList.add('report-flash'); clearTimeout(flashT); flashT = setTimeout(() => main.classList.remove('report-flash'), 1600);
    }
    function pick(e) {
      const el = e.target.closest?.('[data-sel]'); if (!el || !stack.contains(el)) return;
      if (e.type === 'keydown') { if (e.key !== 'Enter' && e.key !== ' ') return; if (e.target !== el) return; e.preventDefault(); }
      else if (!window.getSelection?.().isCollapsed) return; // the user is selecting text, not picking
      const i = el.dataset.sel.indexOf(':');
      ownSelect = true; try { ctx.select({ type: el.dataset.sel.slice(0, i), id: el.dataset.sel.slice(i + 1) }); } finally { ownSelect = false; }
    }
    stack.addEventListener('click', pick); stack.addEventListener('keydown', pick);
    offs.push(ctx.bus.on('select', (sel) => { selection = sel; applySelection(!ownSelect); }));

    // ---------- exports ----------
    function printHTML() {
      const clone = stack.cloneNode(true);
      clone.querySelectorAll('.report-selected,.report-flash').forEach((e) => e.classList.remove('report-selected', 'report-flash'));
      clone.querySelectorAll('[tabindex]').forEach((e) => e.removeAttribute('tabindex'));
      return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + R.meta.file + '</title><style>' + FONT_CSS + paperCss + PRINT_CSS + '</style></head><body>' + clone.innerHTML + '</body></html>';
    }
    function printReport() {
      if (mdOn) setMd(false);
      rebuild();
      document.querySelectorAll('iframe.report-printframe').forEach((f) => f.remove());
      const frame = document.createElement('iframe');
      frame.className = 'report-printframe'; frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1; frame.title = 'Print copy of the report';
      const html = printHTML();
      frame.addEventListener('load', () => {
        const w = frame.contentWindow; if (!w) return;
        w.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 500));
        const ready = Promise.race([Promise.all([w.document.fonts?.ready, ...[...w.document.images].map((im) => im.decode?.().catch(() => {}))]), new Promise((r) => setTimeout(r, 2500))]);
        ready.then(() => { try { w.focus(); w.print(); } catch (e) { ctx.shell.toast('The print dialog could not be opened: ' + e.message + '. Try Cmd+P instead.', { level: 'alert' }); } });
      }, { once: true });
      frame.srcdoc = html; document.body.append(frame);
      root.dataset.printed = pages + ' pages, ' + html.length + ' chars';
      ctx.shell.toast('Print dialog: ' + pages + ' pages, A4' + (R.meta.partial ? ', marked partial' : '') + '. Choose "Save as PDF" to keep a file.', { level: 'ok' });
    }
    async function copyMarkdown() {
      if (dirty) rebuild();
      let ok = false;
      try { await navigator.clipboard.writeText(md); ok = true; } catch {
        const ta = h('textarea', { 'aria-hidden': 'true', style: { position: 'fixed', left: '-9999px', top: '0' } }); ta.value = md; document.body.append(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove();
      }
      root.dataset.copied = ok ? String(md.length) : 'failed';
      ctx.shell.toast(ok ? 'Report copied as Markdown (' + md.split('\n').length + ' lines' + (R.meta.partial ? ', partial' : '') + ').' : 'Copy was blocked by the browser. Use Preview Markdown and copy from there, or download the .md file.', { level: ok ? 'ok' : 'alert' });
    }
    function download(name, text, type) {
      const url = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' }));
      const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      root.dataset.downloaded = name;
      if (type !== 'application/json') ctx.shell.toast('Saved ' + name + '.', { level: 'ok' });
    }
    function setMd(on) {
      mdOn = on; mdToggle.setAttribute('aria-pressed', String(on)); mdToggle.textContent = on ? 'Back to the pages' : 'Preview Markdown';
      mdView.hidden = !on; stack.hidden = on; if (on) { mdView.textContent = md; scroll.scrollTop = 0; } else onScroll();
      root.classList.toggle('report-md-on', on);
    }

    // Cmd+P while this workspace is open: print the paper, not the console.
    let pageStyle = null;
    const before = () => { if (!shown) return; if (mdOn) setMd(false); if (dirty) rebuild(); printing = true; document.documentElement.classList.add('report-printing'); pageStyle = document.createElement('style'); pageStyle.textContent = '@page{size:A4;margin:0}'; document.head.append(pageStyle); };
    const after = () => { printing = false; document.documentElement.classList.remove('report-printing'); pageStyle?.remove(); pageStyle = null; };
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);

    offs.push(ctx.bus.on('mode', () => { if (shown) rebuild(); applyMode(); }), ctx.bus.on('tick', onTick), ctx.bus.on('reset', () => { dirty = true; scroll.scrollTop = 0; maybeRebuild(true); }), ctx.bus.on('seek', () => { dirty = true; maybeRebuild(true); }));
    // for the automated checks
    window.__reportPrintHTML = () => { if (!R || dirty) rebuild(); return printHTML(); };
    window.__reportMarkdown = () => md;
    window.__reportJSON = () => log;
    window.__reportReassure = reassure;

    const go = (p) => { if (p?.section) goTo(String(p.section).startsWith('s') ? p.section : 's' + p.section); if (p?.print) printReport(); };
    return {
      onShow() { shown = true; rebuild(); applyMode(); go(ctx.params); ctx.params = null; if (!fontsSeen) document.fonts?.ready.then(() => { fontsSeen = true; if (shown) rebuild(); else dirty = true; }); },
      onHide() { shown = false; hero.hide(); clearTimeout(timer); timer = 0; clearTimeout(flashT); reassure.stop(); },
      onParams(p) { go(p); },
    };
  },
};
