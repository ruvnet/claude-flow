#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.4.3 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.4.3" ]]; then bad "expected 0.4.3, got '$v'"; else
  miss=""
  for k in mcp scaffolding contract-bootstrap; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in create-plugin validate-plugin; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/plugin-developer.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/create-plugin.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. create-plugin scaffolds the canonical contract (ADR + smoke + README sections)"
F="$ROOT/skills/create-plugin/SKILL.md"
miss=""
grep -q "docs/adrs/0001-" "$F" || miss="$miss adr-scaffolded"
grep -q "scripts/smoke.sh" "$F" || miss="$miss smoke-scaffolded"
grep -q "Compatibility" "$F" || miss="$miss compat-scaffolded"
grep -q "Namespace coordination" "$F" || miss="$miss namespace-scaffolded"
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. create-plugin includes MCP-tool drift warnings"
F="$ROOT/skills/create-plugin/SKILL.md"
miss=""
grep -q "embeddings_embed" "$F" || miss="$miss embed-warning"
grep -qE "agentdb_hierarchical.*namespace|namespace.*agentdb_hierarchical" "$F" || miss="$miss hierarchical-warning"
grep -qE "agentdb_pattern.*namespace|namespace.*agentdb_pattern|ReasoningBank routes" "$F" || miss="$miss pattern-warning"
grep -qE 'pattern.+plural|plural.+pattern|singular.+plural|pattern.+patterns' "$F" || miss="$miss plural-warning"
[[ -z "$miss" ]] && ok || bad "$miss"

step "5. create-plugin no longer claims '19 AgentDB controllers' (regression check)"
F="$ROOT/skills/create-plugin/SKILL.md"
if grep -qE "19 AgentDB controllers|19 controllers" "$F"; then
  bad "stale '19 controllers' phrasing still present"
else
  ok
fi

step "6. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "7. README has Architecture Decisions section"
grep -q "## Architecture Decisions" "$ROOT/README.md" \
  && ok || bad "Architecture Decisions section missing"

step "8. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-plugin-creator-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "9. validate-plugin skill present"
[[ -f "$ROOT/skills/validate-plugin/SKILL.md" ]] && ok || bad "validate-plugin skill missing"

step "10. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

step "11. the mod template is hybrid, refusal-tolerant and namespaced (ADR-404)"
T="$ROOT/templates/mod"
grep -q '"modules": \["./register.ts"\]' "$T/hooks/hooks.json" && grep -q '"UserPromptSubmit"' "$T/hooks/hooks.json" \
  && grep -q "MY_MOD_ACTIVE" "$T/hooks/classic.cjs" && grep -q "my-mod-status" "$T/hooks/register.ts" \
  && grep -q "claude-code/testing" "$T/tests/register.test.ts" && [[ -f "$ROOT/skills/create-mod/SKILL.md" ]] \
  && ! grep -qE '\$\[' "$T/hooks/register.ts" && [[ -f "$T/plugin.json.tmpl" && ! -e "$T/.claude-plugin" ]] && ok || bad "templates/mod incomplete"

# M1. The mod (ADR-445): hooks module registered, files within the 500-line rule, no network or process access in the hooks
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in status command register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: no userConfig needed (read-only local command)"
node -e '
process.exit(require(process.argv[1]).userConfig === undefined ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "unexpected userConfig"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

step "M4. a scaffolded mod passes claude plugin validate and claude plugin test"
node "$ROOT/scripts/test-scaffold-mod.mjs" >/dev/null && ok || bad "scaffolded mod does not validate/test"

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
