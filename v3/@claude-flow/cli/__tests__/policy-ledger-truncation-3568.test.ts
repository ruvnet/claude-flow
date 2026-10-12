import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import {
  autoMigratePolicyStateIfNeeded,
  evaluatePolicyRequest,
  verifyPolicyLedger,
} from '../src/services/policy-runtime.js';
import { policyCommand } from '../src/commands/policy.js';

// #3568: `policy verify` reported `{"valid": true}` after the most recent
// receipts, or all of them, were deleted from .claude-flow/policy/state.json.

const roots: Array<{ root: string; trust: string }> = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-policy-3568-'));
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  const projectId = createHash('sha256').update(realpathSync(root)).digest('hex');
  roots.push({ root, trust: join(userInfo().homedir, '.config', 'ruflo', 'policy-trust', projectId) });
  return root;
}

afterEach(() => {
  for (const item of roots.splice(0)) {
    rmSync(item.trust, { recursive: true, force: true });
    rmSync(item.root, { recursive: true, force: true });
  }
});

const statePath = (root: string) => join(root, '.claude-flow', 'policy', 'state.json');
const readState = (root: string) => JSON.parse(readFileSync(statePath(root), 'utf8'));
const writeState = (root: string, state: unknown) => writeFileSync(statePath(root), JSON.stringify(state, null, 2));

async function ledgerWith(receipts: number): Promise<string> {
  const root = project();
  await autoMigratePolicyStateIfNeeded(root);
  for (let i = 0; i < receipts; i++) {
    await evaluatePolicyRequest({
      identity: { id: `agent:${i}`, type: 'agent' },
      action: { type: 'code.read', resource: `file-${i}` },
    }, root);
  }
  return root;
}

async function cliVerify(root: string) {
  return policyCommand.action!({ args: ['verify'], flags: { projectRoot: root } } as never);
}

describe('policy verify detects a truncated decision ledger (#3568)', () => {
  it('passes an untouched ledger', async () => {
    const root = await ledgerWith(16);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 16 });
    const result = await cliVerify(root);
    expect(result).toMatchObject({ success: true, exitCode: 0 });
  });

  it.each([
    ['the last receipt', 1],
    ['the last 10 of 16', 10],
    ['every receipt', 16],
  ])('fails when %s is deleted from state.json', async (_label, removed) => {
    const root = await ledgerWith(16);
    const state = readState(root);
    state.receipts.splice(16 - removed, removed);
    writeState(root, state);

    expect(await verifyPolicyLedger(root)).toEqual({
      valid: false,
      length: 16 - removed,
      error: 'policy-ledger-truncated',
    });
    const result = await cliVerify(root);
    expect(result).toMatchObject({
      success: false,
      exitCode: 1,
      data: { valid: false, error: 'policy-ledger-truncated' },
    });
  });

  it('refuses new decisions on a truncated ledger instead of re-anchoring it', async () => {
    const root = await ledgerWith(4);
    const state = readState(root);
    state.receipts.pop();
    writeState(root, state);
    await expect(evaluatePolicyRequest({
      identity: { id: 'agent:late', type: 'agent' },
      action: { type: 'code.read', resource: 'late' },
    }, root)).rejects.toThrow('policy-ledger-truncated');
    expect((await verifyPolicyLedger(root)).error).toBe('policy-ledger-truncated');
  });

  it('restores a deleted primary anchor from the intact second anchor, and still catches truncation (#3602)', async () => {
    const root = await ledgerWith(5);
    const state = readState(root);
    delete state.ledgerHead;
    delete state.ledgerLength;
    writeState(root, state);

    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 5, secondaryAnchor: 'restored-primary' });
    expect(readState(root).ledgerLength).toBe(5);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 5 });

    const anchored = readState(root);
    anchored.receipts.pop();
    writeState(root, anchored);
    expect((await verifyPolicyLedger(root)).error).toBe('policy-ledger-truncated');
  });

  it('answers an empty ledger distinctly', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 0, state: 'empty' });
  });
});
