#!/usr/bin/env bash
# Smoke for the ruflo-graph-intelligence mod (the engine itself is tested by vitest: npm test).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

# M1. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen tools guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: userConfig defaults are the safe ones (guard all on)"
node -e '
const c = require(process.argv[1]).userConfig || {}
const need = process.argv.slice(2)
process.exit(need.every(k => c[k] && c[k].default === "on") ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" guard && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

# M4. The mod's tests run from a staged copy: `claude plugin test` runs every *.test.ts under a dir, and this package's own tests/ are vitest (library) tests
step "M4. mod: claude plugin test passes on a staged copy (skipped when claude is not on PATH)"
if command -v claude >/dev/null 2>&1; then
  T="$(mktemp -d)"; mkdir "$T/tests"
  cp -r "$ROOT/.claude-plugin" "$ROOT/hooks" "$T/" && mv "$T/hooks/tests/register.test.ts" "$T/tests/" && rmdir "$T/hooks/tests"
  claude plugin test "$T" >/dev/null 2>&1 && ok || bad "mod tests failed"
  rm -rf "$T"
else
  ok
fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
