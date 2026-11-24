#!/usr/bin/env python3
"""Show what each launched agent is doing: last activity, tool calls so far, and the final result if finished."""
import json, os, sys, time, glob
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'orchestration', 'logs')
for f in sorted(glob.glob(os.path.join(d, '*.jsonl'))):
    name = os.path.basename(f)[:-6]; tools = 0; last = ''; result = None; cost = None
    try:
        for line in open(f, errors='replace'):
            try: m = json.loads(line)
            except Exception: continue
            if m.get('type') == 'assistant':
                for c in m.get('message', {}).get('content', []):
                    if c.get('type') == 'tool_use': tools += 1; last = c.get('name', '') + ' ' + json.dumps(c.get('input', {}))[:90]
                    elif c.get('type') == 'text' and c.get('text', '').strip(): last = c['text'].strip().replace('\n', ' ')[:110]
            elif m.get('type') == 'result': result = m.get('subtype'); cost = m.get('total_cost_usd')
    except FileNotFoundError: continue
    age = int(time.time() - os.path.getmtime(f))
    state = ('DONE:' + str(result)) if result else ('active' if age < 240 else f'quiet {age}s')
    print(f'{name:22s} {state:14s} tools={tools:4d}  {last}')
    if result and '-v' in sys.argv:
        pass
