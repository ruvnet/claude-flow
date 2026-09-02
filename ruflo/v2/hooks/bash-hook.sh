#!/bin/bash
# Enhanced PreToolUse hook for Bash commands
# Modifies tool inputs for safety, aliases, and path correction

# Read incoming tool input JSON from stdin
INPUT=$(cat)

# Parse the command
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Skip if empty
if [ -z "$COMMAND" ]; then
  echo "$INPUT"
  exit 0
fi

# Initialize modified command
MODIFIED_COMMAND="$COMMAND"

# 1. SAFETY CHECKS - Add dry-run for destructive commands
if echo "$COMMAND" | grep -qE "^(rm|rmdir|mv|dd|mkfs|fdisk|shred|chmod\s.*-R|chown\s.*-R)" && ! echo "$COMMAND" | grep -q "\-\-dry-run"; then
  # For rm commands, add interactive flag
  if echo "$COMMAND" | grep -qE "^rm\s" && ! echo "$COMMAND" | grep -qE "\-(i|I)"; then
    MODIFIED_COMMAND=$(echo "$COMMAND" | sed 's/^rm /rm -i /')
    SAFETY_NOTE="[Safety: Added -i flag for interactive confirmation]"
  fi
fi

# 2. COMMAND ALIASES
case "$COMMAND" in
  "ll"|"ll "*)
    MODIFIED_COMMAND=$(echo "$COMMAND" | sed 's/^ll/ls -lah/')
    ;;
  "la"|"la "*)
    MODIFIED_COMMAND=$(echo "$COMMAND" | sed 's/^la/ls -la/')
    ;;
  "..")
    MODIFIED_COMMAND="cd .."
    ;;
  "...")
    MODIFIED_COMMAND="cd ../.."
    ;;
esac

# 3. PATH CORRECTION - Ensure commands use proper directory structure
# Redirect temp file operations to /tmp
if echo "$COMMAND" | grep -qE ">\s*test.*\.(txt|log|tmp|json|md)" && ! echo "$COMMAND" | grep -q "/tmp/"; then
  MODIFIED_COMMAND=$(echo "$COMMAND" | sed -E 's|>\s*(test[^/]*\.(txt|log|tmp|json|md))|> /tmp/\1|')
  PATH_NOTE="[Path correction: Redirected test file to /tmp/]"
fi

# 4. SECRET REDACTION - Warn about potential secrets in commands
if echo "$COMMAND" | grep -qE "(password|secret|token|key|api[-_]?key|auth)" && ! echo "$COMMAND" | grep -q "# SECRETS_OK"; then
  SECRET_NOTE="[Security: Command contains sensitive keywords. Add '# SECRETS_OK' to bypass]"
fi

# 5. AUTO-DEPENDENCY INSTALLATION - Detect missing commands and suggest installation
FIRST_CMD=$(echo "$COMMAND" | awk '{print $1}')
if [ -n "$FIRST_CMD" ] && ! command -v "$FIRST_CMD" >/dev/null 2>&1; then
  case "$FIRST_CMD" in
    jq|curl|wget|git|docker|node|npm|npx|python|python3|pip|pip3)
      INSTALL_NOTE="[Warning: '$FIRST_CMD' not found. Consider installing it first]"
      ;;
  esac
fi

# Prepare description for output
DESCRIPTION=""
[ -n "$SAFETY_NOTE" ] && DESCRIPTION="$SAFETY_NOTE"
[ -n "$PATH_NOTE" ] && DESCRIPTION="$DESCRIPTION $PATH_NOTE"
[ -n "$SECRET_NOTE" ] && DESCRIPTION="$DESCRIPTION $SECRET_NOTE"
[ -n "$INSTALL_NOTE" ] && DESCRIPTION="$DESCRIPTION $INSTALL_NOTE"

# Output modified JSON with optional description
if [ -n "$DESCRIPTION" ]; then
  echo "$INPUT" | jq --arg cmd "$MODIFIED_COMMAND" --arg desc "$DESCRIPTION" \
    '.tool_input.command = $cmd | .tool_input.description = ((.tool_input.description // "") + " " + $desc)'
else
  echo "$INPUT" | jq --arg cmd "$MODIFIED_COMMAND" '.tool_input.command = $cmd'
fi
