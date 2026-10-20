#!/usr/bin/env node
// test-cli-resolution-3558.mjs — regression test for #3558: in a Claude Code
// marketplace install, metaharness memory calls must use the ruflo CLI that
// is already installed on PATH, not `npx @claude-flow/cli@latest`.
//
// #3366 taught resolveRufloCli() (_invoke.mjs) two local layouts: the
// @claude-flow/cli that ships the plugin, and a repo checkout. A marketplace
// install is neither — the plugin is copied to
// ~/.claude/plugins/cache/<marketplace>/ruflo-metaharness/<version>/ — so it
// still fell through to npx @latest on a machine with ruflo installed.
//
// Hermetic: the plugin is copied into a temp plugin-cache layout; PATH holds
// only temp dirs with fake `ruflo` / `claude-flow` / `npx` scripts that log
// their argv. No network, no real CLI. The end-to-end cases use POSIX sh
// fakes and are skipped on win32; the win32 shim-mapping case runs everywhere.
//
// USAGE
//   node --test plugins/ruflo-metaharness/scripts/test-cli-resolution-3558.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const posixOnly = { skip: process.platform === 'win32' ? 'fake CLIs are POSIX sh scripts' : false };

const write = (file, body, mode) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (mode) chmodSync(file, mode);
};

let TMP, CACHE, LOG, WITH_RUFLO, WITH_CLAUDE_FLOW, NPX_ONLY, PROJECT, baseEnv;
before(() => {
  // realpath: macOS tmpdir() is /var/… while resolved paths come back as /private/var/…
  TMP = realpathSync(mkdtempSync(join(tmpdir(), 'metaharness-cli-resolution-')));
  const home = join(TMP, 'home');
  CACHE = join(home, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-metaharness', '0.0.0-test');
  cpSync(PLUGIN_ROOT, CACHE, { recursive: true });
  LOG = join(TMP, 'calls.log');
  const fake = (dir, name) => write(join(dir, name),
    `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${LOG}"\ncase "$*" in *"memory list"*) echo '[]' ;; *) echo '[OK] done' ;; esac\n`, 0o755);
  WITH_RUFLO = join(TMP, 'bin-ruflo');
  fake(WITH_RUFLO, 'ruflo');
  fake(WITH_RUFLO, 'claude-flow');
  WITH_CLAUDE_FLOW = join(TMP, 'bin-claude-flow');
  fake(WITH_CLAUDE_FLOW, 'claude-flow');
  NPX_ONLY = join(TMP, 'bin-npx');
  fake(NPX_ONLY, 'npx');
  PROJECT = join(TMP, 'project');
  mkdirSync(PROJECT);
  baseEnv = { ...process.env, HOME: home, USERPROFILE: home, RUFLO_METAHARNESS_CACHE_BASE: join(TMP, 'empty-cache-base') };
  for (const k of ['CLI_CORE', 'RUFLO_PLUGIN_SKIP_LOCAL_CLI', 'RUFLO_PLUGIN_SKIP_PATH_CLI', 'NODE_OPTIONS']) delete baseEnv[k];
});
after(() => rmSync(TMP, { recursive: true, force: true }));

const calls = () => (existsSync(LOG) ? readFileSync(LOG, 'utf-8').trim().split('\n').filter(Boolean) : []);
/** resolveRufloCli() as seen from `scriptsDir`, in a fresh process. */
function resolved(env, scriptsDir = join(CACHE, 'scripts')) {
  const src = `import { resolveRufloCli } from ${JSON.stringify(pathToFileURL(join(scriptsDir, '_invoke.mjs')).href)};\nconsole.log(JSON.stringify(resolveRufloCli()));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { cwd: PROJECT, encoding: 'utf-8', env: { ...baseEnv, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
function auditList(env, scriptsDir = join(CACHE, 'scripts')) {
  rmSync(LOG, { force: true });
  const r = spawnSync(process.execPath, [join(scriptsDir, 'audit-list.mjs'), '--format', 'json'], { cwd: PROJECT, encoding: 'utf-8', timeout: 30_000, env: { ...baseEnv, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return calls();
}
const pathOf = (...dirs) => dirs.join(delimiter);

test('win32: npm\'s ruflo.cmd shim maps to `node <package bin>`, never cmd.exe', async () => {
  const { findRufloOnPath } = await import(pathToFileURL(join(PLUGIN_ROOT, 'scripts', '_invoke.mjs')).href);
  const prefix = join(TMP, 'win-prefix');
  write(join(prefix, 'ruflo.cmd'), '@ECHO off\r\n');
  write(join(prefix, 'node_modules', 'ruflo', 'package.json'), JSON.stringify({ name: 'ruflo', bin: { ruflo: 'bin/ruflo.js' } }));
  write(join(prefix, 'node_modules', 'ruflo', 'bin', 'ruflo.js'), '');
  assert.deepEqual(findRufloOnPath({ Path: prefix }, 'win32'),
    { command: process.execPath, args: [realpathSync(join(prefix, 'node_modules', 'ruflo', 'bin', 'ruflo.js'))], shell: false, source: 'path' });
  const bare = join(TMP, 'win-bare');
  write(join(bare, 'ruflo.cmd'), '@ECHO off\r\n');
  assert.equal(findRufloOnPath({ PATH: bare }, 'win32'), null, 'a ruflo.cmd that is not an npm package shim is skipped, not run through cmd.exe');
});

test('plugin-cache install: the installed `ruflo` on PATH serves memory calls, not npx', posixOnly, () => {
  const env = { PATH: pathOf(WITH_RUFLO, NPX_ONLY) };
  assert.deepEqual(resolved(env), { command: join(WITH_RUFLO, 'ruflo'), args: [], shell: false, source: 'path' });
  const c = auditList(env);
  assert.ok(c.some((l) => l.startsWith('ruflo memory list --namespace metaharness-audit')), c.join(' | ') || 'no CLI called');
  assert.deepEqual(c.filter((l) => l.startsWith('npx ')), []);
});

test('no `ruflo` but `claude-flow` on PATH → claude-flow', posixOnly, () => {
  const c = auditList({ PATH: pathOf(WITH_CLAUDE_FLOW, NPX_ONLY) });
  assert.ok(c.some((l) => l.startsWith('claude-flow memory list')), c.join(' | '));
  assert.deepEqual(c.filter((l) => l.startsWith('npx ')), []);
});

test('no installed CLI → still `npx @claude-flow/cli@latest` (unchanged fallback)', posixOnly, () => {
  const env = { PATH: pathOf(NPX_ONLY) };
  assert.equal(resolved(env).source, 'npx');
  const c = auditList(env);
  assert.ok(c.some((l) => l.startsWith('npx @claude-flow/cli@latest memory list')), c.join(' | '));
});

test('CLI_CORE=1 still opts into `npx @claude-flow/cli-core@alpha` (ADR-100)', posixOnly, () => {
  const c = auditList({ PATH: pathOf(WITH_RUFLO, NPX_ONLY), CLI_CORE: '1' });
  assert.ok(c.some((l) => l.startsWith('npx @claude-flow/cli-core@alpha memory list')), c.join(' | '));
  assert.deepEqual(c.filter((l) => l.startsWith('ruflo ')), []);
});

test('RUFLO_PLUGIN_SKIP_PATH_CLI=1 skips the PATH lookup (test seam)', posixOnly, () => {
  assert.equal(resolved({ PATH: pathOf(WITH_RUFLO, NPX_ONLY), RUFLO_PLUGIN_SKIP_PATH_CLI: '1' }).source, 'npx');
});

test('a `ruflo` in the working directory is never run via a relative PATH entry', posixOnly, () => {
  write(join(PROJECT, 'ruflo'), '#!/bin/sh\nexit 0\n', 0o755);
  try {
    assert.equal(resolved({ PATH: ['', '.', NPX_ONLY].join(delimiter) }).source, 'npx');
  } finally {
    rmSync(join(PROJECT, 'ruflo'));
  }
});

test('published layout: the @claude-flow/cli that ships the plugin still wins over PATH (#3366)', posixOnly, () => {
  const cli = join(TMP, 'published', 'node_modules', '@claude-flow', 'cli');
  const scripts = join(cli, 'plugins', 'ruflo-metaharness', 'scripts');
  cpSync(join(PLUGIN_ROOT, 'scripts'), scripts, { recursive: true });
  write(join(cli, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: '0.0.0-test', type: 'module' }));
  write(join(cli, 'dist', 'src', 'index.js'), 'export {};\n');
  write(join(cli, 'bin', 'cli.js'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(LOG)}, 'shipping-cli ' + process.argv.slice(2).join(' ') + '\\n');\nconsole.log('[]');\n`);
  const env = { PATH: pathOf(WITH_RUFLO, NPX_ONLY) };
  assert.equal(resolved(env, scripts).source, 'local');
  const c = auditList(env, scripts);
  assert.ok(c.some((l) => l.startsWith('shipping-cli memory list')), c.join(' | '));
  assert.deepEqual(c.filter((l) => !l.startsWith('shipping-cli ')), []);
});
