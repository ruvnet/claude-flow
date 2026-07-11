/**
 * Drift guard: `.claude/helpers/hook-handler.cjs` (root) vs.
 * `v3/@claude-flow/cli/.claude/helpers/hook-handler.cjs` (package).
 *
 * These are two committed copies of the same critical helper (ADR-174) — the
 * package copy is what ships; the root copy is this repo's own dogfood
 * install. They are NOT generated from `helpers-generator.ts`'s
 * `generateHookHandler()` — that function is a deliberately simpler inline
 * fallback used only when copying the real file from the package fails
 * (see its own doc comment), so comparing against it would be the wrong
 * guard. The two committed .cjs files themselves must simply never diverge:
 * a prior session's hand-edits DID diverge (the fix for the promo-cache bug
 * and the ADR-312/313 rate-limit nudge landed in the package copy but never
 * got synced to root), and the drift went unnoticed until this test was
 * written, which is exactly the failure mode this guards against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('hook-handler.cjs — root/package artifact parity', () => {
  it('the root and package copies are byte-identical', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const rootArtifact = path.resolve(here, '../../../../.claude/helpers/hook-handler.cjs');
    const pkgArtifact = path.resolve(here, '../.claude/helpers/hook-handler.cjs');
    if (!existsSync(rootArtifact)) return; // package tested in isolation; nothing to guard
    expect(readFileSync(rootArtifact, 'utf-8')).toBe(readFileSync(pkgArtifact, 'utf-8'));
  });
});
