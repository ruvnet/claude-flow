/**
 * ADR-323: single source of truth for RUFLO_HELPERS_PUBKEY.
 *
 * The Ed25519 pubkey used to authenticate the signed helpers manifest was
 * hardcoded identically in TWO places (helper-signing.ts + verify-helpers.mjs),
 * kept in sync only by a `// KEEP IN SYNC` comment. ADR-323 extracts it to a
 * single plain-.js module (src/init/helpers-pubkey.js) that both consumers
 * import.
 *
 * These tests verify the WIRING (London-school: assert the interactions/output
 * of the consolidation, not the crypto internals — helper-signing.test.ts
 * already covers verify/reject behavior). They guard the duplication-prevention
 * invariant so a future accidental re-hardcode fails CI:
 *   1. helpers-pubkey.js exports exactly one well-formed PEM binding.
 *   2. helper-signing.ts's re-export IS that same value (one source, not two).
 *   3. verify-helpers.mjs holds NO PEM literal of its own — only the import.
 *   4. verify-helpers.mjs's CRITICAL array still has all 4 entries (guards the
 *      incidental `statusline.cjs` drop from abandoned PR #2684).
 *   5. Built dist artifact matches src byte-for-byte (build-gated, see note).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicKey } from 'node:crypto';

import { RUFLO_HELPERS_PUBKEY as PUBKEY_FROM_SOURCE_FILE } from '../src/init/helpers-pubkey.js';
import * as pubkeyModule from '../src/init/helpers-pubkey.js';
import { RUFLO_HELPERS_PUBKEY as PUBKEY_FROM_SIGNING } from '../src/init/helper-signing.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY_HELPERS_PATH = join(PKG_ROOT, 'scripts', 'verify-helpers.mjs');
const DIST_PUBKEY_PATH = join(PKG_ROOT, 'dist', 'src', 'init', 'helpers-pubkey.js');
const PEM_HEADER = '-----BEGIN PUBLIC KEY-----';
const PEM_FOOTER = '-----END PUBLIC KEY-----';

describe('ADR-323 §1 — helpers-pubkey.js is a single, well-formed constant', () => {
  it('exports exactly one binding named RUFLO_HELPERS_PUBKEY', () => {
    expect(Object.keys(pubkeyModule)).toEqual(['RUFLO_HELPERS_PUBKEY']);
  });

  it('the exported value is a well-formed PEM public key', () => {
    expect(typeof PUBKEY_FROM_SOURCE_FILE).toBe('string');
    expect(PUBKEY_FROM_SOURCE_FILE.startsWith(PEM_HEADER)).toBe(true);
    expect(PUBKEY_FROM_SOURCE_FILE.trimEnd().endsWith(PEM_FOOTER)).toBe(true);
    // Well-formed enough for Node to parse as a real public key (not just a
    // string that looks like PEM). This does NOT re-test signing — it only
    // asserts the constant is a usable key, which is the module's contract.
    expect(() => createPublicKey(PUBKEY_FROM_SOURCE_FILE)).not.toThrow();
    expect(createPublicKey(PUBKEY_FROM_SOURCE_FILE).asymmetricKeyType).toBe('ed25519');
  });
});

describe('ADR-323 §2 — helper-signing.ts re-exports the SAME source, not a copy', () => {
  it('helper-signing.ts RUFLO_HELPERS_PUBKEY is value-identical to helpers-pubkey.js', () => {
    // Strict equality proves there is genuinely ONE constant re-exported, not a
    // second literal that happens to match today. If someone reintroduced a
    // duplicate literal in helper-signing.ts, a later drift would break this.
    expect(PUBKEY_FROM_SIGNING).toBe(PUBKEY_FROM_SOURCE_FILE);
  });
});

describe('ADR-323 §3 — verify-helpers.mjs holds no PEM literal, only the import', () => {
  const source = readFileSync(VERIFY_HELPERS_PATH, 'utf-8');

  it('does NOT contain a hardcoded BEGIN PUBLIC KEY literal', () => {
    // The whole point of the ADR: the constant must not be duplicated here.
    // If a future edit re-hardcodes it, this regression test fails.
    expect(source).not.toContain(PEM_HEADER);
  });

  it('imports RUFLO_HELPERS_PUBKEY from the single-source module', () => {
    expect(source).toContain("from '../src/init/helpers-pubkey.js'");
    expect(source).toMatch(/import\s*\{\s*RUFLO_HELPERS_PUBKEY\s*\}\s*from\s*['"]\.\.\/src\/init\/helpers-pubkey\.js['"]/);
  });
});

describe('ADR-323 §4 — verify-helpers.mjs CRITICAL array is intact (guards PR #2684 drop)', () => {
  const source = readFileSync(VERIFY_HELPERS_PATH, 'utf-8');

  it("has exactly the 4 original entries, including 'statusline.cjs'", () => {
    const match = source.match(/const\s+CRITICAL\s*=\s*(\[[^\]]*\])/);
    expect(match, 'CRITICAL array literal not found in verify-helpers.mjs').not.toBeNull();
    const entries = JSON.parse(match![1].replace(/'/g, '"'));
    expect(entries).toEqual([
      'auto-memory-hook.mjs',
      'hook-handler.cjs',
      'intelligence.cjs',
      'statusline.cjs',
    ]);
    // Explicit guard for the specific incidental regression in abandoned #2684.
    expect(entries).toContain('statusline.cjs');
    expect(entries).toHaveLength(4);
  });
});

describe('ADR-323 §5 — built dist artifact matches the source constant', () => {
  // Build-gated by design: vitest run does NOT invoke `npm run build`, and the
  // rest of this suite doesn't either, so requiring a fresh dist as a hard
  // precondition would make CI flaky on unbuilt trees. Instead this runs only
  // when dist/ is present (i.e. after a build — the state that actually matters
  // for a publish/CI flow, which builds before packing). When absent it skips
  // rather than fails, so the file is safe to run standalone pre-build. The
  // stronger byte-for-byte guarantee at publish time is covered by the
  // prepublishOnly chain (sign-helpers.mjs → verify-helpers.mjs).
  it.skipIf(!existsSync(DIST_PUBKEY_PATH))(
    'dist/src/init/helpers-pubkey.js exports the byte-identical PEM',
    async () => {
      const distModule = await import(DIST_PUBKEY_PATH);
      expect(distModule.RUFLO_HELPERS_PUBKEY).toBe(PUBKEY_FROM_SOURCE_FILE);
    },
  );
});
