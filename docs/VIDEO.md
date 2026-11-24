# The film, cut 4

3 minutes 59 seconds, someone speaking the whole way through. It is a demonstration of the Advanced console, with a real cursor, and
the robot, the network and the drone shown inside it.

## How it is made

- `tools/film-shots4.json` lists the shots. `python3 tools/film.py tools/film-shots4.json` records them from the live console.
- `tools/film-edit4.json` is the edit. `python3 tools/film_cut.py tools/film-edit4.json --out NAME` renders it; `--k 2` renders 4K,
  `--srt` writes the subtitles.
- The voices decide the timing: every cut is placed on a spoken word.
- Tags on screen say what is simulated. Every claim follows `docs/FACTS.md`. The robot and its footage are real. The build is sped up.

## Recording the voices

- One recording per person. A phone in Voice Memos, 20 cm from the mouth, in a quiet room with soft things in it.
- Say each line twice, two seconds of quiet between. Mistakes are fine: say the line again.
- Talk to one person, do not read at them.

## The lines

### Rishith

- `o1` Somewhere under here, there could be a person. You can't see them. You can't hear them.
- `o2` So we built a robot, trained a neural network, and designed a drone, to find them through the walls, using Wi-Fi. And one console, to run it all.
- `o3` This is HOUND.
- `w1` This summer, a flood in Nepal killed more than thirteen hundred people. More than five thousand went missing.
- `w2` Every time, rescuers have one question: is anyone in there? A camera can't see through a wall. So people go in blind.
- `c1` And this is where you run it all. HOUND Command: one console, built to command the whole fleet in real time.
- `c2` Every robot, every sensor, every room, on one screen. Wi-Fi. Radar. Body heat. Link. Battery. And the odds that someone is there.
- `f2` Now watch a search. The robot plans its own way in, stops outside a room, goes quiet, and listens. A hot pipe: ruled out. Then, a person: found.
- `f3` It draws the safe way in. And a person makes the call.
- `x3` Test the collapse before anyone lifts a beam. Rewind the mission. Watch the week's real earthquakes. Or just ask.
- `h1` And further out: radar that never transmits. Sensors that fall like seeds. Light that sees around corners.
- `e1` One robot. One neural network. One question.
- `e2` Is anyone in there?
- `e3` We're students. You can run it right now, in your browser. This is HOUND.

### Mario

- `n1` Now, the brain. Wi-Fi goes straight through a wall, but a living body changes it on the way. So we taught a neural network to read that change.
- `n2` Ten seconds of Wi-Fi go in. Someone walking: found. An empty room: quiet. Walking again: same answer. A fan: not fooled.
- `n3` No recordings existed, so it learned from nine hundred simulated people. And you can train one yourself, live, right here.
- `n4` On people it had never seen, it found eighty-seven percent of those who moved, in simulation. Lying still is harder, so it never works alone.
- `f1` Radar and heat join in. Every reading moves the odds, in the open. Ten percent. Then ninety-four.
- `x1` Trace radio through every wall. Look into a pile with cosmic rays. Listen for someone tapping.
- `x2` Send six robots and two drones into one search. Lose a link, and they find their own way back.
- `p1` Does it work? Two hundred simulated missions, six hundred hidden people. Every one was found, or flagged for a check. No decoy was ever called a person.
- `p2` Then we broke it on purpose. Cut the radio: it stops. Blind the Wi-Fi: it refuses to guess.

### Junsu

- `b1` So we send a robot first. We built it ourselves, and this is the real build, sped up.
- `b2` Four motors. Mecanum wheels, so it slides sideways through a gap. A thermal camera for body heat, a radar for motion, and a Wi-Fi receiver.
- `b3` Lose the link, and it stops on its own, in under half a second.
- `c3` Open the robot, and take it apart. Every motor, every board, every wire. Then drive it.
- `d1` Next, the drone. We designed and simulated it with four senses. Color, to see a shape. Heat, to find a warm body. A laser, to measure every stone. And Wi-Fi, to reach under the rubble.
- `d2` Find people: a neural network checks the frame. Color anomaly: the one thing that doesn't belong. Before and after: what moved.
- `s1` Then it looks inside the ruin. A million points. The roof lifts away, and it finds the pockets where someone could survive.

## The order

`o1` `o2` `o3` `w1` `w2` `b1` `b2` `b3` `c1` `c2` `c3` `n1` `n2` `n3` `n4` `f1` `f2` `f3` `d1` `d2` `s1` `x1` `x2` `x3` `p1` `p2` `h1` `e1` `e2` `e3`

## The live demonstration

A person on one side of a wall, HOUND on the other, the robot's own readings beside the camera (`tools/live.py`, `live/`). It goes in
after `n4` only when there is a real recording, and the film then claims only what that recording shows.
