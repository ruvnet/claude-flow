/**
 * Version-stamped critical-helper auto-refresh.
 *
 * The Claude Code hooks run the PROJECT-LOCAL `.claude/helpers/*.cjs` copies,
 * not the installed npm package — so `npx ruflo@latest` does NOT update them,
 * and users don't know to re-run `init`. This module stamps the helpers with
 * the installed CLI version and, on the next CLI command, silently re-copies
 * them when the stamp is stale. Hook fixes (e.g. the ADR-174 failure-capture
 * change) then propagate to every user on their next `ruflo` command with zero
 * action required.
 *
 * This file is intentionally LIGHTWEIGHT — it is imported on every CLI startup,
 * so it depends only on `fs`/`path`/`module` at load time and lazily imports the
 * heavy generators only on the rare fallback path (source dir unresolvable).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import * as semver from 'semver';
import {
  verifyHelpersManifest, sha256Hex, HELPERS_MANIFEST_FILE, type HelpersManifest,
} from './helper-signing.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from `startDir` to the nearest ancestor whose `package.json` names
 * `@claude-flow/cli` — depth-independent, unlike a hardcoded `'..','..',
 * '..'`. That fixed count assumed this module always runs compiled, three
 * levels under the package root (`dist/src/init/helper-refresh.js`); it
 * silently breaks whenever the module runs from a different depth — e.g.
 * loaded straight from `src/init/helper-refresh.ts` (one level shallower:
 * ts-node, tsx, or a test runner that transforms TS in place rather than
 * requiring a prior `tsc` build). When that happened here, BOTH
 * `getInstalledCliVersion()` silently fell back to the placeholder `'0.0.0'`
 * AND `findPackageHelpersDir()` silently failed to resolve the real package
 * helpers dir — with no error surfaced, just wrong values propagating into
 * version-comparison and refresh-source-selection logic. Real ceiling on the
 * walk (`maxUp`) so a package.json-less filesystem can't loop forever.
 */
function findPackageRoot(startDir: string, maxUp = 6): string | null {
  let dir = startDir;
  for (let i = 0; i < maxUp; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
      if (pkg && pkg.name === '@claude-flow/cli') return dir;
    } catch { /* no package.json here, or unreadable — keep climbing */ }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

export const HELPERS_STAMP_FILE = '.helpers-version';
export const HELPERS_REFRESH_LOCK_FILE = '.helpers-refresh.lock';
const DEFAULT_LOCK_WAIT_MS = 2_000;
const DEFAULT_LOCK_RETRY_MS = 10;
const DEFAULT_MALFORMED_LOCK_STALE_MS = 5 * 60_000;
let tempFileCounter = 0;
interface RefreshOptions {
  sourceDirOverride?: string;
  pubkeyPemOverride?: string;
  versionOverride?: string;
  alsoRefreshGlobal?: boolean;
  beforeWriteOverride?: () => void | Promise<void>;
  lockWaitMsOverride?: number;
  lockRetryMsOverride?: number;
  malformedLockStaleMsOverride?: number;
}

/**
 * ruflo-owned helpers that carry hook logic (or the render surface for the
 * funnel disclosure row) and must track the package version. Adding to this
 * list REQUIRES re-signing `helpers.manifest.json` at publish time — the
 * integrity gate below refuses any file it doesn't have a signed hash for.
 */
export const CRITICAL_HELPERS = [
  'auto-memory-hook.mjs',
  'hook-handler.cjs',
  'intelligence.cjs',
  // statusline.cjs is here so the funnel disclosure row (ADR-301) reaches
  // existing installs on the next `ruflo` command, not only fresh `ruflo init`.
  'statusline.cjs',
];

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== 'ESRCH';
  }
}

function removeAbandonedLock(lockPath: string, malformedStaleMs: number): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid?: unknown };
    if (Number.isSafeInteger(parsed.pid) && Number(parsed.pid) > 0) {
      if (processIsAlive(Number(parsed.pid))) return false;
      fs.unlinkSync(lockPath);
      return true;
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return true;
  }

  // A process can die after the exclusive create but before writing metadata.
  // Only reclaim such malformed locks after a generous age; valid locks with a
  // live PID are never age-evicted, so a slow refresh cannot lose ownership.
  try {
    if (Date.now() - fs.statSync(lockPath).mtimeMs >= malformedStaleMs) {
      fs.unlinkSync(lockPath);
      return true;
    }
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return true;
  }
  return false;
}

