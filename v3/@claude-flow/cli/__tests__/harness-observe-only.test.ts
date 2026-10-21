/**
 * `ruflo harness` must not change what it observes (PR #3521 review #1, #2).
 *
 * - The CLI class skips the update check, policy migration, helper refresh,
 *   proven-config adoption and daemon autostart for observe-only commands.
 * - bin/cli.js runs `harness` before the CLI class loads, writes nothing to
 *   disk, and with --hook fails silently when dist/ is missing.
 * - The opt-in Codex hook points at this install and disables autostart and
 *   the update check.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const calls = vi.hoisted(() => ({ update: 0, policy: 0, helpers: 0, proven: 0, daemon: 0 }));

vi.mock('../src/update/index.js', () => ({
  runStartupUpdateCheck: async () => { calls.update++; return { checked: false, updatesAvailable: [], updatesApplied: [] }; },
}));
vi.mock('../src/services/policy-runtime.js', () => ({
  autoMigratePolicyStateIfNeeded: async () => { calls.policy++; return { migrated: false }; },
}));
vi.mock('../src/init/helper-refresh.js', () => ({
  autoRefreshHelpersIfStale: async () => { calls.helpers++; return {}; },
}));
vi.mock('../src/config/proven-config-refresh.js', () => ({
  autoAdoptProvenConfigIfStale: async () => { calls.proven++; return { adopted: false }; },
}));
vi.mock('../src/services/daemon-autostart.js', () => ({
  ensureDaemonRunning: () => { calls.daemon++; return { started: false }; },
}));
vi.mock('../src/services/live-harness.js', () => ({
  collectLiveHarness: () => ({ line: 'harness │ idle', mcp: { count: 0, servers: [] }, memory: { openPids: [] }, teams: [], staleTeams: [], session: {} }),
}));

import { CLI, isObserveOnlyCommand } from '../src/index.js';
import { codexHookConfig, runHarnessCli } from '../src/commands/harness.js';

const CLI_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('CLI startup side effects skip observe-only commands', () => {
  let out: string[];
  beforeEach(() => {
    for (const k of Object.keys(calls) as Array<keyof typeof calls>) calls[k] = 0;
    out = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: string | Uint8Array) => { out.push(String(s)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((code) => { throw new Error(`process.exit: ${code}`); });
  });
  afterEach(() => vi.restoreAllMocks());

  it('`harness --hook` runs no update check, migration, refresh, adoption or autostart', async () => {
    await new CLI({ interactive: false }).run(['harness', '--hook']);
    await new Promise((r) => setTimeout(r, 0)); // let a fire-and-forget update check land if one started
    expect(calls).toEqual({ update: 0, policy: 0, helpers: 0, proven: 0, daemon: 0 });
    expect(JSON.parse(out.join('')).hookSpecificOutput.additionalContext).toBe('harness │ idle');
  });

  it('control: an ordinary command still gets the startup side effects', async () => {
    const cli = new CLI({ interactive: false });
    (cli as unknown as { parser: { registerCommand(c: unknown): void } }).parser.registerCommand({
      name: 'noop-3521', description: 'test', action: async () => ({ success: true }),
    });
    await cli.run(['noop-3521']);
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual({ update: 1, policy: 1, helpers: 1, proven: 1, daemon: 1 });
  });

  it('only harness is observe-only', () => {
    expect(isObserveOnlyCommand('harness')).toBe(true);
    expect(isObserveOnlyCommand('status')).toBe(false);
    expect(isObserveOnlyCommand(undefined)).toBe(false);
  });
});

describe('runHarnessCli', () => {
  it('--hook swallows probe errors and prints nothing', () => {
    const written: string[] = [];
    const code = runHarnessCli(['--hook'], (t) => written.push(t), () => { throw new Error('boom'); });
    expect(code).toBe(0);
    expect(written).toEqual([]);
  });
});

describe('opt-in Codex hook', () => {
  it('points at this install, disables autostart and updates, and stays quiet', () => {
    const cfg = JSON.parse(codexHookConfig("/opt/it's here/bin/cli.js"));
    const hook = cfg.hooks.SessionStart[0].hooks[0];
    expect(hook.command).toBe(`RUFLO_DAEMON_AUTOSTART=0 node '/opt/it'\\''s here/bin/cli.js' harness --hook --no-update 2>/dev/null || true`);
    expect(hook.command).not.toContain('git rev-parse');
    expect(hook.timeout).toBe(8);
  });
});

describe('bin/cli.js harness fast path', () => {
  function stage(withDist: boolean): { root: string; bin: string } {
    const root = mkdtempSync(join(tmpdir(), 'harness-bin-'));
    mkdirSync(join(root, 'bin'));
    copyFileSync(join(CLI_DIR, 'bin', 'cli.js'), join(root, 'bin', 'cli.js'));
    writeFileSync(join(root, 'package.json'), '{"type":"module","version":"0.0.0"}');
    if (withDist) {
      mkdirSync(join(root, 'dist', 'src', 'commands'), { recursive: true });
      // index.js would throw if bin/cli.js fell through to the normal CLI.
      writeFileSync(join(root, 'dist', 'src', 'index.js'), 'throw new Error("normal CLI startup ran");\n');
      writeFileSync(
        join(root, 'dist', 'src', 'commands', 'harness.js'),
        'export function runHarnessCli(argv) { process.stdout.write(JSON.stringify({ argv }) + "\\n"); return 0; }\n',
      );
    }
    return { root, bin: join(root, 'bin', 'cli.js') };
  }

  it('dispatches to runHarnessCli without loading the CLI class', () => {
    const { bin } = stage(true);
    const stdout = execFileSync(process.execPath, [bin, 'harness', '--hook', '--no-update'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(stdout)).toEqual({ argv: ['--hook', '--no-update'] });
  });

  it('--hook with dist/ missing: exit 0, no stdout, no stderr stack', () => {
    const { bin } = stage(false);
    const r = spawnSync(process.execPath, [bin, 'harness', '--hook'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('without --hook and dist/ missing: one-line error, exit 1', () => {
    const { bin } = stage(false);
    const r = spawnSync(process.execPath, [bin, 'harness'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe('ruflo harness: the CLI is not built (dist/ is missing)');
  });

  it('writes nothing to the working directory', () => {
    const { bin } = stage(true);
    const cwd = mkdtempSync(join(tmpdir(), 'harness-cwd-'));
    mkdirSync(join(cwd, '.claude-flow'));
    writeFileSync(join(cwd, '.claude-flow', 'config.json'), '{}');
    execFileSync(process.execPath, [bin, 'harness', '--hook'], { cwd, stdio: 'ignore' });
    expect(readdirSync(cwd).sort()).toEqual(['.claude-flow']);
    expect(readdirSync(join(cwd, '.claude-flow'))).toEqual(['config.json']);
  });
});
