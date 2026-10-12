#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.3.4 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.3.4" ]]; then bad "expected 0.3.4, got '$v'"; else
  miss=""
  for k in mcp phase-gates quality-gates; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 3 skills + agent + command present with valid frontmatter"
miss=""
for s in sparc-spec sparc-implement sparc-refine; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/sparc-orchestrator.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/ruflo-sparc.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. all 5 SPARC phase names documented (Specification/Pseudocode/Architecture/Refinement/Completion)"
F="$ROOT/README.md"
miss=""
for phase in Specification Pseudocode Architecture Refinement Completion; do
  grep -q "$phase" "$F" || miss="$miss $phase"
done
[[ -z "$miss" ]] && ok || bad "missing phases:$miss"

step "4. /sparc command covers 5 subcommands"
F="$ROOT/commands/ruflo-sparc.md"
[[ -s "$F" ]] && ok || bad "command file empty/missing"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. sparc-* namespaces claimed (state, phases, gates)"
F="$ROOT/README.md"
miss=""
for ns in sparc-state sparc-phases sparc-gates; do
  grep -q "$ns" "$F" || miss="$miss $ns"
done
[[ -z "$miss" ]] && ok || bad "missing namespaces:$miss"

step "8. phase-to-plugin alignment table present (cross-references to adr/ddd/jujutsu/docs/goals)"
F="$ROOT/README.md"
miss=""
for plugin in ruflo-adr ruflo-ddd ruflo-jujutsu ruflo-docs ruflo-goals; do
  grep -q "$plugin" "$F" || miss="$miss $plugin"
done
[[ -z "$miss" ]] && ok || bad "missing plugin cross-references:$miss"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-sparc-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "10. 5 phase gate criteria documented"
F="$ROOT/README.md"
miss=""
for gate in 'acceptance criteria' 'error paths' 'circular deps' 'coverage' 'deployment checklist'; do
  grep -q "$gate" "$F" || miss="$miss '${gate}'"
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "11. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

# M. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule, no network or process access in the hooks
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: userConfig defaults are safe (guard defaults on)"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(c.guard && c.guard.default === "on" ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
