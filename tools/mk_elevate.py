#!/usr/bin/env python3
"""Write an "elevation" brief: a ruthless critique-and-fix pass on one finished area.
usage: tools/mk_elevate.py <round-tag> <area-name> "<owned files/dirs>" "<urls to review>" ["extra notes"]"""
import sys, os
tag, area, files, urls = sys.argv[1:5]
extra = sys.argv[5] if len(sys.argv) > 5 else ''
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
text = f'''You are the most demanding reviewer this project will ever meet: a principal product designer from Palantir's
Gotham team, a Tesla vehicle-UI lead and a Rockstar art director in one person, and you can also write the code.
Repository: ~/Developer/hound-ultra . No human is available: never ask, never wait. Decide, fix, verify, report.
You were dispatched as a subagent for a specific task; do not run skills that end by asking for approval.

READ FIRST: docs/MISSION.md, docs/ARCHITECTURE.md, docs/FACTS.md, docs/STYLE.md, app/ui/tokens.css, app/ui/base.css,
app/ui/reference.html (if present), and orchestration/reports/ for the area below.

THE OWNER'S WORDS (take them seriously; they are examples of a standard, not a checklist):
"I want the best thing ever and you give me this... don't make this AI-generated slop. Ask if Palantir would accept
this work. I told you insane detail, ultra high everything." "I need the most hyper-realistic, elite thing. The
dashboard is too round and bouncy, just to name some stuff. This is not even close to what I am aiming for:
Palantir Gotham should see this and be like 'I need to recruit him'. Don't skimp on features." "I am not saying the
1,000,000,000 things that need to be changed; you need to understand and know."
That last line is your job description. He will not list the problems. You find all of them.

AREA: {area}
YOU NOW OWN: {files}   (the first builder is finished; these files are yours. Still never edit files outside them;
write requests for anything else to orchestration/requests/{tag}-{area}.md)
REVIEW AT: {urls}
{extra}

METHOD (three full rounds at least)
1. Experience it like a stranger and like an expert. With tools/shoot.py, capture every state: first load, each
   control used, each mode, the mission at several times (HOUND.sim.seek / setSpeed), empty, loading and error
   states, 1680x1000 and 1440x900 and 1920x1080. Open every screenshot with Read and study it at full attention.
   Click everything. Read every word.
2. Write orchestration/reviews/{tag}-{area}.md: a numbered list of EVERYTHING that falls short of the bar. Aim for
   60 or more concrete findings in round one. Look for: anything generic or template-like; weak hierarchy; cramped
   or loose spacing; misalignment by even a pixel; inconsistent radii, borders, type sizes or colours; text that
   is vague, long, jargon or untrue; charts without a point; 3-D that looks flat, plastic, empty or toy-like
   (lighting, materials, scale, detail, shadows, atmosphere, motion); animation that is floaty, bouncy, linear or
   purposeless; dead or confusing controls; missing states; anything slow; missing features from the brief in
   orchestration/briefs/ for this area; anything that breaks the honesty rules; console errors; keyboard traps;
   unlabelled controls. Rank by how much each hurts the first ten seconds and the judging rubric.
3. Fix them, largest impact first: do not just tweak, rebuild what is weak. Raise the ceiling as well as the
   floor: add the details an expert would notice and love.
4. Capture again, compare before and after side by side, and write the next round of findings. Repeat until a
   fresh, honest look finds nothing you would be embarrassed to show the Gotham team.
5. Finish with zero console errors and every feature in the area's brief present and working. Then append a
   section "Elevation {tag}" to orchestration/reports/{area}.md: what you changed, what you verified and how,
   and anything still not at the bar and why.

RULES: honesty rules in docs/FACTS.md are absolute. No git commit, push, deploy, npm or node. Use Python for
scripts; mv to ~/.Trash to delete. Use your tools in parallel; you may launch your own subagents for independent
parts and must check their work.
'''
os.makedirs(os.path.join(root, 'orchestration', 'briefs'), exist_ok=True)
os.makedirs(os.path.join(root, 'orchestration', 'reviews'), exist_ok=True)
name = f'{tag}-{area}'
open(os.path.join(root, 'orchestration', 'briefs', name + '.md'), 'w').write(text)
print(name)
