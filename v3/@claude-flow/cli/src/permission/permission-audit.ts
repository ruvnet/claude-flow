/**
 * Append-only permission audit log for swarm subagents (dream-cycle #2768).
 *
 * Every grant / check / deny / revoke event is written to
 * `.swarm/permission-audit.jsonl` — one JSON object per line, no rewrites,
 * no deletes. Persistence follows the same discipline as ruflo's other
 * append-only ledgers (routing-outcomes, funnel-events) so downstream
 * readers can tail without truncation risk.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

/** A single permission-audit event. */
export interface AuditEvent {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Opaque agent identifier — matches Task tool `name:` or a swarm-assigned slot id. */
  agentId: string;
  /** Symbolic role — matches PermissionSet.role. */
  role: string;
  /** Event class. */
  event: 'granted' | 'checked' | 'denied' | 'revoked';
  /** Free-form capability descriptor (`tool:Bash`, `path:src/**`, `net:api.github.com`). */
  capability: string;
  /** Optional swarm-scope identifier. */
  swarmId?: string;
  /** Optional human-readable reason. */
  reason?: string;
  /** Auto-generated event id for correlation. */
  eventId: string;
}

/** Resolve `.swarm/permission-audit.jsonl` under the given (or cwd's) swarm dir. */
export function auditLogPath(swarmDir?: string): string {
  const dir = swarmDir ?? path.join(process.cwd(), '.swarm');
  return path.join(dir, 'permission-audit.jsonl');
}

/** Resolve `.swarm/permissions.jsonl` — the current-grants manifest. */
export function grantsPath(swarmDir?: string): string {
  const dir = swarmDir ?? path.join(process.cwd(), '.swarm');
  return path.join(dir, 'permissions.jsonl');
}

function ensureDirFor(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Append a single audit event. Never throws — failures are non-critical. */
export function appendAuditEvent(event: Omit<AuditEvent, 'eventId' | 'timestamp'>, swarmDir?: string): void {
  const full: AuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
    eventId: `evt-${Date.now()}-${randomBytes(4).toString('hex')}`,
  };
  try {
    const p = auditLogPath(swarmDir);
    ensureDirFor(p);
    fs.appendFileSync(p, JSON.stringify(full) + '\n', 'utf-8');
  } catch {
    /* audit log unavailable — non-critical, don't crash the caller */
  }
}

/** Read every audit event. Used by review tooling. */
export function readAuditLog(swarmDir?: string): AuditEvent[] {
  const p = auditLogPath(swarmDir);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as AuditEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is AuditEvent => e !== null);
}

/** Write the current grants manifest (overwrites) — one line per role. */
export function writeGrants(grants: unknown[], swarmDir?: string): void {
  const p = grantsPath(swarmDir);
  ensureDirFor(p);
  fs.writeFileSync(p, grants.map((g) => JSON.stringify(g)).join('\n') + '\n', 'utf-8');
}

/** Read the current grants manifest. */
export function readGrants(swarmDir?: string): unknown[] {
  const p = grantsPath(swarmDir);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf-8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((g) => g !== null);
}
