/**
 * `ruflo settings` — user-facing preferences router (ADR-311 amendment).
 *
 * The name change from `ruflo funnel …` is deliberate copy discipline:
 * "funnel" is internal analytics terminology; it should not appear in the
 * command surface end users see. Every subcommand here forwards to the
 * existing `ruflo funnel` primitives so behavior stays identical — this
 * is a friendlier wrapper, not a re-implementation.
 *
 * Subcommands:
 *   ruflo settings                     Show effective settings + how to change them
 *   ruflo settings notices status      Show whether the notices row is on
 *   ruflo settings notices off         Turn off the notices row (persistent)
 *   ruflo settings notices on          Re-enable the notices row
 *   ruflo settings notices id          Show the pseudonymous notices id
 */

import type { Command, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  deleteFunnelData,
  funnelStateDir,
  getDisclosure,
  getFunnelId,
  hasConsent,
  readConsents,
  recordDisclosureDeclined,
  recordDisclosureReenabled,
  resolveFunnelEnabled,
} from '../funnel/index.js';
import { readStateJson, writeStateJson } from '../funnel/state.js';
import {
  clearRateLimitStatus,
  markRateLimited,
  rateLimitNotice,
  readRateLimitStatus,
} from '../funnel/rate-limit-notifier.js';
import {
  clearQuotaLowStatus,
  markQuotaLow,
  quotaLowNotice,
  readQuotaLowStatus,
} from '../funnel/power-saver-notifier.js';

function setUserConfigEnabled(enabled: boolean): void {
  const cfg = readStateJson<Record<string, unknown>>('funnel.json') ?? {};
  cfg.enabled = enabled;
  writeStateJson('funnel.json', cfg);
}

const noticesStatusSub: Command = {
  name: 'status',
  description: 'Show whether notices are on and which source decided it',
  action: async (): Promise<CommandResult> => {
    const decision = resolveFunnelEnabled();
    const disclosure = getDisclosure();
    output.writeln(`Notices: ${decision.enabled ? 'enabled' : 'disabled'} (decided by: ${decision.decidedBy})`);
    output.writeln(`Disclosure: ${disclosure.state}`);
    output.writeln(`Telemetry: ${hasConsent('telemetry') ? 'consent granted' : 'no consent'}`);
    return { success: true, data: { decision, disclosure: disclosure.state } };
  },
};

const noticesOffSub: Command = {
  name: 'off',
  description: 'Turn off statusline notices (persistent, user-level)',
  action: async (): Promise<CommandResult> => {
    setUserConfigEnabled(false);
    recordDisclosureDeclined();
    deleteFunnelData();
    output.printSuccess('Notices disabled. Local notice data deleted.');
    return { success: true };
  },
};

const noticesOnSub: Command = {
  name: 'on',
  description: 'Re-enable statusline notices',
  action: async (): Promise<CommandResult> => {
    setUserConfigEnabled(true);
    recordDisclosureReenabled();
    const decision = resolveFunnelEnabled();
    if (decision.enabled) {
      output.printSuccess('Notices enabled.');
    } else {
      output.printWarning(
        `User preference recorded, but notices stay off (decided by: ${decision.decidedBy})`,
      );
    }
    return { success: true, data: decision };
  },
};

const noticesIdSub: Command = {
  name: 'id',
  description: 'Print the pseudonymous notices ID (telemetry consent required)',
  action: async (): Promise<CommandResult> => {
    const id = getFunnelId();
    output.writeln(id ?? '(no id — telemetry consent not granted, or notices are off)');
    return { success: true, data: { id } };
  },
};

