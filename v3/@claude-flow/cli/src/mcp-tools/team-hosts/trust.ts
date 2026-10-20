/**
 * Trust for command hosts (ADR-402 §4).
 *
 * .claude-flow/team-hosts.json is part of the checkout, so whoever controls
 * the checkout controls the command a command host runs. `ruflo team run`
 * therefore runs a command host only after the user has recorded trust for
 * that exact entry with `ruflo team trust-host <label>`. The record lives in
 * the user's home directory, outside any checkout, and is bound to the
 * project root and a digest of the validated entry, so editing the entry
 * revokes it. Shell interpreters and path-like commands additionally need
 * `--allow-unsafe-command` at trust time.
 */

import { createHash } from 'node:crypto';
import {
  existsSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { CommandHostConfig } from './types.js';

const TRUST_FILE_VERSION = 1;
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 15000;

/** Commands that run arbitrary code from their arguments. Compared after lowercasing and dropping a Windows extension. */
const UNSAFE_COMMANDS = new Set([
  'sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'csh', 'tcsh', 'fish', 'busybox',
  'cmd', 'command', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta',
  'env', 'sudo', 'doas', 'su', 'xargs', 'nohup', 'nice', 'timeout', 'exec', 'eval', 'osascript',
  // #3513 MEDIUM B: general-purpose interpreters and tools that can run
  // arbitrary code via a flag (`-e`, `-c`, `eval`) — a plain `trust-host`
  // (without --allow-unsafe-command) accepted `node -e "<script>" {prompt}`
  // and the script ran.
  'node', 'nodejs', 'python', 'python3', 'python2', 'ruby', 'perl', 'perl5',
  'php', 'lua', 'tclsh', 'wish', 'groovy', 'jjs', 'deno', 'bun',
  'npx', 'npm', 'yarn', 'pnpm', 'git', 'find', 'make', 'gcc', 'g++', 'cc',
  'rlwrap', 'ssh', 'rsync', 'tar',
]);

export interface TrustEntry {
  projectRoot: string;
  label: string;
  sha256: string;
  allowUnsafeCommand: boolean;
  trustedAt: string;
}

interface TrustFile {
  version: number;
  entries: TrustEntry[];
}

/** Where trust records live. RUFLO_TEAM_TRUST_FILE overrides the default (tests, locked-down homes). */
export function trustFilePath(): string {
  return process.env.RUFLO_TEAM_TRUST_FILE || join(homedir(), '.claude-flow', 'trusted-team-hosts.json');
}

function canonicalRoot(projectRoot: string): string {
  try {
    return realpathSync(projectRoot);
  } catch {
    return resolve(projectRoot);
  }
}

/** Digest of a validated command-host entry. Key order is fixed, so formatting changes do not revoke trust. */
export function hostConfigDigest(cfg: CommandHostConfig): string {
  const canonical = JSON.stringify([cfg.kind, cfg.command, cfg.args, cfg.promptVia, cfg.passEnv, cfg.isolation]);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Why a command needs `--allow-unsafe-command`, or undefined when it does
 * not. A path-like command (`./x`, `/bin/x`, `C:\x`) runs whatever file the
 * checkout puts there; a shell or wrapper runs whatever its arguments say.
 */
export function unsafeCommandReason(command: string): string | undefined {
  if (/[\\/]/.test(command) || /^[A-Za-z]:/.test(command) || command.startsWith('.') || command.startsWith('~')) {
    return 'a path, not a command name looked up on PATH';
  }
  const base = command.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, '');
  if (UNSAFE_COMMANDS.has(base)) return 'a shell or command wrapper that runs code from its arguments';
  return undefined;
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Break a lock file older than LOCK_STALE_MS (a crashed holder). Renames it
 * aside and checks the token it held: if a live holder re-took the lock in
 * between, the rename caught theirs, so it is linked back (link fails rather
 * than overwrite) and this waiter keeps waiting. Mirrors the same pattern
 * `grok-team-store.mjs`'s `withTeamLock` uses for `team.json`.
 */
function breakStaleLock(lock: string, token: string): void {
  let seen: string;
  try {
    if (Date.now() - statSync(lock).mtimeMs <= LOCK_STALE_MS) return;
    seen = readFileSync(lock, 'utf-8');
  } catch {
    return; // released meanwhile
  }
  const aside = `${lock}.stale.${token}`;
  try {
    renameSync(lock, aside);
  } catch {
    return; // another waiter broke it first
  }
  try {
    if (readFileSync(aside, 'utf-8') !== seen) {
      try {
        linkSync(aside, lock);
      } catch {
        /* slot taken; that holder's release is a no-op */
      }
    }
  } finally {
    rmSync(aside, { force: true });
  }
}

/**
 * Run `fn` holding a cross-process lock on the trust file: a `<file>.lock`
 * file created with O_EXCL and holding a random token. #3513 MINOR 1: without
 * this, 12 parallel `trust-host` calls could leave fewer than 12 records, and
 * a concurrent `--revoke` could be clobbered by a racing write (read-modify-
 * write with no lock at all).
 */
function withTrustLock<T>(fn: () => T): T {
  const file = trustFilePath();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lock = `${file}.lock`;
  const token = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (let wait = 2; ; wait = Math.min(wait * 2, 50)) {
    try {
      writeFileSync(lock, token, { flag: 'wx', mode: 0o600 });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    breakStaleLock(lock, token);
    if (Date.now() > deadline) throw new Error('Timed out waiting for the trust-file lock');
    sleepMs(wait + Math.floor(Math.random() * wait));
  }
  try {
    return fn();
  } finally {
    try {
      if (readFileSync(lock, 'utf-8') === token) rmSync(lock, { force: true });
    } catch {
      /* already gone */
    }
  }
}

function readTrustFile(): TrustFile {
  const file = trustFilePath();
  if (!existsSync(file)) return { version: TRUST_FILE_VERSION, entries: [] };
  try {
    const doc = JSON.parse(readFileSync(file, 'utf-8')) as TrustFile;
    return Array.isArray(doc?.entries) ? doc : { version: TRUST_FILE_VERSION, entries: [] };
  } catch {
    return { version: TRUST_FILE_VERSION, entries: [] };
  }
}

export function findTrust(projectRoot: string, label: string, cfg: CommandHostConfig): TrustEntry | undefined {
  const root = canonicalRoot(projectRoot);
  const digest = hostConfigDigest(cfg);
  return readTrustFile().entries.find((e) => e.projectRoot === root && e.label === label && e.sha256 === digest);
}

/** Record (or with `revoke`, remove) trust for one host entry of one project. */
export function recordTrust(
  projectRoot: string,
  label: string,
  cfg: CommandHostConfig,
  opts: { allowUnsafeCommand?: boolean; revoke?: boolean } = {},
): TrustEntry | undefined {
  const root = canonicalRoot(projectRoot);
  return withTrustLock(() => {
    const doc = readTrustFile();
    // One record per project and label: a new trust replaces the old digest.
    doc.entries = doc.entries.filter((e) => !(e.projectRoot === root && e.label === label));
    let entry: TrustEntry | undefined;
    if (!opts.revoke) {
      entry = {
        projectRoot: root,
        label,
        sha256: hostConfigDigest(cfg),
        allowUnsafeCommand: opts.allowUnsafeCommand === true,
        trustedAt: new Date().toISOString(),
      };
      doc.entries.push(entry);
    }
    const file = trustFilePath();
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ version: TRUST_FILE_VERSION, entries: doc.entries }, null, 2) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
    return entry;
  });
}
