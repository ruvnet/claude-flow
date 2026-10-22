/**
 * SONAAdapter Test Suite
 *
 * Covers sonaModeFromEnv() / RUFLO_INTELLIGENCE_MODE precedence and timing,
 * since this module previously had no dedicated test coverage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SONAAdapter, sonaModeFromEnv } from '../sona-adapter.js';

const ENV_KEY = 'RUFLO_INTELLIGENCE_MODE';

describe('sonaModeFromEnv', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it('returns undefined when unset', () => {
    delete process.env[ENV_KEY];
    expect(sonaModeFromEnv()).toBeUndefined();
  });

  it.each(['real-time', 'balanced', 'research', 'edge', 'batch'])(
    'returns the mode for recognised value %s', (mode) => {
      process.env[ENV_KEY] = mode;
      expect(sonaModeFromEnv()).toBe(mode);
    },
  );

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'])(
    'ignores inherited object key %s', (value) => {
      process.env[ENV_KEY] = value;
      expect(sonaModeFromEnv()).toBeUndefined();
    },
  );

  it('trims whitespace around the value', () => {
    process.env[ENV_KEY] = '  edge  ';
    expect(sonaModeFromEnv()).toBe('edge');
  });

  it('returns undefined for an unrecognised value (never silently picks a mode)', () => {
    process.env[ENV_KEY] = 'not-a-real-mode';
    expect(sonaModeFromEnv()).toBeUndefined();
  });

  it('is re-read fresh on every call, not cached at module load', () => {
    delete process.env[ENV_KEY];
    expect(sonaModeFromEnv()).toBeUndefined();

    process.env[ENV_KEY] = 'batch';
    expect(sonaModeFromEnv()).toBe('batch');
  });
});

describe('SONAAdapter mode resolution', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
  });

  it('falls back to balanced when RUFLO_INTELLIGENCE_MODE is unset', () => {
    delete process.env[ENV_KEY];
    const adapter = new SONAAdapter();
    expect(adapter.getMode()).toBe('balanced');
  });

  it('picks up RUFLO_INTELLIGENCE_MODE when no explicit mode is passed', () => {
    process.env[ENV_KEY] = 'research';
    const adapter = new SONAAdapter();
    expect(adapter.getMode()).toBe('research');
  });

  it.each(['research', 'constructor'])(
    'an explicit config.mode wins over env value %s', (value) => {
      process.env[ENV_KEY] = value;
      const adapter = new SONAAdapter({ mode: 'edge' });
      expect(adapter.getMode()).toBe('edge');
    },
  );

  it('falls back to balanced for an inherited key before and after initialization', async () => {
    process.env[ENV_KEY] = 'constructor';
    const adapter = new SONAAdapter();
    try {
      expect(adapter.getMode()).toBe('balanced');
      await adapter.initialize();
      expect(adapter.getMode()).toBe('balanced');
    } finally {
      await adapter.shutdown();
    }
  });

  it.each([
    { env: undefined, mode: 'balanced', matches: 0 },
    { env: 'research', mode: 'research', matches: 1 },
    { env: 'garbage', mode: 'balanced', matches: 0 },
    { env: 'constructor', mode: 'balanced', matches: 0 },
    { env: 'toString', mode: 'balanced', matches: 0 },
    { env: '__proto__', mode: 'balanced', matches: 0 },
  ])('applies the resolved profile for env=$env', async ({ env, mode, matches }) => {
    if (env === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = env;
    const adapter = new SONAAdapter({ similarityThreshold: 0.5 });
    try {
      await adapter.initialize();
      await adapter.storePattern({
        pattern: 'one two three four five six seven eight nine ten',
        solution: 'test solution',
        category: 'test',
        confidence: 0.9,
      });
      // Similarity is 0.6: research accepts it, balanced rejects it.
      // A skipped profile would leave the supplied 0.5 threshold in place.
      const results = await adapter.findSimilarPatterns({ query: 'one two three four five six' });
      expect(results).toHaveLength(matches);
      expect(adapter.getMode()).toBe(mode);
    } finally {
      await adapter.shutdown();
    }
  });

  it('reads RUFLO_INTELLIGENCE_MODE freshly on each construction', () => {
    delete process.env[ENV_KEY];
    const before = new SONAAdapter();
    expect(before.getMode()).toBe('balanced');

    process.env[ENV_KEY] = 'edge';
    const after = new SONAAdapter();
    expect(after.getMode()).toBe('edge');
  });
});
