#!/usr/bin/env bash
# Type-checks the console: `tsc --noEmit -p plugins/ruflo-console` (ADR-473).
#
# tsconfig.json reads the ambient declarations (claude-code, claude-code-tools, claude-code-mcp) from .claude-plugin/types/.
# Claude Code writes that folder when it LOADS the plugin and it is gitignored, so a fresh clone or a git worktree has none and tsc stops
# at TS2688 "Cannot find type definition file for 'claude-code'" before it checks anything. This copies the folder from where it exists
# (first hit wins): $CLAUDE_CONSOLE_TYPES, the main checkout of this repository, the newest installed copy of the plugin. It never
# overwrites a folder that is already there.
#
#   scripts/typecheck.sh            tsc over hooks, types and tests
#   scripts/typecheck.sh --pretty   extra arguments go to tsc
set -euo pipefail

PLUGIN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEST="$PLUGIN/.claude-plugin/types"
NEED=(claude-code claude-code-tools claude-code-mcp)

complete() { local d="$1" n; for n in "${NEED[@]}"; do [ -f "$d/$n/index.d.ts" ] || return 1; done; }

if ! complete "$DEST"; then
  candidates=()
  [ -n "${CLAUDE_CONSOLE_TYPES:-}" ] && candidates+=("$CLAUDE_CONSOLE_TYPES")
  common="$(git -C "$PLUGIN" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [ -n "$common" ] && candidates+=("$(dirname "$common")/plugins/ruflo-console/.claude-plugin/types")
  while IFS= read -r installed; do candidates+=("$installed"); done < <(ls -dt "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/ruflo-console/*/.claude-plugin/types 2>/dev/null || true)

  found=""
  for c in "${candidates[@]}"; do
    if [ -d "$c" ] && [ "$(cd "$c" && pwd -P)" != "$DEST" ] && complete "$c"; then found="$c"; break; fi
  done

  if [ -z "$found" ]; then
    echo "typecheck: no .claude-plugin/types here and none to copy: load the plugin once in Claude Code, or set CLAUDE_CONSOLE_TYPES" >&2
    exit 2
  fi

  mkdir -p "$DEST"
  cp -rL "$found"/. "$DEST"/
  echo "typecheck: copied the ambient types from $found" >&2
fi

cd "$PLUGIN"
exec npx tsc --noEmit -p . "$@"
