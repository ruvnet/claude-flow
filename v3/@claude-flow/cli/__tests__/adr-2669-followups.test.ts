/**
 * ADR-320/318/319 (#2669) — expanded follow-up coverage requested by the
 * coordinator on top of the four base files:
 *  - runSessionEnd executed directly (byte-identical persistence: session-end /
 *    compact-manual / compact-auto all call THIS function) + null-sessionId
 *    graceful degradation;
 *  - the statusLine `node -e` one-liner actually EXECUTED with and without
 *    CLAUDE_PROJECT_DIR, resolving the helper without spawning git;
 *  - the daemon's private sampleForegroundSnapshot() driven end-to-end over a
 *    real per-session marker tree (skips dead-pid markers, samples live ones);
 *  - the --state-probe opt-in wiring (flag → config → fork-arg forward, + the
 *    sampler timer .unref()) — the "not silently dropped like --headless" guard.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

import { WorkerDaemon } from '../src/services/worker-daemon.js';
import { isPidAlive } from '../src/session/foreground-snapshot.js';

const require = createRequire(import.meta.url);
const CLI_ROOT = process.cwd();
const DEAD_PID = 2_147_483_647; // out-of-range on Linux → process.kill(pid,0) is not EPERM → not alive

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'adr2669-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function sessionDir(id: string): string {
  return join(root, '.claude-flow', 'session', id);
}
function markerPath(id: string): string {
  return join(sessionDir(id), 'session.json');
}
function writeMarker(id: string, pid: number): void {
  mkdirSync(sessionDir(id), { recursive: true });
  writeFileSync(markerPath(id), JSON.stringify({ pid, startedAt: Date.now() }));
}

describe('ADR-320 — runSessionEnd is the single shared persistence path (executed directly)', () => {
  const hh = require(join(CLI_ROOT, '.claude/helpers/hook-handler.cjs')) as {
    runSessionEnd: (sessionId?: string | null) => Promise<void>;
  };

  let savedProjectDir: string | undefined;
  beforeEach(() => {
    savedProjectDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = root; // getProjectRoot() → our tmp tree
  });
  afterEach(() => {
    if (savedProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedProjectDir;
  });

  it('deletes the session marker for the given sessionId (the ADR-322 lifecycle op)', async () => {
    writeMarker('s-end', process.pid);
    expect(existsSync(markerPath('s-end'))).toBe(true);

    // All three hook subcommands are literally `() => runSessionEnd(sessionId)`,
    // so this one execution IS the byte-identical persistence for all of them.
    await hh.runSessionEnd('s-end');
    expect(existsSync(markerPath('s-end'))).toBe(false);
  });

  it('degrades gracefully with a null / undefined sessionId (no throw, no deletion)', async () => {
    writeMarker('untouched', process.pid);
    await expect(hh.runSessionEnd(null)).resolves.not.toThrow();
    await expect(hh.runSessionEnd()).resolves.not.toThrow();
    // With no sessionId there is nothing to invalidate — an unrelated marker survives.
    expect(existsSync(markerPath('untouched'))).toBe(true);
  });
});

describe('ADR-320 — statusLine one-liner executes without a git spawn', () => {
  // Extract the inline JS from executor.ts's NEW_STATUSLINE_CMD (`node -e "<js>"`)
  // and actually run it, both with and without CLAUDE_PROJECT_DIR set.
  const src = readFileSync(join(CLI_ROOT, 'src/init/executor.ts'), 'utf-8');
  const cmd = src.match(/const NEW_STATUSLINE_CMD\s*=\s*`([^`]*)`/)![1];
  const innerJs = cmd.match(/^node -e "(.*)"$/)![1];

  function runResolver(env: NodeJS.ProcessEnv, cwd: string): string {
    return execFileSync(process.execPath, ['-e', innerJs], { env, cwd, encoding: 'utf-8' });
  }

  beforeEach(() => {
    // Minimal stub helper the one-liner should resolve + require().
    mkdirSync(join(root, '.claude/helpers'), { recursive: true });
    writeFileSync(join(root, '.claude/helpers/statusline.cjs'), "console.log('STUB_STATUSLINE_OK');");
  });

  it('resolves via CLAUDE_PROJECT_DIR when set', () => {
    const out = runResolver({ ...process.env, CLAUDE_PROJECT_DIR: root }, tmpdir());
    expect(out).toContain('STUB_STATUSLINE_OK');
  });

  it('falls back to process.cwd() when CLAUDE_PROJECT_DIR is absent', () => {
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const out = runResolver(env, root); // cwd is the project root
    expect(out).toContain('STUB_STATUSLINE_OK');
  });

  it('the executed one-liner contains no git spawn', () => {
    expect(innerJs).not.toMatch(/rev-parse|execSync|\bgit\b/);
  });
});

describe('ADR-322 — daemon sampleForegroundSnapshot() over a real marker tree', () => {
  function makeDaemon(): { sampleForegroundSnapshot(): void; config: { foregroundProbeEnabled: boolean } } {
    return new WorkerDaemon(root, { foregroundProbeEnabled: true }) as unknown as {
      sampleForegroundSnapshot(): void;
      config: { foregroundProbeEnabled: boolean };
    };
  }

  it('confirms the DEAD_PID sentinel is genuinely not alive on this host', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(DEAD_PID)).toBe(false);
  });

  it('samples for a live-pid session and skips a dead-pid session', () => {
    writeMarker('live', process.pid);
    writeMarker('dead', DEAD_PID);

    makeDaemon().sampleForegroundSnapshot();

    const liveSnap = join(sessionDir('live'), 'foreground-snapshot.json');
    const deadSnap = join(sessionDir('dead'), 'foreground-snapshot.json');
    expect(existsSync(liveSnap)).toBe(true);
    expect(existsSync(deadSnap)).toBe(false);

    const snap = JSON.parse(readFileSync(liveSnap, 'utf-8'));
    expect(snap.sampledBy).toBe('daemon'); // ADR-322 (e)
    expect(typeof snap._ts).toBe('number');
    expect(typeof snap._pid).toBe('number');
  });

  it('does not throw when there are no session directories at all', () => {
    expect(() => makeDaemon().sampleForegroundSnapshot()).not.toThrow();
    expect(existsSync(join(root, '.claude-flow', 'session'))).toBe(false);
  });

  it('honors the config-arg opt-in (foregroundProbeEnabled precedence)', () => {
    expect(makeDaemon().config.foregroundProbeEnabled).toBe(true);
    const off = new WorkerDaemon(root, { foregroundProbeEnabled: false }) as unknown as {
      config: { foregroundProbeEnabled: boolean };
    };
    expect(off.config.foregroundProbeEnabled).toBe(false);
  });
});

describe('ADR-322 — --state-probe wiring is not silently dropped', () => {
  it('daemon.ts registers the flag, sets the config, and forwards it through fork args', () => {
    const src = readFileSync(join(CLI_ROOT, 'src/commands/daemon.ts'), 'utf-8');
    expect(src).toMatch(/name:\s*'state-probe'/);
    expect(src).toMatch(/config\.foregroundProbeEnabled\s*=\s*true/);
    // The forward is the exact regression the coordinator flagged (--headless
    // was almost dropped historically): stateProbe → forkArgs.push('--state-probe').
    expect(src).toMatch(/forkArgs\.push\(\s*'--state-probe'\s*\)/);
  });

  it('worker-daemon.ts unref()s the sampler timer so it never keeps the process alive', () => {
    const src = readFileSync(join(CLI_ROOT, 'src/services/worker-daemon.ts'), 'utf-8');
    // Assert an actual call, not just the identifier appearing in a comment.
    expect(src).toMatch(/this\.foregroundProbeTimer\.unref\(\)/);
  });
});
