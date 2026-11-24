#!/usr/bin/env python3
"""after.py <agent> [--prompt file]: wait until that agent's running resume.py ends, then (with --prompt) send the next pass."""
import os, subprocess, sys, time
agent = sys.argv[1]
def busy():
    for l in subprocess.run(["ps", "-axo", "command"], capture_output=True, text=True).stdout.splitlines():
        w = l.split()
        if any(x.endswith("tools/resume.py") for x in w[:3]) and agent in w: return True
    return False
while busy(): time.sleep(15)
if len(sys.argv) > 3: sys.exit(subprocess.call([sys.executable, "tools/resume.py", agent, *sys.argv[2:]], env={**os.environ, "HOUND_AGENT_SLOTS": "26"}))
print(agent, "finished")
