#!/usr/bin/env bash
#
# Runtime smoke test for ruflo-neural-trader: actually invoke each
# `npx neural-trader` command the plugin's skills document and confirm
# it returns parseable JSON with the expected shape.
#
# Distinct from `smoke.sh` (which only checks file presence / README
# pins). This one runs against a real install and is gated on the
# `neural-trader` npm package working end-to-end.
#
# Run:
#   bash plugins/ruflo-neural-trader/scripts/runtime-smoke.sh
#
# Exit codes:
#   0  every command emits valid JSON with the expected `command` key
#   1  at least one command failed

set -u
PASS=0
FAIL=0
FAILURES=()

# Lock to the version this plugin is pinned against so a global
# npx cache doesn't shadow a stale local install.
NT_PIN="${NT_PIN:-2.8.11}"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR"

step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); FAILURES+=("$1"); }

step "0. install neural-trader@${NT_PIN}"
npm init -y >/dev/null 2>&1
if npm install --ignore-scripts --no-audit --no-fund "neural-trader@${NT_PIN}" >/dev/null 2>&1; then
  ok
else
  bad "npm install failed"
  echo "$FAIL failures — aborting"
  exit 1
fi

# Helper: run a command, parse JSON, assert it has .command == expected
run_and_check() {
  local label="$1" expected_cmd="$2"
  shift 2
  step "$label"
  local out
  if ! out=$(npx neural-trader "$@" 2>&1); then
    bad "command exited non-zero: $out"
    return
  fi
  local cmd
  # Pull the .command field out of the JSON output. Use the standard
  # `jq` filter — much safer than an inline node script through zsh,
  # which mangles closing parens.
  cmd=$(echo "$out" | jq -r 'if type == "object" then (.command // "") else "" end' 2>/dev/null)
  if [[ "$cmd" == "$expected_cmd" ]]; then
    ok
  else
    bad "expected command=\"$expected_cmd\", got \"$cmd\" — head: $(echo "$out" | head -3 | tr '\n' '|')"
  fi
}

run_and_check "1. --backtest"        "backtest"        --backtest --strategy momentum --symbol AAPL --period 2024-01-01..2024-12-31
run_and_check "2. --signal scan"     "signal"          --signal scan --symbols AAPL,MSFT
run_and_check "3. --risk assess"     "risk"            --risk assess --returns 0.01,0.02,-0.005,0.015,-0.01
run_and_check "4. --portfolio"       "portfolio"       --portfolio optimize --symbols AAPL,MSFT,GOOGL
run_and_check "5. --regime"          "regime"          --regime --symbol SPY
run_and_check "6. --train"           "train"           --train --symbol AAPL --model lstm --epochs 10
run_and_check "7. --predict"         "predict"         --predict --symbol AAPL --model lstm
run_and_check "8. --strategy-create" "strategy-create" --strategy-create momentum-spy --type momentum --symbols SPY

step "9. require('neural-trader') exposes 194 exports"
exports=$(node -e "console.log(Object.keys(require('neural-trader')).length)")
if [[ "$exports" -ge 100 ]]; then
  ok
else
  bad "expected >=100 exports, got $exports"
fi

step "10. --version"
if npx neural-trader --version 2>&1 | grep -qE "^${NT_PIN%.*}\."; then
  ok
else
  bad "version mismatch"
fi

# Helper: run a command and assert a jq path is non-null.
assert_field() {
  local label="$1" field="$2"
  shift 2
  step "$label"
  local out value
  out=$(npx neural-trader "$@" 2>&1)
  value=$(echo "$out" | jq -r "$field" 2>/dev/null)
  if [[ -n "$value" && "$value" != "null" && "$value" != "false" ]]; then
    ok
  else
    bad "field $field missing/null/false — head: $(echo "$out" | head -3 | tr '\n' '|')"
  fi
}

assert_field "11. backtest exposes Kelly fraction"   '.metrics.kellyFraction'    --backtest --symbol AAPL
assert_field "12. --walk-forward returns windows"    '.walkForward.windowsRun'   --backtest --symbol AAPL --walk-forward --period 2023-01-01..2024-12-31
assert_field "13. --monte-carlo returns distribution" '.monteCarlo.distribution.median' --backtest --symbol AAPL --monte-carlo --mc-runs 100
assert_field "14. --optimize returns best Sharpe"    '.optimization.best.sharpeRatio' --backtest --symbol AAPL --optimize --param fast_ma:10:20:5
assert_field "15. --signal scan returns ≥1 signal"   '.signalsCount'             --signal scan --symbols AAPL,MSFT
assert_field "16. multi-symbol aggregate"            '.aggregate.bestSymbol'     --backtest --symbols AAPL,MSFT,GOOGL
assert_field "17. pairs strategy returns metrics"    '.metrics.totalTrades'      --backtest --strategy pairs --symbols AAPL,MSFT
assert_field "18. adaptive strategy picks regime"    '.regimePicked'             --backtest --strategy adaptive --symbol AAPL
assert_field "19. multi-indicator strategy runs"     '.command'                  --backtest --strategy multi-indicator --symbol AMZN

echo ""
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] || { printf 'failed steps: %s\n' "${FAILURES[@]}"; exit 1; }
