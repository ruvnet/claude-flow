#!/usr/bin/env bash
# Structural + security smoke for ruflo-console. Static checks first (CI has no Claude Code), then the pure vitest
# specs. The hooks module's behaviour is held by `claude plugin test plugins/ruflo-console` where function hooks are on.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
HOOKS="$ROOT/hooks"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares ruflo-console 0.43.0"
grep -q '"name": "ruflo-console"' "$ROOT/.claude-plugin/plugin.json" \
  && grep -q '"version": "0.43.0"' "$ROOT/.claude-plugin/plugin.json" && ok || bad "name/version"

step "2. hooks.json names exactly one module and no classic hook commands"
grep -q '"modules": \["./register.ts"\]' "$HOOKS/hooks.json" && ! grep -q '"command"' "$HOOKS/hooks.json" \
  && ok || bad "hooks.json must be modules-only"

step "3. no Node, Buffer or dynamic import in the module"
hits=$(grep -rnE "from ['\"]node:|\bBuffer\b|\bimport\(|require\(" "$HOOKS" || true)
[[ -z "$hits" ]] && ok || bad "$hits"

step "4. no import reaches outside the plugin folder"
deep=$(grep -rnE "from ['\"](\.\./){3,}" "$HOOKS" || true)
[[ -z "$deep" ]] && ok || bad "$deep"

step "5. the module's network calls are two: the update check's GET (\$.http in register.ts fetchText, used by update-flow.ts alone) and the conversation bridge's send (ADR-465: host.httpSend, used by data/wf-send.ts and wf-convo-live.ts alone, behind a confirm card), and \$ is touched in register.ts only"
# Code lines only: comments may name the calls they explain.
http=$(grep -rnE '\$\.http\.' "$HOOKS" | grep -vE '^[^:]+:[0-9]+:\s*(\*|//|/\*)' || true)
# Exactly one is allowed (ADR-429): it goes through the engine, so an administrator's policy can refuse it, and nothing but update-flow.ts calls fetchText.
extra=$(printf '%s\n' "$http" | grep . | grep -vE '/register\.ts:[0-9]+: *const response = await \$\.http\.fetch\(url(, init)?\)$' || true)
count=$(printf '%s\n' "$http" | grep -c . || true)
sends=$(grep -rlE '\bhttpSend\b' "$HOOKS" | grep -vE '/(host|register|data/wf-send|wf-convo-live)\.ts$' || true)
users=$(grep -rlE '\bfetchText\b' "$HOOKS" | grep -vE '/(host|register|update-flow)\.ts$' || true)
outside=$(grep -rnE '\$\.(fs|process|ui|clock|store|env|ruflo|tool|session|settings|command)\.' "$HOOKS" | grep -vE '^[^:]+:[0-9]+:\s*(\*|//|/\*)' | grep -v '/register.ts:' || true)
[[ -z "$extra" && "$count" == "2" && -z "$users" && -z "$sends" && -z "$outside" ]] && ok || bad "http: $http fetchText used by: $users httpSend used by: $sends outside: $outside"

step "6. never runs plugins list or verify (network); roster, registry, claims and sync are the network probes, all behind the federationNetwork option"
cmds=$(grep -nE "args: \['(plugins|verify)'" "$HOOKS/data/cli.ts" || true)
net=$(grep -rc "isNetwork: true" "$HOOKS/data" | awk -F: '{ n += $2 } END { print n }')
[[ -z "$cmds" && "$net" == "4" ]] && grep -q "federationNetwork" "$HOOKS/controller.ts" && ok || bad "cmds: $cmds network probes: $net"

step "7. private key files are never read paths"
# The federation folder is listed for its file names (node ids); a key file's path never reaches fs.read.
keys=$(grep -nE "(key-[^'\"]*\.json|channels\.json|nostr\.key)" "$HOOKS/data/files.ts" | grep -vE "^\s*[0-9]+:\s*(\*|//)|NOSTR_KEY = |test\(entry\.name\)" || true)
grep -q "fs.stat(under(home, NOSTR_KEY))" "$HOOKS/data/files.ts" && [[ -z "$keys" ]] && ok || bad "$keys"

