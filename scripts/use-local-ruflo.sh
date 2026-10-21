#!/usr/bin/env bash
# Build the monorepo CLI and make the shell `ruflo` command use it.
#
# Usage (from repo root or anywhere):
#   ./scripts/use-local-ruflo.sh
#   ./scripts/use-local-ruflo.sh --skip-build   # only re-link
#
# After this:
#   which ruflo          → …/node_modules/ruflo → this repo's ruflo/bin/ruflo.js
#   ruflo --version
#   ruflo mcp tools | grep team_
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKIP_BUILD=0
for a in "$@"; do
  case "$a" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
  esac
done

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "==> Building @claude-flow/cli (+ workspace deps)…"
  (cd "$ROOT/v3" && pnpm --filter @claude-flow/cli... build)
else
  echo "==> Skipping build (--skip-build)"
fi

if [[ ! -f "$ROOT/v3/@claude-flow/cli/dist/src/index.js" ]]; then
  echo "error: CLI dist missing — build failed or was skipped without dist" >&2
  exit 1
fi

echo "==> npm link ruflo wrapper → global PATH"
(cd "$ROOT/ruflo" && npm link)

# Prefer nvm/global node bin over older pnpm global ruflo if both exist
RUFL0_BIN="$(command -v ruflo || true)"
echo ""
echo "ruflo → ${RUFL0_BIN:-not found}"
if [[ -n "$RUFL0_BIN" ]]; then
  # Resolve symlink chain target when possible
  if command -v realpath >/dev/null 2>&1; then
    echo "target → $(realpath "$RUFL0_BIN" 2>/dev/null || true)"
  fi
  ruflo --version
  if ruflo mcp tools 2>/dev/null | grep -q 'team_create'; then
    echo "OK: team_* tools present (local ADR-402 surface)"
  else
    echo "warn: team_create not listed — check CLI dist / mcp tools" >&2
  fi
fi

echo ""
echo "Grok MCP: \`node $ROOT/v3/@claude-flow/cli/bin/cli.js init --grok\` in a project writes this for you."
echo "To point an existing project .grok/config.toml [mcp_servers.ruflo] at this build:"
echo "  command = \"node\""
echo "  args = [\"$ROOT/v3/@claude-flow/cli/bin/cli.js\", \"mcp\", \"start\"]"
echo "Then restart Grok."
