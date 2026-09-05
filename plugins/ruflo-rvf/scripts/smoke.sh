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
  for k in mcp cognitive-containers lineage-tracking; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in rvf-manage session-persist; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/session-specialist.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/rvf.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "4. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "5. rvf-sessions namespace claimed"
grep -q "rvf-sessions" "$ROOT/README.md" \
  && ok || bad "rvf-sessions namespace not claimed"

step "6. RVF cross-reference to ruflo-browser sessions"
F="$ROOT/README.md"
grep -q "ruflo-browser" "$F" \
  && grep -qE "session.*RVF|RVF.*session" "$F" \
  && ok || bad "browser-RVF cross-reference missing"

step "7. RVF tooling cross-reference to ruflo-ruvector"
F="$ROOT/README.md"
grep -q "ruflo-ruvector" "$F" \
  && grep -qE "ruvector rvf|rvf tooling|RVF tooling" "$F" \
  && ok || bad "ruvector RVF tooling cross-reference missing"

step "8. encryption-at-rest block intact (ADR-096)"
F="$ROOT/README.md"
miss=""
grep -q "ADR-096" "$F" || miss="$miss adr-ref"
grep -q "AES-256-GCM" "$F" || miss="$miss cipher"
grep -q "RFE1" "$F" || miss="$miss magic-byte"
[[ -z "$miss" ]] && ok || bad "encryption block missing:$miss"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-rvf-contract.md"
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
