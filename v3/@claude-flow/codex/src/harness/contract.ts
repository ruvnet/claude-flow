/**
 * Advisory repository-harness contract.
 *
 * Repository harnesses coordinate local ownership and collect evidence. They do
 * not grant Ruflo policy capabilities. Existing harnesses can implement only
 * `describe`; omitted operations remain unavailable and the descriptor
 * normalizes to observe-only compatibility mode.
 */

import type { ExactSourceState } from './repository-state.js';
import type { BuildEvidence } from './build-evidence.js';

export type HarnessMode = 'observe' | 'enforce';
export type HarnessCapability =
  | 'sessions'
  | 'leases'
  | 'lease-fencing'
  | 'messages'
  | 'message-acknowledgement'
  | 'run-evidence'
  | 'exact-source-state'
  | 'release-decisions';

interface HarnessDescriptorBase {
  contractVersion: 1;
  harnessId: string;
}

export interface InMemoryReferenceHarnessDescriptor extends HarnessDescriptorBase {
  mode: 'observe';
  capabilities: readonly Exclude<HarnessCapability, 'release-decisions'>[];
  advisory: true;
  assurance: 'in-memory-reference';
}

export interface ExternalAuthorityHarnessDescriptor extends HarnessDescriptorBase {
  mode: HarnessMode;
  capabilities: readonly HarnessCapability[];
  advisory: false;
  assurance: 'external-authority';
}

export type HarnessDescriptor =
  | InMemoryReferenceHarnessDescriptor
  | ExternalAuthorityHarnessDescriptor;

/** Shape accepted from pre-contract local harnesses. */
export interface LegacyHarnessDescriptor {
  harnessId?: string;
  name?: string;
  mode?: HarnessMode;
  capabilities?: readonly string[];
}

export interface StartSessionRequest {
  sessionId: string;
  workloadId: string;
  repositoryId: string;
  worktreeId: string;
  readOnly: boolean;
}

export interface HarnessSession {
  sessionId: string;
  workloadId: string;
  repositoryId: string;
  worktreeId: string;
  startedAt: string;
}

export interface LeaseRequest {
  sessionId: string;
  repositoryId: string;
  worktreeId: string;
  kind: 'path' | 'resource';
  scopes: readonly string[];
  ttlMs: number;
}

export interface FencedLease {
  leaseId: string;
  repositoryId: string;
  sessionId: string;
  workloadId: string;
  worktreeId: string;
  kind: 'path' | 'resource';
  scopes: readonly string[];
  /** Decimal strings avoid losing 64-bit epochs when receipts cross JSON. */
  epoch: string;
  version: string;
  issuedAt: string;
  expiresAt: string;
  advisory: boolean;
}

export interface HarnessMessage {
  messageId: string;
  issuer: string;
  audience: string;
  correlationId?: string;
  causationId?: string;
  sequence: string;
  expiresAt?: string;
  contentDigest: string;
  content: unknown;
}

export interface MessageReceipt {
  messageId: string;
  acceptedAt: string;
  duplicate: boolean;
}

export interface RunEvidence {
  executionId: string;
  sessionId: string;
  workloadId: string;
  sourceState: ExactSourceState;
  /** Optional for legacy/debug runs; release policy may require it. */
  buildEvidence?: BuildEvidence;
  commandDigest: string;
  scope: string;
  profile: 'focused' | 'integration' | 'release';
  startedAt: string;
  completedAt: string;
  exitCode: number;
  evidenceDigest: string;
  policyReceiptId?: string;
  leaseEpochs?: Readonly<Record<string, string>>;
}

export interface RunReceipt extends RunEvidence {
  receiptId: string;
  recordedAt: string;
}

export interface ReleaseRequest {
  repositoryId: string;
  sourceStateId: string;
  artifactDigest: string;
  runReceiptIds: readonly string[];
  /** Optional for compatibility; enforce-mode release policy may require it. */
  buildEvidence?: BuildEvidence;
  capabilityId?: string;
}

export interface ReleaseDecision {
  allowed: boolean;
  dryRun: boolean;
  reason: string;
  policyReceiptId?: string;
}

/**
 * Progressive adapter surface. Optional methods preserve compatibility with
 * local harnesses that predate sessions, fencing, durable messages, or exact
 * source-state receipts. Callers must feature-detect every optional operation.
 */
export interface RepositoryHarnessAdapter {
  describe(): Promise<HarnessDescriptor | LegacyHarnessDescriptor>;
  start?(request: StartSessionRequest): Promise<HarnessSession>;
  acquire?(request: LeaseRequest): Promise<FencedLease>;
  renew?(lease: FencedLease): Promise<FencedLease>;
  release?(lease: FencedLease): Promise<void>;
  send?(message: HarnessMessage): Promise<MessageReceipt>;
  receive?(cursor?: string): AsyncIterable<HarnessMessage>;
  acknowledge?(messageId: string): Promise<void>;
  recordRun?(run: RunEvidence): Promise<RunReceipt>;
  authorizeRelease?(request: ReleaseRequest): Promise<ReleaseDecision>;
  end?(sessionId: string): Promise<void>;
}

const CAPABILITIES = new Set<HarnessCapability>([
  'sessions',
  'leases',
  'lease-fencing',
  'messages',
  'message-acknowledgement',
  'run-evidence',
  'exact-source-state',
  'release-decisions',
]);

/**
 * Convert an older descriptor to the safe v1 reference baseline.
 *
 * Unknown and authority-bearing capabilities are ignored. A legacy descriptor
 * can never self-assert enforce or release authority through this compatibility
 * function. A separately verified external adapter is required for that.
 */
export function normalizeHarnessDescriptor(
  input: HarnessDescriptor | LegacyHarnessDescriptor,
): InMemoryReferenceHarnessDescriptor {
  const harnessId = input.harnessId ?? ('name' in input ? input.name : undefined);
  if (typeof harnessId !== 'string' || harnessId.trim().length === 0) {
    throw new Error('repository harness descriptor requires a non-empty harnessId');
  }

  const requested = Array.isArray(input.capabilities) ? input.capabilities : [];
  const capabilities: Array<Exclude<HarnessCapability, 'release-decisions'>> = [...new Set(
    requested.filter((value): value is HarnessCapability => (
      CAPABILITIES.has(value as HarnessCapability)
      && value !== 'release-decisions'
    )),
  )] as Array<Exclude<HarnessCapability, 'release-decisions'>>;
  capabilities.sort();

  return {
    contractVersion: 1,
    harnessId: harnessId.trim(),
    mode: 'observe',
    capabilities,
    advisory: true,
    assurance: 'in-memory-reference',
  };
}
