# The opening dive

One unbroken shot, 8.75 seconds: the word HOUND with the Earth inside its O, through the O, down through real clouds, into a real valley.
`render.py film OUT.mp4` draws it (3840 × 2160, 60 frames a second, up to 30 pictures blended into each frame). `render.py end OUT.mp4`
flies the same camera back out for the last card.

Order: `fetch.py`, `fetch2.py` (pictures and terrain), `bake.py` (ground), `prep_day.py` (the Earth of 26 August 2026), `land.py`
(Earth mesh, river), `build.py` (houses), `title.py` (letters), `render.py`.

What is real: NASA VIIRS true colour and clouds of 26 August 2026, Blue Marble, Black Marble city lights, the sun's place at 04:00 UTC, the
terrain (Mapzen/AWS terrain tiles) and the satellite imagery of the village (Esri World Imagery, Maxar). What is drawn: the houses as
boxes fitted to the roofs in the imagery, the shape of the low clouds over the valley, and the flood water.

The pictures are not in this repository.
