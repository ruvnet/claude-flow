import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { portableCaseFold } from './portable-case-fold.js';

const SHA256_PREFIX = 'sha256:';
const MAX_GIT_BUFFER = 128 * 1024 * 1024;

export interface RepositoryIdentity {
  repositoryId: string;
  canonicalRemote?: string;
  gitCommonDirId: string;
  rootTreeId: string;
}

export interface ContentDigest {
  algorithm: 'sha256';
  digest: string;
  bytes: number;
}

export interface UntrackedFileIdentity {
  path: string;
  kind: 'file' | 'symlink';
  mode: number;
  bytes: number;
  digest: string;
}

export interface UntrackedManifest {
  digest: string;
  entries: readonly UntrackedFileIdentity[];
}

export interface SubmoduleState {
  path: string;
  initialized: boolean;
  expectedCommit: string;
  commit?: string;
  trackedPatch: ContentDigest;
  untrackedManifest: UntrackedManifest;
  submodules: readonly SubmoduleState[];
}

interface SourceStateBase {
  version: 1;
  /** Git-visible state excludes ignored build inputs and installed toolchains. */
  scope: 'git-visible';
  repository: RepositoryIdentity;
  baseCommit: string;
  treeId: string;
  sourceStateId: string;
}

export interface CleanSourceState extends SourceStateBase {
  kind: 'clean';
  clean: true;
}

export interface DirtySourceState extends SourceStateBase {
  kind: 'dirty';
  clean: false;
  trackedPatch: ContentDigest;
  untrackedManifest: UntrackedManifest;
  submodules: readonly SubmoduleState[];
}

export type ExactSourceState = CleanSourceState | DirtySourceState;

interface ContentState {
  baseCommit: string;
  treeId: string;
  trackedPatch: ContentDigest;
  untrackedManifest: UntrackedManifest;
  submodules: readonly SubmoduleState[];
}

function digest(value: string | Buffer): string {
  return `${SHA256_PREFIX}${createHash('sha256').update(value).digest('hex')}`;
}

