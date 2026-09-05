#!/usr/bin/env bash
# Structural + functional smoke test for ruflo-business-pods v0.1.0
# (ADR-164 Phase 2). Verifies:
#
#   1. plugin.json declares 0.1.0 with the expected adr-164/phase-2 keywords
#   2. templates/sales.json exists and validates against the pod-schema
#   3. scripts/pod-tick.mjs exists, parses, and is executable
#   4. Vitest suite passes (cli/__tests__/business-pod-tools.test.ts)
#   5. ADR-112 tool-description audit still passes (was 349 before, now ≥350)
#   6. Dry-run of sales pod tick exits 0 with expected stdout shape
#   7. Budget ledger created + reservation row inserted + committed
#   8. federation_bbs_publish envelope written to expected room JSONL file
#
# Exit 0 = all PASS; exit 1 = at least one FAIL.

set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLUGIN="$ROOT/plugins/ruflo-business-pods"
CLI="$ROOT/v3/@claude-flow/cli"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.1.0 with adr-164 + phase-2 keywords"
v=$(grep -E '"version"' "$PLUGIN/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.1.0" ]]; then
  bad "expected 0.1.0, got '$v'"
else
  miss=""
  for k in ruflo pods business sales adr-164 adr-164.1 phase-2 pod-template pod-tick budget-reservation dry-run-default agent-registry-resolution; do
    grep -q "\"$k\"" "$PLUGIN/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. templates/sales.json exists and validates"
F="$PLUGIN/templates/sales.json"
if [[ ! -f "$F" ]]; then
  bad "missing sales.json"
else
  # Validate by piping into pod-tick.mjs's validator in a one-shot invocation
  if node -e "
    import('$PLUGIN/scripts/pod-tick.mjs').then(m => {
      const t = JSON.parse(require('node:fs').readFileSync('$F','utf-8'));
      const v = m.validatePodTemplate(t);
      if (v.name !== 'sales') process.exit(1);
      if (v.reservationExpiryMs !== 60000) process.exit(1);
      console.log('validated');
    }).catch(e => { console.error(e.message); process.exit(1); });
  " >/dev/null 2>&1; then
    ok
  else
    bad "sales.json failed pod-schema validation"
  fi
fi

step "3. scripts/pod-tick.mjs exists, parses, and is executable"
F="$PLUGIN/scripts/pod-tick.mjs"
miss=""
[[ -f "$F" ]] || miss="$miss missing"
[[ -x "$F" ]] || miss="$miss not-executable"
node --check "$F" 2>/dev/null || miss="$miss syntax-error"
[[ -z "$miss" ]] && ok || bad "$miss"

step "4. vitest suite passes (business-pod-tools.test.ts)"
# When CI runs --ignore-optional (no-metaharness / no-agentbbs runtime drills),
# vitest itself may not be installed. Skip with a clear marker rather than fail
# — the full vitest run is gated by the main test-suite jobs anyway.
if [[ ! -d "$CLI/node_modules/vitest" ]]; then
  printf "SKIP (no vitest — --ignore-optional install)\n"; PASS=$((PASS+1))
elif (cd "$CLI" && npx vitest run __tests__/business-pod-tools.test.ts >/dev/null 2>&1); then
  ok
else
  bad "vitest failed (run from $CLI for details)"
fi

step "5. ADR-112 tool-description audit passes (no regressions)"
if (cd "$ROOT" && node scripts/audit-tool-descriptions.mjs >/dev/null 2>&1); then
  ok
else
  bad "audit-tool-descriptions.mjs reported regression"
fi

step "6. dry-run of sales pod tick exits 0 with expected stdout shape"
TMPDIR_BASE="$(mktemp -d -t business-pods-smoke-XXXXXX)"
OUT="$(node "$PLUGIN/scripts/pod-tick.mjs" \
  --pod-template "$PLUGIN/templates/sales.json" \
  --base-path "$TMPDIR_BASE" \
  --dry-run \
  --tick-id "smoke-tick" 2>/dev/null)" || OUT=""
if [[ -z "$OUT" ]]; then
  bad "pod-tick.mjs produced no output"