async function acquireRefreshLock(
  helpersDir: string,
  opts: RefreshOptions,
): Promise<(() => void) | null> {
  const lockPath = path.join(helpersDir, HELPERS_REFRESH_LOCK_FILE);
  const waitMs = opts.lockWaitMsOverride ?? DEFAULT_LOCK_WAIT_MS;
  const retryMs = opts.lockRetryMsOverride ?? DEFAULT_LOCK_RETRY_MS;
  const malformedStaleMs = opts.malformedLockStaleMsOverride ?? DEFAULT_MALFORMED_LOCK_STALE_MS;
  const deadline = Date.now() + Math.max(0, waitMs);

  while (true) {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let fd: number | undefined;
    let created = false;
    try {
      fd = fs.openSync(lockPath, 'wx');
      created = true;
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token }), 'utf-8');
      fs.closeSync(fd);
      fd = undefined;
      return () => {
        try {
          const current = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { token?: unknown };
          if (current.token === token) fs.unlinkSync(lockPath);
        } catch { /* best-effort release; a replaced lock is never removed */ }
      };
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch { /* best-effort */ }
      }
      if (created) {
        try { fs.unlinkSync(lockPath); } catch { /* best-effort */ }
      }
      if (errorCode(error) !== 'EEXIST') throw error;
      if (removeAbandonedLock(lockPath, malformedStaleMs)) continue;
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, retryMs)));
    }
  }
}

function temporarySiblingPath(target: string): string {
  tempFileCounter += 1;
  return `${target}.tmp-${process.pid}-${Date.now()}-${tempFileCounter}`;
}

function atomicCopyFileSync(source: string, target: string, mode?: string): void {
  const temporary = temporarySiblingPath(target);
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    if (mode) {
      try { fs.chmodSync(temporary, mode); } catch { /* non-fatal */ }
    }
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* already renamed or never created */ }
  }
}

function atomicWriteFileSync(target: string, content: string, mode?: string): void {
  const temporary = temporarySiblingPath(target);
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf-8', flag: 'wx' });
    if (mode) {
      try { fs.chmodSync(temporary, mode); } catch { /* non-fatal */ }
    }
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* already renamed or never created */ }
  }
}

/** Installed @claude-flow/cli version — the value the helpers are stamped with. */
export function getInstalledCliVersion(): string {
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(esmRequire.resolve('@claude-flow/cli/package.json'), 'utf-8'));
    return String(pkg.version || '0.0.0');
  } catch {
    const root = findPackageRoot(__dirname);
    if (!root) return '0.0.0';
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
      return String(pkg.version || '0.0.0');
    } catch { return '0.0.0'; }
  }
}

/** Locate the in-package `.claude/helpers` dir (the copy source). Null if not found. */
function findPackageHelpersDir(): string | null {
  const candidates: string[] = [];
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkgRoot = path.dirname(esmRequire.resolve('@claude-flow/cli/package.json'));
    candidates.push(path.join(pkgRoot, '.claude', 'helpers'));
  } catch { /* not resolvable */ }
  const root = findPackageRoot(__dirname);
  if (root) candidates.push(path.join(root, '.claude', 'helpers'));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'hook-handler.cjs'))) return c;
  }
  return null;
}

/**
 * Re-copy the critical helpers into `helpersDir` and stamp `version`.
 *
 * SECURITY (fail-closed): when copying from the installed package, every source
 * helper is verified against ruflo's Ed25519-signed manifest FIRST — nothing is
 * copied unless the manifest signature is valid AND each helper's SHA-256
 * matches. A tampered helper or manifest (e.g. a sibling package's postinstall
 * overwriting on-disk hook code) is REFUSED, not propagated. The generator
 * fallback needs no manifest — that content comes from the CLI's own compiled
 * code, which is already the trust root.
 */
