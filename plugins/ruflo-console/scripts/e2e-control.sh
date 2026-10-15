#!/usr/bin/env bash
# Live end-to-end check of ADR-444: a real Claude (haiku, capped) drives the console through its console_* tools.
#
#   RUFLO_E2E_LIVE=1 bash plugins/ruflo-console/scripts/e2e-control.sh
#
# It spends a few cents (four short headless runs, --max-budget-usd 0.50 each). Without RUFLO_E2E_LIVE=1 (or a claude binary) it prints SKIP
# and exits 0, so CI can run it everywhere. Live, it copies ~/.claude/.credentials.json into an isolated CLAUDE_CONFIG_DIR (never the
# real ~/.claude) and shreds it on exit, as e2e.sh does. The project is a throwaway folder; nothing in the repo is written.
#
# Runs, each a separate Claude session whose SAVED control setting is the one shown (RUFLO_CONSOLE_CONTROL can only lower a saved level, so it
# cannot turn control on; the script seeds the isolated config's plugin store instead):
#   A  (unset)      control is off: the console's tools do not exist for the model
#   B  read         it can read and open pages; filling a field is refused with the level it needs
#   C  write:auto   it opens Missions, sets a goal (the console plans it) and runs mission-create: Claude's own call confirms it
#   D  write:ask    the same steps; mission-create waits for the person and is NOT confirmed by Claude
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(cd "$HERE/.." && pwd)"
BASE="${RUFLO_E2E_DIR:-${TMPDIR:-/tmp}/ruflo-console-e2e}"
OUT="$BASE/$(date +%Y%m%dT%H%M%S)-control"
CLAUDE="${CLAUDE_BIN:-$HOME/.local/bin/claude}"

if [[ "${RUFLO_E2E_LIVE:-0}" != 1 || ! -x "$CLAUDE" ]]; then
  echo "SKIP e2e-control: set RUFLO_E2E_LIVE=1 with a claude binary at \$CLAUDE_BIN or ~/.local/bin/claude"
  exit 0
fi

mkdir -p "$OUT"
FAILED=0
CFG=""
TARGET=control
CLI=true
# shellcheck source=e2e-lib.sh
source "$HERE/e2e-lib.sh"
trap 'shred_config' EXIT

PROJECT="$(mktemp -d "$OUT/project.XXXX")"
mkdir -p "$PROJECT/.claude-flow"
make_config "$PROJECT"

TOOLS="mcp__ruflo-console__console_state,mcp__ruflo-console__console_open,mcp__ruflo-console__console_set,mcp__ruflo-console__console_run"

# run NAME CONTROL PROMPT: one headless session; the transcript (stream-json) lands in $OUT/NAME.jsonl.
run() {
  local name="$1" control="$2" prompt="$3"
  mkdir -p "$CFG/plugins/store"
  node -e 'const [level, confirm] = (process.argv[1] || "off:auto").split(":"); require("node:fs").writeFileSync(process.argv[2], JSON.stringify({ "ai-prefs": { modelControl: level, modelConfirm: confirm || "auto" } }))' "$control" "$CFG/plugins/store/ruflo-console_inline-b43d4e31bb1a.json"
  (cd "$PROJECT" && env CLAUDE_CONFIG_DIR="$CFG" timeout 240 "$CLAUDE" -p --model haiku --max-budget-usd 0.50 \
    --plugin-dir "$PLUGIN" --allowedTools "$TOOLS" --disallowedTools Bash,Write,Edit,NotebookEdit --output-format stream-json --verbose --debug-file "$OUT/$name.log" "$prompt" </dev/null >"$OUT/$name.jsonl" 2>"$OUT/$name.err")
}

