import './helpers/isolated-policy-trust.js';
import { policyTrustRoot } from '../src/services/policy-ledger-anchor.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  autoMigratePolicyStateIfNeeded,
  evaluatePolicyRequest,
  verifyPolicyLedger,
  withPolicyTransaction,
} from '../src/services/policy-runtime.js';
import { policyCommand } from '../src/commands/policy.js';
import { policyTools } from '../src/mcp-tools/policy-tools.js';
import { anchorLogPath } from '../src/services/policy-ledger-anchor.js';

// #3164: `state.receipts` and `.claude-flow/policy/state.json` grew forever —
// every MCP tool call paid O(all receipts ever issued) to verify/clone/
// serialize the ledger, eventually exceeding the 5s policy lock and timing
// out every tool call. This file covers the runtime-layer retention fix:
// pruning the hot tail, archiving the rest, and still catching tampering and
// truncation (#3568/#3602 must keep working, not just the new behavior).

const policyStatusTool = policyTools.find((tool) => tool.name === 'policy_status')!;

const roots: Array<{ root: string; trust: string }> = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-policy-3164-'));
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  const projectId = createHash('sha256').update(realpathSync(root)).digest('hex');
  roots.push({ root, trust: join(policyTrustRoot(), projectId) });
  return root;
}

afterEach(() => {
  for (const item of roots.splice(0)) {
    rmSync(item.trust, { recursive: true, force: true });
    rmSync(item.root, { recursive: true, force: true });
  }
  delete process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION;
});

const statePath = (root: string) => join(root, '.claude-flow', 'policy', 'state.json');
const archivePath = (root: string) => join(root, '.claude-flow', 'policy', 'receipts.ledger.jsonl');
const readState = (root: string) => JSON.parse(readFileSync(statePath(root), 'utf8'));
const writeState = (root: string, state: unknown) => writeFileSync(statePath(root), JSON.stringify(state, null, 2));
const readArchiveLines = (root: string): string[] => readFileSync(archivePath(root), 'utf8')
  .split('\n')
  .filter((line) => line.trim().length > 0);

async function decide(root: string, i: number) {
  return evaluatePolicyRequest({
    identity: { id: `agent:${i}`, type: 'agent' },
    action: { type: 'code.read', resource: `file-${i}` },
  }, root);
}

async function withRetention<T>(value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION;
  process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION;
    else process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION = previous;
  }
}

async function ledgerWithRetention(root: string, retain: string, count: number): Promise<void> {
  await withRetention(retain, async () => {
    for (let i = 0; i < count; i++) await decide(root, i);
  });
}

describe('policy ledger retention bounds state.json growth and archives pruned receipts (#3164)', () => {
  it('prunes past the retention threshold, keeps state.json bounded, and archives the rest', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '5', 12);

    const state = readState(root);
    expect(state.receipts).toHaveLength(5);
    expect(state.retainedFrom).toBe(7);
    expect(state.prunedHead).toBe(state.receipts[0].payload.previousReceiptHash);

    const archived = readArchiveLines(root).map((line) => JSON.parse(line));
    expect(archived).toHaveLength(7);
    expect(archived.map((r) => r.payload.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);

    // a later, normal transaction still succeeds against the pruned ledger
    await withRetention('5', () => decide(root, 100));
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 13 });
  });

  it('fast verify (the hot path every MCP call takes) stays valid across many prune cycles', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '3', 20);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 20 });
    expect(readState(root).receipts).toHaveLength(3);
  });

  it('verifyPolicyLedger({ full: true }) validates the complete historical chain across archive + hot tail', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '4', 15);

    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 15 });
    expect(await verifyPolicyLedger(root, { full: true })).toEqual({ valid: true, length: 15 });
  });

  it('wires through `ruflo policy verify --full` and MCP policy_status({ full: true })', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '4', 9);

    const cli = await policyCommand.action!({ args: ['verify'], flags: { projectRoot: root, full: true } } as never);
    expect(cli).toMatchObject({ success: true, exitCode: 0, data: { valid: true, length: 9 } });

    const status = await policyStatusTool.handler({ full: true }, { projectRoot: root });
    expect(status).toMatchObject({ ledger: { valid: true, length: 9 } });

    const statusFast = await policyStatusTool.handler({}, { projectRoot: root });
    expect(statusFast).toMatchObject({ ledger: { valid: true, length: 9 } });
  });

  it('a state.json with no retainedFrom/prunedHead at all (pre-#3164 shape) verifies and operates identically', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    // Default retention (2000) is far above this count, so nothing prunes —
    // this is today's on-disk shape, byte for byte.
    for (let i = 0; i < 5; i++) await decide(root, i);
    const state = readState(root);
    expect(state.retainedFrom).toBeUndefined();
    expect(state.prunedHead).toBeUndefined();

    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 5 });
    await decide(root, 50);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 6 });
  });
});

