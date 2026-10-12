#!/usr/bin/env bash
# Structural smoke test for ruflo-bbs-federation v0.3.3: the plugin manifest and the mod (ADR-445 pattern).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares version 0.3.3 and the mod keywords"
v=$(grep -E '"version"[[:space:]]*:' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.3.3" ]]; then
  bad "expected 0.3.3, got '$v'"
else
  miss=""
  for k in mod function-hooks guard; do grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"; done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

# M1-M3. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule, no network or process access, safe defaults
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: guard defaults on and the extra options default safe (userConfig)"
node -e '
const c = require(process.argv[1]).userConfig || {}
const safe = c.guard && c.guard.default === "on" && (c.allowWildcardBind && c.allowWildcardBind.default === "off")
process.exit(safe ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
