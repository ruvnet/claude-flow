/** Explicit export only: bind the compiled snapshots to immutable Git blobs. */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { devNull } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { safeGitArgv } from '@claude-flow/security/safe-git';

const run = promisify(execFile);
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
export const MAX_GUIDANCE_SOURCE_BYTES = 1024 * 1024;

export interface ModSourceBinding {
  path: string;
  blobId: string;
  sha256: string;
  byteLength: number;
}

/** Local reads only; no shell, Git hooks, filters, replacement refs or lazy fetch. */
async function git(repo: string, args: string[]): Promise<Buffer> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull, GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
  const { stdout } = await run('git', safeGitArgv(repo, ['--no-replace-objects', '--literal-pathspecs', '-c', `core.hooksPath=${devNull}`, '-c', 'protocol.allow=never', ...args]), {
    encoding: 'buffer', env, maxBuffer: 2 * MAX_GUIDANCE_SOURCE_BYTES, timeout: 10_000, windowsHide: true,
  });
  return stdout;
}

/** Older Git ignores GIT_NO_LAZY_FETCH. Refuse all promisor configuration
 * before reading objects, including repositories whose objects happen to exist.
 * Shallow clones with ordinary local objects remain supported. */
async function requireLocalObjects(repo: string): Promise<void> {
  try {
    await git(repo, ['config', '--get-regexp', '^(extensions\\.partialclone|remote\\..*\\.(promisor|partialclonefilter))$']);
  } catch (error) {
    const result = error as { code?: number; signal?: string; stdout?: Buffer; stderr?: Buffer };
    // git config returns 1 only for no matching entries. Other errors fail closed.
    if (result.code === 1 && !result.signal && result.stdout?.length === 0 && result.stderr?.length === 0) return;
    throw error;
  }
  throw new Error('Offline mod export does not support partial clones or promisor repositories; use a checkout with local objects');
}

async function sourcePath(path: string): Promise<string> {
  const absolute = resolve(path);
  if (/[\u0000-\u001f\u007f]/.test(absolute)) throw new Error('Unsupported guidance source path');
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(absolute) !== absolute) throw new Error('Guidance source must be a regular file without symlink components');
  return absolute;
}

/** Descriptor based bounded read; never reread mutable bytes after verification. */
async function sourceBytes(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_GUIDANCE_SOURCE_BYTES) throw new Error('Guidance source exceeds 1 MiB or is not a regular file');
    const bytes = Buffer.alloc(MAX_GUIDANCE_SOURCE_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_GUIDANCE_SOURCE_BYTES) throw new Error('Guidance source exceeds 1 MiB');
    return bytes.subarray(0, size);
  } finally { await file.close(); }
}

/** A commit label alone is insufficient. Both supplied files must match its blobs. */
export async function readModGuidanceSources(input: { rootPath: string; localPath?: string; revision: string }) {
  if (!OID.test(input.revision)) throw new Error('--revision must be a full immutable source commit SHA');
  const rootPath = await sourcePath(input.rootPath);
  let repo: string;
  try {
    repo = (await git(dirname(rootPath), ['rev-parse', '--show-toplevel'])).toString('utf8').replace(/\r?\n$/, '');
    repo = await realpath(repo);
  } catch { throw new Error('Guidance source requires a local Git repository'); }
  await requireLocalObjects(repo);
  try {
    if ((await git(repo, ['cat-file', '-t', input.revision])).toString('utf8').trim() !== 'commit') throw new Error('not a commit');
    if ((await git(repo, ['rev-parse', '--verify', `${input.revision}^{commit}`])).toString('utf8').trim() !== input.revision) throw new Error('abbreviated commit');
  } catch { throw new Error('Guidance source requires an existing full immutable commit'); }

  const read = async (path: string): Promise<{ content: string; binding: ModSourceBinding }> => {
    const absolute = await sourcePath(path);
    const rel = relative(repo, absolute);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Guidance sources must belong to the same Git repository');
    const sourceRepo = (await git(dirname(absolute), ['rev-parse', '--show-toplevel'])).toString('utf8').replace(/\r?\n$/, '');
    if (await realpath(sourceRepo) !== repo) throw new Error('Guidance sources must belong to the same Git repository');
    await requireLocalObjects(repo);
    const gitPath = rel.split(sep).join('/');
    const tree = (await git(repo, ['ls-tree', '-z', '--full-tree', input.revision, '--', gitPath])).toString('utf8');
    const match = /^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([^\0]+)\0$/.exec(tree);
    if (!match || match[3] !== gitPath) throw new Error('Guidance source must be a regular tracked blob in the supplied commit');
    const blobId = match[2];
    const blobSize = Number((await git(repo, ['cat-file', '-s', blobId])).toString('utf8').trim());
    if (!Number.isSafeInteger(blobSize) || blobSize < 0 || blobSize > MAX_GUIDANCE_SOURCE_BYTES) throw new Error('Committed guidance source exceeds 1 MiB');
    const committed = await git(repo, ['cat-file', 'blob', blobId]);
    const bytes = await sourceBytes(absolute);
    if (!bytes.equals(committed)) throw new Error('Guidance source bytes differ from the supplied commit; commit the reviewed source before exporting');
    // Preserve a BOM in the compiler snapshot; reject invalid UTF-8 rather than replacing bytes.
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return { content, binding: { path: gitPath, blobId, sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length } };
  };
  const root = await read(rootPath);
  const local = input.localPath === undefined ? undefined : await read(input.localPath);
  return { sourceRevision: input.revision, rootContent: root.content, localContent: local?.content, sources: { root: root.binding, ...(local ? { local: local.binding } : {}) } };
}
