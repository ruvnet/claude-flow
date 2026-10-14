#!/usr/bin/env bash
# Structural smoke test for ruflo-deepseek-harness: the plugin's scripts exist, and the mod (ADR-445 pattern) is wired.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares version 0.2.5"
grep -q '"version": "0.2.5"' "$ROOT/.claude-plugin/plugin.json" && ok || bad "version is not 0.2.5"

step "2. scripts, both skills, the command and the agent are present"
miss=""
for f in scripts/_deepseek.mjs scripts/chat.mjs scripts/reason.mjs skills/deepseek-chat/SKILL.md skills/deepseek-reason/SKILL.md commands/ruflo-deepseek-harness.md agents/deepseek-architect.md; do
  [[ -f "$ROOT/$f" ]] || miss="$miss $f"
done
[[ -z "$miss" ]] && ok || bad "missing:$miss"

# M1. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule, no network or process access in the hooks
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: guard defaults on, and it is the only userConfig option"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(c.guard && c.guard.default === "on" && Object.keys(c).length === 1 ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
