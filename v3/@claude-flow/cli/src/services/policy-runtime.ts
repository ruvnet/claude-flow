// Narrow subpath imports (not the '@claude-flow/security' barrel): this module
// is loaded eagerly by the MCP server, and the barrel also evaluates the OAuth
// callback server (an ESM `node:http` import that materialises http's lazy
// undici getters), bcryptjs, keychain and credential helpers that the policy
// runtime never uses.
import {
  AgenticPolicyEngine,
  POLICY_STATE_VERSION,
  createLegacyCompatibleState,
  type BudgetLimit,
  type CapabilityEnvelope,
  type PolicyApproval,
  type PolicyDecision,
  type PolicyEvidence,
  type PolicyReceipt,
  type PolicyRequest,
  type PolicyRule,
  type PolicyState,
} from '@claude-flow/security/policy/index';
import {
  isMcpCallerAuthEnabled,
  decodeTokenEnvelope,
  publicKeyFromHex,
  verifyInvocationToken,
} from '@claude-flow/security/mcp-caller-identity';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  writeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hostname, userInfo } from 'node:os';
import { syncPolicyProjection } from '../mods/policy-projection.js';
import { ATOMIC_JSON_WRITER, type AtomicJsonSource } from './policy-anchor-log.js';
import { captureArchiveSnapshot, verifyFullPolicyLedger, type ArchiveSnapshot } from './policy-ledger-audit.js';
import { ANCHOR_LOG_FILE, ANCHOR_MIRROR_FILE, assessAnchors, policyTrustRoot, recordAnchor, type AnchorEvent, type AnchorEntry } from './policy-ledger-anchor.js';

const POLICY_DIR = join('.claude-flow', 'policy');
const POLICY_FILE = 'state.json';
const LOCK_FILE = 'state.lock';
const RECEIPT_ARCHIVE_FILE = 'receipts.ledger.jsonl';
const STATE_ANCHOR_FILE = 'state.anchor.json';
const LOCK_WAIT_MS = 5_000;
// #3164: without a bound, `state.receipts` grows forever and every
// transaction's verify/clone/serialize cost is O(all receipts ever issued) —
// eventually exceeding LOCK_WAIT_MS and timing out every MCP tool call.
// Pruned receipts are archived to RECEIPT_ARCHIVE_FILE, never discarded.
const DEFAULT_LEDGER_RETENTION = 2_000;
function ledgerRetention(): number {
  const raw = process.env.CLAUDE_FLOW_POLICY_LEDGER_RETENTION;
  if (!raw) return DEFAULT_LEDGER_RETENTION;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_LEDGER_RETENTION;
}
// A lock is ~170 bytes plus the hostname (at most 255 bytes).
const LOCK_MAX_BYTES = 1_024;
// Linux PID namespace of this process, e.g. `pid:[4026531836]`; undefined on
// other platforms or without /proc. Recorded in the lock because a pid only
// identifies a process inside the namespace that wrote it.
const PID_NAMESPACE = (() => {
  try { return readlinkSync('/proc/self/ns/pid'); } catch { return undefined; }
})();
// Linux boot id: one uuid per kernel boot, shared by every process on that
// kernel and readable inside containers. Recorded because `host` is only a
// name: two machines that share a project directory can report the same
// hostname, and the init PID namespace has the same inode on every Linux host.
const BOOT_ID = (() => {
  try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return undefined; }
})();

function paths(projectRoot: string): { dir: string; state: string; lock: string; archive: string } {
  const root = resolve(projectRoot);
  const dir = join(root, POLICY_DIR);
  return { dir, state: join(dir, POLICY_FILE), lock: join(dir, LOCK_FILE), archive: join(dir, RECEIPT_ARCHIVE_FILE) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/**
 * Signal-0 existence probe, as in #1799 (`isPidAlive` in swarm-tools.ts), but
 * only ESRCH counts as dead (as `processIsAlive` in helper-refresh.ts): here a
 * false "dead" breaks mutual exclusion, so EPERM (another user's process) and
 * any unexpected error mean alive.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Reads a lock only if it is a small regular file: never follows a symlink,
 * never blocks on a FIFO or device, never reads more than LOCK_MAX_BYTES.
 * Anything else returns undefined; unknown owners are preserved.
 */
function readLockFile(lockPath: string): string | undefined {
  if (!lstatSync(lockPath).isFile()) return undefined;
  const fd = openSync(
    lockPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > LOCK_MAX_BYTES) return undefined;
    const buffer = Buffer.alloc(LOCK_MAX_BYTES);
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, LOCK_MAX_BYTES, 0));
  } finally {
    closeSync(fd);
  }
}

/**
 * A process killed inside a transaction (SIGKILL, OOM, or a signal whose
 * default action terminates it) never runs `finally { release() }`, so every
 * caller, MCP reads included, waited LOCK_WAIT_MS and failed with
 * policy-state-lock-timeout until the orphan's mtime crossed LOCK_STALE_MS.
 * The pid is trusted only if the lock was written by this OS, on this kernel
 * boot and in this PID namespace: anywhere else (a bwrap --unshare-pid
 * sandbox, a container, another machine on a shared filesystem) a live owner
 * also answers ESRCH. Locks without that identity (older ruflo, a crash
 * between create and write, anything unparsable) return false and require
 * explicit operator inspection rather than age-only takeover.
 */
