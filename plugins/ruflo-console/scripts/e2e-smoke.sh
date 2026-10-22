#!/usr/bin/env bash
# A no-spend live smoke of every section against a real Claude Code: open each view with `/ruflo <view>`, wait for it to draw,
# and fail on a thrown render or a broken frame. It never presses Enter in Claude's own prompt except to submit a /ruflo slash
# command, takes no AI turn and writes no ruflo state.
#
#   RUFLO_E2E_LIVE=1 bash plugins/ruflo-console/scripts/e2e-smoke.sh
#
# Without RUFLO_E2E_LIVE=1 (or without the claude binary) it prints SKIP and exits 0, so CI can run it everywhere. Live, it copies
# ~/.claude/.credentials.json into an isolated CLAUDE_CONFIG_DIR (never the real ~/.claude) and shreds it on exit, as e2e.sh does.
# Evidence (one capture per view) lands in $RUFLO_E2E_DIR/<run>/screens.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$PLUGIN/../.." && pwd)"
BASE="${RUFLO_E2E_DIR:-${TMPDIR:-/tmp}/ruflo-console-e2e}"
OUT="$BASE/$(date +%Y%m%dT%H%M%S)-smoke"
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"
LIVE="${RUFLO_E2E_LIVE:-0}"

if [[ "$LIVE" != 1 || ! -x "$CLAUDE" ]]; then
  echo "SKIP e2e-smoke: set RUFLO_E2E_LIVE=1 with a claude binary at \$CLAUDE_BIN or ~/.local/bin/claude"
  exit 0
fi

mkdir -p "$OUT/screens"
FAILED=0
CFG=""
TARGET=smoke
CLI=true
PLUGINS=(--plugin-dir "$PLUGIN")
# shellcheck source=e2e-lib.sh
source "$HERE/e2e-lib.sh"
trap 'tmux_stop; shred_config; write_results' EXIT

PROJ="$OUT/project"
mkdir -p "$PROJ" && git -C "$PROJ" init -q
make_config "$PROJ"
TMUX_SESSION="ruflo-smoke"
TMUX_COLUMNS=200
LOG="$OUT/claude-debug.log"
tmux_start "$PROJ" "$LOG" "${PLUGINS[@]}"
if ! settle_dialogs; then fail S0 "Claude Code reached its prompt" "$OUT/.settle.txt"; exit 1; fi
pass S0 "Claude Code reached its prompt" "tmux"

# Views and labels from the one source of truth.
mapfile -t VIEWS < <(grep -o "{ id: '[a-z]*', key: '[^']*', label: '[^']*'" "$PLUGIN/hooks/state.ts" | sed -E "s/\{ id: '([a-z]+)', key: '[^']*', label: '([^']*)'/\1|\2/")
[[ ${#VIEWS[@]} -ge 20 ]] || { fail S1 "read the view list from state.ts" "${#VIEWS[@]} found"; exit 1; }

BAD='TypeError|ReferenceError|Cannot read prop|\[object |ui\.render hook skipped|is not defined'
for entry in "${VIEWS[@]}"; do
  id="${entry%%|*}"
  label="${entry#*|}"
  # The Terminal and Skills views hold a focused field: Escape first, so the next slash command reaches Claude's own prompt.
  tmux_keys Escape
  sleep 1
  tmux_cmd "/ruflo $id"
  sleep 2
  tmux_shot "screens/$id"
  shot="$OUT/screens/$id.txt"
  # A capture that was not written is a failure, never a pass: grep on a missing file finds no error text.
  if [[ ! -s "$shot" ]]; then fail "V-$id" "/ruflo $id was captured" "screens/$id.txt"; continue; fi
  if grep -qiF -- "${label%% *}" "$shot"; then pass "V-$id" "/ruflo $id draws $label" "screens/$id.txt"; else fail "V-$id" "/ruflo $id draws $label" "screens/$id.txt"; fi
  if grep -qE "$BAD" "$shot"; then fail "V-$id" "no render error on screen ($id)" "screens/$id.txt"; else pass "V-$id" "no render error on screen ($id)" "screens/$id.txt"; fi
done

if grep -E "ruflo-console: .*(skipped|threw|refused|failed)" "$LOG" | grep -vE "fs\.(stat|list|read)" | grep -q .; then fail S9 "the debug log has no ruflo-console hook failure" "$LOG"; else pass S9 "the debug log has no ruflo-console hook failure" "$LOG"; fi

echo "evidence: $OUT"
exit "$FAILED"
