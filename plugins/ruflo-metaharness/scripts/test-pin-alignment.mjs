#!/usr/bin/env node
// test-pin-alignment.mjs — regression test for plugin helper pins that
// drifted away from the ranges @claude-flow/cli declares (#3366).
//
// THE BUG
// The plugin helpers carry their own tilde pins (_harness.mjs
// METAHARNESS_PIN_VERSION, _darwin.mjs DARWIN_PIN_VERSION). Those pins decide
// which INSTALLED copy `findLocalPackageDir()` accepts. They sat at ~0.3.0 /
// ~0.8.0 while v3/@claude-flow/cli/package.json declared metaharness ^0.4.1 and
// @metaharness/darwin ~0.10.2, so on a normal ruflo install every
// metaharness_* tool call rejected the copy ruflo ships and ran
// `npm install --prefix ~/.ruflo/metaharness-cache-0.3.0 metaharness@~0.3.0`
// at TOOL-CALL time (a network download of an older release; `degraded` when
// offline). scripts/check-metaharness-pins.mjs compared only the CLI's ranges,
// so nothing noticed.
//
// WHAT THIS TEST PROVES (hermetic — no network, no real MetaHarness package)
//   Phase 1  each helper pin accepts the declared range's floor AND a later
//            patch in it, using the same `satisfiesTildeRange()` predicate
//            findLocalPackageDir() applies at runtime.
//   Phase 2  end-to-end in the PUBLISHED layout
//            (<prefix>/node_modules/@claude-flow/cli/plugins/ruflo-metaharness/
//            scripts, next to <prefix>/node_modules/metaharness at the declared
//            floor version): metaharnessResolution() reports source 'local',
//            score.mjs returns the installed copy's output, and NOT ONE
//            npm / npx process is spawned (a PATH trap logs any attempt).
//   The scripts are copied into that layout because resolution walks up from
//   the helper's own directory; in the repo checkout (plugins/ at the repo
//   root) the walk never reaches an installed CLI's node_modules.
//
// USAGE
//   node plugins/ruflo-metaharness/scripts/test-pin-alignment.mjs
//
// EXIT CODES
//   0  all assertions passed (or skipped on win32 — the trap is POSIX sh)
//   1  at least one assertion failed
//   2  setup error

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PKG_JSON = join(SCRIPTS_DIR, '..', '..', '..', 'v3', '@claude-flow', 'cli', 'package.json');

if (process.platform === 'win32') {
  console.log('# test-pin-alignment — SKIPPED on win32 (the npm/npx trap is a POSIX sh script)');
  process.exit(0);
}
if (!existsSync(CLI_PKG_JSON)) {
  console.error(`test-pin-alignment: ${CLI_PKG_JSON} not found — run from a ruflo repo checkout`);
  process.exit(2);
}

let passed = 0, failed = 0;
const failures = [];
function assert(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (cond) passed++;
  else { failures.push(label); failed++; }
}

