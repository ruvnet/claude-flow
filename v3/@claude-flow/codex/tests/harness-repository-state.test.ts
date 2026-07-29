import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalJson,
  buildEvidenceMatches,
  captureBuildEvidence,
  captureRepositorySourceState,
  createBuildEvidence,
  isReleaseEligibleSourceState,
  normalizeHarnessDescriptor,
  portableCaseFold,
  recomputeBuildEvidence,
  sourceStateMatches,
} from '../src/harness/index.js';

const roots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-harness-state-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet', root]);
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Harness Test');
  writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
  writeFileSync(join(root, 'tracked.txt'), 'one\n');
  git(root, 'add', '.gitignore', 'tracked.txt');
  git(root, 'commit', '--quiet', '-m', 'seed');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('exact repository source-state identity', () => {
  it('is deterministic and release-eligible for a clean commit', () => {
    const root = createRepository();
    const first = captureRepositorySourceState(root);
    const second = captureRepositorySourceState(root);

    expect(first).toEqual(second);
    expect(first.kind).toBe('clean');
    expect(first.baseCommit).toBe(git(root, 'rev-parse', 'HEAD'));
    expect(sourceStateMatches(first, second)).toBe(true);
    expect(isReleaseEligibleSourceState(first)).toBe(true);
  });

  it('changes for each tracked byte and returns to the committed identity after restore', () => {
    const root = createRepository();
    const clean = captureRepositorySourceState(root);
    writeFileSync(join(root, 'tracked.txt'), 'two\n');
    const two = captureRepositorySourceState(root);
    writeFileSync(join(root, 'tracked.txt'), 'too\n');
    const too = captureRepositorySourceState(root);

    expect(two.kind).toBe('dirty');
    expect(too.kind).toBe('dirty');
    expect(two.sourceStateId).not.toBe(clean.sourceStateId);
    expect(too.sourceStateId).not.toBe(two.sourceStateId);
    expect(isReleaseEligibleSourceState(two)).toBe(false);
    if (two.kind === 'dirty') expect(two.trackedPatch.bytes).toBeGreaterThan(0);

    writeFileSync(join(root, 'tracked.txt'), 'one\n');
    expect(captureRepositorySourceState(root)).toEqual(clean);
  });

  it('binds untracked path, mode, length, and content while excluding ignored files', () => {
    const root = createRepository();
    writeFileSync(join(root, 'draft.sh'), 'echo one\n', { mode: 0o600 });
    const first = captureRepositorySourceState(root);
    expect(first.kind).toBe('dirty');
    if (first.kind !== 'dirty') throw new Error('expected dirty state');
    expect(first.untrackedManifest.entries).toMatchObject([
      { path: 'draft.sh', kind: 'file', mode: 0o600, bytes: 9 },
    ]);

    writeFileSync(join(root, 'draft.sh'), 'echo two\n', { mode: 0o600 });
    const contentChanged = captureRepositorySourceState(root);
    expect(contentChanged.sourceStateId).not.toBe(first.sourceStateId);

    chmodSync(join(root, 'draft.sh'), 0o700);
    const modeChanged = captureRepositorySourceState(root);
    expect(modeChanged.sourceStateId).not.toBe(contentChanged.sourceStateId);

    writeFileSync(join(root, 'ignored.txt'), 'not source\n');
    expect(captureRepositorySourceState(root)).toEqual(modeChanged);
  });

  it('produces the same clean identity in another worktree of the repository', () => {
    const root = createRepository();
    const worktree = `${root}-peer`;
    roots.push(worktree);
    git(root, 'worktree', 'add', '--quiet', '--detach', worktree, 'HEAD');
    const main = captureRepositorySourceState(root);
    const peer = captureRepositorySourceState(worktree);
    expect(peer.sourceStateId).toBe(main.sourceStateId);
    expect(peer.repository.repositoryId).toBe(main.repository.repositoryId);
  });

  it('rejects invalid UTF-8, non-NFC, and case-fold path ambiguity', () => {
    const invalid = createRepository();
    const invalidPath = Buffer.concat([Buffer.from(`${invalid}/`), Buffer.from([0xff])]);
    writeFileSync(invalidPath, 'invalid\n');
    expect(() => captureRepositorySourceState(invalid)).toThrow(/round-trip UTF-8/);

    const nonNfc = createRepository();
    writeFileSync(join(nonNfc, 'e\u0301.txt'), 'decomposed\n');
    expect(() => captureRepositorySourceState(nonNfc)).toThrow(/not NFC-normalized/);

    const collision = createRepository();
    writeFileSync(join(collision, 'Case.txt'), 'upper\n');
    writeFileSync(join(collision, 'case.txt'), 'lower\n');
    expect(() => captureRepositorySourceState(collision)).toThrow(/case-fold.*collision/);

    const expandedFold = createRepository();
    writeFileSync(join(expandedFold, 'straße.txt'), 'sharp s\n');
    writeFileSync(join(expandedFold, 'strasse.txt'), 'two s\n');
    expect(() => captureRepositorySourceState(expandedFold)).toThrow(/case-fold.*collision/);
  });
});