# transcript NAME: one line per console tool call and per result, for the assertions below.
transcript() {
  node - "$OUT/$1.jsonl" <<'NODE'
const lines = require('node:fs').readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
const names = new Map()
for (const m of lines) {
  const content = m.message && m.message.content
  if (!Array.isArray(content)) continue
  for (const b of content) {
    if (b.type === 'tool_use' && b.name.startsWith('mcp__ruflo-console__')) { names.set(b.id, b.name.replace('mcp__ruflo-console__', '')); console.log(`CALL ${names.get(b.id)} ${JSON.stringify(b.input)}`) }
    if (b.type === 'tool_result' && names.has(b.tool_use_id)) console.log(`RESULT ${names.get(b.tool_use_id)} ${(typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).replace(/\n/g, ' ')}`)
  }
}
const r = lines.find(m => m.type === 'result')
console.log(`COST ${r ? r.total_cost_usd : '?'}`)
NODE
}

# attempt NAME CONTROL PROMPT: a run, then its transcript; if the model made no console call at all (a small model sometimes talks about the tools
# instead of calling them) it is run once more. A refusal or a wrong result is never retried: only an absent attempt.
attempt() {
  run "$1" "$2" "$3"
  transcript "$1" >"$OUT/$1.txt"
  if ! grep -q '^CALL' "$OUT/$1.txt"; then run "$1" "$2" "$3"; transcript "$1" >"$OUT/$1.txt"; fi
}

ASK="Use only the ruflo console tools (console_state, console_open, console_set, console_run). Do the steps in order and report the exact results."

# A: off
run A "" "Look for tools named console_state, console_open, console_set or console_run. If none exist reply exactly TOOL MISSING. Do not use Bash."
transcript A >"$OUT/A.txt"
check A1 "control off: no console tool is callable" "A.txt" bash -c "! grep -q '^CALL' '$OUT/A.txt'"

# B: read
attempt B "read" "$ASK 1) console_state. 2) console_open view=overview. 3) console_set field=goal value='x'."
check B1 "read: console_state answers with the page" "B.txt" grep -q 'RESULT console_state {"view"' "$OUT/B.txt"
check B2 "read: console_open opens a page" "B.txt" grep -q 'RESULT console_open Opened' "$OUT/B.txt"
check B3 "read: console_set is refused and names the level it needs" "B.txt" grep -q 'RESULT console_set Refused: console_set needs the "write" level' "$OUT/B.txt"

# C: write, auto
attempt C "write:auto" "$ASK 1) console_open view=missions. 2) console_set field=goal value='add a dark mode toggle'. 3) console_run id=mission-create. 4) console_state."
check C1 "write: the goal is set" "C.txt" grep -q 'RESULT console_set Set goal' "$OUT/C.txt"
check C2 "write: the console planned it (state shows the goal)" "C.txt" grep -q 'RESULT console_state .*dark mode toggle' "$OUT/C.txt"
check C3 "write+auto: Claude's own call ran mission-create (Done or Failed, never Waiting)" "C.txt" grep -qE 'RESULT console_run (Done|Failed): create the mission' "$OUT/C.txt"
check C4 "write+auto: no billed guidance turn was queued behind the goal" "C.txt" bash -c "! grep -q 'guidance on this mission' '$OUT/C.txt'"

# D: write, ask
attempt D "write:ask" "$ASK 1) console_open view=missions. 2) console_set field=goal value='add a dark mode toggle'. 3) console_run id=mission-create. 4) console_state."
check D1 "ask: mission-create waits for the person" "D.txt" grep -q 'RESULT console_run Waiting for the person to confirm' "$OUT/D.txt"
check D2 "ask: Claude never confirmed it (no Done/Failed for mission-create)" "D.txt" bash -c "! grep -qE 'RESULT console_run (Done|Failed)' '$OUT/D.txt'"
check D3 "ask: the state names what is waiting" "D.txt" grep -q '"waiting":{' "$OUT/D.txt"

for name in A B C D; do printf '%s cost: %s\n' "$name" "$(grep '^COST' "$OUT/$name.txt" | head -1)"; done
write_results
echo "evidence: $OUT"
[[ "$FAILED" -eq 0 ]]
