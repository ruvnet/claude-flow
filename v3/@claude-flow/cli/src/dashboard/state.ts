/** Local connector state: ~/.ruflo/dashboard (0700), key file (0600), config, persisted sequence counters, audit log. */
import { appendFileSync, statSync, chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { fromB64u, LEVELS, sanitize } from './protocol/index.js';

export const KEY_FILE = 'device.key';
export const CONFIG_FILE = 'config.json';
export const DEVICE_SEQ_FILE = 'device-seq.json';
export const SERVER_SEQ_FILE = 'server-seq.json';
export const AUDIT_FILE = 'audit.jsonl';
/** Rotate at 5 MiB, keeping audit.jsonl.1 .. .3 (oldest dropped). */
export const AUDIT_MAX_BYTES = 5 * 1024 * 1024;
export const AUDIT_KEEP = 3;
/** Sequence numbers are reserved in blocks so a crash can never reuse one (we resume from the reserved high-water mark). */
export const SEQ_BLOCK = 100;

const isPosix = process.platform !== 'win32';
export class StateError extends Error { constructor(public code: string, message: string) { super(message); this.name = 'StateError'; } }

export const stateDir = (override?: string): string => override ?? process.env.RUFLO_DASHBOARD_HOME ?? join(homedir(), '.ruflo', 'dashboard');

/** https only; plain http solely for loopback hosts (tests / local development). Returns the bare origin. */
export function normalizeBaseUrl(raw: string): string {
  let u: URL;
  try { u = new URL(raw); } catch { throw new StateError('bad_url', 'base URL is not a valid URL'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) throw new StateError('insecure_url', 'base URL must be https (http is allowed only for 127.0.0.1/localhost)');
  if (u.username || u.password) throw new StateError('bad_url', 'base URL must not embed credentials');
  return u.origin;
}

export const ConfigSchema = z.object({
  baseUrl: z.string().max(300),
  connectUrl: z.string().max(400),
  deviceId: z.string().regex(/^dev_[A-Za-z0-9_-]{16,64}$/),
  tenantId: z.string().regex(/^tnt_[A-Za-z0-9_-]{16,64}$/),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  serverPublicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  level: z.enum(LEVELS).default('read'),
  autoApprove: z.boolean().default(false),
  enabled: z.boolean().default(false),
  name: z.string().max(80).default('ruflo'),
  /** Project directory ruflo is run in (collectors + executors). Defaults to the directory `run` is started in. */
  projectDir: z.string().max(1024).optional(),
  /** argv prefix that launches ruflo; default resolves `ruflo` on PATH, else a pinned npx. */
  /** Absolute path of the cost-tracker ledger script to run (user-chosen; must be owned by you, not group/world-writable, outside the project). */
  ledgerPath: z.string().max(1024).optional(),
  /** Cost privacy. Default 'coarse': the dashboard gets a spend bucket and nothing else. Only the person, here, can choose 'full' (`set --cost-detail full`); no command, section or plugin option reaches this. */
  cost: z.object({ detail: z.enum(['coarse', 'full']).default('coarse') }).strict().optional(),
  /** Sources a marketplace named `ruflo` may have, as "github:owner/repo" or "directory:/abs/path" (default github:ruvnet/ruflo). Checked against known_marketplaces.json when Claude Code records one. */
  marketplaceSources: z.array(z.string().max(300)).max(10).optional(),
  rufloCommand: z.array(z.string().max(300)).max(8).optional(),
}).strict();
export type Config = z.infer<typeof ConfigSchema>;

export function ensureDir(home: string): void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (isPosix) chmodSync(home, 0o700);
}

/** Atomic write with an explicit mode (temp file in the same dir, then rename). */
export function writeSecure(home: string, name: string, data: string, mode = 0o600): void {
  ensureDir(home);
  const tmp = join(home, `.${name}.${process.pid}.tmp`);
  writeFileSync(tmp, data, { mode, flag: 'w' });
  if (isPosix) chmodSync(tmp, mode);
  renameSync(tmp, join(home, name));
}

export function loadConfig(home: string): Config | null {
  const p = join(home, CONFIG_FILE);
  if (!existsSync(p)) return null;
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(p, 'utf8')); } catch { throw new StateError('bad_config', 'config.json is not valid JSON'); }
  const r = ConfigSchema.safeParse(raw);
  if (!r.success) throw new StateError('bad_config', 'config.json failed validation');
  normalizeBaseUrl(r.data.baseUrl);
  return r.data;
}
export const saveConfig = (home: string, c: Config): void => writeSecure(home, CONFIG_FILE, JSON.stringify(ConfigSchema.parse(c), null, 2) + '\n');

