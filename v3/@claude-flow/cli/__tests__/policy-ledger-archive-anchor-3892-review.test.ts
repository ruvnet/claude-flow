import './helpers/isolated-policy-trust.js';
import { policyTrustRoot } from '../src/services/policy-ledger-anchor.js';
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { AgenticPolicyEngine } from '@claude-flow/security';
import {
  autoMigratePolicyStateIfNeeded,
  evaluatePolicyRequest,
  verifyPolicyLedger,
} from '../src/services/policy-runtime.js';
import { anchorLogPath } from '../src/services/policy-ledger-anchor.js';

// PR #3892 maintainer review (ruvnet nightly-triage, 2026-10-11): three
// confirmed blockers on top of #3164 (ledger retention/archive) + #3602
// (external anchor). This file closes all three:
//   1. Default (non-`--full`) verify never looked at the archive at all,
//      so pruning + archive tampering went undetected unless `--full` was
//      explicitly requested.
//   2. `dedupeArchiveReceipts` only compared `hash` strings, never
//      recomputed a receipt's hash from its own content.
//   3. `--full` held the policy-state lock for the entire O(total-history)
//      replay, reintroducing the lock contention #3164 fixed on the hot
//      path.

const roots: Array<{ root: string; trust: string }> = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-policy-3892-'));
  mkdirSync(join(root, '.claude-flow'), { recursive: true });
  const id = createHash('sha256').update(realpathSync(root)).digest('hex');
  roots.push({ root, trust: join(policyTrustRoot(), id) });
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
const lockPath = (root: string) => join(root, '.claude-flow', 'policy', 'state.lock');
const mirrorPath = (root: string) => {
  const id = createHash('sha256').update(realpathSync(root)).digest('hex');
  return join(policyTrustRoot(), id, 'ledger-anchor-head.json');
};
const readState = (root: string) => JSON.parse(readFileSync(statePath(root), 'utf8'));
const writeState = (root: string, state: unknown) => writeFileSync(statePath(root), JSON.stringify(state, null, 2));
const readLog = (root: string) => JSON.parse(readFileSync(anchorLogPath(root), 'utf8'));
const writeLog = (root: string, log: unknown) => writeFileSync(anchorLogPath(root), JSON.stringify(log, null, 2));
const readMirror = (root: string) => JSON.parse(readFileSync(mirrorPath(root), 'utf8'));
const writeMirror = (root: string, entry: unknown) => writeFileSync(mirrorPath(root), JSON.stringify(entry, null, 2));
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

async function prunedLedger(retain: string, count: number): Promise<string> {
  const root = project();
  await autoMigratePolicyStateIfNeeded(root);
  await withRetention(retain, async () => {
    for (let i = 0; i < count; i++) await decide(root, i);
  });
  return root;
}

/**
 * Builds a large pruned ledger in-memory (bypassing the per-transaction
 * file-locking path, which would make a 20k-receipt fixture far too slow
 * for a test) so the --full replay has measurable, non-trivial cost for
 * the Blocker 3 cross-process lock test.
 */
async function bigPrunedLedger(total: number, retain: number): Promise<string> {
  const root = project();
  mkdirSync(join(root, '.claude-flow', 'policy'), { recursive: true });
  const engine = new AgenticPolicyEngine({});
  for (let i = 0; i < total; i++) {
    engine.evaluate({ identity: { id: `agent:${i}`, type: 'agent' }, action: { type: 'code.read', resource: `f-${i}` } });
  }
  engine.verifyLedger({ establishAnchor: true });
  const pruned = engine.pruneReceipts(retain);
  writeState(root, engine.exportState());
  writeFileSync(archivePath(root), `${pruned.map((receipt) => JSON.stringify(receipt)).join('\n')}\n`);
  // One normal call establishes the #3602 second anchor (log + mirror) to
  // match this hand-built state.
  expect((await verifyPolicyLedger(root)).valid).toBe(true);
  return root;
}

