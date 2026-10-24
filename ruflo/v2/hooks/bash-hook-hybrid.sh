#!/bin/bash
# Hybrid PreToolUse hook: Modifies input + calls npx for coordination

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  echo "$INPUT"
  exit 0
fi

MODIFIED_COMMAND="$COMMAND"
NOTES=""

# 1. Safety: Add -i flag to rm commands
if echo "$COMMAND" | grep -qE "^rm\s" && ! echo "$COMMAND" | grep -qE "\-(i|I)"; then
  MODIFIED_COMMAND=$(echo "$COMMAND" | sed 's/^rm /rm -i /')
  NOTES="$NOTES [Safety: Added -i flag]"
fi

# 2. Aliases
case "$COMMAND" in
  "ll"|"ll "*) MODIFIED_COMMAND=$(echo "$COMMAND" | sed 's/^ll/ls -lah/') ;;
  "la"|"la "*) MODIFIED_COMMAND=$(echo "$COMMAND" | sed 's/^la/ls -la/') ;;
esac

# 3. Path correction: redirect test files to /tmp
if echo "$COMMAND" | grep -qE ">\s*test.*\.(txt|log|tmp)" && ! echo "$COMMAND" | grep -q "/tmp/"; then
  MODIFIED_COMMAND=$(echo "$COMMAND" | sed -E 's|>\s*(test[^/]*\.(txt|log|tmp))|> /tmp/\1|')
  NOTES="$NOTES [Path: Redirected to /tmp]"
fi

# Call npx for coordination (in background, don't wait)
echo "$INPUT" | npx claude-flow@alpha hooks pre-task --description "Bash: $COMMAND" >/dev/null 2>&1 &

# Return modified JSON
if [ -n "$NOTES" ]; then
  echo "$INPUT" | jq --arg cmd "$MODIFIED_COMMAND" --arg notes "$NOTES" \
    '.tool_input.command = $cmd | .modification_notes = $notes'
else
  echo "$INPUT" | jq --arg cmd "$MODIFIED_COMMAND" '.tool_input.command = $cmd'
fi
