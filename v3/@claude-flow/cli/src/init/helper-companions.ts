/**
 * CommonJS companion helpers that `hook-handler.cjs` requires but that are not
 * in the signed critical set (#3555).
 *
 * They are CommonJS, so they ship as `.cjs`: a `.js` copy cannot load in a
 * `"type":"module"` project. Installs made before the rename have only the
 * `.js` copies, which the refreshed hook-handler no longer requires, so the
 * refresh writes any missing `.cjs` companion from the CLI's own compiled
 * generators (the trust root; no external file to verify). Stale `.js` copies
 * are left in place and ignored. Existing `.cjs` files are never overwritten.
 */
import * as fs from 'fs';
import * as path from 'path';

export const COMMONJS_COMPANION_HELPERS = ['session.cjs', 'memory.cjs'] as const;

export async function ensureCommonJsCompanions(helpersDir: string): Promise<string[]> {
  const missing = COMMONJS_COMPANION_HELPERS.filter((name) => !fs.existsSync(path.join(helpersDir, name)));
  if (missing.length === 0) return [];
  const gen = await import('./helpers-generator.js');
  const content: Record<(typeof COMMONJS_COMPANION_HELPERS)[number], () => string> = {
    'session.cjs': gen.generateSessionManager,
    'memory.cjs': gen.generateMemoryHelper,
  };
  const written: string[] = [];
  for (const name of missing) {
    try {
      fs.writeFileSync(path.join(helpersDir, name), content[name](), { encoding: 'utf-8', mode: 0o755 });
      written.push(name);
    } catch { /* best-effort: hook-handler degrades gracefully without it */ }
  }
  return written;
}
