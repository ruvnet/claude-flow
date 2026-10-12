#!/usr/bin/env node
// test-no-tool-time-npx.mjs — regression test: metaharness_* tool calls must
// not reach for npm / npx when what they need is already installed (#3366).
//
// THE BUG
// Three helpers spawned the npm registry at TOOL-CALL time even on a complete
// ruflo install:
//   - _darwin.mjs      `npx -y -p @metaharness/darwin@<pin> metaharness-darwin`
//                      on EVERY evolve / bench / security-bench call, although
//                      the CLI ships @metaharness/darwin as an optionalDependency
//   - _redblue.mjs     `npm install --prefix ~/.ruflo/redblue-cache-<pin>` on
//                      first use, never looking at the installed copy
//   - audit-list / audit-trend / oia-audit / similarity
//                      `npx @claude-flow/cli@latest memory …` — a registry
//                      round trip per call, possibly a DIFFERENT CLI version
//                      than the server that spawned the tool (#3306), and a
//                      silent failure offline (oia_audit persisted:false,
//                      audit_list "0 records")
//
// WHAT THIS TEST PROVES (hermetic — stub packages, no network)
// A PUBLISHED layout is built in a temp dir:
//   <p>/node_modules/@claude-flow/cli/{package.json,bin/cli.js,dist/src/index.js}
//   <p>/node_modules/@claude-flow/cli/plugins/ruflo-metaharness/scripts/*  (copied)
//   <p>/node_modules/metaharness            stub, satisfies the _harness pin
//   <p>/node_modules/@metaharness/darwin    stub, satisfies the _darwin pin
//   <p>/node_modules/@metaharness/redblue → <p>/store/redblue  (pnpm-style
//                      SYMLINK; the stub keeps upstream redblue's
//                      `import.meta.url === file://${argv[1]}` isMain guard)
// with a PATH trap whose npm / npx log every call and exit 1 (offline).
//   Phase 1  darwin: bench verify (sync) + security bench (async) run the
//            installed bin — not degraded, zero npm/npx; and, with no
//            installed copy, the existing darwin-cache-<pin> runs instead
//   Phase 2  redblue: the symlinked installed copy runs (isMain holds because
//            the resolved bin is realpath'd) — zero npm/npx
//   Phase 3  memory round trip through the CLI that ships the plugin:
//            oia-audit persists → audit-list lists it → audit-trend and
//            similarity read it back — zero npm/npx
//   Phase 4  contracts kept: CLI_CORE=1 still opts into npx cli-core@alpha; a
//            layout with no usable local CLI — missing, or present but not
//            named @claude-flow/cli — still falls back to
//            `npx @claude-flow/cli@latest`; darwin absent → degraded, exit 0
//            (ADR-150 rule #3)
//   Phase 5  the two new lookups stay inside ruflo's tree: a darwin / redblue
//            in the tool's OWN cwd node_modules is never executed
//            ({fromCwd:false}); a cache dir with package.json but no bin gets
//            one reinstall instead of degrading forever; and neither helper
//            spawns the resolved bin through a shell
//
// USAGE
//   node plugins/ruflo-metaharness/scripts/test-no-tool-time-npx.mjs
//
// EXIT CODES
//   0  all assertions passed (or skipped on win32 — the trap is POSIX sh)
//   1  at least one assertion failed

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

if (process.platform === 'win32') {
  console.log('# test-no-tool-time-npx — SKIPPED on win32 (the npm/npx trap is a POSIX sh script)');
  process.exit(0);
}

let passed = 0, failed = 0;
const failures = [];
function assert(cond, label) {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (cond) passed++;
  else { failures.push(label); failed++; }
}

/** Lowest version a tilde pin admits — the stubs sit exactly there. */
function floorOfPin(fullPin) {
  const m = /@[~^]?(\d+\.\d+\.\d+)$/.exec(fullPin);
  return m ? m[1] : '0.0.0';
}
const { METAHARNESS_VERSION_PIN } = await import(pathToFileURL(join(SCRIPTS_DIR, '_harness.mjs')).href);
const { DARWIN_VERSION_PIN } = await import(pathToFileURL(join(SCRIPTS_DIR, '_darwin.mjs')).href);
const { REDBLUE_VERSION_PIN } = await import(pathToFileURL(join(SCRIPTS_DIR, '_redblue.mjs')).href);

const write = (file, body, mode) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (mode) chmodSync(file, mode);
};
const echoStub = (name, version) =>
  `console.log(JSON.stringify({ stub: '${name}', version: '${version}', argv: process.argv.slice(2) }));\n`;

