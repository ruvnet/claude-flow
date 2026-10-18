import { open, realpath, mkdir, mkdtemp, writeFile, readFile, rename, unlink, rmdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const maxBytes = 64 * 1024 * 1024;
async function databaseBytes(path, optional = false) {
  let file;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Persisted database must be a regular file');
    if (info.size > maxBytes) throw new Error('Starter database exceeds 64 MiB');
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('Database changed while reading');
      offset += bytesRead;
    }
    if ((await file.stat()).size !== info.size) throw new Error('Database changed while reading');
    if (bytes.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('Invalid SQLite database');
    return bytes;
  } finally { await file.close(); }
}

// Trusted local directory; all writers must use this protocol. The checkpoint
// callback is an explicit test seam, never read from CLI input/environment.
export async function withMemorySnapshot({ databasePath, write, checkpoint = async () => {} }, operation) {
  if (process.platform === 'win32') throw new Error('Atomic memory starter currently requires POSIX filesystem semantics');
  const requested = resolve(databasePath), parent = await realpath(dirname(requested));
  const path = join(parent, basename(requested)), lock = path + '.writer.lock';
  const owner = randomUUID();
  const expiresAt = Date.now() + 300000;
  let ownsLock = false, folder, committed = false, directory, failure;
  const annotate = error => {
    if (committed) {
      error.committed = true;
      error.durabilityConfirmed = false;
      error.message = 'Database replacement committed; completion failed. Inspect state before retrying: ' + error.message;
    }
    return error;
  };
  try {
    if (write) {
      await mkdir(lock, { mode: 0o700 }); // EEXIST: reject even an expired/crashed owner.
      ownsLock = true;
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ owner, pid: process.pid, createdAt: Date.now(), expiresAt }), { flag: 'wx', mode: 0o600 });
      directory = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY);
      await directory.sync(); // Fail before work if directory sync is unsupported.
    }
    const bytes = await databaseBytes(path, write);
    folder = await mkdtemp(join(write ? parent : tmpdir(), '.ruflo-memory-stage-'));
    const workingPath = join(folder, 'working.sqlite');
    if (bytes) await writeFile(workingPath, bytes, { flag: 'wx', mode: 0o600 });
    await checkpoint('snapshot-ready', { write });
    const result = await operation(workingPath);
    if (!write) return result;
    // Validate the complete backend export before replacing any authoritative data.
    await databaseBytes(workingPath);
    const staged = await open(workingPath, constants.O_RDWR | constants.O_NOFOLLOW);
    try { await staged.chmod(0o600); await staged.sync(); } finally { await staged.close(); }
    await checkpoint('before-publish', { write: true });
    const lease = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
    if (lease.owner !== owner || lease.expiresAt !== expiresAt) throw new Error('Memory writer ownership changed before publication');
    if (Date.now() >= expiresAt) throw new Error('Memory writer lease expired before publication');
    await rename(workingPath, path);
    committed = true;
    await checkpoint('after-publish', { write: true });
    await directory.sync();
    return { ...result, persistence: { committed: true, fileSynced: true, directorySynced: true } };
  } catch (error) {
    failure = error;
    throw annotate(error);
  } finally {
    try {
    await directory?.close();
    if (folder) await rm(folder, { recursive: true, force: true });
    if (ownsLock) {
      const state = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
      if (state.owner !== owner) throw new Error('Memory writer ownership changed; inspect before recovery');
      await unlink(join(lock, 'owner.json')); await rmdir(lock);
    }
    } catch (error) {
      throw annotate(failure ? new AggregateError([failure, error], 'Operation and cleanup failed; inspect owned artifacts') : error);
    }
  }
}