function assertUnicodeScalarString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error('canonical JSON does not support lone UTF-16 surrogates');
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('canonical JSON does not support lone UTF-16 surrogates');
    }
  }
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Recursive, locale-independent canonical JSON for JSON-safe contract values. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') {
      assertUnicodeScalarString(item);
      return JSON.stringify(item);
    }
    if (typeof item === 'number') {
      if (
        !Number.isFinite(item)
        || Object.is(item, -0)
        || (Number.isInteger(item) && !Number.isSafeInteger(item))
      ) {
        throw new Error('canonical JSON requires finite, safe, non-negative-zero numbers');
      }
      return JSON.stringify(item);
    }
    if (item === undefined) throw new Error('canonical JSON does not support undefined');
    if (typeof item !== 'object') {
      throw new Error(`canonical JSON does not support ${typeof item}`);
    }
    if (ancestors.has(item)) throw new Error('canonical JSON does not support cycles');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new Error('canonical JSON supports only arrays and plain objects');
      }
      const entries = Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => codeUnitCompare(left, right));
      return `{${entries.map(([key, child]) => {
        assertUnicodeScalarString(key);
        return `${JSON.stringify(key)}:${encode(child)}`;
      }).join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  };
  return encode(value);
}

function gitBuffer(repoRoot: string, args: readonly string[]): Buffer {
  return execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_GIT_BUFFER,
  });
}

function gitText(repoRoot: string, args: readonly string[]): string {
  return gitBuffer(repoRoot, args).toString('utf8').trim();
}

function optionalGitText(repoRoot: string, args: readonly string[]): string | undefined {
  try {
    const value = gitText(repoRoot, args);
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function splitNul(output: Buffer): Buffer[] {
  const records: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index > start) records.push(output.subarray(start, index));
    start = index + 1;
  }
  if (start !== output.length) throw new Error('Git returned a non-NUL-terminated path list');
  return records;
}

function decodeGitPath(bytes: Buffer): string {
  const path = bytes.toString('utf8');
  if (!Buffer.from(path, 'utf8').equals(bytes)) {
    throw new Error('Git path is not valid round-trip UTF-8');
  }
  assertUnicodeScalarString(path);
  if (path !== path.normalize('NFC')) {
    throw new Error(`Git path is not NFC-normalized: ${path}`);
  }
  return normalizeRelativePath(path);
}

function normalizeRelativePath(path: string): string {
  assertUnicodeScalarString(path);
  if (path.includes('\\')) throw new Error(`ambiguous repository path separator: ${path}`);
  const normalized = path.normalize('NFC');
  if (
    normalized.length === 0
    || isAbsolute(normalized)
    || normalized.startsWith('-')
    || normalized.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`unsafe repository-relative path: ${path}`);
  }
  return normalized;
}

function assertNoPathCollisions(paths: readonly string[]): void {
  const exact = new Set<string>();
  const folded = new Map<string, string>();
  for (const path of paths) {
    if (exact.has(path)) throw new Error(`duplicate repository path: ${path}`);
    exact.add(path);
    const key = portableCaseFold(path);
    const prior = folded.get(key);
    if (prior !== undefined && prior !== path) {
      throw new Error(`case-fold repository path collision: ${prior} and ${path}`);
    }
    folded.set(key, path);
  }
}

function repositoryPaths(repoRoot: string, includeUntracked: boolean): readonly string[] {
  const tracked = splitNul(gitBuffer(repoRoot, ['ls-files', '-z'])).map(decodeGitPath);
  const untracked = includeUntracked
    ? splitNul(gitBuffer(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z'])).map(decodeGitPath)
    : [];
  const paths = [...tracked, ...untracked].sort(codeUnitCompare);
  assertNoPathCollisions(paths);
  return paths;
}

function assertInsideRepository(repoRoot: string, candidate: string): void {
  const rel = relative(repoRoot, candidate);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`repository path escapes root: ${candidate}`);
  }
}

function contentDigest(content: Buffer): ContentDigest {
  return { algorithm: 'sha256', digest: digest(content), bytes: content.byteLength };
}

function untrackedManifest(repoRoot: string): UntrackedManifest {
  const output = gitBuffer(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  const paths = splitNul(output).map(decodeGitPath).sort(codeUnitCompare);
  assertNoPathCollisions(paths);
  const entries = paths.map((path): UntrackedFileIdentity => {
    const absolute = resolve(repoRoot, path);
    assertInsideRepository(repoRoot, absolute);
    const before = lstatSync(absolute);
    let kind: UntrackedFileIdentity['kind'];
    let content: Buffer;
    if (before.isSymbolicLink()) {
      kind = 'symlink';
      content = Buffer.from(readlinkSync(absolute), 'utf8');
    } else if (before.isFile()) {
      kind = 'file';
      content = readFileSync(absolute);
    } else {
      throw new Error(`unsupported untracked repository entry: ${path}`);
    }
    const after = lstatSync(absolute);
    if (
      before.mode !== after.mode
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ino !== after.ino
    ) {
      throw new Error(`repository changed while hashing untracked entry: ${path}`);
    }
    return {
      path,
      kind,
      mode: before.mode & 0o7777,
      bytes: content.byteLength,
      digest: digest(content),
    };
  });
  return { digest: digest(canonicalJson(entries)), entries };
}

function trackedPatch(repoRoot: string): ContentDigest {
  return contentDigest(gitBuffer(repoRoot, [
    'diff',
    '--binary',
    '--full-index',
    '--no-ext-diff',
    'HEAD',
    '--',
  ]));
}

function submoduleStates(repoRoot: string): readonly SubmoduleState[] {
  const staged = splitNul(gitBuffer(repoRoot, ['ls-files', '--stage', '-z']));
  const submodules = staged.flatMap((entry): Array<{ path: string; commit: string }> => {
    const tab = entry.indexOf(0x09);
    if (tab < 0) throw new Error('malformed Git index record');
    const metadata = entry.subarray(0, tab).toString('ascii');
    const match = /^160000 ([0-9a-f]+) [0-3]$/.exec(metadata);
    return match?.[1]
      ? [{ path: decodeGitPath(entry.subarray(tab + 1)), commit: match[1] }]
      : [];
  });
  assertNoPathCollisions(submodules.map(({ path }) => path));

  return submodules.map(({ path, commit }): SubmoduleState => {
    const absolute = resolve(repoRoot, path);
    assertInsideRepository(repoRoot, absolute);
    const actualCommit = optionalGitText(absolute, ['rev-parse', '--verify', 'HEAD']);
    if (!actualCommit) {
      return {
        path,
        initialized: false,
        expectedCommit: commit,
        trackedPatch: contentDigest(Buffer.alloc(0)),
        untrackedManifest: { digest: digest('[]'), entries: [] },
        submodules: [],
      };
    }
    repositoryPaths(absolute, true);
    return {
      path,
      initialized: true,
      expectedCommit: commit,
      commit: actualCommit,
      trackedPatch: trackedPatch(absolute),
      untrackedManifest: untrackedManifest(absolute),
      submodules: submoduleStates(absolute),
    };
  });
}

function captureContentState(repoRoot: string): ContentState {
  const baseCommit = gitText(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  const treeId = gitText(repoRoot, ['rev-parse', '--verify', 'HEAD^{tree}']);
  return {
    baseCommit,
    treeId,
    trackedPatch: trackedPatch(repoRoot),
    untrackedManifest: untrackedManifest(repoRoot),
    submodules: submoduleStates(repoRoot),
  };
}

function canonicalizeRemote(remote: string): string {
  const trimmed = remote.trim();
  const scp = /^([^/@:]+@)?([^/:]+):(.+)$/.exec(trimmed);
  if (scp?.[2] && scp[3] && !trimmed.includes('://')) {
    return `ssh://${scp[2].toLowerCase()}/${scp[3].replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')}`;
  }
  try {
    const url = new URL(trimmed);
    url.username = '';
    url.password = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\.git$/i, '').replace(/\/+$/g, '');
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return trimmed.replace(/\.git$/i, '').replace(/\/+$/g, '');
  }
}

