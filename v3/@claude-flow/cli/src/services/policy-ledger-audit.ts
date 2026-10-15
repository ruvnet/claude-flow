/** Bounded-memory full policy audit. The caller owns the captured archive FD.
 * Only bytes below its locked snapshot boundary are read; normal later appends
 * do not join the audit. Disk scratch is private, disposable, never ledger state.
 */
import { AgenticPolicyEngine, canonicalizePolicy, type LedgerVerification, type PolicyReceipt, type PolicyState } from '@claude-flow/security/policy/index';
import { createHash } from 'node:crypto';
import { closeSync, chmodSync, constants, fstatSync, mkdtempSync, openSync, read, readSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeLedgerRecord, policyLedgerRecordLimit } from './policy-ledger-record.js';

export interface ArchiveSnapshot { fd: number; size: number }
const CHUNK_BYTES = 64 * 1024;
const INDEX_BYTES = 48;
function fail(error: string): never { throw new Error(error); }

/** Must run under the policy writer lock. O(1), with no whole-file read. */
export function captureArchiveSnapshot(file: string): ArchiveSnapshot | undefined {
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    fail('policy-ledger-archive-not-regular');
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) fail('policy-ledger-archive-not-regular');
    return { fd, size: stat.size };
  } catch (error) { closeSync(fd); throw error; }
}

function readAt(fd: number, buffer: Buffer, offset: number, length: number, position: number): Promise<number> {
  return new Promise((resolve, reject) => read(fd, buffer, offset, length, position, (error, count) => error ? reject(error) : resolve(count)));
}
async function readExact(snapshot: ArchiveSnapshot, offset: number, length: number, limit: number): Promise<Buffer> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0
    || length > limit || offset > snapshot.size - length) fail('policy-ledger-archive-changed');
  const buffer = Buffer.allocUnsafe(length);
  let count = 0;
  while (count < length) {
    const next = await readAt(snapshot.fd, buffer, count, length - count, offset + count);
    if (!next) fail('policy-ledger-archive-changed');
    count += next;
  }
  return buffer;
}
interface PhysicalRecord { bytes: Buffer; offset: number }
async function* records(snapshot: ArchiveSnapshot, limit: number): AsyncGenerator<PhysicalRecord> {
  const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
  let position = 0;
  let recordStart = 0;
  let parts: Buffer[] = [];
  let partBytes = 0;
  while (position < snapshot.size) {
    const count = await readAt(snapshot.fd, chunk, 0, Math.min(chunk.length, snapshot.size - position), position);
    if (!count) fail('policy-ledger-archive-changed');
    let cursor = 0;
    while (cursor < count) {
      const newline = chunk.indexOf(10, cursor);
      const end = newline < 0 || newline >= count ? count : newline;
      const piece = chunk.subarray(cursor, end);
      partBytes += piece.length;
      if (partBytes > limit) fail(`policy-ledger-archive-record-too-large:${limit}`);
      if (end === count) { parts.push(Buffer.from(piece)); break; }
      const bytes = parts.length ? Buffer.concat([...parts, piece], partBytes) : Buffer.from(piece);
      yield { bytes, offset: recordStart };
      recordStart = position + end + 1;
      parts = [];
      partBytes = 0;
      cursor = end + 1;
    }
    position += count;
  }
  if (partBytes !== 0) fail('policy-ledger-archive-parse-error');
}
function parsed(bytes: Buffer): PolicyReceipt | undefined {
  const text = decodeLedgerRecord(bytes);
  if (!text.trim()) return undefined;
  try { return JSON.parse(text) as PolicyReceipt; } catch { fail('policy-ledger-archive-parse-error'); }
}
const digest = (canonical: string): Buffer => createHash('sha256').update(canonical).digest();
function writeAll(fd: number, bytes: Buffer, position: number): void {
  let count = 0;
  while (count < bytes.length) {
    const next = writeSync(fd, bytes, count, bytes.length - count, position + count);
    if (!next) fail('policy-ledger-audit-index-write-error');
    count += next;
  }
}
function readIndex(fd: number, sequence: number): Buffer {
  const position = sequence * INDEX_BYTES;
  if (!Number.isSafeInteger(position)) fail('policy-ledger-archive-gap');
  const row = Buffer.alloc(INDEX_BYTES);
  const count = readSync(fd, row, 0, row.length, position);
  if (count !== 0 && count !== row.length) fail('policy-ledger-audit-index-read-error');
  return row;
}
async function observedRecord(snapshot: ArchiveSnapshot, row: Buffer, limit: number, verifier: AgenticPolicyEngine): Promise<{ receipt: PolicyReceipt; canonical: string }> {
  const offsetBig = row.readBigUInt64LE(0);
  if (offsetBig > BigInt(Number.MAX_SAFE_INTEGER)) fail('policy-ledger-audit-index-read-error');
  const bytes = await readExact(snapshot, Number(offsetBig), row.readUInt32LE(8), limit);
  const receipt = parsed(bytes);
  if (!receipt || verifier.verifyReceipt(receipt)) fail('policy-ledger-archive-conflict');
  const canonical = canonicalizePolicy(receipt);
  if (!digest(canonical).equals(row.subarray(16))) fail('policy-ledger-archive-changed');
  return { receipt, canonical };
}

