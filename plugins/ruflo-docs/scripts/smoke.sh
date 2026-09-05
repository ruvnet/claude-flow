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
  for k in jsdoc openapi mcp; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills present with valid frontmatter"
miss=""
for s in api-docs doc-gen; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. agent + command present"
[[ -f "$ROOT/agents/docs-writer.md" ]] && [[ -f "$ROOT/commands/ruflo-docs.md" ]] \
  && ok || bad "agent or command missing"

step "4. hooks_worker-dispatch referenced for document trigger"
miss=""
grep -rq "hooks_worker-dispatch\|hooks worker dispatch" "$ROOT" --include='*.md' || miss="$miss dispatch-tool"
grep -rqE 'trigger.+document|document.+trigger' "$ROOT" --include='*.md' || miss="$miss document-trigger"
[[ -z "$miss" ]] && ok || bad "$miss"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. docs-drift namespace claimed"
grep -q "docs-drift" "$ROOT/README.md" \
  && ok || bad "docs-drift namespace not claimed"

step "8. document-worker scope table documented"
F="$ROOT/README.md"
miss=""
grep -q "Document-worker contract" "$F" || miss="$miss header"
grep -qE 'scope.+api|api.+scope' "$F" || miss="$miss api-scope"
[[ -z "$miss" ]] && ok || bad "$miss"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-docs-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "10. agent uses Haiku model (cost-efficient)"
grep -qE "^model:[[:space:]]*haiku" "$ROOT/agents/docs-writer.md" \
  && ok || bad "agent model is not Haiku"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
