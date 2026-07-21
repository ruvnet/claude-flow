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
  for k in mcp claude-memories bridged-memory; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + 2 commands present with valid frontmatter"
miss=""
for s in memory-bridge memory-search; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/memory-specialist.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/recall.md" ]] || miss="$miss missing-recall-cmd"
[[ -f "$ROOT/commands/ruflo-memory.md" ]] || miss="$miss missing-memory-cmd"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "4. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "5. claude-memories reserved-namespace consumer documented"
F="$ROOT/README.md"
miss=""
grep -q "claude-memories" "$F" || miss="$miss namespace-name"
grep -q "memory_import_claude" "$F" || miss="$miss import-tool"
grep -q "SessionStart" "$F" || miss="$miss session-start"
[[ -z "$miss" ]] && ok || bad "$miss"

step "6. memory_search_unified referenced (cross-namespace search)"
grep -q "memory_search_unified" "$ROOT/README.md" \
  && ok || bad "memory_search_unified not referenced"

step "7. encryption-at-rest block intact (ADR-096)"
F="$ROOT/README.md"
miss=""
grep -q "ADR-096" "$F" || miss="$miss adr-ref"
grep -q "AES-256-GCM" "$F" || miss="$miss cipher"
grep -q "RFE1" "$F" || miss="$miss magic-byte"
[[ -z "$miss" ]] && ok || bad "encryption block missing:$miss"

step "8. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-rag-memory-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "9. README does not claim '19 AgentDB controllers' (regression)"
F="$ROOT/README.md"
if grep -qE "19 AgentDB controllers|19 controllers" "$F"; then
  bad "stale '19 controllers' phrasing still present"
else
  ok
fi

step "10. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