export function saveKey(home: string, privateKey: string): void { writeSecure(home, KEY_FILE, privateKey + '\n', 0o600); }

/** Refuses a key file that is not a regular file owned by us, or is group/world accessible. */
export function loadKey(home: string): string {
  const p = join(home, KEY_FILE);
  let fd: number;
  try { fd = openSync(p, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch { throw new StateError('no_key', 'device key not found (not linked?)'); }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new StateError('bad_key', 'device key is not a regular file');
    if (isPosix) {
      if ((st.mode & 0o077) !== 0) throw new StateError('insecure_key_permissions', `device key is accessible by group/other (mode ${(st.mode & 0o777).toString(8)}); chmod 600 it or re-link`);
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new StateError('insecure_key_owner', 'device key is not owned by the current user');
    }
    const key = readFileSync(fd, 'utf8').trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(key) || fromB64u(key).length !== 32) throw new StateError('bad_key', 'device key is malformed');
    return key;
  } finally { closeSync(fd); }
}

/** Remove key, config and counters (revoke / unlink). The audit log is kept. */
export function wipeState(home: string): void {
  for (const f of [KEY_FILE, CONFIG_FILE, DEVICE_SEQ_FILE, SERVER_SEQ_FILE]) rmSync(join(home, f), { force: true });
}

function readSeq(home: string, file: string): number {
  try { const n = (JSON.parse(readFileSync(join(home, file), 'utf8')) as { seq?: unknown }).seq; return Number.isSafeInteger(n) && (n as number) >= 0 ? (n as number) : 0; } catch { return 0; }
}

/** Strictly increasing device->server sequence, surviving restarts via block reservation. */
export class DeviceSeq {
  private next: number; private reservedTo: number;
  constructor(private home: string) { this.next = readSeq(home, DEVICE_SEQ_FILE) + 1; this.reservedTo = this.next - 1; }
  take(): number {
    if (this.next > this.reservedTo) { this.reservedTo = this.next + SEQ_BLOCK - 1; writeSecure(this.home, DEVICE_SEQ_FILE, JSON.stringify({ seq: this.reservedTo })); }
    return this.next++;
  }
}
export const loadServerSeq = (home: string): number => readSeq(home, SERVER_SEQ_FILE);
export const saveServerSeq = (home: string, seq: number): void => writeSecure(home, SERVER_SEQ_FILE, JSON.stringify({ seq }));

/** Append-only audit log; entries are sanitized (secrets masked) and capped. Never contains keys. */
export class AuditLog {
  constructor(private home: string, private now: () => number = Date.now) {}
  write(kind: string, fields: Record<string, unknown> = {}): void {
    ensureDir(this.home);
    const line = JSON.stringify(sanitize({ at: this.now(), kind, ...fields }));
    const p = join(this.home, AUDIT_FILE);
    this.rotate(p);
    const fresh = !existsSync(p);
    appendFileSync(p, (line.length > 4000 ? JSON.stringify({ at: this.now(), kind, truncated: true }) : line) + '\n', { mode: 0o600 });
    if (fresh && isPosix) chmodSync(p, 0o600);
  }
  private rotate(p: string): void {
    try { if (statSync(p).size < AUDIT_MAX_BYTES) return; } catch { return; }
    rmSync(`${p}.${AUDIT_KEEP}`, { force: true });
    for (let i = AUDIT_KEEP - 1; i >= 1; i--) if (existsSync(`${p}.${i}`)) renameSync(`${p}.${i}`, `${p}.${i + 1}`);
    renameSync(p, `${p}.1`);
  }
}
