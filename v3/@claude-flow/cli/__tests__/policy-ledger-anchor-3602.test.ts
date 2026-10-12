import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import {
  autoMigratePolicyStateIfNeeded,
  evaluatePolicyRequest,
  verifyPolicyLedger,
} from '../src/services/policy-runtime.js';
import { policyCommand } from '../src/commands/policy.js';

// #3602: deleting the anchor fields from state.json (together with receipts)
// made `policy verify` report valid and re-establish the anchor on the
// truncated chain. ADR-475.

const roots: Array<{ root: string; trust: string }> = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-policy-3602-'));
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  const id = createHash('sha256').update(realpathSync(root)).digest('hex');
  roots.push({ root, trust: join(userInfo().homedir, '.config', 'ruflo', 'policy-trust', id) });
  return root;
}
afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: ttyOriginal.stdin, configurable: true, writable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: ttyOriginal.stdout, configurable: true, writable: true });
  for (const item of roots.splice(0)) {
    rmSync(item.trust, { recursive: true, force: true });
    rmSync(item.root, { recursive: true, force: true });
  }
});

const statePath = (root: string) => join(root, '.claude-flow', 'policy', 'state.json');
const logPath = (root: string) => join(root, '.claude-flow', 'policy', 'ledger-anchors.json');
const mirrorPath = (root: string) => {
  const id = createHash('sha256').update(realpathSync(root)).digest('hex');
  return join(userInfo().homedir, '.config', 'ruflo', 'policy-trust', id, 'ledger-anchor-head.json');
};
const readState = (root: string) => JSON.parse(readFileSync(statePath(root), 'utf8'));
const writeState = (root: string, state: unknown) => writeFileSync(statePath(root), JSON.stringify(state, null, 2));
const readLog = (root: string) => JSON.parse(readFileSync(logPath(root), 'utf8'));

async function decide(root: string, i: number) {
  return evaluatePolicyRequest({
    identity: { id: `agent:${i}`, type: 'agent' },
    action: { type: 'code.read', resource: `file-${i}` },
  }, root);
}
async function ledgerWith(receipts: number): Promise<string> {
  const root = project();
  await autoMigratePolicyStateIfNeeded(root);
  for (let i = 0; i < receipts; i++) await decide(root, i);
  return root;
}
function truncate(root: string, keep: number, deleteAnchorFields: boolean) {
  const state = readState(root);
  state.receipts.splice(keep);
  if (deleteAnchorFields) {
    delete state.ledgerHead;
    delete state.ledgerLength;
  }
  writeState(root, state);
}
const ttyOriginal = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY };
function setTty(value: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true, writable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true, writable: true });
}
const asInteractive = () => setTty(true);

