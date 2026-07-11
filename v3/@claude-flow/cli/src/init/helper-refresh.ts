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
      fs.copyFileSync(path.join(source, name), tp);
      try { fs.chmodSync(tp, '755'); } catch { /* non-fatal */ }
      wrote = true;
    }
    try { fs.copyFileSync(path.join(source, HELPERS_MANIFEST_FILE), path.join(helpersDir, HELPERS_MANIFEST_FILE)); } catch { /* non-fatal */ }
    if (wrote) {
      try { fs.writeFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), version, 'utf-8'); } catch { /* non-fatal */ }
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
    fs.writeFileSync(tp, content, 'utf-8');
    try { fs.chmodSync(tp, '755'); } catch { /* non-fatal */ }
    wrote = true;
  }
  if (wrote) {
    try { fs.writeFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), version, 'utf-8'); } catch { /* non-fatal */ }
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
 * older, already-superseded bundled copies. Comparing with `semver.gt`
 * instead of `!==` makes that impossible: an older or equal installed
 * version is always a no-op, regardless of how it got invoked.
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
export async function autoRefreshHelpersIfStale(
  cwd: string,
  opts: { sourceDirOverride?: string; pubkeyPemOverride?: string; versionOverride?: string } = {},
): Promise<{ refreshed: boolean; from?: string; to?: string; blocked?: string }> {
  try {
    const helpersDir = path.join(cwd, '.claude', 'helpers');
    if (!fs.existsSync(path.join(helpersDir, 'hook-handler.cjs'))) return { refreshed: false };
    const version = opts.versionOverride ?? getInstalledCliVersion();
    let stamped = '';
    try { stamped = fs.readFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), 'utf-8').trim(); } catch { /* pre-feature: unstamped */ }
    if (stamped === version) return { refreshed: false }; // up to date — fast path
    if (stamped && semver.valid(stamped) && semver.valid(version) && semver.gte(stamped, version)) {
      // Stamped version is already >= what this binary reports — refreshing
      // would silently DOWNGRADE the project's helpers. Skip, untouched.
      return { refreshed: false };
    }
    const res = await writeCriticalHelpers(helpersDir, version, {
      sourceDirOverride: opts.sourceDirOverride,
      pubkeyPemOverride: opts.pubkeyPemOverride,
    });
    // A blocked refresh is a SECURITY signal (tampered source/manifest) — surface
    // it, don't advance the stamp, and leave the project's existing helpers intact.
    if (res.blocked) return { refreshed: false, blocked: res.blocked };
    return res.wrote ? { refreshed: true, from: stamped || '(unstamped)', to: version } : { refreshed: false };
  } catch {
    return { refreshed: false };
  }
}
