# Why the film is cut the way it is

What research on editing, attention and music says, and the rule we took from each paper. `tools/film_audit.py FILM.mp4 EDIT.json` measures
a cut against these rules.

| What was found | Where | What we do |
| --- | --- | --- |
| After a cut the eyes of an audience land on the same place 360 to 400 ms later | Smith, Levin & Cutting 2012, *A Window on Reality* | No reading matters in the first 0.4 s of a shot; the subject is where the eye already is |
| Repeating the content or colour of the last shot re-orients the eye faster | Valuch & Ansorge 2014, 2015 | Neighbouring console shots keep their framing |
| Short, visually simple scenes hold attention, and that raises immersion, liking and recognition (42 adverts, 2,520 viewings) | *Journal of the Academy of Marketing Science* 2026 | One reading per shot, tight; no long full-screen dashboards |
| Cuts on the beat feel better, even to people who do not notice | Lin, Yeh & Shams 2022 | Picture and score share one clock; every cut has a note under it |
| Films slow down in the set-up, darken in the middle, speed up into the climax, then slow and brighten | Cutting 2016 | The order of the film and the length of its shots |
| Cut scenes feel longer and more arousing; uncut shots are remembered a little better | *Scientific Reports* 2022 | Cut the journey, hold the proof: `87 %`, `94 %`, `600 of 600` |
| A pause helps memory only just before the last word of the sentence | Diachek & Brown-Schmidt; MacGregor et al. 2010 | Silence before "ninety-four", "found" and "blind" |
| Tension is uncertainty, prediction and delay | Lehne & Koelsch 2015 | The search: a decoy first, then the answer late |
| Suspense narrows what people see to the middle of the picture | Bezdek et al. 2015 | Tight, centred frames while the robot listens |
| Chills come with a sudden change of loudness, a build, and a new instrument | de Fleurian & Pearce 2021 | The horn theme and the major key are kept for "found" |
| Several emotional peaks beat one; the last impression counts | Unruly and Affectiva; Ipsos (734 adverts) | Peaks at `94 %`, the drone, the tools, "found" and the last chord |
| A camera that really moves through a room wakes the viewer's own motor cortex; a zoom does not do it as much (EEG) | Heimann et al. 2019, PMC6415856 | No zoom where a flight is possible: the opening is one camera path from 525,000 km to 1 km, the globe shot is a flight |
| Awe makes people feel small and widens what they care about (five studies, 990 people; video and VR) | *Awe promotes moral expansiveness via the small-self*, PMC10025529 | The whole Earth first, then one valley, then the numbers |
| Seeing the Earth from space in VR gives the "overview effect"; beta and gamma power drop at its peak, as if thinking stops | *Virtual Reality* 28, 140 (2024) | Silence and nothing to read while the Earth fills the frame |
| Viewers judge competence in the first ten seconds of a pitch, and it predicts who gets backed | Maurer et al., *Journal of Innovation & Knowledge* | The robot, the collapse and the question come before any title |
| Tense music alone makes suspense; sound raises arousal more than picture | *Humanities and Social Sciences Communications* 2022 | The score drops to almost nothing in space and the river comes in with the clouds |
| Cut everything that does not serve the point; show and say it together | Mayer; Noetel et al. 2021 | One idea per shot, on the word that names it; captions as a separate file |

Not used: the claim that shot lengths in a 1/f pattern make better films. The study that tested it found no link with how films are rated.

How Nolan does it, in his and his editors' words: *Dunkirk* was written like a Shepard tone, an illusion of rising that never stops; the
ticking sits "just on the level of consciousness"; sound and picture are locked together. So the score of the tools and of the search
climbs in octaves that enter at the bottom and leave at the top, the clock is two pieces of wood, and the loudest part of the film ends in
the dark, with the robot heard before it is seen.

The order of the film follows from this: problem, robot, console, network, odds, drone, every tool, and only then the search, which is
the climax, then the proof, then the question again, over the picture the film began with.

The first shot (`tools/buried/`) is a point of view, not a view: the film begins where the person it looks for is. The room is never seen
from outside, the table is always the top of the frame, and the light goes out on the third beat. The same room comes back twice, each time
with more light: daylight, then a searchlight. The search is the light getting in.

The opening dive (`tools/dive/`) is drawn, not found: NASA's true-colour Earth of 26 August 2026 with that day's clouds, the sun where it
stood at 04:00 UTC, real terrain, satellite imagery of the village (Esri, Maxar) and 502 houses fitted to its roofs. The flood water is
drawn, and the film says so. The film ends the way it began: the Earth goes back into the O.
