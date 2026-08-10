/**
 * ADR-322A promotion transaction.
 *
 * A single atomic state file is the authority for active champion, receipt
 * consumption, lineage head, and serving epoch. Cross-process mutation is
 * serialized with an O_EXCL lock; atomic rename commits all authoritative state
 * at once. Runtime policy materialization is derived and recoverable.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyChampionParams, type ApplyResult } from '../config/harness-feedback-applier.js';
import {
  GENESIS_LEDGER_HEAD,
  canonicalizeJcs,
  sha256Ref,
  uuidV7,
  verifyFlywheelReceipt,
  type FlywheelEvaluationReceipt,
} from './flywheel-receipt.js';
import {
  DEFAULT_ALPHA_TOTAL,
  DEFAULT_LAMBDA,
  minInformativePairsToClear,
  sequentialEvidenceVerdict,
} from './flywheel-sequential-evidence.js';

const STATE_VERSION = 1 as const;
const STATE_DIR = ['.claude-flow', 'flywheel-v1'] as const;
const STATE_FILE = 'transaction-state.json';
const LOCK_FILE = 'transaction-state.lock';
const RECEIPTS_DIR = 'receipts';
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 60_000;

export interface ReceiptState {
  receiptId: string;
  status: 'evaluated' | 'consumed' | 'expired' | 'revoked';
  registeredAt: number;
  promotedAt: number | null;
  promotionTransactionId: string | null;
}

export interface PromotionCommit {
  commitId: string;
  transactionId: string;
  receiptId: string;
  lineageId: string;
  sequence: number;
  previousLedgerHead: string;
  baselineRef: string;
  candidateId: string;
  servingEpoch: number;
  proposer: string;
  proposerSubstitution?: string;
  promotedAt: number;
}

export interface FlywheelTransactionState {
  version: typeof STATE_VERSION;
  activeChampionRef: string | null;
  activePolicy: Record<string, unknown> | null;
  activeGateVersion: string | null;
  activePolicySchemaVersion: string | null;
  activeSafetyEnvelopeRef: string | null;
  ledgerHead: string;
  servingEpoch: number;
  materializedServingEpoch: number;
  servedChampionRef: string | null;
  receiptStates: Record<string, ReceiptState>;
  commits: PromotionCommit[];
  /**
   * Sequential-evidence alpha ledger (ADR-381): receiptId → 1-based test
   * index in this ledger's promotion-test stream for the CURRENT evidence
   * epoch. The stream is scoped to the transaction state itself (one ledger,
   * one champion chain, one stream) — NOT to receipt lineageIds, which
   * default to a fresh UUID per run and would void the control. An index is
   * allocated the first time a receipt is presented to the promotion gate
   * and persists whether or not the candidate promoted — looking spends
   * alpha, and retrying the same receipt reuses its index (no double spend,
   * no index shopping). Absent in pre-upgrade state files; readers treat
   * missing as empty.
   */
  sequentialTests?: Record<string, number>;
  /** Current evidence epoch (ADR-381 §2). Incremented only by an explicit governed reset. */
  evidenceEpoch?: number;
  /**
   * Wall-clock boundary (ms) of the current evidence epoch — the `now` an
   * explicit reset ran at. A receipt whose OWN evidence (payload.issuedAt)
   * predates this boundary belongs to a prior epoch even if it happens to be
   * registered/promoted after the reset — the exact "index shopping" ADR-381
   * §2 requires the epoch mechanism to prevent. Undefined for the genesis
   * epoch (no lower bound) and for state files written before this field
   * existed.
   */
  evidenceEpochStartedAt?: number;
  /** Append-only audit trail of evidence resets. Nothing is ever deleted from it. */
  sequentialResets?: SequentialResetRecord[];
}

export interface SequentialResetRecord {
  /** The epoch that was CLOSED by this reset. */
  epoch: number;
  at: number;
  reason: string;
  /** Alpha spend archived from the closed epoch (receiptId → test index). */
  testsSpent: Record<string, number>;
  /** Outstanding 'evaluated' receipts expired by the reset (fresh-data enforcement). */
  expiredReceipts: string[];
}

export interface EvidenceResetResult {
  success: boolean;
  reason: string;
  closedEpoch?: number;
  newEpoch?: number;
  testsArchived?: number;
  receiptsExpired?: number;
}

