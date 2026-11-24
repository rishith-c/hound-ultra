// The what-is-real ledger: every capability in docs/MISSION.md, its reality label (kit.REALITY), what is real about it, what
// is simulated or assumed, and the proof. Nothing here is taken on trust: checkBuilt() fetches the module that should
// hold each capability and looks for the code that does the work. If it is missing, the row says "not built".
// Row: [kind, name, workspace, module under app/, a pattern that must be in it, what is real, what is simulated or assumed, proof]
const R = (kind, name, ws, file, mark, real, sim, proof = '') => ({ kind, name, ws, file, mark, real, sim, proof });
const NET = '23,372 weights trained in NumPy on simulated people', SCN = 'The building, people and readings are invented';

export const LEDGER = [
  { group: 'The rover', rows: [
    R('built', 'The rover itself', 'rover', 'workspaces/rover/index.js', /mount/, 'An aluminium extrusion frame, four NEMA 17 steppers on mecanum wheels, an Arduino UNO R4, a Raspberry Pi, an ESP32-S3, radars, a thermal camera. The rover and its web remote exist.', 'This console is not connected to it.', 'Our own CAD and photographs'),
  ] },
  { group: 'Sensing and AI', rows: [
    R('live-ai', 'Wi-Fi neural network, live', 'sense', 'core/nn.js', /export function forward/, 'The trained network runs in this page on held-out test windows.', NET + '. No real recordings exist.', 'Self-test: 30 of 30 windows match Python to 0.01'),
    R('live-ai', 'Why the network said so', 'sense', 'workspaces/sense/bench.js', /occlu/i, 'Parts of the window are hidden and the real network is asked again.', 'Simulated windows.'),
    R('live-ai', 'Threshold tuning on the test set', 'sense', 'workspaces/sense/evalview.js', /roc/i, 'The real scores of all 955 held-out test windows.', 'All 955 are simulated people.', '86.9 % of moving and 21.4 % of still people found, in simulation'),
    R('live-ai', 'Network anatomy in 3-D', 'sense', 'workspaces/sense/anatomy.js', /three/, 'Every value drawn is a layer output of the real network.', 'Simulated window as input.'),
    R('live-algo', 'Fusion of weak sensors', 'fusion', 'core/fusion.js', /export function fuse/, 'Bayes’ rule, every step shown.', 'Only the Wi-Fi likelihood is measured (in simulation). Radar, thermal, drone and acoustic likelihoods are assumed.', 'Self-test: hand-computed values agree to 0.0005'),
    R('live-algo', 'Residual risk per room', 'fusion', 'workspaces/fusion/map.js', /residual/, 'Computed from reach and evidence at each stop.', 'The 10 % prior and the sensor reach are assumed.', 'Self-test: no room ever claims certainty'),
    R('live-algo', 'Monte-Carlo missions', 'fusion', 'workspaces/fusion/montecarlo.js', /montecarlo|worker/i, 'Whole missions, run hundreds of times with random windows.', SCN + '.', 'Self-test: 200 missions with random windows'),
    R('live-ai', 'Aerial person detector', 'aerial', 'workspaces/aerial/detect.worker.js', /detr|d-?fine|dfine/i, 'A pretrained object detector (D-FINE nano) in the browser.', 'Synthetic scenes, two licensed photographs, or your own image. Not trained by us.'),
    R('live-algo', 'Colour-anomaly search', 'aerial', 'workspaces/aerial/cv.worker.js', /mahalanobis|rx/i, 'The RX detector, computed on the picture shown.', 'Synthetic scenes unless you drop a photo.'),
    R('live-algo', 'Before and after', 'aerial', 'workspaces/aerial/cv.worker.js', /change|registr/i, 'Registration and difference, computed live.', 'The picture pairs are drawn, with known truth.'),
    R('sim', 'Thermal view', 'mission', 'workspaces/mission/sensors.js', /thermal/, 'Nothing is measured.', 'Blobs come from the scenario, limited to 32 by 24 pixels like the real camera.'),
    R('live-algo', 'Breathing band', 'fusion', 'workspaces/fusion/breathing.js', /band|spectr/i, 'A real spectrum of a simulated signal, with error bars.', 'An experiment. The rate is within 3 breaths a minute for only 41 % of the still people found, so it is never shown as a reading.'),
    R('device', 'Tap and voice listening', 'signals', 'workspaces/signals/tap.js', /getUserMedia|AudioWorklet/, 'Your microphone, a live knock detector.', 'HOUND has no geophone; the demo knocks are generated.'),
    R('concept', 'Phone finder', 'signals', 'workspaces/signals/phone.js', /rssi|signal/i, 'Live trilateration on generated signal strengths.', 'No radio is listening. HOUND cannot do this today.'),
    R('concept', 'Drone as a transmitter', 'signals', 'workspaces/signals/drone.js', /wall|path|loss/i, 'Path-loss mathematics, live.', 'The drone does not exist.'),
    R('concept', 'Exhaled CO2 plume', 'signals', 'workspaces/signals/plume.js', /plume|co2/i, 'A live plume model and a tracking robot.', 'No gas sensor is fitted.'),
  ] },
  { group: 'Mapping and 3-D', rows: [
    R('sim', 'The 3-D twin', 'mission', 'twin/engine.js', /createEngine/, 'Drawn from the mission state, metre for metre.', SCN + '. The valley terrain is real.'),
    R('sim', 'See-through walls', 'mission', 'twin/building.js', /wall/i, 'The sensors’ own findings, drawn where they were made.', 'A picture of a simulated finding, not a camera.'),
    R('sim', 'Drone scan to point cloud', 'scan', 'workspaces/scan/scene.js', /scan|point/i, 'Points are cast against a 3-D scene.', 'The scene and the drone are invented.'),
    R('live-algo', 'Void finder', 'scan', 'workspaces/scan/analyze.js', /void/i, 'Computed from the points on screen.', 'Simulated scan unless you load your own.'),
    R('live-algo', 'Fog of war', 'mission', 'twin/actors/coverage.js', /explored/, 'One-metre cells the rover’s sensors reached.', 'The reach is an assumed range.'),
    R('device', 'Bring your own scan or plan', 'scan', 'workspaces/scan/io.js', /ply|parse/i, 'Your file, read in this browser, sent nowhere.', ''),
    R('real-data', 'Live earthquakes', 'globe', 'workspaces/globe/data.js', /earthquake\.usgs/, 'The public USGS feed.', 'Needs the network; a saved copy is marked as such.'),
    R('real-data', 'The valley at Timure', 'area', 'workspaces/area/terrain.js', /slope|flood/i, 'Real elevation, imagery and OpenStreetMap.', 'The flood shape is illustrative; the block and its people are invented.'),
  ] },
  { group: 'Planning and autonomy', rows: [
    R('live-algo', 'Hazard-aware routes, with approval', 'mission', 'core/planner.js', /export function planPath/, 'A* on a half-metre grid. Nobody moves until a person approves.', 'Hazard prices are assumed.', 'Self-test: 200 random routes against a second solver'),
    R('live-algo', 'Second slide', 'mission', 'core/sim.js', /newHazard/, 'Every route is planned again when the map changes.', 'The slide is a command, not a detection.', 'Self-test: 24 missions with a slide at a random moment'),
    R('live-algo', 'Closest approach and breach', 'triage', 'core/planner.js', /nearest/, 'The nearest reachable point and the metres left.', 'Wall positions come from the scenario.', 'Self-test: no reachable point is closer'),
    R('live-algo', 'Who first', 'triage', 'workspaces/triage/model.js', /priority|score|rank/i, 'A stated rule on what the sensors found.', 'A planning aid, not a medical assessment.'),
    R('concept', 'Multi-robot search', 'swarm', 'workspaces/swarm/engine.js', /hungarian|frontier/i, 'Frontier search and task auction, live.', 'One rover exists. The rest of the fleet is drawn.'),
    R('concept', 'Radio mesh', 'swarm', 'workspaces/swarm/engine.js', /beacon|mesh|relay/i, 'Relay placement, live.', 'No beacons exist.'),
    R('live-algo', 'Battery-aware return', 'mission', 'core/sim.js', /batteryGuard/, 'The rover checks before every stop and goes back in time.', 'The battery model is assumed.', 'Self-test: returns, is swapped, resumes'),
  ] },
  { group: 'Command and trust', rows: [
    R('live-algo', 'Evidence graph', 'graph', 'workspaces/graph/model.js', /buildGraph/, 'Every link is a reading in the mission log.', SCN + '.'),
    R('live-algo', 'A timeline that replays exactly', 'mission', 'workspaces/mission/timeline.js', /seek/, 'Seeking runs the mission again with the same commands.', '', 'Self-test: five jumps, five identical states'),
    R('live-algo', 'Command palette', null, 'global/palette.js', /palette:open/, 'Every action from the keyboard.', ''),
    R('live-ai', 'Copilot', 'copilot', 'workspaces/copilot/llm.js', /webllm|web-llm/i, 'A language model on this computer, or rules where it cannot run.', 'Its accuracy is measured on its own page.'),
    R('device', 'Voice in, alerts out', 'copilot', 'workspaces/copilot/voice.js', /SpeechRecognition|getUserMedia/, 'This browser’s speech service.', ''),
    R('live-algo', 'Hand-over report', 'report', 'workspaces/report/model.js', /buildReport/, 'Written from the mission log.', SCN + '.'),
    R('live-algo', 'Search marking', 'report', 'workspaces/report/marking.js', /insarag/i, 'INSARAG-style mark from the coverage table.', 'Not an official marking.'),
    R('device', 'Reassurance message', 'report', 'workspaces/report/speech.js', /speechSynthesis/, 'This browser’s voices.', 'Translations are checked by no one yet unless the page says so.'),
    R('live-algo', 'Fault drills', 'status', 'workspaces/status/drills.js', /injectFault/, 'The real mission engine, with a real fault switched on.', SCN + '.', 'Self-test: every fault, alone and together'),
    R('live-algo', 'Self-tests', 'status', 'workspaces/status/suite.js', /export const SUITE/, 'They run on this computer each time.', 'They test simulated people and a simulated mission.'),
    R('live-algo', 'This ledger', 'status', 'workspaces/status/ledger.js', /checkBuilt/, 'Each row’s code is looked up before it is listed as built.', ''),
    R('live-algo', 'Training', 'train', 'workspaces/train/drill.js', /score|sim/i, 'The real mission engine, scored against ground truth.', 'Not a certified course.'),
    R('live-algo', 'Accessibility', 'status', 'global/a11y.js', /aria-live/, 'Contrast, palette, motion, text size, shortcuts, spoken alerts.', 'Not tested by people who rely on it.'),
    R('device', 'Works offline', 'status', 'global/a11y.js', /serviceWorker/, 'Files are kept after the first load.', 'Large models are kept by their own libraries.'),
  ] },
  { group: 'Radio twin', rows: [
    R('live-algo', 'Ray-traced Wi-Fi', 'radio', 'workspaces/radio/twin.js', /ray|image/i, 'Image-method rays through the plan.', 'Wall losses are assumed.'),
    R('live-ai', 'A person in the channel', 'radio', 'workspaces/radio/person.js', /infer|nn/, 'A simulated channel fed to the real network.', 'Simulated channel.'),
    R('concept', 'Quarter-wavelength dither', 'radio', 'workspaces/radio/fresnel.js', /fresnel/i, 'The mathematics of the project’s own idea.', 'Not tried on the rover.'),
    R('concept', 'Synthetic aperture', 'radio', 'workspaces/radio/sar.js', /sar/i, 'Back-projection, computed here.', 'Simulated echoes.'),
    R('live-algo', 'Compressive sensing', 'radio', 'workspaces/radio/sparse.js', /sparse|ista|l1/i, 'Reconstruction, computed here.', 'Simulated measurements.'),
    R('concept', 'Intelligent surfaces', 'radio', 'workspaces/radio/ris.js', /ris|phase/i, 'Beam steering mathematics.', 'No surface exists.'),
    R('concept', 'Every router a sensor', 'radio', 'workspaces/radio/bf.js', /beamform|bf/i, 'The standard’s feedback, worked through.', 'Not connected to a router.'),
  ] },
  { group: 'Deep scan', rows: [
    R('concept', 'Muon tomography', 'deepscan', 'workspaces/deepscan/muon.js', /muon/i, 'Reconstruction, computed here.', 'Simulated measurements. Nothing is on HOUND.'),
    R('concept', 'Quantum gravity', 'deepscan', 'workspaces/deepscan/gravity.js', /gravity/i, 'Inversion, computed here.', 'Simulated measurements.'),
    R('concept', 'Ground radar', 'deepscan', 'workspaces/deepscan/gpr.js', /migrat/i, 'Migration, computed here.', 'Simulated echoes.'),
    R('concept', 'Fibre as a microphone', 'deepscan', 'workspaces/deepscan/das.js', /das|fibre|fiber/i, 'Localisation along a cable.', 'Simulated strain.'),
    R('concept', 'Seismic tap location', 'deepscan', 'workspaces/deepscan/seismic.js', /arrival|tap/i, 'Arrival-time inversion.', 'Simulated taps.'),
    R('concept', 'Shape of a void by echo', 'deepscan', 'workspaces/deepscan/echo.js', /echo/i, 'Ranging, computed here.', 'Simulated echoes.'),
  ] },
  { group: 'Vision lab', rows: [
    R('live-ai', 'Search a picture by words', 'vision', 'workspaces/vision/words.js', /clip/i, 'A pretrained CLIP model in the browser.', 'Not trained by us.'),
    R('live-ai', 'Click to outline', 'vision', 'workspaces/vision/outline.js', /sam|segment/i, 'A pretrained segmentation model.', 'Not trained by us.'),
    R('live-ai', 'One photo to 3-D', 'vision', 'workspaces/vision/relief.js', /depth/i, 'A pretrained depth model.', 'Depth is relative, not metres.'),
    R('device', 'Pulse from pixels', 'vision', 'workspaces/vision/pulse.js', /pulse|getUserMedia/i, 'Your camera or a generated clip.', 'Not a medical device.'),
    R('concept', 'Event camera', 'vision', 'workspaces/vision/events.js', /event/i, 'Computed from ordinary frames.', 'No event camera is fitted.'),
    R('concept', 'Skin by its spectrum', 'vision', 'workspaces/vision/skin.js', /skin|nir|swir/i, 'An index on simulated bands.', 'No infrared camera of this kind is fitted.'),
    R('live-ai', 'Hear a voice', 'vision', 'workspaces/vision/voice.js', /whisper|audio/i, 'Pretrained audio models on your microphone.', 'Not trained by us.'),
  ] },
  { group: 'Search strategy', rows: [
    R('live-algo', 'Search theory', 'strategy', 'workspaces/strategy/ex-theory.js', /bayes|prob/i, 'A probability map updated after each look.', 'Assumed detection rates.'),
    R('live-algo', 'Where to listen next', 'strategy', 'workspaces/strategy/ex-theory.js', /entropy|gain/i, 'Expected information of one more window.', 'Assumed detection rates.'),
    R('live-algo', 'Planning under doubt', 'strategy', 'workspaces/strategy/ex-planner.js', /mcts|tree/i, 'Monte-Carlo tree search, measured.', 'Simulated worlds.'),
    R('live-algo', 'Many teams, one plan', 'strategy', 'workspaces/strategy/teams.js', /anneal/i, 'Exact, annealed and quantum-inspired solvers.', 'Runs on an ordinary computer.'),
    R('live-algo', 'The value of a sensor', 'strategy', 'workspaces/strategy/ex-value.js', /value|sensor/i, 'The same machinery, asked a design question.', 'Assumed sensor models.'),
  ] },
  { group: 'Timelines', rows: [
    R('live-algo', 'Fork the mission', 'timelines', 'workspaces/timelines/runner.js', /createEngine/, 'Each branch is a full run of the engine.', SCN + '.'),
    R('live-algo', 'Sensitivity sweeps', 'timelines', 'workspaces/timelines/sweeps.js', /sweep/i, 'Hundreds of runs in workers.', 'Simulated missions.'),
    R('live-algo', 'Counterfactuals', 'timelines', 'workspaces/timelines/cf.js', /counter|flip/i, 'What would have changed the answer.', 'Simulated missions.'),
    R('live-algo', 'Regret', 'timelines', 'workspaces/timelines/regret.js', /regret/i, 'Measured against the best branch.', 'Simulated missions.'),
  ] },
  { group: 'Model forge', rows: [
    R('live-ai', 'Train it yourself', 'forge', 'workspaces/forge/ex-train.js', /train|grad/i, 'Gradient descent in this browser.', 'Simulated people.'),
    R('live-ai', 'Eight-bit version', 'forge', 'workspaces/forge/ex-int8.js', /int8/i, 'Measured on the test windows.', 'Not run on the microcontroller.'),
    R('live-ai', 'Pruning', 'forge', 'workspaces/forge/ex-prune.js', /prune/i, 'Measured on the test windows.', 'Simulated people.'),
    R('live-ai', 'Knowing when it does not know', 'forge', 'workspaces/forge/ex-doubt.js', /conformal|calib/i, 'Calibration and conformal prediction.', 'Simulated people.'),
    R('live-ai', 'A spiking version', 'forge', 'workspaces/forge/ex-spike.js', /spik/i, 'Converted weights, run here.', 'Not run on neuromorphic hardware.'),
    R('live-ai', 'Clean or messy simulator', 'forge', 'workspaces/forge/ex-clean.js', /clean/i, 'Both networks, compared.', 'Both are tested on simulated people.', 'Trained clean: 81 % of empty rooms raise an alarm'),
  ] },
  { group: 'Structure', rows: [
    R('live-algo', 'Collapse by physics', 'structure', 'workspaces/structure/physics.js', /rapier/i, 'A rigid-body engine in this page.', 'An invented building; not a structural assessment.'),
    R('live-algo', 'Test the lift, shake, shore', 'structure', 'workspaces/structure/physics.js', /lift|shore/i, 'Trial runs of the same pile.', 'Assumed friction and strength.'),
    R('live-algo', 'Void count', 'structure', 'workspaces/structure/voxel.js', /betti/i, 'Topology of the voxel pile.', 'Invented pile.'),
    R('concept', 'Vine and snake robots', 'structure', 'workspaces/structure/robots.js', /vine|snake/i, 'Routes through the voids.', 'Neither robot exists here.'),
  ] },
  { group: 'Horizon', rows: [
    ...[['insects', 'Insects that search'], ['seeds', 'Dandelion sensor seeds'], ['smell', 'The smell of a person'], ['laser', 'Heartbeat by laser'], ['passive', 'Passive radar'], ['insar', 'Satellites that see millimetres'], ['atoms', 'Atoms as antennas'], ['corners', 'Seeing around corners'], ['phones', 'Phones as beacons'], ['legged', 'Legged carriers'], ['earthfm', 'Foundation models for the Earth']].map(([id, name]) => R('concept', name, 'horizon', 'workspaces/horizon/exhibits/' + id + '.js', /id: '/, 'Its mathematics, run in this page, with cited research.', 'Not HOUND hardware.')),
  ] },
];

export const ALL = LEDGER.flatMap((g) => g.rows.map((r) => Object.assign(r, { group: g.group })));

// Is the code really there? Each module is fetched once and searched. 'built' | 'missing' | 'unknown' (offline).
let checked = null;
export function checkBuilt() {
  if (checked) return checked;
  const files = new Map(), get = (f) => { if (!files.has(f)) files.set(f, fetch(new URL('../../' + f, import.meta.url)).then((r) => (r.ok ? r.text() : null)).catch(() => undefined)); return files.get(f); };
  checked = Promise.all(ALL.map(async (r) => { const src = await get(r.file); r.built = src === undefined ? 'unknown' : src && r.mark.test(src) && !/^\/\/ Placeholder/.test(src) ? 'built' : 'missing'; return r; }));
  return checked;
}

export const ASSUMED = [
  ['Prior: chance a room holds a person', '10 %', 'assumed', 'core/fusion.js'],
  ['Wi-Fi network says person', '× 4.29 (measured: 47.6 % of people, 11.1 % of empty rooms)', 'measured in simulation', 'core/fusion.js'],
  ['Wi-Fi network says no one', '× 0.59', 'measured in simulation', 'core/fusion.js'],
  ['Radar: moving target / none', '× 6 / × 0.7', 'assumed', 'core/fusion.js'],
  ['Radar: breathing-sized motion / none', '× 3 / × 0.8', 'assumed', 'core/fusion.js'],
  ['Thermal: body-warm / faint / nothing', '× 8 / × 3 / × 0.5', 'assumed', 'core/fusion.js'],
  ['Steady machine-like motion', '× 0.3', 'assumed', 'core/fusion.js'],
  ['Far hotter than skin', '× 0.1', 'assumed', 'core/fusion.js'],
  ['Drone image: person-shaped / nothing', '× 6 / × 0.9', 'assumed', 'core/fusion.js'],
  ['Tapping or voice / nothing', '× 7 / × 0.9', 'assumed', 'core/fusion.js'],
  ['Rescue team on site: someone / no one', '× 200 / × 0.02', 'assumed', 'core/fusion.js'],
  ['A repeated reading from one place', 'counts as its square root', 'assumed', 'core/fusion.js'],
  ['Confirmed / possible thresholds', '85 % / 15 %', 'design choice', 'core/fusion.js'],
  ['Wi-Fi reach', '6.5 m, through 1 wall', 'design value', 'core/world.js'],
  ['LD2450 radar reach', '6 m, 120°, through 1 wall', 'assumed', 'core/world.js'],
  ['LD2410C radar reach', '4.5 m, through 1 wall', 'assumed', 'core/world.js'],
  ['Thermal camera reach', '7 m, 110°, no walls', 'assumed', 'core/world.js'],
  ['Rover and team speed', '0.42 and 1.1 m/s', 'assumed', 'core/world.js'],
  ['Hazard prices: slope, mud, gas', '× 6, × 6, × 3', 'assumed', 'core/world.js'],
];
export const NETFACTS = [
  ['Size', '23,372 weights, written from scratch in NumPy'], ['Training data', '4,384 simulated windows; 961 for validation'], ['Test data', '955 simulated windows of people never seen in training'],
  ['Moving person found', '86.9 %'], ['Still person found', '21.4 % (standing 25.5 %, lying 12.4 %)'], ['Still or moving, when someone is there', '91.5 %'], ['Empty room called empty', '88.9 % (false alarm 11.1 %)'], ['Is someone there, overall', '59.3 %'],
  ['Alarm level', '0.53, set so at most 10 % of empty validation rooms alarm'], ['Breathing rate', 'Not reliable. Never shown as a reading.'], ['Left, centre or right', '30.1 % where chance is 33 %. Position comes from radar.'], ['Real recordings', 'None yet. Never tested on real people.'], ['Raspberry Pi speed', 'Not timed'],
];
