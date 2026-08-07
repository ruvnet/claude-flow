// Tests for active-vessel selection — `selectVessel` lookup and the
// `resolveActiveVessel` env-var precedence ladder (RUFLO_PROVIDER →
// ANTHROPIC_BASE_URL match → anthropic default → first registered).
//
// Env mutation is fully isolated: every test snapshots process.env and the
// afterEach hook restores it, so no state leaks across cases.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { VesselConfig } from '../src/mcp-tools/vessels.js';
import { BUILTIN_VESSELS } from '../src/mcp-tools/vessels.js';
import {
  selectVessel,
  resolveActiveVessel,
} from '../src/mcp-tools/vessel-env.js';

// A small, fixed registry: the two real built-ins plus an openai-shaped
// custom proxy whose baseUrl we can match against ANTHROPIC_BASE_URL.
const vessels: Record<string, VesselConfig> = {
  anthropic: BUILTIN_VESSELS.anthropic,
  zai: BUILTIN_VESSELS.zai,
  custom: {
    name: 'custom',
    shape: 'openai',
    baseUrl: 'https://my-proxy.example/api',
    apiKey: 'k',
    models: {},
    headers: {},
  },
};

// Snapshot of the env vars this suite touches, restored after every test.
const SNAPSHOT_KEYS = ['RUFLO_PROVIDER', 'ANTHROPIC_BASE_URL'] as const;
let envSnapshot: Record<string, string | undefined>;

afterEach(() => {
  for (const key of SNAPSHOT_KEYS) {
    const value = envSnapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function snapshotEnv(): void {
  envSnapshot = {};
  for (const key of SNAPSHOT_KEYS) envSnapshot[key] = process.env[key];
}

describe('selectVessel', () => {
  beforeEach(snapshotEnv);

  it('returns the vessel matching the given name', () => {
    expect(selectVessel(vessels, 'zai')).toBe(vessels.zai);
  });

  it('returns undefined for a name that is not registered', () => {
    expect(selectVessel(vessels, 'nonexistent')).toBeUndefined();
  });

  it('matches names case-insensitively', () => {
    expect(selectVessel(vessels, 'ZAI')).toBe(vessels.zai);
  });
});

describe('resolveActiveVessel', () => {
  it('resolves to anthropic/default when no provider env vars are set', () => {
    snapshotEnv();
    delete process.env.RUFLO_PROVIDER;
    delete process.env.ANTHROPIC_BASE_URL;

    const resolved = resolveActiveVessel(vessels);

    expect(resolved.name).toBe('anthropic');
    expect(resolved.source).toBe('default');
    expect(resolved.vessel).toBe(vessels.anthropic);
  });

  it('honors RUFLO_PROVIDER as an explicit env selection', () => {
    snapshotEnv();
    delete process.env.ANTHROPIC_BASE_URL;
    process.env.RUFLO_PROVIDER = 'zai';

    const resolved = resolveActiveVessel(vessels);

    expect(resolved.name).toBe('zai');
    expect(resolved.source).toBe('env-explicit');
    expect(resolved.vessel).toBe(vessels.zai);
  });

  it('matches ANTHROPIC_BASE_URL against a vessel baseUrl, tolerating a trailing slash', () => {
    snapshotEnv();
    delete process.env.RUFLO_PROVIDER;

    process.env.ANTHROPIC_BASE_URL = 'https://my-proxy.example/api';
    const plain = resolveActiveVessel(vessels);
    expect(plain.name).toBe('custom');
    expect(plain.source).toBe('env-baseurl-match');

    process.env.ANTHROPIC_BASE_URL = 'https://my-proxy.example/api/';
    const trailing = resolveActiveVessel(vessels);
    expect(trailing.name).toBe('custom');
    expect(trailing.source).toBe('env-baseurl-match');
  });

  it('throws when the vessel registry is empty', () => {
    snapshotEnv();
    expect(() => resolveActiveVessel({})).toThrow(/empty/i);
  });
});