export interface PromotionResult {
  success: boolean;
  idempotent: boolean;
  reason: string;
  transactionId?: string;
  receiptId?: string;
  championRef?: string;
  ledgerHead?: string;
  servingEpoch?: number;
  materialized?: boolean;
  materializeReason?: string;
}

export interface PromoteOptions {
  confirm: boolean;
  now?: number;
  trustedPublicKeys?: Set<string>;
  approvedAttestors?: Set<string>;
  allowedProposerSubstitutions?: Set<string>;
  applyFn?: (root: string, policy: Record<string, unknown>, championRef: string, previous: string | null, now: number) => ApplyResult;
  /**
   * Strict promotion evidence (default true): the receipt must carry
   * task-level pairedOutcomes AND clear the sequential-evidence e-process at
   * this test's allocated share of the family-wise alpha budget. Set false
   * ONLY as an explicit migration escape hatch for pre-upgrade receipts —
   * aggregate-only evidence is otherwise refused, never silently accepted.
   */
  requirePairedEvidence?: boolean;
  /** Family-wise type-I budget across the whole candidate stream (default 0.05). */
  sequentialAlphaTotal?: number;
  /** e-process betting fraction in (0,1) (default 0.5). */
  sequentialLambda?: number;
  /** Test-only crash hook; production callers leave unset. */
  faultAt?: 'before-commit' | 'after-commit-before-materialize';
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function stateDir(root: string): string {
  return path.join(root, ...STATE_DIR);
}

function statePath(root: string): string {
  return path.join(stateDir(root), STATE_FILE);
}

function lockPath(root: string): string {
  return path.join(stateDir(root), LOCK_FILE);
}

function receiptDir(root: string): string {
  return path.join(stateDir(root), RECEIPTS_DIR);
}

function assertSafeFile(file: string): void {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`refusing symlink: ${file}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function ensureDir(root: string): void {
  fs.mkdirSync(receiptDir(root), { recursive: true, mode: 0o700 });
  assertSafeFile(statePath(root));
  assertSafeFile(lockPath(root));
}

function emptyState(): FlywheelTransactionState {
  return {
    version: STATE_VERSION,
    activeChampionRef: null,
    activePolicy: null,
    activeGateVersion: null,
    activePolicySchemaVersion: null,
    activeSafetyEnvelopeRef: null,
    ledgerHead: GENESIS_LEDGER_HEAD,
    servingEpoch: 0,
    materializedServingEpoch: 0,
    servedChampionRef: null,
    receiptStates: {},
    commits: [],
  };
}

export function readFlywheelTransactionState(root: string): FlywheelTransactionState {
  try {
    assertSafeFile(statePath(root));
    const parsed = JSON.parse(fs.readFileSync(statePath(root), 'utf8')) as FlywheelTransactionState;
    if (parsed.version !== STATE_VERSION || !parsed.receiptStates || !Array.isArray(parsed.commits)) return emptyState();
    return parsed;
  } catch {
    return emptyState();
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  assertSafeFile(file);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try {
    fs.writeFileSync(fd, `${canonicalizeJcs(value)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  const dirFd = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
}

async function withStateLock<T>(root: string, fn: () => T | Promise<T>): Promise<T> {
  ensureDir(root);
  const lock = lockPath(root);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const fd = fs.openSync(lock, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }), 'utf8');
      fs.closeSync(fd);
      try {
        return await fn();
      } finally {
        try { fs.unlinkSync(lock); } catch { /* lock already gone */ }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const stat = fs.lstatSync(lock);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch { /* raced with owner */ }
      if (Date.now() >= deadline) throw new Error('timed out acquiring flywheel transaction lock');
      await delay(5);
    }
  }
}

function validateReceiptId(receiptId: string): void {
  if (!/^sha256:[a-f0-9]{64}$/.test(receiptId)) throw new Error('invalid receipt ID');
}

function receiptPath(root: string, receiptId: string): string {
  validateReceiptId(receiptId);
  return path.join(receiptDir(root), `${receiptId.slice('sha256:'.length)}.json`);
}

export function readFlywheelReceipt(root: string, receiptId: string): FlywheelEvaluationReceipt | null {
  try {
    const file = receiptPath(root, receiptId);
    assertSafeFile(file);
    return JSON.parse(fs.readFileSync(file, 'utf8')) as FlywheelEvaluationReceipt;
  } catch {
    return null;
  }
}

