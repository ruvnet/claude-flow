#!/bin/bash
# Enhanced PreToolUse hook for Git commit commands
# Automatically formats commit messages with branch info and conventional commit prefixes

# Read incoming tool input JSON from stdin
INPUT=$(cat)

# Parse the command
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Skip if not a git commit command
if ! echo "$COMMAND" | grep -q "git commit"; then
  echo "$INPUT"
  exit 0
fi

# Extract current commit message
COMMIT_MSG=$(echo "$COMMAND" | grep -oP '(?<=-m\s")[^"]*' || echo "$COMMAND" | grep -oP "(?<=-m\s')[^']*" || echo "")

# Skip if no commit message or already formatted
if [ -z "$COMMIT_MSG" ] || echo "$COMMIT_MSG" | grep -qE "^\[(feat|fix|docs|style|refactor|test|chore|perf)\]"; then
  echo "$INPUT"
  exit 0
fi

# Get current branch name
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")

# Initialize modified message
MODIFIED_MSG="$COMMIT_MSG"
FORMATTING_NOTE=""

# 1. EXTRACT JIRA TICKET from branch name (e.g., feature/PROJ-123-description -> PROJ-123)
TICKET=""
if echo "$BRANCH" | grep -qE "^(feature|bugfix|hotfix)/[A-Z]+-[0-9]+"; then
  TICKET=$(echo "$BRANCH" | grep -oE "[A-Z]+-[0-9]+" | head -n 1)
fi

# 2. DETECT CONVENTIONAL COMMIT TYPE from message content
TYPE=""
if echo "$COMMIT_MSG" | grep -qiE "^(add|implement|create|new)"; then
  TYPE="feat"
elif echo "$COMMIT_MSG" | grep -qiE "^(fix|resolve|patch|correct)"; then
  TYPE="fix"
elif echo "$COMMIT_MSG" | grep -qiE "^(update|modify|change|improve)"; then
  TYPE="refactor"
elif echo "$COMMIT_MSG" | grep -qiE "^(doc|documentation|readme)"; then
  TYPE="docs"
elif echo "$COMMIT_MSG" | grep -qiE "^(test|testing|spec)"; then
  TYPE="test"
elif echo "$COMMIT_MSG" | grep -qiE "^(style|format|lint)"; then
  TYPE="style"
elif echo "$COMMIT_MSG" | grep -qiE "^(perf|optimize|speed)"; then
  TYPE="perf"
elif echo "$COMMIT_MSG" | grep -qiE "^(chore|build|ci|deps)"; then
  TYPE="chore"
else
  TYPE="chore"  # Default
fi

# 3. FORMAT MESSAGE: [type] message (TICKET-123)
if [ -n "$TICKET" ]; then
  MODIFIED_MSG="[$TYPE] $COMMIT_MSG ($TICKET)"
  FORMATTING_NOTE="[Auto-formatted with type and ticket from branch $BRANCH]"
else
  MODIFIED_MSG="[$TYPE] $COMMIT_MSG"
  FORMATTING_NOTE="[Auto-formatted with conventional commit type]"
fi

# 4. ADD Co-Authored-By for Claude Code
if ! echo "$COMMAND" | grep -q "Co-Authored-By: Claude"; then
  # Check if message already has heredoc format
  if echo "$COMMAND" | grep -q '<<'; then
    # Already using heredoc, modify it
    MODIFIED_COMMAND="$COMMAND"
  else
    # Convert to heredoc format for multi-line commit
    HEREDOC_MSG="${MODIFIED_MSG}

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>"

    # Replace the commit message with heredoc format
    MODIFIED_COMMAND=$(echo "$COMMAND" | sed "s|-m ['\"][^'\"]*['\"]|-m \"\$(cat <<'EOF'\n${HEREDOC_MSG}\nEOF\n)\"|")
  fi
else
  # Just update the message
  MODIFIED_COMMAND=$(echo "$COMMAND" | sed "s|-m ['\"][^'\"]*['\"]|-m \"${MODIFIED_MSG}\"|")
fi

# Output modified JSON
echo "$INPUT" | jq --arg cmd "$MODIFIED_COMMAND" --arg note "$FORMATTING_NOTE" \
  '.tool_input.command = $cmd | .tool_input.description = ((.tool_input.description // "") + " " + $note)'
