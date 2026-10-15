#!/usr/bin/env bash
# Drive the console UI the way a person would, through its own model tools (ADR-444), from a headless Claude, and optionally assert
# what the UI answered.
#
#   RUFLO_E2E_LIVE=1 bash drive.sh [--expect REGEX]... <console-plugin-dir> <read|write|manage> "<what to do>" [extra plugin dirs...]
#
# Prints one CALL / RESULT line per console tool call (results cut at 4000 chars) and a final COST line.
# Exit: 0 ok · 1 no console tool call ran · 2 usage error (bad level, bad regex, bad CONSOLE_DRIVE_INSTALL) · 3 an --expect matched no RESULT · 4 install failed.
# Without RUFLO_E2E_LIVE=1 or a claude binary it prints SKIP and exits 0, so CI can call it everywhere. ~$0.10 per run (haiku, capped $0.40).
# The level is capped at manage and the run happens in a scratch project, so a drive can never spend money or delete anything.
# The saved control setting is seeded in an isolated, throwaway config dir (login copied 0600, shredded on exit), not taken from yours.
# CONSOLE_DRIVE_INSTALL=<marketplace-dir>:<plugin>@<marketplace> additionally registers that directory as a marketplace and installs the plugin
# (user scope) INSIDE the throwaway config only, so `claude plugin configure <plugin>@<marketplace>` (the Settings view's option rows) works.
# Your real ~/.claude plugins are never read or written. Exit 4 if the marketplace add or the install fails.
# CONSOLE_DRIVE_SEED=<dir> copies that directory into the scratch .claude-flow before the run (seed claims, mods, ...).
set -u
EXPECT=(); POS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --expect) [[ $# -ge 2 ]] || { echo "--expect needs a regex"; exit 2; }; EXPECT+=("$2"); shift 2 ;;
    --expect=*) EXPECT+=("${1#--expect=}"); shift ;;
    *) POS+=("$1"); shift ;;
  esac
