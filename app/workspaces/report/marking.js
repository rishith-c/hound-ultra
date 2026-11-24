// Drawing B: an INSARAG-style worksite marking for Block B, filled from the mission data.
// Layout follows the worksite marking of the INSARAG Guidelines (Volume II, Manual B) as the team understands it:
// a box of about 1.2 m by 1.0 m; inside it the worksite ID, team ID, ASR level reached and date; hazards above the
// box; the worksite triage category below; one horizontal line through the whole marking when work there is finished.
// Anything the mission data cannot fill is shown as a dash, and the key says so. This is not an official marking.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function markingData(S, R) {
  const phaseIdx = ['standby', 'aerial', 'deploy', 'search', 'assess', 'plan', 'rescue', 'complete'].indexOf(S.phase);
  // Nearest assessment, search and rescue (ASR) level. This mapping is ours, not INSARAG's.
  const asr = S.phase === 'complete' && R.route?.status === 'done' ? 3 : phaseIdx >= 4 ? 2 : S.map.ready ? 1 : 0;
  const asrWhy = ['Nothing completed yet', 'Wide-area survey done (drone, concept)', 'Building assessed room by room by the rover', 'Rapid search done and the people found were reached (team simulated)'][asr];
  const kinds = [];
  for (const h of R.hazards) {
    const inBlock = h.poly.some((p) => p[0] >= 43 && p[0] <= 86 && p[1] >= 29 && p[1] <= 60);
    if (!inBlock) continue;
    const w = { collapse: 'COLLAPSE NE', slope: 'SLOPE N', gas: 'GAS? LAB 110', rubble: 'DEBRIS', mud: 'MUD' }[h.kind] || h.kind.toUpperCase();
    const word = h.src !== 'Site survey' && h.kind === 'collapse' ? 'NEW DEBRIS CORRIDOR' : w;
    if (!kinds.includes(word)) kinds.push(word);
  }
  const d = new Date(), date = String(d.getDate()).padStart(2, '0') + ' ' + ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getMonth()];
  return { worksite: 'B-1', team: 'EXR-1', asr, asrText: asr ? 'ASR ' + asr : 'ASR –', asrWhy, date, hazards: kinds, located: R.located.length, reached: R.reached.length, possible: R.possible.length, complete: S.phase === 'complete' };
}

// A slightly unsteady hand: deterministic wobble so the marking looks sprayed, but identical on every redraw.
function wob(i, amp) { const x = Math.sin(i * 12.9898) * 43758.5453; return ((x - Math.floor(x)) - 0.5) * 2 * amp; }
function handLine(x1, y1, x2, y2, seed) {
  const n = 6; let d = 'M' + (x1 + wob(seed, 1.2)).toFixed(1) + ' ' + (y1 + wob(seed + 1, 1.2)).toFixed(1);
  for (let i = 1; i <= n; i++) { const t = i / n; d += 'L' + (x1 + (x2 - x1) * t + wob(seed + i * 3, 1.1)).toFixed(1) + ' ' + (y1 + (y2 - y1) * t + wob(seed + i * 3 + 1, 1.1)).toFixed(1); }
  return d;
}