async function writeCriticalHelpers(
  helpersDir: string,
  version: string,
  opts: { sourceDirOverride?: string; pubkeyPemOverride?: string } = {},
): Promise<{ wrote: boolean; blocked?: string }> {
  const source = opts.sourceDirOverride ?? findPackageHelpersDir();
  if (source) {
    // 1. Verify the signed manifest against the baked public key (or, in
    // tests, an injected throwaway key — see autoRefreshHelpersIfStale's
    // opts.pubkeyPemOverride doc comment for why that injection point
    // exists at all).
    let trusted: HelpersManifest | null = null;
    try {
      trusted = verifyHelpersManifest(
        fs.readFileSync(path.join(source, HELPERS_MANIFEST_FILE), 'utf-8'),
        opts.pubkeyPemOverride,
      );
    } catch { trusted = null; }
    if (!trusted) return { wrote: false, blocked: 'signed helpers manifest missing or signature invalid' };

    // 2. Verify EVERY source helper's hash before copying ANYTHING (atomic gate).
    const toCopy: string[] = [];
    for (const name of CRITICAL_HELPERS) {
      const sp = path.join(source, name);
      if (!fs.existsSync(sp)) continue;
      const expected = trusted.files[name];
      if (!expected || sha256Hex(fs.readFileSync(sp)) !== expected) {
        return { wrote: false, blocked: `integrity check failed for ${name} — refusing to install` };
      }
      toCopy.push(name);
    }

    // 3. All verified — copy, plus the signed manifest itself as an audit trail.
    let wrote = false;
    for (const name of toCopy) {
      const tp = path.join(helpersDir, name);
      atomicCopyFileSync(path.join(source, name), tp, '755');
      wrote = true;
    }
    try {
      atomicCopyFileSync(
        path.join(source, HELPERS_MANIFEST_FILE),
        path.join(helpersDir, HELPERS_MANIFEST_FILE),
      );
    } catch { /* non-fatal */ }
    if (wrote) {
      try { atomicWriteFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), version); } catch { /* non-fatal */ }
    }
    return { wrote };
  }

  // Fallback: source unresolvable (broken npx paths) — regenerate from the CLI's
  // OWN compiled generators (the trust root; no external file to verify).
  const gen = await import('./helpers-generator.js');
  const statusGen = await import('./statusline-generator.js');
  const files: Record<string, string> = {
    'hook-handler.cjs': gen.generateHookHandler(),
    'intelligence.cjs': gen.generateIntelligenceStub(),
    'auto-memory-hook.mjs': gen.generateAutoMemoryHook(),
    // Fallback needs the same generator inputs `ruflo init` uses. We match the
    // hardcoded default (maxAgents 15) because the fallback fires when the
    // installed package is unresolvable — no way to read the user's project
    // config from here. Fresh `ruflo init` still generates a per-project value.
    'statusline.cjs': statusGen.generateStatuslineScript({
      statusline: { enabled: true, style: 'compact' },
      runtime: { maxAgents: 15 },
    } as any),
  };
  let wrote = false;
  for (const [name, content] of Object.entries(files)) {
    const tp = path.join(helpersDir, name);
    atomicWriteFileSync(tp, content, '755');
    wrote = true;
  }
  if (wrote) {
    try { atomicWriteFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), version); } catch { /* non-fatal */ }
  }
  return { wrote };
}

/**
 * On CLI startup: if an initialized project's critical helpers are stamped older
 * than the installed CLI version, silently re-copy them. Fast path is a single
 * stamp read + string compare (sub-ms); the copy runs at most once per version
 * bump. Best-effort, never throws. No-op outside a ruflo project (requires an
 * existing hook-handler.cjs — never creates files in an unrelated directory).
 *
 * FORWARD-ONLY (never downgrades): refreshing on any mere INEQUALITY, rather
 * than only when the installed version is semver-NEWER, is a real corruption
 * vector — confirmed live: a stray/older installed binary (a stale `npx`
 * cache, a marketplace install lagging behind an unpublished dev-tree fix)
 * running `daemon start` (or any command) against THIS project directory
 * would see its own older version != the project's newer stamp and silently
 * overwrite hand-fixed `hook-handler.cjs`/`intelligence.cjs` with its own
 * older, already-superseded bundled copies. The semver guard is therefore
 * re-evaluated while holding a per-directory cross-process lock; otherwise
 * an older process can pass the guard first but finish writing last.
 *
 * `opts` exists for tests ONLY (mirrors daemon-autostart.ts's injectable
 * `SpawnDaemonFn` pattern): the real signed-copy path is otherwise coupled to
 * THIS repo's actual current `.claude/helpers` + its real Ed25519 signature —
 * fine for production (that coupling to the real source IS the point), but
 * it means a test exercising that path for real would only pass when this
 * repo's manifest happens to be currently re-signed, which is a separately-
 * gated, occasionally-stale publish-time step. `sourceDirOverride` +
 * `pubkeyPemOverride` let a test build its own tiny, throwaway-keypair-
 * signed fixture and get real, deterministic coverage of the verify → hash →
 * copy logic without depending on that.
 */