describe('#3164 crash-duplicate archive window', () => {
  it('dedupes an identical re-appended line (archive-append landed, state write of the smaller retainedFrom did not, then the next prune re-wrote the same receipts)', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '3', 10);
    const before = await verifyPolicyLedger(root, { full: true });
    expect(before).toEqual({ valid: true, length: 10 });

    const lines = readArchiveLines(root);
    // Simulate the documented crash: the same already-archived line appended
    // again, byte for byte (what a re-prune of the un-shrunk state produces).
    appendFileSync(archivePath(root), `${lines[0]}\n`);

    expect(await verifyPolicyLedger(root, { full: true })).toEqual({ valid: true, length: 10 });
  });

  it('detects a genuine conflict — same sequence, different hash — as tampering, not a harmless duplicate', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '3', 10);

    const lines = readArchiveLines(root);
    const conflicting = JSON.parse(lines[0]);
    conflicting.hash = `${'0'.repeat(63)}1`;
    appendFileSync(archivePath(root), `${JSON.stringify(conflicting)}\n`);

    const result = await verifyPolicyLedger(root, { full: true });
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
    // the fast path (hot tail only) is unaffected by archive corruption
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 10 });
  });

  it('detects a genuine gap in the archive as policy-ledger-archive-gap', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '3', 10);

    const lines = readArchiveLines(root);
    lines.splice(3, 1);
    writeFileSync(archivePath(root), `${lines.join('\n')}\n`);

    const result = await verifyPolicyLedger(root, { full: true });
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-gap' });
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 10 });
  });
});

describe('#3164 pruning does not weaken tamper/truncation detection in the retained hot tail (regression)', () => {
  it('still catches a tampered receipt that survived pruning into the hot tail', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '3', 8);

    const state = readState(root);
    expect(state.receipts).toHaveLength(3);
    state.receipts[0].payload.decision.reason = 'tampered';
    writeState(root, state);

    const result = await verifyPolicyLedger(root);
    expect(result).toMatchObject({ valid: false, error: 'receipt-hash-mismatch' });
    // reports the absolute index within the FULL historical ledger (retainedFrom + 0),
    // not the hot-array index
    expect(result.length).toBe(5);

    await expect(withRetention('3', () => decide(root, 999))).rejects.toThrow();
  });

  it('still catches truncation of the hot tail after pruning (#3568 regression under retention)', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '3', 8);

    const state = readState(root);
    state.receipts.pop();
    writeState(root, state);

    expect(await verifyPolicyLedger(root)).toMatchObject({ valid: false, error: 'policy-ledger-truncated' });
  });
});

describe('#3164 retention keeps the #3602 second anchor in agreement with hot state across prune boundaries', () => {
  it('normal sequential operation never regresses into anchor-missing/anchor-mismatch across many prune cycles', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '2', 30);

    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 30 });
    const log = JSON.parse(readFileSync(anchorLogPath(root), 'utf8'));
    expect(log.entries).toHaveLength(30);
    expect(log.entries.at(-1).length).toBe(30);
  });

  it('a concurrent transaction burst with pruning enabled keeps a valid, chained second anchor', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '5', 3);

    await withRetention('5', () => Promise.all(Array.from({ length: 10 }, (_, i) => decide(root, 100 + i))));

    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 13 });
    const log = JSON.parse(readFileSync(anchorLogPath(root), 'utf8'));
    expect(log.entries.at(-1).length).toBe(13);
    log.entries.forEach((entry: { seq: number; prevAnchorHash: string | null }, i: number) => {
      expect(entry.seq).toBe(i);
      expect(entry.prevAnchorHash).toBe(i === 0 ? null : log.entries[i - 1].hash);
    });
  });
});

describe('#3164 CLAUDE_FLOW_POLICY_LEDGER_RETENTION overrides', () => {
  it('retain=0 archives committed receipts on the next transaction and keeps the latest transaction until then', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '0', 3);

    const state = readState(root);
    expect(state.receipts).toHaveLength(1);
    expect(state.retainedFrom).toBe(2);
    await withRetention('0', () => withPolicyTransaction(root, () => undefined));
    expect(readState(root).receipts).toHaveLength(0);
    expect(readState(root).retainedFrom).toBe(3);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 3 });
    expect(await verifyPolicyLedger(root, { full: true })).toEqual({ valid: true, length: 3 });
  });

  it('a negative or non-integer override falls back to the default retention (no pruning for a small ledger)', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    await ledgerWithRetention(root, '-5', 10);
    expect(readState(root).retainedFrom).toBeUndefined();

    await ledgerWithRetention(root, 'not-a-number', 1);
    expect(readState(root).retainedFrom).toBeUndefined();
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 11 });
  });
});
