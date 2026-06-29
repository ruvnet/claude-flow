#!/usr/bin/env bash
# Structural + functional smoke test for agentbbs MCP tools (ADR-164 Phase 1).
#
# Verifies:
#   1. Source files exist where mcp-client expects them
#   2. dist artifact exists (build ran)
#   3. Optional dependency is declared in v3/@claude-flow/cli/package.json
#   4. Tool registration lines are present in mcp-tools/index.ts
#   5. mcp-client.ts imports + registers agentbbsTools
#   6. all 4 tool names present in the source file
#   7. Vitest suite passes
#   8. End-to-end register → publish → watch cycle via dist handlers
#      (accepts DEGRADED:agentbbs-not-found as a pass — graceful degradation)
#
# Exit 0 = all PASS; exit 1 = at least one FAIL.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/v3/@claude-flow/cli"
PASS=0
FAIL=0
step() { printf "→ %s ... " "$1"; }
ok()   { printf "PASS\n"; PASS=$((PASS+1)); }
bad()  { printf "FAIL: %s\n" "$1"; FAIL=$((FAIL+1)); }

step "1. agentbbs-tools.ts exists in cli/src/mcp-tools/"
[[ -f "$CLI/src/mcp-tools/agentbbs-tools.ts" ]] && ok || bad "missing source file"

step "2. dist/.../agentbbs-tools.js exists (build ran)"
[[ -f "$CLI/dist/src/mcp-tools/agentbbs-tools.js" ]] && ok || bad "missing dist file (run 'npm run build' in $CLI)"

step "3. optionalDependencies declares agentbbs"
if grep -q '"agentbbs"' "$CLI/package.json"; then ok ; else bad "agentbbs not in package.json"; fi

step "4. mcp-tools/index.ts re-exports agentbbsTools"
if grep -q "agentbbsTools" "$CLI/src/mcp-tools/index.ts"; then ok ; else bad "not re-exported"; fi

step "5. mcp-client.ts imports and registers agentbbsTools"
if grep -q "import { agentbbsTools }" "$CLI/src/mcp-client.ts" && \
   grep -q "\.\.\.agentbbsTools" "$CLI/src/mcp-client.ts" ; then
  ok
else
  bad "not registered in mcp-client.ts"
fi

step "6. all 4 tool names present in tool file"
miss=""
for t in federation_bbs_register federation_bbs_publish federation_bbs_watch federation_bbs_human_join; do
  grep -q "name: '$t'" "$CLI/src/mcp-tools/agentbbs-tools.ts" || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "missing tool names:$miss"

step "7. vitest suite passes"
if (cd "$CLI" && npx vitest run __tests__/agentbbs-tools.test.ts >/dev/null 2>&1); then
  ok
else
  bad "vitest failed (run from $CLI for details)"
fi

step "8. end-to-end register → publish → watch cycle via handlers"
DRIVER="$(mktemp -t agentbbs-smoke.XXXXXX).mjs"
TMPDIR_BASE="$(mktemp -d -t agentbbs-smoke-XXXXXX)"
cat > "$DRIVER" <<EOF
import { agentbbsTools } from '$CLI/dist/src/mcp-tools/agentbbs-tools.js';

const find = n => { const t = agentbbsTools.find(x => x.name === n); if (!t) throw new Error('not found: ' + n); return t; };

const r1 = await find('federation_bbs_register').handler({ basePath: '$TMPDIR_BASE', roomLabel: '#sales' });
if (!r1.success) throw new Error('register failed: ' + JSON.stringify(r1));
if (r1.degraded) { console.log('DEGRADED:agentbbs-not-found'); process.exit(0); }

const roomId = r1.roomId;
const r2 = await find('federation_bbs_publish').handler({
  basePath: '$TMPDIR_BASE', roomId, msgType: 'task-result',
  payload: { agent: 'smoke', leads: 1 },
});
if (!r2.success || !r2.envelopeId) throw new Error('publish failed: ' + JSON.stringify(r2));

const r3 = await find('federation_bbs_watch').handler({ basePath: '$TMPDIR_BASE', roomId });
if (!r3.success || r3.count < 1) throw new Error('watch failed: ' + JSON.stringify(r3));

const r4 = await find('federation_bbs_human_join').handler({ roomId, ttlSeconds: 120 });
if (!r4.success || !r4.handshakeToken) throw new Error('human_join failed: ' + JSON.stringify(r4));

console.log('OK');
EOF
OUT=$(node "$DRIVER" 2>&1) || true
case "$OUT" in
  "OK")                              ok ;;
  "DEGRADED:agentbbs-not-found")     ok ;;  # graceful-degraded path is also a pass
  *)                                 bad "$OUT" ;;
esac
rm -f "$DRIVER"
rm -rf "$TMPDIR_BASE"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
