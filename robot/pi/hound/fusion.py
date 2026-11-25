"""How one room's readings become one chance. Bayes' rule in odds form: start low, and let every reading multiply the odds.
Same table as the console (app/core/fusion.js). Only the Wi-Fi numbers are measured, on 955 simulated test windows. The rest are design values, and are marked."""
PRIOR = .10
CONFIRM, OPEN = .85, .15
LR = {  # sensor: {answer: how many times likelier that answer is with a person there}
    'wifi': dict(pos=.476 / .111, neg=.524 / .889), 'radar': dict(pos=6, neg=.7), 'micro': dict(pos=3, neg=.8), 'thermal': dict(pos=8, faint=3, neg=.5),
    'signature': dict(machine=.3), 'temperature': dict(tooHot=.1), 'aerial': dict(pos=6, neg=.9), 'acoustic': dict(pos=7, neg=.9), 'human': dict(pos=200, neg=.02)}
MEASURED = {'wifi'}

def fuse(readings, prior=PRIOR):
    """readings: [(sensor, answer, from where)]. 'blind', or anything the table does not know, changes nothing. A second look from the same place is not new evidence, so it counts as its square root."""
    odds, seen, steps = prior / (1 - prior), {}, []
    for sensor, answer, place in readings:
        lr = LR.get(sensor, {}).get(answer, 1.0); n = seen.get((sensor, place), 0); seen[sensor, place] = n + 1
        lr = lr ** .5 if n else lr; odds *= lr; steps.append((sensor, answer, lr, odds / (1 + odds)))
    return odds / (1 + odds), steps

def verdict(p): return 'person' if p >= CONFIRM else 'possible' if p >= OPEN else 'unlikely'