// realpath: macOS tmpdir() is /var/… while resolved paths come back as /private/var/…
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-no-tool-time-npx-')));
const NM = join(TMP, 'node_modules');
const CLI = join(NM, '@claude-flow', 'cli');
const PLUGIN_SCRIPTS = join(CLI, 'plugins', 'ruflo-metaharness', 'scripts');
const TRAP = join(TMP, 'trap-bin');
const TRAP_LOG = join(TMP, 'trap.log');
const CLI_LOG = join(TMP, 'cli-calls.log');
const PROJECT = join(TMP, 'project');

try {
  // ── fixture ───────────────────────────────────────────────────────────
  mkdirSync(PLUGIN_SCRIPTS, { recursive: true });
  for (const f of readdirSync(SCRIPTS_DIR)) {
    if (f.endsWith('.mjs')) copyFileSync(join(SCRIPTS_DIR, f), join(PLUGIN_SCRIPTS, f));
  }
  mkdirSync(PROJECT);

  // The ruflo CLI that ships the plugin: a stub with a tiny file-backed
  // `memory store|list|retrieve`, logging every invocation.
  write(join(CLI, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: '0.0.0-test', type: 'module', bin: { cli: 'bin/cli.js' } }));
  write(join(CLI, 'dist', 'src', 'index.js'), 'export {};\n');
  write(join(CLI, 'bin', 'cli.js'), `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(CLI_LOG)}, argv.slice(0, 2).join(' ') + '\\n');
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const DB = ${JSON.stringify(join(TMP, 'stub-memory.json'))};
const db = existsSync(DB) ? JSON.parse(readFileSync(DB, 'utf-8')) : {};
const ns = opt('--namespace') ?? 'default';
if (argv[0] !== 'memory') process.exit(2);
if (argv[1] === 'store') { db[ns] = { ...(db[ns] ?? {}), [opt('--key')]: opt('--value') }; writeFileSync(DB, JSON.stringify(db)); console.log('[OK] Data stored successfully'); }
else if (argv[1] === 'list') console.log(JSON.stringify(Object.keys(db[ns] ?? {}).map((key) => ({ key, namespace: ns }))));
else if (argv[1] === 'retrieve') { const v = db[ns]?.[opt('--key')]; if (v === undefined) { console.error('not found'); process.exit(1); } console.log(v); }
else process.exit(2);
`);

  const mhVersion = floorOfPin(METAHARNESS_VERSION_PIN);
  write(join(NM, 'metaharness', 'package.json'), JSON.stringify({ name: 'metaharness', version: mhVersion, type: 'module', bin: { metaharness: 'dist/bin.js', harness: 'dist/harness-bin.js' } }));
  write(join(NM, 'metaharness', 'dist', 'bin.js'), echoStub('metaharness', mhVersion));
  write(join(NM, 'metaharness', 'dist', 'harness-bin.js'), echoStub('harness', mhVersion));

  const darwinVersion = floorOfPin(DARWIN_VERSION_PIN);
  const pinDigits = DARWIN_VERSION_PIN.replace(/^.*@[~^]?/, '');   // cache-dir suffix
  const DARWIN = join(NM, '@metaharness', 'darwin');
  write(join(DARWIN, 'package.json'), JSON.stringify({ name: '@metaharness/darwin', version: darwinVersion, type: 'module', bin: { 'metaharness-darwin': './dist/cli.js' } }));
  write(join(DARWIN, 'dist', 'cli.js'), echoStub('metaharness-darwin', darwinVersion));

  // redblue lives in a pnpm-like store and is SYMLINKED into node_modules;
  // its CLI keeps upstream's isMain guard, so it only prints when argv[1] is
  // the real path.
  const redblueVersion = floorOfPin(REDBLUE_VERSION_PIN);
  const RB_STORE = join(TMP, 'store', 'redblue');
  write(join(RB_STORE, 'package.json'), JSON.stringify({ name: '@metaharness/redblue', version: redblueVersion, type: 'module', bin: { redblue: './dist/cli/index.js', 'metaharness-redblue': './dist/cli/index.js' } }));
  write(join(RB_STORE, 'dist', 'cli', 'index.js'),
    'const isMain = import.meta.url === `file://${process.argv[1]}`;\n' +
    `if (isMain) console.log(JSON.stringify({ stub: 'redblue', version: '${redblueVersion}', argv: process.argv.slice(2) }));\n`);
  symlinkSync(RB_STORE, join(NM, '@metaharness', 'redblue'));

  for (const t of ['npm', 'npx']) {
    write(join(TRAP, t), `#!/bin/sh\nprintf '%s %s\\n' "${t}" "$*" >> "${TRAP_LOG}"\necho "npm ERR! ${t} blocked by test-no-tool-time-npx trap" >&2\nexit 1\n`, 0o755);
  }
  const baseEnv = { ...process.env, PATH: `${TRAP}:${process.env.PATH}`, RUFLO_METAHARNESS_CACHE_BASE: join(TMP, 'empty-cache-base') };
  delete baseEnv.RUFLO_METAHARNESS_SKIP_LOCAL;
  delete baseEnv.CLI_CORE;
  delete baseEnv.RUFLO_PLUGIN_SKIP_LOCAL_CLI;
  // #3558: Phase 4 asserts the npx fallback; an installed `ruflo` on the
  // developer's PATH would now be preferred over it. PATH resolution has its
  // own test (test-cli-resolution-3558.mjs).
  baseEnv.RUFLO_PLUGIN_SKIP_PATH_CLI = '1';
  const trapped = () => (existsSync(TRAP_LOG) ? readFileSync(TRAP_LOG, 'utf-8').trim() : '');
  const resetTrap = () => rmSync(TRAP_LOG, { force: true });
  const run = (script, args, env = baseEnv, scriptsDir = PLUGIN_SCRIPTS, cwd = PROJECT) => {
    const r = spawnSync(process.execPath, [join(scriptsDir, script), ...args], { cwd, env, encoding: 'utf-8', timeout: 60_000 });
    let json = null;
    try { json = JSON.parse(r.stdout); } catch { /* callers assert */ }
    return { ...r, json };
  };
  const noNpm = (label) => {
    const t = trapped();
    assert(t === '', `${label}: no npm / npx spawned${t ? ` (got: ${t.split('\n')[0].slice(0, 160)})` : ''}`);
    resetTrap();
  };

  console.log('# test-no-tool-time-npx\n');

  // ── Phase 1 — darwin runs the installed bin ──────────────────────────
  console.log(`Phase 1 — @metaharness/darwin ${darwinVersion} (installed) serves bench + security bench`);
  const suite = join(PROJECT, 'suite.json');
  writeFileSync(suite, '{}');
  const bench = run('bench.mjs', ['--op', 'verify', '--suite', suite]);
  assert(bench.status === 0 && bench.json?.success === true, `bench verify exits 0 with success (got ${bench.status}, reason ${bench.json?.reason ?? 'none'})`);
  assert(bench.json?.data?.stub === 'metaharness-darwin' && bench.json?.data?.argv?.[0] === 'bench',
    'bench verify ran the installed metaharness-darwin (sync path)');
  noNpm('bench verify');
  const sec = run('security-bench.mjs', ['--population', '1', '--cycles', '1']);
  assert(sec.json?.degraded !== true, `security bench is not degraded (reason ${sec.json?.reason ?? 'none'})`);
  noNpm('security bench (async path)');
  // …and the OTHER success branch: the one-time versioned cache that gepa
  // already shares, which is what a machine without a qualifying installed
  // copy falls back to. Without this, deleting that branch leaves the suite
  // green.
  const seededCache = join(TMP, 'seeded-cache');
  const cachedDarwin = join(seededCache, `darwin-cache-${pinDigits}`, 'node_modules', '@metaharness', 'darwin');
  write(join(cachedDarwin, 'package.json'), JSON.stringify({ name: '@metaharness/darwin', version: darwinVersion, type: 'module', bin: { 'metaharness-darwin': './dist/cli.js' } }));
  write(join(cachedDarwin, 'dist', 'cli.js'), echoStub('darwin-from-cache', darwinVersion));
  const cachedBench = run('bench.mjs', ['--op', 'verify', '--suite', suite],
    { ...baseEnv, RUFLO_METAHARNESS_CACHE_BASE: seededCache, RUFLO_METAHARNESS_SKIP_LOCAL: '1' });
  assert(cachedBench.json?.data?.stub === 'darwin-from-cache',
    `no installed copy → the existing darwin-cache-${pinDigits} runs (got stub ${cachedBench.json?.data?.stub ?? 'none'})`);
  noNpm('bench verify via darwin-cache');

  // ── Phase 2 — redblue runs the installed (symlinked) copy ────────────
  console.log(`\nPhase 2 — @metaharness/redblue ${redblueVersion} (installed, symlinked) serves attack`);
  const rb = run('redblue.mjs', ['attack', 'prompt', '--count', '1']);
  assert(rb.status === 0 && rb.json?.ok === true, `redblue attack exits 0 (got ${rb.status}, reason ${rb.json?.reason ?? 'none'})`);
  assert(/"stub":"redblue"/.test(rb.json?.stdout ?? ''), 'redblue CLI actually dispatched (isMain held: resolved bin is realpath\'d)');
  noNpm('redblue attack');

  // ── Phase 3 — memory round trip through the CLI that ships the plugin ─
  console.log('\nPhase 3 — oia-audit → audit-list → audit-trend / similarity via the shipping CLI');
  rmSync(CLI_LOG, { force: true });
  const oia = run('oia-audit.mjs', ['--path', PROJECT]);
  assert(oia.json?.persisted?.ok === true, `oia-audit persisted the record (got ${JSON.stringify(oia.json?.persisted ?? null)})`);
  const key = oia.json?.persisted?.key;
  const list = run('audit-list.mjs', ['--format', 'json']);
  assert(list.json?.returned === 1 && list.json?.records?.[0]?.key === key, `audit-list returns the persisted record (got ${list.json?.returned})`);
  const trend = run('audit-trend.mjs', ['--baseline-key', key, '--current-key', key, '--format', 'json']);
  assert(trend.status === 0 && trend.json !== null, `audit-trend reads both records back (exit ${trend.status})`);
  const sim = run('similarity.mjs', ['--a-key', key, '--b-key', key, '--format', 'json']);
  assert(sim.status === 0 && sim.json?.degraded !== true, `similarity reads both records back (exit ${sim.status}, reason ${sim.json?.reason ?? 'none'})`);
  const cliCalls = existsSync(CLI_LOG) ? readFileSync(CLI_LOG, 'utf-8').trim().split('\n') : [];
  assert(cliCalls.includes('memory store') && cliCalls.includes('memory list') && cliCalls.includes('memory retrieve'),
    `the shipping CLI served store + list + retrieve (saw: ${[...new Set(cliCalls)].join(', ') || 'nothing'})`);
  noNpm('memory round trip');

  // ── Phase 4 — contracts kept ─────────────────────────────────────────
  console.log('\nPhase 4 — opt-in and fallback contracts unchanged');
  run('audit-list.mjs', ['--format', 'json'], { ...baseEnv, CLI_CORE: '1' });
  assert(trapped().startsWith('npx @claude-flow/cli-core@alpha memory list'), 'CLI_CORE=1 still opts into `npx @claude-flow/cli-core@alpha`');
  resetTrap();
  // No usable local CLI (e.g. a marketplace clone with no dist/ build) → the
  // pre-existing npx fallback, unchanged.
  const bare = join(TMP, 'bare', 'plugins', 'ruflo-metaharness', 'scripts');
  mkdirSync(bare, { recursive: true });
  for (const f of readdirSync(PLUGIN_SCRIPTS)) copyFileSync(join(PLUGIN_SCRIPTS, f), join(bare, f));
  const bareList = run('audit-list.mjs', ['--format', 'json'], baseEnv, bare);
  assert(bareList.status === 0 && trapped().startsWith('npx @claude-flow/cli@latest memory list'),
    'no local CLI → falls back to `npx @claude-flow/cli@latest` (exit 0, as before)');
  resetTrap();
  // A directory two levels up that has bin/cli.js AND dist/src/index.js but
  // is NOT @claude-flow/cli must not be run as the ruflo CLI.
  const impostorScripts = join(TMP, 'impostor', 'plugins', 'ruflo-metaharness', 'scripts');
  mkdirSync(impostorScripts, { recursive: true });
  for (const f of readdirSync(PLUGIN_SCRIPTS)) copyFileSync(join(PLUGIN_SCRIPTS, f), join(impostorScripts, f));
  write(join(TMP, 'impostor', 'package.json'), JSON.stringify({ name: 'some-other-package', version: '1.0.0' }));
  write(join(TMP, 'impostor', 'bin', 'cli.js'), 'console.log("[]");\n');
  write(join(TMP, 'impostor', 'dist', 'src', 'index.js'), 'export {};\n');
  const impostor = run('audit-list.mjs', ['--format', 'json'], baseEnv, impostorScripts);
  assert(impostor.status === 0 && trapped().startsWith('npx @claude-flow/cli@latest memory list'),
    `a bin/cli.js whose package.json is not @claude-flow/cli is rejected (trap: ${trapped().split('\n')[0].slice(0, 60) || 'nothing'})`);
  resetTrap();
  const absent = run('bench.mjs', ['--op', 'verify', '--suite', suite], { ...baseEnv, RUFLO_METAHARNESS_SKIP_LOCAL: '1' });
  assert(absent.status === 0 && absent.json?.degraded === true && absent.json?.reason === 'metaharness-darwin-not-available',
    `darwin absent → {degraded:true, reason:'metaharness-darwin-not-available'}, exit 0 (got ${absent.status}, ${absent.json?.reason})`);
  resetTrap();

  // ── Phase 5 — the resolution stays inside ruflo's own tree ───────────
  // The darwin / redblue lookups END IN A SPAWN with MCP-supplied argv, so
  // they pass { fromCwd: false } and must ignore a node_modules in the tool's
  // cwd (or any ancestor of it). ISOLATED layout: plugin scripts under their
  // own temp root, so the walk-up from the scripts finds no darwin/redblue at
  // all and only the cwd copy could match.
  console.log('\nPhase 5 — installed-copy lookup is scoped to ruflo, and a half-written cache is repaired');
  const ISO = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-no-tool-time-npx-iso-')));
  try {
    const isoScripts = join(ISO, 'scripts');
    mkdirSync(isoScripts, { recursive: true });
    for (const f of readdirSync(PLUGIN_SCRIPTS)) copyFileSync(join(PLUGIN_SCRIPTS, f), join(isoScripts, f));
    const isoProject = join(ISO, 'project');
    mkdirSync(isoProject, { recursive: true });
    const cwdDarwin = join(isoProject, 'node_modules', '@metaharness', 'darwin');
    write(join(cwdDarwin, 'package.json'), JSON.stringify({ name: '@metaharness/darwin', version: darwinVersion, type: 'module', bin: { 'metaharness-darwin': './dist/cli.js' } }));
    write(join(cwdDarwin, 'dist', 'cli.js'), echoStub('cwd-darwin', darwinVersion));
    const cwdRedblue = join(isoProject, 'node_modules', '@metaharness', 'redblue');
    write(join(cwdRedblue, 'package.json'), JSON.stringify({ name: '@metaharness/redblue', version: redblueVersion, type: 'module', bin: { redblue: './dist/cli/index.js' } }));
    write(join(cwdRedblue, 'dist', 'cli', 'index.js'), echoStub('cwd-redblue', redblueVersion));
    const isoEnv = { ...baseEnv, RUFLO_METAHARNESS_CACHE_BASE: join(ISO, 'empty-cache-base') };

    const cwdBench = run('bench.mjs', ['--op', 'verify', '--suite', suite], isoEnv, isoScripts, isoProject);
    assert(cwdBench.json?.data?.stub !== 'cwd-darwin',
      `darwin in the tool's cwd node_modules is NOT executed (got stub ${cwdBench.json?.data?.stub ?? 'none'})`);
    resetTrap();
    const cwdRb = run('redblue.mjs', ['attack', 'prompt', '--count', '1'], isoEnv, isoScripts, isoProject);
    assert(!/"stub":"cwd-redblue"/.test(cwdRb.json?.stdout ?? ''),
      'redblue in the tool\'s cwd node_modules is NOT executed');
    resetTrap();

    // A cache dir holding package.json but no bin (npm killed by the 180s
    // install timeout, or two first calls racing into the same prefix) must
    // not count as installed forever: one reinstall is attempted.
    const halfCache = join(ISO, 'half-cache');
    write(join(halfCache, `darwin-cache-${pinDigits}`, 'node_modules', '@metaharness', 'darwin', 'package.json'),
      JSON.stringify({ name: '@metaharness/darwin', version: darwinVersion, type: 'module', bin: { 'metaharness-darwin': './dist/cli.js' } }));
    const halfRun = run('bench.mjs', ['--op', 'verify', '--suite', suite], { ...isoEnv, RUFLO_METAHARNESS_CACHE_BASE: halfCache }, isoScripts, isoProject);
    assert(/npm install/.test(trapped()), `a cache with package.json but no bin triggers one reinstall (trap: ${trapped().split('\n')[0].slice(0, 120) || 'nothing'})`);
    assert(halfRun.status === 0 && halfRun.json?.degraded === true,
      `…and still degrades with exit 0 when that reinstall fails (got ${halfRun.status}, degraded ${halfRun.json?.degraded})`);
    resetTrap();
  } finally {
    rmSync(ISO, { recursive: true, force: true });
  }

  // Static: the resolved bins are spawned directly, never through a shell —
  // their argv carries MCP-supplied values (redblue --config/--out/--in).
  for (const f of ['_darwin.mjs', '_redblue.mjs']) {
    const src = readFileSync(join(SCRIPTS_DIR, f), 'utf-8');
    const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    assert(!/shell:\s*(true|process\.platform)/.test(code), `${f} spawns the resolved bin with shell:false`);
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\n✓ No npm / npx at tool-call time when darwin, redblue and the ruflo CLI are installed.');
