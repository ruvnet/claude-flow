#!/usr/bin/env bash
# Structural smoke test for ruflo-aidefence v0.3.2 (ADR-0001).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.3.2 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.3.2" ]]; then
  bad "expected 0.3.2, got '$v'"
else
  miss=""
  for k in prompt-injection defense-in-depth mcp; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 6 aidefence_* MCP tools referenced in plugin docs"
miss=""
for t in aidefence_scan aidefence_analyze aidefence_stats aidefence_learn aidefence_is_safe aidefence_has_pii; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "3. transfer_detect-pii referenced (used by pii-detect skill)"
grep -q "transfer_detect-pii" "$ROOT/skills/pii-detect/SKILL.md" \
  && ok || bad "pii-detect skill missing transfer_detect-pii"

step "4. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "Compatibility pin to v3.6 missing"

step "5. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "6. README documents the 3-gate pattern"
F="$ROOT/README.md"
miss=""
grep -qE "3-gate|3 gates|three gates" "$F" || miss="$miss header"
grep -q "Pre-storage PII" "$F" || miss="$miss gate1"
grep -q "Sanitization" "$F" || miss="$miss gate2"
grep -q "Prompt-injection" "$F" || miss="$miss gate3"
[[ -z "$miss" ]] && ok || bad "3-gate pattern incomplete:$miss"

step "7. Defence-in-depth pairing block intact (loader-hijack, 0600, encryption)"
F="$ROOT/README.md"
miss=""
grep -q "Loader-hijack denylist" "$F" || miss="$miss denylist"
grep -qE "0600|0700" "$F" || miss="$miss file-mode"
grep -q "Encryption at rest" "$F" || miss="$miss encryption"
[[ -z "$miss" ]] && ok || bad "defence-in-depth block missing:$miss"

step "8. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-aidefence-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "9. both skills have valid frontmatter"
miss=""
for s in safety-scan pii-detect; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "10. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

# M1. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: userConfig defaults are safe (guard on)"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(c.guard && c.guard.default === "on" ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

step "M4. mod: /aidefence-mod is registered and collides with no command or skill of the plugin"
if grep -q "name: 'aidefence-mod'" "$ROOT/hooks/register.ts" && [[ ! -e "$ROOT/commands/aidefence-mod.md" && ! -e "$ROOT/skills/aidefence-mod" ]]; then ok; else bad "command name missing or taken"; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