function repositoryIdentity(repoRoot: string): RepositoryIdentity {
  const commonDirRaw = gitText(repoRoot, ['rev-parse', '--git-common-dir']);
  const commonDir = realpathSync(resolve(repoRoot, commonDirRaw));
  const canonicalRemoteRaw = optionalGitText(repoRoot, ['remote', 'get-url', 'origin']);
  const canonicalRemote = canonicalRemoteRaw ? canonicalizeRemote(canonicalRemoteRaw) : undefined;
  const rootCommits = gitText(repoRoot, ['rev-list', '--max-parents=0', 'HEAD']).split(/\s+/).sort();
  const rootTrees = rootCommits.map((commit) => gitText(repoRoot, ['rev-parse', `${commit}^{tree}`]));
  const rootTreeId = rootTrees.length === 1 ? rootTrees[0]! : digest(canonicalJson(rootTrees));
  const gitCommonDirId = digest(commonDir);
  const repositoryId = digest(canonicalJson({
    anchor: canonicalRemote ?? gitCommonDirId,
    rootTreeId,
  }));
  return {
    repositoryId,
    ...(canonicalRemote ? { canonicalRemote } : {}),
    gitCommonDirId,
    rootTreeId,
  };
}

function hasDirtySubmodule(submodule: SubmoduleState): boolean {
  return !submodule.initialized
    || submodule.commit !== submodule.expectedCommit
    || submodule.trackedPatch.bytes > 0
    || submodule.untrackedManifest.entries.length > 0
    || submodule.submodules.some(hasDirtySubmodule);
}

/**
 * Capture a stable, content-addressed Git source state.
 *
 * The collector performs two complete reads and refuses a moving worktree.
 * Ignored files are intentionally excluded because Git does not treat them as
 * repository source. Untracked symlinks bind their link target text without
 * following the target outside the worktree.
 */
export function captureRepositorySourceState(repoPath: string | URL): ExactSourceState {
  const requested = repoPath instanceof URL ? fileURLToPath(repoPath) : repoPath;
  const repoRoot = realpathSync(resolve(requested));
  const top = realpathSync(gitText(repoRoot, ['rev-parse', '--show-toplevel']));
  if (top !== repoRoot) throw new Error(`repoPath must be the Git top-level: ${top}`);

  const cleanStatus = (): Buffer => gitBuffer(repoRoot, [
    'status',
    '--porcelain=v1',
    '-z',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ]);
  const initialStatus = cleanStatus();
  if (initialStatus.length === 0) {
    repositoryPaths(repoRoot, false);
    const baseCommit = gitText(repoRoot, ['rev-parse', '--verify', 'HEAD']);
    const treeId = gitText(repoRoot, ['rev-parse', '--verify', 'HEAD^{tree}']);
    if (cleanStatus().length !== 0 || gitText(repoRoot, ['rev-parse', '--verify', 'HEAD']) !== baseCommit) {
      throw new Error('repository changed while capturing exact source state');
    }
    const repository = repositoryIdentity(repoRoot);
    const identity = {
      version: 1,
      scope: 'git-visible',
      repositoryId: repository.repositoryId,
      commit: baseCommit,
      tree: treeId,
    };
    return {
      version: 1,
      scope: 'git-visible',
      kind: 'clean',
      clean: true,
      repository,
      baseCommit,
      treeId,
      sourceStateId: digest(canonicalJson(identity)),
    };
  }

  repositoryPaths(repoRoot, true);
  const first = captureContentState(repoRoot);
  const second = captureContentState(repoRoot);
  if (canonicalJson(first) !== canonicalJson(second)) {
    throw new Error('repository changed while capturing exact source state');
  }

  const repository = repositoryIdentity(repoRoot);
  const dirty = second.trackedPatch.bytes > 0
    || second.untrackedManifest.entries.length > 0
    || second.submodules.some(hasDirtySubmodule);

  if (!dirty) throw new Error('Git status reported changes that exact-state capture could not identify');

  const identity = {
    version: 1,
    scope: 'git-visible',
    repositoryId: repository.repositoryId,
    baseCommit: second.baseCommit,
    tree: second.treeId,
    trackedPatch: second.trackedPatch,
    untrackedManifest: second.untrackedManifest,
    submodules: second.submodules,
  };
  return {
    version: 1,
    scope: 'git-visible',
    kind: 'dirty',
    clean: false,
    repository,
    baseCommit: second.baseCommit,
    treeId: second.treeId,
    trackedPatch: second.trackedPatch,
    untrackedManifest: second.untrackedManifest,
    submodules: second.submodules,
    sourceStateId: digest(canonicalJson(identity)),
  };
}

export function sourceStateMatches(left: ExactSourceState, right: ExactSourceState): boolean {
  return left.sourceStateId === right.sourceStateId
    && left.repository.repositoryId === right.repository.repositoryId;
}

/** Release receipts default to the stronger committed-state requirement. */
export function isReleaseEligibleSourceState(state: ExactSourceState): state is CleanSourceState {
  return state.clean;
}
