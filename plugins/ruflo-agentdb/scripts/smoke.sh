#!/usr/bin/env bash
# Structural smoke test for ruflo-agentdb plugin v0.3.1.
# Per ADR-0001 §6 Verification: 13 numbered checks against the documented
# CLI MCP surface plus three documentation invariants.
#
# This script verifies plugin structural soundness and source-level
# contracts. Live MCP-tool exercise (against a running daemon with the
# bridge wired) is layered on top via the optional --live flag, but the
# default invocation is offline-safe and CI-friendly.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
LIVE=0
for arg in "$@"; do
  case "$arg" in --live) LIVE=1 ;; esac
done

PASS=0
FAIL=0

step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

# Documentation invariants (ADR-0001 §Verification)
step "INV1: no '19 controllers' string in plugin docs (excluding ADRs which document history)"
# ADR files inside docs/adrs/ are allowed to reference "19 controllers" because
# they document the change. The invariant is on user-facing docs only.
hits=$(grep -rE '19 (AgentDB )?[Cc]ontrollers|all 19 controllers' "$ROOT" \
   --include='*.md' --include='*.json' \
   --exclude-dir='adrs' 2>/dev/null || true)
if [[ -n "$hits" ]]; then
  bad "stale '19 controllers' phrasing still present in user-facing docs:"
  echo "$hits" | sed 's/^/    /'
else
  ok
fi

step "INV2: RaBitQ workflow documented in vector-search SKILL"
grep -q "embeddings_rabitq_build" "$ROOT/skills/vector-search/SKILL.md" \
  && grep -q "embeddings_rabitq_search" "$ROOT/skills/vector-search/SKILL.md" \
  && grep -q "embeddings_rabitq_status" "$ROOT/skills/vector-search/SKILL.md" \
  && ok || bad "RaBitQ trio not all documented"

step "INV3: README has the Namespace convention section"
grep -q "## Namespace convention" "$ROOT/README.md" \
  && grep -q "Reserved namespaces" "$ROOT/README.md" \
  && ok || bad "Namespace convention section missing"

