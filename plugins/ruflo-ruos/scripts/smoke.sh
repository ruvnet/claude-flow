#!/usr/bin/env bash
# ruflo-ruos smoke contract (ADR-405). Runs offline: no fleet credentials,
# no network. Exits non-zero on any failed check.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json is valid and declares 0.1.1"
v=$(node -e 'const p=require(process.argv[1]);if(p.name!=="ruflo-ruos")process.exit(1);console.log(p.version)' "$ROOT/.claude-plugin/plugin.json" 2>/dev/null)
[[ "$v" == "0.1.1" ]] && ok || bad "got '$v'"

step "2. commands, skill and agent present with frontmatter"
miss=""
for c in hosts run view deploy; do
  f="$ROOT/commands/$c.md"; [[ -f "$f" ]] || { miss="$miss cmd-$c"; continue; }
  grep -q "^name: $c$" "$f" || miss="$miss $c-name"
  grep -q '^description:' "$f" || miss="$miss $c-desc"
done
grep -q '^name: ruos-host-run$' "$ROOT/skills/ruos-host-run/SKILL.md" 2>/dev/null || miss="$miss skill"
grep -q '^name: ruos-host-operator$' "$ROOT/agents/ruos-host-operator.md" 2>/dev/null || miss="$miss agent"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. every source file under 500 lines"
long=$(find "$ROOT/scripts" "$ROOT/tests" "$ROOT/hooks" \( -name '*.mjs' -o -name '*.ts' \) -exec awk 'END{if(NR>500)print FILENAME":"NR}' {} \;)
[[ -z "$long" ]] && ok || bad "$long"

step "4. no source path opens the :17870 executor"
# The only allowed mentions are refusals/assertions, never a URL or connect.
hits=$(grep -rnE "17870" "$ROOT/scripts" --include="*.mjs" | grep -viE "refus|never|ADR-070|includes\('17870'\)|port === '17870'" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "5. ssh is spawned with a fixed argv and shell:false"
grep -q "shell: false" "$ROOT/scripts/lib/ssh.mjs" && ! grep -qE "exec\(|execSync\(|shell: true" "$ROOT/scripts/lib/ssh.mjs" \
  && ok || bad "ssh transport must not use a shell"

step "6. unconfigured CLI makes no request and exits 2"
tmp=$(mktemp -d)
out=$(cd "$tmp" && env -i PATH="$PATH" HOME="$tmp" node "$ROOT/scripts/cli.mjs" hosts 2>&1); code=$?
[[ $code -eq 2 && "$out" == *not-configured* && ! -e "$tmp/.claude-flow" ]] && ok || bad "code=$code out=$out"
rm -rf "$tmp"

step "7. unit + injection + failure-path tests"
if out=$(cd "$ROOT" && node --test tests/*.test.mjs 2>&1); then ok; else bad "$(printf '%s' "$out" | grep -E '^not ok' | head -5)"; fi

step "8. sources type-check (tsc --checkJs, skipped if tsc absent)"
TSC="$ROOT/../../node_modules/.bin/tsc"
if [[ -x "$TSC" ]]; then
  if out=$("$TSC" --noEmit --allowJs --checkJs --strict --target es2022 --module nodenext --moduleResolution nodenext \
      --types node --skipLibCheck "$ROOT/scripts/cli.mjs" "$ROOT"/scripts/lib/*.mjs 2>&1); then ok; else bad "$(printf '%s' "$out" | head -5)"; fi
else
  printf "SKIP (no tsc)\n"
fi

step "9. mod part: claude plugin validate + test (skipped if claude absent)"
if command -v claude >/dev/null 2>&1 && claude plugin --help 2>/dev/null | grep -q 'test \['; then
  if out=$(claude plugin validate "$ROOT" 2>&1) && out=$(claude plugin test "$ROOT" 2>&1); then ok; else bad "$(printf '%s' "$out" | tail -5)"; fi
else
  printf "SKIP (no claude CLI with plugin test)\n"
fi

step "10. ADR-405 present"
[[ -f "$ROOT/../../v3/docs/adr/ADR-405-ruos-desktops-as-swarm-hosts.md" ]] && ok || bad "missing ADR"

echo
echo "ruflo-ruos smoke: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
