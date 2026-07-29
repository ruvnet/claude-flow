import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  captureRepositorySourceState,
  harnessMessageContentDigest,
  inMemoryInboxIdentityKey,
  InMemoryInboxReference,
  InMemoryFencedLeaseReference,
  InMemoryRunReceiptReference,
  InMemoryFenceReferenceError,
  parseCanonicalUnsigned,
  type FencedLeaseRequest,
  type HarnessMessage,
  type RunEvidence,
} from '../src/harness/index.js';

const roots: string[] = [];
const D = (value: string): string => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-harness-authority-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Harness Test']);
  writeFileSync(join(root, 'source.ts'), 'export {};\n');
  execFileSync('git', ['-C', root, 'add', 'source.ts']);
  execFileSync('git', ['-C', root, 'commit', '--quiet', '-m', 'seed']);
  return root;
}

function leaseRequest(overrides: Partial<FencedLeaseRequest> = {}): FencedLeaseRequest {
  return {
    sessionId: 'session-a',
    workloadId: 'workload-a',
    repositoryId: 'repo-a',
    worktreeId: 'worktree-a',
    kind: 'path',
    scopes: ['src'],
    ttlMs: 1_000,
    ...overrides,
  };
}

function message(overrides: Partial<HarnessMessage> = {}): HarnessMessage {
  const content = overrides.content ?? { handoff: 'ready' };
  return {
    messageId: 'message-1',
    issuer: 'agent-a',
    audience: 'agent-b',
    sequence: '1',
    contentDigest: harnessMessageContentDigest(content),
    content,
    ...overrides,
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('in-memory CP fenced lease authority', () => {
  it('selects one owner for conflicting acquisitions and isolates repositories', () => {
    const authority = new InMemoryFencedLeaseReference(() => 1_000);
    const results = Array.from({ length: 100 }, (_, index) => {
      try {
        return authority.acquire(leaseRequest({
          sessionId: `session-${index}`,
          workloadId: `workload-${index}`,
          worktreeId: `worktree-${index}`,
          scopes: ['src/harness'],
        }));
      } catch (error) {
        expect(error).toBeInstanceOf(InMemoryFenceReferenceError);
        return null;
      }
    });
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(authority.acquire(leaseRequest({
      repositoryId: 'repo-b',
      scopes: ['src/harness'],
    })).repositoryId).toBe('repo-b');
  });

  it('uses CAS versions and rejects a stale fence after renew/release/reacquire', () => {
    let now = 1_000;
    const authority = new InMemoryFencedLeaseReference(() => now);
    const first = authority.acquire(leaseRequest());
    const renewed = authority.renew(first, 2_000);
    expect(BigInt(renewed.version)).toBe(BigInt(first.version) + 1n);
    expect(() => authority.renew(first, 2_000)).toThrow(/stale/);
    authority.assertCurrentFence(renewed);
    authority.release(renewed);
    expect(() => authority.assertCurrentFence(renewed)).toThrow(/unknown/);

    const second = authority.acquire(leaseRequest());
    expect(BigInt(second.epoch)).toBeGreaterThan(BigInt(first.epoch));
    now = 4_001;
    expect(() => authority.assertCurrentFence(second)).toThrow(/expired/);
  });

  it('treats portable case-fold aliases as conflicting paths', () => {
    const authority = new InMemoryFencedLeaseReference(() => 1_000);
    authority.acquire(leaseRequest({ scopes: ['src/Straße'] }));
    expect(() => authority.acquire(leaseRequest({
      sessionId: 'session-b',
      workloadId: 'workload-b',
      worktreeId: 'worktree-b',
      scopes: ['src/STRASSE/file.ts'],
    }))).toThrow(/conflicts/);
  });
});

describe('unsigned in-memory inbox reference semantics', () => {
  it('deduplicates exact replay, resumes by cursor, and retains until acknowledgement', async () => {
    const inbox = new InMemoryInboxReference(() => 1_000);
    expect(inbox.send(message()).duplicate).toBe(false);
    expect(inbox.send(message()).duplicate).toBe(true);
    expect(await collect(inbox.receive('agent-b'))).toHaveLength(1);
    expect(await collect(inbox.receive('agent-b', '1'))).toHaveLength(0);
    expect(inbox.pending('agent-b')).toHaveLength(1);
    inbox.acknowledge('agent-b', 'message-1');
    expect(inbox.pending('agent-b')).toHaveLength(0);
  });

  it('quarantines digest mismatch and message-ID content conflict', () => {
    const inbox = new InMemoryInboxReference(() => 1_000);
    inbox.send(message());
    expect(() => inbox.send(message({
      content: { handoff: 'changed' },
      contentDigest: harnessMessageContentDigest({ handoff: 'changed' }),
    }))).toThrow(/reused/);
    expect(() => inbox.send(message({
      messageId: 'message-2',
      contentDigest: D('wrong'),
    }))).toThrow(/does not match/);
    expect(inbox.quarantineRecords().map(({ reason }) => reason)).toEqual([
      'message-id-content-conflict',
      'content-digest-mismatch',
    ]);
  });

  it('rejects non-canonical unsigned sequences and length-frames identity keys', () => {
    const inbox = new InMemoryInboxReference(() => 1_000);
    for (const sequence of ['01', '+1', ' 1', '0x1', '-1']) {
      expect(() => inbox.send(message({ sequence }))).toThrow(/canonical unsigned/);
    }
    expect(parseCanonicalUnsigned('0', 'sequence')).toBe(0n);
    expect(parseCanonicalUnsigned('42', 'sequence')).toBe(42n);
    expect(() => parseCanonicalUnsigned('00', 'sequence')).toThrow(/canonical unsigned/);
    expect(() => parseCanonicalUnsigned('18446744073709551616', 'sequence')).toThrow(/64-bit/);
    expect(inMemoryInboxIdentityKey('a', 'bc')).not.toBe(inMemoryInboxIdentityKey('ab', 'c'));
    expect(inMemoryInboxIdentityKey('a\0b', 'c')).not.toBe(inMemoryInboxIdentityKey('a', 'b\0c'));
  });
});

describe('content-addressed append-only run receipt ledger', () => {
  it('converges exact retry and refuses execution-ID history rewrite', () => {
    const sourceState = captureRepositorySourceState(repository());
    const run: RunEvidence = {
      executionId: 'execution-1',
      sessionId: 'session-a',
      workloadId: 'workload-a',
      sourceState,
      commandDigest: D('command'),
      scope: 'harness',
      profile: 'focused',
      startedAt: '2026-07-29T00:00:00.000Z',
      completedAt: '2026-07-29T00:00:01.000Z',
      exitCode: 0,
      evidenceDigest: D('evidence'),
    };
    const ledger = new InMemoryRunReceiptReference(() => 2_000);
    expect(ledger.referenceOnly).toBe(true);
    const first = ledger.recordRun(run);
    expect(ledger.recordRun(run)).toEqual(first);
    expect(ledger.all()).toHaveLength(1);
    expect(first.receiptId).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(() => ledger.recordRun({ ...run, exitCode: 1 })).toThrow(/different evidence/);

    const returned = ledger.get(first.receiptId);
    if (!returned) throw new Error('receipt missing');
    returned.scope = 'mutated-copy';
    expect(ledger.get(first.receiptId)?.scope).toBe('harness');
  });
});
