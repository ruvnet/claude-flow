/**
 * Helpers for reading stop-hook payloads and normalizing agent labels.
 */

import type { StopIdentity } from './types.js';

type Payload = Record<string, unknown>;

function asObject(v: unknown): Payload {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Payload) : {};
}

/** First non-empty string at any of the given dotted paths. */
export function pickString(payload: unknown, paths: string[]): string | undefined {
  const root = asObject(payload);
  for (const p of paths) {
    let cur: unknown = root;
    for (const key of p.split('.')) {
      cur = asObject(cur)[key];
    }
    if (typeof cur === 'string' && cur.trim()) return cur.trim();
  }
  return undefined;
}

/**
 * Turn a host label into a team agent name. The spawn description form
 * `role:agent@team` becomes `agent`; whitespace becomes `-`; max 64 chars.
 */
export function normalizeAgentLabel(label: string): string {
  const noTeam = label.includes('@') ? label.slice(0, label.lastIndexOf('@')) : label;
  const afterColon = noTeam.includes(':') ? noTeam.slice(noTeam.lastIndexOf(':') + 1) : noTeam;
  return afterColon.trim().replace(/\s+/g, '-').slice(0, 64);
}

/** The `@team` part of a `role:agent@team` spawn description, if any. */
export function labelTeam(label: string): string | undefined {
  const at = label.lastIndexOf('@');
  const team = at >= 0 ? label.slice(at + 1).trim() : '';
  return team || undefined;
}

export function readStopIdentity(
  payload: unknown,
  agentPaths: string[],
  envAgent?: string,
): StopIdentity {
  const out: StopIdentity = {};
  const agent = envAgent?.trim() || pickString(payload, agentPaths);
  if (agent) out.agent = normalizeAgentLabel(agent);
  const team = pickString(payload, ['teamName', 'team', 'team_name']) ?? (agent ? labelTeam(agent) : undefined);
  if (team) out.team = team;
  const outcome = pickString(payload, ['outcome']);
  if (outcome === 'done' || outcome === 'failed') out.outcome = outcome;
  return out;
}