const rateLimitedSub: Command = {
  name: 'rate-limited',
  description: 'Manually flag that you have hit a Claude usage limit (ADR-312 Phase 0)',
  options: [
    { name: 'clear', description: 'Clear the flag', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    if (ctx.flags.clear) {
      const changed = clearRateLimitStatus();
      if (!changed) {
        output.printError('Rate-limit flag was just toggled — try again in a few minutes (ADR-314 anti-abuse cooldown).');
        return { success: false };
      }
      output.printSuccess('Rate-limit flag cleared.');
      return { success: true };
    }
    const changed = markRateLimited();
    if (!changed) {
      output.printError('Rate-limit flag was just toggled — try again in a few minutes (ADR-314 anti-abuse cooldown).');
      return { success: false };
    }
    output.printSuccess('Rate-limit flag set.');
    output.writeln('');
    output.writeln('This is a manual, self-reported flag — ruflo cannot detect Claude\'s');
    output.writeln('usage-limit state automatically today (see ADR-312). While flagged,');
    output.writeln('the notices row may suggest sponsored Cognitum capacity as a bridge');
    output.writeln('until your own limit resets: ruflo proxy sponsor-enable');
    output.writeln('');
    output.writeln('Clear it any time: ruflo settings notices rate-limited --clear');
    const notice = rateLimitNotice();
    return { success: true, data: { notice, status: readRateLimitStatus() } };
  },
};

const quotaLowSub: Command = {
  name: 'quota-low',
  description: 'Manually flag that your Claude quota is running low (ADR-314 power saver)',
  options: [
    { name: 'clear', description: 'Clear the flag', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    if (ctx.flags.clear) {
      const changed = clearQuotaLowStatus();
      if (!changed) {
        output.printError('Quota-low flag was just toggled — try again in a few minutes (ADR-314 anti-abuse cooldown).');
        return { success: false };
      }
      output.printSuccess('Quota-low flag cleared.');
      return { success: true };
    }
    const changed = markQuotaLow();
    if (!changed) {
      output.printError('Quota-low flag was just toggled — try again in a few minutes (ADR-314 anti-abuse cooldown).');
      return { success: false };
    }
    output.printSuccess('Quota-low flag set.');
    output.writeln('');
    output.writeln('This is a manual, self-reported flag — ruflo cannot read your actual');
    output.writeln('quota percentage today (see ADR-312/314). While flagged, and once you');
    output.writeln('enable power saver mode, everyday requests route through Cognitum\'s');
    output.writeln('own difficulty-based router (billed to your own Cognitum account):');
    output.writeln('  ruflo proxy power-saver-enable');
    output.writeln('');
    output.writeln('Clear it any time: ruflo settings notices quota-low --clear');
    const notice = quotaLowNotice();
    return { success: true, data: { notice, status: readQuotaLowStatus() } };
  },
};

const noticesCommand: Command = {
  name: 'notices',
  description: 'Control the statusline notices row',
  subcommands: [noticesStatusSub, noticesOffSub, noticesOnSub, noticesIdSub, rateLimitedSub, quotaLowSub],
  action: noticesStatusSub.action,
};

const overviewAction: Command['action'] = async (): Promise<CommandResult> => {
  const decision = resolveFunnelEnabled();
  const disclosure = getDisclosure();
  const consents = readConsents();
  output.writeln('ruflo settings — user preferences');
  output.writeln('');
  output.writeln('Notices (statusline tips + product updates)');
  output.writeln('  ruflo settings notices status    Show current state');
  output.writeln('  ruflo settings notices off       Turn off all notices');
  output.writeln('  ruflo settings notices on        Re-enable');
  output.writeln('  ruflo settings notices id        Show pseudonymous notices id');
  output.writeln('');
  output.writeln(`  current: ${decision.enabled ? 'enabled' : 'disabled'} (${decision.decidedBy})`);
  output.writeln(`  disclosure: ${disclosure.state}`);
  const domains = Object.keys(consents);
  if (domains.length) {
    output.writeln(`  consents: ${domains.join(', ')}`);
  }
  output.writeln(`  state dir: ${funnelStateDir()}`);
  return { success: true, data: { decision, disclosure: disclosure.state, consents } };
};

export const settingsCommand: Command = {
  name: 'settings',
  description: 'View and change user preferences (notices, consents)',
  subcommands: [noticesCommand],
  examples: [
    { command: 'ruflo settings', description: 'Overview + current state' },
    { command: 'ruflo settings notices off', description: 'Turn off statusline notices' },
    { command: 'ruflo settings notices status', description: 'Show current notices state' },
  ],
  action: overviewAction,
};