describe('canonical evidence encoding', () => {
  it('sorts by UTF-16 code unit and rejects ambiguous JSON values', () => {
    expect(canonicalJson({ a: 1, Z: 2 })).toBe('{"Z":2,"a":1}');
    expect(() => canonicalJson(-0)).toThrow(/safe/);
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe/);
    expect(() => canonicalJson({ omitted: undefined })).toThrow(/undefined/);
    expect(() => canonicalJson('\ud800')).toThrow(/surrogate/);
  });

  it('separates declared build inputs and toolchains from Git-visible state', () => {
    const root = createRepository();
    const state = captureRepositorySourceState(root);
    const digest = `sha256:${'a'.repeat(64)}`;
    const evidence = createBuildEvidence(
      state,
      [{ name: 'generated policy', path: '.cache/policy.bin', digest, bytes: 42 }],
      [{ name: 'node', version: '22.22.2', digest }],
    );
    expect(state.scope).toBe('git-visible');
    expect(evidence.sourceStateId).toBe(state.sourceStateId);
    expect(evidence.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(createBuildEvidence(
      state,
      [{ name: 'generated policy', path: '.cache/policy.bin', digest, bytes: 42 }],
      [{ name: 'node', version: '22.22.2', digest }],
    )).toEqual(evidence);
  });

  it('recomputes ignored build input and toolchain bytes without claiming completeness', () => {
    const root = createRepository();
    const state = captureRepositorySourceState(root);
    writeFileSync(join(root, 'ignored.txt'), 'generated one\n');
    const toolchain = join(root, 'tracked.txt');
    const evidence = captureBuildEvidence(
      root,
      state,
      [{ name: 'generated', path: 'ignored.txt' }],
      [{ name: 'fixture-tool', version: '1', path: toolchain }],
    );
    expect(evidence.assurance).toBe('declared-unsigned');
    expect(buildEvidenceMatches(evidence, recomputeBuildEvidence(root, evidence, [
      { name: 'fixture-tool', version: '1', path: toolchain },
    ]))).toBe(true);

    writeFileSync(join(root, 'ignored.txt'), 'generated two\n');
    expect(buildEvidenceMatches(evidence, recomputeBuildEvidence(root, evidence, [
      { name: 'fixture-tool', version: '1', path: toolchain },
    ]))).toBe(false);
  });

  it('uses a conservative portable fold without rewriting paths', () => {
    expect(portableCaseFold('Straße/Σ')).toBe(portableCaseFold('STRASSE/ς'));
  });
});

describe('advisory local harness compatibility', () => {
  it('normalizes a legacy descriptor to observe-only without inventing capabilities', () => {
    expect(normalizeHarnessDescriptor({
      name: 'website-local',
      capabilities: ['sessions', 'leases', 'unknown-future-operation'],
    })).toEqual({
      contractVersion: 1,
      harnessId: 'website-local',
      mode: 'observe',
      capabilities: ['leases', 'sessions'],
      advisory: true,
      assurance: 'in-memory-reference',
    });
  });

  it('downgrades enforce and strips release authority from compatibility descriptors', () => {
    expect(normalizeHarnessDescriptor({
      harnessId: 'fenced-local',
      mode: 'enforce',
      capabilities: ['lease-fencing', 'exact-source-state', 'release-decisions'],
    })).toMatchObject({
      mode: 'observe',
      advisory: true,
      capabilities: ['exact-source-state', 'lease-fencing'],
      assurance: 'in-memory-reference',
    });
  });
});
