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
  for k in mcp distributed-tracing anomaly-detection; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in observe-trace observe-metrics; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/observability-engineer.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/observe.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. observe-trace uses memory_* for namespaced reads"
F="$ROOT/skills/observe-trace/SKILL.md"
miss=""
grep -q "memory_search\|memory_list" "$F" || miss="$miss no-memory-load"
grep -qE 'agentdb_hierarchical-recall.+observability|observability.+agentdb_hierarchical-recall' "$F" && miss="$miss still-uses-hierarchical-recall"
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. observe-metrics uses memory_* for namespaced reads"
F="$ROOT/skills/observe-metrics/SKILL.md"
miss=""
grep -q "memory_search\|memory_list" "$F" || miss="$miss no-memory-load"
grep -qE 'agentdb_hierarchical-recall.+observability|observability.+agentdb_hierarchical-recall' "$F" && miss="$miss still-uses-hierarchical-recall"
[[ -z "$miss" ]] && ok || bad "$miss"

step "5. observe-metrics documents dual pattern-store path"
F="$ROOT/skills/observe-metrics/SKILL.md"
if grep -q "ReasoningBank" "$F" \
   && grep -q "memory_store --namespace observability" "$F"; then
  ok
else
  bad "missing dual-path documentation"
fi

step "6. /observe command covers 5 subcommands"
F="$ROOT/commands/observe.md"
miss=""
for sub in trace metrics logs dashboard correlate; do
  grep -q "$sub" "$F" || miss="$miss $sub"
done
[[ -z "$miss" ]] && ok || bad "missing subcommands:$miss"

step "7. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "8. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-observability-contract.md"
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