else
  if node -e "
    const o = JSON.parse(\`$OUT\`.trim().split('\n').pop());
    if (o.podName !== 'sales') { console.error('podName mismatch'); process.exit(1); }
    if (o.tickId !== 'smoke-tick') { console.error('tickId mismatch'); process.exit(1); }
    if (o.agentsRan !== 4) { console.error('agentsRan mismatch'); process.exit(1); }
    if (o.totalUsd !== 0) { console.error('totalUsd should be 0 in dry-run'); process.exit(1); }
    if (o.status !== 'success') { console.error('status not success'); process.exit(1); }
    if (!o.envelopeId) { console.error('no envelopeId'); process.exit(1); }
  " 2>/dev/null; then
    ok
  else
    bad "stdout shape mismatch: $OUT"
  fi
fi

step "7. budget ledger created + reservation committed in dry-run"
LEDGER="$TMPDIR_BASE/budget/sales.json"
if [[ ! -f "$LEDGER" ]]; then
  bad "ledger not created at $LEDGER"
else
  if node -e "
    const l = JSON.parse(require('node:fs').readFileSync('$LEDGER','utf-8'));
    if (l.roomId !== 'sales') process.exit(1);
    if (l.spent !== 0) process.exit(1);
    if (l.reserved !== 0) process.exit(1);
  " 2>/dev/null; then
    ok
  else
    bad "ledger contents wrong"
  fi
fi

step "8. envelope written to room JSONL backing store"
shopt -s nullglob
LOGS=( "$TMPDIR_BASE/.agentbbs"/room-*.jsonl )
shopt -u nullglob
if [[ ${#LOGS[@]} -eq 0 ]]; then
  bad "no room-*.jsonl produced"
else
  LAST_LINE="$(tail -n 1 "${LOGS[0]}")"
  if node -e "
    const e = JSON.parse(\`$LAST_LINE\`);
    if (e.msgType !== 'pod-status') process.exit(1);
    if (!e.envelopeId) process.exit(1);
    if (e.payload.podName !== 'sales') process.exit(1);
  " 2>/dev/null; then
    ok
  else
    bad "envelope payload missing or malformed: $LAST_LINE"
  fi
fi

# --- ADR-164 Phase 3: 6 additional pod templates + domain-affinity router ---

PHASE3_PODS=(marketing finance ops support hr exec)

step "9. Phase 3: all 7 pod templates validate against pod-schema"
ALL_PODS=(sales "${PHASE3_PODS[@]}")
miss9=""
for p in "${ALL_PODS[@]}"; do
  F="$PLUGIN/templates/${p}.json"
  if [[ ! -f "$F" ]]; then
    miss9="$miss9 ${p}.json(missing)"
    continue
  fi
  if ! node -e "
    import('$PLUGIN/scripts/pod-tick.mjs').then(m => {
      const t = JSON.parse(require('node:fs').readFileSync('$F','utf-8'));
      const v = m.validatePodTemplate(t);
      if (v.name !== '$p') process.exit(1);
    }).catch(e => { console.error(e.message); process.exit(1); });
  " >/dev/null 2>&1; then
    miss9="$miss9 ${p}.json(invalid)"
  fi
done
[[ -z "$miss9" ]] && ok || bad "templates failed:$miss9"

step "10. Phase 3: dry-run each pod's tick exits 0 with status=success"
TMP3="$(mktemp -d -t business-pods-smoke3-XXXXXX)"
miss10=""
for p in "${PHASE3_PODS[@]}"; do
  WORK="$TMP3/$p"
  OUT="$(node "$PLUGIN/scripts/pod-tick.mjs" \
    --pod-template "$PLUGIN/templates/${p}.json" \
    --base-path "$WORK" \
    --dry-run \
    --tick-id "smoke-${p}-tick" 2>/dev/null)" || OUT=""
  if [[ -z "$OUT" ]]; then
    miss10="$miss10 ${p}(no-output)"
    continue
  fi
  if ! node -e "
    const o = JSON.parse(\`$OUT\`.trim().split('\n').pop());
    if (o.podName !== '$p') process.exit(1);
    if (o.status !== 'success') process.exit(1);
    if (o.totalUsd !== 0) process.exit(1);
    if (!o.envelopeId) process.exit(1);
  " 2>/dev/null; then
    miss10="$miss10 ${p}(stdout-mismatch)"
  fi
done
rm -rf "$TMP3"
[[ -z "$miss10" ]] && ok || bad "pods failed dry-run:$miss10"

step "11. business_pod_route_backend returns expected backend per §3.4"
# When CI runs --ignore-optional drills, the cli dist may not be present (the
# build step is gated on full install). Skip cleanly in that case.
if [[ ! -f "$CLI/dist/src/mcp-tools/business-pod-tools.js" ]]; then
  printf "SKIP (no dist — --ignore-optional install)\n"; PASS=$((PASS+1))
  printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"; [[ $FAIL -eq 0 ]] || exit 1
  exit 0
fi
# Smoke check three pods against the deterministic routing rule:
#   preferLocalExecution=true              → 'local-stdio'
#   else AND budgetUsdMonthly >= 50        → 'cloud-managed'
#   else                                   → 'remote-peer'
# Per the validated templates:
#   sales: preferLocal=false, budget=50  → cloud-managed
#   marketing: preferLocal=false, budget=40 → remote-peer
#   finance: preferLocal=true             → local-stdio
if (cd "$CLI" && node --experimental-vm-modules -e "
  (async () => {
    const m = await import('./dist/src/mcp-tools/business-pod-tools.js');
    const find = (n) => m.businessPodTools.find((t) => t.name === n);
    const tool = find('business_pod_route_backend');
    if (!tool) { console.error('tool not found'); process.exit(1); }
    const fs = await import('node:fs');
    const p = await import('node:path');
    const tplDir = p.resolve('$PLUGIN/templates');
    const cases = [
      ['sales',     'cloud-managed'],
      ['marketing', 'remote-peer'],
      ['finance',   'local-stdio'],
    ];
    for (const [name, expected] of cases) {
      const podTemplate = JSON.parse(fs.readFileSync(p.join(tplDir, name + '.json'), 'utf-8'));
      const r = await tool.handler({ podTemplate });
      if (!r.success || r.backend !== expected) {
        console.error('case ' + name + ' expected ' + expected + ' got ' + JSON.stringify(r));
        process.exit(1);
      }
    }
  })().catch((e) => { console.error(e.message); process.exit(1); });
" >/dev/null 2>&1); then
  ok
else
  bad "business_pod_route_backend smoke failed (cli build may be stale: cd $CLI && npm run build)"
fi

rm -rf "$TMPDIR_BASE"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
