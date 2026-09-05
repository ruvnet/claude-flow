#!/usr/bin/env bash
# Structural smoke test for ruflo-autopilot v0.2.1 (ADR-0001).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.2.1 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.2.1" ]]; then
  bad "expected 0.2.1, got '$v'"
else
  miss=""
  for k in prediction progress-tracking cache-aware mcp; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 10 autopilot_* MCP tools referenced in plugin docs"
miss=""
for t in autopilot_status autopilot_enable autopilot_disable autopilot_config autopilot_reset autopilot_log autopilot_progress autopilot_learn autopilot_history autopilot_predict; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "3. both skills present with valid frontmatter"
miss=""
for s in autopilot-loop autopilot-predict; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. both commands present (/autopilot + /autopilot-status)"
[[ -f "$ROOT/commands/autopilot.md" ]] && [[ -f "$ROOT/commands/autopilot-status.md" ]] \
  && ok || bad "command files missing"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. README documents 270s cache-aware ScheduleWakeup"
grep -qE "270 ?s|270 second" "$ROOT/README.md" \
  && grep -qE "cache|prompt cache" "$ROOT/README.md" \
  && ok || bad "cache-aware 270s note missing"

step "8. autopilot-patterns namespace claimed"
grep -q "autopilot-patterns" "$ROOT/README.md" \
  && ok || bad "autopilot-patterns namespace not claimed in README"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-autopilot-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "10. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
