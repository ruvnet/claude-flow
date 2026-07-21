/**
 * `ruflo advisor` — Fable co-pilot advisor tip in the statusline insight
 * ticker (ADR-316).
 *
 * Client-side only — unlike `proxy.ts`'s sponsored-downtime/power-saver/
 * training-share domains, this feature has NO proxy-config.toml mirror,
 * because it never talks to the meta-proxy Rust binary. It calls
 * `claude -p` directly via services/fable-harness.ts (ADR-172's existing
 * cost-disciplined harness) and caches the result for the insight ticker
 * (funnel/insights.ts) to read synchronously.
 */

import type { Command, CommandResult } from '../types.js';
import { output } from '../output.js';
import { hasConsent, recordConsent, revokeConsent } from '../funnel/consent.js';
import { recordFunnelEvent } from '../funnel/events.js';
import { getInstalledCliVersion } from '../init/helper-refresh.js';
import { readAdvisorTip, ADVISOR_DEFAULT_BUDGET_USD } from '../funnel/advisor-tip.js';

const ADVISOR_DISCLOSURE = [
  'Enabling the co-pilot advisor tip.',
  '',
  'At most once per day, ruflo will send a small STRUCTURAL snapshot of your',
  'session — security scan status, swarm/agent state, git uncommitted-file',
  'COUNT — never raw prompts, file contents, or commands — to a headless',
  'Fable model (via `claude -p`) and cache one short, actionable tip for the',
  'statusline insight ticker.',
  '',
  `This is a real, metered API call (~$${ADVISOR_DEFAULT_BUDGET_USD.toFixed(2)} budget cap per`,
  'refresh, at most once/day). Disable anytime: ruflo advisor disable',
].join('\n');

const enableSub: Command = {
  name: 'enable',
  description: 'Opt into the co-pilot advisor tip (ADR-316)',
  options: [
    { name: 'yes', description: 'Skip the confirmation prompt', type: 'boolean', default: false },
  ],
  action: async (ctx): Promise<CommandResult> => {
    if (hasConsent('advisor-tips')) {
      output.writeln('Advisor tip is already enabled.');
      return { success: true, data: { alreadyEnabled: true } };
    }
    output.writeln(ADVISOR_DISCLOSURE);
    output.writeln('');
    if (!ctx.flags.yes) {
      output.writeln('Re-run with --yes to confirm: ruflo advisor enable --yes');
      return { success: true, data: { confirmed: false } };
    }
    recordConsent('advisor-tips', true, 'advisor-enable');
    recordFunnelEvent('advisor_tip_enabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Advisor tip enabled.');
    output.writeln('It refreshes at most once/day, in the background, on session-restore.');
    output.writeln('Disable anytime: ruflo advisor disable');
    return { success: true, data: { confirmed: true } };
  },
};

const disableSub: Command = {
  name: 'disable',
  description: 'Revoke advisor-tip consent and stop generating new tips',
  action: async (): Promise<CommandResult> => {
    revokeConsent('advisor-tips', 'advisor-disable');
    recordFunnelEvent('advisor_tip_disabled', 'statusline', getInstalledCliVersion());
    output.printSuccess('Advisor tip disabled.');
    return { success: true };
  },
};

const statusSub: Command = {
  name: 'status',
  description: 'Show advisor-tip consent state and the current cached tip',
  action: async (): Promise<CommandResult> => {
    const consented = hasConsent('advisor-tips');
    output.writeln(`Advisor tip consent: ${consented ? 'granted' : 'not granted'}`);
    const tip = consented ? readAdvisorTip() : null;
    if (tip) {
      output.writeln(`Current tip: ${tip.headline}`);
      if (tip.detail) output.writeln(`  ${tip.detail}`);
    } else if (consented) {
      output.writeln('No cached tip yet (refreshes at most once/day on session-restore).');
    }
    return { success: true, data: { consented, tip } };
  },
};

export const advisorCommand: Command = {
  name: 'advisor',
  description: 'Fable co-pilot advisor tip in the statusline insight ticker (ADR-316)',
  subcommands: [enableSub, disableSub, statusSub],
  examples: [
    { command: 'ruflo advisor enable --yes', description: 'Opt into the co-pilot advisor tip' },
    { command: 'ruflo advisor status', description: 'Show consent state + current cached tip' },
    { command: 'ruflo advisor disable', description: 'Revoke consent and stop generating tips' },
  ],
  action: statusSub.action,
};

export default advisorCommand;