/**
 * Start a new evidence epoch (ADR-381 §2): archive the current alpha spend
 * into the append-only reset audit trail, EXPIRE every outstanding
 * 'evaluated' receipt (the new epoch may only promote evidence produced
 * after the reset — structurally enforcing fresh data), clear the spend
 * ledger, and increment the epoch. Requires explicit confirmation and a
 * non-empty human reason; the CLI/MCP surfaces additionally gate this
 * through the same policy engine as promotion.
 */
export async function resetSequentialEvidence(
  root: string,
  options: { confirm: boolean; reason: string; now?: number },
): Promise<EvidenceResetResult> {
  if (!options.confirm) return { success: false, reason: 'explicit confirmation required' };
  const reason = (options.reason ?? '').trim();
  if (!reason) return { success: false, reason: 'a non-empty reason is required — the reset audit trail records intent' };
  const now = options.now ?? Date.now();
  return withStateLock(root, () => {
    const state = readFlywheelTransactionState(root);
    const closedEpoch = state.evidenceEpoch ?? 0;
    const testsSpent = { ...(state.sequentialTests ?? {}) };
    const expiredReceipts: string[] = [];
    for (const record of Object.values(state.receiptStates)) {
      if (record.status === 'evaluated') {
        record.status = 'expired';
        expiredReceipts.push(record.receiptId);
      }
    }
    const resets = state.sequentialResets ?? [];
    resets.push({ epoch: closedEpoch, at: now, reason, testsSpent, expiredReceipts: [...expiredReceipts].sort() });
    state.sequentialResets = resets;
    state.sequentialTests = {};
    state.evidenceEpoch = closedEpoch + 1;
    state.evidenceEpochStartedAt = now;
    atomicWriteJson(statePath(root), state);
    return {
      success: true,
      reason: `evidence epoch ${closedEpoch} closed — ${Object.keys(testsSpent).length} test(s) archived, ${expiredReceipts.length} outstanding receipt(s) expired`,
      closedEpoch,
      newEpoch: state.evidenceEpoch,
      testsArchived: Object.keys(testsSpent).length,
      receiptsExpired: expiredReceipts.length,
    };
  });
}

export async function registerFlywheelReceipt(
  root: string,
  receipt: FlywheelEvaluationReceipt,
  now = Date.now(),
): Promise<ReceiptState> {
  ensureDir(root);
  validateReceiptId(receipt.payload.receiptId);
  const file = receiptPath(root, receipt.payload.receiptId);
  if (!fs.existsSync(file)) atomicWriteJson(file, receipt);
  return withStateLock(root, () => {
    const state = readFlywheelTransactionState(root);
    const existing = state.receiptStates[receipt.payload.receiptId];
    if (existing) return existing;
    const record: ReceiptState = {
      receiptId: receipt.payload.receiptId,
      status: 'evaluated',
      registeredAt: now,
      promotedAt: null,
      promotionTransactionId: null,
    };
    state.receiptStates[receipt.payload.receiptId] = record;
    atomicWriteJson(statePath(root), state);
    return record;
  });
}

function materialize(
  root: string,
  state: FlywheelTransactionState,
  now: number,
  applyFn?: PromoteOptions['applyFn'],
): ApplyResult {
  if (!state.activeChampionRef || !state.activePolicy) return { applied: false, reason: 'no active champion' };
  const previous = state.servedChampionRef;
  const apply = applyFn ?? ((projectRoot, policy, championRef, prior, appliedAt) =>
    applyChampionParams(projectRoot, {
      championId: championRef,
      params: policy,
      layer: 'repo/local',
      previous: prior,
      now: appliedAt,
    }));
  return apply(root, state.activePolicy, state.activeChampionRef, previous, now);
}

export async function recoverFlywheelMaterialization(
  root: string,
  opts: Pick<PromoteOptions, 'now' | 'applyFn'> = {},
): Promise<PromotionResult> {
  const now = opts.now ?? Date.now();
  const before = readFlywheelTransactionState(root);
  if (!before.activeChampionRef || before.servingEpoch === before.materializedServingEpoch) {
    return { success: true, idempotent: true, reason: 'materialization current', materialized: true };
  }
  const applied = materialize(root, before, now, opts.applyFn);
  if (!applied.applied && applied.reason !== 'already active') {
    return {
      success: false,
      idempotent: false,
      reason: 'promotion committed; materialization pending',
      championRef: before.activeChampionRef,
      servingEpoch: before.servingEpoch,
      materialized: false,
      materializeReason: applied.reason,
    };
  }
  await withStateLock(root, () => {
    const state = readFlywheelTransactionState(root);
    if (state.activeChampionRef === before.activeChampionRef && state.servingEpoch === before.servingEpoch) {
      state.materializedServingEpoch = state.servingEpoch;
      state.servedChampionRef = state.activeChampionRef;
      atomicWriteJson(statePath(root), state);
    }
  });
  return {
    success: true,
    idempotent: !applied.applied,
    reason: 'materialized',
    championRef: before.activeChampionRef,
    servingEpoch: before.servingEpoch,
    materialized: true,
  };
}