/** Same lookup order as scripts/check-metaharness-pins.mjs. */
function declaredRange(pkgJson, name) {
  for (const where of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (pkgJson[where]?.[name]) return pkgJson[where][name];
  }
  return null;
}
function floorOf(range) {
  const m = /^[~^]?(\d+)\.(\d+)\.(\d+)/.exec(String(range));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const cliPkg = JSON.parse(readFileSync(CLI_PKG_JSON, 'utf-8'));
const { satisfiesTildeRange } = await import(pathToFileURL(join(SCRIPTS_DIR, '_invoke.mjs')).href);
const { METAHARNESS_VERSION_PIN } = await import(pathToFileURL(join(SCRIPTS_DIR, '_harness.mjs')).href);
const { DARWIN_VERSION_PIN } = await import(pathToFileURL(join(SCRIPTS_DIR, '_darwin.mjs')).href);
const pinOf = (full) => full.slice(full.lastIndexOf('@') + 1);

console.log('# test-pin-alignment\n');

// ──────────────────────────────────────────────────────────────────────
// Phase 1 — every helper pin accepts what the CLI declares
// ──────────────────────────────────────────────────────────────────────
console.log('Phase 1 — helper pins accept the versions @claude-flow/cli declares');
const PINS = [
  { pkg: 'metaharness', helper: '_harness.mjs', pin: pinOf(METAHARNESS_VERSION_PIN) },
  { pkg: '@metaharness/darwin', helper: '_darwin.mjs', pin: pinOf(DARWIN_VERSION_PIN) },
];
const floors = {};
for (const p of PINS) {
  const declared = declaredRange(cliPkg, p.pkg);
  const floor = floorOf(declared);
  assert(!!floor, `${p.pkg}: declared in v3/@claude-flow/cli/package.json (got ${declared})`);
  if (!floor) continue;
  floors[p.pkg] = floor.join('.');
  const laterPatch = [floor[0], floor[1], floor[2] + 100].join('.');
  assert(satisfiesTildeRange(floors[p.pkg], p.pin),
    `${p.helper} pin ${p.pin} accepts ${floors[p.pkg]} (floor of declared ${declared})`);
  assert(satisfiesTildeRange(laterPatch, p.pin),
    `${p.helper} pin ${p.pin} accepts ${laterPatch} (a later patch inside declared ${declared})`);
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2 — published layout: the installed copy is used, nothing downloads
// ──────────────────────────────────────────────────────────────────────
console.log('\nPhase 2 — published layout resolves the installed metaharness without npm/npx');
// realpath: macOS tmpdir() is /var/… while resolved paths come back as /private/var/…
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-pin-alignment-')));
try {
  const NM = join(TMP, 'node_modules');
  const PLUGIN_SCRIPTS = join(NM, '@claude-flow', 'cli', 'plugins', 'ruflo-metaharness', 'scripts');
  mkdirSync(PLUGIN_SCRIPTS, { recursive: true });
  for (const f of readdirSync(SCRIPTS_DIR)) {
    if (f.endsWith('.mjs')) copyFileSync(join(SCRIPTS_DIR, f), join(PLUGIN_SCRIPTS, f));
  }

  // Stub `metaharness` at the declared floor: both bins echo a marker JSON.
  const mhVersion = floors.metaharness ?? '0.0.0';
  const MH = join(NM, 'metaharness');
  mkdirSync(join(MH, 'dist'), { recursive: true });
  writeFileSync(join(MH, 'package.json'), JSON.stringify({
    name: 'metaharness', version: mhVersion, type: 'module',
    bin: { metaharness: 'dist/bin.js', harness: 'dist/harness-bin.js' },
  }, null, 2));
  for (const [file, bin] of [['bin.js', 'metaharness'], ['harness-bin.js', 'harness']]) {
    writeFileSync(join(MH, 'dist', file),
      `console.log(JSON.stringify({ stub: '${bin}', version: '${mhVersion}', argv: process.argv.slice(2) }));\n`);
  }

  // npm / npx trap: log the attempt, fail like an offline machine would.
  const TRAP = join(TMP, 'trap-bin');
  const TRAP_LOG = join(TMP, 'trap.log');
  mkdirSync(TRAP);
  for (const t of ['npm', 'npx']) {
    writeFileSync(join(TRAP, t), `#!/bin/sh\nprintf '%s %s\\n' "${t}" "$*" >> "${TRAP_LOG}"\necho "npm ERR! ${t} blocked by test-pin-alignment trap" >&2\nexit 1\n`);
    chmodSync(join(TRAP, t), 0o755);
  }
  const PROJECT = join(TMP, 'project');
  mkdirSync(PROJECT);
  const env = {
    ...process.env,
    PATH: `${TRAP}:${process.env.PATH}`,
    RUFLO_METAHARNESS_CACHE_BASE: join(TMP, 'empty-cache-base'),
  };
  delete env.RUFLO_METAHARNESS_SKIP_LOCAL;
  const run = (args) => spawnSync(process.execPath, args, { cwd: PROJECT, env, encoding: 'utf-8', timeout: 60_000 });

  const probe = run(['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(pathToFileURL(join(PLUGIN_SCRIPTS, '_harness.mjs')).href)});` +
    'console.log(JSON.stringify(m.metaharnessResolution()));']);
  let resolution = null;
  try { resolution = JSON.parse(probe.stdout.trim().split('\n').pop()); } catch { /* asserted below */ }
  assert(resolution?.ok === true && resolution?.source === 'local',
    `metaharnessResolution() → source 'local' (got ${JSON.stringify(resolution)})`);
  assert(typeof resolution?.bins?.metaharness === 'string' && resolution.bins.metaharness.startsWith(MH),
    'resolved metaharness bin is the installed copy next to @claude-flow/cli');

  const score = run([join(PLUGIN_SCRIPTS, 'score.mjs'), '--path', PROJECT, '--format', 'json']);
  let payload = null;
  try { payload = JSON.parse(score.stdout); } catch { /* asserted below */ }
  assert(score.status === 0, `score.mjs exits 0 (got ${score.status})`);
  assert(payload?.degraded !== true, `score.mjs is not degraded (reason: ${payload?.reason ?? 'none'})`);
  assert(payload?.stub === 'metaharness' && payload?.version === mhVersion,
    `score.mjs ran the installed metaharness ${mhVersion}`);

  const trapped = existsSync(TRAP_LOG) ? readFileSync(TRAP_LOG, 'utf-8').trim() : '';
  assert(trapped === '', `no npm / npx process spawned${trapped ? ` (got: ${trapped.split('\n')[0]})` : ''}`);
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\n✓ Plugin helper pins accept the versions @claude-flow/cli declares; no tool-time download.');
