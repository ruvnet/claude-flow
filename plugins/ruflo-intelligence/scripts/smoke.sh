#!/usr/bin/env bash
# Structural smoke test for ruflo-intelligence v0.4.5.
# Per ADR-0001 §6 Verification: 13 contract checks + 3 doc invariants.
# Offline-safe; no live MCP calls.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
PASS=0
FAIL=0

step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

# Doc invariants
step "INV1: README has the 4-step intelligence pipeline section"
grep -q "4-step intelligence pipeline" "$ROOT/README.md" \
  && grep -qE "RETRIEVE.+JUDGE.+DISTILL.+CONSOLIDATE" "$ROOT/README.md" \
  && ok || bad "missing pipeline section or 4-step phase enumeration"

step "INV2: intelligence-transfer skill references hooks_transfer"
grep -q "hooks_transfer" "$ROOT/skills/intelligence-transfer/SKILL.md" \
  && ok || bad "intelligence-transfer skill missing hooks_transfer"

step "INV3: README mentions IPFS pattern transfer"
grep -qE "IPFS.+pattern|pattern.+IPFS|Pinata" "$ROOT/README.md" \
  && ok || bad "README missing IPFS / Pinata transfer docs"

# 1. plugin.json bump + new keywords
step "1. plugin.json declares 0.4.5 with new keywords"
v=$(grep -E '"version"[[:space:]]*:' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.4.5" ]]; then
  bad "expected 0.4.5, got '$v'"
else
  miss=""
  for k in microlora ewc attention moe pattern-transfer model-routing; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

# 2. README sections present
step "2. README has all required sections (inventory, pipeline, IPFS, hook integration, namespace, EWC++, MoE)"
F="$ROOT/README.md"
miss=""
grep -q "## Tool inventory" "$F" || miss="$miss inventory"
grep -q "## The 4-step intelligence pipeline" "$F" || miss="$miss pipeline"
grep -q "## Cross-project pattern transfer" "$F" || miss="$miss ipfs"
grep -q "## Hook integration" "$F" || miss="$miss hook-table"
grep -q "## Namespace coordination" "$F" || miss="$miss namespace-coord"
grep -q "## EWC++ consolidation" "$F" || miss="$miss ewc"
grep -q "## MoE" "$F" || miss="$miss moe"
[[ -z "$miss" ]] && ok || bad "missing:$miss"

# 3. All 6 neural_* tools referenced
step "3. all 6 neural_* tools referenced in plugin docs"
miss=""
for t in neural_train neural_predict neural_patterns neural_compress neural_status neural_optimize; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

# 4. All 10 hooks_intelligence-family tools referenced
step "4. all 10 hooks_intelligence-family tools referenced"
miss=""
for t in hooks_intelligence hooks_intelligence-reset hooks_intelligence_trajectory-start hooks_intelligence_trajectory-step hooks_intelligence_trajectory-end hooks_intelligence_pattern-store hooks_intelligence_pattern-search hooks_intelligence_stats hooks_intelligence_learn hooks_intelligence_attention; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

# 5. All 6 routing/meta hooks referenced
step "5. all 6 routing/meta hooks referenced (route, explain, pretrain, build-agents, metrics, transfer)"
miss=""
for t in hooks_route hooks_explain hooks_pretrain hooks_build-agents hooks_metrics hooks_transfer; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

# 6. All 3 hooks_model-* tools referenced
step "6. all 3 hooks_model-* tools referenced"
miss=""
for t in hooks_model-route hooks_model-outcome hooks_model-stats; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

# 7. SONA + MicroLoRA tools (4) referenced
step "7. all 4 SONA + MicroLoRA tools referenced"
miss=""
for t in ruvllm_sona_create ruvllm_sona_adapt ruvllm_microlora_create ruvllm_microlora_adapt; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

# 8. 4-step pipeline names all four phases
step "8. 4-step pipeline section names all four phases"
F="$ROOT/README.md"
miss=""
for phase in RETRIEVE JUDGE DISTILL CONSOLIDATE; do
  grep -q "$phase" "$F" || miss="$miss $phase"
done
[[ -z "$miss" ]] && ok || bad "phases not all named:$miss"

# 9. intelligence-transfer skill exists with proper allowed-tools
step "9. intelligence-transfer skill exists with allowed-tools enumerated"
F="$ROOT/skills/intelligence-transfer/SKILL.md"
if [[ -f "$F" ]] \
   && grep -qE "^allowed-tools:" "$F" \
   && grep -q "hooks_transfer" "$F"; then
  ok
else
  bad "intelligence-transfer skill missing or incomplete"
fi

# 10. Pluralization gotcha referenced (defers to ruflo-agentdb)
step "10. pluralization gotcha (pattern vs patterns) documented"
F="$ROOT/README.md"
if grep -q '`pattern`' "$F" \
   && grep -q '`patterns`' "$F" \
   && grep -qiE "pluraliz|distinct namespace" "$F"; then
  ok
else
  bad "pluralization gotcha not surfaced (must contrast pattern vs patterns)"
fi

# 11. No skill grants wildcard tool access
step "11. no skill grants wildcard tool access"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

# 12. ADR exists, status Proposed
step "12. ADR-0001 exists with status Proposed"
ADR="$ROOT/docs/adrs/0001-intelligence-surface-completeness.md"
if [[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Proposed" "$ADR"; then
  ok
else
  bad "ADR missing or status != Proposed"
fi

# 13. Compatibility section pins the CLI line the docs were checked against
step "13. Compatibility section pins @claude-flow/cli to 3.56"
if grep -qE "@claude-flow/cli.*3\.56|3\.56.*claude-flow/cli" "$ROOT/README.md"; then
  ok
else
  bad "Compatibility pin to 3.56 missing"
fi


# M1. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen tools guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: userConfig defaults are the safe ones (guard confirmReset all on)"
node -e '
const c = require(process.argv[1]).userConfig || {}
const need = process.argv.slice(2)
process.exit(need.every(k => c[k] && c[k].default === "on") ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" guard confirmReset && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
