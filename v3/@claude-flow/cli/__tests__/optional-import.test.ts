/**
 * importOptional / nativeDepsLoadable
 *
 * Guards optional imports whose dependency graph contains native addons; see
 * src/services/optional-import.ts for the Node 20 crash this prevents.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  esmLoaderDoubleReportsCjsErrors,
  importOptional,
  nativeDepsLoadable,
} from '../src/services/optional-import.js';

// A module that resolves but throws while loading, like sharp without its
// built binary or onnxruntime-node failing to dlopen.
let fixtureDir: string;
let throwingModule: string;

beforeAll(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'cf-optional-import-'));
  throwingModule = join(fixtureDir, 'throws-on-load.cjs');
  writeFileSync(throwingModule, "throw new Error('native binding failed to load');\n");
});

afterAll(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

describe('nativeDepsLoadable', () => {
  it('returns true when every probed module loads', () => {
    // semver is a plain-JS direct dependency of the CLI
    expect(nativeDepsLoadable('semver', { natives: ['semver'] })).toBe(true);
  });

  it('returns false when a probed module resolves but throws while loading', () => {
    expect(nativeDepsLoadable('semver', { natives: [throwingModule] })).toBe(false);
  });

  it('returns false when any one of several probed modules fails to load', () => {
    expect(nativeDepsLoadable('semver', { natives: ['semver', throwingModule] })).toBe(false);
  });

  it('leaves the decision to the import (returns true) when a probed module is not installed', () => {
    expect(
      nativeDepsLoadable('semver', { natives: ['claude-flow-no-such-native-addon'] }),
    ).toBe(true);
  });

  it('skips probing (returns true) when the target is not resolvable', () => {
    expect(
      nativeDepsLoadable('claude-flow-no-such-package', { natives: ['claude-flow-no-such-native-addon'] }),
    ).toBe(true);
  });

  it('skips probing (returns true) when a via link is not resolvable', () => {
    expect(
      nativeDepsLoadable('semver', {
        via: ['claude-flow-no-such-package'],
        natives: ['claude-flow-no-such-native-addon'],
      }),
    ).toBe(true);
  });
});

describe('importOptional', () => {
  it('returns the module when it imports', async () => {
    const mod = await importOptional<{ valid: (v: string) => string | null }>('semver');
    expect(mod).not.toBeNull();
    expect(typeof mod!.valid).toBe('function');
    expect(mod!.valid('1.2.3')).toBe('1.2.3');
  });

  it('returns null when the module is not installed', async () => {
    await expect(importOptional('claude-flow-no-such-package')).resolves.toBeNull();
  });

  it('returns null without importing when a native probe fails', async () => {
    await expect(importOptional('semver', { natives: [throwingModule] })).resolves.toBeNull();
  });

  it('still imports when a probed native is simply not installed', async () => {
    const mod = await importOptional<{ valid: (v: string) => string | null }>('semver', {
      natives: ['claude-flow-no-such-native-addon'],
    });
    expect(mod).not.toBeNull();
    expect(mod!.valid('1.2.3')).toBe('1.2.3');
  });
});

describe('esmLoaderDoubleReportsCjsErrors', () => {
  it('flags Node 20 and 21', () => {
    expect(esmLoaderDoubleReportsCjsErrors('20.20.2')).toBe(true);
    expect(esmLoaderDoubleReportsCjsErrors('21.7.3')).toBe(true);
  });

  it('does not flag Node 22 and later', () => {
    expect(esmLoaderDoubleReportsCjsErrors('22.23.3')).toBe(false);
    expect(esmLoaderDoubleReportsCjsErrors('24.14.0')).toBe(false);
  });

  it('does not flag an unparseable version', () => {
    expect(esmLoaderDoubleReportsCjsErrors('')).toBe(false);
  });
});