done
[[ ${#POS[@]} -ge 3 ]] || { echo "usage: drive.sh [--expect REGEX]... <console-plugin-dir> <read|write|manage> \"<what to do>\" [extra plugin dirs...]"; exit 2; }
PLUG="${POS[0]}"; LEVEL="${POS[1]}"; ASK="${POS[2]}"; EXTRA_DIRS=("${POS[@]:3}")
case "$LEVEL" in read|write|manage) ;; *) echo "level must be read|write|manage (full is never allowed here)"; exit 2 ;; esac
for re in "${EXPECT[@]+"${EXPECT[@]}"}"; do
  node -e 'new RegExp(process.argv[1], "i")' "$re" 2>/dev/null || { echo "bad --expect regex: $re"; exit 2; }
done
INSTALL_DIR=""; INSTALL_ID=""
if [[ -n "${CONSOLE_DRIVE_INSTALL:-}" ]]; then
  INSTALL_DIR="${CONSOLE_DRIVE_INSTALL%:*}"; INSTALL_ID="${CONSOLE_DRIVE_INSTALL##*:}"
  [[ "$INSTALL_DIR" != "$CONSOLE_DRIVE_INSTALL" && -d "$INSTALL_DIR" && "$INSTALL_ID" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$ ]] \
    || { echo "CONSOLE_DRIVE_INSTALL must be <existing marketplace dir>:<plugin>@<marketplace>"; exit 2; }
  INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"
fi
CLAUDE="${CLAUDE_BIN:-$(command -v claude || echo "$HOME/.local/bin/claude")}"
if [[ "${RUFLO_E2E_LIVE:-0}" != 1 || ! -x "$CLAUDE" ]]; then
  echo "SKIP drive: set RUFLO_E2E_LIVE=1 with a claude binary on PATH or at \$CLAUDE_BIN"
  exit 0
fi

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/console-drive.XXXXXX")"; mkdir -p "$SCRATCH/.claude-flow"
[[ -n "${CONSOLE_DRIVE_SEED:-}" ]] && cp -r "$CONSOLE_DRIVE_SEED"/. "$SCRATCH/.claude-flow/" 2>/dev/null
TOOLS="mcp__ruflo-console__console_state,mcp__ruflo-console__console_open,mcp__ruflo-console__console_set,mcp__ruflo-console__console_run"
EXTRA=(); for d in "${EXTRA_DIRS[@]+"${EXTRA_DIRS[@]}"}"; do EXTRA+=(--plugin-dir "$d"); done
OUTJ="$SCRATCH/out.jsonl"; OUT="$SCRATCH"; CLI=true
# Control is seeded in an ISOLATED config dir (your login copied 0600, shredded on exit). RUFLO_CONSOLE_CONTROL may only LOWER the saved
# setting (ADR-450 T12), so it cannot make a drive run with auto confirm when the person's saved mode is "ask": seed the saved setting instead.
# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/e2e-lib.sh"
make_config "$SCRATCH"
trap 'shred_config 2>/dev/null; rm -rf "$CFG"' EXIT
if [[ -n "$INSTALL_ID" ]]; then
  # Only ever against the throwaway $CFG: CLAUDE_CONFIG_DIR is set on each call, never exported to the rest of the script.
  (cd "$SCRATCH" && CLAUDE_CONFIG_DIR="$CFG" "$CLAUDE" plugin marketplace add "$INSTALL_DIR" --scope user </dev/null >"$SCRATCH/install.txt" 2>&1 \
    && CLAUDE_CONFIG_DIR="$CFG" "$CLAUDE" plugin install "$INSTALL_ID" --scope user </dev/null >>"$SCRATCH/install.txt" 2>&1) \
    || { echo "install of $INSTALL_ID failed:"; tail -5 "$SCRATCH/install.txt"; exit 4; }
  echo "INSTALLED $INSTALL_ID (throwaway config only)"
fi
mkdir -p "$CFG/plugins/store"
node -e 'require("node:fs").writeFileSync(process.argv[1], JSON.stringify({ "ai-prefs": { modelControl: process.argv[2], modelConfirm: "auto" } }))' \
  "$CFG/plugins/store/ruflo-console_inline-b43d4e31bb1a.json" "$LEVEL"
(cd "$SCRATCH" && CLAUDE_CONFIG_DIR="$CFG" timeout 240 "$CLAUDE" -p "Use only the ruflo console tools (console_state, console_open, console_set, console_run). $ASK Report exactly what each tool answered." \
  --plugin-dir "$PLUG" "${EXTRA[@]+"${EXTRA[@]}"}" --allowedTools "$TOOLS" --disallowedTools Bash,Write,Edit,NotebookEdit --model haiku --max-budget-usd 0.40 \
  --output-format stream-json --verbose </dev/null >"$OUTJ" 2>"$SCRATCH/err.txt")
node - "$OUTJ" "${EXPECT[@]+"${EXPECT[@]}"}" <<'NODE'
const [file, ...expects] = process.argv.slice(2)
const lines = require('node:fs').readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)] } catch { return [] } })
const names = new Map(); const results = []; let calls = 0
for (const m of lines) for (const b of (m.message && Array.isArray(m.message.content) ? m.message.content : [])) {
  if (b.type === 'tool_use' && b.name.startsWith('mcp__ruflo-console__')) { calls++; names.set(b.id, b.name.slice(20)); console.log(`CALL ${names.get(b.id)} ${JSON.stringify(b.input)}`) }
  if (b.type === 'tool_result' && names.has(b.tool_use_id)) {
    const text = (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).replace(/\n/g, ' ').slice(0, 4000)
    results.push(text); console.log(`RESULT ${names.get(b.tool_use_id)} ${text}`)
  }
}
const r = lines.find(m => m.type === 'result'); console.log(`COST ${r ? r.total_cost_usd : '?'} CALLS ${calls}`)
if (calls === 0) process.exit(1)
let missed = 0
for (const e of expects) {
  const hit = results.some(t => new RegExp(e, 'i').test(t)); console.log(`${hit ? 'EXPECT ok' : 'EXPECT FAIL'} /${e}/`); if (!hit) missed++
}
process.exit(missed ? 3 : 0)
NODE
rc=$?; echo "scratch: $SCRATCH"; exit $rc
