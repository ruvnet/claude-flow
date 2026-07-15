/**
 * Tests for the plugin permission gate (ADR-320 P4 load-time gate, ruvnet/ruflo#2630).
 *
 * Scope note (matches the module's own doc + coordinator's report): P4 here is
 * the LOAD-TIME ceiling gate only. Per-capability invocation-time enforcement
 * (the ADR's "subprocess:false denied when code shells out" wrapper) is NOT
 * built — no plugin-code-loader exists in this repo to wrap — so there is no
 * runtime-wrapper test here; that's a documented gap, not a stub. These tests
 * cover the ceiling parse + comparison + enable decision.
 */

import { describe, it, expect } from 'vitest';
import {
  parsePermissionCeiling,
  findCeilingViolations,
  checkEnableAgainstCeiling,
  type PermissionCapability,
} from '../src/plugins/permission-gate.js';
import {
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

function mf(overrides: Partial<PluginPermissionManifest>): PluginPermissionManifest {
  return { ...RESTRICTIVE, ...overrides };
}

const caps = (vs: ReturnType<typeof findCeilingViolations>): PermissionCapability[] => vs.map(v => v.capability);

// ─── parsePermissionCeiling ───────────────────────────────────────────────

describe('parsePermissionCeiling', () => {
  it('returns undefined when the env var is unset or empty', () => {
    expect(parsePermissionCeiling({})).toBeUndefined();
    expect(parsePermissionCeiling({ CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS: '' })).toBeUndefined();
    expect(parsePermissionCeiling({ CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS: '   ' })).toBeUndefined();
  });

  it('parses valid JSON through the P3 validator', () => {
    const env = { CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS: JSON.stringify({ subprocess: true, hooks: ['pre-task'] }) };
    const ceiling = parsePermissionCeiling(env);
    expect(ceiling).toEqual(mf({ subprocess: true, hooks: ['pre-task'] }));
  });

  it('falls back to the most-restrictive ceiling on malformed JSON (does NOT disable the gate)', () => {
    const env = { CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS: '{not-json' };
    expect(parsePermissionCeiling(env)).toEqual(RESTRICTIVE);
  });
});

// ─── findCeilingViolations ────────────────────────────────────────────────

describe('findCeilingViolations', () => {
  it('reports no violations when the request is within the ceiling', () => {
    const ceiling = mf({ network: { allowedHosts: ['api.example.com'] }, subprocess: true });
    const requested = mf({ network: { allowedHosts: ['api.example.com'] } });
    expect(findCeilingViolations(requested, ceiling)).toEqual([]);
  });

  it('a wildcard ceiling (LEGACY_MAXIMAL_GRANT) permits everything', () => {
    const requested = mf({
      filesystem: { read: ['a'], write: ['b'] },
      network: { allowedHosts: ['evil.example'] },
      hooks: ['x'],
      memoryNamespaces: ['collaboration'],
      subprocess: true,
    });
    expect(findCeilingViolations(requested, LEGACY_MAXIMAL_GRANT)).toEqual([]);
  });

  it('flags subprocess escalation', () => {
    const violations = findCeilingViolations(mf({ subprocess: true }), mf({ subprocess: false }));
    expect(caps(violations)).toEqual(['subprocess']);
  });

  it('flags network hosts not covered by the ceiling', () => {
    const ceiling = mf({ network: { allowedHosts: ['api.example.com'] } });
    const requested = mf({ network: { allowedHosts: ['api.example.com', 'evil.example'] } });
    expect(caps(findCeilingViolations(requested, ceiling))).toContain('network');
  });

  it('flags filesystem, hooks, and memoryNamespaces escalation', () => {
    const requested = mf({
      filesystem: { read: ['secret'], write: ['secret'] },
      hooks: ['undeclared'],
      memoryNamespaces: ['collaboration'],
    });
    const violations = caps(findCeilingViolations(requested, RESTRICTIVE));
    expect(violations).toContain('filesystem.read');
    expect(violations).toContain('filesystem.write');
    expect(violations).toContain('hooks');
    expect(violations).toContain('memoryNamespaces');
  });
});

// ─── checkEnableAgainstCeiling ────────────────────────────────────────────

describe('checkEnableAgainstCeiling', () => {
  it('allows any plugin when no ceiling is configured', () => {
    const requested = mf({ subprocess: true, network: { allowedHosts: ['*'] } });
    expect(checkEnableAgainstCeiling(requested, {})).toEqual({ allowed: true });
  });

  it('allows a compliant plugin under a configured ceiling', () => {
    const env = { CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS: JSON.stringify({ hooks: ['pre-task'] }) };
    expect(checkEnableAgainstCeiling(mf({ hooks: ['pre-task'] }), env)).toEqual({ allowed: true });
  });

  it('refuses a plugin that exceeds the ceiling, with a reason', () => {
    const env = { CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS: JSON.stringify({ subprocess: false }) };
    const result = checkEnableAgainstCeiling(mf({ subprocess: true }), env);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/subprocess/i);
  });

  it('subjects a legacy (undefined-manifest) plugin to the ceiling too', () => {
    // undefined manifest -> LEGACY_MAXIMAL_GRANT (wildcards) -> exceeds a restrictive ceiling.
    const env = { CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS: JSON.stringify({}) };
    const result = checkEnableAgainstCeiling(undefined, env);
    expect(result.allowed).toBe(false);
  });
});
