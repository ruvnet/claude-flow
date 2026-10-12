/**
 * Second, hash-chained copy of the policy ledger anchor (#3602, ADR-475).
 *
 * The primary anchor (`ledgerLength` / `ledgerHead`) lives inside state.json,
 * the same file it protects, so deleting it together with receipts used to
 * make `verify` bless the truncated chain. This module keeps an append-only
 * chain of anchor entries in a SEPARATE file plus a mirror of the newest entry
 * outside the project directory (~/.config/ruflo/policy-trust/<project>/).
 *
 * Threat model: this detects any tampering confined to state.json, and any
 * tampering confined to the project directory. It does NOT stop an attacker
 * who can rewrite both the project directory and the user's home directory.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { PolicyState } from '@claude-flow/security';

export type AnchorEvent = 'append' | 'migrated-from-state' | 'establish-anchor';

export interface AnchorEntry {
  seq: number;
  length: number;
  headHash: string | null;
  prevAnchorHash: string | null;
  ts: number;
  event: AnchorEvent;
  by?: string;
  hash: string;
}

export type AnchorAssessment =
  | { kind: 'absent' }
  | { kind: 'ok'; last: AnchorEntry; behind: boolean }
  | { kind: 'fail'; error: string };

export type AnchorWriter = (file: string, value: unknown) => Promise<void>;

const LOG_FILE = 'ledger-anchors.json';
const MIRROR_FILE = 'ledger-anchor-head.json';

export const anchorLogPath = (projectRoot: string): string => join(resolve(projectRoot), '.claude-flow', 'policy', LOG_FILE);

/**
 * Directory holding per-project trust material (anchor mirror, HMAC key).
 * Resolved from the environment at call time (#3919): $XDG_CONFIG_HOME when it
 * is absolute, else $HOME/.config (os.homedir() honours $HOME), so a scratch
 * HOME keeps tests and sandboxed runs out of the developer's real home. An XDG
 * user who already has trust state under the legacy ~/.config keeps using it.
 */
export function policyTrustRoot(): string {
  const legacy = join(homedir(), '.config', 'ruflo', 'policy-trust');
  const xdg = process.env.XDG_CONFIG_HOME;
  if (!xdg || !isAbsolute(xdg)) return legacy;
  const preferred = join(xdg, 'ruflo', 'policy-trust');
  return !existsSync(preferred) && existsSync(legacy) ? legacy : preferred;
}

function mirrorPath(projectRoot: string): string {
  const id = createHash('sha256').update(realpathSync(projectRoot)).digest('hex');
  return join(policyTrustRoot(), id, MIRROR_FILE);
}

function entryHash(entry: Omit<AnchorEntry, 'hash'>): string {
  return createHash('sha256').update(JSON.stringify([
    entry.seq, entry.length, entry.headHash, entry.prevAnchorHash, entry.ts, entry.event, entry.by ?? null,
  ])).digest('hex');
}

function validEntry(value: unknown, seq: number, prev: string | null): value is AnchorEntry {
  const e = value as AnchorEntry;
  return !!e && typeof e === 'object'
    && e.seq === seq
    && Number.isInteger(e.length) && e.length >= 0
    && (e.headHash === null || typeof e.headHash === 'string')
    && e.prevAnchorHash === prev
    && typeof e.ts === 'number'
    && ['append', 'migrated-from-state', 'establish-anchor'].includes(e.event)
    && typeof e.hash === 'string'
    && e.hash === entryHash({ ...e, hash: undefined } as never);
}

function readLog(projectRoot: string): AnchorEntry[] | 'corrupt' {
  const file = anchorLogPath(projectRoot);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: number; entries?: unknown[] };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return 'corrupt';
    let prev: string | null = null;
    for (let i = 0; i < parsed.entries.length; i++) {
      if (!validEntry(parsed.entries[i], i, prev)) return 'corrupt';
      prev = (parsed.entries[i] as AnchorEntry).hash;
    }
    return parsed.entries as AnchorEntry[];
  } catch {
    return 'corrupt';
  }
}

