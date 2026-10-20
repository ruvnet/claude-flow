/**
 * Post-install integrity re-verification for signed critical helpers (#3565).
 *
 * `helper-refresh.ts` verifies a helper's signature/hash once, at copy time,
 * then stamps the target directory with the installed CLI version. Every
 * later command short-circuited on "stamp already matches" with NO further
 * verification — so a critical helper modified on disk after that point (a
 * sibling package's postinstall, a stray older CLI process racing a write,
 * direct tampering) stayed silently modified through any number of
 * subsequent commands, forever. This module re-hashes the already-INSTALLED
 * helpers against the signed manifest independent of the stamp, so callers
 * can re-run it on every invocation rather than trusting a single past check.
 *
 * Deliberately has no opinion on WHAT to do about tampering (re-copy, warn,
 * refuse) — that policy lives in helper-refresh.ts, which already owns the
 * fail-closed verify-then-copy path this result feeds into to heal.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  verifyHelpersManifest, sha256Hex, HELPERS_MANIFEST_FILE, type HelpersManifest,
} from './helper-signing.js';

export interface IntegrityResult {
  /** Critical helper names whose on-disk hash doesn't match the signed manifest
   *  (or that are missing from disk despite being part of the signed set). */
  tampered: string[];
  /** Set only when the package's OWN signed manifest can't be verified at all —
   *  there's no ground truth to check the installed files against, distinct
   *  from a clean `tampered: []` result. */
  blocked?: string;
}

/**
 * Re-verify each of `criticalHelpers` present on disk in `helpersDir` against
 * `sourceDir`'s signed manifest. Read-only — safe to call without holding any
 * refresh lock; callers only need to acquire one if `tampered` comes back
 * non-empty and they intend to repair it.
 *
 * `sourceDir: null` (package source unresolvable) returns `{ tampered: [] }`
 * — fails open rather than flagging every install as tampered when there is
 * no ground truth at all to compare against.
 */
export function verifyInstalledCriticalHelpers(
  helpersDir: string,
  sourceDir: string | null,
  criticalHelpers: readonly string[],
  pubkeyPemOverride?: string,
): IntegrityResult {
  if (!sourceDir) return { tampered: [] };

  let trusted: HelpersManifest | null = null;
  try {
    trusted = verifyHelpersManifest(
      fs.readFileSync(path.join(sourceDir, HELPERS_MANIFEST_FILE), 'utf-8'),
      pubkeyPemOverride,
    );
  } catch { trusted = null; }
  if (!trusted) return { tampered: [], blocked: 'signed helpers manifest missing or signature invalid' };

  const tampered: string[] = [];
  for (const name of criticalHelpers) {
    const expected = trusted.files[name];
    // Not part of THIS version's signed set (or source doesn't ship it) —
    // nothing to compare the installed copy against.
    if (!expected || !fs.existsSync(path.join(sourceDir, name))) continue;

    let actual: string | null = null;
    try { actual = sha256Hex(fs.readFileSync(path.join(helpersDir, name))); } catch { actual = null; }
    if (actual !== expected) tampered.push(name);
  }
  return { tampered };
}