// #3892: a hash computed the same way `entryHash` computes it for an entry
// that has no archive fields at all — i.e. exactly what pre-this-fix code
// wrote. Used to hand-craft a "transitional" ledger without depending on
// code that no longer exists.
function oldFormatHash(entry: {
  seq: number; length: number; headHash: string | null; prevAnchorHash: string | null;
  ts: number; event: string; by?: string;
}): string {
  return createHash('sha256').update(JSON.stringify([
    entry.seq, entry.length, entry.headHash, entry.prevAnchorHash, entry.ts, entry.event, entry.by ?? null,
  ])).digest('hex');
}

function stripArchiveFields(entry: Record<string, unknown>): Record<string, unknown> {
  const { archivedThrough, archiveHeadHash, hash, ...rest } = entry;
  return { ...rest, hash: oldFormatHash(rest as never) };
}

describe('#3892 Blocker 1: default verify must check the archive\'s tip, not just the hot tail', () => {
  it('reproduction: deleting the archive is caught by default (non-full) verify', async () => {
    const root = await prunedLedger('3', 10);
    expect((await verifyPolicyLedger(root)).valid).toBe(true);
    rmSync(archivePath(root));
    const result = await verifyPolicyLedger(root);
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-tampered' });
  });

  it('reproduction: emptying the archive is caught by default verify', async () => {
    const root = await prunedLedger('3', 10);
    truncateSync(archivePath(root), 0);
    const result = await verifyPolicyLedger(root);
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-tampered' });
  });

  it('reproduction: truncating (dropping the trailing line of) the archive is caught by default verify', async () => {
    const root = await prunedLedger('3', 10);
    const lines = readArchiveLines(root);
    lines.pop();
    writeFileSync(archivePath(root), `${lines.join('\n')}\n`);
    const result = await verifyPolicyLedger(root);
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-tampered' });
  });

  it('reproduction: editing decision.outcome in the archive\'s last receipt is caught by default verify', async () => {
    const root = await prunedLedger('3', 10);
    const lines = readArchiveLines(root);
    const tampered = JSON.parse(lines[lines.length - 1]!);
    tampered.payload.decision.outcome = 'denied';
    // The stale `hash` field is deliberately left untouched — the naive
    // tamper a reviewer would actually write by hand.
    lines[lines.length - 1] = JSON.stringify(tampered);
    writeFileSync(archivePath(root), `${lines.join('\n')}\n`);
    const result = await verifyPolicyLedger(root);
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-tampered' });
  });

  it('the fast hot-tail checks are unaffected: truncating the archive does not flag a healthy hot tail as truncated', async () => {
    const root = await prunedLedger('3', 10);
    rmSync(archivePath(root));
    const result = await verifyPolicyLedger(root);
    expect(result.error).toBe('policy-ledger-archive-tampered');
    expect(result.error).not.toBe('policy-ledger-truncated');
  });

  it('KNOWN, DISCLOSED coverage boundary (tester-6): a self-consistent INTERIOR edit that leaves the tip untouched is NOT caught by default verify, and IS caught by --full', async () => {
    // This is not a bug to fix — it is the inherent trade-off of a cheap
    // tip check over an O(total-history) replay (see the file-level and
    // archiveHasTailReceipt doc comments in policy-ledger-anchor.ts). This
    // test pins the boundary so it can't silently widen OR silently
    // "improve" without someone noticing the hot-path cost implications.
    const root = await prunedLedger('3', 10);
    const lines = readArchiveLines(root);

    // Tamper an interior receipt (sequence 2, not the tip at sequence 6)
    // and recompute ONLY its own hash, so it is self-consistent in
    // isolation. Its `previousReceiptHash`/chain-forward relationship to
    // later receipts is now broken, but nothing downstream re-checks that
    // on the default path — only a full replay walks the chain.
    const tampered = JSON.parse(lines[2]!);
    tampered.payload.decision.reason = 'surgically-tampered-interior-receipt';
    const { policyHash } = await import('@claude-flow/security');
    tampered.hash = policyHash(tampered.payload);
    lines[2] = JSON.stringify(tampered);
    writeFileSync(archivePath(root), `${lines.join('\n')}\n`);

    // Default verify: the tip (sequence 6) is untouched and still matches
    // the anchor, so this reports valid — the disclosed gap.
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 10 });

    // --full replays the whole chain and catches the broken link.
    const full = await verifyPolicyLedger(root, { full: true });
    expect(full.valid).toBe(false);
  });
});

