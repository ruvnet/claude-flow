#!/usr/bin/env node
// test-oia-audit-findings.mjs — regression test for issue #2750.
//
// Both threat-model.mjs and mcp-scan.mjs had a guard:
//   if (r.exitCode !== 0 && r.exitCode !== 1) { process.exit(2); }
// that caught upstream's exit code 2 (HIGH verdict for threat-model)
// and bailed BEFORE emitting the JSON on stdout — so oia-audit's composite
// saw json:null and reported no findings. This test installs a FAKE
// metaharness cache (via RUFLO_METAHARNESS_CACHE_BASE +
// RUFLO_METAHARNESS_SKIP_LOCAL) whose `harness` shim emits exit 2 + HIGH
// JSON, then spawns the real wrappers and asserts they pass the JSON
// through instead of bailing with exit 2.
//
// USAGE
//   node scripts/test-oia-audit-findings.mjs
//
// EXIT CODES
//   0  all assertions pass
//   1  at least one assertion failed
//   2  setup error

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'ruflo-2750-'));

let passed = 0;
const failures = [];

function check(cond, label) {
  if (cond) { passed++; }
  else { failures.push(label); console.error(`  ✗ ${label}`); }
}

// Build a fake metaharness cache that _harness.mjs::resolveMetaharnessBins
// will pick up when RUFLO_METAHARNESS_SKIP_LOCAL=1 (skips walk-up node_modules)
// and RUFLO_METAHARNESS_CACHE_BASE=TMP (points the cache root at our fake).
// The cache layout is <base>/metaharness-cache-0.3.0/node_modules/metaharness/.
const fakeCacheRoot = TMP;
const fakePkgDir = join(fakeCacheRoot, 'metaharness-cache-0.3.0', 'node_modules', 'metaharness');
const fakeBinDir = join(fakePkgDir, 'bin');
mkdirSync(fakeBinDir, { recursive: true });

// Shim harness: emits a HIGH verdict JSON on stdout, then exits 2 (matches
// upstream harness threat-model convention for HIGH findings).
// NOTE: payload is flat (no nested objects) so parseTrailingJson's
// non-greedy match grabs the outer block. Nested objects in stdout are
// a separate parseTrailingJson limitation, not the #2750 guard bug.
const SHIM = `#!/usr/bin/env node
const sub = process.argv[2];
if (sub === 'threat-model') {
  process.stdout.write(JSON.stringify({
    worst: 'high',
    findings: [{ id: 'tm-1', severity: 'high', message: 'shellAccess detected' }],
    verdict: 'high'
  }));
  process.exit(2);
}
if (sub === 'mcp-scan') {
  process.stdout.write(JSON.stringify({
    findings: [{ id: 'F-001', severity: 'high', message: 'unsafe tool', server: 's1', tool: 't1' }],
    summary: 'high-1'
  }));
  process.exit(1);
}
process.exit(0);
`;
// _harness.mjs runs `node <absBinPath>`. Provide both bin entries (the
// bin map requires both metaharness + harness keys to be present).
writeFileSync(join(fakeBinDir, 'harness.js'), SHIM);
writeFileSync(join(fakeBinDir, 'metaharness.js'), SHIM);
writeFileSync(join(fakePkgDir, 'package.json'), JSON.stringify({
  name: 'metaharness',
  version: '0.3.0',
  bin: { metaharness: 'bin/metaharness.js', harness: 'bin/harness.js' },
}));

// Sanity: the fake cache is structurally complete.
check(existsSync(join(fakePkgDir, 'package.json')), 'fake cache: package.json present');
check(existsSync(join(fakeBinDir, 'harness.js')), 'fake cache: harness bin present');

const CHILD_ENV = {
  ...process.env,
  RUFLO_METAHARNESS_SKIP_LOCAL: '1',           // don't walk node_modules
  RUFLO_METAHARNESS_CACHE_BASE: fakeCacheRoot,  // use our fake cache root
};

// ─── threat-model: exit 2 + HIGH verdict must emit JSON, not bail ────────
const tmR = spawnSync('node', [
  join(SCRIPTS_DIR, 'threat-model.mjs'), '--path', TMP, '--fail-on', 'high',
], { env: CHILD_ENV, encoding: 'utf-8', timeout: 15_000 });

let tmJson = null;
try { tmJson = JSON.parse(tmR.stdout); }
catch (e) {
  check(false, `threat-model: stdout is valid JSON (got exit ${tmR.status}, stdout: ${(tmR.stdout||'').slice(0,120)})`);
}
if (tmJson) {
  check(tmJson.worst === 'high', `threat-model: payload.worst === 'high' (got ${tmJson.worst})`);
  check(Array.isArray(tmJson.findings) && tmJson.findings.length > 0,
    `threat-model: findings array non-empty (got ${tmJson.findings?.length})`);
  check(tmJson.alert?.triggered === true,
    `threat-model: alert.triggered === true for HIGH (got ${tmJson.alert?.triggered})`);
  check(tmJson.alert?.reason?.includes('high'),
    `threat-model: alert.reason mentions high`);
}
// exit 1 is correct: alert.triggered -> process.exit(1). Pre-fix: exit 2 (crash).
check(tmR.status === 1,
  `threat-model: exit 1 when alert triggered (got ${tmR.status}). Pre-fix: exit 2 (crash) discarded JSON.`);
// The core regression: wrapper must NOT exit 2 on upstream exit 2.
check(tmR.status !== 2,
  `threat-model: wrapper does NOT exit 2 on upstream exit 2 (got ${tmR.status})`);

// ─── mcp-scan: HIGH findings must emit JSON ──────────────────────────────
const msR = spawnSync('node', [
  join(SCRIPTS_DIR, 'mcp-scan.mjs'), '--path', TMP, '--fail-on', 'high',
], { env: CHILD_ENV, encoding: 'utf-8', timeout: 15_000 });

let msJson = null;
try { msJson = JSON.parse(msR.stdout); }
catch (e) {
  check(false, `mcp-scan: stdout is valid JSON (got exit ${msR.status}, stdout: ${(msR.stdout||'').slice(0,120)})`);
}
if (msJson) {
  check(Array.isArray(msJson.findings) && msJson.findings.length > 0,
    `mcp-scan: findings array non-empty (got ${msJson.findings?.length})`);
  check(msJson.findings[0]?.severity === 'high',
    `mcp-scan: first finding severity === high (got ${msJson.findings[0]?.severity})`);
  check(msJson.alert?.triggered === true,
    `mcp-scan: alert.triggered === true for HIGH findings`);
}
check(msR.status === 1,
  `mcp-scan: exit 1 when findings >= threshold (got ${msR.status})`);

// Cleanup
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`# test-oia-audit-findings — issue #2750 regression`);
console.log('');
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log('');
  console.log('Failures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('');
console.log('✓ oia-audit wrappers preserve findings on non-zero exit (#2750)');
