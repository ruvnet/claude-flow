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
  for k in mcp pathfinder-traversal entity-extraction; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills present with valid frontmatter"
miss=""
for s in kg-extract kg-traverse; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. agent + command present"
[[ -f "$ROOT/agents/graph-navigator.md" ]] && [[ -f "$ROOT/commands/kg.md" ]] \
  && ok || bad "agent or command missing"

step "4. embeddings_embed (non-existent tool) is NOT referenced as a tool call (excluding ADR + README call-outs which document the fix)"
# ADR file legitimately mentions the broken tool as the thing being removed.
# The README's namespace-coord note also calls it out as "NOT embeddings_embed".
# Filter both — invariant is on actual tool-call-site references in skills/agent/command.
hits=$(grep -rE 'mcp__plugin_ruflo-core_ruflo__embeddings_embed' "$ROOT" \
       --include='*.md' --include='*.json' \
       --exclude-dir='adrs' 2>/dev/null \
       | grep -v 'NOT embeddings_embed\|embeddings_embed.*does not exist\|fixes prior references' \
       || true)
if [[ -n "$hits" ]]; then
  bad "embeddings_embed reference still present at a tool-call site"
  echo "$hits" | sed 's/^/    /'
else
  ok
fi

step "5. embeddings_generate (real tool) referenced in skill + agent"
miss=""
grep -q "embeddings_generate" "$ROOT/skills/kg-extract/SKILL.md" || miss="$miss skill"
grep -q "embeddings_generate" "$ROOT/agents/graph-navigator.md" || miss="$miss agent"
[[ -z "$miss" ]] && ok || bad "missing in:$miss"

step "6. /kg command covers 5 subcommands"
F="$ROOT/commands/kg.md"
miss=""
for sub in 'extract' 'traverse' 'relations' 'visualize' 'search'; do
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
ADR="$ROOT/docs/adrs/0001-knowledge-graph-contract.md"
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
