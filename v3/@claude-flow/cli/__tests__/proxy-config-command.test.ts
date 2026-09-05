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

  /**
   * "Disable anytime: --local-only" was a single command for a choice with
   * two destinations, and the one it named silently drops the user's own
   * subscription. The disclosure must offer both.
   */
  it('offers both ways off the cloud plane, not just the local one', async () => {
    const text = await disclosureShownOnUnconfirmedCloud();

    expect(text).toContain('ruflo proxy config --passthrough');
    expect(text).toContain('ruflo proxy config --local-only');
  });
});

/**
 * `--passthrough`. Turning cloud routing OFF is a choice of destination:
 * `local` is the user's own backend, `passthrough` is their own Claude
 * subscription (meta-proxy's `DataPlane::Passthrough`, and its own default).
 * Before this, `--local-only` was the only exit, so a user who started on
 * passthrough, enabled cloud, and turned it back off silently lost their
 * subscription — and with it automatic quota failover, which meta-proxy
 * (`routing.rs`) only applies while the plane is passthrough.
 */
describe('proxy config --passthrough', () => {
  const configPath = () => path.join(stateDir, 'proxy-config.toml');
  const planeInFile = () => fs.readFileSync(configPath(), 'utf-8').match(/default_data_plane = "([^"]*)"/)?.[1];

  it('writes default_data_plane = "passthrough" and revokes cloud-routing consent', async () => {
    const configSub = await getConfigSub();
    await configSub.action!(ctxWithFlags({ cloud: true, yes: true }));

    const result = await configSub.action!(ctxWithFlags({ passthrough: true }));

    expect(result?.success).toBe(true);
    expect(planeInFile()).toBe('passthrough');

    const { hasConsent } = await import('../src/funnel/index.js');
    expect(hasConsent('cloud-routing')).toBe(false);
  });

  /** The defect, stated as a round trip: leave passthrough, come back to it. */
  it('restores the subscription plane after a cloud round trip', async () => {
    fs.writeFileSync(configPath(), 'default_data_plane = "passthrough"\n');
    const configSub = await getConfigSub();

    await configSub.action!(ctxWithFlags({ cloud: true, yes: true }));
    expect(planeInFile()).toBe('cloud');
    await configSub.action!(ctxWithFlags({ passthrough: true }));

    expect(planeInFile()).toBe('passthrough');
  });

  it('--local-only still means the local backend, unchanged', async () => {
    const configSub = await getConfigSub();

    await configSub.action!(ctxWithFlags({ localOnly: true }));

    expect(planeInFile()).toBe('local');
  });

  it('refuses more than one plane flag rather than silently picking one', async () => {
    const configSub = await getConfigSub();

    for (const flags of [
      { cloud: true, passthrough: true },
      { localOnly: true, passthrough: true },
      { cloud: true, localOnly: true, passthrough: true },
    ]) {
      const result = await configSub.action!(ctxWithFlags(flags));
      expect(result?.success, JSON.stringify(flags)).toBe(false);
    }
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('refuses to pin a tier while --passthrough is turning the cloud plane off', async () => {
    const configSub = await getConfigSub();

    const result = await configSub.action!(ctxWithFlags({ passthrough: true, routingMode: 'high' }));

    expect(result?.success).toBe(false);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it('reports passthrough distinctly from local, not as one "cloud is off" state', async () => {
    const configSub = await getConfigSub();

    await configSub.action!(ctxWithFlags({ passthrough: true }));
    const onPassthrough = await configSub.action!(ctxWithFlags({}));
    await configSub.action!(ctxWithFlags({ localOnly: true }));
    const onLocal = await configSub.action!(ctxWithFlags({}));

    expect((onPassthrough?.data as { plane?: string })?.plane).toBe('passthrough');
    expect((onLocal?.data as { plane?: string })?.plane).toBe('local');
  });

  it('preserves unrelated lines when writing the plane', async () => {
    fs.writeFileSync(configPath(), 'bind = "127.0.0.1:11435"\nrouting_mode = "high"\n');
    const configSub = await getConfigSub();

    await configSub.action!(ctxWithFlags({ passthrough: true }));

    const raw = fs.readFileSync(configPath(), 'utf-8');
    expect(raw).toContain('bind = "127.0.0.1:11435"');
    expect(raw).toContain('routing_mode = "high"');
    expect(raw).toContain('default_data_plane = "passthrough"');
  });
});

describe('plane guidance', () => {
  async function linesFrom(flags: Record<string, unknown>): Promise<string> {
    const lines: string[] = [];
    const { output } = await import('../src/output.js');
    const write = vi.spyOn(output, 'writeln').mockImplementation((line?: string) => {
      lines.push(String(line ?? ''));
    });
    const success = vi.spyOn(output, 'printSuccess').mockImplementation((line?: string) => {
      lines.push(String(line ?? ''));
    });
    try {
      const configSub = await getConfigSub();
      await configSub.action!(ctxWithFlags(flags));
    } finally {
      write.mockRestore();
      success.mockRestore();
    }
    return lines.join('\n');
  }

  it('names the plane being left and how to restore it when enabling cloud', async () => {
    fs.writeFileSync(path.join(stateDir, 'proxy-config.toml'), 'default_data_plane = "passthrough"\n');

    const text = await linesFrom({ cloud: true, yes: true });

    expect(text).toContain('Previous plane: passthrough');
    expect(text).toContain('ruflo proxy config --passthrough');
  });

  it('warns that --local-only does not use the Claude subscription', async () => {
    const text = await linesFrom({ localOnly: true });

    expect(text).toContain('NOT used on this plane');
    expect(text).toContain('ruflo proxy config --passthrough');
  });

  it('does not add that warning when landing on passthrough', async () => {
    const text = await linesFrom({ passthrough: true });

    expect(text).not.toContain('NOT used on this plane');
  });

  /** Sitting on `local` opts you out of ADR-321 failover; nothing else says so. */
  it('flags that automatic quota failover does not apply while on local', async () => {
    const configSub = await getConfigSub();
    await configSub.action!(ctxWithFlags({ localOnly: true }));

    const text = await linesFrom({});

    expect(text).toContain('automatic quota failover (ADR-321) applies only on passthrough');
  });
});