describe('#3892 Blocker 1: backward compatibility with pre-archive-anchoring ledgers', () => {
  it('a ledger pruned by the old anchor shape (no archivedThrough) is not failed outright, and gets caught up', async () => {
    const root = await prunedLedger('3', 10);

    // Simulate a ledger pruned before this fix existed: strip the archive
    // fields from both the log's last entry and the mirror, recomputing
    // their hash the way the old code did.
    const log = readLog(root);
    const lastIndex = log.entries.length - 1;
    log.entries[lastIndex] = stripArchiveFields(log.entries[lastIndex]);
    writeLog(root, log);
    writeMirror(root, stripArchiveFields(readMirror(root)));

    // Must NOT fail outright.
    const first = await verifyPolicyLedger(root);
    expect(first).toEqual({ valid: true, length: 10 });

    // The transitional anchor must have been caught up with a fresh entry.
    const updatedLog = readLog(root);
    expect(updatedLog.entries.at(-1)).toMatchObject({ archivedThrough: 7 });
    expect(readMirror(root)).toMatchObject({ archivedThrough: 7 });

    // The archive is now actually protected going forward.
    rmSync(archivePath(root));
    const second = await verifyPolicyLedger(root);
    expect(second).toMatchObject({ valid: false, error: 'policy-ledger-archive-tampered' });
  });

  it('accepts a genuine older mirror after a failed best-effort write, and rejects a forged nonmember mirror', async () => {
    const root = await prunedLedger('3', 10);

    // Transitional ledger: strip archive fields from both copies.
    const log = readLog(root);
    const preTransitionEntry = log.entries[log.entries.length - 1];
    log.entries[log.entries.length - 1] = stripArchiveFields(preTransitionEntry);
    writeLog(root, log);
    const oldMirror = stripArchiveFields(readMirror(root));
    writeMirror(root, oldMirror);

    // One real transaction catches both copies up with archive fields —
    // this is the normal, correct path (already covered above).
    await decide(root, 999);

    // Simulate a mirror write that failed on that transaction (home
    // directory read-only, per recordAnchor's documented degradation): the
    // mirror is left pointing at the OLD, pre-catch-up entry, which is
    // still a real, present entry in the log (mirror and log entries are
    // written together in the non-degraded case, so this is the only way
    // they can legitimately disagree about archive fields once the ledger
    // has already been pruned).
    writeMirror(root, oldMirror);

    const result = await verifyPolicyLedger(root);
    // The mirror still authenticates an exact entry of the validated log;
    // state-ahead publication plus a best-effort mirror failure is legitimate.
    expect(result).toMatchObject({ valid: true, length: 11 });
    const forged = stripArchiveFields({ ...oldMirror, length: oldMirror.length + 100 });
    writeMirror(root, forged);
    expect(await verifyPolicyLedger(root)).toMatchObject({ valid: false, error: 'policy-anchor-log-rolled-back' });
  });

  it('a ledger that has never been pruned stays byte-identical: no archive fields are ever written', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    for (let i = 0; i < 5; i++) await decide(root, i);

    const log = readLog(root);
    for (const entry of log.entries) {
      expect(Object.hasOwn(entry, 'archivedThrough')).toBe(false);
      expect(Object.hasOwn(entry, 'archiveHeadHash')).toBe(false);
      // The hash must match the pre-existing (7-field) formula exactly.
      expect(entry.hash).toBe(oldFormatHash(entry));
    }
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 5 });
  });
});