/** Every physical record is authenticated before deduplication, including
 * unclaimed staging records. The fixed-width index only addresses the bounded
 * snapshot's claimed prefix; arbitrary extra sequence numbers never set sparse
 * file offsets. Exact full canonical equality is checked on duplicate rereads.
 * Scratch I/O is disposable and does not need fsync or mutate the ledger.
 */
export async function verifyFullPolicyLedger(
  snapshot: ArchiveSnapshot | undefined,
  state: PolicyState,
  engineOptions: { signingKey?: string; keyId?: string },
): Promise<LedgerVerification> {
  const retainedFrom = state.retainedFrom ?? 0;
  const length = retainedFrom + state.receipts.length;
  let scratch: string | undefined;
  let index: number | undefined;
  try {
    const limit = policyLedgerRecordLimit();
    if (!Number.isSafeInteger(retainedFrom) || retainedFrom < 0 || !Number.isSafeInteger(length)) fail('policy-ledger-archive-gap');
    if (!snapshot) {
      if (retainedFrom > 0) fail('policy-ledger-archive-gap');
      return AgenticPolicyEngine.fromState(state, engineOptions).verifyLedger();
    }
    // At least one byte must exist for each claimed receipt. This also rejects
    // malicious sparse-index lengths before creating scratch or replay loops.
    if (retainedFrom > snapshot.size) fail('policy-ledger-archive-gap');
    if (fstatSync(snapshot.fd).size < snapshot.size) fail('policy-ledger-archive-changed');
    scratch = mkdtempSync(join(tmpdir(), 'ruflo-policy-audit-'));
    chmodSync(scratch, 0o700);
    index = openSync(join(scratch, 'index'), 'wx+', 0o600);
    const verifier = new AgenticPolicyEngine(engineOptions);
    let claimedUnique = 0;
    for await (const physical of records(snapshot, limit)) {
      const receipt = parsed(physical.bytes);
      if (receipt === undefined) continue;
      if (verifier.verifyReceipt(receipt)) fail('policy-ledger-archive-conflict');
      const sequence = receipt.payload.sequence;
      const canonical = canonicalizePolicy(receipt);
      if (sequence < retainedFrom) {
        const row = readIndex(index, sequence);
        if (row.readUInt32LE(8) !== 0) {
          const first = await observedRecord(snapshot, row, limit, verifier);
          if (first.canonical !== canonical) fail('policy-ledger-archive-conflict');
        } else {
          row.writeBigUInt64LE(BigInt(physical.offset), 0);
          row.writeUInt32LE(physical.bytes.length, 8);
          digest(canonical).copy(row, 16);
          writeAll(index, row, sequence * INDEX_BYTES);
          claimedUnique++;
        }
      } else if (sequence < length) {
        if (canonicalizePolicy(state.receipts[sequence - retainedFrom]) !== canonical) fail('policy-ledger-archive-conflict');
      } else {
        // Rare, unclaimed staging extras are still authenticated and deduped;
        // decimal safe-integer names never choose a path or a sparse offset.
        const file = join(scratch, `extra-${sequence}`);
        const canonicalBytes = Buffer.from(canonical);
        let fd: number;
        try { fd = openSync(file, 'wx', 0o600); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
          try {
            const stat = fstatSync(fd);
            if (!stat.isFile()) fail('policy-ledger-audit-index-read-error');
            // Canonical finite numbers can expand beyond a fixed multiple of
            // raw input bytes. Compare the already-bounded incoming value's
            // exact encoded length before allocating any scratch read buffer.
            if (stat.size !== canonicalBytes.length) fail('policy-ledger-archive-conflict');
            const stored = Buffer.alloc(stat.size);
            if (readSync(fd, stored, 0, stored.length, 0) !== stored.length || !stored.equals(canonicalBytes)) fail('policy-ledger-archive-conflict');
          } finally { closeSync(fd); }
          continue;
        }
        try { writeAll(fd, canonicalBytes, 0); } finally { closeSync(fd); }
      }
    }
    if (claimedUnique !== retainedFrom) fail('policy-ledger-archive-gap');
    let previous: string | null = null;
    for (let sequence = 0; sequence < retainedFrom; sequence++) {
      const row = readIndex(index, sequence);
      if (!row.readUInt32LE(8)) fail('policy-ledger-archive-gap');
      const { receipt } = await observedRecord(snapshot, row, limit, verifier);
      if (receipt.payload.sequence !== sequence || receipt.payload.previousReceiptHash !== previous) fail('receipt-chain-mismatch');
      previous = receipt.hash;
    }
    if (retainedFrom > 0 && previous !== state.prunedHead) fail('receipt-chain-mismatch');
    const hot = AgenticPolicyEngine.fromState(state, engineOptions).verifyLedger();
    if (!hot.valid) return hot;
    if (fstatSync(snapshot.fd).size < snapshot.size) fail('policy-ledger-archive-changed');
    return hot;
  } catch (error) {
    const message = (error as Error).message;
    return { valid: false, length, error: message.startsWith('policy-ledger-') || message === 'receipt-chain-mismatch' ? message : 'policy-ledger-audit-io-error' };
  } finally {
    if (index !== undefined) closeSync(index);
    if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  }
}
