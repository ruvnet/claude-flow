/**
 * V3 CLI AGNTCY/SLIM command scaffold tests — ADR-380.
 *
 * Asserts the "works without AGNTCY installed" smoke contract each command
 * must satisfy (mirroring ADR-150's CI-gate precedent, §1 of ADR-380):
 * with no `RUFLO_AGNTCY_SLIM_ENDPOINT` set (the default, real-world state
 * today since no runtime package exists to install), every command must
 * run to completion without throwing, exit 0, and print the documented
 * "not configured" fallback message.
 *
 * Lives under the package's top-level `__tests__/agntcy/` (mirroring
 * `__tests__/ruvector/` and `__tests__/services/`, which mirror
 * `src/ruvector/` and `src/services/` respectively) so it's picked up by
 * the package's `vitest.config.ts` `include: ['__tests__/**\/*.test.ts']`
 * glob — the original `src/commands/agntcy/__tests__/` location was never
 * reachable by that glob and left this suite unrun by `npm test`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { transportCommand, useCommand } from '../../src/commands/agntcy/transport.js';
import { agentPublishCommand, validateOasfRecordShape } from '../../src/commands/agntcy/publish.js';
import { swarmJoinCommand, validateNamespace } from '../../src/commands/agntcy/swarm-join.js';
import {
  detectAgntcyRuntime,
  AGNTCY_ENDPOINT_ENV,
  AGNTCY_NOT_CONFIGURED_MESSAGE,
} from '../../src/commands/agntcy/runtime.js';
import { output } from '../../src/output.js';

import type { CommandContext, CommandResult } from '../../src/types.js';

function makeCtx(args: string[] = [], flags: Record<string, unknown> = {}): CommandContext {
  return {
    args,
    flags: { _: args, ...flags } as CommandContext['flags'],
    cwd: process.cwd(),
    interactive: false,
  };
}

async function runAction(
  cmd: { action?: (ctx: CommandContext) => Promise<CommandResult | void> },
  ctx: CommandContext,
): Promise<CommandResult | void> {
  if (!cmd.action) throw new Error('command has no action');
  return cmd.action(ctx);
}

describe('agntcy command scaffold (ADR-380) — not-configured fallback', () => {
  const originalEndpoint = process.env[AGNTCY_ENDPOINT_ENV];

  beforeEach(() => {
    delete process.env[AGNTCY_ENDPOINT_ENV];
  });

  afterEach(() => {
    if (originalEndpoint === undefined) {
      delete process.env[AGNTCY_ENDPOINT_ENV];
    } else {
      process.env[AGNTCY_ENDPOINT_ENV] = originalEndpoint;
    }
    vi.restoreAllMocks();
  });

  describe('runtime.ts — detectAgntcyRuntime', () => {
    it('reports not configured when the endpoint env var is unset', async () => {
      const status = await detectAgntcyRuntime({});
      expect(status.configured).toBe(false);
      expect(status.reason).toContain(AGNTCY_ENDPOINT_ENV);
      expect(status.endpoint).toBeUndefined();
    });

    it('reports configured when the endpoint is set and the optional package resolves', async () => {
      // @agntcy/slim-bindings is pinned to the confirmed-working alpha
      // (2.0.0-alpha.5, see package.json + runtime.ts's header comment for
      // why — agntcy/slim#1916) and is a real optionalDependency here, so
      // this genuinely exercises the "package installed and importable"
      // path rather than asserting the old "not installed" fallback.
      const status = await detectAgntcyRuntime({ [AGNTCY_ENDPOINT_ENV]: 'https://slim.example.com' });
      expect(status.configured).toBe(true);
      expect(status.endpoint).toBe('https://slim.example.com');
      expect(status.reason).toMatch(/resolved/);
    });

    it('still degrades gracefully if the optional package genuinely is not installed', async () => {
      // Regression guard for the "works without AGNTCY installed" contract
      // this file's header describes — simulate a MODULE_NOT_FOUND by
      // probing a package name guaranteed not to exist, exercising the
      // same catch branch a real "not installed" environment would hit.
      const status = await detectAgntcyRuntime(
        { [AGNTCY_ENDPOINT_ENV]: 'https://slim.example.com' },
        '@agntcy/this-package-does-not-exist-in-any-registry',
      );
      expect(status.configured).toBe(false);
      expect(status.endpoint).toBe('https://slim.example.com');
      expect(status.reason).toMatch(/not installed|error probing/);
    });

    it('never throws regardless of env shape', async () => {
      await expect(detectAgntcyRuntime({} as NodeJS.ProcessEnv)).resolves.toBeDefined();
    });
  });

  describe('ruflo transport use slim', () => {
    it('exposes a "use" subcommand on the transport command tree', () => {
      expect(transportCommand.name).toBe('transport');
      expect(transportCommand.subcommands?.map((c) => c.name)).toContain('use');
    });

    it('falls back to local transport without throwing, exit 0, expected message', async () => {
      const infoSpy = vi.spyOn(output, 'printInfo').mockImplementation(() => {});

      const result = await runAction(useCommand, makeCtx(['slim']));

      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
      expect(result?.exitCode).toBeUndefined();
      expect((result?.data as Record<string, unknown>)?.transport).toBe('local');
      expect(infoSpy).toHaveBeenCalledWith(AGNTCY_NOT_CONFIGURED_MESSAGE);
    });

    it('rejects an unsupported transport name with exit 1 (usage error, not a fallback)', async () => {
      const result = await runAction(useCommand, makeCtx(['not-a-real-transport']));
      expect(result?.success).toBe(false);
      expect(result?.exitCode).toBe(1);
    });

    it('requires a transport name argument', async () => {
      const result = await runAction(useCommand, makeCtx([]));
      expect(result?.success).toBe(false);
      expect(result?.exitCode).toBe(1);
    });

    it('parent "transport" command action runs without throwing', async () => {
      const result = await runAction(transportCommand, makeCtx([]));
      expect(result?.success).toBe(true);
    });
  });

  describe('ruflo agent publish', () => {
    let tmpDir: string;
    let manifestPath: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'agntcy-publish-'));
      manifestPath = join(tmpDir, 'agent.oasf.json');
      await writeFile(manifestPath, JSON.stringify({ name: 'test-agent', version: '0.1.0' }), 'utf-8');
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('validateOasfRecordShape accepts a minimal valid record', () => {
      expect(validateOasfRecordShape({ name: 'a', version: '1.0.0' }).valid).toBe(true);
    });

    it('validateOasfRecordShape rejects missing fields, non-objects, and null', () => {
      expect(validateOasfRecordShape({}).valid).toBe(false);
      expect(validateOasfRecordShape({ name: 'a' }).valid).toBe(false);
      expect(validateOasfRecordShape(null).valid).toBe(false);
      expect(validateOasfRecordShape('nope').valid).toBe(false);
      expect(validateOasfRecordShape([]).valid).toBe(false);
    });

    it('falls back gracefully (exit 0) when not configured, after validating the manifest locally', async () => {
      const infoSpy = vi.spyOn(output, 'printInfo').mockImplementation(() => {});

      const result = await runAction(agentPublishCommand, makeCtx([], { manifest: manifestPath }));

      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
      expect(result?.exitCode).toBeUndefined();
      expect((result?.data as Record<string, unknown>)?.published).toBe(false);
      expect(infoSpy).toHaveBeenCalledWith(AGNTCY_NOT_CONFIGURED_MESSAGE);
    });

    it('errors (exit 1) on a missing manifest file, independent of AGNTCY configuration', async () => {
      const result = await runAction(
        agentPublishCommand,
        makeCtx([], { manifest: join(tmpDir, 'does-not-exist.json') }),
      );
      expect(result?.success).toBe(false);
      expect(result?.exitCode).toBe(1);
    });

    it('errors (exit 1) on a manifest that is valid JSON but not a valid OASF record', async () => {
      const badManifest = join(tmpDir, 'bad.json');
      await writeFile(badManifest, JSON.stringify({ notAName: true }), 'utf-8');

      const result = await runAction(agentPublishCommand, makeCtx([], { manifest: badManifest }));
      expect(result?.success).toBe(false);
      expect(result?.exitCode).toBe(1);
    });
  });

  describe('ruflo swarm join <namespace>', () => {
    it('validateNamespace accepts slash-delimited alphanumeric namespaces', () => {
      expect(validateNamespace('cognitum/research/security').valid).toBe(true);
      expect(validateNamespace('single-segment').valid).toBe(true);
    });

    it('validateNamespace rejects empty and malformed namespaces', () => {
      expect(validateNamespace('').valid).toBe(false);
      expect(validateNamespace('   ').valid).toBe(false);
      expect(validateNamespace('bad namespace!').valid).toBe(false);
      expect(validateNamespace('cognitum//security').valid).toBe(false);
    });

    it('falls back to local coordination without throwing, exit 0, expected message', async () => {
      const infoSpy = vi.spyOn(output, 'printInfo').mockImplementation(() => {});

      const result = await runAction(swarmJoinCommand, makeCtx(['cognitum/research/security']));

      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
      expect(result?.exitCode).toBeUndefined();
      expect((result?.data as Record<string, unknown>)?.joined).toBe(false);
      expect(infoSpy).toHaveBeenCalledWith(AGNTCY_NOT_CONFIGURED_MESSAGE);
    });

    it('requires a namespace argument', async () => {
      const result = await runAction(swarmJoinCommand, makeCtx([]));
      expect(result?.success).toBe(false);
      expect(result?.exitCode).toBe(1);
    });

    it('rejects an invalid namespace with exit 1 (usage error, not a fallback)', async () => {
      const result = await runAction(swarmJoinCommand, makeCtx(['not a namespace!']));
      expect(result?.success).toBe(false);
      expect(result?.exitCode).toBe(1);
    });
  });
});