function lockOwnerIsDead(lockPath: string): boolean {
  try {
    const read = readLockFile(lockPath);
    if (read === undefined) return false;
    const owner = JSON.parse(read) as
      { pid?: unknown; host?: unknown; platform?: unknown; pidns?: unknown; boot?: unknown } | null;
    if (!owner || owner.host !== hostname() || owner.platform !== process.platform
      || owner.pidns !== PID_NAMESPACE || owner.boot !== BOOT_ID) return false;
    // Without /proc, one Linux kernel boot or PID namespace cannot be told
    // from another, and `host` is only a name.
    if (process.platform === 'linux'
      && (PID_NAMESPACE === undefined || BOOT_ID === undefined)) return false;
    const pid = owner.pid;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || pid > 0x7fffffff
      || isPidAlive(pid)) return false;
    // The lock can change hands while it is read and probed (its owner
    // releases and exits, another process acquires). Re-read it and answer
    // only if it is byte for byte the lock that was read: the next owner's
    // lock always differs in `pid` or `acquiredAt`. `dev`/`ino`/`ctime` cannot
    // stand in for that — ext4 reuses a freed inode number at once, and before
    // Linux 6.13 two files created in one clock tick share a ctime.
    return readLockFile(lockPath) === read;
  } catch {
    return false;
  }
}

/** Serialize dead-owner reclamation across processes. A normal acquirer can
 * create state.lock after deletion, but the next reclaimer must re-probe that
 * new owner under this guard. Guard orphans fail closed, requiring explicit
 * operator recovery after validating their exact recorded owner and nonce.
 * Unknown/foreign owners are never stolen merely because their mtime aged. */
function reclaimDeadLock(lockPath: string): void {
  const guard = `${lockPath}.reclaim`;
  let fd: number;
  try { fd = openSync(guard, 'wx', 0o600); } catch { return; }
  const ownership = JSON.stringify({ pid: process.pid, nonce: randomUUID(), host: hostname(), platform: process.platform, pidns: PID_NAMESPACE, boot: BOOT_ID });
  try {
    writeFileSync(fd, ownership);
    if (lockOwnerIsDead(lockPath)) unlinkSync(lockPath);
  } catch { /* lock changed, unknown identity, or an inaccessible path */ }
  finally {
    closeSync(fd);
    try { if (readLockFile(guard) === ownership) unlinkSync(guard); } catch { /* preserve an unknown guard */ }
  }
}

/**
 * Exported for ADR-406 mission storage, which takes the same per-file lock
 * (pid, pid namespace and boot id identify a dead owner) rather than a copy.
 */
export async function acquireLock(lockPath: string): Promise<() => void> {
  const started = Date.now();
  // O_NOFOLLOW closes the create-through-a-symlink path on platforms that
  // support it; lstat below still rejects non-regular existing paths.
  const createFlags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL
    | (process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0));
  while (Date.now() - started < LOCK_WAIT_MS) {
    try {
      const fd = openSync(lockPath, createFlags, 0o600);
      const ownership = JSON.stringify({
        pid: process.pid,
        acquiredAt: Date.now(),
        host: hostname(),
        platform: process.platform,
        pidns: PID_NAMESPACE,
        boot: BOOT_ID,
        nonce: randomUUID(),
      });
      try { writeFileSync(fd, ownership); } finally { closeSync(fd); }
      return () => {
        try { if (readLockFile(lockPath) === ownership) unlinkSync(lockPath); } catch { /* already released */ }
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      // Only EEXIST is normal lock contention. Permission/path/IO failures
      // must not masquerade as a five-second timeout on every MCP call.
      // ELOOP is O_NOFOLLOW rejecting a symlink at the lock path.
      if (code === 'ELOOP') {
        throw new Error('policy-state-lock-error: lock path is not a regular file');
      }
      if (code !== 'EEXIST') {
        throw new Error(`policy-state-lock-error: ${code ?? (error instanceof Error ? error.message : String(error))}`);
      }
      // EEXIST can also mean a directory/FIFO/symlink was planted at the lock
      // path. Those are never a live lock: fail immediately instead of
      // waiting, and never follow/remove the non-regular target.
      try {
        if (!lstatSync(lockPath).isFile()) {
          throw new Error('policy-state-lock-error: lock path is not a regular file');
        }
      } catch (statError) {
        if (statError instanceof Error && statError.message.startsWith('policy-state-lock-error:')) throw statError;
        // The lock vanished between open() and lstat(); retry immediately.
      }
      reclaimDeadLock(lockPath);
      await sleep(10);
    }
  }
  throw new Error(lockOwnerIsDead(lockPath)
    ? 'policy-state-lock-timeout: dead owner; inspect exact owner of state.lock.reclaim before explicit recovery'
    : 'policy-state-lock-timeout');
}

