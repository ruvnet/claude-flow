import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { doctorCommand } from '../src/commands/doctor.js';

describe('doctor MetaHarness integration on Windows (#3186)', () => {
  it('reproduces Node rejecting a raw Windows absolute path as an ESM specifier', async () => {
    // Use a child Node process so Vitest cannot rewrite native import().
    const probe = spawnSync(process.execPath, [
      '--input-type=module', '-e',
      'try { await import(process.argv[1]) } catch (error) { process.stdout.write(error.code) }',
      'C:\\ruflo\\_similarity.mjs',
    ], { encoding: 'utf8' });
    expect(probe.status).toBe(0);
    expect(probe.stdout).toBe('ERR_UNSUPPORTED_ESM_URL_SCHEME');
    expect(pathToFileURL('C:\\ruflo\\_similarity.mjs').protocol).toBe('file:');
  });

  it('loads both plugin modules through the real doctor component', async () => {
    const ctx = {
      flags: { component: 'metaharness-integration' }, args: [], config: {},
    } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];
    const result = await doctorCommand.action!(ctx);
    const data = result.data as { results: Array<{ name: string; status: string; message: string }> };

    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({
      name: 'MetaHarness integration (ADR-150)',
      status: 'pass',
      message: 'plugin scripts intact, _similarity.mjs + parseMcpScanText load, smoke OK',
    });
  });
});
