#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.2.1 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.2.1" ]]; then bad "expected 0.2.1, got '$v'"; else
  miss=""
  for k in neural-trader-runtime walk-forward monte-carlo; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 9 skills present with valid frontmatter (6 base + trader-cloud-backtest ADR-117 + trader-portfolio-cg ADR-126 Phase 3 + trader-explain ADR-126 Phase 6)"
miss=""
for s in trader-backtest trader-portfolio trader-regime trader-risk trader-signal trader-train trader-cloud-backtest trader-portfolio-cg trader-explain; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
# the cloud-backtest skill must reference the managed_agent_* tools + offer the local fallback
grep -q 'managed_agent_create' "$ROOT/skills/trader-cloud-backtest/SKILL.md" 2>/dev/null || miss="$miss cloud-no-managed-tool-ref"
grep -q 'trader-backtest' "$ROOT/skills/trader-cloud-backtest/SKILL.md" 2>/dev/null || miss="$miss cloud-no-local-fallback-ref"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. all 4 agents present"
miss=""
for a in backtest-engineer market-analyst risk-analyst trading-strategist; do
  [[ -f "$ROOT/agents/$a.md" ]] || miss="$miss missing-$a"
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. command present"
[[ -f "$ROOT/commands/trader.md" ]] && ok || bad "trader command missing"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README pins neural-trader runtime"
grep -qE "npx neural-trader|Rust/NAPI" "$ROOT/README.md" \
  && ok || bad "neural-trader runtime pin missing"

step "7. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "8. all 5 canonical namespaces claimed (trading-strategies/-backtests/-risk/-analysis/-signals per ADR-126)"
F="$ROOT/README.md"
miss=""
for ns in trading-strategies trading-backtests trading-risk trading-analysis trading-signals; do
  grep -q "$ns" "$F" || miss="$miss $ns"
done
[[ -z "$miss" ]] && ok || bad "missing namespace claims:$miss"

step "9. backtesting features documented (walk-forward, Monte Carlo, parameter optimization)"
F="$ROOT/README.md"
miss=""
grep -q "Walk-forward\|walk-forward" "$F" || miss="$miss walk-forward"
grep -q "Monte Carlo\|monte-carlo" "$F" || miss="$miss monte-carlo"
grep -q "Parameter optimization\|parameter optimization\|param-optimize" "$F" || miss="$miss param-opt"
[[ -z "$miss" ]] && ok || bad "$miss"

step "10. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-neural-trader-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "11. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
