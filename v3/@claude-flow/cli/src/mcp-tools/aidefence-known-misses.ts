/**
 * Known-miss registry for aidefence_learn (#4147).
 *
 * The detector's learned patterns are written by `learnFromDetection`, but
 * they are only created from threats the detector already found, and
 * `detect()` never reads them back. A threat the detector MISSED (a false
 * negative, the case feedback matters most for) therefore had nowhere to go.
 *
 * This registry stores a SHA-256 of the whitespace/case-normalised input so a
 * reported miss is flagged next time the identical text is scanned. It is an
 * exact-match list, not generalisation: the raw text is never stored.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_ENTRIES = 500;

export interface KnownMiss {
  hash: string;
  threatType: string;
  reportedAt: string;
}

function storePath(cwd: string): string {
  return join(cwd, '.claude-flow', 'aidefence-known-misses.json');
}

export function hashInput(input: string): string {
  const normalised = input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalised).digest('hex');
}

function load(cwd: string): KnownMiss[] {
  try {
    const p = storePath(cwd);
    if (!existsSync(p)) return [];
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.hash === 'string') : [];
  } catch {
    return [];
  }
}

/** Returns true when the miss was newly recorded, false when it was already known. */
export function recordKnownMiss(input: string, threatType: string, cwd: string = process.cwd()): boolean {
  const hash = hashInput(input);
  const entries = load(cwd);
  if (entries.some((e) => e.hash === hash)) return false;
  entries.push({ hash, threatType, reportedAt: new Date().toISOString() });
  const dir = join(cwd, '.claude-flow');
  mkdirSync(dir, { recursive: true });
  const tmp = `${storePath(cwd)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2), { mode: 0o600 });
  renameSync(tmp, storePath(cwd));
  return true;
}

export function findKnownMiss(input: string, cwd: string = process.cwd()): KnownMiss | undefined {
  const entries = load(cwd);
  if (entries.length === 0) return undefined;
  const hash = hashInput(input);
  return entries.find((e) => e.hash === hash);
}