export function markingSVG(M) {
  const W = 372, H = 372, bx = 104, by = 96, bw = 180, bh = 150; // box 1.2 : 1.0
  let g = '<svg xmlns="http://www.w3.org/2000/svg" class="report-plan report-mark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="INSARAG-style worksite marking for Block B: worksite ' + M.worksite + ', team ' + M.team + ', ' + M.asrText + ', ' + M.date + '">';
  g += '<defs><pattern id="rpm-conc" width="14" height="14" patternUnits="userSpaceOnUse"><circle cx="2" cy="3" r="0.600" class="report-m-speck"/><circle cx="9" cy="1.500" r="0.400" class="report-m-speck"/><circle cx="6" cy="8" r="0.700" class="report-m-speck"/><circle cx="12" cy="11" r="0.500" class="report-m-speck"/><circle cx="3" cy="12" r="0.400" class="report-m-speck"/></pattern></defs>';
  g += '<rect x="0.500" y="0.500" width="' + (W - 1) + '" height="' + (H - 1) + '" class="report-m-wall"/><rect x="0.500" y="0.500" width="' + (W - 1) + '" height="' + (H - 1) + '" fill="url(#rpm-conc)" class="report-m-wallframe"/>';
  g += '<path d="M0 ' + (H - 44) + 'H' + W + '" class="report-m-joint"/><path d="M' + (W - 70) + ' 0V' + (H - 44) + '" class="report-m-joint"/>';
  // the box
  g += '<path d="' + handLine(bx, by, bx + bw, by, 1) + handLine(bx + bw, by, bx + bw, by + bh, 30) + handLine(bx + bw, by + bh, bx, by + bh, 60) + handLine(bx, by + bh, bx, by, 90) + '" class="report-m-spray"/>';
  const line = (txt, y, size) => '<text x="' + (bx + bw / 2) + '" y="' + y + '" text-anchor="middle" class="report-m-text" style="font-size:' + size + 'px">' + esc(txt) + '</text>';
  g += line(M.worksite, by + 34, 30) + line(M.team, by + 61, 24) + line(M.asrText, by + 110, 24) + line(M.date, by + 138, 24);
  // hazards above
  const hz = M.hazards.length ? M.hazards : ['–'];
  const rows = []; let cur = '';
  for (const h of hz) { if ((cur + '  ' + h).length > 24 && cur) { rows.push(cur); cur = h; } else cur = cur ? cur + ' · ' + h : h; }
  if (cur) rows.push(cur);
  rows.slice(0, 3).forEach((r, i, a) => { g += '<text x="' + (bx + bw / 2) + '" y="' + (by - 14 - (a.length - 1 - i) * 21) + '" text-anchor="middle" class="report-m-text" style="font-size:17px">' + esc(r) + '</text>'; });
  // triage category below: not assessed
  g += '<text x="' + (bx + bw / 2) + '" y="' + (by + bh + 34) + '" text-anchor="middle" class="report-m-text" style="font-size:28px">–</text>';
  // arrow to the entrance
  g += '<path d="' + handLine(bx + bw + 4, by + bh - 20, bx + bw + 44, by + bh + 30, 140) + '" class="report-m-spray"/><path d="M' + (bx + bw + 46) + ' ' + (by + bh + 33) + 'l-14 -3 9 -10z" class="report-m-fill"/>';
  // victim marking to the left: V, live count, deceased dash
  g += '<path d="M22 ' + (by + 20) + 'L40 ' + (by + 78) + 'L60 ' + (by + 18) + '" class="report-m-spray"/>';
  g += '<text x="41" y="' + (by + 106) + '" text-anchor="middle" class="report-m-text" style="font-size:22px">L-' + M.located + '</text>';
  g += '<text x="41" y="' + (by + 132) + '" text-anchor="middle" class="report-m-text" style="font-size:22px">D –</text>';
  // work complete: one line through the whole marking
  if (M.complete) g += '<path d="' + handLine(bx - 14, by + 76, bx + bw + 14, by + 76, 300) + '" class="report-m-spray report-m-strike"/>';
  // field numbers, keyed to the table beside the drawing
  const tag = (n, x, y) => '<g transform="translate(' + x + ' ' + y + ')"><circle r="8" class="report-m-tag"/><text y="3.500" text-anchor="middle" class="report-p-t report-p-t-key">' + n + '</text></g>';
  g += tag(1, bx + bw + 32, by + 24) + tag(2, bx + bw + 32, by + 54) + tag(3, bx + bw + 32, by + 102) + tag(4, bx + bw + 32, by + 130) + tag(5, bx + bw + 32, by - 22) + tag(6, bx + bw / 2 + 30, by + bh + 26) + tag(7, 76, by + 30) + tag(8, bx + bw + 60, by + bh + 12);
  if (M.complete) g += tag(9, bx - 26, by + 76);
  // dimension line under the box
  g += '<g class="report-m-dim"><path d="M' + bx + ' ' + (by + bh + 58) + 'H' + (bx + bw) + 'M' + bx + ' ' + (by + bh + 53) + 'v10M' + (bx + bw) + ' ' + (by + bh + 53) + 'v10"/><text x="' + (bx + bw / 2) + '" y="' + (by + bh + 72) + '" text-anchor="middle" class="report-p-t report-p-t-s">box about 1.2 m wide by 1.0 m high</text></g>';
  g += '<text x="10" y="' + (H - 16) + '" class="report-p-t report-p-t-s">South wall of Block B, beside the entrance (drawn, not painted)</text>';
  return g + '</svg>';
}

export function markingKey(M) {
  return [
    ['1', 'Worksite ID', M.worksite, 'Sector B, worksite 1. Invented for the exercise.'],
    ['2', 'Team ID', M.team, 'Invented exercise team. Real team IDs are a three-letter country code and a number.'],
    ['3', 'ASR level reached', M.asrText, M.asrWhy + '. Mapped by us to the nearest assessment, search and rescue level; a rover search is not an INSARAG-classified activity.'],
    ['4', 'Date', M.date, 'Today\'s date on this computer. The mission clock has no calendar date.'],
    ['5', 'Hazards, above the box', M.hazards.length ? M.hazards.join(', ').toLowerCase() : 'none recorded', 'From the hazard list in section 5, limited to those at the block.'],
    ['6', 'Triage category, below the box', '–', 'Set by the team on site.'],
    ['7', 'Victim marking', 'L-' + M.located + ', D –', 'L: people located by the sensors (' + M.reached + ' reached by the simulated team' + (M.possible ? '; ' + M.possible + ' more possible, not counted' : '') + '). Nobody\'s condition was assessed. D: left blank.'],
    ['8', 'Arrow', 'to the entrance', 'Points to the worksite entrance on the south side.'],
    ['9', 'Line through the marking', M.complete ? 'drawn' : 'not drawn', M.complete ? 'The mission is complete, so the marking is struck through.' : 'Drawn only when work at the worksite is finished. The mission is still in progress.'],
  ];
}