async function refreshOneHelpersDirLocked(
  helpersDir: string,
  version: string,
  opts: RefreshOptions,
): Promise<{ refreshed: boolean; from?: string; to?: string; blocked?: string }> {
  if (!fs.existsSync(path.join(helpersDir, 'hook-handler.cjs'))) return { refreshed: false };

  // .LOCKED marker: users developing ruflo itself (or any project with
  // hand-maintained helpers) can place a `.LOCKED` file at
  // `.claude/helpers/.LOCKED` to opt out of auto-refresh entirely. Fixes the
  // observed-live concurrent-session clobber where a sibling Claude Code
  // session running a stale cached CLI would overwrite hand-edited helpers
  // on this repo (CLAUDE.md "Concurrent-session helper corruption"). The
  // existing semver.gte guard below still fires for normal installs — this
  // is the escape hatch for the small set of users editing helpers directly.
  // Applies to whichever dir this call is refreshing (project or global).
  if (fs.existsSync(path.join(helpersDir, '.LOCKED'))) {
    return { refreshed: false, blocked: '.LOCKED marker present — refresh skipped (delete to re-enable)' };
  }

  let stamped = '';
  try { stamped = fs.readFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), 'utf-8').trim(); } catch { /* pre-feature: unstamped */ }
  if (stamped === version) return { refreshed: false }; // up to date — fast path
  if (stamped && semver.valid(stamped) && semver.valid(version) && semver.gte(stamped, version)) {
    // Stamped version is already >= what this binary reports — refreshing
    // would silently DOWNGRADE the helpers. Skip, untouched.
    return { refreshed: false };
  }
  await opts.beforeWriteOverride?.();
  const res = await writeCriticalHelpers(helpersDir, version, {
    sourceDirOverride: opts.sourceDirOverride,
    pubkeyPemOverride: opts.pubkeyPemOverride,
  });
  if (res.blocked) return { refreshed: false, blocked: res.blocked };
  return res.wrote ? { refreshed: true, from: stamped || '(unstamped)', to: version } : { refreshed: false };
}

async function refreshOneHelpersDir(
  helpersDir: string,
  version: string,
  opts: RefreshOptions,
): Promise<{ refreshed: boolean; from?: string; to?: string; blocked?: string }> {
  if (!fs.existsSync(path.join(helpersDir, 'hook-handler.cjs'))) return { refreshed: false };
  // Respect the repository opt-out before creating even a transient lock file
  // in a directory whose helpers are intentionally maintained by hand. Keep
  // the check in the locked path too in case the marker appears while waiting.
  if (fs.existsSync(path.join(helpersDir, '.LOCKED'))) {
    return { refreshed: false, blocked: '.LOCKED marker present — refresh skipped (delete to re-enable)' };
  }
  try { if (fs.readFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), 'utf-8').trim() === version) return { refreshed: false }; }
  catch { /* unstamped: continue to the locked path */ }

  const releaseLock = await acquireRefreshLock(helpersDir, opts);
  if (!releaseLock) return { refreshed: false, blocked: 'helper refresh already in progress' };

  try {
    // Re-read the stamp and .LOCKED marker under the cross-process lock. A
    // concurrent newer CLI may have completed while this caller waited.
    return await refreshOneHelpersDirLocked(helpersDir, version, opts);
  } finally {
    releaseLock();
  }
}

