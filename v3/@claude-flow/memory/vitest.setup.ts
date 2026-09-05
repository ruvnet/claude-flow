/**
 * Vitest global setup — ADR-125 Phase 7 (RuVector boundary cleanup).
 *
 * The agentdb / @ruvector/rvf native bindings write a `ruvector.db` redb file
 * to the package's cwd as a side-effect of any code path that touches the
 * vector store. The file is test pollution — it has no source reference in
 * `src/**` and recreates itself on demand. This setup file wipes it before
 * and after the test run so each fresh test session starts from a known state
 * and CI smokes do not see stray DB files in `git status` after `npm test`.
 *
 * Wired into `vitest.config.ts` via `setupFiles: ['./vitest.setup.ts']`.
 *
 * @see ../../docs/adr/ADR-125-memory-consolidation.md Phase 7.
 */

import { afterAll, beforeAll } from 'vitest';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Files that are known to leak into the package root from test code or from
 * the native bindings. Extend this list if a new artifact appears.
 */
const KNOWN_LEAK_FILES = [
  'ruvector.db',
  'ruvector.db-journal',
  'ruvector.db-wal',
  'test-database-provider.db',
  'test-database-provider.rvf',
  'agentdb.rvf.lock',
];

/**
 * Glob-ish suffixes that should be wiped on cleanup. We are deliberately
 * conservative — only files matching exact suffixes are removed, and only
 * from the package root (not recursively).
 */
const LEAK_SUFFIXES = ['.db', '.rvf', '.redb', '.db-journal', '.db-wal'];

function cleanupRoot(): void {
  const root = resolve(__dirname);
  try {
    const entries = readdirSync(root);
    for (const entry of entries) {
      if (KNOWN_LEAK_FILES.includes(entry)) {
        try {
          unlinkSync(join(root, entry));
        } catch {
          // Best-effort cleanup; ignore if the file vanished between readdir
          // and unlink.
        }
        continue;
      }
      // Suffix-based cleanup for stray test artifacts (test-*.db, *.rvf, etc.).
      // Excludes node_modules / dist / src / benchmarks / docs.
      if (
        LEAK_SUFFIXES.some((suffix) => entry.endsWith(suffix)) &&
        !entry.startsWith('.')
      ) {
        try {
          unlinkSync(join(root, entry));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // readdir can fail in unusual CI sandboxes; treat as no-op.
  }
}

beforeAll(() => {
  cleanupRoot();
});

afterAll(() => {
  cleanupRoot();
});
