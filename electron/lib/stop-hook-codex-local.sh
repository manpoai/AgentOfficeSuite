#!/bin/bash
# AOSE Stop hook for Codex CLI (local App mode).
# Codex hooks output JSON to stdout: {"decision":"block","reason":"..."}

INPUT=$(cat)

STOP_HOOK_ACTIVE=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('stop_hook_active','false'))" 2>/dev/null)
if [ "$STOP_HOOK_ACTIVE" = "true" ] || [ "$STOP_HOOK_ACTIVE" = "True" ]; then
  echo '{"decision":"approve"}'
  exit 0
fi

AGENT_NAME="${AOSE_AGENT_NAME:-$(basename "$PWD")}"
INBOX_FILE="$HOME/.aose/inbox/$AGENT_NAME.jsonl"

if [ ! -f "$INBOX_FILE" ]; then
  echo '{"decision":"approve"}'
  exit 0
fi

LINE=$(head -1 "$INBOX_FILE" 2>/dev/null)
if [ -z "$LINE" ]; then
  echo '{"decision":"approve"}'
  exit 0
fi

tail -n +2 "$INBOX_FILE" > "$INBOX_FILE.tmp" && mv "$INBOX_FILE.tmp" "$INBOX_FILE"

CONTENT=$(echo "$LINE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('content',''))" 2>/dev/null)
if [ -z "$CONTENT" ]; then
  CONTENT="$LINE"
fi

echo "{\"decision\":\"block\",\"reason\":$(python3 -c "import sys,json; print(json.dumps(sys.argv[1]))" "$CONTENT")}"
exit 0