describe('policy ledger anchor cannot be deleted and silently re-established (#3602)', () => {
  it('reproduction: truncate AND delete the anchor fields is invalid, not established-now', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, true);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: false, length: 3, error: 'policy-ledger-truncated' });
    // and verify did not write a new anchor into state.json
    expect(readState(root).ledgerLength).toBeUndefined();
  });

  it('the CLI exits non-zero for the reproduction', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, true);
    const result = await policyCommand.action!({ args: ['verify'], flags: { projectRoot: root } } as never);
    expect(result).toMatchObject({ success: false, exitCode: 1, data: { valid: false, error: 'policy-ledger-truncated' } });
  });

  it('truncation with intact primary but deleted second anchor still fails', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, false);
    rmSync(logPath(root));
    expect((await verifyPolicyLedger(root)).error).toBe('policy-ledger-truncated');
  });

  it('a deleted second anchor alone (mirror remains) is tamper-suspected', async () => {
    const root = await ledgerWith(5);
    rmSync(logPath(root));
    expect(await verifyPolicyLedger(root)).toEqual({ valid: false, length: 5, error: 'policy-anchor-log-missing' });
  });

  it('truncation plus every project-dir anchor deleted is caught by the mirror in the home directory', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, true);
    rmSync(logPath(root));
    expect((await verifyPolicyLedger(root)).valid).toBe(false);
  });

  it('with both anchors and the mirror gone and receipts present: anchor-missing (documented limit)', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, true);
    rmSync(logPath(root));
    rmSync(mirrorPath(root));
    expect(await verifyPolicyLedger(root)).toEqual({ valid: false, length: 3, error: 'anchor-missing' });
  });

  it('refuses new decisions on a ledger that lost its anchors instead of re-anchoring it', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, true);
    rmSync(logPath(root));
    rmSync(mirrorPath(root));
    await expect(decide(root, 99)).rejects.toThrow('policy-ledger-anchor-missing');
    expect(readState(root).ledgerLength).toBeUndefined();
  });

  it('a ledger whose second anchor was rolled back to an older copy is rejected', async () => {
    const root = await ledgerWith(2);
    const old = readFileSync(logPath(root), 'utf8');
    await decide(root, 10);
    writeFileSync(logPath(root), old);
    expect((await verifyPolicyLedger(root)).error).toBe('policy-anchor-log-rolled-back');
  });

  it('a corrupted anchors file is invalid until an explicit, logged establish rebuilds it', async () => {
    const root = await ledgerWith(3);
    writeFileSync(logPath(root), '{"version":1,"entries":[{"seq":0}]}');
    expect((await verifyPolicyLedger(root)).error).toBe('policy-anchor-log-corrupt');
    await expect(decide(root, 7)).rejects.toThrow('policy-anchor-log-corrupt');

    const result = await verifyPolicyLedger(root, { establishAnchor: true });
    expect(result).toMatchObject({ valid: true, length: 3, secondaryAnchor: 'established-explicitly' });
    expect(readLog(root).entries).toMatchObject([{ length: 3, event: 'establish-anchor', by: userInfo().username }]);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 3 });
    await decide(root, 8);
  });

  it('a corrupted anchors file cannot be rebuilt over a truncation the mirror remembers', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, true);
    writeFileSync(logPath(root), 'not json');
    expect((await verifyPolicyLedger(root, { establishAnchor: true })).error).toBe('policy-ledger-truncated');
  });

  it('genesis: an empty ledger needs no flag and verifies empty', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 0, state: 'empty' });
    expect(existsSync(logPath(root))).toBe(false);
    await decide(root, 0);
    expect(readLog(root).entries).toHaveLength(1);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 1 });
  });

  it('a ledger emptied entirely (receipts and fields) is caught because the second anchor remembers it', async () => {
    const root = await ledgerWith(4);
    truncate(root, 0, true);
    expect((await verifyPolicyLedger(root)).error).toBe('policy-ledger-truncated');
  });

  it('migration: a state.json anchor from an older version is accepted and the second anchor is written', async () => {
    const root = await ledgerWith(4);
    rmSync(logPath(root));
    rmSync(mirrorPath(root));
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 4, secondaryAnchor: 'recorded-from-state' });
    expect(readLog(root).entries).toMatchObject([{ length: 4, event: 'migrated-from-state' }]);
    expect(existsSync(mirrorPath(root))).toBe(true);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 4 });
    truncate(root, 2, true);
    expect((await verifyPolicyLedger(root)).error).toBe('policy-ledger-truncated');
  });

  it('a ledger from a version with no anchor at all gets anchor-missing and a one-step explicit repair', async () => {
    const root = await ledgerWith(4);
    truncate(root, 4, true);
    rmSync(logPath(root));
    rmSync(mirrorPath(root));
    expect(await verifyPolicyLedger(root)).toEqual({ valid: false, length: 4, error: 'anchor-missing' });
    await expect(decide(root, 50)).rejects.toThrow(/verify --establish-anchor/);

    asInteractive();
    const cli = await policyCommand.action!({ args: ['verify'], flags: { projectRoot: root, 'establish-anchor': true } } as never);
    expect(cli).toMatchObject({ success: true, exitCode: 0, data: { valid: true, secondaryAnchor: 'established-explicitly' } });
    const [entry] = readLog(root).entries;
    expect(entry).toMatchObject({ event: 'establish-anchor', length: 4, by: userInfo().username });
    expect(typeof entry.ts).toBe('number');
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 4 });
    await decide(root, 51);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 5 });
  });

  it('--establish-anchor is refused without an interactive terminal', async () => {
    const root = await ledgerWith(2);
    truncate(root, 2, true);
    rmSync(logPath(root));
    rmSync(mirrorPath(root));
    setTty(false);
    const result = await policyCommand.action!({ args: ['verify'], flags: { projectRoot: root, 'establish-anchor': true } } as never);
    expect(result).toMatchObject({ success: false, exitCode: 1 });
    expect(existsSync(logPath(root))).toBe(false);
  });

  it('--establish-anchor cannot bless a truncation the anchors still remember', async () => {
    const root = await ledgerWith(5);
    truncate(root, 3, true);
    expect((await verifyPolicyLedger(root, { establishAnchor: true })).error).toBe('policy-ledger-truncated');
  });

  it('concurrent appends keep a valid, chained second anchor', async () => {
    const root = await ledgerWith(1);
    await Promise.all(Array.from({ length: 10 }, (_, i) => decide(root, 100 + i)));
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 11 });
    const { entries } = readLog(root);
    expect(entries.at(-1).length).toBe(11);
    entries.forEach((entry: { seq: number; prevAnchorHash: string | null }, i: number) => {
      expect(entry.seq).toBe(i);
      expect(entry.prevAnchorHash).toBe(i === 0 ? null : entries[i - 1].hash);
    });
  });

  it('state ahead of the second anchor (crash between the two writes) is caught up, not rejected', async () => {
    const root2 = await ledgerWith(2);
    const lagging = readFileSync(logPath(root2), 'utf8');
    await decide(root2, 20);
    writeFileSync(logPath(root2), lagging);
    rmSync(mirrorPath(root2));
    expect(await verifyPolicyLedger(root2)).toEqual({ valid: true, length: 3 });
    expect(readLog(root2).entries.at(-1).length).toBe(3);
  });
});
