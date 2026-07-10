/**
 * `ruflo proxy` — Meta LLM Proxy control surface (ADR-304/307/313).
 *
 * This command currently implements the ADR-313 sponsored-downtime
 * subcommands only (`sponsor-enable` / `sponsor-disable` / `sponsor-status`).
 * The full lifecycle command set ADR-307 specifies
 * (`install|start|stop|status|logs|update|uninstall`) manages the proxy
 * *process* itself and is out of scope here — this surface only manages
 * the consent-gated sponsored-mode flag the already-running proxy reads
 * from its config mirror.
 *
 * Consent (ADR-302/313): granting `sponsored-downtime` consent here writes
 * BOTH the ruflo-side consent receipt (source of truth) AND a mirror flag
 * into ~/.ruflo/proxy-config.toml (the file the Rust proxy binary reads).
 * The proxy never writes this file — ruflo does, exactly once per
 * enable/disable action.
 */

import * as fs from 'fs';
import type { Command, CommandResult } from '../types.js';
import { output } from '../output.js';
import { hasConsent, recordConsent, revokeConsent, funnelStateDir } from '../funnel/index.js';
import { recordFunnelEvent } from '../funnel/events.js';
import { clearRateLimitStatus, readRateLimitStatus } from '../funnel/rate-limit-notifier.js';
import { getInstalledCliVersion } from '../init/helper-refresh.js';
import * as path from 'path';

const PROXY_CONFIG_FILE = 'proxy-config.toml';

/**
 * Minimal hand-rolled TOML writer — this config has exactly one boolean
 * field ruflo needs to set (`sponsored_consent_granted`); every other field
 * the proxy binary defaults itself (ADR-307 "a malformed config must never
 * crash the proxy — it degrades to safe defaults"). We read-modify-write
 * the raw text so a user's own bind/backend customizations survive, only
 * ever touching this one line. No TOML parser dependency needed for this.
 */
function readProxyConfigRaw(): string {
  try {
    return fs.readFileSync(path.join(funnelStateDir(), PROXY_CONFIG_FILE), 'utf-8');
  } catch {
    return '';
  }
}

function writeSponsoredConsentMirror(granted: boolean): void {
  const dir = funnelStateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, PROXY_CONFIG_FILE);
  const raw = readProxyConfigRaw();
  const line = `sponsored_consent_granted = ${granted}`;
  let next: string;
  if (/^sponsored_consent_granted\s*=.*$/m.test(raw)) {
    next = raw.replace(/^sponsored_consent_granted\s*=.*$/m, line);
  } else {
    next = raw.length > 0 ? `${raw.trimEnd()}\n${line}\n` : `${line}\n`;
  }
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, next, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, target);
}

const SPONSOR_DISCLOSURE = [
  'Enabling sponsored downtime mode.',
  '',
  "While your Claude usage limit resets, requests can be routed through",
  "Cognitum's own model capacity, sponsored at no cost to you. This is a",
  'separate data plane from your own cloud-routing config — Cognitum sees',
  'these prompts (server-side, same handling as any api.cognitum.one',
  'request), never your own Claude account.',
  '',
  'Sponsored capacity is rate-limited and best-effort — Cognitum may',
  'throttle or decline requests under load. Disable anytime:',
  '  ruflo proxy sponsor-disable',
].join('\n');

const sponsorEnableSub: Command = {
  name: 'sponsor-enable',
  description: "Opt into Cognitum-sponsored downtime capacity (ADR-313)",
  options: [
    { name: 'yes', description: 'Skip the confirmation prompt', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    if (hasConsent('sponsored-downtime')) {
      output.writeln('Sponsored downtime mode is already enabled.');
      return { success: true, data: { alreadyEnabled: true } };
    }
    output.writeln(SPONSOR_DISCLOSURE);
    output.writeln('');
    if (!ctx.flags.yes) {
      output.writeln('Re-run with --yes to confirm: ruflo proxy sponsor-enable --yes');
      return { success: true, data: { confirmed: false } };
    }
    recordConsent('sponsored-downtime', true, 'proxy-sponsor-enable');
    writeSponsoredConsentMirror(true);
    recordFunnelEvent('sponsor_mode_enabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Sponsored downtime mode enabled.');
    output.writeln('The proxy will use it automatically while ruflo settings notices');
    output.writeln('rate-limited is flagged. Disable anytime: ruflo proxy sponsor-disable');
    return { success: true, data: { confirmed: true } };
  },
};

const sponsorDisableSub: Command = {
  name: 'sponsor-disable',
  description: 'Revoke sponsored-downtime consent and stop using sponsored capacity',
  action: async (): Promise<CommandResult> => {
    revokeConsent('sponsored-downtime', 'proxy-sponsor-disable');
    writeSponsoredConsentMirror(false);
    recordFunnelEvent('sponsor_mode_disabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Sponsored downtime mode disabled.');
    return { success: true };
  },
};

const sponsorStatusSub: Command = {
  name: 'sponsor-status',
  description: 'Show sponsored-downtime consent + rate-limit flag state',
  action: async (): Promise<CommandResult> => {
    const consented = hasConsent('sponsored-downtime');
    const rateLimited = readRateLimitStatus();
    output.writeln(`Sponsored downtime consent: ${consented ? 'granted' : 'not granted'}`);
    output.writeln(`Rate-limit flag: ${rateLimited.limited ? `set (since ${rateLimited.since})` : 'not set'}`);
    if (rateLimited.limited && !consented) {
      output.writeln('');
      output.writeln('You are flagged as rate-limited but have not enabled sponsored');
      output.writeln('capacity. Enable it with: ruflo proxy sponsor-enable --yes');
    }
    return { success: true, data: { consented, rateLimited } };
  },
};

/** Convenience: clear the rate-limited flag once you're back to normal. */
const sponsorClearSub: Command = {
  name: 'sponsor-clear',
  description: 'Clear the rate-limited flag (your Claude limit has reset)',
  action: async (): Promise<CommandResult> => {
    clearRateLimitStatus();
    output.printSuccess('Rate-limit flag cleared.');
    return { success: true };
  },
};

export const proxyCommand: Command = {
  name: 'proxy',
  description: 'Meta LLM Proxy — sponsored downtime capacity (ADR-304/307/313)',
  subcommands: [sponsorEnableSub, sponsorDisableSub, sponsorStatusSub, sponsorClearSub],
  examples: [
    { command: 'ruflo proxy sponsor-status', description: 'Show current sponsored-mode state' },
    { command: 'ruflo proxy sponsor-enable --yes', description: 'Opt into sponsored downtime capacity' },
  ],
  action: sponsorStatusSub.action,
};

export default proxyCommand;
