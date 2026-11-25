# The film, cut 10

3 minutes 59 seconds, someone speaking the whole way through. It shows the Advanced console with a real cursor, then explains one search in
five steps (fly, drive, listen, think, decide), shows a whole search, the results, and a last demonstration at a real wall.

## How it is made

- `tools/film-shots4.json` lists the shots. `python3 tools/film.py tools/film-shots4.json` records them from the live console.
- `tools/film-edit6.json` is the edit. `python3 tools/film_cut.py tools/film-edit6.json --out NAME --no-captions` renders it; `--k 2`
  renders 4K, `--srt` writes the subtitles, and without `--no-captions` they are burnt in.
- The picture is finished and locked. Cuts, music and every spoken phrase have a fixed place. The recordings are laid into those places, the
  picture is copied, and nothing is rendered again: about two seconds of work. A line that runs too long is tightened by a few percent, never cut.
- The cuts were placed on the words of a guide voice, then moved to the nearest note of the score (they share one clock).
- The 4K picture is filmed from the live pages again, one frame at a time, at the size each camera move needs, so a close-up is drawn and not
  enlarged. `film_cut.py --picture --k 2` joins it without sound. Real robot footage comes from 4K 60 originals; the build timelapse is 1080p.
  Film `t_status` at normal priority: System check times itself, and a slowed-down machine fails its ten speed checks.
- The film starts inside: a room seen from under a table as the ceiling comes down (`tools/buried/`, path traced in Blender, 717 pieces that
  really fall, materials from Poly Haven, CC0). It comes back after the first black, by the daylight that gets in, and on "One question",
  by a searchlight. Every use is tagged Simulated.
- The title is one unbroken shot of 11.6 seconds, drawn by `tools/dive/render.py`: through the O of HOUND to the Earth of 26 August 2026,
  through the clouds to the village, and the shadow of a cloud over it on the question. The last card is the same camera flying back out.
- Why it is cut this way, with the papers: `docs/EDITING.md`.
- The score is written to the picture. Every note is a real recording: string ensemble,
  horns, trombones, tuba, a Steinway, a floor tom tuned down for the drum, and two small pieces of wood for the clock. No synthesiser.
- It is one continuous piece: one running figure and one tune that comes back in every step, with no hit at the start of a step. Each step
  has its own rise, and the chords resolve on the cuts.
- Every list is a ladder: the whole orchestra lands on each thing as it is named, each time higher and bigger, with a breath before it. Every
  question is a climb that stops dead on the question, with only the room's echo after it. The drum is kept for the things said.
- The music keeps its size under the voice (`duck.py`): it is split into three bands, and only the band a voice lives in steps back, and only
  as far as needed for 10 dB of clearance. The low end and the air stay. A speech recogniser hears 602 of the 616 words over the music (611
  with no music at all).
- It is silent on purpose seven times: before the first words, on "You can't hear them", before the name, on "is anyone in there?",
  where two waves cancel, on "So, is anyone in there?", and before the last word.
- Tags on screen say what is simulated. Real shots of the robot inside the search are tagged as driven by remote. Every claim follows `docs/FACTS.md`. The robot and its footage are real. The build is sped up.

## Recording the voices

- One recording per person. A phone in Voice Memos, 20 cm from the mouth, in a quiet room with soft things in it.
- Keep to the length beside each line on the lines page (press Pace). Say each line twice, two seconds of quiet between. Mistakes are fine: say the line again.
- Talk to one person, do not read at them.

## How the film explains the signal

Three pictures, each driven by the physics it describes. None is a recording.

- **The wave** (`x_wave`): a Wi-Fi wave crosses a wall, reaches a person, loses some of itself and scatters. Most of a body is water, which absorbs and reflects
  at 2.4 GHz.
