#!/usr/bin/env bash
# Writes the engine's function-hooks declarations into .claude/types/, where
# tsconfig.json reads them. They are what `/plugin-types` writes; this fetches
# the copy Anthropic publishes beside its own mods (anthropics/claude-code,
# mods/types/claude-code.d.ts). The folder is gitignored: regenerate, never edit.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/.claude/types"
curl -fsSL https://raw.githubusercontent.com/anthropics/claude-code/main/mods/types/claude-code.d.ts \
  -o "$ROOT/.claude/types/claude-code.d.ts"
head -1 "$ROOT/.claude/types/claude-code.d.ts"
