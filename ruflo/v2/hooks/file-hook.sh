#!/bin/bash
# Enhanced PreToolUse hook for Write/Edit/MultiEdit commands
# Modifies file paths to enforce project organization

# Read incoming tool input JSON from stdin
INPUT=$(cat)

# Parse the file path (try different JSON paths)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty')

# Skip if empty
if [ -z "$FILE_PATH" ]; then
  echo "$INPUT"
  exit 0
fi

# Initialize
MODIFIED_PATH="$FILE_PATH"
SHOULD_MODIFY=false
MODIFICATION_NOTE=""

# 1. ROOT FOLDER PROTECTION - Never save working files to root
# Allow: package.json, tsconfig.json, .gitignore, .env.example, README.md, CLAUDE.md, LICENSE
# Disallow: test files, temporary files, code files in root
if [[ "$FILE_PATH" =~ ^[^/]*\.(js|ts|jsx|tsx|py|java|go|rs|cpp|c|h)$ ]] || \
   [[ "$FILE_PATH" =~ ^test.*\.(txt|log|tmp|json|md)$ ]] || \
   [[ "$FILE_PATH" =~ ^(temp|tmp|working).*$ ]]; then

  # Determine appropriate subdirectory
  case "$FILE_PATH" in
    test*.test.*|test*.spec.*|*.test.*|*.spec.*)
      MODIFIED_PATH="tests/$FILE_PATH"
      SHOULD_MODIFY=true
      MODIFICATION_NOTE="[Moved test file to /tests/ directory]"
      ;;
    test*.md|temp*.md|working*.md|scratch*.md)
      MODIFIED_PATH="docs/working/$FILE_PATH"
      SHOULD_MODIFY=true
      MODIFICATION_NOTE="[Moved working document to /docs/working/]"
      ;;
    *.js|*.ts|*.jsx|*.tsx)
      MODIFIED_PATH="src/$FILE_PATH"
      SHOULD_MODIFY=true
      MODIFICATION_NOTE="[Moved source file to /src/ directory]"
      ;;
    *.py)
      MODIFIED_PATH="src/$FILE_PATH"
      SHOULD_MODIFY=true
      MODIFICATION_NOTE="[Moved Python file to /src/ directory]"
      ;;
    temp*|tmp*|scratch*)
      MODIFIED_PATH="/tmp/$FILE_PATH"
      SHOULD_MODIFY=true
      MODIFICATION_NOTE="[Redirected temporary file to /tmp/]"
      ;;
  esac
fi

# 2. PATH CORRECTION - Ensure proper directory structure exists
if [ "$SHOULD_MODIFY" = true ]; then
  PARENT_DIR=$(dirname "$MODIFIED_PATH")
  if [ "$PARENT_DIR" != "." ] && [ "$PARENT_DIR" != "/" ]; then
    # Create directory structure if needed
    mkdir -p "/workspaces/claude-code-flow/$PARENT_DIR" 2>/dev/null || true
  fi
fi

# 3. AUTO-FORMAT DETECTION - Add format hint based on file type
FORMAT_NOTE=""
case "$MODIFIED_PATH" in
  *.ts|*.tsx|*.js|*.jsx)
    FORMAT_NOTE="[Auto-format: Prettier/ESLint recommended]"
    ;;
  *.py)
    FORMAT_NOTE="[Auto-format: Black/autopep8 recommended]"
    ;;
  *.go)
    FORMAT_NOTE="[Auto-format: gofmt recommended]"
    ;;
  *.rs)
    FORMAT_NOTE="[Auto-format: rustfmt recommended]"
    ;;
esac

# 4. LINTER CONFIG HINTS - Suggest linter configs for new files
LINTER_NOTE=""
if ! [ -f "$MODIFIED_PATH" ]; then
  case "$MODIFIED_PATH" in
    *.ts|*.tsx)
      if ! [ -f "tsconfig.json" ]; then
        LINTER_NOTE="[Tip: Consider creating tsconfig.json for TypeScript]"
      fi
      ;;
    *.py)
      if ! [ -f "pyproject.toml" ] && ! [ -f "setup.cfg" ]; then
        LINTER_NOTE="[Tip: Consider creating pyproject.toml for Python linting]"
      fi
      ;;
  esac
fi

# Combine notes
FULL_NOTE="$MODIFICATION_NOTE $FORMAT_NOTE $LINTER_NOTE"

# Output modified JSON
if [ "$SHOULD_MODIFY" = true ]; then
  # Update the file_path field
  if echo "$INPUT" | jq -e '.tool_input.file_path' >/dev/null 2>&1; then
    echo "$INPUT" | jq --arg path "$MODIFIED_PATH" --arg note "$FULL_NOTE" \
      '.tool_input.file_path = $path | .tool_input.description = ((.tool_input.description // "") + " " + $note)'
  else
    echo "$INPUT" | jq --arg path "$MODIFIED_PATH" --arg note "$FULL_NOTE" \
      '.tool_input.path = $path | .tool_input.description = ((.tool_input.description // "") + " " + $note)'
  fi
else
  # No modification, but add format/linter notes if present
  if [ -n "$FORMAT_NOTE" ] || [ -n "$LINTER_NOTE" ]; then
    echo "$INPUT" | jq --arg note "$FULL_NOTE" \
      '.tool_input.description = ((.tool_input.description // "") + " " + $note)'
  else
    echo "$INPUT"
  fi
fi