// #3398: Windows rename over a file another process holds open fails with
// EPERM/EBUSY/EACCES. Retry (~1.3s total, inside LOCK_WAIT_MS), never leave the
// temp file; a final failure still throws — the state holds the receipt ledger
// and consumed approval uses, so dropping it would let an approval be reused.
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 150, 250, 300, 400];
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function mkdirDurably(dir: string): void {
  if (existsSync(dir)) return;
  const parent = dirname(dir);
  if (parent !== dir) mkdirDurably(parent);
  try { mkdirSync(dir, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  syncDirectory(parent);
}

function syncDirectory(dir: string): void {
  // Windows does not expose directory fsync through Node. File sync and
  // atomic rename still apply there; POSIX failures must reach the caller.
  if (process.platform === 'win32') return;
  const fd = openSync(dir, fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY ?? 0));
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Recover only an incomplete, unacknowledged final append. All inspection,
 * truncation, append and sync use the same nofollow regular-file descriptor. */
function appendArchiveDurably(file: string, receipts: PolicyReceipt[], verifier: AgenticPolicyEngine): void {
  const fd = openSync(file, fsConstants.O_RDWR | fsConstants.O_CREAT
    | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0), 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('policy-ledger-archive-not-regular');
    const limit = 64 * 1024;
    const start = Math.max(0, stat.size - limit);
    const buffer = Buffer.alloc(stat.size - start);
    if (readSync(fd, buffer, 0, buffer.length, start) !== buffer.length) throw new Error('policy-ledger-archive-short-read');
    let end = stat.size;
    const lastNewline = buffer.lastIndexOf(10);
    if (buffer.length && buffer[buffer.length - 1] !== 10) {
      if (lastNewline < 0 && start > 0) throw new Error('policy-ledger-archive-tail-too-large');
      const fragmentBytes = buffer.subarray(lastNewline + 1);
      const fragment = fragmentBytes.toString('utf8');
      try { JSON.parse(fragment); throw new Error('policy-ledger-archive-unterminated-record'); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      // A parse failure alone grants no repair authority: the bytes must
      // be an exact prefix of a receipt still available in the verified hot
      // state and being retried by this prune.
      if (!fragmentBytes.length || !receipts.some(receipt => {
        const expected = Buffer.from(JSON.stringify(receipt));
        return fragmentBytes.length < expected.length && expected.subarray(0, fragmentBytes.length).equals(fragmentBytes);
      })) {
        throw new Error('policy-ledger-archive-unrecoverable-tail');
      }
      end = start + lastNewline + 1;
    }
    const complete = buffer.subarray(0, end - start).toString('utf8');
    const usable = start === 0 ? complete : complete.slice(complete.indexOf('\n') + 1);
    for (const line of usable.split('\n')) {
      if (!line.trim()) continue;
      let record: unknown;
      try { record = JSON.parse(line); } catch { throw new Error('policy-ledger-archive-parse-error'); }
      if (verifier.verifyReceipt(record)) throw new Error('policy-ledger-archive-conflict');
    }
    if (end < stat.size) { ftruncateSync(fd, end); fsyncSync(fd); }
    const bytes = Buffer.from(`${receipts.map(receipt => JSON.stringify(receipt)).join('\n')}\n`);
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(fd, bytes, written, bytes.length - written, end + written);
      if (!count) throw new Error('policy-ledger-archive-short-write');
      written += count;
    }
    fsyncSync(fd);
    syncDirectory(dirname(file));
  } finally { closeSync(fd); }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  mkdirDurably(dirname(file));
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      if (value && typeof (value as AtomicJsonSource)[ATOMIC_JSON_WRITER] === 'function') (value as AtomicJsonSource)[ATOMIC_JSON_WRITER](fd);
      else writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(temporary, file);
        renamed = true;
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code ?? '';
        if (!TRANSIENT_RENAME_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw error;
        await sleep(RENAME_RETRY_DELAYS_MS[attempt]);
      }
    }
    // A post-rename sync failure is a publication failure, not a rename
    // failure. Never retry with a temporary file already consumed by rename.
    syncDirectory(dirname(file));
  } finally {
    if (!renamed) {
      try { unlinkSync(temporary); } catch { /* never created or already gone */ }
    }
  }
}

// #3164: a writer killed between creating its temp file and renaming it
// (SIGKILL from a caller's timeout, OOM) never reaches writeJsonAtomic's
// cleanup, so a full-size copy of the file stays behind forever (~250 MB each
// on a mature ledger). Every writer of these files holds the project's
// state.lock, so while the lock is held no temp file for them can belong to a
// write in progress. That invariant has known gaps: released versions before
// the dead-owner fix take over any lock older than 30 s, even a live owner's
// (a writer suspended mid-write, e.g. a sleeping laptop). So a temp is also
// kept while its writer pid is alive on this host, and until it is
// ORPHAN_TEMP_MIN_AGE_MS old; a skipped orphan is removed by a later call.
const ORPHAN_TEMP_MIN_AGE_MS = 10 * 60_000;
const ATOMIC_TEMP = /^(.+)\.(\d+)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const PROJECT_ATOMIC_FILES = new Set([POLICY_FILE, ANCHOR_LOG_FILE]);
const TRUST_ATOMIC_FILES = new Set([STATE_ANCHOR_FILE, ANCHOR_MIRROR_FILE]);

