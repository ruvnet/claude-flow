#!/usr/bin/env bash
# Structural + security smoke for ruflo-mods v0.5.1 (ADR-404, ADR-447).
# Static only: CI has no Claude Code, so the hooks module's behaviour is held
# by v3/@claude-flow/cli/__tests__/mods/*.test.ts and, where function hooks are
# on, by `claude plugin test plugins/ruflo-mods`.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }
HOOKS="$ROOT/hooks"

step "1. plugin.json declares ruflo-mods 0.5.1"
grep -q '"name": "ruflo-mods"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q '"version": "0.5.1"' "$ROOT/.claude-plugin/plugin.json" && ok || bad "name/version"

step "2. hooks.json names exactly one module and no classic hook commands"
grep -q '"modules": \["./register.ts"\]' "$HOOKS/hooks.json" && ! grep -q '"command"' "$HOOKS/hooks.json" \
  && ok || bad "hooks.json must be modules-only"

step "3. no import reaches outside the plugin folder"
# Modules live at most one folder below hooks/, so `../../` already leaves
# hooks/; the engine refuses anything outside the plugin, this keeps it to hooks/.
deep=$(grep -rnE "from ['\"](\.\./){2,}" "$HOOKS" || true)
[[ -z "$deep" ]] && ok || bad "$deep"

step "4. no network, process, model or MCP calls (no network by default)"
hits=$(grep -rnE '\$\.(http|process|model|mcp)\.' "$HOOKS" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "5. only the documented events are hooked"
events=$(grep -rhoE "on\('[a-z.*]+'" "$HOOKS" | sort -u | tr '\n' ' ')
expected="on('*' on('agent.offer' on('agent.spawn' on('command.run' on('engine.create' on('plugin.register' on('prompt.submit' on('session.compact' on('session.end' on('session.measure' on('session.receive' on('session.send' on('session.start' on('tool.call' on('tool.check' on('tool.describe' on('turn.complete' "
[[ "$events" == "$expected" ]] && ok || bad "got: $events"

step "6. tool.check merges with stricter() (tighten-only)"
grep -q "stricter(chain" "$HOOKS/guard/index.ts" && ! grep -qE "decision: 'allow'" "$HOOKS/guard/index.ts" "$HOOKS/guard/policy.ts" \
  && ok || bad "guard must never answer allow of its own"

step "7. the only environment variable written is the handshake"
envw=$(grep -rhoE "\\\$\.env\.set\('[A-Z_]+'" "$HOOKS" | sort -u | tr '\n' ' ')
[[ "$envw" == "\$.env.set('RUFLO_MODS_OWNS' " ]] && ok || bad "got: $envw"

step "8. no secrets or credentials in the module"
sec=$(grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" "$HOOKS" || true)
[[ -z "$sec" ]] && ok || bad "$sec"

step "9. every hooks file is under 500 lines"
long=$(find "$HOOKS" -name '*.ts' -exec awk 'END { if (NR > 500) print FILENAME }' {} \;)
[[ -z "$long" ]] && ok || bad "$long"

step "10. the \$.ruflo contract is declared and flat (one input per method)"
grep -q '"types": "./types/index.d.ts"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q "ruflo: Ruflo" "$ROOT/types/index.d.ts" \
  && ! grep -qE "^\s+[a-z]+: \{" "$ROOT/types/index.d.ts" && ok || bad "types/index.d.ts must declare a flat Ruflo noun"

step "11. guidance observations cannot train or promote"
hits=$(grep -rnE '(hooks_post-task|outcomeAccepted|applyPromotions|runCycle|optimize\(|events\.ndjson)' "$HOOKS/guidance" || true)
[[ -z "$hits" ]] && grep -q 'learningEligible: false' "$HOOKS/guidance/observations.ts" && ok || bad "guidance must remain candidate-only"

step "12. the capability probe is observability only and lists every event hooked"
missing=""
for ev in $(grep -rhoE "on\('[a-z.]+'" "$HOOKS" | sed -E "s/on\('(.*)'/\1/" | sort -u); do
  grep -q "'$ev'" "$HOOKS/probe/index.ts" || missing="$missing $ev"
done
[[ -z "$missing" ]] && ! grep -nE "decision|deny|consumed|isDelivered|\\$\.(fs|env|ui)\." "$HOOKS/probe/index.ts" >/dev/null \
  && ok || bad "probe event list missing:$missing, or the probe answers/writes"

step "13. every userConfig option key has a README row"
missing=""
for key in $(grep -oE "^    \"[A-Za-z]+\": \\{" "$ROOT/.claude-plugin/plugin.json" | sed -nE "s/^ *\"([A-Za-z]+)\".*/\\1/p"); do
  [[ "$(grep -c "^| \`$key\` |" "$ROOT/README.md")" == "1" ]] || missing="$missing $key"
done
[[ -z "$missing" ]] && ok || bad "README option row missing or duplicated:$missing"

step "14. every plugin's toast policy copy is byte-identical to the canonical hooks/toast/policy.ts (ADR-477)"
if [[ -f "$ROOT/../../scripts/sync-toast-policy.mjs" ]] && command -v node >/dev/null 2>&1; then
  out=$(node "$ROOT/../../scripts/sync-toast-policy.mjs" --check 2>&1) && ok || bad "$out"
else printf "SKIP (no node or no repo scripts/)\n"; fi

step "15. the optional ruvnet-brain status is detect-only: no hook, verdict, write, call or prompt from grounding.ts, no brain tool id anywhere (ADR-487)"
hits=$(grep -nE "\\bon\\(|decision|deny|\\\$\\.|\\.write|spawn|tool\\.call|submit" "$HOOKS/grounding.ts" | grep -vE '^[0-9]+:\s*(\*|//|/\*)' || true)
ids=$(grep -rnE "mcp__plugin_ruvnet|plugin_ruvnet-brain|search_ruvnet" "$HOOKS" || true)
[[ -z "$hits" && -z "$ids" ]] && ok || bad "grounding.ts must only read and report: $hits $ids"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