/**
 * On CLI startup, refresh critical helpers if their stamp is older than the
 * installed CLI version. Two passes:
 *
 * 1. **Project pass** — `<cwd>/.claude/helpers/`. Always attempted. The
 *    original behavior; project statuslines pin to a stamp per repo.
 *
 * 2. **Global pass** — `~/.claude/helpers/`. Opt-in via `alsoRefreshGlobal`.
 *    Fixes the "promo row missing on remote installs" bug: `ruflo init`
 *    writes helpers to `~/.claude/helpers/` too so Claude Code's global
 *    settings.json statusLine can fall back to them (executor.ts:460-462),
 *    but nothing ever REFRESHED that global copy — so any install predating
 *    a helpers change (e.g. the 2026-07-13 funnel/promo Line-3 addition)
 *    stayed frozen at the pre-feature statusline forever, even after `npm
 *    i -g @claude-flow/cli@latest`. The global pass fixes that on the next
 *    `ruflo <anything>` invocation. Same forward-only `semver.gte` guard
 *    protects against downgrade by a stale cached CLI.
 *
 *    `alsoRefreshGlobal` defaults FALSE so tests don't touch the developer's
 *    real `~/.claude/helpers/`. The real CLI entry (src/index.ts) passes
 *    `true` to activate the global pass in production.
 *
 * Best-effort, never throws. No-op for a helpers dir that doesn't already
 * contain a `hook-handler.cjs` — never creates files in an unrelated dir.
 *
 * FORWARD-ONLY (never downgrades): refreshing on any mere INEQUALITY, rather
 * than only when the installed version is semver-NEWER, is a real corruption
 * vector — confirmed live: a stray/older installed binary (a stale `npx`
 * cache, a marketplace install lagging behind an unpublished dev-tree fix)
 * running `daemon start` (or any command) would see its own older version !=
 * the project's newer stamp and silently overwrite hand-fixed
 * `hook-handler.cjs`/`intelligence.cjs` with its own older, already-superseded
 * bundled copies. The semver guard is therefore re-evaluated while holding a
 * per-directory cross-process lock; otherwise an older process can pass the
 * guard first but finish writing last.
 *
 * `opts` exists for tests ONLY (mirrors daemon-autostart.ts's injectable
 * `SpawnDaemonFn` pattern): the real signed-copy path is otherwise coupled
 * to THIS repo's actual current `.claude/helpers` + its real Ed25519
 * signature — fine for production (that coupling to the real source IS the
 * point), but it means a test exercising that path for real would only pass
 * when this repo's manifest happens to be currently re-signed, which is a
 * separately-gated, occasionally-stale publish-time step. `sourceDirOverride`
 * + `pubkeyPemOverride` let a test build its own tiny, throwaway-keypair-
 * signed fixture and get real, deterministic coverage of the verify → hash
 * → copy logic without depending on that.
 *
 * Return shape: the project-pass result is the top-level object (backwards-
 * compat with pre-3.31.3 callers). If the global pass ran, its own result is
 * carried in the optional `global` field.
 */
export async function autoRefreshHelpersIfStale(
  cwd: string,
  opts: RefreshOptions = {},
): Promise<{
  refreshed: boolean;
  from?: string;
  to?: string;
  blocked?: string;
  global?: { refreshed: boolean; from?: string; to?: string; blocked?: string };
}> {
  try {
    // Env-level opt-out — applies to BOTH project and global passes.
    if (/^(1|true|on|yes)$/i.test(String(process.env.RUFLO_HELPERS_LOCKED || ''))) {
      return { refreshed: false, blocked: 'RUFLO_HELPERS_LOCKED env — refresh skipped' };
    }

    const version = opts.versionOverride ?? getInstalledCliVersion();
    const projectDir = path.join(cwd, '.claude', 'helpers');
    const projectResult = await refreshOneHelpersDir(projectDir, version, opts);

    // Global pass — opt-in only; test callers omit alsoRefreshGlobal to avoid
    // touching the developer's real ~/.claude/helpers.
    if (opts.alsoRefreshGlobal) {
      const globalDir = path.join(os.homedir(), '.claude', 'helpers');
      // Skip if project === global (e.g. someone invoked ruflo from $HOME
      // and $HOME happens to be a ruflo project — refreshing twice is
      // redundant AND could second-guess the first pass's result).
      if (path.resolve(globalDir) !== path.resolve(projectDir)) {
        const globalResult = await refreshOneHelpersDir(globalDir, version, opts);
        return { ...projectResult, global: globalResult };
      }
    }
    return projectResult;
  } catch {
    return { refreshed: false };
  }
}
