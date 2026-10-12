/**
 * ADR-406 M0 — durable mission storage.
 *
 * Store decision (audit in the PR): ruflo's authoritative state already lives
 * in project files guarded by a lock and replaced atomically (the policy
 * ledger in `.claude-flow/policy/`, claims, workspace leases). `better-sqlite3`
 * is an optional dependency the CLI must run without, and `sql.js` keeps the
 * database in memory and persists by whole-file export, which is neither
 * append-durable nor safe across processes. So a mission is:
 *
 *   .claude-flow/missions/<missionId>/events.jsonl   append-only, hash-chained
 *   .claude-flow/missions/<missionId>/snapshot.json  materialized cache (rebuildable)
 *   .claude-flow/missions/<missionId>/lock           per-mission writer lock
 *
 * The log is the truth; the snapshot is only a cache that must agree with it.
 * Each event is one write of one line followed by fsync. A crash can leave at
 * most an unterminated last line, which readers ignore and the next locked
 * writer truncates. Writers take the policy runtime's lock (`acquireLock`),
 * which recognises a dead owner by pid, pid namespace and boot id.
 */

import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, statSync, truncateSync, writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { acquireLock } from '../services/policy-runtime.js';
import { MISSION_ID, type MissionEvent } from './schemas.js';
import { replay } from './fold.js';
import type { MissionView } from './transitions.js';

export const MISSIONS_DIR = join('.claude-flow', 'missions');

export interface LogRead {
  readonly events: MissionEvent[];
  /** Bytes covered by complete lines; anything after is a torn tail. */
  readonly validBytes: number;
  readonly tornTail: boolean;
}

export class MissionStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MissionStoreError';
  }
}

function fsyncPath(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    fsyncSync(fd);
  } catch {
    /* directory fsync is unsupported on some platforms; the file itself was synced */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** tmp + fsync + rename + directory fsync. */
export function writeFileAtomic(path: string, text: string, mode = 0o600): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const fd = openSync(tmp, 'w', mode);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  fsyncPath(join(path, '..'));
}

export function parseLog(buffer: Buffer): LogRead {
  const events: MissionEvent[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const nl = buffer.indexOf(0x0a, offset);
    if (nl === -1) return { events, validBytes: offset, tornTail: true };
    const line = buffer.subarray(offset, nl).toString('utf8');
    try {
      events.push(JSON.parse(line) as MissionEvent);
    } catch {
      // A terminated line is a completed write; unparsable means tampering or corruption.
      throw new MissionStoreError('mission-log-corrupt', `unparsable line at byte ${offset}`);
    }
    offset = nl + 1;
  }
  return { events, validBytes: offset, tornTail: false };
}

export class MissionStore {
  readonly root: string;

  constructor(projectRoot: string) {
    this.root = join(resolve(projectRoot), MISSIONS_DIR);
  }

  missionDir(missionId: string): string {
    if (!MISSION_ID.test(missionId)) throw new MissionStoreError('invalid-mission-id', missionId);
    return join(this.root, missionId);
  }

  private logPath(id: string): string { return join(this.missionDir(id), 'events.jsonl'); }
  private snapshotPath(id: string): string { return join(this.missionDir(id), 'snapshot.json'); }

  exists(missionId: string): boolean {
    return existsSync(this.logPath(missionId));
  }

  listMissionIds(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter((n) => MISSION_ID.test(n) && existsSync(join(this.root, n, 'events.jsonl'))).sort();
  }

  /** Atomic claim of a new mission id: `mkdir` fails if another request won. */
  claim(missionId: string): boolean {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    try {
      mkdirSync(this.missionDir(missionId), { mode: 0o700 });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }

  readLog(missionId: string): LogRead {
    const path = this.logPath(missionId);
    if (!existsSync(path)) return { events: [], validBytes: 0, tornTail: false };
    return parseLog(readFileSync(path));
  }

  /** Snapshot when it agrees with the log, then fold the tail; otherwise full replay. */
  loadView(missionId: string, log: LogRead = this.readLog(missionId)): MissionView | null {
    const snapshotFile = this.snapshotPath(missionId);
    if (existsSync(snapshotFile)) {
      try {
        const snap = JSON.parse(readFileSync(snapshotFile, 'utf8')) as { sequence: number; hash: string; view: MissionView };
        const anchor = log.events[snap.sequence - 1];
        if (anchor && anchor.hash === snap.hash && snap.view.lastHash === snap.hash) {
          return replay(log.events.slice(snap.sequence), snap.view);
        }
      } catch {
        /* unreadable cache: rebuild from the log */
      }
    }
    return replay(log.events);
  }

  /**
   * Run `fn` under the mission's writer lock with a freshly replayed view.
   * Events `fn` returns are appended (each fsynced) only after `fn` validated
   * them, then the snapshot is refreshed.
   */
  async withMission<T>(
    missionId: string,
    fn: (view: MissionView | null, log: LogRead) => { events: MissionEvent[]; result: T; view: MissionView | null },
  ): Promise<T> {
    const dir = this.missionDir(missionId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const release = await acquireLock(join(dir, 'lock'));
    try {
      const log = this.readLog(missionId);
      if (log.tornTail) truncateSync(this.logPath(missionId), log.validBytes);
      const view = this.loadView(missionId, log);
      const outcome = fn(view, log);
      if (outcome.events.length) {
        this.append(missionId, outcome.events);
        if (outcome.view) this.writeSnapshot(missionId, outcome.view);
      }
      return outcome.result;
    } finally {
      release();
    }
  }

  private append(missionId: string, events: readonly MissionEvent[]): void {
    const fd = openSync(this.logPath(missionId), 'a', 0o600);
    try {
      for (const event of events) {
        const line = Buffer.from(`${JSON.stringify(event)}\n`, 'utf8');
        let written = 0;
        while (written < line.length) written += writeSync(fd, line, written, line.length - written);
        fsyncSync(fd);
      }
    } finally {
      closeSync(fd);
    }
  }

  writeSnapshot(missionId: string, view: MissionView): void {
    writeFileAtomic(this.snapshotPath(missionId), JSON.stringify({
      schemaVersion: 1,
      missionId,
      sequence: view.record.lastEventSequence,
      hash: view.lastHash,
      view,
    }));
  }

  /** For diagnostics and tests: the log file's size in bytes. */
  logSize(missionId: string): number {
    const path = this.logPath(missionId);
    return existsSync(path) ? statSync(path).size : 0;
  }

  /** Workspace-level lock for the observation file. */
  async withWorkspaceLock<T>(fn: () => T): Promise<T> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const release = await acquireLock(join(this.root, 'observation.lock'));
    try { return fn(); } finally { release(); }
  }

  writeWorkspaceFile(name: string, text: string): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileAtomic(join(this.root, name), text, 0o644);
  }
}

