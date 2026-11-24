#!/usr/bin/env python3
"""Show what each agent is doing in its latest run: last activity, tool calls, cost, and the final result if finished."""
import glob, json, os, re, sys, time
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'orchestration', 'logs')
latest = {}
for f in glob.glob(os.path.join(d, '*.jsonl')):
    m = re.match(r'(.+?)(?:\.(r|compact)(\d+)|\.compact)?\.jsonl$', os.path.basename(f))
    name, kind = m.group(1), (m.group(2) or ('compact' if '.compact' in f else ''))
    if name not in latest or os.path.getmtime(f) >= os.path.getmtime(latest[name][0]):
        latest[name] = (f, kind)
total = 0
for name, (f, kind) in sorted(latest.items()):
    tools, last, result, cost, text = 0, '', None, None, ''
    for line in open(f, errors='replace'):
        try: m = json.loads(line)
        except ValueError: continue
        if m.get('type') == 'assistant':
            for c in m.get('message', {}).get('content', []):
                if c.get('type') == 'tool_use': tools += 1; last = c.get('name', '') + ' ' + json.dumps(c.get('input', {}))[:90]
                elif c.get('type') == 'text' and c.get('text', '').strip(): last = c['text'].strip().replace('\n', ' ')[:120]
        elif m.get('type') == 'result': result = m.get('subtype'); cost = m.get('total_cost_usd'); text = m.get('result') or ''
    age = int(time.time() - os.path.getmtime(f))
    if re.search("hit your .* limit", text): result = 'LIMIT'
    run = os.path.basename(f)[len(name) + 1:-6] or 'r1'
    state = 'compacting' if kind == 'compact' and not result else ('compacted' if kind == 'compact' else ('DONE' if result == 'success' else result) if result else ('active' if age < 300 else f'quiet {age}s'))
    total += cost or 0
    print(f"{name:20s} {run:9s} {state:11s} tools={tools:4d} {('$%.2f' % cost) if cost else '':8s} {last}")
print(f'finished runs shown cost ${total:.2f}')
