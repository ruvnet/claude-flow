import { randomUUID } from 'node:crypto';
import type { FencedLease, LeaseRequest } from './contract.js';
import { portableCaseFold } from './portable-case-fold.js';
import { parseCanonicalUnsigned } from './unsigned-integer.js';

export interface FencedLeaseRequest extends LeaseRequest {
  workloadId: string;
}

export type InMemoryFenceRefusal =
  | 'invalid-request'
  | 'scope-conflict'
  | 'stale-fence'
  | 'expired-fence'
  | 'unknown-lease';

export class InMemoryFenceReferenceError extends Error {
  constructor(readonly reason: InMemoryFenceRefusal, detail: string) {
    super(detail);
  }
}

interface StoredLease {
  lease: FencedLease;
  expiresAtMs: number;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function text(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new InMemoryFenceReferenceError('invalid-request', `${label} must be non-empty`);
  return result;
}

function normalizeScope(kind: LeaseRequest['kind'], value: string): string {
  const scope = text(value, 'lease scope');
  if (scope.startsWith('-') || scope.includes('\\') || scope !== scope.normalize('NFC')) {
    throw new InMemoryFenceReferenceError('invalid-request', `unsafe lease scope: ${value}`);
  }
  if (kind === 'resource') {
    if (scope.includes('/') || scope === '.' || scope === '..') {
      throw new InMemoryFenceReferenceError('invalid-request', `invalid named resource: ${value}`);
    }
    return scope;
  }
  if (
    scope.startsWith('/')
    || scope.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new InMemoryFenceReferenceError('invalid-request', `invalid path scope: ${value}`);
  }
  return scope;
}

function overlaps(kind: LeaseRequest['kind'], left: string, right: string): boolean {
  if (kind === 'resource') return left === right;
  const foldedLeft = portableCaseFold(left);
  const foldedRight = portableCaseFold(right);
  return foldedLeft === foldedRight
    || foldedLeft.startsWith(`${foldedRight}/`)
    || foldedRight.startsWith(`${foldedLeft}/`);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function copyLease(lease: FencedLease): FencedLease {
  return { ...lease, scopes: [...lease.scopes] };
}

/**
 * Unsigned, non-durable, single-process conformance reference.
 *
 * JavaScript executes each method without an await boundary, so compare,
 * validate, and mutate form one atomic critical section. Distributed adapters
 * must provide the same semantics with a CP store. This class cannot satisfy an
 * enforce-mode policy decision or authorize release/external side effects.
 */
export class InMemoryFencedLeaseReference {
  /** This model is local, unsigned, and never an enforce-mode policy authority. */
  readonly referenceOnly = true;
  private readonly leases = new Map<string, StoredLease>();
  private readonly repositoryEpoch = new Map<string, bigint>();

  constructor(private readonly now: () => number = Date.now) {}

  acquire(request: FencedLeaseRequest): FencedLease {
    const repositoryId = text(request.repositoryId, 'repositoryId');
    const scopes = [...new Set(request.scopes.map((scope) => normalizeScope(request.kind, scope)))]
      .sort(compare);
    if (!scopes.length || !Number.isSafeInteger(request.ttlMs) || request.ttlMs <= 0) {
      throw new InMemoryFenceReferenceError('invalid-request', 'lease requires scopes and a positive safe ttlMs');
    }
    const now = this.now();
    this.pruneExpired(now);
    for (const stored of this.leases.values()) {
      const current = stored.lease;
      if (current.repositoryId !== repositoryId || current.kind !== request.kind) continue;
      if (current.scopes.some((held) => scopes.some((wanted) => overlaps(request.kind, held, wanted)))) {
        throw new InMemoryFenceReferenceError(
          'scope-conflict',
          `scope conflicts with active lease ${current.leaseId}`,
        );
      }
    }

    const epoch = (this.repositoryEpoch.get(repositoryId) ?? 0n) + 1n;
    this.repositoryEpoch.set(repositoryId, epoch);
    const expiresAtMs = now + request.ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new InMemoryFenceReferenceError('invalid-request', 'lease expiry exceeds safe timestamp range');
    }
    const lease: FencedLease = {
      leaseId: `lease-${randomUUID()}`,
      repositoryId,
      sessionId: text(request.sessionId, 'sessionId'),
      workloadId: text(request.workloadId, 'workloadId'),
      worktreeId: text(request.worktreeId, 'worktreeId'),
      kind: request.kind,
      scopes,
      epoch: epoch.toString(),
      version: '1',
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      advisory: true,
    };
    this.leases.set(lease.leaseId, { lease, expiresAtMs });
    return copyLease(lease);
  }

  renew(presented: FencedLease, ttlMs: number): FencedLease {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new InMemoryFenceReferenceError('invalid-request', 'renewal requires a positive safe ttlMs');
    }
    const stored = this.assertStoredFence(presented);
    const now = this.now();
    if (stored.expiresAtMs <= now) {
      this.leases.delete(presented.leaseId);
      throw new InMemoryFenceReferenceError('expired-fence', `lease ${presented.leaseId} expired`);
    }
    const expiresAtMs = now + ttlMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new InMemoryFenceReferenceError('invalid-request', 'lease expiry exceeds safe timestamp range');
    }
    const lease: FencedLease = {
      ...stored.lease,
      version: (parseCanonicalUnsigned(stored.lease.version, 'lease version') + 1n).toString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      scopes: [...stored.lease.scopes],
    };
    this.leases.set(lease.leaseId, { lease, expiresAtMs });
    return copyLease(lease);
  }

  release(presented: FencedLease): void {
    this.assertCurrentFence(presented);
    this.leases.delete(presented.leaseId);
  }

  assertCurrentFence(presented: FencedLease): void {
    const stored = this.assertStoredFence(presented);
    if (stored.expiresAtMs <= this.now()) {
      this.leases.delete(presented.leaseId);
      throw new InMemoryFenceReferenceError('expired-fence', `lease ${presented.leaseId} expired`);
    }
  }

  current(repositoryId?: string): FencedLease[] {
    this.pruneExpired(this.now());
    return [...this.leases.values()]
      .map(({ lease }) => lease)
      .filter((lease) => repositoryId === undefined || lease.repositoryId === repositoryId)
      .sort((left, right) => compare(left.leaseId, right.leaseId))
      .map(copyLease);
  }

  private assertStoredFence(presented: FencedLease): StoredLease {
    const stored = this.leases.get(presented.leaseId);
    if (!stored) throw new InMemoryFenceReferenceError('unknown-lease', `unknown lease ${presented.leaseId}`);
    const current = stored.lease;
    if (
      current.repositoryId !== presented.repositoryId
      || current.sessionId !== presented.sessionId
      || current.workloadId !== presented.workloadId
      || current.worktreeId !== presented.worktreeId
      || current.kind !== presented.kind
      || !sameStrings(current.scopes, presented.scopes)
      || current.epoch !== presented.epoch
      || current.version !== presented.version
    ) {
      throw new InMemoryFenceReferenceError('stale-fence', `stale or altered fence ${presented.leaseId}`);
    }
    return stored;
  }

  private pruneExpired(now: number): void {
    for (const [leaseId, stored] of this.leases) {
      if (stored.expiresAtMs <= now) this.leases.delete(leaseId);
    }
  }
}
