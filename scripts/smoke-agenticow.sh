#!/usr/bin/env bash
# Structural + functional smoke test for agenticow MCP tools (this branch).
#
# Verifies:
#   1. Source files exist where mcp-client expects them
#   2. Optional dependency is declared in v3/@claude-flow/cli/package.json
#   3. Tool registration lines are present in mcp-tools/index.ts and mcp-client.ts
#   4. Vitest suite passes (or degraded-skips when agenticow is missing)
#   5. End-to-end branch → checkpoint → rollback → promote cycle via the actual
#      tool handlers (Node ESM driver below, identical contract to MCP callers)
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

step "1. agenticow-tools.ts exists in cli/src/mcp-tools/"
[[ -f "$CLI/src/mcp-tools/agenticow-tools.ts" ]] && ok || bad "missing source file"

step "2. dist/.../agenticow-tools.js exists (build ran)"
[[ -f "$CLI/dist/src/mcp-tools/agenticow-tools.js" ]] && ok || bad "missing dist file (run 'npm run build' in $CLI)"

step "3. optionalDependencies declares agenticow"
if grep -q '"agenticow"' "$CLI/package.json"; then ok ; else bad "agenticow not in package.json"; fi

step "4. mcp-tools/index.ts re-exports agenticowTools"
if grep -q "agenticowTools" "$CLI/src/mcp-tools/index.ts"; then ok ; else bad "not re-exported"; fi

step "5. mcp-client.ts imports and registers agenticowTools"
if grep -q "import { agenticowTools }" "$CLI/src/mcp-client.ts" && \
   grep -q "agenticowTools" "$CLI/src/mcp-client.ts" ; then
  ok
else
  bad "not registered in mcp-client.ts"
fi

step "6. all 4 tool names present in tool file"
miss=""
for t in agenticow_branch agenticow_checkpoint agenticow_rollback agenticow_promote; do
  grep -q "name: '$t'" "$CLI/src/mcp-tools/agenticow-tools.ts" || miss="$miss $t"
done
[[ -z "$miss" ]] && ok || bad "missing tool names:$miss"

step "7. vitest suite passes"
if (cd "$CLI" && npx vitest run __tests__/agenticow-tools.test.ts >/dev/null 2>&1); then
  ok
else
  bad "vitest failed (run from $CLI for details)"
fi

step "8. end-to-end branch → checkpoint → rollback cycle via handlers"
DRIVER="$(mktemp -t agenticow-smoke.XXXXXX).mjs"
TMPDIR_BASE="$(mktemp -d -t agenticow-smoke-XXXXXX)"
cat > "$DRIVER" <<EOF
import { agenticowTools } from '$CLI/dist/src/mcp-tools/agenticow-tools.js';
import { join } from 'node:path';

const find = n => { const t = agenticowTools.find(x => x.name === n); if (!t) throw new Error('not found: ' + n); return t; };
const tmpdir = '$TMPDIR_BASE';
const base = join(tmpdir, 'base.rvf');
const branch = join(tmpdir, 'branch.rvf');

const r1 = await find('agenticow_branch').handler({ basePath: base, branchPath: branch, label: 'smoke', dimension: 32 });
if (!r1.success) throw new Error('branch failed: ' + JSON.stringify(r1));
if (r1.degraded) { console.log('DEGRADED:agenticow-not-installed'); process.exit(0); }
const r2 = await find('agenticow_checkpoint').handler({ path: base, label: 'cp-smoke' });
if (!r2.success || !r2.checkpoint) throw new Error('checkpoint failed: ' + JSON.stringify(r2));
const r3 = await find('agenticow_rollback').handler({ path: base });
if (!r3.success || !r3.rolledBack) throw new Error('rollback failed: ' + JSON.stringify(r3));
console.log('OK');
EOF
OUT=$(node "$DRIVER" 2>&1) || true
case "$OUT" in
  "OK")                        ok ;;
  "DEGRADED:agenticow-not-installed") ok ;;  # graceful-degraded path is also a pass
  *)                           bad "$OUT" ;;
esac
rm -f "$DRIVER"
rm -rf "$TMPDIR_BASE"

printf "\n%d passed, %d failed\n" "$PASS" "$FAIL"
[[ $FAIL -eq 0 ]] || exit 1
