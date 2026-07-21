/**
 * `proxy config --cloud/--local-only` (ADR-304). The `default_data_plane`
 * TOML values written here ("local"/"cloud") were confirmed against
 * meta-proxy's actual `DataPlane` enum (`src/config.rs`,
 * `#[serde(rename_all = "snake_case")]`) both by reading the source directly
 * and by a live behavioral test against the real v0.1.0 binary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CommandContext } from '../src/types.js';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-config-cmd-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function ctxWithFlags(flags: Record<string, unknown>): CommandContext {
  return { args: [], flags: { _: [], ...flags }, cwd: process.cwd(), interactive: false };
}

async function getConfigSub() {
  const { proxyCommand } = await import('../src/commands/proxy.js');
  const sub = proxyCommand.subcommands?.find((c) => c.name === 'config');
  if (!sub) throw new Error('config subcommand not found');
  return sub;
}

describe('proxy config', () => {
  it('with no flags, reports the default plane (passthrough) when no config file exists', async () => {
    const configSub = await getConfigSub();
    const result = await configSub.action!(ctxWithFlags({}));
    expect(result?.success).toBe(true);
    expect((result?.data as { plane?: string })?.plane).toBe('passthrough');
  });

  it('rejects --cloud and --local-only together', async () => {
    const configSub = await getConfigSub();
    const result = await configSub.action!(ctxWithFlags({ cloud: true, localOnly: true }));
    expect(result?.success).toBe(false);
  });

  it('--cloud without --yes shows the disclosure and writes nothing', async () => {
    const configSub = await getConfigSub();
    const result = await configSub.action!(ctxWithFlags({ cloud: true }));
    expect(result?.success).toBe(true);
    expect((result?.data as { confirmed?: boolean })?.confirmed).toBe(false);
    expect(fs.existsSync(path.join(stateDir, 'proxy-config.toml'))).toBe(false);

    const { hasConsent } = await import('../src/funnel/index.js');
    expect(hasConsent('cloud-routing')).toBe(false);
  });

  it('--cloud --yes writes default_data_plane = "cloud" and grants consent', async () => {
    const configSub = await getConfigSub();
    const result = await configSub.action!(ctxWithFlags({ cloud: true, yes: true }));
    expect(result?.success).toBe(true);

    const raw = fs.readFileSync(path.join(stateDir, 'proxy-config.toml'), 'utf-8');
    expect(raw).toContain('default_data_plane = "cloud"');

    const { hasConsent } = await import('../src/funnel/index.js');
    expect(hasConsent('cloud-routing')).toBe(true);
  });

  it('--local-only writes default_data_plane = "local" and revokes consent', async () => {
    const configSub = await getConfigSub();
    await configSub.action!(ctxWithFlags({ cloud: true, yes: true }));
    await configSub.action!(ctxWithFlags({ localOnly: true }));

    const raw = fs.readFileSync(path.join(stateDir, 'proxy-config.toml'), 'utf-8');
    expect(raw).toContain('default_data_plane = "local"');

    const { hasConsent } = await import('../src/funnel/index.js');
    expect(hasConsent('cloud-routing')).toBe(false);
  });

  it('revoking via --local-only means a later --cloud (no --yes) re-shows the disclosure', async () => {
    const configSub = await getConfigSub();
    await configSub.action!(ctxWithFlags({ cloud: true, yes: true }));
    await configSub.action!(ctxWithFlags({ localOnly: true }));

    const result = await configSub.action!(ctxWithFlags({ cloud: true }));
    expect((result?.data as { confirmed?: boolean })?.confirmed).toBe(false);
  });

  it('preserves unrelated lines already in proxy-config.toml (read-modify-write, not overwrite)', async () => {
    fs.writeFileSync(
      path.join(stateDir, 'proxy-config.toml'),
      'bind = "127.0.0.1:11435"\ndefault_data_plane = "local"\nsponsored_daily_cap_usd = 5.0\n',
    );
    const configSub = await getConfigSub();
    await configSub.action!(ctxWithFlags({ cloud: true, yes: true }));

    const raw = fs.readFileSync(path.join(stateDir, 'proxy-config.toml'), 'utf-8');
    expect(raw).toContain('bind = "127.0.0.1:11435"');
    expect(raw).toContain('sponsored_daily_cap_usd = 5.0');
    expect(raw).toContain('default_data_plane = "cloud"');
  });
});
