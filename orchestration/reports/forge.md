# forge: Model forge / chapter 03 "The training"

## Built
- **Demo: the hall.** 900 life-size plaster figures, one per simulated person in the training set, each with that person's own height, shoulder width, chest depth, yaw and posture (the limbs come from six sculpted poses). A 27 s camera move: one figure, the Wi-Fi ripple and its 52-channel pattern, the crowd's ribbons, then the crowd re-judged at 26 recorded training steps and a held ending. Drag or arrow keys look around, Space pauses, hover shows a person's numbers. "Train it live" opens Advanced and starts the trainer.
- Figures: `tools/blender/forge_figures.py` (signed distance fields, cloth folds, baked occlusion, three levels of detail). No scan, no download. Hall: `app/workspaces/forge/hall/`.
- **Advanced: six exhibits**: train it yourself, int8, pruning, doubt (calibration, conformal, out of distribution), spiking, clean vs. messy.
- `tools/forge_export.py` measures everything. Hero data 0.85 MB; data/forge 26.6 MB, the window sets loaded only in Advanced.

## Labels
Demo: Recorded run, Simulated. Advanced: Live AI (train, prune, clean vs. messy), Live algorithm (int8, doubt, spiking), Concept (chip and neuromorphic hardware). Every window is simulated.

## Measured (NumPy unless noted; held-out test, simulation)
- Published matrix 240 / 30 / 359 / 326 reproduced exactly.
- Recorded run: the project's train.py re-run with seed 0, best epoch 12, 86.5 % of moving and 22.9 % of still people found, 90.4 % of empty rooms called empty. **It is not the shipped model** (largest weight difference 0.29); the shipped one finds 86.9 % and 21.4 %. The threshold is reset on validation at each step (10 % false alarms), the project's rule.
- The figure shown is over all held-out moving windows. The crowd's own held-out subset (each person shown once, on one side) is 83.3 % moving and 26.5 % still. Glow is the share of that person's windows found, raised to the power 2.1 for display, so a person found in one window of three is nearly dark.
- int8: 23,716 bytes against 93,488; moving 88.3 % (float 86.9 %), still 24.1 % (21.4 %), empty 88.1 % (88.9 %), 31 of 955 answers changed. The quantisation settings were searched on validation: input step 0.12 %, activation percentile 99.9 (about 15 settings tried, best agreement 0.980).
- Pruning: knee 40 % cut only, 70 % with three more epochs (AUC within 0.01).
- Calibration error 9.4 % to 7.3 % (temperature), 2.5 % (scale and offset). Conformal at 90 %: 89.2 % covered, just under the promise; not sure for 71 % of still and 12 % of moving people.
- Out of distribution: weak. 2 % interference is flagged 6 % of the time, against a 5 % base rate.
- Spiking: 97 % agreement at 256 steps for 5.2 M synaptic events against 271 k multiply-adds. Worse.
- Clean-trained on messy: 81 % of empty rooms called a person.

## Verified in the page (tools/shoot.py --strict, 0 errors on the final runs)
- Demo at 1680x1000 and 1440x900. 60 fps in five of six valid 3 s samples; one read 56 with the machine busy. Advanced trainer 60 fps while training.
- Training end to end: 16 epochs, 19.6 s, 83.5 % moving on 320 test windows (NumPy twin 83.5 %, rover's 85.7 %). Gradient check worst gap 4.8e-8; NumPy loss identical to 5 decimals, gradients to 6.7e-6.
- int8 320 of 320 windows bit for bit; clean/messy 1280 of 1280 probabilities within 0.001.
- Animation stops when hidden, resumes; Space pauses; hover; the Demo button flow. Buttons and sliders of prune, doubt, spike and clean were fired by script (35 in total): no errors, results not each inspected.

## Not done or not verified
- Live training drives the trainer, **not the crowd** (needs about 9 MB more windows). 26 checkpoints, not 40.
- Reduced motion is coded (held end frame) but not run. Tab order not walked. int8 and train exhibits: controls not all clicked. Advanced at 1440 was looked at for exhibit 1 only; the others by overflow measurement.
- A few chart labels in exhibits 1, 5 and 6 sit close to lines.
- Citations: titles and links were found by search; some venue names were not read at the source. The N8 8 MB flash figure and the 4-dollar price come from listings and were not confirmed on the datasheet.
- Ribbons and the thread brightness use a display curve (power 2.3 on the true weight), conv threads are one per channel pair (length of its 9-tap filter). The hall does not say so on screen.
- data/forge is 1.6 MB over the 25 MB guide.

## For the orchestrator
demo.js was reworded on disk (2cb7ef9). I left it, but the Still label now reads "radar and heat join in" beside "Walking 87 % found", so the 22.9 % is gone from Demo, along with "Wrong" at step 0 and the end line from your note. The brief called the unlit side the honest limit; I would restore the number. See orchestration/requests/forge.md.

## For Devpost
The training set is 900 people who never existed. We put all of them in one hall and re-judged each with the network as it stood at 26 recorded training steps: those it found glow. Most moving people light up and most still ones stay dark (86.5 % and 22.9 % held out, in simulation), which is why a second sensor is needed.
