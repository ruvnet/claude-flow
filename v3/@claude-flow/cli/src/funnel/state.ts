/**
 * Funnel state storage — user-level JSON files under ~/.ruflo (ADR-302/305).
 *
 * User-level (not project-level) so dismissals, consent, and disclosure
 * persist across projects. Files are written 0600 and never committed.
 * RUFLO_STATE_DIR overrides the directory (tests, unusual $HOME setups).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function funnelStateDir(): string {
  const override = process.env.RUFLO_STATE_DIR;
  if (override && override.trim()) return override;
  return path.join(os.homedir(), '.ruflo');
}

export function statePath(name: string): string {
  return path.join(funnelStateDir(), name);
}

export function readStateJson<T>(name: string): T | null {
  try {
    const raw = fs.readFileSync(statePath(name), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeStateJson(name: string, value: unknown): boolean {
  try {
    const dir = funnelStateDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const target = statePath(name);
    // Write-then-rename so a crash never leaves a truncated state file.
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

export function deleteStateFile(name: string): void {
  try {
    fs.unlinkSync(statePath(name));
  } catch {
    // already absent — fine
  }
}
