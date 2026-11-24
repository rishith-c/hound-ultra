You were stopped mid-work by a model usage limit (Fable ran out). You are now Claude Opus, resuming the same job in the
same session, at medium effort. Nothing was lost: everything on disk was committed as a snapshot. Same mission, same
standard, do not differ from it. No human is available: never ask, never wait, decide and build.

First, quickly: re-read {{BRIEF}}, docs/ARCHITECTURE.md (new section "Demo mode and Advanced mode"), the end of
docs/STYLE.md ("Demo mode: the film version"), and your note at the bottom of this message. Look at what is really on
disk in your files before you edit (a write may have failed just before the stop). If you own a file with a syntax
error or a missing module, fix that first.

THE OWNER'S LATEST WORDS (go through all of them again, ten times over):
"Make sure it looks stunning, use ultra high, super detail." "Ultra high graphics. It also should not be super
overloaded: an advanced mode shows all that, but only the sexy thing in the non-advanced demo." "GTA 6, Tesla FSD level
graphics and interactiveness." "The most hyper-realistic, elite thing." "Palantir Gotham should see this and be like: I
need to recruit him." "All animation, everything, ultra smooth." "I don't want it to look like AI-generated slop; it
should be high quality." "Most mind-boggling, what-the-f*** level, 1000x frontier." "It is too round and bouncy." "You
need to understand and know": so think about what would make someone stop and stare, and build that.

WHAT TO DELIVER NOW, in this order
1. Everything in your brief working, no console errors, no stubs, no missing modules, no placeholder text.
2. **Demo mode** exactly as ARCHITECTURE.md describes: one jaw-dropping hero that fills the stage, moves by itself within
   a second and needs no reading. Everything else is `.adv-only`. This is what judges see first. Spend the most care here.
3. Advanced mode: dense, aligned, calm, nothing clipped, nothing overlapping, hierarchy obvious in two seconds.
4. The finish pass: look at your Demo screenshot at full size and ask what a Rockstar art director or a Palantir designer
   would circle in red (flat lighting, plastic materials, empty black, clipped text, default-looking controls, motion
   that pops). Fix the five worst. Then look again.
5. Smoothness: `--do fps:3` at 60 in both modes while the hero animates. Never allocate in the frame loop; never animate
   layout; instance meshes; keep pixel ratio adaptive.
6. Write orchestration/reports/<agent>.md (ARCHITECTURE.md says what goes in it) and stop.

HOW TO WORK (the machine melted last time: load average 350)
- `tools/shoot.py` now serves the site itself and queues for a browser. Do NOT start servers, do NOT retry a slow call,
  run one shot at a time, and never loop over many. Use `--do` steps to get several pictures from one launch, and
  `--do fps:3`. Around 20 screenshots in total is plenty; look hard at each.
- If a file write fails because a hook timed out, just retry that single write once.
- Be economical: do not re-read files you already know, do not print large files, no long deliberation. Aim to finish in
  about 80 tool calls. Depth over breadth: a perfect hero beats three half-done extras.
- Run JavaScript checks inside `tools/shoot.py --do eval:`. Do not look for another JavaScript runtime (osascript and the
  like) to get round the blocked `node`.
- You own only your files. Requests for other files go in orchestration/requests/<agent>.md. No git, no deploy, no
  installs, no new downloads of third-party files. Labels and facts: docs/FACTS.md still rules; never invent a result.
- The glass token no longer blurs (blur over a live canvas cost frames); do not add backdrop-filter over 3-D.

**New, for every Demo chapter (23 Nov, 19:40):** the shell can now play the whole story by itself (`app/global/story.js`). When your film reaches the end of
its held last beat (before it loops), emit `ctx.bus.emit('chapter:done')` once per loop. Nothing else changes: if nobody is playing the story, your film
loops as before. Blue `.btn-primary` buttons inside a Demo chapter are now drawn quietly by the shell (one blue button per screen, in the dock).
