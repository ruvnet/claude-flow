/**
 * `ruflo funnel` — user control surface for the Cognitum lifecycle funnel
 * (ADR-301/305/309).
 *
 *   funnel status    effective state and which precedence source decided it
 *   funnel disable   user-level opt-out (all surfaces) + delete funnel data
 *   funnel enable    re-enable at the user tier (cannot override env/enterprise)
 *   funnel id        print the pseudonymous funnel ID, if one exists
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  deleteFunnelData,
  funnelStateDir,
  getDisclosure,
  getFunnelId,
  readConsents,
  recordDisclosureDeclined,
  recordDisclosureReenabled,
  resolveFunnelEnabled,
} from '../funnel/index.js';
import { readStateJson, writeStateJson } from '../funnel/state.js';

function setUserConfigEnabled(enabled: boolean): void {
  const cfg = readStateJson<Record<string, unknown>>('funnel.json') ?? {};
  cfg.enabled = enabled;
  writeStateJson('funnel.json', cfg);
}

const statusSub: Command = {
  name: 'status',
  description: 'Show effective funnel state and which source decided it',
  options: [
    { name: 'json', description: 'Output as JSON', type: 'boolean', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const decision = resolveFunnelEnabled();
    const disclosure = getDisclosure();
    const consents = readConsents();
    const data = {
      enabled: decision.enabled,
      decidedBy: decision.decidedBy,
      disclosure: disclosure.state,
      stateDir: funnelStateDir(),
      consents,
    };
    if (ctx.flags.json) {
      output.printJson(data);
    } else {
      output.writeln(`Funnel: ${decision.enabled ? 'enabled' : 'disabled'} (decided by: ${decision.decidedBy})`);
      output.writeln(`Disclosure: ${disclosure.state}`);
      output.writeln(`State dir: ${funnelStateDir()}`);
      const domains = Object.keys(consents);
      output.writeln(
        domains.length
          ? `Consents: ${domains.map((d) => `${d}=${(consents as Record<string, { granted?: boolean }>)[d]?.granted ? 'granted' : 'declined'}`).join(', ')}`
          : 'Consents: none recorded'
      );
    }
    return { success: true, data };
  },
};

const disableSub: Command = {
  name: 'disable',
  description: 'Disable all funnel surfaces (user-level, persists across projects)',
  action: async (): Promise<CommandResult> => {
    setUserConfigEnabled(false);
    recordDisclosureDeclined();
    deleteFunnelData(); // opt-out deletes the pseudonymous ID + local event queue
    output.printSuccess('Funnel disabled. All promotional surfaces are off; local funnel data deleted.');
    return { success: true };
  },
};

const enableSub: Command = {
  name: 'enable',
  description: 'Re-enable funnel surfaces at the user tier (env/enterprise disables still win)',
  action: async (): Promise<CommandResult> => {
    setUserConfigEnabled(true);
    recordDisclosureReenabled();
    const decision = resolveFunnelEnabled();
    if (decision.enabled) {
      output.printSuccess('Funnel enabled.');
    } else {
      // A lower-precedence source never overrides a higher-precedence disable.
      output.printWarning(
        `User preference recorded, but the funnel stays disabled by a higher-precedence source: ${decision.decidedBy}`
      );
    }
    return { success: true, data: decision };
  },
};

const idSub: Command = {
  name: 'id',
  description: 'Print the pseudonymous funnel ID (exists only with telemetry consent)',
  action: async (): Promise<CommandResult> => {
    const id = getFunnelId();
    if (id) {
      output.writeln(id);
    } else {
      output.writeln('No funnel ID (telemetry consent not granted, or funnel data deleted).');
    }
    return { success: true, data: { id } };
  },
};

export const funnelCommand: Command = {
  name: 'funnel',
  description: 'Control the Cognitum lifecycle funnel surfaces (tips, enrollment, notices)',
  subcommands: [statusSub, disableSub, enableSub, idSub],
  examples: [
    { command: 'ruflo funnel status', description: 'Effective state + deciding source' },
    { command: 'ruflo funnel disable', description: 'Turn off every funnel surface' },
  ],
  action: statusSub.action,
};

export default funnelCommand;
