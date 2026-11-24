#!/usr/bin/env python3
"""Resume a stopped code-mode agent on Opus, with its whole session. Standard library only.

    python3 tools/resume.py <agent> [--model opus] [--effort medium] [--prompt file.md] [--no-compact]

Finds the agent's last session id in orchestration/logs, waits for one of HOUND_AGENT_SLOTS (default 8) places, compacts
the session when it is large (cheaper to continue), then sends orchestration/briefs/_resume.md + the agent's note from
orchestration/resume_notes.json (or --prompt). Output: orchestration/logs/<agent>.r<N>.jsonl.
With --fresh the agent starts a new session from its brief instead (used for agents that never ran).
"""
import argparse, fcntl, glob, json, os, re, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
LOGS = "orchestration/logs"


def slot(n):
    d = os.path.join(tempfile.gettempdir(), "hound-agent-slots")
    os.makedirs(d, exist_ok=True)
    while True:
        for i in range(n):
            f = open(os.path.join(d, f"{i}.lock"), "w")
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return f
            except OSError:
                f.close()
        time.sleep(2)


def last_session(agent):
    best = None
    for f in sorted(glob.glob(f"{LOGS}/{agent}.jsonl") + glob.glob(f"{LOGS}/{agent}.r*.jsonl"), key=os.path.getmtime):
        sid, ctx = None, 0
        for line in open(f, errors="replace"):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            sid = d.get("session_id") or sid
            if d.get("type") == "assistant":
                u = d["message"].get("usage") or {}
                c = sum(u.get(k) or 0 for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"))
                ctx = c or ctx
        if sid:
            best = (sid, ctx)
    return best or (None, 0)


def run(args, stdin, out):
    env = {"HOME": os.environ["HOME"], "USER": os.environ["USER"], "PATH": os.environ["PATH"], "SHELL": "/bin/zsh", "TERM": "xterm-256color",
           "LANG": "en_US.UTF-8", "TMPDIR": os.environ.get("TMPDIR", "/tmp")}
    with open(out + ".jsonl", "w") as o, open(out + ".err", "w") as e:
        p = subprocess.run(["claude", "-p", *args, "--settings", '{"env":{"CLAUDE_CODE_EXPERIMENTAL_CODE_MODE":"1"}}',
                            "--output-format", "stream-json", "--verbose"], input=stdin, text=True, stdout=o, stderr=e, env=env)
    return p.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("agent")
    ap.add_argument("--model", default="opus")
    ap.add_argument("--effort", default="medium")
    ap.add_argument("--prompt")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--no-compact", action="store_true")
    a = ap.parse_args()
    lock = slot(int(os.environ.get("HOUND_AGENT_SLOTS", "8")))
    base = ["--model", a.model, "--effort", a.effort]
    n = 1 + max([int(m.group(1)) for f in glob.glob(f"{LOGS}/{a.agent}.r*.jsonl") if (m := re.search(r"\.r(\d+)\.jsonl$", f))] or [1])
    out = f"{LOGS}/{a.agent}.r{n}"
    notes = json.load(open("orchestration/resume_notes.json"))
    brief = f"orchestration/briefs/{a.agent}.md"
    body = open(a.prompt).read() if a.prompt else open("orchestration/briefs/_resume.md").read().replace("{{BRIEF}}", brief) + "\n\n## Your own note from the orchestrator\n\n" + notes.get(a.agent, "Finish your brief.") + "\n"
    if a.fresh:
        code = run(base, open(brief).read() + "\n\n---\n\n" + body, out)
    else:
        sid, ctx = last_session(a.agent)
        if not sid:
            sys.exit(f"no session found for {a.agent}")
        if ctx > 120_000 and not a.no_compact:
            run(base + ["--resume", sid, "/compact Keep: every file written and its state, decisions, measured numbers and how they were measured, what is verified, what is broken or unfinished, exact next steps."], "", f"{LOGS}/{a.agent}.compact{n}")
        code = run(base + ["--resume", sid], body, out)
    del lock
    sys.exit(code)


main()
