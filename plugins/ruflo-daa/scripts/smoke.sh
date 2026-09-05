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
  for k in cognitive-patterns workflows mcp; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 8 daa_* MCP tools referenced"
miss=""
for t in daa_agent_create daa_agent_adapt daa_workflow_create daa_workflow_execute daa_knowledge_share daa_learning_status daa_cognitive_pattern daa_performance_metrics; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "3. both skills with valid frontmatter"
miss=""
for s in daa-agent cognitive-pattern; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. agent + command present with valid frontmatter"
miss=""
for f in "$ROOT/agents/daa-specialist.md" "$ROOT/commands/daa.md"; do
  [[ -f "$f" ]] || { miss="$miss missing-$(basename $f)"; continue; }
  grep -q "^name:" "$f" || miss="$miss $(basename $f)-no-name"
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. README aligns with intelligence 4-step pipeline (cross-reference)"
grep -qE "4-step|JUDGE phase|intelligence pipeline" "$ROOT/README.md" \
  && grep -q "ruflo-intelligence" "$ROOT/README.md" \
  && ok || bad "intelligence pipeline cross-reference missing"

step "8. daa-patterns namespace claimed"
grep -q "daa-patterns" "$ROOT/README.md" \
  && ok || bad "daa-patterns namespace not claimed"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-daa-contract.md"
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
