# The plan: from here to submission

Written 23 November 2026 by the orchestrator, for any Claude session that continues this work. Read this first, then
`MISSION.md`, `ARCHITECTURE.md`, `STYLE.md`, `FACTS.md`. Deadline: **Saturday 28 November 2026, 3:00 pm Pacific**.

## 1. What Rishith wants (his words)

- "I WANT TO WIN. Insane Palantir Gotham level UI." "GTA 6, Tesla FSD level graphics and interactiveness."
- "The most hyper-realistic, elite thing… too round and bouncy… Palantir Gotham should see this and be like: I need to
  recruit him." "All animation ultra smooth." "I don't want it to look like AI slop."
- "Ultra high graphics. It also shouldn't be super overloaded: advanced mode shows all that, but only the sexy thing in
  the non-advanced demo."
- "As long as we have graphs and graphics to back it up we are fine… some partially hardcoded stuff might be all right,
  but up to you." The line held: scripted or illustrative things are fine, and they are labelled Simulated, Concept or
  Recorded run. Nothing claims a real-world result.
- Never ask him for permission or with questions; decide. Sub-agents run as Claude Code CLI in code mode, Opus, medium
  effort. Codex makes the images.

## 2. Hard rules

1. `~/Developer/hound-console` is the old site (hound-console.vercel.app). Do not change, commit or deploy it.
2. This repository is the only place for new work: `rishith-c/hound-ultra`, **private** until submission.
3. Ask him once, right before: making the repository public, submitting on Devpost, uploading the video. Everything
   else: just do it.
4. No forged authorship or dates. No claim that simulated runs were recorded in real life. Every machine-learning number
   is from simulation (see FACTS.md). Anything illustrative carries a label.
5. `rm`, `curl`, `node` are blocked in agent shells: use `mv … ~/.Trash/` and Python. No purchases. No installs.
6. Never change Claude's own permission or safety settings, cmux's socket mode, or his hooks.
7. The rover's access-point password is in other public repositories' firmware and his hotspot secrets are in a
   git-ignored file there: neither belongs here. Hound Mk II patent documents are confidential and stay out.
8. Desktop widths only (1440, 1680, 1920). No eyebrow labels. Commit trailer: whatever the session's reminder says.

## 3. How the thing is built

Static site, no build step. `index.html` + `landing/` (landing), `login.html`, `app/` (the console), `assets/`, `data/`.
`app/core` is a deterministic simulator, planner, fusion and the real 23,372-parameter network in JavaScript.
`app/shell.js` is the frame; 23 workspaces live in `app/workspaces/<id>`; the 3-D world is `app/twin` (engine) and
`app/twin/actors` (rover, drone, people, sensing, route…); app-wide extras are in `app/global`.
**Demo** (default) shows ten chapters, one hero each. **Advanced** shows all 23 workspaces and every control.

Look at anything: `python3 tools/shoot.py "/app/?mode=demo#/mission" --wait 8 --do fps:3 --out /tmp/x.png`
(serves itself, queues for a browser, prints errors). Useful inside `--do eval:`: `HOUND.sim.seek(420)`,
`HOUND.sim.setSpeed(32)`, `HOUND.setMode('advanced')`, `HOUND.shell.open('sense')`.
By hand: the preview server on http://localhost:4391/ultra/ (a symlink in hound-console; remove it at the end), or
`python3 -m http.server 4400 -d ~/Developer/hound-ultra`.

## 4. Running the crew

- Start or resume an agent: `HOUND_AGENT_SLOTS=11 python3 tools/resume.py <agent>` as a background command, one per
  agent (a lock keeps 11 running). It resumes the agent's own session, compacts it, and sends
  `orchestration/briefs/_resume.md` plus its note in `orchestration/resume_notes.json`.
  New work for the same agent: `--prompt <file.md>`. A brand-new agent: write `briefs/<name>.md`, add a note, `--fresh`.
- See what they are doing: `python3 tools/agents_status.py`. Reports: `orchestration/reports/`. Requests to the
  orchestrator: `orchestration/requests/` (apply them, then say so in the next prompt).
- Critic pass on an area: `python3 tools/mk_elevate.py <round> <area> "<owned files>" "<urls>" ["extra"]`, then run it
  `--fresh`.
- Budget: plan limits are weekly (`get_usage`). On 23 Nov 17:40: all models 53 % used, Fable 100 %, both reset
  **28 Nov 5:00 am**. Keep at least 10 % in hand for the last day. The reset gives a fresh allowance ten hours before
  the deadline: final polish, video and write-up can use it.
- If agents stop again: nothing is lost. `tools/resume.py` finds the latest session by itself.

### Agents and what each owns

