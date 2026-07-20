#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json is ruflo-agent 0.2.1 with both-runtime keywords"
P="$ROOT/.claude-plugin/plugin.json"
v=$(grep -E '"version"' "$P" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
n=$(grep -E '"name"' "$P" | grep -oE 'ruflo-agent' | head -1)
if [[ "$v" != "0.2.1" ]]; then bad "expected version 0.2.1, got '$v'";
elif [[ "$n" != "ruflo-agent" ]]; then bad "expected name ruflo-agent";
else
  miss=""
  # local WASM runtime (rvagent) + cloud runtime (managed-agents) keywords
  for k in mcp rvagent-wasm ruvllm-wasm managed-agents anthropic; do
    grep -q "\"$k\"" "$P" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in wasm-agent wasm-gallery; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/wasm-specialist.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/wasm.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. all 10 wasm_* MCP tools referenced"
miss=""
for t in wasm_agent_create wasm_agent_prompt wasm_agent_tool wasm_agent_list wasm_agent_terminate wasm_agent_files wasm_agent_export wasm_gallery_list wasm_gallery_search wasm_gallery_create; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "4. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "5. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "6. wasm-gallery namespace claimed"
grep -q "wasm-gallery" "$ROOT/README.md" \
  && ok || bad "wasm-gallery namespace not claimed"

step "7. ADR-070 cross-reference present (rvagent-wasm + ruvllm-wasm integration)"
F="$ROOT/README.md"
miss=""
grep -q "ADR-070" "$F" || miss="$miss adr-ref"
grep -q "rvagent-wasm" "$F" || miss="$miss rvagent-wasm"
grep -q "ruvllm-wasm" "$F" || miss="$miss ruvllm-wasm"
grep -qE "optionalDependencies|graceful-degradation" "$F" || miss="$miss integration-detail"
[[ -z "$miss" ]] && ok || bad "$miss"

step "8. sandbox isolation documented"
F="$ROOT/README.md"
grep -q "Sandbox isolation\|sandbox isolation" "$F" \
  && grep -qE "no host filesystem|virtual filesystem" "$F" \
  && ok || bad "sandbox isolation guarantee not documented"

step "9. AIDefence 3-gate cross-reference (sandbox → host LLM defense)"
F="$ROOT/README.md"
grep -q "ruflo-aidefence" "$F" \
  && grep -qE "3-gate|3 gates" "$F" \
  && ok || bad "AIDefence 3-gate cross-reference missing"

step "10. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-wasm-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "11. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

step "12. managed-agent (cloud runtime) skill + command + all 6 managed_agent_* tools referenced (ADR-115)"
miss=""
[[ -f "$ROOT/skills/managed-agent/SKILL.md" ]] || miss="$miss missing-skill"
[[ -f "$ROOT/commands/managed-agent.md" ]] || miss="$miss missing-command"
for t in managed_agent_create managed_agent_prompt managed_agent_status managed_agent_events managed_agent_list managed_agent_terminate; do
  grep -rq "$t" "$ROOT/skills" "$ROOT/commands" || miss="$miss no-ref-$t"
done
# the cloud-runtime skill must keep an explicit allowed-tools list (no wildcard) and offer the wasm fallback
grep -q '^allowed-tools:[[:space:]]*\*' "$ROOT/skills/managed-agent/SKILL.md" 2>/dev/null && miss="$miss wildcard"
grep -q 'wasm_agent_create' "$ROOT/skills/managed-agent/SKILL.md" 2>/dev/null || miss="$miss no-wasm-fallback-ref"
[[ -z "$miss" ]] && ok || bad "$miss"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
