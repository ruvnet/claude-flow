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
  for k in mcp candlestick-patterns namespace-routing; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in market-ingest market-pattern; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/data-engineer.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/market.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. embeddings_embed (non-existent tool) NOT at any tool-call site (excludes ADR + README call-outs)"
hits=$(grep -rE 'mcp__plugin_ruflo-core_ruflo__embeddings_embed' "$ROOT" \
       --include='*.md' --include='*.json' \
       --exclude-dir='adrs' 2>/dev/null \
       | grep -v 'NOT \`embeddings_embed\`\|embeddings_embed.*does not exist\|fixes prior references' \
       || true)
[[ -z "$hits" ]] && ok || bad "embeddings_embed reference present at tool-call site"

step "4. market-ingest uses memory_* (namespace-routed) for store path"
F="$ROOT/skills/market-ingest/SKILL.md"
miss=""
grep -q "memory_store" "$F" || miss="$miss no-memory_store"
grep -qE 'agentdb_hierarchical-store.+market-data|market-data.+agentdb_hierarchical-store' "$F" && miss="$miss still-uses-hierarchical-store"
[[ -z "$miss" ]] && ok || bad "$miss"

step "5. market-pattern uses memory_* for namespaced reads"
F="$ROOT/skills/market-pattern/SKILL.md"
miss=""
grep -q "memory_search\|memory_list" "$F" || miss="$miss no-memory-load"
grep -qE 'agentdb_hierarchical-recall.+market-data|market-data.+agentdb_hierarchical-recall' "$F" && miss="$miss still-uses-hierarchical-recall"
[[ -z "$miss" ]] && ok || bad "$miss"

step "6. market-pattern documents dual pattern-store path (ReasoningBank vs namespace)"
F="$ROOT/skills/market-pattern/SKILL.md"
if grep -q "ReasoningBank" "$F" \
   && grep -q "memory_store --namespace market-patterns" "$F"; then
  ok
else
  bad "missing dual-path documentation"
fi

step "7. embeddings_generate (real tool) referenced in market-ingest"
grep -q "embeddings_generate" "$ROOT/skills/market-ingest/SKILL.md" \
  && ok || bad "embeddings_generate not referenced in market-ingest"

step "8. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "9. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "10. market-data + market-patterns namespaces claimed"
F="$ROOT/README.md"
grep -q "market-data" "$F" && grep -q "market-patterns" "$F" \
  && ok || bad "namespace claims missing"

step "11. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-market-data-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
