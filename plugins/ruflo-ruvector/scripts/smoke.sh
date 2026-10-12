#!/usr/bin/env bash
# Smoke test for ruflo-ruvector plugin against ruvector@0.2.25.
# Exits non-zero if any contracted CLI surface is missing or behaves
# differently from documented. Run after `npm install ruvector@0.2.25`
# (or rely on the npx fetch).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN="ruvector@0.2.25"
PASS=0
FAIL=0
WORKDIR="$(mktemp -d -t ruvector-smoke.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT
cd "$WORKDIR" || exit 2

step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

run() { npx -y "$PIN" "$@" 2>&1; }

step "version pin"
# --version output may include npm warnings; take the last non-empty line.
ver=$(run --version | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' | tail -1)
[[ "$ver" == "0.2.25" ]] && ok || bad "expected 0.2.25, got '$ver'"

step "top-level help mentions hooks/embed/rvf/attention/gnn/brain/sona"
help=$(run --help)
missing=""
for c in hooks embed rvf attention gnn brain sona create stats search insert; do
  grep -qE "^[[:space:]]+$c( |\$)" <<<"$help" || missing="$missing $c"
done
[[ -z "$missing" ]] && ok || bad "missing:$missing"

step "hooks route is positional"
out=$(run hooks route "test task")
grep -q '"recommended"' <<<"$out" && ok || bad "no JSON 'recommended' field — got: $out"

step "hooks ast-analyze on a sample TS file"
echo 'export const x = 1;' > sample.ts
out=$(run hooks ast-analyze sample.ts)
grep -q "AST Analysis" <<<"$out" && ok || bad "ast-analyze did not return summary"

step "hooks ast-complexity returns JSON"
out=$(run hooks ast-complexity sample.ts)
grep -q '"cyclomatic"' <<<"$out" && ok || bad "ast-complexity output unexpected"

step "attention list shows mechanisms"
out=$(run attention list)
grep -q "FlashAttention" <<<"$out" && ok || bad "attention list missing FlashAttention"

step "rvf examples lists at least 10 stores"
out=$(run rvf examples)
n=$(grep -cE '^\s+[a-z_]+\s+[0-9]' <<<"$out")
[[ $n -ge 10 ]] && ok || bad "expected ≥10 RVF examples, got $n"

step "gnn info reports Available"
out=$(run gnn info)
grep -q "Status:.*Available" <<<"$out" && ok || bad "gnn info did not report Available"

step "info reports CLI Version 0.2.25"
out=$(run info)
grep -q "CLI Version: 0.2.25" <<<"$out" && ok || bad "info did not report 0.2.25"

step "doctor exits 0"
run doctor >/dev/null && ok || bad "doctor returned non-zero"

step "removed surface stays removed (compare/midstream/index)"
fail_removed=""
for c in compare midstream index; do
  # Don't pass --help — Commander will show top-level help instead of the error.
  out=$(npx -y "$PIN" "$c" 2>&1)
  grep -q "unknown command '$c'" <<<"$out" || fail_removed="$fail_removed $c"
done
[[ -z "$fail_removed" ]] && ok || bad "still present:$fail_removed"

# M1. The mod (ADR-445): hooks module registered, files within the 500-line rule, no network or process access in the hooks
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen guard status command register tools; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: guard defaults on (userConfig)"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(c.guard && c.guard.default === "on" ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig default wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