export async function promoteFlywheelCandidate(
  root: string,
  receiptId: string,
  options: PromoteOptions,
): Promise<PromotionResult> {
  if (!options.confirm) return { success: false, idempotent: false, reason: 'explicit confirmation required' };
  if (!options.trustedPublicKeys?.size) {
    return { success: false, idempotent: false, reason: 'at least one trusted receipt signer is required' };
  }
  const receipt = readFlywheelReceipt(root, receiptId);
  if (!receipt) return { success: false, idempotent: false, reason: 'receipt not found' };
  const verification = verifyFlywheelReceipt(receipt, options.trustedPublicKeys);
  if (!verification.valid) {
    return { success: false, idempotent: false, reason: `receipt verification failed: ${verification.errors.join(', ')}` };
  }
  const now = options.now ?? Date.now();
  const transaction = await withStateLock(root, () => {
    const state = readFlywheelTransactionState(root);
    const receiptState = state.receiptStates[receiptId];
    if (!receiptState) return { success: false, idempotent: false, reason: 'receipt is not registered' } satisfies PromotionResult;
    if (receiptState.status === 'consumed' && receiptState.promotionTransactionId) {
      const prior = state.commits.find((c) => c.transactionId === receiptState.promotionTransactionId);
      return {
        success: true,
        idempotent: true,
        reason: 'already promoted',
        transactionId: prior?.transactionId,
        receiptId,
        championRef: prior?.candidateId ?? state.activeChampionRef ?? undefined,
        ledgerHead: state.ledgerHead,
        servingEpoch: prior?.servingEpoch ?? state.servingEpoch,
      } satisfies PromotionResult;
    }
    if (receiptState.status !== 'evaluated' || receiptState.promotedAt !== null) {
      return { success: false, idempotent: false, reason: `receipt state is ${receiptState.status}` } satisfies PromotionResult;
    }
    if (receipt.payload.decision !== 'accepted') return { success: false, idempotent: false, reason: 'receipt decision is not accepted' } satisfies PromotionResult;
    if (Date.parse(receipt.payload.expiresAt) <= now) return { success: false, idempotent: false, reason: 'receipt expired' } satisfies PromotionResult;

    if (state.activeChampionRef === null) {
      state.activeChampionRef = receipt.payload.baselineRef;
      state.activeGateVersion = receipt.payload.gateVersion;
      state.activePolicySchemaVersion = receipt.payload.policySchemaVersion;
      state.activeSafetyEnvelopeRef = receipt.payload.safetyEnvelopeRef;
    }
    if (state.activeChampionRef !== receipt.payload.baselineRef) return { success: false, idempotent: false, reason: 'stale baseline' } satisfies PromotionResult;
    if (state.ledgerHead !== receipt.payload.expectedLedgerHead) return { success: false, idempotent: false, reason: 'stale ledger head' } satisfies PromotionResult;
    if (state.activeGateVersion !== receipt.payload.gateVersion) return { success: false, idempotent: false, reason: 'gate version changed' } satisfies PromotionResult;
    if (state.activePolicySchemaVersion !== receipt.payload.policySchemaVersion) return { success: false, idempotent: false, reason: 'policy schema changed' } satisfies PromotionResult;
    if (state.activeSafetyEnvelopeRef !== receipt.payload.safetyEnvelopeRef) return { success: false, idempotent: false, reason: 'safety envelope changed' } satisfies PromotionResult;
    if (
      receipt.payload.proposerSubstitution
      && !options.allowedProposerSubstitutions?.has(receipt.payload.proposerSubstitution)
    ) return { success: false, idempotent: false, reason: 'proposer substitution is evaluation-only' } satisfies PromotionResult;
    const verificationByTerm = new Map(receipt.payload.termVerification.map((term) => [term.term, term]));
    for (const [term, passed] of Object.entries(receipt.payload.gates)) {
      if (!passed) continue;
      const evidence = verificationByTerm.get(term);
      if (!evidence) return { success: false, idempotent: false, reason: `missing verification for gate: ${term}` } satisfies PromotionResult;
      if (
        evidence.verification === 'trusted-assertion'
        && (!evidence.attestor || !options.approvedAttestors?.has(evidence.attestor))
      ) return { success: false, idempotent: false, reason: `unapproved evidence attestor for gate: ${term}` } satisfies PromotionResult;
    }

    // Strict sequential evidence (default ON). Two refusals, both explicit:
    //   1. aggregate-only receipts (no pairedOutcomes) — the upstream-style
    //      "degrade to the base gate" fallback is exactly the hole this closes;
    //   2. paired evidence that cannot clear the e-process at this test's
    //      allocated share of the family-wise alpha budget.
    // Alpha is spent by LOOKING: the allocation is persisted even when the
    // verdict refuses, and a retried receipt reuses its index.
    if (options.requirePairedEvidence !== false) {
      const rawOutcomes = receipt.payload.pairedOutcomes;
      if (!rawOutcomes || rawOutcomes.length === 0) {
        return {
          success: false,
          idempotent: false,
          reason: 'receipt carries aggregate-only evidence (no task-level pairedOutcomes) — re-evaluate the candidate with a current ruflo, or pass the explicit aggregate-evidence override',
        } satisfies PromotionResult;
      }
      // Epoch-boundary enforcement (ADR-381 §2): a receipt whose OWN evidence
      // predates the current epoch's start must be refused even if it was
      // registered after the reset — registration time is not evidence time.
      // Without this check a receipt built from a stale/cached evaluation (or
      // any future path that decouples evaluation from immediate
      // registration) could be presented into the fresh, low-alpha epoch —
      // exactly the index-shopping the reset mechanism exists to prevent.
      if (state.evidenceEpochStartedAt !== undefined) {
        const issuedAtMs = Date.parse(receipt.payload.issuedAt);
        if (!Number.isNaN(issuedAtMs) && issuedAtMs < state.evidenceEpochStartedAt) {
          return {
            success: false,
            idempotent: false,
            reason: `receipt evidence (issued ${receipt.payload.issuedAt}) predates the current evidence epoch ${state.evidenceEpoch ?? 0} (started ${new Date(state.evidenceEpochStartedAt).toISOString()}) — re-evaluate the candidate to produce fresh evidence`,
          } satisfies PromotionResult;
        }
      }
      // Consistency with heldOutDeltas was already enforced by verifyFlywheelReceipt.
      const outcomes = rawOutcomes.map((o) => ({
        taskId: o.taskId,
        baselineScore: Number(o.baselineScore),
        candidateScore: Number(o.candidateScore),
      }));
      if (!state.sequentialTests) state.sequentialTests = {};
      const priorIndex = state.sequentialTests[receiptId];
      const testIndex = priorIndex ?? (Object.keys(state.sequentialTests).length + 1);
      // Size pre-flight (ADR-381 §4): refuse BEFORE allocating an alpha index
      // when the receipt cannot clear this test's threshold even on a perfect
      // all-win sweep. Sample size is ancillary — independent of the outcomes
      // — so this refusal looks at no evidence and spends no alpha.
      if (priorIndex === undefined) {
        const minPairs = minInformativePairsToClear(testIndex, {
          alphaTotal: options.sequentialAlphaTotal ?? DEFAULT_ALPHA_TOTAL,
          lambda: options.sequentialLambda ?? DEFAULT_LAMBDA,
        });
        if (outcomes.length < minPairs) {
          return {
            success: false,
            idempotent: false,
            reason: `receipt cannot clear sequential evidence at test ${testIndex}: ${outcomes.length} paired task(s) < ${minPairs} required even on a perfect sweep — no alpha spent; re-evaluate with a larger promotion holdout (ADR-381)`,
          } satisfies PromotionResult;
        }
      }
      const verdict = sequentialEvidenceVerdict(outcomes, testIndex, {
        alphaTotal: options.sequentialAlphaTotal ?? DEFAULT_ALPHA_TOTAL,
        lambda: options.sequentialLambda ?? DEFAULT_LAMBDA,
      });
      if (priorIndex === undefined) state.sequentialTests[receiptId] = testIndex;
      if (!verdict.significant) {
        if (priorIndex === undefined) atomicWriteJson(statePath(root), state); // record the alpha spend
        return {
          success: false,
          idempotent: false,
          reason: `insufficient sequential evidence: e-value ${verdict.eValue.toFixed(3)} < ${verdict.threshold.toFixed(1)} at test ${verdict.testIndex} (alpha ${verdict.alphaAllocated.toFixed(5)} of family-wise ${(options.sequentialAlphaTotal ?? DEFAULT_ALPHA_TOTAL).toFixed(2)}; ${verdict.informativePairs}/${verdict.totalPairs} informative pairs)`,
        } satisfies PromotionResult;
      }
    }
    if (options.faultAt === 'before-commit') throw new Error('fault injection: before-commit');

    const transactionId = uuidV7(now);
    const commitCore = {
      transactionId,
      receiptId,
      lineageId: receipt.payload.lineageId,
      sequence: state.commits.length + 1,
      previousLedgerHead: state.ledgerHead,
      baselineRef: receipt.payload.baselineRef,
      candidateId: receipt.payload.candidateId,
      servingEpoch: state.servingEpoch + 1,
      proposer: receipt.payload.effectiveProposer,
      ...(receipt.payload.proposerSubstitution ? { proposerSubstitution: receipt.payload.proposerSubstitution } : {}),
      promotedAt: now,
    };
    const commit: PromotionCommit = { ...commitCore, commitId: sha256Ref(canonicalizeJcs(commitCore)) };
    const nextHead = sha256Ref(canonicalizeJcs({ previous: state.ledgerHead, commitId: commit.commitId }));
    state.commits.push(commit);
    state.ledgerHead = nextHead;
    state.activeChampionRef = receipt.payload.candidateId;
    state.activePolicy = receipt.payload.candidatePolicy;
    state.servingEpoch = commit.servingEpoch;
    receiptState.status = 'consumed';
    receiptState.promotedAt = now;
    receiptState.promotionTransactionId = transactionId;
    atomicWriteJson(statePath(root), state);
    return {
      success: true,
      idempotent: false,
      reason: 'promotion committed',
      transactionId,
      receiptId,
      championRef: commit.candidateId,
      ledgerHead: nextHead,
      servingEpoch: commit.servingEpoch,
    } satisfies PromotionResult;
  });

  if (!transaction.success || transaction.idempotent) {
    if (transaction.success) {
      const recovered = await recoverFlywheelMaterialization(root, options);
      return { ...transaction, materialized: recovered.materialized, materializeReason: recovered.materializeReason };
    }
    return transaction;
  }
  if (options.faultAt === 'after-commit-before-materialize') {
    throw new Error('fault injection: after-commit-before-materialize');
  }
  const recovered = await recoverFlywheelMaterialization(root, options);
  return { ...transaction, materialized: recovered.materialized, materializeReason: recovered.materializeReason };
}

