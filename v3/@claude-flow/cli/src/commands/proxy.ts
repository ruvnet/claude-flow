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
import { clearQuotaLowStatus, readQuotaLowStatus } from '../funnel/power-saver-notifier.js';
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

function writeConsentMirrorLine(field: string, value: boolean): void {
  const dir = funnelStateDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, PROXY_CONFIG_FILE);
  const raw = readProxyConfigRaw();
  const line = `${field} = ${value}`;
  const pattern = new RegExp(`^${field}\\s*=.*$`, 'm');
  let next: string;
  if (pattern.test(raw)) {
    next = raw.replace(pattern, line);
  } else {
    next = raw.length > 0 ? `${raw.trimEnd()}\n${line}\n` : `${line}\n`;
  }
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, next, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tmp, target);
}

function writeSponsoredConsentMirror(granted: boolean): void {
  writeConsentMirrorLine('sponsored_consent_granted', granted);
}

function writePowerSaverConsentMirror(granted: boolean): void {
  writeConsentMirrorLine('power_saver_consent_granted', granted);
}

function writeTrainingShareConsentMirror(granted: boolean): void {
  writeConsentMirrorLine('training_share_consent_granted', granted);
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
    const changed = clearRateLimitStatus();
    if (!changed) {
      output.printError('Rate-limit flag was just toggled — try again in a few minutes (ADR-314 anti-abuse cooldown).');
      return { success: false };
    }
    output.printSuccess('Rate-limit flag cleared.');
    return { success: true };
  },
};

const POWER_SAVER_DISCLOSURE = [
  'Enabling power saver mode.',
  '',
  "Everyday requests will route through Cognitum's own difficulty-based",
  'router (cognitum-auto) instead of your Claude subscription directly —',
  'simple messages stay cheap, genuinely hard reasoning still escalates to',
  'a comparable frontier model. This is billed to YOUR OWN Cognitum',
  'account (cloud-routing), not sponsored/free capacity — a separate',
  'decision from sponsored downtime mode.',
  '',
  'Disable anytime: ruflo proxy power-saver-disable',
].join('\n');

