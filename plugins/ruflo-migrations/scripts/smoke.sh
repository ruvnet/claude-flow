#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.3.5 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.3.5" ]]; then bad "expected 0.3.5, got '$v'"; else
  miss=""
  for k in mcp dry-run up-down-pairs; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + command present with valid frontmatter"
miss=""
for s in migrate-create migrate-validate; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/migration-engineer.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/migrate.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. /migrate command covers 6 subcommands"
F="$ROOT/commands/migrate.md"
miss=""
for sub in create up down status validate history; do
  grep -q "$sub" "$F" || miss="$miss $sub"
done
[[ -z "$miss" ]] && ok || bad "missing subcommands:$miss"

step "4. migrate-create uses memory_* (namespace-routed) for store path"
F="$ROOT/skills/migrate-create/SKILL.md"
miss=""
grep -q "memory_store" "$F" || miss="$miss no-memory_store"
grep -qE 'agentdb_hierarchical-store.+migrations|migrations.+agentdb_hierarchical-store' "$F" && miss="$miss still-uses-hierarchical-store"
[[ -z "$miss" ]] && ok || bad "$miss"

step "5. migrate-validate uses memory_* for namespaced reads"
F="$ROOT/skills/migrate-validate/SKILL.md"
miss=""
grep -q "memory_search\|memory_list" "$F" || miss="$miss no-memory-load"
grep -qE 'agentdb_hierarchical-recall.+migrations|migrations.+agentdb_hierarchical-recall' "$F" && miss="$miss still-uses-hierarchical-recall"
[[ -z "$miss" ]] && ok || bad "$miss"

step "6. migrate-validate documents dual pattern-store path"
F="$ROOT/skills/migrate-validate/SKILL.md"
if grep -q "ReasoningBank" "$F" \
   && grep -q "memory_store --namespace migrations" "$F"; then
  ok
else
  bad "missing dual-path documentation"
fi

step "7. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "8. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "9. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-migrations-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "10. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

# M1-M3. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule, safe defaults, no network or process access
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: guard defaults on (userConfig)"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(c.guard && c.guard.default === "on" ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi
printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
