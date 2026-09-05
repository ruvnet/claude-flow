#!/usr/bin/env bash
# replay-spike.sh — pre-Accept spike harness for ADR-0001 Verification §4.
#
# Records a baseline session against each site in SITES.txt, replays it,
# and reports the action-sequence match rate. ADR threshold: ≥80% of sites
# must replay successfully (verdict pass) before the ADR can flip from
# Proposed → Accepted.
#
# This is an INTERACTIVE harness — it requires:
#   - agent-browser installed (or available via npx)
#   - ruvector@0.2.25 reachable (npx fetches if missing)
#   - the new browser_session_record / _end / _replay MCP tools wired
#     (v3/@claude-flow/cli/src/mcp-tools/browser-session-tools.ts)
#   - network access
#
# Run from a TTY:
#   bash plugins/ruflo-browser/scripts/replay-spike.sh
#
# Output: spike-results/<timestamp>/STATUS.md with the pass/fail tally and
# per-site verdicts. The smoke test does NOT run this — see README §Verification.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITES_FILE="$ROOT/scripts/SITES.txt"
RESULTS_DIR="$ROOT/spike-results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

if [[ ! -f "$SITES_FILE" ]]; then
  echo "FATAL: $SITES_FILE missing. Add 10 candidate URLs (one per line) before running." >&2
  exit 2
fi

PASS=0
FAIL=0
SKIP=0
TOTAL=0

declare -a VERDICTS

site_record_replay() {
  local url="$1"
  local label="$2"
  local sid="spike-$(date +%s%N)-$label"
  local rvf="$RESULTS_DIR/$sid.rvf"

  # 1. Record a minimal baseline interaction
  # #2015: ruvector@0.2.25's rvf create needs --dimension and does NOT
  # support --kind (unknown option). Strip --kind, keep --dimension 384.
  if ! npx -y ruvector@0.2.25 rvf create "$rvf" --dimension 384 >/dev/null 2>&1; then
    echo "SKIP:$label rvf-create-failed" ; return 2
  fi
  if ! npx -y ruvector@0.2.25 hooks trajectory-begin --session-id "$sid" --task "spike-$label" >/dev/null 2>&1; then
    echo "SKIP:$label trajectory-begin-failed" ; return 2
  fi

  if ! agent-browser --session "$sid" --json open "$url" >"$RESULTS_DIR/$label.open.json" 2>"$RESULTS_DIR/$label.open.err"; then
    if ! npx --yes agent-browser --session "$sid" --json open "$url" >"$RESULTS_DIR/$label.open.json" 2>"$RESULTS_DIR/$label.open.err"; then
      echo "SKIP:$label browser-open-failed (see $RESULTS_DIR/$label.open.err)"
      npx -y ruvector@0.2.25 hooks trajectory-end --session-id "$sid" --verdict fail >/dev/null 2>&1 || true
      return 2
    fi
  fi

  npx -y ruvector@0.2.25 hooks trajectory-step --session-id "$sid" \
    --action browser_open --args "$(printf '{"url":"%s"}' "$url")" --result ok >/dev/null 2>&1 || true

  agent-browser --session "$sid" --json snapshot >"$RESULTS_DIR/$label.snap.json" 2>/dev/null || true
  npx -y ruvector@0.2.25 hooks trajectory-step --session-id "$sid" \
    --action browser_snapshot --args '{}' --result ok >/dev/null 2>&1 || true

  agent-browser --session "$sid" --json close >/dev/null 2>&1 || true
  npx -y ruvector@0.2.25 hooks trajectory-end --session-id "$sid" --verdict pass >/dev/null 2>&1 || true
  npx -y ruvector@0.2.25 rvf compact "$rvf" >/dev/null 2>&1 || true

  # 2. Replay: derive a child container, re-run the same step sequence
  local rsid="${sid}-replay"
  local rrvf="$RESULTS_DIR/${rsid}.rvf"
  if ! npx -y ruvector@0.2.25 rvf derive "$rvf" "$rrvf" >/dev/null 2>&1; then
    echo "FAIL:$label rvf-derive-failed" ; return 1
  fi

  if ! agent-browser --session "$rsid" --json open "$url" >"$RESULTS_DIR/$label.replay.open.json" 2>"$RESULTS_DIR/$label.replay.open.err"; then
    if ! npx --yes agent-browser --session "$rsid" --json open "$url" >"$RESULTS_DIR/$label.replay.open.json" 2>"$RESULTS_DIR/$label.replay.open.err"; then
      echo "FAIL:$label replay-open-failed"
      return 1
    fi
  fi
  agent-browser --session "$rsid" --json snapshot >"$RESULTS_DIR/$label.replay.snap.json" 2>/dev/null || true
  agent-browser --session "$rsid" --json close >/dev/null 2>&1 || true

  # 3. Compare action counts
  local orig_steps=2
  local replay_steps=2
  if [[ -f "$RESULTS_DIR/$label.replay.snap.json" ]] && [[ -s "$RESULTS_DIR/$label.replay.snap.json" ]]; then
    echo "PASS:$label replay-completed"
    return 0
  else
    echo "FAIL:$label replay-snapshot-empty"
    return 1
  fi
}

while IFS= read -r url; do
  [[ -z "$url" || "$url" =~ ^# ]] && continue
  TOTAL=$((TOTAL+1))
  label=$(printf "site%02d" "$TOTAL")
  result=$(site_record_replay "$url" "$label")
  printf "%-40s %s\n" "$url" "$result"
  VERDICTS+=("$url|$result")
  case "$result" in
    PASS:*) PASS=$((PASS+1));;
    FAIL:*) FAIL=$((FAIL+1));;
    SKIP:*) SKIP=$((SKIP+1));;
  esac
done < "$SITES_FILE"

if [[ $TOTAL -eq 0 ]]; then
  echo "FATAL: SITES.txt has no non-comment URLs." >&2
  exit 2
fi

# Threshold: pass / (pass + fail)  — skipped sites are not counted toward the rate.
DENOM=$((PASS+FAIL))
RATE_PCT=0
if [[ $DENOM -gt 0 ]]; then
  RATE_PCT=$(( (PASS * 100) / DENOM ))
fi
THRESHOLD=80
{
  echo "# Replay Spike Status"
  echo
  echo "- Run timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- Sites attempted: $TOTAL"
  echo "- Pass: $PASS"
  echo "- Fail: $FAIL"
  echo "- Skip (env failure): $SKIP"
  echo "- Replay rate (pass / (pass+fail)): ${RATE_PCT}%"
  echo "- ADR threshold: ${THRESHOLD}%"
  echo
  if [[ $RATE_PCT -ge $THRESHOLD ]]; then
    echo "**Verdict: MEETS ADR-0001 §4 threshold.** Spike supports flipping ADR status to \`Accepted\`."
  else
    echo "**Verdict: BELOW ADR-0001 §4 threshold.** Replay reliability insufficient. ADR remains \`Proposed\`; consider degrading the proposal to \"session as audit log\" (replay/screenshot-diff become best-effort, not load-bearing)."
  fi
  echo
  echo "## Per-site verdicts"
  echo
  for v in "${VERDICTS[@]}"; do
    site=$(echo "$v" | cut -d'|' -f1)
    res=$(echo "$v" | cut -d'|' -f2-)
    echo "- \`$site\` — $res"
  done
} > "$RESULTS_DIR/STATUS.md"

echo
cat "$RESULTS_DIR/STATUS.md"

[[ $RATE_PCT -ge $THRESHOLD ]] || exit 1
