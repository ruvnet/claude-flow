/**
 * Tests for validatePermissionManifest (ADR-320 P3 / Part B, ruvnet/ruflo#2630).
 *
 * This is a system-boundary validator: `raw` comes from an installed (possibly
 * malicious or malformed) npm package's `package.json['claude-flow'].permissions`
 * block. The security-relevant distinction under test:
 *   - the WHOLE block absent (undefined/null) -> LEGACY_MAXIMAL_GRANT (backwards
 *     compat for pre-ADR-320 plugins)
 *   - a block PRESENT but malformed / partial -> most-restrictive per-field
 *     defaults (NOT the legacy grant) — so a plugin can't get maximal authority
 *     by shipping a garbage permissions block.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePermissionManifest,
  LEGACY_MAXIMAL_GRANT,
  type PluginPermissionManifest,
} from '../src/plugins/manifest/permission-manifest.js';

const RESTRICTIVE: PluginPermissionManifest = {
  filesystem: { read: [], write: [] },
  network: { allowedHosts: [] },
  hooks: [],
  memoryNamespaces: [],
  subprocess: false,
};

describe('validatePermissionManifest — legacy grant only when the block is absent', () => {
  it('returns LEGACY_MAXIMAL_GRANT for undefined (whole block absent)', () => {
    expect(validatePermissionManifest(undefined)).toEqual(LEGACY_MAXIMAL_GRANT);
  });

  it('returns LEGACY_MAXIMAL_GRANT for null', () => {
    expect(validatePermissionManifest(null)).toEqual(LEGACY_MAXIMAL_GRANT);
  });

  it('LEGACY_MAXIMAL_GRANT is the wildcard/maximal shape', () => {
    expect(LEGACY_MAXIMAL_GRANT).toEqual({
      filesystem: { read: ['**'], write: ['**'] },
      network: { allowedHosts: ['*'] },
      hooks: ['*'],
      memoryNamespaces: ['*'],
      subprocess: true,
    });
  });
});

describe('validatePermissionManifest — present-but-malformed fails safe (NOT legacy)', () => {
  it('returns the most-restrictive manifest for a non-object block', () => {
    expect(validatePermissionManifest('nonsense')).toEqual(RESTRICTIVE);
    expect(validatePermissionManifest(42)).toEqual(RESTRICTIVE);
  });

  it('an empty object block is restrictive, NOT the legacy grant', () => {
    // This is the load-bearing security case: shipping `permissions: {}` must
    // not confer maximal authority.
    expect(validatePermissionManifest({})).toEqual(RESTRICTIVE);
  });

  it('malformed field types fall back per-field to restrictive defaults', () => {
    const result = validatePermissionManifest({
      filesystem: 'bad',
      network: 123,
      hooks: 'not-an-array',
      memoryNamespaces: {},
      subprocess: 'yes', // non-boolean -> false
    });
    expect(result).toEqual(RESTRICTIVE);
  });
});

describe('validatePermissionManifest — well-formed input is preserved & normalized', () => {
  it('parses a fully-specified manifest verbatim', () => {
    const raw = {
      filesystem: { read: ['src/**'], write: ['tmp/**'] },
      network: { allowedHosts: ['api.example.com'] },
      hooks: ['pre-task', 'post-task'],
      memoryNamespaces: ['collaboration'],
      subprocess: true,
    };
    expect(validatePermissionManifest(raw)).toEqual(raw);
  });

  it('respects subprocess:false explicitly and defaults it to false when absent', () => {
    expect(validatePermissionManifest({ subprocess: false }).subprocess).toBe(false);
    expect(validatePermissionManifest({ hooks: ['x'] }).subprocess).toBe(false);
  });

  it('filters non-string entries out of string arrays', () => {
    const result = validatePermissionManifest({ hooks: ['a', 1, 'b', null, 'c'] });
    expect(result.hooks).toEqual(['a', 'b', 'c']);
  });

  it('normalizes a partially-specified filesystem field', () => {
    const result = validatePermissionManifest({ filesystem: { read: ['a'], write: 'bad' } });
    expect(result.filesystem).toEqual({ read: ['a'], write: [] });
  });

  it('a partial block only grants what it declares (subprocess only)', () => {
    const result = validatePermissionManifest({ subprocess: true });
    expect(result).toEqual({ ...RESTRICTIVE, subprocess: true });
  });
});
