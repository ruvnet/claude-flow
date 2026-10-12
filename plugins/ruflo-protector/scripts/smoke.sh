#!/usr/bin/env bash
# Structural smoke test for ruflo-protector v0.1.1, Project Anatole (ADR-453).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares ruflo-protector 0.1.1 and names Project Anatole"
grep -q '"name": "ruflo-protector"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q '"version": "0.1.1"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q 'Project Anatole' "$ROOT/.claude-plugin/plugin.json" && ok || bad "name/version/description"

step "2. hooks.json names register.ts and every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen shapes rules baseline engine store scan command register rootdelete; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "3. userConfig defaults are safe (mode learn, autoGraduate on; never enforce)"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(c.mode && c.mode.default === "learn" && c.autoGraduate && c.autoGraduate.default === "on" ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig defaults wrong"

step "4. every userConfig option key has a README row"
miss=""
for k in $(node -e 'console.log(Object.keys(require(process.argv[1]).userConfig||{}).join(" "))' "$ROOT/.claude-plugin/plugin.json"); do
  grep -qE "^\| \`$k\` \|" "$ROOT/README.md" || miss="$miss $k"
done
[[ -z "$miss" ]] && ok || bad "no README row for:$miss"

step "5. hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

step "6. /protector is registered and collides with no command or skill of the plugin"
if grep -q "name: 'protector'" "$ROOT/hooks/register.ts" && [[ ! -e "$ROOT/commands/protector.md" && ! -e "$ROOT/skills/protector" ]]; then ok; else bad "command name missing or taken"; fi

step "7. the catalogue has all 13 rules and the README lists every /protector verb"
miss=""
for i in 01 02 03 04 05 06 07 08 09 10 11 12 13; do grep -q "'PR-0$i'" "$ROOT/hooks/rules.ts" || miss="$miss PR-0$i"; done
for v in status list rule mode run replay alerts ack unack allow reset-baseline; do grep -q "\`$v" "$ROOT/README.md" || miss="$miss verb:$v"; done
[[ -z "$miss" ]] && ok || bad "missing:$miss"

step "8. the corpus has at least 20 benign traces and an attack trace per rule"
b=$(grep -cE "^  '[a-z0-9-]+': \[" "$ROOT/tests/corpus/benign.ts")
miss=""
for i in 01 02 03 04 05 06 07 08 09 10 11 12 13; do grep -q "'PR-0$i-" "$ROOT/tests/corpus/attacks.ts" || miss="$miss PR-0$i"; done
[[ $b -ge 20 && -z "$miss" ]] && ok || bad "benign=$b attacks missing:$miss"

step "9. kit tests pass (claude plugin test)"
if command -v claude >/dev/null 2>&1; then
  out=$(claude plugin test "$ROOT" 2>&1); echo "$out" | grep -qE ' 0 fail' && ok || bad "$(echo "$out" | tail -3 | tr '\n' ' ')"
else
  printf "SKIP (claude not on PATH)\n"
fi

step "10. the toast policy copy is byte-identical to the canonical one (ADR-477)"
if [[ ! -f "$ROOT/../ruflo-mods/hooks/toast/policy.ts" ]]; then printf "SKIP (ruflo-mods is not beside this plugin)\n"
elif cmp -s "$ROOT/../ruflo-mods/hooks/toast/policy.ts" "$ROOT/hooks/toast-policy.ts"; then ok
else bad "differs from ruflo-mods/hooks/toast/policy.ts: node scripts/sync-toast-policy.mjs"; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
