#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.4.5 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.4.5" ]]; then bad "expected 0.4.5, got '$v'"; else
  miss=""
  for k in mcp evidence-grading legacy-namespaces; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 5 skills + 4 agents + 1 command present"
miss=""
for s in deep-research goal-plan horizon-track research-synthesize dossier-collect; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-skill-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
for a in goal-planner deep-researcher horizon-tracker dossier-investigator; do
  [[ -f "$ROOT/agents/$a.md" ]] || miss="$miss missing-agent-$a"
done
[[ -f "$ROOT/commands/goals.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. selection guide documents 4 task patterns"
F="$ROOT/README.md"
miss=""
for token in question 'seed entity' 'multi-step' 'long-running'; do
  grep -q "$token" "$F" || miss="$miss '${token}'"
done
[[ -z "$miss" ]] && ok || bad "missing task patterns:$miss"

step "4. ADR-099 cross-link present"
F="$ROOT/README.md"
grep -q "ADR-099" "$F" \
  && grep -q "dossier-investigator" "$F" \
  && ok || bad "ADR-099 cross-link missing"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. legacy-vs-canonical namespace mapping documented"
F="$ROOT/README.md"
miss=""
for token in 'horizons' 'goals-horizons' 'research' 'goals-research'; do
  grep -q "$token" "$F" || miss="$miss '${token}'"
done
[[ -z "$miss" ]] && ok || bad "missing namespace map entries:$miss"

step "8. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-goals-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "9. Dossier ADR-099 invariants documented (seed-driven, graph output, budget caps, provenance)"
F="$ROOT/README.md"
miss=""
for token in 'Seed-driven' 'Graph output' 'Budget caps' 'Provenance'; do
  grep -q "$token" "$F" || miss="$miss '${token}'"
done
[[ -z "$miss" ]] && ok || bad "missing invariants:$miss"

step "10. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

step "11. deep-research: cap, depth, AIDefence, marker, accept-before-store (ADR-438)"
miss=""
for f in "$ROOT/skills/deep-research/SKILL.md" "$ROOT/agents/deep-researcher.md"; do
  b=$(basename "$f")
  for t in aidefence_scan '--cap-usd' 'quick|standard|deep' 'research-active.json' truncated 'research-<slug>-<yyyymmddhhmm>' 'accept'; do
    grep -qF -- "$t" "$f" || miss="$miss $b-no-$t"
  done
done
grep -q 'aidefence_scan' "$ROOT/skills/deep-research/SKILL.md" && grep -E '^allowed-tools:' "$ROOT/skills/deep-research/SKILL.md" | grep -q aidefence_scan || miss="$miss skill-allowed-tools-no-aidefence"
grep -E '^  - .*aidefence_scan' "$ROOT/agents/deep-researcher.md" >/dev/null || miss="$miss agent-tools-no-aidefence"
[[ -z "$miss" ]] && ok || bad "$miss"

step "12. research-list.mjs runtime test passes"
out=$(node "$ROOT/scripts/test-research-list.mjs" 2>&1) && ok || bad "$out"

step "12b. research-list.mjs prefers the installed ruflo CLI over npx @latest (#3558)"
out=$(node "$ROOT/scripts/test-cli-resolution-3558.mjs" 2>&1) && ok || bad "$out"


# M1. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen tools guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: userConfig defaults are the safe ones (guard personal all on)"
node -e '
const c = require(process.argv[1]).userConfig || {}
const need = process.argv.slice(2)
process.exit(need.every(k => c[k] && c[k].default === "on") ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" guard personal && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
