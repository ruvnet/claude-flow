import { describe, expect, it, vi, beforeEach } from 'vitest';

// e2e finding (ADR-490): on a fresh CODEX_HOME, `ruflo init --dual` ran `codex plugin marketplace add ruvnet/ruflo` under a 20 s execSync
// timeout. Measured on this machine the clone takes ~17.5 s alone and longer under the load init itself creates, so the add was killed, the
// error was swallowed, and `codex plugin add ruflo-core@ruflo` then failed with "plugin ruflo-core was not found in marketplace ruflo".
// The user only saw the second error, which names the wrong cause.

const calls: Array<{ cmd: string; timeout?: number }> = [];
let marketplaceError: Error | undefined;

vi.mock('child_process', () => ({
  execSync: (cmd: string, opts?: { timeout?: number }) => {
    calls.push({ cmd, timeout: opts?.timeout });
    if (cmd.startsWith('which codex')) return Buffer.from('/usr/bin/codex');
    if (cmd.startsWith('codex plugin list')) return JSON.stringify({ plugins: [] });
    if (cmd.startsWith('codex plugin marketplace add')) {
      if (marketplaceError) throw marketplaceError;
      return Buffer.from('');
    }
    if (cmd.startsWith('codex plugin add')) {
      if (marketplaceError) throw new Error('Error: plugin `ruflo-core` was not found in marketplace `ruflo`');
      return Buffer.from('');
    }
    return Buffer.from('');
  },
}));

async function install() {
  const { CodexInitializer } = await import('../src/initializer.js');
  const init = new CodexInitializer() as unknown as { installRufloCorePlugin(): Promise<{ installed: boolean; warning?: string }> };
  return init.installRufloCorePlugin();
}

describe('installRufloCorePlugin marketplace clone budget (e2e finding, ADR-490)', () => {
  beforeEach(() => {
    calls.length = 0;
    marketplaceError = undefined;
    vi.resetModules();
  });

  it('gives the marketplace clone far more than the 17.5 s it measurably takes', async () => {
    await install();
    const add = calls.find((c) => c.cmd.startsWith('codex plugin marketplace add'));
    expect(add?.timeout).toBeGreaterThanOrEqual(120_000);
  });

  it('names the marketplace failure, not only the downstream "plugin not found", when the clone does not finish', async () => {
    marketplaceError = Object.assign(new Error('spawnSync /bin/sh ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const result = await install();
    expect(result.installed).toBe(false);
    expect(result.warning).toMatch(/marketplace/i);
    expect(result.warning).toMatch(/ETIMEDOUT|timed out/i);
  });
});