| Agent | Owns | Demo hero |
|---|---|---|
| 01-twin-core | app/twin/* except actors | the world itself, at first light |
| 02-twin-actors | app/twin/actors | radio passing through a wall and becoming a person |
| 03-mission | workspaces/mission | the search as a film |
| 04-sense | workspaces/sense | a 10 s window flowing through the real network |
| 05-fusion | workspaces/fusion | evidence raising or sinking a probability column |
| 06-aerial | workspaces/aerial, data/aerial | detector locking on people, frame tilts into relief |
| 07-scan | workspaces/scan | 560k-point cloud, voids filling with light |
| 08-evidence-report | workspaces/graph, report | evidence constellation; the printed hand-over |
| 09-swarm | workspaces/swarm | machines dissolving the unknown at night |
| 10-copilot | workspaces/copilot, global palette, dock, narration, sound | talking to the live twin |
| 11-signals | workspaces/signals | knocks pulled out of a sound landscape |
| 12-globe-area | workspaces/globe, area | flight down the real valley; Earth replaying a week of quakes |
| 13-triage-train | workspaces/triage, train | priority beams; a decision moment |
| 14-status | workspaces/status, global/a11y.js, tests, sw.js, manifest | a wall of proof |
| 15-landing | index.html, landing, login.html | the valley, the network running live |
| 20-radio | workspaces/radio | wavefronts through a building, a person shivers the pattern |
| 21-deepscan | workspaces/deepscan | muons revealing a void |
| 22-vision | workspaces/vision, data/vision | words lifting the matching patches |
| 23-strategy | workspaces/strategy | probability terrain reshaped by every look |
| 24-timelines | workspaces/timelines | a braid of possible missions |
| 25-forge | workspaces/forge, data/forge | a network learning in front of you |
| 26-structure | workspaces/structure | a slab lift tested before anyone touches it |
| 27-horizon | workspaces/horizon | a dive from orbit to a heartbeat |

## 5. State on 23 November, 18:00

Working at 60 frames a second with no console errors: area (40 fps), mission, triage, swarm, sense, fusion, aerial, scan,
signals, radio, vision, forge, graph, report, globe, train. Broken or incomplete: structure (syntax error), strategy
(missing ex-theory.js), timelines (hangs the page), deepscan (3 modules missing), horizon (4 missing), copilot (a 404),
status (not started). Demo mode: shell done, no workspace had it yet. The twin needs the biggest visual lift.

## 6. Schedule and gates

| When | What | Gate |
|---|---|---|
| Mon 23 night | All 23 agents finish brief + Demo hero | every workspace opens in both modes with 0 errors |
| Tue 24 | Orchestrator reviews every Demo screenshot at full size; second notes; twin and mission second pass | a stranger watches the 10 chapters and says wow at least 5 times; 60 fps in all ten |
| Wed 25 | Integration: full mission by autoplay and by hand; fault drills; cross-links; accessibility; offline; cold-load time under 6 s; landing final captures | rubric matrix below all green with a screenshot each |
| Thu 26 | Deploy to Vercel (new project `hound-command`); test the live URL; README; licence; credits; AI disclosure; secrets scan | the live site passes the same smoke list |
| Fri 27 | Video (2 to 4 min): screen captures from Demo at 60 fps + film shots; voice-over; captions. Devpost text, gallery images | he approves the cut |
| Sat 28 | 5:00 am allowance resets: last polish only. Repository public (ask), Devpost submit (ask) by **1:00 pm**, two hours early | confirmation page screenshot |

Cut line, if time runs short (drop from Demo first, keep in Advanced): horizon, structure, swarm, radio exhibits 4-7.
Never cut: mission, sense, landing, System check, README, video.

## 7. Rubric to evidence (100 points)

| Rubric box | Points | Where it is proved | What the video and text must show |
|---|---|---|---|
| Real need and use | 8 | landing section 01, area | Timure flood, unsafe buildings, who would use it |
| Advantage over the current way | 8 | landing, report | cost and time against entering blind or a commercial radar, with sources |
| Practical | 4 | built rover, train, offline | the rover exists; works without internet after first load |
| Justified AI | 6 | sense "Why this network" | why a small CNN on channel state, why not rules |
| Project-specific AI design with evidence | 10 | forge, sense test set, fusion | messy-simulator training before/after; fusion rescuing the weak "still person" case |
| AI quality check and limits | 8 | sense test set, forge "knowing when it does not know", status | ROC, confusion on 955 windows, still-person recall, refuses bad input |
| Human-checked AI-assisted development | 6 | README, report | how Claude and Codex were used, what a person checked, tests |
| Complete main process | 6 | mission | survey to rescue without a cut |
| Results: ordinary, second ordinary, repeat, demanding | 3+3+4+6 | status self-tests, Monte-Carlo | same seed same result; aftershock + lost link still finds people |
| Two different failures handled | 4+4 | status drills, mission drill | lost link; dead sensor or second slide, each with the safe behaviour |
| Main action stands out | 4 | Demo mode | one button per screen |
| Consistent | 4 | design reference page | one system |
| Less effort | 4 | autoplay, Cmd K, copilot | three clicks from cold to a found person |
| Relationships made visible | 3+5 | evidence graph, linked selection, timeline | click a finding, everything behind it lights |

## 8. Orchestrator's own list

- [ ] Apply `orchestration/requests/*` as they arrive.
- [ ] Chapter order and names in `CHAPTERS` (app/shell.js) once heroes exist; consider moving `fusion` in.
- [ ] Smooth cross-fade between workspaces; preload the next chapter's module when idle.
- [ ] Boot screen: the mark, "Loading the neural network", never a bare spinner.
- [ ] `tests/`: full-mission run at 32×, autoplay and manual; seeds 1 to 5; Monte-Carlo after the 0.15 threshold.
- [ ] Performance: memory after visiting all 23; WebGL contexts (each workspace frees or pauses; browsers cap at 16).
- [ ] README.md: what it is, run it, what existed before 21 Nov (rover, network, film, old site) vs built in the event
      (this whole repository), what is real, how AI was used, credits and licences, limits.
- [ ] `orchestration/` and briefs stay in the public repository as the record of AI use (read them for anything
      personal first), or move to a private branch if he prefers.
- [ ] Remove `~/Developer/hound-console/ultra` (symlink only).
- [ ] Vercel: `vercel.json` with no-cache for html/js, long cache for fonts and models.

## 9. Devpost answers to prepare (five questions)

1. Who has the problem and why it matters. 2. What existed before and what was built 21 to 28 November. 3. How AI is
used inside the product, and how AI was used to build it. 4. How to try it, what to expect, the measured results.
5. Limits, failures and what is simulated. Plus team roster, participant form (one per member), categories: Best AI
Hardware and Robotics, Best AI Engineering, Best Design and UX, Originality, Best Demo, Community Impact.

## 10. Starter prompt for a new session

> Continue HOUND Command in ~/Developer/hound-ultra. Read docs/OPUS_PLAN.md completely, then docs/MISSION.md,
> ARCHITECTURE.md, STYLE.md, FACTS.md. Run `python3 tools/agents_status.py`, read new files in orchestration/reports and
> orchestration/requests, look at every Demo chapter with tools/shoot.py, and carry on from the schedule. Do not ask me
> questions. Sub-agents: Claude Code CLI in code mode, Opus, medium effort, through tools/resume.py.


## Status log (orchestrator)
- **23 Nov 19:00.** Demo is now one story: 01 area, 02 radio, 03 forge (The training: hall of 900 people), 04 sense, 05 rover (new workspace, agent 28), 06 mission, 07 fusion, 08 report | frontier: aerial, scan, swarm, structure, horizon. Opening title app/global/intro.js. Dock in two groups with progress. Shell evicts old workspaces (KEEP 4) and the Demo mission plays only while watched. Owner's latest rules: looks first in Demo; scripted demo readings are fine with a Simulated / Concept tag; he delegates all design decisions ("you are boss"); do not reuse his film's visuals, make the best possible. Scope is frozen.
- Second-pass briefs: orchestration/briefs/p2-*.md. Send with `HOUND_AGENT_SLOTS=26 python3 tools/resume.py <agent> --prompt orchestration/briefs/p2-<x>.md` once that agent's first run is finished (scan, radio sent; aerial -> 06-aerial, swarm -> 09-swarm, area -> 12-globe-area, twin -> 01-twin-core waiting).
- Not restarted yet: 10-copilot, 11-signals (Advanced only; low priority).
- Then: tools/tour.py in demo and advanced when quiet, deploy to a NEW Vercel project, README, Devpost text.
- Usage 61 % weekly at 19:00; keep 10 % reserve.
- **23 Nov 20:25.** Every agent has finished except 11-signals (Advanced). Positive pass done (owner: only good, confident wording where judges look; small Simulated / Concept tags, What is real and the full test table in Advanced stay; Devpost Q5 stays because the rubric scores limits). Core: planner smoothing and the Wi-Fi window guard fixed, all 2,067 self-test checks pass, 200-mission counts unchanged, the mission is now 10:51. Release: `python3 tools/release.py snapshot`, tour the snapshot, then `deploy` to https://hound-command.vercel.app. Next: 2 to 4 minute video, gallery, Devpost text (ask the owner right before repo public / submit / upload).

