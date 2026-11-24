# Signals: report

Workspace: `app/workspaces/signals/`. Four exhibits behind four tabs. Only the one on screen runs. Nothing is written to the mission.

## What is built, and how it is labelled

| Exhibit | Label | What runs |
|---|---|---|
| Tap detector | Your device + Live algorithm | Microphone, or a built-in synthetic recording. Spectral-flux onsets 150 Hz to 4 kHz, gap histogram + autocorrelation, rejection of steady noise, voices and machine ticking. Spectrogram, waveform, score, log, a test measured in the page, and a fusion preview through `core/fusion.js` (preview only). |
| Phone finder | Concept + Live algorithm; map Simulated | Path loss + walls + noise on building B, 0.5 m grid posterior, Levenberg-Marquardt estimate, 90 % contour, measured error against positions. Privacy statement. |
| Drone transmitter | Concept; trace Simulated | Two-ray Fresnel geometry, drag or nudge the drone, eight-point pass, chest inset, received trace. |
| Breath plume | Concept; map Simulated; rover Live algorithm | 2-D advection-diffusion of CO2, a rover that sweeps, surges upwind and climbs, and a 12-rover score. |

## This pass

- Breath plume rewritten: rover search, 12-rover score, readable trace.
- Left card no longer repeats the tab name. The fusion preview moved under the knock log, so the left column is full. The test table spans the rest of the bottom row and is not cut.
- Panel titles are sentence-case h3 in the interface font (computed style checked).
- The tabs no longer truncate at 1440; the left rails fit at 900 px high.
- Fixed: the phone measurement kept drawing while hidden; a late microphone permission could start the microphone after the user had left or changed their mind; the plume and drone ran at full rate under reduced motion; the drone called a spot "good" that its own threshold called blind.

## Measured (all on synthetic or simulated data, run in the browser)

**Tap detector**, seed 3, the first seed not looked at while tuning. 336 clips, 74 min. 24 clips per cell, each with one group of three knocks. dB is knock level over background level.

| Background | +12 dB | +6 dB | 0 dB | -6 dB | False alarms |
|---|---|---|---|---|---|
| Steady noise | 24 | 23 | 16 | 0 | 0 in 23.2 min |
| Voice-like sound | 16 | 13 | 7 | 1 | 0 in 23.2 min |
| Random debris impacts | 21 | 17 | 3 | 1 | 6 in 23.2 min (0.26 / min) |
| Steady ticking | - | - | - | - | 0 in 4 min |

Weak: knocks at or below background level, knocks under voices, and debris that happens to fall in rhythm. In the built-in recording it misses "3 knocks under voices", and the screen says so. On tuning seeds 1 and 2, false alarms on debris were 4 and 1, and on ticking 1 and 1.

**Phone finder**, 160 simulated phones, 9 positions, median error (90th percentile): 1.0 m (3.7) at 2 dB noise, 2.3 m (6.8) at 4 dB, 4.3 m (14.9) at 8 dB, 4.1 m (9.8) at 4 dB with no floor plan. Four positions at 4 dB: 5.4 m. The opening run uses seed 34, the median of seeds 1 to 40 for that phone (4.0 m off; range 1.2 to 22.3 m). The seed was chosen to be typical; an earlier seed happened to give 9.9 m and the wrong room.

**Drone**, default 0.6 m cover, 2.4 GHz: breathing above twice the averaged noise at 4 of 8 hover points. Echo strength and rubble loss are assumed.

**Breath plume**, flag within 1.5 m of the crack: 11, 10 and 5 of 12 rovers in three runs at 0.08 m/s and 2 ppm noise; 6 of 12 at 10 ppm; 6 of 12 at 0.25 m/s (4 of the other 6 flagged the wrong place). One run each for the last two. The model is smooth, which flatters the idea.

## Verified (tools/shoot.py --strict)

- ERRORS 0 on every final run. All four opened and screenshots read at 1680x1000 and 1440x900; tap at 1920x1080. A script looked for overflowing panels at all three sizes: only the phone readings table scrolls, inside its own panel.
- Every button (except source switching, tested apart), slider, checkbox and lead selector driven by script; tabs by arrow key.
- Microphone, using a stand-in stream: Not now, refused, granted; the track is "ended" after leaving the workspace.
- Hidden: 0 canvas draws. Evicted by the shell: 0 draws. Reopened after eviction: works.
- Reduced motion: redraws 2 a second or fewer per canvas.

## Not done, and known gaps

- Not tried with a real microphone and real knocks. No real recordings were used anywhere.
- Canvas drags (phone, drone, wind dial) and the keys on those canvases were not driven by a script in this pass. "Play it aloud" was clicked, not listened to.
- The plume map has empty bands above and below at 1440x900.
- Two lines at the drone sweep chart cross when the drone is at the left end (label and cursor).

## For the orchestrator

The positive-copy pass edited these files while I was testing. I left its wording. Three changes to check against the original brief and FACTS: the drone note no longer says a still person is found 21.4 % of the time (the brief asked for that tie); "It is not built or tested" and "no such radio is built" are gone, so only the Concept tag says so; "assumed" became "design values" in the phone note and for the x7 tapping weight.

## For the Devpost write-up

HOUND also listens. A detector that runs in the browser finds three even knocks in 23 or 24 of 24 synthetic recordings when they are at least 6 dB above steady noise, with no false alarms in 23 minutes of that noise; it is much weaker under voices and has not been tried on real recordings. Three further ideas, locating a phone by signal strength, a drone as the Wi-Fi transmitter and following exhaled CO2, are interactive concepts that show where they fail as well as where they work.
