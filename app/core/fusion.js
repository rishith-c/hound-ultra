// Sensor fusion: combine what each sensor says into one probability that a person is there.
//
// Method: Bayes' rule in odds form. Start from a prior, multiply by one likelihood ratio (LR) per piece of
// evidence. LR = P(sensor says this | person) / P(sensor says this | no person).
//
// Where the numbers come from:
//   csi      MEASURED on the 955 held-out simulated test windows (ml/results/synthetic.md in the rover repo):
//            the network says "person" for 326 of 685 person windows (47.6 %) and 30 of 270 empty windows (11.1 %).
//   others   ASSUMED design values. The radar and thermal camera have not been characterised yet, so these are
//            placeholders that make the logic visible. They are marked `assumed: true` and the UI must say so.
//
// A second reading from the same sensor at the same place is not independent of the first, so it counts at half
// weight (square root of its LR). This is an assumption too.
export const PRIOR = 0.1; // before any reading, the chance a given room holds a person (assumed)

export const LR = {
  csi: { pos: 0.476 / 0.111, neg: (1 - 0.476) / (1 - 0.111), assumed: false, label: 'Wi-Fi neural network' },
  radar: { pos: 6, neg: 0.7, assumed: true, label: 'Radar moving target' },
  micro: { pos: 3, neg: 0.8, assumed: true, label: 'Radar micro-motion (breathing)' },
  thermal: { pos: 8, faint: 3, neg: 0.5, assumed: true, label: 'Thermal camera' },
  signature: { machine: 0.3, assumed: true, label: 'Motion pattern' }, // steady, periodic motion looks like a machine
  temperature: { tooHot: 0.1, assumed: true, label: 'Temperature check' }, // far above skin temperature
  aerial: { pos: 6, neg: 0.9, assumed: true, label: 'Drone image detector' },
  acoustic: { pos: 7, neg: 0.9, assumed: true, label: 'Tapping or voice' },
  human: { pos: 200, assumed: true, label: 'Rescue team on site' },
};

// A missed person costs far more than a second look, so a lead stays open ("possible") down to 15 %.
export const THRESHOLDS = { confirmed: 0.85, possible: 0.15 };

export function lrOf(ev) {
  const table = LR[ev.sensor];
  if (!table) return 1;
  const v = table[ev.result];
  return typeof v === 'number' ? v : 1; // 'blind' (sensor could not see) and unknown results carry no information
}

// evidence: [{ sensor, result, t?, note?, score? }]. Returns the probability and every step, so the UI can show
// exactly how the number was reached.
export function fuse(evidence, prior = PRIOR) {
  let odds = prior / (1 - prior);
  const seen = new Map();
  const steps = [];
  for (const ev of evidence) {
    const raw = lrOf(ev);
    const k = ev.sensor + '|' + (ev.vantage || '');
    const repeat = seen.get(k) || 0;
    seen.set(k, repeat + 1);
    const lr = repeat ? Math.sqrt(raw) : raw;
    odds *= lr;
    steps.push({ ...ev, lr, rawLr: raw, repeat, assumed: LR[ev.sensor]?.assumed ?? true, p: odds / (1 + odds) });
  }
  return { p: odds / (1 + odds), odds, prior, steps };
}

export function classify(p) {
  return p >= THRESHOLDS.confirmed ? 'confirmed' : p >= THRESHOLDS.possible ? 'possible' : 'unlikely';
}
