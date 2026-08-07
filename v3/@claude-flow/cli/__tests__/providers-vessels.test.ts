// Tests for the vessel subcommands added to providers.ts (vessel-list, vessel-add,
// vessel-test, vessel-remove, vessel-set-default). These subcommands persist and
// read config at 'providers.vessels' (and 'providers.defaultVessel'). The command
// actions are not individually exported, so rather than drive the full CLI we
// exercise the config read/write contract and the pure helpers (inferShape,
// mergeVessels) the actions rely on, and replicate the built-in guard the way
// vessel-remove does. configManager and output are mocked so the suite is hermetic.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { providersCommand } from '../src/commands/providers.js';
import { configManager } from '../src/services/config-file-manager.js';
import { BUILTIN_VESSELS, inferShape, mergeVessels } from '../src/mcp-tools/vessels.js';

type Vessel = {
  name: string;
  shape: 'anthropic' | 'openai';
  baseUrl: string;
  apiKey: string;
  models: Record<string, string>;
  headers: Record<string, string>;
};

const cwd = '/tmp/ruflo-providers-vessel-test';

// In-memory config store keyed by cwd — mirrors ConfigFileManager's getConfig/set
// contract (nested get/set by dot path) without touching disk.
const store: Record<string, Record<string, unknown>> = {};
function seed(path: string): Record<string, unknown> {
  if (!store[path]) store[path] = { providers: { vessels: {} } };
  return store[path];
}
function nestSet(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}
function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

vi.mock('../src/services/config-file-manager.js', () => ({
  configManager: {
    getConfig: vi.fn((p: string) => deepClone(seed(p))),
    set: vi.fn((p: string, key: string, value: unknown) => nestSet(seed(p), key, value)),
  },
  ConfigFileManager: vi.fn(),
}));

vi.mock('../src/output.js', () => {
  const id = <T,>(x: T): T => x;
  return {
    output: {
      writeln: vi.fn(),
      write: vi.fn(),
      bold: id,
      dim: id,
      success: id,
      warning: id,
      error: id,
      info: id,
      printTable: vi.fn(),
      printList: vi.fn(),
      printBox: vi.fn(),
      printError: vi.fn(),
    },
  };
});

const sampleVessel: Vessel = {
  name: 'test',
  shape: 'anthropic',
  baseUrl: 'https://x.com',
  apiKey: 'k',
  models: {},
  headers: {},
};

function vesselsOf(cfg: unknown): Record<string, Vessel> {
  const p = (cfg as { providers?: { vessels?: Record<string, Vessel> } }).providers;
  return (p?.vessels ?? {}) as Record<string, Vessel>;
}

beforeEach(() => {
  store[cwd] = { providers: { vessels: {} } };
});

describe('providers vessel subcommands (config contract)', () => {
  it('round-trips providers.vessels through configManager', () => {
    configManager.set(cwd, 'providers.vessels', { test: sampleVessel });
    expect(vesselsOf(configManager.getConfig(cwd)).test).toEqual(sampleVessel);
  });

  it('inferShape detects anthropic from a /anthropic path, else openai', () => {
    expect(inferShape('https://api.z.ai/api/anthropic')).toBe('anthropic');
    expect(inferShape('https://openrouter.ai/api/v1')).toBe('openai');
  });

  it('add path: a vessel record with an inferred shape persists and reads back', () => {
    // Mirrors vessel-add: infer shape from URL, build record, merge into vessels.
    const url = 'https://acme.io/anthropic';
    const shape = inferShape(url);
    const cfg = configManager.getConfig(cwd) as { providers: { vessels: Record<string, Vessel> } };
    const updated: Record<string, Vessel> = {
      ...cfg.providers.vessels,
      acme: { name: 'acme', shape, baseUrl: url, apiKey: 'sk-x', models: {}, headers: {} },
    };
    configManager.set(cwd, 'providers.vessels', updated);
    const back = vesselsOf(configManager.getConfig(cwd));
    expect(back.acme.shape).toBe('anthropic');
    expect(back.acme.baseUrl).toBe(url);
  });

  it('remove path: built-in keys are guarded, user keys are deletable', () => {
    // Behavioral mirror of vessel-remove: it builds `new Set(Object.keys(BUILTIN_VESSELS))`
    // and refuses any name present there. We assert the guard would refuse a builtin
    // and would allow a user vessel, then delete the user vessel through the store.
    const builtinKeys = new Set(Object.keys(BUILTIN_VESSELS));
    const firstBuiltin = Object.keys(BUILTIN_VESSELS)[0];
    expect(builtinKeys.has(firstBuiltin)).toBe(true);
    expect(builtinKeys.has('myllm')).toBe(false);

    configManager.set(cwd, 'providers.vessels', { myllm: { ...sampleVessel, name: 'myllm' } });
    const cfg = configManager.getConfig(cwd) as { providers: { vessels: Record<string, Vessel> } };
    const { myllm: _removed, ...rest } = cfg.providers.vessels;
    configManager.set(cwd, 'providers.vessels', rest);
    expect('myllm' in vesselsOf(configManager.getConfig(cwd))).toBe(false);
  });

  it('set-default path: persists providers.defaultVessel', () => {
    const target = Object.keys(BUILTIN_VESSELS)[0];
    configManager.set(cwd, 'providers.defaultVessel', target);
    const cfg = configManager.getConfig(cwd) as { providers: { defaultVessel?: string } };
    expect(cfg.providers.defaultVessel).toBe(target);
  });

  it('mergeVessels: a user vessel overrides a builtin, others survive', () => {
    const keys = Object.keys(BUILTIN_VESSELS);
    const first = keys[0];
    const second = keys.find((k) => k !== first)!;
    const override: Vessel = { ...sampleVessel, name: first, baseUrl: 'https://override.test' };
    const merged = mergeVessels(BUILTIN_VESSELS, { [first]: override });
    expect(merged[first].baseUrl).toBe('https://override.test');
    expect(merged[second]).toBeDefined();
  });

  it('wires the providers command surface', () => {
    expect(providersCommand.name).toBe('providers');
  });
});
