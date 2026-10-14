#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. plugin.json declares 0.3.4 with new keywords"
v=$(grep -E '"version"' "$ROOT/.claude-plugin/plugin.json" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
if [[ "$v" != "0.3.4" ]]; then bad "expected 0.3.4, got '$v'"; else
  miss=""
  for k in mcp cognitum-seed 5-tier-trust; do
    grep -q "\"$k\"" "$ROOT/.claude-plugin/plugin.json" || miss="$miss $k"
  done
  [[ -z "$miss" ]] && ok || bad "missing keywords:$miss"
fi

step "2. all 5 skills + 4 agents + 1 command present"
miss=""
for s in iot-register iot-fleet iot-anomalies iot-firmware iot-witness-verify; do
  f="$ROOT/skills/$s/SKILL.md"
  [[ -f "$f" ]] || { miss="$miss missing-skill-$s"; continue; }
  for k in 'name:' 'description:'; do
    grep -q "^$k" "$f" || miss="$miss $s-no-$k"
  done
done
for a in device-coordinator fleet-manager telemetry-analyzer witness-auditor; do
  [[ -f "$ROOT/agents/$a.md" ]] || miss="$miss missing-agent-$a"
done
[[ -f "$ROOT/commands/iot.md" ]] || miss="$miss missing-command"
[[ -z "$miss" ]] && ok || bad "$miss"

step "3. /iot command covers core subcommand topics"
F="$ROOT/commands/iot.md"
[[ -s "$F" ]] && ok || bad "command file empty or missing"

step "4. 6 background workers documented (HealthProbe, TelemetryIngest, AnomalyScan, MeshSync, FirmwareWatch, WitnessAudit)"
F="$ROOT/README.md"
miss=""
for w in HealthProbeWorker TelemetryIngestWorker AnomalyScanWorker MeshSyncWorker FirmwareWatchWorker WitnessAuditWorker; do
  grep -q "$w" "$F" || miss="$miss $w"
done
[[ -z "$miss" ]] && ok || bad "$miss"

step "5. 5-tier device trust model documented"
F="$ROOT/README.md"
miss=""
for tier in UNTRUSTED VERIFIED ATTESTED TRUSTED PRIVILEGED; do
  grep -q "$tier" "$F" || miss="$miss $tier"
done
[[ -z "$miss" ]] && ok || bad "missing tiers:$miss"

step "6. Z-score anomaly types documented (spike/flatline/drift/oscillation/pattern-break/cluster-outlier)"
F="$ROOT/README.md"
miss=""
for t in spike flatline drift oscillation pattern-break cluster-outlier; do
  grep -q "$t" "$F" || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "missing anomaly types:$miss"

step "7. firmware rollout state machine documented"
F="$ROOT/README.md"
miss=""
for state in pending canary rolling complete rolled-back; do
  grep -q "$state" "$F" || miss="$miss $state"
done
[[ -z "$miss" ]] && ok || bad "missing states:$miss"

step "8. README pins @claude-flow/cli to v3.6"
grep -qE "@claude-flow/cli.*v3\.6|v3\.6.*claude-flow/cli" "$ROOT/README.md" \
  && ok || bad "v3.6 pin missing"

step "9. README defers to ruflo-agentdb namespace convention"
grep -q "ruflo-agentdb" "$ROOT/README.md" \
  && grep -qE "Namespace convention|namespace convention" "$ROOT/README.md" \
  && ok || bad "namespace coordination block incomplete"

step "10. ruflo-federation trust-model cross-reference present"
F="$ROOT/README.md"
grep -q "ruflo-federation" "$F" \
  && grep -qE "trust|trust model" "$F" \
  && ok || bad "federation trust-model parallel cross-reference missing"

step "11. ADR-0001 exists with status Accepted"
ADR="$ROOT/docs/adrs/0001-iot-cognitum-contract.md"
[[ -f "$ADR" ]] && grep -qE "^status:[[:space:]]*Accepted" "$ADR" \
  && ok || bad "ADR missing or status != Accepted"

step "12. REFERENCE.md exists and is non-empty"
[[ -s "$ROOT/REFERENCE.md" ]] && ok || bad "REFERENCE.md missing or empty"


# M1. The mod (ADR-445 pattern): hooks module registered, files within the 500-line rule
step "M1. mod: hooks.json names register.ts, every hook file is present and under 500 lines"
mod_ok=1
grep -q '"./register.ts"' "$ROOT/hooks/hooks.json" || mod_ok=0
for f in options screen tools guard command status register; do
  [[ -f "$ROOT/hooks/$f.ts" ]] || mod_ok=0
  [[ $(wc -l < "$ROOT/hooks/$f.ts" 2>/dev/null || echo 9999) -le 500 ]] || mod_ok=0
done
[[ $mod_ok -eq 1 ]] && ok || bad "mod hooks incomplete or too long"

step "M2. mod: userConfig defaults are the safe ones (guard confirmDestructive all on)"
node -e '
const c = require(process.argv[1]).userConfig || {}
const need = process.argv.slice(2)
process.exit(need.every(k => c[k] && c[k].default === "on") ? 0 : 1)
' "$ROOT/.claude-plugin/plugin.json" guard confirmDestructive && ok || bad "userConfig defaults wrong"

step "M3. mod: hooks never touch the network or spawn a process"
if grep -nE '\$\.(http|process)\.|child_process|fetch\(' "$ROOT"/hooks/*.ts >/dev/null; then bad "network or process call in hooks"; else ok; fi

printf "\n%s passed, %s failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
