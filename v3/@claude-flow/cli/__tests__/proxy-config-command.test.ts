/**
 * `proxy config --cloud/--local-only` (ADR-304). The `default_data_plane`
 * TOML values written here ("local"/"cloud") were confirmed against
 * meta-proxy's actual `DataPlane` enum (`src/config.rs`,
 * `#[serde(rename_all = "snake_case")]`) both by reading the source directly
 * and by a live behavioral test against the real v0.1.0 binary.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * `--routing-mode` (meta-proxy ADR-321 rev-2). Values match the Rust
 * `RoutingMode` enum. The invariant worth pinning is ADR-321 Revision 3's:
 * the plane choice and this Cloud-only tier setting are SEPARATE controls,
 * so selecting a tier must never activate Cloud.
 */
describe('proxy config --routing-mode', () => {
  const configPath = () => path.join(stateDir, 'proxy-config.toml');

  it('writes routing_mode without touching the data plane or granting consent', async () => {
    const configSub = await getConfigSub();

    const result = await configSub.action!(ctxWithFlags({ routingMode: 'high' }));

    expect(result?.success).toBe(true);
    const raw = fs.readFileSync(configPath(), 'utf-8');
    expect(raw).toContain('routing_mode = "high"');
    expect(raw).not.toContain('default_data_plane');

    const { hasConsent } = await import('../src/funnel/index.js');
    expect(hasConsent('cloud-routing')).toBe(false);
  });

  it('accepts every mode meta-proxy defines', async () => {
    const configSub = await getConfigSub();

    for (const mode of ['auto', 'low', 'mid', 'high']) {
      const result = await configSub.action!(ctxWithFlags({ routingMode: mode }));
      expect(result?.success, mode).toBe(true);
      expect(fs.readFileSync(configPath(), 'utf-8')).toContain(`routing_mode = "${mode}"`);
    }
  });

  it('rejects a mode meta-proxy would not understand, and writes nothing', async () => {
    const configSub = await getConfigSub();

    const result = await configSub.action!(ctxWithFlags({ routingMode: 'ultra' }));

    expect(result?.success).toBe(false);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('refuses to pin a tier while --local-only is turning the cloud plane off', async () => {
    const configSub = await getConfigSub();

    const result = await configSub.action!(ctxWithFlags({ localOnly: true, routingMode: 'high' }));

    expect(result?.success).toBe(false);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('applies alongside --cloud --yes in one command', async () => {
    const configSub = await getConfigSub();

    const result = await configSub.action!(ctxWithFlags({ cloud: true, yes: true, routingMode: 'low' }));

    expect(result?.success).toBe(true);
    const raw = fs.readFileSync(configPath(), 'utf-8');
    expect(raw).toContain('default_data_plane = "cloud"');
    expect(raw).toContain('routing_mode = "low"');
  });

  /** The unconfirmed path's whole promise is that nothing was written. */
  it('writes nothing when passed with an unconfirmed --cloud', async () => {
    const configSub = await getConfigSub();

    const result = await configSub.action!(ctxWithFlags({ cloud: true, routingMode: 'low' }));

    expect((result?.data as { confirmed?: boolean })?.confirmed).toBe(false);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('reports the current mode with no flags, defaulting to auto when unset', async () => {
    const configSub = await getConfigSub();

    const unset = await configSub.action!(ctxWithFlags({}));
    expect((unset?.data as { routingMode?: string })?.routingMode).toBe('auto');

    await configSub.action!(ctxWithFlags({ routingMode: 'mid' }));
    const set = await configSub.action!(ctxWithFlags({}));
    expect((set?.data as { routingMode?: string })?.routingMode).toBe('mid');
  });

  it('treats an unrecognized routing_mode already in the file as auto', async () => {
    fs.writeFileSync(configPath(), 'routing_mode = "ultra"\n');
    const configSub = await getConfigSub();

    const result = await configSub.action!(ctxWithFlags({}));

    expect((result?.data as { routingMode?: string })?.routingMode).toBe('auto');
  });

  it('preserves unrelated lines when writing routing_mode', async () => {
    fs.writeFileSync(configPath(), 'bind = "127.0.0.1:11435"\nsponsored_daily_cap_usd = 5.0\n');
    const configSub = await getConfigSub();

    await configSub.action!(ctxWithFlags({ routingMode: 'high' }));

    const raw = fs.readFileSync(configPath(), 'utf-8');
    expect(raw).toContain('bind = "127.0.0.1:11435"');
    expect(raw).toContain('sponsored_daily_cap_usd = 5.0');
    expect(raw).toContain('routing_mode = "high"');
  });
});

/**
 * meta-proxy#43 M5b — "add equivalent disclosure to any terminal flow that
 * explicitly activates Cloud". The console got this in M5a (#60); this
 * command is the terminal flow, and these are the three questions
 * activating Cloud actually decides.
 */
describe('cloud routing disclosure', () => {
  async function disclosureShownOnUnconfirmedCloud(): Promise<string> {
    const lines: string[] = [];
    const { output } = await import('../src/output.js');
    const spy = vi.spyOn(output, 'writeln').mockImplementation((line?: string) => {
      lines.push(String(line ?? ''));
    });
    try {
      const configSub = await getConfigSub();
      await configSub.action!(ctxWithFlags({ cloud: true }));
    } finally {
      spy.mockRestore();
    }
    return lines.join('\n');
  }

  it('says who processes the prompts', async () => {
    expect(await disclosureShownOnUnconfirmedCloud()).toContain('api.cognitum.one');
  });

  it("says who pays, and that Passthrough uses the user's own subscription instead", async () => {
    const text = await disclosureShownOnUnconfirmedCloud();

    expect(text).toContain('metered against your Cognitum account');
    expect(text).toContain('Passthrough');
  });

  /**
   * The omission that mattered: on the Cloud plane the client's requested
   * model is deliberately not used, and before this the disclosure never
   * said so — a user could enable Cloud believing their model choice held.
   */
  it('says the plane picks the tier rather than using the requested model, and how to override', async () => {
    const text = await disclosureShownOnUnconfirmedCloud();

    expect(text).toContain('instead of using the model');
    expect(text).toContain('ruflo proxy config --routing-mode');
  });
});
