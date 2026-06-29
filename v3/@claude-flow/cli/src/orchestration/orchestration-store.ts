import { existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProjectCwd } from '../mcp-tools/types.js';
import type { OrchestrationRecord, OrchestrationStatus } from './types.js';

const STORAGE_DIR = '.claude-flow';
const COORD_DIR = 'coordination';
const COORD_FILE = 'store.json';
const LOCK_FILE = '.coord.lock';
const MAX_RECORDS = 100;
const STALE_RUNNING_TTL_MS = 30 * 60 * 1000;
const LOCK_TIMEOUT_MS = 5000;
const STALE_LOCK_MS = 30000;

function getCoordDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, COORD_DIR);
}

function getCoordPath(): string {
  return join(getCoordDir(), COORD_FILE);
}

function getLockPath(): string {
  return join(getCoordDir(), LOCK_FILE);
}

function ensureDir(): void {
  const dir = getCoordDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function acquireLock(): void {
  ensureDir();
  const lockPath = getLockPath();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      writeFileSync(lockPath, String(process.pid), { mode: 0o600 });
      fd as unknown as number;
      return;
    } catch {
      if (existsSync(lockPath)) {
        const mtime = (function () {
          try { return statSync(lockPath).mtimeMs; } catch { return 0; }
        })();
        if (mtime > 0 && (Date.now() - mtime) > STALE_LOCK_MS) {
          try { unlinkSync(lockPath); } catch {}
          continue;
        }
      }
    }
  }
  throw new Error('Failed to acquire coordination store lock after 5s');
}

function releaseLock(): void {
  try {
    const lockPath = getLockPath();
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {}
}

interface CoordinationStoreShape {
  orchestrations?: OrchestrationRecord[];
}

function loadRawStore(): Record<string, unknown> {
  try {
    const path = getCoordPath();
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {}
  return {};
}

function saveRawStore(store: Record<string, unknown>): void {
  ensureDir();
  const targetPath = getCoordPath();
  const tmpPath = join(getCoordDir(), `${COORD_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 8)}`);
  try {
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), { mode: 0o600, encoding: 'utf-8' });
    renameSync(tmpPath, targetPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
}

function reconcileExpiredRunning(records: OrchestrationRecord[]): number {
  let reconciled = 0;
  const now = Date.now();
  for (const rec of records) {
    if (rec.status !== 'running') continue;
    if (!rec.startedAt) continue;
    const age = now - new Date(rec.startedAt).getTime();
    if (age > STALE_RUNNING_TTL_MS) {
      rec.status = 'failed';
      rec.completedAt = new Date().toISOString();
      rec.durationMs = now - new Date(rec.startedAt).getTime();
      reconciled++;
    }
  }
  return reconciled;
}

function enforceRetention(records: OrchestrationRecord[]): OrchestrationRecord[] {
  if (records.length > MAX_RECORDS) {
    return records.slice(-MAX_RECORDS);
  }
  return records;
}

export class OrchestrationStore {
  loadRecords(): OrchestrationRecord[] {
    const raw = loadRawStore();
    const shape = raw as CoordinationStoreShape;
    const records = Array.isArray(shape.orchestrations) ? shape.orchestrations : [];
    const reconciled = reconcileExpiredRunning(records);
    if (reconciled > 0) {
      try {
        const store = loadRawStore();
        (store as CoordinationStoreShape).orchestrations = records;
        saveRawStore(store);
      } catch {}
    }
    return records;
  }

  saveRecords(records: OrchestrationRecord[]): void {
    acquireLock();
    try {
      const store = loadRawStore();
      const trimmed = enforceRetention(records);
      (store as CoordinationStoreShape).orchestrations = trimmed;
      saveRawStore(store);
    } finally {
      releaseLock();
    }
  }

  addRecord(record: OrchestrationRecord): void {
    acquireLock();
    try {
      const records = this.loadRecords();
      records.push(record);
      const trimmed = enforceRetention(records);
      const store = loadRawStore();
      (store as CoordinationStoreShape).orchestrations = trimmed;
      saveRawStore(store);
    } finally {
      releaseLock();
    }
  }

  updateRecord(id: string, partial: Partial<OrchestrationRecord>): boolean {
    acquireLock();
    try {
      const store = loadRawStore();
      const shape = store as CoordinationStoreShape;
      const records = Array.isArray(shape.orchestrations) ? shape.orchestrations : [];
      const idx = records.findIndex(r => r.id === id);
      if (idx === -1) return false;
      records[idx] = { ...records[idx], ...partial };
      shape.orchestrations = enforceRetention(records);
      saveRawStore(store);
      return true;
    } finally {
      releaseLock();
    }
  }

  getActiveRecords(): OrchestrationRecord[] {
    return this.loadRecords().filter(r => r.status === 'running');
  }

  getCompletedRecords(): OrchestrationRecord[] {
    return this.loadRecords().filter(
      r => r.status === 'completed' || r.status === 'partial' || r.status === 'failed'
    ).filter(r => r.startedAt != null);
  }

  /** Legacy scheduled-only records (no startedAt) are excluded from metrics views. */
  getMetricsRecords(): OrchestrationRecord[] {
    return this.loadRecords().filter(r => r.startedAt != null);
  }
}

export const orchestrationStore = new OrchestrationStore();