function reapOrphanedTemps(dir: string, files: ReadonlySet<string>): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; }
  const now = Date.now();
  for (const name of names) {
    const match = ATOMIC_TEMP.exec(name);
    if (!match || !files.has(match[1])) continue;
    const pid = Number(match[2]);
    if (Number.isSafeInteger(pid) && pid > 0 && isPidAlive(pid)) continue;
    const file = join(dir, name);
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || now - stat.mtimeMs < ORPHAN_TEMP_MIN_AGE_MS) continue;
      unlinkSync(file);
    } catch { /* already gone, or not removable: never fail the caller */ }
  }
}

/** Call only while holding the project's state.lock. */
function reapOrphanedPolicyTemps(projectRoot: string): void {
  reapOrphanedTemps(paths(projectRoot).dir, PROJECT_ATOMIC_FILES);
  try { reapOrphanedTemps(dirname(trustPaths(projectRoot).anchor), TRUST_ATOMIC_FILES); } catch { /* no trust dir yet */ }
}

function trustPaths(projectRoot: string): { key: string; anchor: string } {
  const trustRoot = policyTrustRoot();
  const projectId = createHash('sha256').update(realpathSync(projectRoot)).digest('hex');
  const dir = join(trustRoot, projectId);
  return { key: join(dir, 'anchor.key'), anchor: join(dir, STATE_ANCHOR_FILE) };
}

function trustKey(projectRoot: string, create: boolean): Buffer | undefined {
  const { key } = trustPaths(projectRoot);
  if (!existsSync(key)) {
    if (!create) return undefined;
    mkdirDurably(dirname(key));
    const fd = openSync(key, 'wx', 0o600);
    try { writeFileSync(fd, randomBytes(32)); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(dirname(key));
  }
  const material = readFileSync(key);
  if (material.length !== 32) throw new Error('invalid-policy-trust-key');
  return material;
}

function stateAuthentication(state: PolicyState, key: Buffer): string {
  return createHmac('sha256', key).update(JSON.stringify(state)).digest('hex');
}

function verifyStateAnchor(projectRoot: string, state: PolicyState | undefined): void {
  const { anchor } = trustPaths(projectRoot);
  if (!existsSync(anchor)) return;
  if (!state) throw new Error('policy-state-missing-for-anchored-project');
  const key = trustKey(projectRoot, false);
  if (!key) throw new Error('policy-trust-key-missing');
  const record = JSON.parse(readFileSync(anchor, 'utf8')) as { authentication?: string };
  const expected = stateAuthentication(state, key);
  const actual = record.authentication ?? '';
  if (!/^[a-f0-9]{64}$/.test(actual)
    || !timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))) {
    throw new Error('policy-state-authentication-failed');
  }
}

async function writePolicyState(
  projectRoot: string,
  statePath: string,
  state: PolicyState,
  anchorEvent: AnchorEvent = 'append',
  by?: string,
  assessedTip?: AnchorEntry,
): Promise<void> {
  await writePolicyStateFiles(projectRoot, statePath, state);
  // #3602: the second anchor is written after the state, so a crash leaves the
  // state AHEAD of the log (caught up on the next write), never behind it.
  await recordAnchor(projectRoot, state, writeJsonAtomic, anchorEvent, by, writeJsonAtomic, assessedTip);
  // ADR-404: the ruflo mod reads Claude Code tool rules from a small
  // projection, never from state.json. Written only after the state and its
  // anchor are safely down; a failure here never fails the state write. A
  // projection left stale by such a failure can only tighten, never loosen,
  // a Claude Code verdict (the mod merges with `stricter`).
  try {
    syncPolicyProjection(projectRoot, state);
  } catch (error) {
    process.stderr.write(`[policy] claude-code projection not written: ${(error as Error).message}\n`);
  }
}

async function writePolicyStateFiles(projectRoot: string, statePath: string, state: PolicyState): Promise<void> {
  const anchorPath = trustPaths(projectRoot).anchor;
  if (state.mode === 'enforce' || existsSync(anchorPath)) {
    const key = trustKey(projectRoot, true)!;
    const anchor = {
      version: 1,
      projectRoot: realpathSync(projectRoot),
      mode: state.mode,
      authentication: stateAuthentication(state, key),
      updatedAt: Date.now(),
    };
    // On first enforcement, establish the external trust record first. A
    // crash then leaves either a valid pair or an anchored mismatch that
    // fails closed; it can never leave enforce state silently unanchored.
    if (!existsSync(anchorPath)) {
      await writeJsonAtomic(anchorPath, anchor);
      await writeJsonAtomic(statePath, state);
      return;
    }
    await writeJsonAtomic(statePath, state);
    await writeJsonAtomic(anchorPath, anchor);
    return;
  }
  await writeJsonAtomic(statePath, state);
}

function detectLegacyCapabilities(projectRoot: string): string {
  const candidates = [
    '.swarm/memory.db',
    '.claude-flow/memory.db',
    '.claude-flow/data/memory.db',
    'agentdb.rvf',
    'agentdb-memory.db',
  ];
  const found = candidates.filter((candidate) => existsSync(join(projectRoot, candidate)));
  const flags = [
    process.env.CLAUDE_FLOW_STRICT_AUTH === 'true' ? 'strict-auth' : null,
    process.env.CLAUDE_FLOW_STRICT_MEMORY === 'true' ? 'strict-memory' : null,
  ].filter(Boolean);
  return `pre-ADR-324; capabilities=${[...found, ...flags].join(',') || 'none-detected'}`;
}