export function listFlywheelReceipts(root: string): Array<{ receipt: FlywheelEvaluationReceipt; state: ReceiptState | null }> {
  const state = readFlywheelTransactionState(root);
  try {
    return fs.readdirSync(receiptDir(root))
      .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
      .map((file) => {
        const receipt = JSON.parse(fs.readFileSync(path.join(receiptDir(root), file), 'utf8')) as FlywheelEvaluationReceipt;
        return { receipt, state: state.receiptStates[receipt.payload.receiptId] ?? null };
      })
      .sort((a, b) => a.receipt.payload.issuedAt.localeCompare(b.receipt.payload.issuedAt));
  } catch {
    return [];
  }
}

export function verifyFlywheelLedger(root: string): { valid: boolean; errors: string[]; commits: number; head: string } {
  const state = readFlywheelTransactionState(root);
  const errors: string[] = [];
  let head = GENESIS_LEDGER_HEAD;
  for (let i = 0; i < state.commits.length; i++) {
    const commit = state.commits[i];
    const { commitId, ...core } = commit;
    if (commit.sequence !== i + 1) errors.push(`sequence mismatch at ${i + 1}`);
    if (commit.previousLedgerHead !== head) errors.push(`parent mismatch at ${i + 1}`);
    if (sha256Ref(canonicalizeJcs(core)) !== commitId) errors.push(`commit hash mismatch at ${i + 1}`);
    head = sha256Ref(canonicalizeJcs({ previous: head, commitId }));
  }
  if (head !== state.ledgerHead) errors.push('ledger head mismatch');
  if (state.commits.length && state.commits[state.commits.length - 1].candidateId !== state.activeChampionRef) {
    errors.push('active champion does not match ledger head');
  }
  return { valid: errors.length === 0, errors, commits: state.commits.length, head };
}
