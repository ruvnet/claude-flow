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
  for k in mcp pii-pipeline audit-log; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 3 skills + agent + command present with valid frontmatter"
miss=""
for s in federation-init federation-status federation-audit; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/federation-coordinator.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/federation.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. ADR-097 budget block intact (maxHops, maxTokens, maxUsd, BUDGET_EXCEEDED, HOP_LIMIT_EXCEEDED)"
F="$ROOT/README.md"
miss=""
for token in maxHops maxTokens maxUsd BUDGET_EXCEEDED HOP_LIMIT_EXCEEDED; do
  grep -q "$token" "$F" || miss="$miss $token"
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. 5-tier trust model documented"
F="$ROOT/README.md"
miss=""
for tier in UNTRUSTED VERIFIED ATTESTED TRUSTED PRIVILEGED; do
  grep -q "$tier" "$F" || miss="$miss $tier"
done
[[ -z "$miss" ]] && ok || bad "missing tiers:$miss"

step "5. Compliance modes documented (HIPAA, SOC2, GDPR)"
F="$ROOT/README.md"
miss=""
for mode in HIPAA SOC2 GDPR; do
  grep -q "$mode" "$F" || miss="$miss $mode"
done
[[ -z "$miss" ]] && ok || bad "missing modes:$miss"

step "6. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "7. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "8. README aligns with canonical 3-gate pattern (cross-reference)"
F="$ROOT/README.md"
miss=""
grep -qE "3-gate|3 gates|three gates" "$F" || miss="$miss header"
grep -q "ruflo-aidefence" "$F" || miss="$miss aidefence-ref"
[[ -z "$miss" ]] && ok || bad "3-gate alignment block missing:$miss"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-federation-contract.md"
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