function configuredPolicyMode(projectRoot: string): PolicyState['mode'] | undefined {
  let configured: PolicyState['mode'] | undefined;
  for (const relative of ['.agents/config.toml', '.codex/config.toml']) {
    const file = join(resolve(projectRoot), relative);
    if (!existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    const section = content.match(/(?:^|\n)\[policy\]\s*\n([\s\S]*?)(?=\n\[[^\]]+\]|\s*$)/)?.[1];
    const mode = section?.match(/(?:^|\n)\s*mode\s*=\s*"(legacy|observe|enforce)"/)?.[1];
    if (mode) configured = mode as PolicyState['mode'];
  }
  return configured;
}

export function loadPolicyState(projectRoot = process.cwd()): PolicyState {
  const target = paths(projectRoot);
  if (!existsSync(target.state)) {
    verifyStateAnchor(projectRoot, undefined);
    return createLegacyCompatibleState(detectLegacyCapabilities(projectRoot));
  }
  const parsed = JSON.parse(readFileSync(target.state, 'utf8')) as PolicyState;
  if ((parsed.version !== 1 && parsed.version !== POLICY_STATE_VERSION) || !Array.isArray(parsed.rules) || !Array.isArray(parsed.receipts)) {
    throw new Error(`unsupported-policy-state-version:${String(parsed.version)}`);
  }
  verifyStateAnchor(projectRoot, parsed);
  return parsed;
}

export async function autoMigratePolicyStateIfNeeded(projectRoot = process.cwd()): Promise<{
  migrated: boolean;
  statePath?: string;
  mode?: PolicyState['mode'];
}> {
  const target = paths(projectRoot);
  if (existsSync(target.state)) {
    const configured = configuredPolicyMode(projectRoot);
    const current = loadPolicyState(projectRoot);
    if (configured && current.configuredMode !== configured) {
      await withPolicyTransaction(projectRoot, (engine) => engine.setConfiguredMode(configured));
    }
    return { migrated: false, statePath: target.state, mode: loadPolicyState(projectRoot).mode };
  }
  // Only upgrade existing Ruflo installations. A random directory should not
  // acquire policy state merely because `ruflo --version` ran there.
  if (!existsSync(join(resolve(projectRoot), '.claude-flow'))
    && !existsSync(join(resolve(projectRoot), '.swarm'))) return { migrated: false };
  mkdirDurably(target.dir);
  const release = await acquireLock(target.lock);
  try {
    if (!existsSync(target.state)) {
      const state = createLegacyCompatibleState(detectLegacyCapabilities(projectRoot));
      const configured = configuredPolicyMode(projectRoot);
      if (configured) {
        state.mode = configured;
        state.configuredMode = configured;
      }
      await writePolicyState(projectRoot, target.state, state);
    }
  } finally {
    release();
  }
  return { migrated: true, statePath: target.state, mode: loadPolicyState(projectRoot).mode };
}

export async function withPolicyTransaction<T>(
  projectRoot: string,
  operation: (engine: AgenticPolicyEngine) => T | Promise<T>,
  options: {
    approvalIssuerVerifier?: (issuer: string) => boolean;
  } = {},
): Promise<T> {
  const target = paths(projectRoot);
  mkdirDurably(target.dir);
  const release = await acquireLock(target.lock);
  try {
    reapOrphanedPolicyTemps(projectRoot);
    const loaded = loadPolicyState(projectRoot);
    const engine = AgenticPolicyEngine.fromState(loaded, {
      signingKey: process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY,
      keyId: process.env.CLAUDE_FLOW_POLICY_KEY_ID,
      evidenceVerifier: verifyPolicyEvidence,
      approvalIssuerVerifier: options.approvalIssuerVerifier,
    });
    // #3602: refuse to operate on a ledger whose anchors are missing or
    // disagree; a restored primary anchor is persisted by the write below.
    const gate = reconcileLedger(projectRoot, engine, {});
    if (!gate.result.valid) {
      throw new Error(gate.result.error === 'anchor-missing'
        ? `policy-ledger-anchor-missing: receipts exist but no ledger anchor was found. If this ledger predates anchors, run \`ruflo policy verify --establish-anchor\`; otherwise treat it as tampering.`
        : gate.result.error ?? 'policy-ledger-verification-failed');
    }
    const result = await operation(engine);
    const verified = engine.verifyLedger();
    if (!verified.valid) throw new Error('policy-ledger-verification-failed');
    // Only archive the prefix already committed in loaded state. Archiving
    // newly generated receipts before their first state publication would
    // leave conflicting same-sequence records when a failed operation is
    // retried with a different timestamp/request. Retention=0 and large
    // batches therefore retain this transaction's new receipts until a
    // subsequent transaction can archive their exact committed bytes.
    const newlyAppended = verified.length - ((loaded.retainedFrom ?? 0) + loaded.receipts.length);
    const pruned = engine.pruneReceipts(Math.max(ledgerRetention(), newlyAppended));
    // #3164: archive BEFORE writing the shrunk state. If the process crashes
    // between the two writes, the archive append already landed but
    // `retainedFrom` on disk still reflects the pre-prune length, so the next
    // prune recomputes and re-appends the SAME receipts — a harmless,
    // detectable duplicate (same sequence, identical content), deduped by
    // `verifyPolicyLedger({ full: true })`. The reverse order (state first)
    // would instead risk a permanent gap if the process died in between,
    // which is strictly worse for an audit ledger — never reorder this.
    if (pruned.length > 0) {
      appendArchiveDurably(target.archive, pruned, engine);
    }
    const nextState = engine.exportState();
    await writePolicyState(projectRoot, target.state, nextState, gate.event, undefined, gate.anchorTip);
    return result;
  } finally {
    release();
  }
}

