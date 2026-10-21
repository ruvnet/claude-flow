#!/usr/bin/env node
/**
 * Regression guard for ruvnet/ruflo#3558 — cost-tracker must run the ruflo CLI
 * that is already installed, not `npx -y @claude-flow/cli@latest`.
 *
 * A plugin installed from the Claude Code marketplace lives in
 * ~/.claude/plugins/cache/<marketplace>/ruflo-cost-tracker/<version>/, with
 * no CLI next to it. Before #3558 every memory / hooks call from there went to
 * `npx @claude-flow/cli@latest` — for the Stop hook, a registry round trip on
 * every turn, running whatever `latest` was that day instead of the user's
 * installed ruflo.
 *
 * Hermetic: the plugin is copied into a temp plugin-cache layout, and PATH
 * holds only temp dirs with fake `ruflo` / `claude-flow` / `npx` scripts that
 * log their argv (plus a `node` link for the hook command). No network, no
 * real CLI, HOME points at a temp dir.
 *
 * Usage (from repo root):
 *   node plugins/ruflo-cost-tracker/scripts/test-cli-resolution-3558.mjs
 *
 * Wired into .github/workflows/v3-ci.yml next to test-hooks.mjs. The
 * end-to-end cases use POSIX sh fakes and are skipped on win32; the win32
 * shim-mapping cases run everywhere.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function assert(cond, label, detail = '') {
  if (cond) { passed++; console.log(`ok: ${label}`); return; }
  failed++;
  console.error(`FAIL: ${label}${detail ? `\n     ${detail}` : ''}`);
}

const write = (file, body, mode) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  if (mode) chmodSync(file, mode);
};

// realpath: macOS tmpdir() is /var/… while resolved paths come back as /private/var/…
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-cost-cli-resolution-')));
try {
  // ── win32: npm's ruflo.cmd shim maps to its JS entry, never to cmd.exe ──
  let findRufloOnPath = null;
  try {
    ({ findRufloOnPath } = await import(pathToFileURL(join(PLUGIN_ROOT, 'scripts', '_ruflo-cli.mjs')).href));
  } catch (e) {
    assert(false, 'scripts/_ruflo-cli.mjs exports findRufloOnPath()', e.message);
  }
  if (findRufloOnPath) {
    const prefix = join(TMP, 'win-prefix');
    write(join(prefix, 'ruflo.cmd'), '@ECHO off\r\n');
    write(join(prefix, 'node_modules', 'ruflo', 'package.json'), JSON.stringify({ name: 'ruflo', bin: { ruflo: 'bin/ruflo.js' } }));
    write(join(prefix, 'node_modules', 'ruflo', 'bin', 'ruflo.js'), '');
    const hit = findRufloOnPath({ Path: prefix }, 'win32');
    assert(hit?.command === process.execPath && hit?.args?.[0] === realpathSync(join(prefix, 'node_modules', 'ruflo', 'bin', 'ruflo.js')) && hit?.shell === false,
      'win32: <prefix>/ruflo.cmd runs as `node <package bin>` with shell:false', JSON.stringify(hit));
    const escape = join(TMP, 'win-escape');
    write(join(escape, 'ruflo.cmd'), '@ECHO off\r\n');
    write(join(escape, 'node_modules', 'ruflo', 'package.json'), JSON.stringify({ name: 'ruflo', bin: { ruflo: '../../outside.js' } }));
    write(join(escape, 'outside.js'), '');
    assert(findRufloOnPath({ PATH: escape }, 'win32') === null, 'win32: a shim whose package bin points outside the package is refused');
    const bare = join(TMP, 'win-bare');
    write(join(bare, 'ruflo.cmd'), '@ECHO off\r\n');
    assert(findRufloOnPath({ PATH: bare }, 'win32') === null, 'win32: a ruflo.cmd that is not an npm package shim is skipped (no shell fallback)');
  }

  if (process.platform === 'win32') {
    console.log('\n# end-to-end cases SKIPPED on win32 (the fake CLIs are POSIX sh scripts)');
  } else {
    // ── fixture ───────────────────────────────────────────────────────────
    const HOME = join(TMP, 'home');
    const CACHE = join(HOME, '.claude', 'plugins', 'cache', 'ruflo', 'ruflo-cost-tracker', '0.0.0-test');
    cpSync(PLUGIN_ROOT, CACHE, { recursive: true });
    const LOG = join(TMP, 'calls.log');
    // Each fake logs `<name> <argv…>` and answers like the CLI would: a JSON
    // array for `memory list`, an OK line otherwise.
    const fake = (dir, name) => write(join(dir, name),
      `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "${LOG}"\ncase "$*" in *"memory list"*) echo '[]' ;; *) echo '[OK] done' ;; esac\n`, 0o755);
    const NODE_BIN = join(TMP, 'node-bin');
    mkdirSync(NODE_BIN);
    symlinkSync(process.execPath, join(NODE_BIN, 'node'));
    const WITH_RUFLO = join(TMP, 'bin-ruflo');
    fake(WITH_RUFLO, 'ruflo');
    fake(WITH_RUFLO, 'claude-flow');
    const WITH_CLAUDE_FLOW = join(TMP, 'bin-claude-flow');
    fake(WITH_CLAUDE_FLOW, 'claude-flow');
    const NPX_ONLY = join(TMP, 'bin-npx');
    fake(NPX_ONLY, 'npx');
    const pathOf = (...dirs) => [...dirs, NODE_BIN].join(delimiter);

    // A Stop-hook-sized session for track.mjs to persist.
    const PROJECT = join(TMP, 'project');
    mkdirSync(PROJECT);
    const sessionDir = join(HOME, '.claude', 'projects', PROJECT.replace(/[/\\:]/g, '-'));
    write(join(sessionDir, 'sess-tbd.jsonl'), [
      { sessionId: 'sess-tbd', cwd: PROJECT, timestamp: '2026-09-28T16:20:00.000Z', type: 'user' },
      { sessionId: 'sess-tbd', cwd: PROJECT, timestamp: '2026-09-28T16:20:05.000Z', type: 'assistant',
        message: { model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 20 } } },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');

    const baseEnv = { ...process.env, HOME, USERPROFILE: HOME, TRACK_CWD: PROJECT };
    for (const k of ['CLI_CORE', 'RUFLO_PLUGIN_SKIP_LOCAL_CLI', 'RUFLO_PLUGIN_SKIP_PATH_CLI', 'TRACK_DRY_RUN', 'TRACK_SESSION', 'NODE_OPTIONS']) delete baseEnv[k];
    const calls = () => (existsSync(LOG) ? readFileSync(LOG, 'utf-8').trim().split('\n').filter(Boolean) : []);
    const reset = () => rmSync(LOG, { force: true });

    // The Stop hook exactly as Claude Code runs it (hooks.json command, shell).
    const hookCmd = JSON.parse(readFileSync(join(CACHE, 'hooks', 'hooks.json'), 'utf-8')).hooks.Stop[0].hooks[0].command;
    const stopHook = (env, pluginRoot = CACHE) => spawnSync(hookCmd, {
      shell: true, cwd: PROJECT, encoding: 'utf-8', timeout: 30_000,
      input: JSON.stringify({ session_id: 'sess-tbd', hook_event_name: 'Stop', stop_hook_active: false }),
      env: { ...baseEnv, CLAUDE_PLUGIN_ROOT: pluginRoot, ...env },
    });
    const runScript = (script, args, env, scriptsDir = join(CACHE, 'scripts'), cwd = PROJECT) =>
      spawnSync(process.execPath, [join(scriptsDir, script), ...args], { cwd, encoding: 'utf-8', timeout: 30_000, env: { ...baseEnv, ...env } });

    const storeCall = 'memory store --namespace cost-tracking --key session-sess-tbd';

    // 1 — the bug: marketplace install + ruflo on PATH.
    reset();
    const hook = stopHook({ PATH: pathOf(WITH_RUFLO, NPX_ONLY) });
    assert(hook.status === 0, 'Stop hook exits 0', `status ${hook.status}: ${hook.stderr}`);
    let c = calls();
    assert(c.some((l) => l.startsWith(`ruflo ${storeCall}`)), 'plugin-cache install: Stop hook stores the session through the installed `ruflo`', c.join(' | ') || 'no CLI called');
    assert(!c.some((l) => l.startsWith('npx ')), 'plugin-cache install: Stop hook does not run npx', c.join(' | '));

    reset();
    runScript('outcome.mjs', ['format imports', 'haiku', 'success'], { PATH: pathOf(WITH_RUFLO, NPX_ONLY) });
    c = calls();
    assert(c.includes('ruflo hooks model-outcome -t format imports -m haiku -o success') && !c.some((l) => l.startsWith('npx ')),
      'outcome.mjs: `hooks model-outcome` goes to the installed ruflo, not npx', c.join(' | '));

    reset();
    runScript('federation.mjs', [], { PATH: pathOf(WITH_RUFLO, NPX_ONLY), FED_FORMAT: 'json' });
    c = calls();
    assert(c.some((l) => l.startsWith('ruflo memory list --namespace federation-spend')) && !c.some((l) => l.startsWith('npx ')),
      'federation.mjs (a module-level CLI_PKG caller): `memory list` goes to the installed ruflo', c.join(' | '));

    // 2 — `claude-flow` counts when there is no `ruflo`.
    reset();
    stopHook({ PATH: pathOf(WITH_CLAUDE_FLOW, NPX_ONLY) });
    c = calls();
    assert(c.some((l) => l.startsWith(`claude-flow ${storeCall}`)) && !c.some((l) => l.startsWith('npx ')),
      'no `ruflo` but `claude-flow` on PATH → claude-flow is used', c.join(' | '));

    // 3 — contracts kept.
    reset();
    stopHook({ PATH: pathOf(NPX_ONLY) });
    c = calls();
    assert(c.some((l) => l.startsWith(`npx -y @claude-flow/cli@latest ${storeCall}`)),
      'no installed CLI → still `npx -y @claude-flow/cli@latest` (unchanged fallback)', c.join(' | ') || 'no CLI called');

    reset();
    stopHook({ PATH: pathOf(WITH_RUFLO, NPX_ONLY), CLI_CORE: '1' });
    c = calls();
    assert(c.some((l) => l.startsWith(`npx -y @claude-flow/cli-core@alpha ${storeCall}`)) && !c.some((l) => l.startsWith('ruflo ')),
      'CLI_CORE=1 still opts into `npx @claude-flow/cli-core@alpha` (ADR-100)', c.join(' | '));

    reset();
    stopHook({ PATH: pathOf(WITH_RUFLO, NPX_ONLY), RUFLO_PLUGIN_SKIP_PATH_CLI: '1' });
    c = calls();
    assert(c.some((l) => l.startsWith('npx -y @claude-flow/cli@latest ')) && !c.some((l) => l.startsWith('ruflo ')),
      'RUFLO_PLUGIN_SKIP_PATH_CLI=1 skips the PATH lookup (test seam)', c.join(' | '));

    // A `ruflo` in the project directory is never run via a relative PATH entry.
    reset();
    fake(PROJECT, 'ruflo');
    runScript('outcome.mjs', ['t', 'haiku', 'success'], { PATH: ['', '.', NPX_ONLY, NODE_BIN].join(delimiter) });
    c = calls();
    assert(!c.some((l) => l.startsWith('ruflo ')) && c.some((l) => l.startsWith('npx -y @claude-flow/cli@latest hooks model-outcome')),
      'relative PATH entries (`.` / empty) are ignored', c.join(' | '));
    rmSync(join(PROJECT, 'ruflo'));

    // 4 — a built @claude-flow/cli that ships the plugin still wins over PATH.
    const CLI = join(TMP, 'published', 'node_modules', '@claude-flow', 'cli');
    const PUB_PLUGIN = join(CLI, 'plugins', 'ruflo-cost-tracker');
    cpSync(PLUGIN_ROOT, PUB_PLUGIN, { recursive: true });
    write(join(CLI, 'package.json'), JSON.stringify({ name: '@claude-flow/cli', version: '0.0.0-test', type: 'module' }));
    write(join(CLI, 'dist', 'src', 'index.js'), 'export {};\n');
    write(join(CLI, 'bin', 'cli.js'), `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(LOG)}, 'shipping-cli ' + process.argv.slice(2).join(' ') + '\\n');\nconsole.log('[OK] done');\n`);
    reset();
    stopHook({ PATH: pathOf(WITH_RUFLO, NPX_ONLY) }, PUB_PLUGIN);
    c = calls();
    assert(c.some((l) => l.startsWith(`shipping-cli ${storeCall}`)) && c.every((l) => l.startsWith('shipping-cli ')),
      'published layout: the @claude-flow/cli that ships the plugin wins over PATH', c.join(' | ') || 'no CLI called');
  }
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed === 0 ? 0 : 1);
