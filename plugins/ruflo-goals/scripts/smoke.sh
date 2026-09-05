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
  for k in mcp evidence-grading legacy-namespaces; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 5 skills + 4 agents + 1 command present"
miss=""
for s in deep-research goal-plan horizon-track research-synthesize dossier-collect; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-skill-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
for a in goal-planner deep-researcher horizon-tracker dossier-investigator; do
  [[ -f "$ROOT/agents/$a.md" ]] || miss="$miss missing-agent-$a"
done
[[ -f "$ROOT/commands/goals.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. selection guide documents 4 task patterns"
F="$ROOT/README.md"
miss=""
for token in question 'seed entity' 'multi-step' 'long-running'; do
  grep -q "$token" "$F" || miss="$miss '${token}'"
done
[[ -z "$miss" ]] && ok || bad "missing task patterns:$miss"

step "4. ADR-099 cross-link present"
F="$ROOT/README.md"
grep -q "ADR-099" "$F" \
  && grep -q "dossier-investigator" "$F" \
  && ok || bad "ADR-099 cross-link missing"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. legacy-vs-canonical namespace mapping documented"
F="$ROOT/README.md"
miss=""
for token in 'horizons' 'goals-horizons' 'research' 'goals-research'; do
  grep -q "$token" "$F" || miss="$miss '${token}'"
done
[[ -z "$miss" ]] && ok || bad "missing namespace map entries:$miss"

step "8. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-goals-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "9. Dossier ADR-099 invariants documented (seed-driven, graph output, budget caps, provenance)"
F="$ROOT/README.md"
miss=""
for token in 'Seed-driven' 'Graph output' 'Budget caps' 'Provenance'; do
  grep -q "$token" "$F" || miss="$miss '${token}'"
done
[[ -z "$miss" ]] && ok || bad "missing invariants:$miss"

step "10. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
