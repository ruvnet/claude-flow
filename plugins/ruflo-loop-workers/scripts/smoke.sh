#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.3.6 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.3.6" ]]; then bad "expected 0.3.6, got '$v'"; else
  miss=""
  for k in mcp background-workers cache-aware schedule-wakeup; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. both skills + agent + 2 commands present"
miss=""
for s in loop-worker cron-schedule; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-$s"; continue; }
  for k in 'name:' 'description:' 'allowed-tools:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
[[ -f "$ROOT/agents/loop-worker-coordinator.md" ]] || miss="$miss missing-agent"
[[ -f "$ROOT/commands/ruflo-loop.md" ]] || miss="$miss missing-loop-cmd"
[[ -f "$ROOT/commands/ruflo-schedule.md" ]] || miss="$miss missing-schedule-cmd"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. all 5 hooks_worker-* MCP tools referenced"
miss=""
for t in hooks_worker-list hooks_worker-dispatch hooks_worker-status hooks_worker-detect hooks_worker-cancel; do
  grep -rq "$t" "$ROOT" --include='*.md' || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "undocumented:$miss"

step "4. all 12 worker triggers documented"
F="$ROOT/README.md"
miss=""
for trigger in ultralearn optimize consolidate predict audit map preload deepdive document refactor benchmark testgaps; do
  grep -q "$trigger" "$F" || miss="$miss $trigger"
done
[[ -z "$miss" ]] && ok || bad "missing triggers:$miss"

step "5. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "6. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -q "Namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "7. worker-history namespace claimed"
grep -q "worker-history" "$ROOT/README.md" \
  && ok || bad "worker-history namespace not claimed"

step "8. 270s cache-aware ScheduleWakeup documented"
F="$ROOT/README.md"
grep -qE "270 ?s|270 second" "$F" \
  && grep -qE "cache|prompt cache" "$F" \
  && ok || bad "270s cache-aware note missing"

step "9. ruflo-autopilot 270s heartbeat contract cross-reference"
F="$ROOT/README.md"
grep -q "ruflo-autopilot" "$F" \
  && grep -qE "270s|270 ?second" "$F" \
  && ok || bad "autopilot heartbeat cross-reference missing"

step "10. worker-trigger → consumer-plugin attribution table present"
F="$ROOT/README.md"
miss=""
grep -q "Consumer plugin" "$F" || miss="$miss header"
grep -q "ruflo-docs" "$F" || miss="$miss docs-attribution"
grep -q "ruflo-testgen" "$F" || miss="$miss testgen-attribution"
[[ -z "$miss" ]] && ok || bad "$miss"

step "11. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-loop-workers-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "12. no wildcard tool grants in skills"
bad_skills=""
for f in "$ROOT"/skills/*/SKILL.md; do
  grep -q '^allowed-tools:[[:space:]]*\*' "$f" && bad_skills="$bad_skills $(basename $(dirname "$f"))"
done
[[ -z "$bad_skills" ]] && ok || bad "wildcard:$bad_skills"

# M1-M3. The mod (ADR-445): hooks module registered, files within the 500-line rule, no network or process access in the hooks
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen guard register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: guard defaults on (userConfig), the command name is loop-mod"
node -e '
const c = require(process.argv[1]).userConfig || {}
process.exit(c.guard && c.guard.default === "on" ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" && grep -q "'loop-mod'" "$ROOT/hooks/register.ts" && ok || bad "userConfig defaults or command name wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
