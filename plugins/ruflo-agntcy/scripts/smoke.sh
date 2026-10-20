#!/usr/bin/env bash
# Structural smoke test for the ruflo-agntcy mod (ADR-445 pattern). Offline-safe.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "0. plugin.json declares 0.2.5"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
[[ "$v" == "0.2.5" ]] && ok || bad "expected 0.2.5, got '$v'"

# M1. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: userConfig defaults are safe"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(Object.values(c).every(o => o.default !== undefined) ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

step "M4. mod: /agntcy-mod is registered and collides with no command or skill of the plugin"
if grep -q "name: 'agntcy-mod'" "$ROOT/hooks/register.ts" && [[ ! -e "$ROOT/commands/agntcy-mod.md" && ! -e "$ROOT/skills/agntcy-mod" ]]; then ok; else bad "command name missing or taken"; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
