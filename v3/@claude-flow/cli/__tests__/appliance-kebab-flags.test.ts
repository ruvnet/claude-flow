/**
 * `appliance build`, `appliance sign` and `appliance update` read kebab-case
 * keys (`ctx.flags['api-keys']`, `['generate-keys']`, `['key-dir']`,
 * `['public-key']`, `['no-backup']`), but the parser stores every long flag
 * under its camelCase key and turns `--no-foo` into `foo = false`. Those
 * flags were silently ignored. `build` also passed `outputPath`/`apiKeysPath`
 * where RvfaBuilder reads `output`/`apiKeys`, so every build threw
 * `The "paths[0]" argument must be of type string. Received undefined`,
 * and it printed `result.totalSize`, which BuildResult calls `size`.
 *
 * Runs the real parser and the real subcommand actions; only the RVFA
 * builder, signing and patching modules are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';

const builderOptions: Record<string, unknown>[] = [];
const savedKeyDirs: string[] = [];
const applyOptions: Record<string, unknown>[] = [];
let written = '';

vi.mock('../src/appliance/rvfa-builder.js', () => ({
  RvfaBuilder: class {
    constructor(options: Record<string, unknown>) { builderOptions.push(options); }
    async build() { return { outputPath: 'out.rvf', size: 2048, sections: [], duration: 1, profile: 'cloud' }; }
  },
}));

vi.mock('../src/appliance/rvfa-signing.js', () => {
  const kp = { publicKey: Buffer.from('pub'), privateKey: Buffer.from('priv'), fingerprint: 'fp' };
  return {
    generateKeyPair: async () => kp,
    saveKeyPair: async (_kp: unknown, dir: string) => {
      savedKeyDirs.push(dir);
      return { publicKeyPath: `${dir}/rvfa-signing.pub`, privateKeyPath: `${dir}/rvfa-signing.key` };
    },
    loadKeyPair: async () => kp,
    RvfaSigner: class {
      async signAppliance() {
        return { algorithm: 'ed25519', publicKeyFingerprint: 'fp', signedAt: 'now', signature: 'ab'.repeat(32) };
      }
    },
  };
});

vi.mock('../src/appliance/rvfa-distribution.js', () => ({
  RvfaPatcher: {
    applyPatch: async (_file: string, _patch: Buffer, opts: Record<string, unknown>) => {
      applyOptions.push(opts);
      return { success: true, newSize: 1, patchedSection: 'ruflo', errors: [] };
    },
  },
}));

import applianceCommand from '../src/commands/appliance.js';
import { CommandParser } from '../src/parser.js';
import type { CommandContext, CommandResult } from '../src/types.js';

// Any existing file works: the actions only check that the paths exist.
const EXISTING = fileURLToPath(import.meta.url);

async function run(argv: string[]): Promise<CommandResult> {
  const parser = new CommandParser({ allowUnknownFlags: true });
  parser.registerCommand(applianceCommand);
  const { flags } = parser.parse(['appliance', ...argv]);
  const sub = applianceCommand.subcommands!.find((c) => c.name === argv[0])!;
  return (await sub.action!({ args: [], flags, cwd: process.cwd(), interactive: false } as unknown as CommandContext))!;
}

describe('appliance subcommands read the parser\'s camelCase flag keys', () => {
  beforeEach(() => {
    builderOptions.length = 0;
    savedKeyDirs.length = 0;
    applyOptions.length = 0;
    written = '';
    for (const stream of [process.stdout, process.stderr]) {
      vi.spyOn(stream, 'write').mockImplementation((s) => { written += String(s); return true; });
    }
  });

  it('build passes output and --api-keys under the names RvfaBuilder reads', async () => {
    const result = await run(['build', '-o', 'out.rvf', '--api-keys', 'keys.env']);
    expect(result).toMatchObject({ success: true });
    expect(builderOptions[0]).toMatchObject({ output: 'out.rvf', apiKeys: 'keys.env' });
    // No --models: leave the choice to the builder's per-profile default.
    expect(builderOptions[0].models).toBeUndefined();
    expect(written).toContain('Total size: 2.0 KB');
  });

  it('build forwards explicit --models', async () => {
    await run(['build', '--profile', 'hybrid', '-m', 'phi-3-mini-q4']);
    expect(builderOptions[0]).toMatchObject({ profile: 'hybrid', models: ['phi-3-mini-q4'] });
  });

  it('sign --generate-keys writes the key pair to --key-dir', async () => {
    const result = await run(['sign', '-f', EXISTING, '--generate-keys', '--key-dir', 'my-keys']);
    expect(result).toMatchObject({ success: true });
    expect(savedKeyDirs).toEqual(['my-keys']);
  });

  it('update passes --public-key and --no-backup to the patcher', async () => {
    const result = await run(['update', '-f', EXISTING, '-s', 'ruflo', '-p', EXISTING, '--public-key', EXISTING, '--no-backup']);
    expect(result).toMatchObject({ success: true });
    expect(applyOptions[0].publicKey).toBeInstanceOf(Buffer);
    expect(applyOptions[0].backup).toBe(false);
  });

  it('update keeps the backup by default', async () => {
    await run(['update', '-f', EXISTING, '-s', 'ruflo', '-p', EXISTING]);
    expect(applyOptions[0]).toMatchObject({ backup: true, publicKey: undefined });
  });
});