# 1. Plugin version + new keywords
step "1. plugin.json declares version 0.3.1 with rabitq + namespace-convention keywords"
v=$(grep -E '"version"[[:space:]]*:' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.3.1" ]]; then
  bad "expected 0.3.1, got '$v'"
else
  miss=""
  for k in rabitq quantization namespace-convention controller-bridge; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

# 2. Controller-count claims defer to runtime
step "2. README/agent/command/skill defer controller count to runtime tool"
miss=""
for f in "$ROOT/README.md" "$ROOT/agents/agentdb-specialist.md" "$ROOT/commands/agentdb.md" "$ROOT/skills/agentdb-query/SKILL.md"; do
  grep -q "agentdb_controllers" "$f" || miss="$miss $(basename $f)"
done
[[ -z "$miss" ]] && ok || bad "missing agentdb_controllers reference:$miss"

# 3. All 15 agentdb_* tool names are documented somewhere in the plugin
step "3. all 15 agentdb_* tool names referenced in plugin docs"
miss=""
for t in agentdb_health agentdb_controllers agentdb_pattern-store agentdb_pattern-search agentdb_feedback agentdb_causal-edge agentdb_route agentdb_session-start agentdb_session-end agentdb_hierarchical-store agentdb_hierarchical-recall agentdb_consolidate agentdb_batch agentdb_context-synthesize agentdb_semantic-route; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

# 4. All 10 embeddings_* tools documented
step "4. all 10 embeddings_* tool names referenced in plugin docs"
miss=""
for t in embeddings_init embeddings_generate embeddings_compare embeddings_search embeddings_neural embeddings_hyperbolic embeddings_status embeddings_rabitq_build embeddings_rabitq_search embeddings_rabitq_status; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

# 5. The 3 ruvllm_hnsw_* tools documented + the ~11 cap is acknowledged
step "5. ruvllm_hnsw_* tools documented and ~11 cap acknowledged"
miss=""
for t in ruvllm_hnsw_create ruvllm_hnsw_add ruvllm_hnsw_route; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
if [[ -n "$miss" ]]; then
  bad "undocumented:$miss"
elif ! grep -rq "11 patterns\|≤11" "$ROOT/skills/vector-search/SKILL.md" "$ROOT/README.md" "$ROOT/agents/agentdb-specialist.md"; then
  bad "WASM cap (~11 patterns) not acknowledged"
else
  ok
fi

# 6. RaBitQ workflow has a 5-step recipe + the rerank caveat
step "6. RaBitQ section has the 5-step recipe + rerank caveat"
F="$ROOT/skills/vector-search/SKILL.md"
if grep -q "Quantized search" "$F" \
   && grep -q "rerank" "$F" \
   && grep -qE "embeddings_rabitq_build" "$F" \
   && grep -qE "embeddings_rabitq_search" "$F" \
   && grep -qE "embeddings_rabitq_status" "$F"; then
  ok
else
  bad "RaBitQ section incomplete (missing recipe or rerank caveat)"
fi

# 7. Pattern-store fallback is source-inspectable (no env var gates this — see ADR §6 caveat)
step "7. memory-store-fallback path is source-inspectable in agentdb-tools.ts"
TOOLS="$REPO_ROOT/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts"
if [[ -f "$TOOLS" ]] \
   && grep -q "memory-store-fallback" "$TOOLS" \
   && grep -q "ReasoningBank controller registry unavailable" "$TOOLS"; then
  ok
else
  bad "fallback string not present in agentdb-tools.ts (or file moved)"
fi

# 8. agentdb_hierarchical-store rejects an unknown tier
step "8. tier validator rejects unknown tier values"
TOOLS="$REPO_ROOT/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts"
if grep -qE "(working|episodic|semantic).*tier|tier.*(working|episodic|semantic)" "$TOOLS"; then
  ok
else
  bad "tier validator pattern not found in agentdb-tools.ts"
fi

# 9. Batch size is bounded
step "9. agentdb_batch enforces MAX_BATCH_SIZE = 500"
TOOLS="$REPO_ROOT/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts"
if grep -qE "MAX_BATCH_SIZE\s*=\s*500" "$TOOLS"; then
  ok
else
  bad "MAX_BATCH_SIZE = 500 not present (or moved)"
fi

# 10. Namespace convention guardrails: reserved list + colon rule + length cap
step "10. namespace guardrails documented (reserved list + colon rule + length cap)"
F="$ROOT/README.md"
miss=""
grep -q "claude-memories" "$F" || miss="$miss reserved-list"
grep -qE "SHOULD NOT contain.+:.+colon|colon.+delimiter" "$F" || \
  grep -qE 'NOT contain `:`' "$F" || miss="$miss colon-rule"
grep -qE "200 chars|≤200" "$F" || miss="$miss length-cap"
[[ -z "$miss" ]] && ok || bad "guardrail set incomplete:$miss"

# 11. Auto-memory bridge mechanics documented (Claude Code populates claude-memories)
step "11. auto-memory bridge mechanics documented (memory_import_claude + auto-memory-hook.mjs)"
F="$ROOT/README.md"
if grep -q "How Claude Code populates AgentDB" "$F" \
   && grep -q "memory_import_claude" "$F" \
   && grep -q "auto-memory-hook.mjs" "$F" \
   && grep -q "memory_bridge_status" "$F" \
   && grep -q "memory_search_unified" "$F"; then
  ok
else
  bad "auto-memory bridge section missing pieces (header, import tool, hook script, bridge status, unified search)"
fi

# 12. Hook → namespace integration table
step "12. hook integration table maps hook → namespace it writes to"
F="$ROOT/README.md"
if grep -q "Hook integration convention" "$F" \
   && grep -q "SessionStart" "$F" \
   && grep -q "post-task --train-neural" "$F" \
   && grep -qE "ReasoningBank.*pattern|pattern.*ReasoningBank" "$F"; then
  ok
else
  bad "hook integration table missing (SessionStart, post-task --train-neural, ReasoningBank → pattern)"
fi

# 13. Pluralization gotcha (pattern vs patterns)
step "13. pluralization gotcha documented (pattern vs patterns)"
F="$ROOT/README.md"
if grep -qiE "pluraliz.*gotcha|pattern.*plural|plural.*pattern" "$F" \
   && grep -q '`pattern`' "$F" \
   && grep -q '`patterns`' "$F"; then
  ok
else
  bad "pluralization callout missing (must contrast pattern vs patterns)"
fi

# Live mode (optional, requires daemon)
if [[ "$LIVE" == "1" ]]; then
  step "L1 (live): agentdb_health responds (requires running daemon)"
  if command -v claude-flow >/dev/null 2>&1; then
    if claude-flow mcp call agentdb_health 2>/dev/null | grep -q '"available"'; then
      ok
    else
      bad "agentdb_health did not return an 'available' field"
    fi
  else
    bad "claude-flow CLI not on PATH (skipping --live checks)"
  fi
fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
