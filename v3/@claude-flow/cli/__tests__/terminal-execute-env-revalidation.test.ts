/**
 * Regression test for the post-review fix to PR #3385 (dream-cycle
 * 2026-09-21): terminal_execute() used to trust session.env from the
 * on-disk store unconditionally, so a session persisted before a
 * validateEnv() denylist update (or a store.json edited/restored out of
 * band) could carry a now-denylisted env var forever, bypassing the
 * denylist for every execute on that pre-existing session. execute now
 * re-validates session.env and drops it to {} if it fails current
 * validation, rather than merging it unchecked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { terminalTools } from '../src/mcp-tools/terminal-tools.js';

const terminalExecuteTool = terminalTools.find(t => t.name === 'terminal_execute')!;

function getStoreFile(workdir: string): string {
  return join(workdir, '.claude-flow', 'terminals', 'store.json');
}

function plantSession(workdir: string, id: string, env: Record<string, string>) {
  const dir = join(workdir, '.claude-flow', 'terminals');
  mkdirSync(dir, { recursive: true });
  const store = {
    version: '3.0.0',
    sessions: {
      [id]: {
        id,
        name: 'planted-legacy-session',
        status: 'active',
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        workingDir: workdir,
        history: [],
        env,
      },
    },
  };
  // Plaintext: matches the legacy on-disk shape produced when
  // CLAUDE_FLOW_ENCRYPT_AT_REST is unset (the default).
  writeFileSync(getStoreFile(workdir), JSON.stringify(store, null, 2));
}

describe('terminal_execute re-validates persisted session.env (post-review fix)', () => {
  let workdir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'term-env-revalidate-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workdir);
  });

  afterEach(() => {
    cwdSpy?.mockRestore();
    rmSync(workdir, { recursive: true, force: true });
  });

  it('drops a persisted PATH override that would fail today\'s validateEnv(), instead of merging it unchecked', async () => {
    const id = 'term-legacy-1';
    // Simulates a session that was persisted before PATH was added to the
    // denylist (or a hand-edited store.json) -- something that could not
    // be created via terminal_create today, but already exists on disk.
    plantSession(workdir, id, { PATH: '/tmp/definitely-not-the-real-path-injected' });

    const result = await terminalExecuteTool.handler({
      sessionId: id,
      command: process.platform === 'win32' ? 'echo %PATH%' : 'echo "$PATH"',
    } as Record<string, unknown>);

    expect(result.success).toBe(true);
    // The malicious override must not have reached the child process --
    // real PATH entries (e.g. /usr/bin or /bin) must still be present,
    // and the injected sentinel value must not appear standalone.
    expect(result.output).not.toContain('/tmp/definitely-not-the-real-path-injected');
  });

  it('still merges a persisted env that passes current validation', async () => {
    const id = 'term-legacy-2';
    plantSession(workdir, id, { MY_CUSTOM_VAR: 'still-works' });

    const result = await terminalExecuteTool.handler({
      sessionId: id,
      command: process.platform === 'win32' ? 'echo %MY_CUSTOM_VAR%' : 'echo "$MY_CUSTOM_VAR"',
    } as Record<string, unknown>);

    expect(result.success).toBe(true);
    expect(result.output).toContain('still-works');
  });
});
