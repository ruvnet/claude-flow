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
  for k in mcp tdd-london-school coverage-routing; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all skills + agent + command present with valid frontmatter"
miss=""
for s in tdd-workflow test-gaps tdd-repair; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/tester.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/testgen.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. hooks_worker-dispatch + testgaps trigger documented"
miss=""
grep -rq "hooks_worker-dispatch" "$ROOT" --include='*.md' || miss="$miss dispatch-tool"
grep -rq "testgaps" "$ROOT" --include='*.md' || miss="$miss testgaps-trigger"
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. all 3 coverage CLI commands referenced"
F="$ROOT/README.md"
miss=""
for cmd in coverage-gaps coverage-route coverage-suggest; do
  grep -q "$cmd" "$F" || miss="$miss $cmd"
done
[[ -z "$miss" ]] && ok || bad "missing CLI commands:$miss"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. test-gaps namespace claimed"
grep -q "test-gaps" "$ROOT/README.md" \
  && ok || bad "test-gaps namespace not claimed"

step "8. SPARC Refinement-phase ownership cross-reference"
F="$ROOT/README.md"
grep -q "ruflo-sparc" "$F" \
  && grep -qE "Refinement|refinement phase" "$F" \
  && ok || bad "SPARC Refinement-phase cross-reference missing"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-testgen-contract.md"
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