function readMirror(projectRoot: string): AnchorEntry | null | 'corrupt' {
  const file = mirrorPath(projectRoot);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as AnchorEntry;
    return typeof parsed?.hash === 'string' && parsed.hash === entryHash({ ...parsed, hash: undefined } as never)
      ? parsed
      : 'corrupt';
  } catch {
    return 'corrupt';
  }
}

/**
 * How the stored anchors relate to `state`; read-only. `rebuild` is the
 * explicit-establish path: an unreadable log or mirror is treated as absent, but
 * whatever readable anchor remains must still agree with the chain, so it can
 * never bless a truncation the anchors still remember.
 */
export function assessAnchors(projectRoot: string, state: PolicyState, rebuild = false): AnchorAssessment {
  let entries = readLog(projectRoot);
  if (entries === 'corrupt') {
    if (!rebuild) return { kind: 'fail', error: 'policy-anchor-log-corrupt' };
    entries = [];
  }
  let mirror = readMirror(projectRoot);
  if (mirror === 'corrupt') {
    if (!rebuild) return { kind: 'fail', error: 'policy-anchor-mirror-corrupt' };
    mirror = null;
  }
  if (entries.length === 0) {
    if (!mirror) return { kind: 'absent' };
    if (!rebuild) return { kind: 'fail', error: 'policy-anchor-log-missing' };
    if (state.receipts.length < mirror.length) return { kind: 'fail', error: 'policy-ledger-truncated' };
    if (mirror.length > 0 && state.receipts[mirror.length - 1]!.hash !== mirror.headHash) {
      return { kind: 'fail', error: 'policy-ledger-anchor-mismatch' };
    }
    return { kind: 'absent' };
  }
  if (mirror && !entries.some((entry) => entry.hash === mirror.hash)) {
    return { kind: 'fail', error: 'policy-anchor-log-rolled-back' };
  }
  const last = entries[entries.length - 1]!;
  for (const anchor of mirror ? [last, mirror] : [last]) {
    if (state.receipts.length < anchor.length) return { kind: 'fail', error: 'policy-ledger-truncated' };
    if (anchor.length > 0 && state.receipts[anchor.length - 1]!.hash !== anchor.headHash) {
      return { kind: 'fail', error: 'policy-ledger-anchor-mismatch' };
    }
  }
  return { kind: 'ok', last, behind: state.receipts.length > last.length };
}

/**
 * Append an entry for the current state if the newest entry does not already
 * describe it. Must run under the policy lock. Throws if the log is corrupt:
 * only an explicit establish may replace a corrupt log.
 */
export async function recordAnchor(
  projectRoot: string,
  state: PolicyState,
  write: AnchorWriter,
  event: AnchorEvent = 'append',
  by?: string,
): Promise<void> {
  if (state.receipts.length === 0) return;
  const loaded = readLog(projectRoot);
  const entries = loaded === 'corrupt' ? [] : loaded;
  if (loaded === 'corrupt' && event !== 'establish-anchor') throw new Error('policy-anchor-log-corrupt');
  const last = entries[entries.length - 1];
  const length = state.receipts.length;
  const headHash = state.receipts[length - 1]!.hash;
  let tip = last;
  if (!last || last.length !== length || last.headHash !== headHash) {
    const base = {
      seq: entries.length,
      length,
      headHash,
      prevAnchorHash: last?.hash ?? null,
      ts: Date.now(),
      event,
      ...(by ? { by } : {}),
    };
    tip = { ...base, hash: entryHash(base) };
    await write(anchorLogPath(projectRoot), { version: 1, entries: [...entries, tip] });
  }
  try {
    const mirror = mirrorPath(projectRoot);
    mkdirSync(dirname(mirror), { recursive: true, mode: 0o700 });
    await write(mirror, tip);
  } catch (error) {
    // A read-only home must not stop the ledger; verify reports the weaker
    // posture (no mirror) rather than failing closed on every decision.
    process.stderr.write(`[policy] anchor mirror not written: ${(error as Error).message}\n`);
  }
}

export function anchorPosture(projectRoot: string): { log: boolean; mirror: boolean } {
  return { log: existsSync(anchorLogPath(projectRoot)), mirror: existsSync(mirrorPath(projectRoot)) };
}
