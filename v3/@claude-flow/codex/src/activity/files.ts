import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { object, type SessionIdentity } from './types.js';
import { sanitize } from './sanitize.js';

export const MAX_LINE = 64 * 1024;
const MAX_ENTRIES = 4000;

/** Only regular files whose resolved path stays inside the selected directory. */
export async function openSession(root: string, file: string): Promise<FileHandle> {
  const absolute = path.resolve(file);
  const relative = path.relative(root, absolute);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative) || await realpath(absolute) !== absolute) {
    throw new Error('Session file is outside the selected directory or uses a symlink.');
  }
  const before = await lstat(absolute);
  if (!before.isFile()) throw new Error('Session is not a regular file.');
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || after.ino !== before.ino || after.dev !== before.dev
      || await realpath(absolute) !== absolute) throw new Error('Session changed while opening.');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readIdentity(root: string, file: string): Promise<SessionIdentity | null> {
  const handle = await openSession(root, file);
  try {
    const buffer = Buffer.alloc(MAX_LINE);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    // A valid JSON prefix is not enough: require the complete metadata line.
    if (newline < 0) return null;
    const record = object(JSON.parse(buffer.subarray(0, newline).toString('utf8')));
    const meta = object(record.payload);
    if (record.type !== 'session_meta' || typeof meta.id !== 'string' || !meta.id
      || meta.id.length > 300) return null;
    const spawn = object(object(object(meta.source).subagent).thread_spawn);
    const parent = typeof spawn.parent_thread_id === 'string' ? spawn.parent_thread_id : null;
    const rootSession = meta.source === 'cli' && !meta.forked_from_id
      && !meta.parent_thread_id && (!meta.thread_source || meta.thread_source === 'user');
    if (!parent && !rootSession) return null; // Excludes guardians and unknown sources.
    return {
      id: meta.id, parent, file,
      name: sanitize(meta.agent_nickname ?? spawn.agent_nickname ?? '', 120),
      path: sanitize(meta.agent_path ?? spawn.agent_path ?? meta.id, 200),
    };
  } finally {
    await handle.close();
  }
}

export interface SessionList {
  root: SessionIdentity | null;
  helpers: SessionIdentity[];
  partial: boolean;
  error: string;
}

export async function listSessions(root: string, rootFile: string, expectedId?: string): Promise<SessionList> {
  const empty: SessionList = { root: null, helpers: [], partial: false, error: '' };
  let selected: SessionIdentity | null;
  try { selected = await readIdentity(root, rootFile); }
  catch { return { ...empty, error: 'The selected session file is unavailable.' }; }
  if (!selected || selected.parent || (expectedId && selected.id !== expectedId)) {
    return { ...empty, error: 'Select a root CLI session with an unchanged identity.' };
  }
  const sessions = new Map<string, SessionIdentity>([[selected.id, selected]]);
  const duplicates = new Set<string>();
  const queue = [{ directory: root, depth: 0 }];
  let entries = 0;
  let partial = false;
  while (queue.length && entries < MAX_ENTRIES) {
    const current = queue.shift()!;
    try {
      // Revalidate directories too; never recurse through a symlink.
      if (await realpath(current.directory) !== current.directory) { partial = true; continue; }
      const directory = await opendir(current.directory);
      for await (const entry of directory) {
        if (++entries > MAX_ENTRIES) { partial = true; break; }
        const file = path.join(current.directory, entry.name);
        if (entry.isDirectory()) {
          if (current.depth < 8) queue.push({ directory: file, depth: current.depth + 1 });
          else partial = true;
        } else if (entry.isFile() && entry.name.endsWith('.jsonl') && file !== rootFile) {
          try {
            const identity = await readIdentity(root, file);
            if (!identity) continue;
            if (sessions.has(identity.id)) duplicates.add(identity.id);
            else sessions.set(identity.id, identity);
          } catch { partial = true; }
        }
      }
    } catch { partial = true; }
  }
  partial ||= queue.length > 0;
  if (duplicates.has(selected.id)) return { ...empty, partial: true, error: 'Root session identity is ambiguous.' };
  const belongs = (identity: SessionIdentity): boolean => {
    const seen = new Set<string>();
    let node: SessionIdentity | undefined = identity;
    while (node?.parent && seen.size < 64) {
      if (seen.has(node.id) || duplicates.has(node.id)) return false;
      seen.add(node.id);
      if (node.parent === selected.id) return true;
      node = sessions.get(node.parent);
    }
    return false;
  };
  return {
    root: selected,
    helpers: [...sessions.values()].filter(belongs).sort((a, b) => a.path.localeCompare(b.path)),
    partial: partial || duplicates.size > 0, error: '',
  };
}
