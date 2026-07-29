import { createHash } from 'node:crypto';
import type { RunEvidence, RunReceipt } from './contract.js';
import { canonicalJson } from './repository-state.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an ISO timestamp`);
  return parsed;
}

function validateRun(run: RunEvidence): void {
  if (!run.executionId.trim() || !run.sessionId.trim() || !run.workloadId.trim()) {
    throw new Error('run execution, session, and workload identity are required');
  }
  if (!DIGEST.test(run.sourceState.sourceStateId)) throw new Error('run sourceStateId is invalid');
  if (!DIGEST.test(run.commandDigest) || !DIGEST.test(run.evidenceDigest)) {
    throw new Error('run command and evidence digests must be canonical sha256 values');
  }
  if (!Number.isSafeInteger(run.exitCode)) throw new Error('run exitCode must be a safe integer');
  const started = timestamp(run.startedAt, 'startedAt');
  const completed = timestamp(run.completedAt, 'completedAt');
  if (completed < started) throw new Error('run completedAt precedes startedAt');
  if (
    run.buildEvidence !== undefined
    && run.buildEvidence.sourceStateId !== run.sourceState.sourceStateId
  ) {
    throw new Error('build evidence belongs to a different source state');
  }
}

/**
 * Unsigned, non-durable, content-addressed in-memory conformance ledger.
 *
 * Exact retries converge on one receipt. Reusing an execution ID with changed
 * evidence is refused rather than rewriting history. These receipts are local
 * debugging evidence and cannot authorize enforce mode or release.
 */
export class InMemoryRunReceiptReference {
  readonly referenceOnly = true;
  private readonly receipts = new Map<string, RunReceipt>();
  private readonly executionReceipts = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  recordRun(run: RunEvidence): RunReceipt {
    validateRun(run);
    const canonical = canonicalJson(run);
    const receiptId = sha256(canonical);
    const existingExecution = this.executionReceipts.get(run.executionId);
    if (existingExecution !== undefined && existingExecution !== receiptId) {
      throw new Error(`executionId ${run.executionId} already records different evidence`);
    }
    const existing = this.receipts.get(receiptId);
    if (existing) return copy(existing);

    const receipt: RunReceipt = {
      ...copy(run),
      receiptId,
      recordedAt: new Date(this.now()).toISOString(),
    };
    this.receipts.set(receiptId, receipt);
    this.executionReceipts.set(run.executionId, receiptId);
    return copy(receipt);
  }

  get(receiptId: string): RunReceipt | undefined {
    const receipt = this.receipts.get(receiptId);
    return receipt ? copy(receipt) : undefined;
  }

  all(): RunReceipt[] {
    return [...this.receipts.values()].map(copy);
  }
}
