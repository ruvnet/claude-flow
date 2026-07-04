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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HELPERS_STAMP_FILE = '.helpers-version';
/** ruflo-owned helpers that carry hook logic and must track the package version. */
export const CRITICAL_HELPERS = ['auto-memory-hook.mjs', 'hook-handler.cjs', 'intelligence.cjs'];

/** Installed @claude-flow/cli version — the value the helpers are stamped with. */
export function getInstalledCliVersion(): string {
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(esmRequire.resolve('@claude-flow/cli/package.json'), 'utf-8'));
    return String(pkg.version || '0.0.0');
  } catch {
    // dist/src/init → package root
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf-8'));
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
  candidates.push(path.resolve(__dirname, '..', '..', '..', '.claude', 'helpers'));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'hook-handler.cjs'))) return c;
  }
  return null;
}

/** Re-copy the critical helpers into `helpersDir` and stamp `version`. */
async function writeCriticalHelpers(helpersDir: string, version: string): Promise<boolean> {
  const source = findPackageHelpersDir();
  let wrote = false;
  if (source) {
    for (const name of CRITICAL_HELPERS) {
      const sp = path.join(source, name);
      const tp = path.join(helpersDir, name);
      if (fs.existsSync(sp)) {
        fs.copyFileSync(sp, tp);
        try { fs.chmodSync(tp, '755'); } catch { /* non-fatal */ }
        wrote = true;
      }
    }
  } else {
    // Source unresolvable (broken npx paths) — regenerate. Heavy import, lazy.
    const gen = await import('./helpers-generator.js');
    const files: Record<string, string> = {
      'hook-handler.cjs': gen.generateHookHandler(),
      'intelligence.cjs': gen.generateIntelligenceStub(),
      'auto-memory-hook.mjs': gen.generateAutoMemoryHook(),
    };
    for (const [name, content] of Object.entries(files)) {
      const tp = path.join(helpersDir, name);
      fs.writeFileSync(tp, content, 'utf-8');
      try { fs.chmodSync(tp, '755'); } catch { /* non-fatal */ }
      wrote = true;
    }
  }
  if (wrote) {
    try { fs.writeFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), version, 'utf-8'); } catch { /* non-fatal */ }
  }
  return wrote;
}

/**
 * On CLI startup: if an initialized project's critical helpers are stamped older
 * than the installed CLI version, silently re-copy them. Fast path is a single
 * stamp read + string compare (sub-ms); the copy runs at most once per version
 * bump. Best-effort, never throws. No-op outside a ruflo project (requires an
 * existing hook-handler.cjs — never creates files in an unrelated directory).
 */
export async function autoRefreshHelpersIfStale(cwd: string): Promise<{ refreshed: boolean; from?: string; to?: string }> {
  try {
    const helpersDir = path.join(cwd, '.claude', 'helpers');
    if (!fs.existsSync(path.join(helpersDir, 'hook-handler.cjs'))) return { refreshed: false };
    const version = getInstalledCliVersion();
    let stamped = '';
    try { stamped = fs.readFileSync(path.join(helpersDir, HELPERS_STAMP_FILE), 'utf-8').trim(); } catch { /* pre-feature: unstamped */ }
    if (stamped === version) return { refreshed: false }; // up to date — fast path
    const ok = await writeCriticalHelpers(helpersDir, version);
    return ok ? { refreshed: true, from: stamped || '(unstamped)', to: version } : { refreshed: false };
  } catch {
    return { refreshed: false };
  }
}