- **Two waves** (`x_sum`): the receiver hears the straight wave and the bounced one added together. In step they grow, out of step they cancel, and a walking
  person turns one into the other. This is the superposition model of [subspace sensing](https://arxiv.org/pdf/1810.04302), the
  [Fresnel zones](https://www.doi.org/10.1145/2971648.2971744) behind respiration sensing, and the ratio model of [FarSense](https://arxiv.org/pdf/1907.03994).
- **51 channels** (`x_ridge`): the same thing on every Wi-Fi subcarrier at once, each with its own wavelength, so each rises and falls at its own moment.
  How the rate of change follows walking speed: [the CSI-speed model](https://arxiv.org/pdf/1811.07162).

Then the network (`x_net`, `tools/film/net3d.js`): the 51 lines fold flat into a 51 by 200 picture, small filters slide over it, and the answer is the output of the
trained network with its real weights. Overviews: [Sensors 2024](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11597943/), [CSI-Net](https://arxiv.org/pdf/1810.03064),
[deep learning for radio sensing](https://arxiv.org/pdf/2010.12717).

The wall demonstration (`x_wall`, `tools/film/walllive.js`) is real footage. The signal beside it is simulated from that footage (`tools/film/mywalk.json` is the path
walked), and the network reading it is the trained network. The film says so, in the voice and on screen.

## The drone in the film

The drone is a design, so everything about it is tagged Concept, Simulated or AI-made test scene. Its flight (`x_fly`, `x_chase`, `tools/film/flight3d.js`) is the
site's own aerial scene seen from the film's own camera. The finding shot (`v_pov`) runs on AI-made test pictures; the boxes on them come from the site's real
detector (D-FINE nano, trained on COCO, running in the browser). The pin and the before-and-after are the site's own demonstrations.

The five steps open as five windows (`x_five`) and come back at the end, each lighting on its word (`x_five2`), so the film closes on the same five words it
promised.

## The lines

### Rishith

- `o1` Somewhere under here, there could be a person. You can't see them. You can't hear them.
- `o2` So we built a robot, trained a neural network, and designed a drone, to find them through the walls, using Wi-Fi. And one console, to run it all.
- `o3` This is HOUND.
- `w1` This summer, a flood in Nepal killed more than thirteen hundred people. More than five thousand went missing.
- `w2` Every time, rescuers have one question: is anyone in there? A camera can't see through a wall. So people go in blind.
- `c1` This is HOUND Command, where you run the whole search: every robot, every sensor, every reading, on one screen.
- `c2` Here's how it finds someone, in five steps.
- `f2` Now watch a whole search. The robot plans its own way in, stops outside a room, goes quiet, and listens. A hot pipe, ruled out. Then, a person. Found.
- `f3` It draws a safe way in, and a person makes the call.
- `e2` So, is anyone in there?
- `r1` Here's a real wall, with HOUND on one side. The signal, simulated from this video, is flat. Then I walk in. Every step changes it. And the network answers: someone is moving.
- `u1` It's for the people who go in first: firefighters, search and rescue, disaster crews. So they don't have to go in blind.
- `e3` That's the whole thing: fly, drive, listen, think, decide. And you can try it right now, in your browser. This is HOUND.

### Mario

- `c3` Send out a whole team, test a collapse before anyone lifts a beam, rewind the mission, or just ask it a question.
- `n1` Step three: it listens. Wi-Fi goes straight through a wall. But you're mostly water, so your body soaks some of it up, and some of it bounces off.
- `n5` Now two waves reach HOUND. In step, they add up. Out of step, they cancel. So when someone moves, the signal rises and falls, on fifty-one channels at once.
- `n6` Step four: the neural network. Ten seconds of that becomes one picture. Small filters slide across it, layer after layer, looking for the pattern a moving body leaves.
- `n2` Then it answers. When someone walks, it finds them. When the room is empty, it stays quiet. And a fan doesn't fool it.
- `n3` We trained it on nine hundred simulated people, and you can train one yourself, live.
- `n4` On people it had never seen, it found eighty-seven percent of the ones who moved, in simulation.
- `f1` Step five: it decides. Radar and heat join in, and every reading moves the odds. Ten percent. Then ninety-four.
- `p1` We ran it through two hundred simulated missions, with six hundred hidden people. Every one was found, or flagged for a check. And no decoy was ever called a person.
- `p2` Then we tried to break it. Cut the radio, and it stops. Blind the Wi-Fi, and it won't guess.

### Junsu

- `d1` Step one: the drone flies in first, with four senses on board.
- `d2` Its camera looks for people. Heat picks out a warm body. A laser measures every stone. And Wi-Fi reaches under the rubble.
- `d4` A neural network reads every frame. That orange tarp? Just a tarp. That yellow coat? That could be a person.
- `d6` So it drops a pin on the map. Fly it again later, and it marks whatever moved.
- `s1` The laser scan becomes a 3-D model, so you can lift the roof off and see where someone could survive.
- `b1` Step two: the robot drives in.
- `b2` Its wheels slide it sideways through a gap. It carries a thermal camera for body heat, a radar for motion, and a Wi-Fi receiver.
- `d3` It follows the drone's map. Then the drone sends it Wi-Fi from the far side, through everything in between.

## The order

`o1` `o2` `o3` `w1` `w2` `c1` `c3` `c2` `d1` `d2` `d4` `d6` `s1` `b1` `b2` `d3` `n1` `n5` `n6` `n2` `n3` `n4` `f1` `f2` `f3` `p1` `p2` `e2` `r1` `u1` `e3`

## The live demonstration

A person on one side of a wall, HOUND on the other, the robot's own readings beside the camera (`tools/live.py`, `live/`). It goes in
beside `r1` only when there is a real recording, and the film then claims only what that recording shows.
