#!/bin/bash
# Launch one headless Claude Code CLI agent in code mode on a brief. Usage: tools/agent.sh <brief-name> [model]
# The agent inherits the user's own Claude settings (permission mode, plugins); the only flag added is the
# code-mode environment switch the user already uses, which `claude -p` reads from --settings.
cd "$(dirname "$0")/.." || exit 1
name="$1"; model="${2:-fable}"
mkdir -p orchestration/logs
exec env -i HOME="$HOME" USER="$USER" PATH="$PATH" SHELL=/bin/zsh TERM=xterm-256color LANG=en_US.UTF-8 TMPDIR="${TMPDIR:-/tmp}" \
  claude -p --model "$model" --settings '{"env":{"CLAUDE_CODE_EXPERIMENTAL_CODE_MODE":"1"}}' \
  --output-format stream-json --verbose \
  < "orchestration/briefs/$name.md" > "orchestration/logs/$name.jsonl" 2> "orchestration/logs/$name.err"