step "8. mutations only through fixed argv (claims_* via JSON.stringify), behind a confirm"
grep -q "JSON.stringify(params)" "$HOOKS/actions.ts" \
  && [[ "$(grep -ohE "exec\('claims_[a-z-]+'" "$HOOKS/actions.ts" "$HOOKS/ops.ts" | sort -u | tr '\n' ' ')" == "exec('claims_claim' exec('claims_handoff' exec('claims_release' exec('claims_status' exec('claims_steal' " ]] \
  && grep -q "state.pending = " "$HOOKS/runner.ts" && ! grep -qE "'(sh|bash)', '-c'" -r --exclude=write-flavor.ts "$HOOKS" \
  && [[ "$(grep -cE "'(sh|bash)', '-c'" "$HOOKS/data/write-flavor.ts")" == 1 ]] \
  && grep -qF "['sh', '-c', POSIX_SCRIPTS[op], 'sh', path, ...(source === undefined ? [] : [source])]" "$HOOKS/data/write-flavor.ts" \
  && [[ "$(awk '/POSIX_SCRIPTS = Object.freeze\(\{/{on=1;next} on&&/^\}/{on=0} on' "$HOOKS/data/write-flavor.ts" | sed -nE 's/^  ([A-Za-z]+): .*/\1/p' | sort | tr '\n' ' ')" == "append copyExclusive createExclusive createExclusiveWithDirs replace replaceWithDirs touch " ]] \
  && ok || bad "action surface changed"
# The one shell: data/write-flavor.ts, the macOS/BSD file writes (BSD dd/install lack oflag=append, conv=excl, -D). It runs only a script
# from the frozen POSIX_SCRIPTS set (exactly these seven), by key, with the path as "$1" (a copy's source as "$2"); no exported builder takes a script.
# tests/write-argv.spec.ts checks each script: the link/non-regular guard first, "$1" always quoted, no other parameter.

step "9. plugin.register and tool.call are observed, never answered (but the console's own tools, ADR-444)"
reg=$(awk '/on\(.plugin.register./,/^  }\)/' "$HOOKS/register.ts" | grep -cE "refuse:|deny:")
tool=$(awk '/on\(.tool.call./,/^  }\)/' "$HOOKS/register.ts" | grep -cE "deny|result:")
# The one exception: model-tools.ts answers tool.call for the console's own mcp__ruflo-console__ names, nowhere else; tool.check is only ever observed.
others=$(grep -rln "on('tool.call'" "$HOOKS" | grep -vE "/(register|model-tools)\.ts$" || true)
own=$(grep -c "tool: \`\${TOOL_PREFIX}" "$HOOKS/model-tools.ts")
anycall=$(grep -c "on('tool.call'" "$HOOKS/model-tools.ts")
check=$(grep -rln "on('tool.check'" "$HOOKS" | grep -v '/register\.ts$' || true)$(awk '/on\(.tool.check./,/^  }\)/' "$HOOKS/register.ts" | grep -cE "return \{" | grep -v '^0$' || true)
[[ "$reg" == "0" && "$tool" == "0" && -z "$others" && "$own" == "$anycall" && "$anycall" -ge 1 && -z "$check" ]] && ok || bad "plugin.register answers: $reg tool.call answers: $tool; other files: $others; unmatched tool.call in model-tools: $anycall/$own; tool.check: $check"

step "10. no secrets or credentials in the module"
sec=$(grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" "$HOOKS" || true)
[[ -z "$sec" ]] && ok || bad "$sec"

step "11. every source file is under 500 lines"
long=$(find "$HOOKS" "$ROOT/tests" "$ROOT/scripts" -name '*.ts' -not -path '*/fixtures/ruflo-run.ts' -exec awk 'END { if (NR > 500) print FILENAME }' {} \;)
[[ -z "$long" ]] && ok || bad "$long"

step "12. kit tests are off the root vitest run (it cannot resolve claude-code/testing): in the CI baseline or the excluded list"
miss=""
for f in "$ROOT"/tests/*.test.ts; do
  name="plugins/ruflo-console/tests/$(basename "$f")"
  grep -qx "$name" "$REPO/scripts/ci-test-baseline.txt" || grep -qx "$name" "$REPO/scripts/ci-test-excluded.txt" || miss="$miss $(basename "$f")"
done
[[ -z "$miss" ]] && ok || bad "in neither the CI baseline nor the excluded list:$miss"

step "13. marketplace lists ruflo-console"
grep -q '"name": "ruflo-console"' "$REPO/.claude-plugin/marketplace.json" && ok || bad "missing marketplace entry"

step "14. every pure spec passes under vitest"
# On failure keep the failing specs' own lines on stderr: the fleet JSON report captures stderrTail.
# History (2026-10-05): this step failed in CI on branches that did not touch the console. A local reproduction found one cause, a load-induced
# timeout: seven specs `await import(...)` a heavy module graph inside the test (about 1.4 s alone, over vitest's default 5 s under the CPU
# contention of the parallel fleet smoke), so the test timeout is raised to 30 s. The slower metaharness-less CI job still failed afterwards with
# no detail in its log, so a failure is now run once more: a load-induced failure does not repeat, a real one does and still fails the step.
# The first run's failing lines are always kept on stderr, so a retry that passes still leaves its evidence.
run_vitest() { (cd "$REPO" && npx vitest run plugins/ruflo-console/tests/ --exclude '**/*.test.ts' --testTimeout=30000 2>&1); }
failing_lines() { printf '%s\n' "$1" | sed 's/\x1b\[[0-9;]*m//g' | grep -E "FAIL|×|AssertionError|Error:|Timeout|timed out|Cannot find|Test Files|Tests " | head -25; }
if vitest_out=$(run_vitest); then ok; else
  first_out="$vitest_out"
  echo "step 14: first vitest run failed; the failing lines follow, then it runs once more" >&2
  failing_lines "$first_out" >&2
  if vitest_out=$(run_vitest); then ok; echo "step 14: passed on the second run (the first failure did not repeat)" >&2; else
    bad "vitest specs failed twice: $(failing_lines "$vitest_out" | grep -m1 -E 'FAIL' | cut -c1-160)"
    failing_lines "$vitest_out" >&2
  fi
fi

step "15. the live no-spend e2e smoke exists, is executable and skips cleanly without RUFLO_E2E_LIVE"
if [[ -x "$ROOT/scripts/e2e-smoke.sh" ]] && bash "$ROOT/scripts/e2e-smoke.sh" 2>&1 | grep -q '^SKIP'; then ok; else bad "e2e-smoke.sh"; fi

step "16. every view has a matrix entry and an ask entry"
if [[ "$(grep -c "{ id: '[a-z]*', key: '[0-9a-z]*'" "$ROOT/hooks/state.ts")" -eq "$(grep -cE "^  [a-z]+: \{ default:" "$ROOT/hooks/ask-claude.ts" | awk '{print $1 - 1}')" ]]; then ok; else bad "VIEW_ASK does not cover VIEWS"; fi

step "17. the toast policy copy is byte-identical to the canonical one (ADR-477)"
if [[ ! -f "$ROOT/../ruflo-mods/hooks/toast/policy.ts" ]]; then printf "SKIP (ruflo-mods is not beside this plugin)\n"
elif cmp -s "$ROOT/../ruflo-mods/hooks/toast/policy.ts" "$HOOKS/toast-policy.ts"; then ok
else bad "differs from ruflo-mods/hooks/toast/policy.ts: node scripts/sync-toast-policy.mjs"; fi

step "18. CHANGELOG.md has an entry for the manifest version, and the What's new page makes no request of its own (ADR-478)"
version=$(sed -n 's/^  "version": "\([0-9.]*\)".*/\1/p' "$ROOT/.claude-plugin/plugin.json" | head -1)
if grep -qE "^## ${version//./\\.} [—–-] [0-9]{4}-[0-9]{2}-[0-9]{2}\s*$" "$ROOT/CHANGELOG.md" 2>/dev/null \
  && ! grep -qE "fetchText|httpSend|\\.run\(|spawn" "$HOOKS/whatsnew.ts" "$HOOKS/views/whatsnew.ts" "$HOOKS/data/changelog.ts"; then ok; else bad "CHANGELOG.md lacks ## $version, or whatsnew code reaches the network"; fi

step "19. the ADR code reads and writes only the project's files: no network, no shell, no ruflo-repo path (ADR-480)"
if ! grep -qE "fetchText|httpSend|spawn\(|v3/docs/adr|check-adr-links|\bsh -c|bash -c" "$HOOKS/adr.ts" "$HOOKS/adr-palette.ts" "$HOOKS/views/adr.ts" "$HOOKS/data/adr.ts" "$HOOKS/data/adr-write.ts" "$HOOKS/data/adr-scope.ts"; then ok; else bad "an ADR module reaches the network, a shell or a ruflo path"; fi

step "20. the optional ruvnet-brain aid is detect-only and removable: no tool call, shell, network, write or prompt from grounding.ts, no brain tool id anywhere, nothing of the brain vendored (ADR-487)"
brain_calls=$(grep -nE "toolCall|toolCheck|\\\$\\.tool|\\.run\\(|spawn|fetchText|httpSend|storeSet|fillPrompt|submitPrompt|\\.fs\\." "$HOOKS/grounding.ts" | grep -vE '^[0-9]+:\s*(\*|//|/\*)' || true)
brain_ids=$(grep -rnE "mcp__plugin_ruvnet|plugin_ruvnet-brain" "$HOOKS" || true)
brain_files=$(find "$ROOT" -iname '*ruvnet-brain*' -not -path '*/node_modules/*' 2>/dev/null || true)
[[ -z "$brain_calls" && -z "$brain_ids" && -z "$brain_files" ]] && ok || bad "calls: $brain_calls ids: $brain_ids files: $brain_files"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]]