describe('#3892 Blocker 2: dedupeArchiveReceipts must verify a receipt\'s own hash, not just compare hash strings', () => {
  it('a lone archive receipt whose stored hash does not match its own payload is rejected, even with no duplicate', async () => {
    const root = await prunedLedger('3', 10);
    const lines = readArchiveLines(root);
    const tampered = JSON.parse(lines[0]!);
    tampered.payload.decision.reason = 'tampered-without-recomputing-hash';
    // hash left stale on purpose.
    lines[0] = JSON.stringify(tampered);
    writeFileSync(archivePath(root), `${lines.join('\n')}\n`);

    const result = await verifyPolicyLedger(root, { full: true });
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });

  it('two same-sequence candidates with a copied hash string but different payload content are rejected', async () => {
    const root = await prunedLedger('3', 10);
    const lines = readArchiveLines(root);
    const original = JSON.parse(lines[0]!);
    const forged = { ...original, payload: { ...original.payload, decision: { ...original.payload.decision, reason: 'forged' } } };
    // forged.hash is copied from `original` verbatim — it will not match
    // forged's own recomputed content hash, so the per-record
    // self-consistency check (not the duplicate-specific deep-equal check)
    // is what actually catches this: a genuine SHA-256 collision would be
    // needed to reach the deep-equal branch, which is cryptographically
    // infeasible to construct in a test.
    writeFileSync(archivePath(root), `${[...lines, JSON.stringify(forged)].join('\n')}\n`);

    const result = await verifyPolicyLedger(root, { full: true });
    expect(result).toMatchObject({ valid: false, error: 'policy-ledger-archive-conflict' });
  });

  it('still dedupes a genuine crash-duplicate (identical re-appended line) as harmless', async () => {
    const root = await prunedLedger('3', 10);
    const lines = readArchiveLines(root);
    appendFileSync(archivePath(root), `${lines[0]}\n`);
    expect(await verifyPolicyLedger(root, { full: true })).toEqual({ valid: true, length: 10 });
  });
});

describe('#3892 follow-up (team-lead review): a torn read must fail clean, not throw', () => {
  it('a torn/unparseable MIDDLE line during --full fails clean instead of throwing', async () => {
    const root = await prunedLedger('3', 10);
    const lines = readArchiveLines(root);
    // Torn a line other than the tail (sequence 6, index 6): the tail stays
    // intact and self-consistent, so Blocker 1's fast archive-tip check
    // (which runs first, inside reconcileLedger, even when options.full is
    // set) passes and the call actually reaches the --full replay path —
    // this is what distinguishes this test from simply tearing the tail,
    // which the fast check alone would already catch as
    // 'policy-ledger-archive-tampered' before ever reaching the parser
    // this test is targeting. This is exactly what a concurrent
    // `appendFileSync` mid-write (or a crash) could leave behind: a
    // truncated fragment of a JSON line that cannot parse.
    lines[2] = lines[2]!.slice(0, 15);
    writeFileSync(archivePath(root), `${lines.join('\n')}\n`);

    await expect(verifyPolicyLedger(root, { full: true })).resolves.toMatchObject({
      valid: false,
      error: 'policy-ledger-archive-parse-error',
    });
    // The fast (default) path never reads the full archive content, so a
    // torn middle line that doesn't disturb the tail is invisible to it.
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 10 });
  });
});

