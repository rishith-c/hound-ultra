# Horizon (agent: horizon)

## What was built
Workspace `horizon`, eleven exhibits (the brief asked for ten), Demo and Advanced.

- **Demo** (`dive.js`): one full-stage 3-D descent in eleven stops, orbit to heartbeat. Two worlds: the real Timure elevation, and an invented collapsed building. Wheel, arrow keys, stepper, autoplay and Pause move it. One WebGL canvas.
- **Advanced** (`index.js`, `lib.js`, `style.css`, `exhibits/*`): the old altitude chart is the index; each exhibit has two sentences, a readiness scale, citations, live mathematics with error against the simulated truth, what would have to be true, and what is unknown. New: atoms, passive, phones, legged.
- A failed exhibit import is now a console error. It was a warning, which hid a syntax error in `legged.js` from an earlier "0 errors" run.

## Labels
All exhibits: Concept, plus Live algorithm (Earth model: Live AI). Every Demo stop: Concept and Simulated; valley stops add Real data for the elevation only. HOUND has none of this hardware. Rubble textures are the AI-generated images already in `assets/img/gen`. Ground shift, flood, damage, people, building, gas and radio values are invented or marked assumed.

## Readings (default settings, simulated, one run unless stated)
| Exhibit | Reading |
|---|---|
| InSAR | 6.0 mm RMS over the 79 % that unwrapped; 19 of 24 damaged blocks, 6 of 30 intact blocks falsely flagged |
| Earth model | IoU 0.83 against 0.40 for an untuned index; trained on this same valley |
| Passive radar | 3 of 3 moving targets, 0 false alarms; a still person is invisible |
| Seeds | 2.4 °C RMS against 2.5 °C for one flat guess; hot spot placed in 0 of 10 drops: close to useless at this setting |
| Phones | 4 of 5 after 2 min, median 0.7 m; another run, 5 of 5 after 4 min, median 0.6 m, worst 3.9 m. The estimator is told the true loss |
| Legs | wheels close 39 % of the distance, legs 100 % on the sensed map; 5 of 39 leg steps break on the true ground |
| Corners | person placed 7.3 cm off, image match 0.32 |
| Smell | 71.5 % over six classes held out; 57.2 % of people at 5 % false alarms |
| Insects | 12 insects had sensed 1 of 3 people after about 8 min, placed 62 cm off |
| Atoms | 0.50 V/m against 0.50; heart at 30 cm needs 56 s averaging with no other field present (assumed noise) |
| Laser | 71.9 a minute against 71.9 after 28 s at 200 m |

Laser, more runs: 40 fresh recordings (neck, 200 m, 60 s), worst rate error 0.28, none over 2. Chest at 30 m, the Demo setting: worst 0.73, none over 2. Short recordings can lock to a wrong rate: the RMS error peaks above 10 near 10 s even though the median score has crossed the threshold.

## Changes made after seeing a result
- **Demo heartbeat.** My first estimator read 98 against 72. I changed noise, segment length and interpolation until it read 73 to 75; a later run read 97. I threw it away. The stop now runs the laser exhibit's own pipeline (exhibit's default seed 4): 71.8 against 72.1 at 60 s.
- **Laser score.** Its noise constant was an uncalibrated placeholder (9.7). I measured it on 100 white-noise recordings (7.0 to 8.0) and set 7.3. Noise-only 99th percentile scores stay under 4.2 against the threshold of 6, in white noise only. Scores rose and the crossing time went from 10 s to 8 s.
- **Legs.** The leg rule was wrong at first (it failed a bare stair) and was replaced by a foothold search. "Share of the way" counted sideways travel as progress; it is now the straight-line distance closed.
- **Insects.** Default compaction 0.45 to 0.2, because all three people were sealed off. **Passive radar.** One person was moved because two shared a cell; the page says such targets merge. **Phones.** A false title was corrected. **InSAR.** Scatterer, noise and damage values were tuned to look plausible.

## Verified (headless Chrome, `shoot.py`)
- 0 errors in the final runs; the last used `--strict`. All eleven exhibits load; a script operated all 96 controls without errors or NaN text (effects not checked one by one). Phones changed after that run; its controls were operated again by themselves, 0 errors.
- 60 fps, worst 16.8 ms: Demo stops 0 to 10 (some before the last edits) and the Advanced overview and all eleven exhibits when measured. Start-up stalls of about 600 ms in Phones and 467 ms in Insects were fixed by slicing the work; in the first 5 to 14 s of each exhibit the worst frame is now 83 ms (Atoms) and 50 ms (Earth model).
- Autoplay, Pause, arrows, wheel (one step), the stepper, Demo to Advanced and back keeping its stop. Reduced motion switched on at run time: stops change at once. Not tested: reduced motion from load, full autoplay loop.
- Viewed at 1440x900: all eleven exhibits, overview, Demo stops 1, 4, 5, 8, 10. At 1680x1000: all Demo stops (earlier build) and 0, 10, Phones, Laser (current).- Not checked: high contrast and colour-blind palettes, other browsers, real hardware, screens narrower than 1440.

## Citations
Checked as titles, authors and links in search results; **full texts and most pages were not opened**. Weakest: Scalise 2008 (seen only in a reference list), HTX 2025 (article body not seen), Tranzatto 2022 (abstract not seen), the CORDIS/SGL for USaR entry (not re-checked).

## Known gaps
- Earth-model Demo stop: water appears as broken patches and one bright strip; it is the least convincing stop.
- `_dev.html` is my test harness, still in the folder; it can go.
- The heartbeat drawing allocates a little each 0.3 s; nothing else I know of allocates per frame in the dive. I did not profile allocation.
- The 1440 dock overlap seen earlier is gone, so there is no request file.

## Process
`PreToolUse:Bash`, `:Edit` and `:Write` hooks (`[node]`) timed out several times. Refused writes and screenshot runs were each tried again once and went through; one read-only git/grep check was refused and not repeated, so I do not know whether `_dev.html` is tracked. Nothing bypassed the hooks. Only the user can change the hooks.

## For Devpost
Horizon dives from orbit to a single heartbeat through eleven far-frontier ideas, from radar fringes over a real valley to a laser reading a simulated chest. Every idea is a concept HOUND does not own, and every one runs its mathematics in the browser against a simulated truth, errors included. Some look promising; some, like sensor seeds at our settings, barely beat a guess, and the page says so.