function verifyPolicyEvidence(evidence: PolicyEvidence): boolean {
  if (!evidence.keyId || !evidence.contentHash || !evidence.signature) return false;
  let keys: Record<string, string>;
  try {
    keys = JSON.parse(process.env.CLAUDE_FLOW_POLICY_EVIDENCE_KEYS ?? '{}') as Record<string, string>;
  } catch {
    return false;
  }
  const key = keys[evidence.keyId];
  if (!key || key.length < 16 || !/^sha256:[a-f0-9]{64}$/i.test(evidence.contentHash)) return false;
  const signedClaims = JSON.stringify({
    id: evidence.id,
    provenance: evidence.provenance,
    attestor: evidence.attestor,
    observedAt: evidence.observedAt,
    contentHash: evidence.contentHash,
    keyId: evidence.keyId,
  });
  const expected = createHmac('sha256', key).update(signedClaims).digest('hex');
  const provided = evidence.signature.replace(/^hmac-sha256:/, '');
  if (!/^[a-f0-9]{64}$/i.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
}

export async function evaluatePolicyRequest(
  request: PolicyRequest,
  projectRoot = process.cwd(),
): Promise<PolicyDecision> {
  return withPolicyTransaction(projectRoot, (engine) => engine.evaluate(request));
}

export async function setPolicyMode(mode: PolicyState['mode'], projectRoot = process.cwd()): Promise<void> {
  return withPolicyTransaction(projectRoot, (engine) => engine.setMode(mode));
}

export async function upsertPolicyRule(rule: PolicyRule, projectRoot = process.cwd()): Promise<void> {
  return withPolicyTransaction(projectRoot, (engine) => engine.upsertRule(rule));
}

export async function setPolicyBudget(limit: BudgetLimit, projectRoot = process.cwd()): Promise<void> {
  return withPolicyTransaction(projectRoot, (engine) => engine.setBudget(limit));
}

export async function issuePolicyApproval(
  approval: Omit<PolicyApproval, 'uses' | 'issuedAt'> & { uses?: number; issuedAt?: number },
  projectRoot = process.cwd(),
  approvalIssuerVerifier?: (issuer: string) => boolean,
): Promise<PolicyApproval> {
  return withPolicyTransaction(
    projectRoot,
    (engine) => engine.issueApproval(approval),
    { approvalIssuerVerifier },
  );
}

export async function revokePolicyApproval(id: string, projectRoot = process.cwd()): Promise<boolean> {
  return withPolicyTransaction(projectRoot, (engine) => engine.revokeApproval(id));
}

export type PolicyLedgerVerification = ReturnType<AgenticPolicyEngine['verifyLedger']> & {
  /** How the second anchor was brought in line during this call. */
  secondaryAnchor?: 'recorded-from-state' | 'restored-primary' | 'established-explicitly';
};

interface Reconciled {
  result: PolicyLedgerVerification;
  persist: boolean;
  event?: AnchorEvent;
  anchorTip?: AnchorEntry;
}

/**
 * Decide whether the ledger may be trusted, using the chain, the primary anchor
 * in state.json and the second anchor (#3602). It never creates an anchor over
 * existing receipts on its own: only an authentic second anchor (restoring a
 * deleted primary) or an explicit `establishAnchor` does.
 */
function reconcileLedger(
  projectRoot: string,
  engine: AgenticPolicyEngine,
  options: { establishAnchor?: boolean },
): Reconciled {
  const state = engine.exportState();
  // #3164: the historical length includes anything pruned out of the hot
  // array — `length` here must keep meaning "total receipts ever issued".
  const length = (state.retainedFrom ?? 0) + state.receipts.length;
  const primary = typeof state.ledgerLength === 'number';
  const base = engine.verifyLedger();
  const fail = (error: string): Reconciled => ({ result: { valid: false, length, error }, persist: false });
  if (!base.valid && base.error !== 'anchor-missing') return { result: base, persist: false };
  const assessed = assessAnchors(projectRoot, state, options.establishAnchor === true);
  if (assessed.kind === 'fail') return fail(assessed.error);
  if (primary) {
    if (assessed.kind === 'absent' && length > 0) {
      return options.establishAnchor
        ? { result: { ...base, secondaryAnchor: 'established-explicitly' }, persist: true, event: 'establish-anchor' }
        : { result: { ...base, secondaryAnchor: 'recorded-from-state' }, persist: true, event: 'migrated-from-state' };
    }
    return { result: base, persist: assessed.kind === 'ok' && assessed.behind, event: 'append', anchorTip: assessed.kind === 'ok' ? assessed.last : undefined };
  }
  // No primary anchor.
  if (length === 0) return { result: { valid: true, length, state: 'empty' }, persist: false };
  if (assessed.kind === 'ok') {
    // The second anchor is authentic and agrees with the chain: the deleted
    // primary can be restored from it. Truncation was already rejected above.
    engine.verifyLedger({ establishAnchor: true });
    return { result: { valid: true, length, secondaryAnchor: 'restored-primary' }, persist: true, event: 'append', anchorTip: assessed.last };
  }
  if (options.establishAnchor) {
    const established = engine.verifyLedger({ establishAnchor: true });
    return {
      result: { ...established, secondaryAnchor: 'established-explicitly' },
      persist: true,
      event: 'establish-anchor',
    };
  }
  return fail('anchor-missing');
}

/**
 * Verification (#3568, #3602). It must not run inside `withPolicyTransaction`,
 * whose own post-operation check throws a generic
 * `policy-ledger-verification-failed` and hides which check failed. It writes
 * only to bring the second anchor in line, or on an explicit `establishAnchor`.
 */
export async function verifyPolicyLedger(
  projectRoot = process.cwd(),
  options: { establishAnchor?: boolean; full?: boolean } = {},
): Promise<PolicyLedgerVerification> {
  const target = paths(projectRoot);
  mkdirDurably(target.dir);
  const engineOptions = {
    signingKey: process.env.CLAUDE_FLOW_POLICY_SIGNING_KEY,
    keyId: process.env.CLAUDE_FLOW_POLICY_KEY_ID,
  };
  let outcomeResult: PolicyLedgerVerification;
  let snapshotState: PolicyState;
  let archiveSnapshot: ArchiveSnapshot | undefined;
  // Capture the verified hot state and a checked regular archive descriptor
  // plus immutable byte boundary under the writer lock. Historical read,
  // authentication, deduplication and replay all happen after release, using
  // bounded chunks and private disposable disk scratch instead of O(history)
  // strings, receipt arrays or maps. The descriptor pins path replacements.
  const release = await acquireLock(target.lock);
  try {
    reapOrphanedPolicyTemps(projectRoot);
    const engine = AgenticPolicyEngine.fromState(loadPolicyState(projectRoot), engineOptions);
    const outcome = reconcileLedger(projectRoot, engine, options);
    if (outcome.persist) {
      const by = outcome.event === 'establish-anchor' ? userInfo().username : undefined;
      await writePolicyState(projectRoot, target.state, engine.exportState(), outcome.event, by, outcome.anchorTip);
    }
    outcomeResult = outcome.result;
    snapshotState = engine.exportState();
    if (options.full && outcomeResult.valid) {
      try { archiveSnapshot = captureArchiveSnapshot(target.archive); }
      catch (error) { outcomeResult = { valid: false, length: outcomeResult.length, error: (error as Error).message }; }
    }
  } finally {
    release();
  }
  if (!options.full || !outcomeResult.valid) return outcomeResult;
  try {
    const full = await verifyFullPolicyLedger(archiveSnapshot, snapshotState, engineOptions);
    return { ...full, secondaryAnchor: outcomeResult.secondaryAnchor };
  } finally { if (archiveSnapshot !== undefined) closeSync(archiveSnapshot.fd); }
}

/**
 * Resolve the caller identity for `authorizeMcpTool`.
 *
 * ADR-377 Phase 3 (dream-cycle candidate, 2026-08-26) — off by default. By
 * default (`isMcpCallerAuthEnabled()` false), this reproduces the exact
 * pre-existing two-line behavior: the plain, unsigned `CLAUDE_FLOW_PRINCIPAL_ID`
 * env var is trusted outright. That is the byte-identical-when-disabled
 * requirement for this candidate — nothing about this branch's shape or
 * output changes when the flag is off.
 *
 * When the flag is on, `CLAUDE_FLOW_PRINCIPAL_ID` alone is no longer
 * sufficient — any process can set an arbitrary env var with zero proof.
 * Instead this requires (and verifies) an Ed25519-signed `InvocationToken`
 * that only a private-key holder (the DualModeOrchestrator that spawned this
 * worker) could have minted, per `mcp-caller-identity.ts`. Missing, corrupt,
 * forged, or expired tokens fail closed — this function throws rather than
 * falling back to the unverified env var, matching the existing fail-closed
 * pattern already used above in this function (`invalid-worker-capability-envelope`,
 * `authoritative-worker-policy-root-unavailable`).
 *
 * Scope trade-off (deliberate — see mcp-caller-identity.ts's file header and
 * orchestrator.ts's `workerEnvironment` for the fuller rationale): the token
 * is minted once per worker spawn with a worker-lifetime TTL and a wildcard
 * `toolName: '*'`, not the single-tool, 30s-TTL shape `InvocationToken` was
 * originally designed for — so `opts.toolName` is deliberately not passed to
 * `verifyInvocationToken` here, and the tool-mismatch check is not exercised
 * for this use case. What this retains: a process that never received the
 * signed token cannot forge one, so it cannot impersonate `agent:<workerId>`.
 * What it does NOT retain: a compromised worker process can still use its
 * own valid token for every MCP call for the rest of its lifetime — the
 * token does not limit blast radius to a single call.
 */
function resolveMcpCallerIdentity(): { id: string; type: 'agent' | 'legacy' } {
  if (!isMcpCallerAuthEnabled()) {
    return {
      id: process.env.CLAUDE_FLOW_PRINCIPAL_ID ?? 'legacy-cli',
      type: process.env.CLAUDE_FLOW_PRINCIPAL_ID ? 'agent' : 'legacy',
    };
  }

  const encodedToken = process.env.CLAUDE_FLOW_MCP_INVOCATION_TOKEN;
  const publicKeyHex = process.env.CLAUDE_FLOW_MCP_CALLER_PUBKEY;
  if (!encodedToken || !publicKeyHex) {
    throw new Error('mcp-caller-auth-enabled-but-no-token');
  }

  const token = decodeTokenEnvelope(encodedToken);
  if (!token) {
    throw new Error('mcp-caller-auth-enabled-but-no-token');
  }

  let publicKey;
  try {
    publicKey = publicKeyFromHex(publicKeyHex);
  } catch {
    throw new Error('mcp-caller-auth-enabled-but-no-token');
  }

  const result = verifyInvocationToken(token, publicKey, {});
  if (!result.valid) {
    throw new Error(`mcp-caller-auth-verification-failed:${result.reason}`);
  }

  return { id: token.callerId, type: 'agent' };
}

export async function authorizeMcpTool(
  toolName: string,
  input: Record<string, unknown>,
  context: Record<string, unknown> = {},
  attributes: Readonly<{
    actionType?: string;
    network?: boolean;
    destructive?: boolean;
    namespaceAccess?: 'read' | 'write';
    envelope?: CapabilityEnvelope;
    costUsd?: number;
    tokens?: number;
    concurrency?: number;
  }> = {},
): Promise<PolicyDecision> {
  let projectRoot = typeof context.projectRoot === 'string' ? context.projectRoot : process.cwd();
  let processEnvelope: CapabilityEnvelope | undefined;
  if (process.env.CLAUDE_FLOW_CAPABILITY_ENVELOPE) {
    try {
      const parsed = JSON.parse(process.env.CLAUDE_FLOW_CAPABILITY_ENVELOPE) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      processEnvelope = parsed as CapabilityEnvelope;
    } catch {
      throw new Error('invalid-worker-capability-envelope');
    }
    // Linked git worktrees share one immutable common git directory. Derive
    // the coordinator checkout from that directory so a worker cannot fall
    // back to independent legacy policy state in its isolated worktree.
    try {
      const cwd = realpathSync(process.cwd());
      const common = execFileSync(
        'git',
        ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      projectRoot = dirname(realpathSync(common));
    } catch {
      throw new Error('authoritative-worker-policy-root-unavailable');
    }
  }
  return evaluatePolicyRequest({
    identity: resolveMcpCallerIdentity(),
    action: {
      type: attributes.actionType ?? 'mcp.tool.call',
      resource: toolName,
      tool: toolName,
      server: typeof context.serverId === 'string' ? context.serverId : 'ruflo',
      namespace: typeof input.namespace === 'string' ? input.namespace : undefined,
      environment: typeof context.environment === 'string' ? context.environment : undefined,
      costUsd: attributes.costUsd,
      tokens: attributes.tokens,
      concurrency: attributes.concurrency,
      network: attributes.network === true,
      destructive: attributes.destructive === true,
    },
    context: {
      envelope: attributes.envelope ?? processEnvelope,
      approvalIds: Array.isArray(context.approvalIds) ? context.approvalIds.map(String) : undefined,
      evidence: Array.isArray(context.evidence) ? context.evidence as PolicyEvidence[] : undefined,
      metadata: {
        inputDigest: `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`,
      },
    },
  }, projectRoot);
}

/** Trusted classification derived from the registered tool name, never input. */
export function classifyMcpTool(toolName: string): {
  actionType: string;
  network: boolean;
  destructive: boolean;
  namespaceAccess?: 'read' | 'write';
} {
  const normalized = toolName.toLowerCase();
  const policyAdmin = normalized.startsWith('policy_')
    && !['policy_evaluate', 'policy_status'].includes(normalized);
  const memoryRead = /^(?:memory|agentdb)_(?:pattern-)?(?:search|query|get|retrieve|list|status|stats)/.test(normalized);
  const memoryWrite = /^(?:memory|agentdb)_(?:pattern-)?(?:store|insert|update|delete|clear|purge|init)/.test(normalized);
  const terminal = /^(?:terminal_execute|bash|shell|exec)/.test(normalized);
  const destructive = policyAdmin
    || terminal
    || /(delete|remove|clear|purge|revoke|promote|deploy|integrate|cleanup|terminate|stop)/.test(normalized);
  const network = terminal
    || /(github|browser|web_|http_|fetch|managed_agent|federation|ipfs|openrouter|provider)/.test(normalized);
  return {
    actionType: policyAdmin
      ? `policy.admin.${normalized.slice('policy_'.length)}`
      : memoryRead
        ? 'memory.read'
        : memoryWrite
          ? 'memory.write'
          : 'mcp.tool.call',
    network,
    destructive,
    namespaceAccess: memoryRead ? 'read' : memoryWrite ? 'write' : undefined,
  };
}