describe('#3892 Blocker 3: --full must not hold the policy-state lock for the whole replay', () => {
  it('a transaction started immediately after a --full verify is not starved waiting on a lock the replay no longer holds', async () => {
    const root = await prunedLedger('4', 30);
    // Sanity: the lock file does not outlive the call at all (covers both
    // the fast-path reconcile and the full replay).
    const verification = await verifyPolicyLedger(root, { full: true });
    expect(verification.valid).toBe(true);
    expect(existsSync(lockPath(root))).toBe(false);
    await withRetention('4', () => decide(root, 999));
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 31 });
  });

  it('a SEPARATE process observes the lock held only for the cheap reconcile, not for the whole slow --full replay (real cross-process concurrency)', async () => {
    // 20k receipts makes the O(total-history) replay (dedupe + full chain
    // verify) take tens to low-hundreds of ms — long enough to give a
    // waiting process a meaningfully larger window to lose, if the lock
    // were (as before this fix) held for the whole call.
    const root = await bigPrunedLedger(20_000, 10);
    const lock = lockPath(root);
    expect(existsSync(lock)).toBe(false);

    // A genuinely separate OS process (not just another promise in this
    // same single-threaded event loop, which a CPU-bound synchronous
    // replay would starve regardless of the lock) that busy-polls for the
    // lock file's existence, then busy-polls to re-acquire it the instant
    // it is removed — measuring exactly how long the lock was HELD, not
    // how long the whole parent call took. Uses writeSync(1, ...) rather
    // than process.stdout.write so signals are flushed synchronously and
    // are not deferred behind the busy loop.
    const probeScript = `
      const { openSync, closeSync, existsSync, writeSync } = require('node:fs');
      const lockPath = process.argv[1];
      writeSync(1, 'READY\\n');
      const deadline1 = Date.now() + 10000;
      while (!existsSync(lockPath)) {
        if (Date.now() > deadline1) { writeSync(1, 'TIMEOUT\\n'); process.exit(1); }
      }
      const heldSince = Date.now();
      const deadline2 = heldSince + 10000;
      for (;;) {
        try {
          const fd = openSync(lockPath, 'wx', 0o600);
          closeSync(fd);
          writeSync(1, 'ELAPSED:' + (Date.now() - heldSince) + '\\n');
          break;
        } catch {
          if (Date.now() > deadline2) { writeSync(1, 'TIMEOUT\\n'); process.exit(1); }
        }
      }
    `;
    const child = spawn(process.execPath, ['-e', probeScript, lock], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer = '';
    const seen = { ready: false };
    const readyPromise = new Promise<void>((resolveReady) => {
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        if (!seen.ready && buffer.includes('READY')) { seen.ready = true; resolveReady(); }
      });
    });
    const elapsedPromise = new Promise<number>((resolveElapsed, rejectElapsed) => {
      child.stdout.on('data', () => {
        const match = buffer.match(/ELAPSED:(\d+)/);
        if (match) resolveElapsed(Number(match[1]));
        else if (buffer.includes('TIMEOUT')) rejectElapsed(new Error('probe process timed out'));
      });
    });

    try {
      await readyPromise;
      const start = Date.now();
      const result = await verifyPolicyLedger(root, { full: true });
      const totalDurationMs = Date.now() - start;
      expect(result).toEqual({ valid: true, length: 20_000 });

      const childHeldForMs = await elapsedPromise;
      // The lock should be released long before the full replay finishes —
      // held only for the cheap reconcile, a small fraction of the total
      // call duration (and in absolute terms, well under 50ms).
      expect(childHeldForMs).toBeLessThan(Math.max(50, totalDurationMs * 0.5));
      expect(totalDurationMs).toBeGreaterThan(childHeldForMs);
    } finally {
      // The probe created the lock file and never released it (no
      // transaction to pair the release with in this test).
      rmSync(lock, { force: true });
      if (!child.killed) child.kill();
    }
  }, 20_000);
});

describe('#3892 regression guard: existing #3568/#3602/#3164 behavior is unchanged', () => {
  it('a plain unpruned ledger with intact anchors verifies valid with no archive-specific errors', async () => {
    const root = project();
    await autoMigratePolicyStateIfNeeded(root);
    for (let i = 0; i < 4; i++) await decide(root, i);
    expect(await verifyPolicyLedger(root)).toEqual({ valid: true, length: 4 });
    expect(await verifyPolicyLedger(root, { full: true })).toEqual({ valid: true, length: 4 });
  });

  it('truncation of the hot tail after pruning is still caught (#3568 under retention)', async () => {
    const root = await prunedLedger('3', 8);
    const state = readState(root);
    state.receipts.pop();
    writeState(root, state);
    expect(await verifyPolicyLedger(root)).toMatchObject({ valid: false, error: 'policy-ledger-truncated' });
  });

  it('a tampered receipt in the hot tail is still caught (#3164 regression)', async () => {
    const root = await prunedLedger('3', 8);
    const state = readState(root);
    state.receipts[0].payload.decision.reason = 'tampered';
    writeState(root, state);
    const result = await verifyPolicyLedger(root);
    expect(result).toMatchObject({ valid: false, error: 'receipt-hash-mismatch' });
  });
});
