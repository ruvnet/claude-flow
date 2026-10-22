/**
 * #3398 — policy-runtime writeJsonAtomic: a single renameSync that fails with
 * EPERM (Windows: destination briefly held open by another reader, AV, an
 * indexer) failed the whole MCP call and left `state.json.<pid>.<uuid>.tmp`
 * behind.
 *
 * Windows' rename-over-open-file semantics cannot be reproduced on Linux, so
 * this test simulates them the way the reporter did: `renameSync` throws
 * EPERM/EBUSY for the first N attempts at the policy state file. What it
 * proves is the retry + cleanup logic, not the OS interaction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';

const renameFault = vi.hoisted(() => ({
  failures: 0,
  code: 'EPERM',
  attempts: 0,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const renameSync: typeof actual.renameSync = (from, to) => {
    if (String(to).endsWith(join('.claude-flow', 'policy', 'state.json'))) {
      renameFault.attempts += 1;
      if (renameFault.failures > 0) {
        renameFault.failures -= 1;
        const error = new Error(`${renameFault.code}: operation not permitted, rename '${String(from)}' -> '${String(to)}'`) as NodeJS.ErrnoException;
        error.code = renameFault.code;
        throw error;
      }
    }
    return actual.renameSync(from, to);
  };
  return { ...actual, default: { ...actual, renameSync }, renameSync };
});

const { autoMigratePolicyStateIfNeeded, evaluatePolicyRequest } = await import('../src/services/policy-runtime.js');

const roots: Array<{ root: string; trust: string }> = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-3398-'));
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  const projectId = createHash('sha256').update(realpathSync(root)).digest('hex');
  roots.push({ root, trust: join(userInfo().homedir, '.config', 'ruflo', 'policy-trust', projectId) });
  return root;
}

function policyDir(root: string): string {
  return join(root, '.claude-flow', 'policy');
}

function orphanTemps(root: string): string[] {
  return readdirSync(policyDir(root)).filter((name) => name.endsWith('.tmp'));
}

const request = {
  identity: { id: 'agent-1', type: 'agent' as const },
  action: { type: 'memory.read', resource: 'memory_search', tool: 'memory_search' },
};

beforeEach(() => {
  renameFault.failures = 0;
  renameFault.code = 'EPERM';
  renameFault.attempts = 0;
});

afterEach(() => {
  for (const item of roots.splice(0)) {
    rmSync(item.trust, { recursive: true, force: true });
    rmSync(item.root, { recursive: true, force: true });
  }
});

describe('#3398 policy state write survives transient rename failures', () => {
  it('retries a transient EPERM rename and commits the state (no orphan .tmp)', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    const before = JSON.parse(readFileSync(join(policyDir(root), 'state.json'), 'utf8'));

    renameFault.failures = 2;
    renameFault.attempts = 0;
    const decision = await evaluatePolicyRequest(request, root);

    expect(decision.enforcedOutcome).toBe('allowed');
    expect(renameFault.attempts).toBe(3);
    const after = JSON.parse(readFileSync(join(policyDir(root), 'state.json'), 'utf8'));
    expect(after.receipts.length).toBe(before.receipts.length + 1);
    expect(orphanTemps(root)).toEqual([]);
  });

  it('retries EBUSY/EACCES the same way', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    for (const code of ['EBUSY', 'EACCES']) {
      renameFault.code = code;
      renameFault.failures = 1;
      await expect(evaluatePolicyRequest(request, root)).resolves.toMatchObject({ enforcedOutcome: 'allowed' });
    }
    expect(orphanTemps(root)).toEqual([]);
  });

  it('gives up after a bounded number of attempts, still fails closed, and removes the temp file', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    renameFault.failures = Number.MAX_SAFE_INTEGER;
    renameFault.attempts = 0;

    const started = Date.now();
    await expect(evaluatePolicyRequest(request, root)).rejects.toMatchObject({ code: 'EPERM' });
    expect(renameFault.attempts).toBeGreaterThan(1);
    // Bounded: must stay well inside the 5s state.lock wait other callers use.
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(orphanTemps(root)).toEqual([]);
  });

  it('does not retry a non-transient error, and removes the temp file', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    renameFault.code = 'EXDEV';
    renameFault.failures = Number.MAX_SAFE_INTEGER;
    renameFault.attempts = 0;

    await expect(evaluatePolicyRequest(request, root)).rejects.toMatchObject({ code: 'EXDEV' });
    expect(renameFault.attempts).toBe(1);
    expect(orphanTemps(root)).toEqual([]);
  });
});
