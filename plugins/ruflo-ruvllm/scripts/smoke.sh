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
  for k in mcp local-inference chat-templates; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in llm-config chat-format; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/llm-specialist.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/ruvllm.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "4. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "5. ruvllm-config namespace claimed"
grep -q "ruvllm-config" "$ROOT/README.md" \
  && ok || bad "ruvllm-config namespace not claimed"

step "6. SONA cross-reference (ruflo-intelligence canonical owner)"
F="$ROOT/README.md"
grep -q "ruflo-intelligence" "$F" \
  && grep -qE "SONA|sona_create|sona_adapt" "$F" \
  && ok || bad "SONA cross-reference missing"

step "7. MicroLoRA cross-reference (ruflo-intelligence DISTILL phase)"
F="$ROOT/README.md"
grep -qE "MicroLoRA|microlora" "$F" \
  && grep -qE "DISTILL|CONSOLIDATE|--consolidate" "$F" \
  && ok || bad "MicroLoRA / DISTILL cross-reference missing"

step "8. HNSW WASM router cross-reference (ruflo-agentdb canonical owner)"
F="$ROOT/README.md"
grep -qE "ruvllm_hnsw|HNSW WASM router|11 patterns" "$F" \
  && grep -q "ruflo-agentdb" "$F" \
  && ok || bad "HNSW router cross-reference missing"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-ruvllm-contract.md"
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
