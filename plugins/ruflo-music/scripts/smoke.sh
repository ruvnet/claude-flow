#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.2.5 with expected keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.2.5" ]]; then bad "expected 0.2.5, got '$v'"; else
  miss=""
  for k in cogmusic cognitum mcp; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 7 skills present with valid frontmatter"
miss=""
for s in music-connect music-generate music-list music-get music-stems music-midi music-master; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. both agents present"
miss=""
for a in music-composer music-producer; do
  [[ -f "$ROOT/agents/$a.md" ]] || miss="$miss missing-$a"
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. command present"
[[ -f "$ROOT/commands/music.md" ]] && ok || bad "music command missing"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README pins cogmusic runtime version"
grep -qE "cogmusic@0\.1\.1" "$ROOT/README.md" \
  && ok || bad "cogmusic@0.1.1+ pin missing"

step "7. Namespace coordination block claims both namespaces"
F="$ROOT/README.md"
grep -q "Namespace coordination" "$F" \
  && grep -q "music-productions" "$F" \
  && grep -q "music-briefs" "$F" \
  && ok || bad "namespace coordination block incomplete"

step "8. known gaps disclosed (no audio bytes over MCP, no stem/MIDI audio_url, reliability history)"
F="$ROOT/README.md"
miss=""
grep -qi "audio_url" "$F" || miss="$miss audio_url"
grep -qi "stems and midi have no" "$F" || miss="$miss stems-midi-gap"
grep -qi "reliability history" "$F" || miss="$miss reliability-history"
[[ -z "$miss" ]] && ok || bad "$miss"

step "9. ADR-0001 exists with status Proposed"
ADR="$ROOT/docs/adrs/0001-music-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Proposed" "$ADR" \
  && ok || bad "ADR missing or status != Proposed"

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