const powerSaverEnableSub: Command = {
  name: 'power-saver-enable',
  description: 'Opt into power saver mode — route everyday requests through your own Cognitum account (ADR-314)',
  options: [
    { name: 'yes', description: 'Skip the confirmation prompt', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    if (hasConsent('power-saver')) {
      output.writeln('Power saver mode is already enabled.');
      return { success: true, data: { alreadyEnabled: true } };
    }
    output.writeln(POWER_SAVER_DISCLOSURE);
    output.writeln('');
    if (!ctx.flags.yes) {
      output.writeln('Re-run with --yes to confirm: ruflo proxy power-saver-enable --yes');
      return { success: true, data: { confirmed: false } };
    }
    recordConsent('power-saver', true, 'proxy-power-saver-enable');
    writePowerSaverConsentMirror(true);
    recordFunnelEvent('power_saver_enabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Power saver mode enabled.');
    output.writeln('Flag it active with: ruflo settings notices quota-low');
    output.writeln('Disable anytime: ruflo proxy power-saver-disable');
    return { success: true, data: { confirmed: true } };
  },
};

const powerSaverDisableSub: Command = {
  name: 'power-saver-disable',
  description: 'Revoke power-saver consent and stop routing through Cognitum for cost savings',
  action: async (): Promise<CommandResult> => {
    revokeConsent('power-saver', 'proxy-power-saver-disable');
    writePowerSaverConsentMirror(false);
    recordFunnelEvent('power_saver_disabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Power saver mode disabled.');
    return { success: true };
  },
};

const powerSaverStatusSub: Command = {
  name: 'power-saver-status',
  description: 'Show power-saver consent + quota-low flag state',
  action: async (): Promise<CommandResult> => {
    const consented = hasConsent('power-saver');
    const quotaLow = readQuotaLowStatus();
    output.writeln(`Power saver consent: ${consented ? 'granted' : 'not granted'}`);
    output.writeln(`Quota-low flag: ${quotaLow.low ? `set (since ${quotaLow.since})` : 'not set'}`);
    if (quotaLow.low && !consented) {
      output.writeln('');
      output.writeln('You are flagged as running low but have not enabled power saver');
      output.writeln('mode. Enable it with: ruflo proxy power-saver-enable --yes');
    }
    return { success: true, data: { consented, quotaLow } };
  },
};

/** Convenience: clear the quota-low flag once you're back to normal. */
const powerSaverClearSub: Command = {
  name: 'power-saver-clear',
  description: 'Clear the quota-low flag',
  action: async (): Promise<CommandResult> => {
    const changed = clearQuotaLowStatus();
    if (!changed) {
      output.printError('Quota-low flag was just toggled — try again in a few minutes (ADR-314 anti-abuse cooldown).');
      return { success: false };
    }
    output.printSuccess('Quota-low flag cleared.');
    return { success: true };
  },
};

const TRAINING_SHARE_DISCLOSURE = [
  'Enabling training-data sharing.',
  '',
  'When a request runs on the sponsored plane, the proxy will attach a',
  'consent header telling Cognitum it may retain that interaction —',
  '(post safety-scan) — as input to its MicroLoRA training pipeline',
  '(meta-llm ADR-251), gated through its existing SHADOW/promotion-rule',
  'safety net; adaptations are never auto-served. This is content, not',
  'just metadata, and is entirely separate from sponsored-downtime',
  'consent — using free capacity never implicitly means this is on.',
  '',
  'Declining has zero effect on sponsored-capacity access.',
  '',
  'Disable anytime: ruflo proxy training-share-disable',
].join('\n');

const trainingShareEnableSub: Command = {
  name: 'training-share-enable',
  description: 'Opt into sharing sponsored-plane interaction content for meta-llm training (ADR-315)',
  options: [
    { name: 'yes', description: 'Skip the confirmation prompt', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    if (hasConsent('training-data-sharing')) {
      output.writeln('Training-data sharing is already enabled.');
      return { success: true, data: { alreadyEnabled: true } };
    }
    output.writeln(TRAINING_SHARE_DISCLOSURE);
    output.writeln('');
    if (!ctx.flags.yes) {
      output.writeln('Re-run with --yes to confirm: ruflo proxy training-share-enable --yes');
      return { success: true, data: { confirmed: false } };
    }
    recordConsent('training-data-sharing', true, 'proxy-training-share-enable');
    writeTrainingShareConsentMirror(true);
    recordFunnelEvent('training_share_enabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Training-data sharing enabled.');
    output.writeln('Only sponsored-plane requests carry the consent header. Disable anytime:');
    output.writeln('  ruflo proxy training-share-disable');
    return { success: true, data: { confirmed: true } };
  },
};

const trainingShareDisableSub: Command = {
  name: 'training-share-disable',
  description: 'Revoke training-data-sharing consent — stop sending the training consent header',
  action: async (): Promise<CommandResult> => {
    revokeConsent('training-data-sharing', 'proxy-training-share-disable');
    writeTrainingShareConsentMirror(false);
    recordFunnelEvent('training_share_disabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Training-data sharing disabled.');
    return { success: true };
  },
};

const trainingShareStatusSub: Command = {
  name: 'training-share-status',
  description: 'Show training-data-sharing consent state',
  action: async (): Promise<CommandResult> => {
    const consented = hasConsent('training-data-sharing');
    output.writeln(`Training-data sharing consent: ${consented ? 'granted' : 'not granted'}`);
    if (consented) {
      output.writeln('Sponsored-plane requests carry X-Cognitum-Training-Consent: true.');
    }
    return { success: true, data: { consented } };
  },
};

export const proxyCommand: Command = {
  name: 'proxy',
  description: 'Meta LLM Proxy — sponsored downtime + power saver + training-data sharing (ADR-304/307/313/314/315)',
  subcommands: [
    sponsorEnableSub, sponsorDisableSub, sponsorStatusSub, sponsorClearSub,
    powerSaverEnableSub, powerSaverDisableSub, powerSaverStatusSub, powerSaverClearSub,
    trainingShareEnableSub, trainingShareDisableSub, trainingShareStatusSub,
  ],
  examples: [
    { command: 'ruflo proxy sponsor-status', description: 'Show current sponsored-mode state' },
    { command: 'ruflo proxy sponsor-enable --yes', description: 'Opt into sponsored downtime capacity' },
    { command: 'ruflo proxy power-saver-enable --yes', description: 'Opt into power saver mode' },
    { command: 'ruflo proxy training-share-enable --yes', description: 'Opt into training-data sharing (ADR-315)' },
  ],
  action: sponsorStatusSub.action,
};

export default proxyCommand;
