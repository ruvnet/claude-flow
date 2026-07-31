/**
 * V3 CLI `ruflo transport use slim` — ADR-380 §2.
 *
 * Switches the active swarm/hive-mind coordination transport from today's
 * in-process/local-hooks routing to SLIM (secure messaging for MCP/A2A,
 * hierarchical routing, group membership, MLS encryption) for agents
 * coordinating across hosts or across a tenant boundary.
 *
 * Local transport stays the default. This command is a NO-OP on the local
 * path unless an operator has both set {@link AGNTCY_ENDPOINT_ENV} AND
 * installed the (not-yet-published) optional runtime package — see
 * runtime.ts for the full graceful-degradation contract.
 *
 * NOT WIRED INTO THE MAIN CLI ROUTER YET. This file is exported for a
 * later integration pass to attach as a new top-level `transport` command
 * (or a subcommand of one, per the open question in ADR-380 §"Open
 * Questions" about per-swarm vs. global scope).
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import {
  AGNTCY_NOT_CONFIGURED_MESSAGE,
  AGNTCY_PACKAGE_NAME,
  detectAgntcyRuntime,
} from './runtime.js';

/** Transport names this command currently recognizes. Only 'slim' per ADR-380 §2. */
const SUPPORTED_TRANSPORTS = new Set(['slim']);

interface AgntcySlimRuntimeModule {
  createSlimTransport?: (opts: { endpoint: string }) => Promise<unknown>;
}

const useCommand: Command = {
  name: 'use',
  description: 'Switch the active swarm/hive-mind transport (e.g. slim) — ADR-380 §2',
  examples: [
    { command: 'ruflo transport use slim', description: 'Switch coordination transport to SLIM (opt-in, degrades to local)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const requested = (ctx.args[0] || (ctx.flags.transport as string) || '').trim().toLowerCase();

    if (!requested) {
      output.printError('Transport name required. Usage: ruflo transport use <name> (e.g. slim)');
      return { success: false, exitCode: 1 };
    }

    if (!SUPPORTED_TRANSPORTS.has(requested)) {
      output.printError(
        `Unknown transport "${requested}". Supported: ${Array.from(SUPPORTED_TRANSPORTS).join(', ')}.`,
      );
      output.printInfo('Local transport remains the default and needs no explicit "use".');
      return { success: false, exitCode: 1 };
    }

    const status = await detectAgntcyRuntime();

    if (!status.configured) {
      output.printInfo(AGNTCY_NOT_CONFIGURED_MESSAGE);
      output.printInfo('Active transport remains: local (in-process hooks routing).');
      return {
        success: true,
        data: { transport: 'local', requested, configured: false, reason: status.reason },
      };
    }

    // Reachable only once the optional package is actually installed AND
    // an endpoint is configured — not possible today (package unpublished).
    try {
      const mod = (await import(AGNTCY_PACKAGE_NAME)) as AgntcySlimRuntimeModule;
      if (typeof mod.createSlimTransport !== 'function') {
        throw new Error(`"${AGNTCY_PACKAGE_NAME}" is installed but does not export createSlimTransport()`);
      }
      await mod.createSlimTransport({ endpoint: status.endpoint as string });
      output.printSuccess(`Active transport switched to: slim (${status.endpoint})`);
      return { success: true, data: { transport: 'slim', endpoint: status.endpoint, configured: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`Failed to activate SLIM transport: ${message}`);
      output.printInfo('Falling back to local transport.');
      return { success: true, data: { transport: 'local', requested, configured: false, error: message } };
    }
  },
};

export const transportCommand: Command = {
  name: 'transport',
  description: 'Manage the active swarm/hive-mind coordination transport (ADR-380 §2)',
  subcommands: [useCommand],
  examples: [
    { command: 'ruflo transport use slim', description: 'Switch coordination transport to SLIM' },
  ],
  action: async (): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('AGNTCY/SLIM Transport'));
    output.writeln(output.dim('='.repeat(60)));
    output.writeln();
    output.printBox(
      [
        'Local transport (in-process hooks routing) is the default.',
        '',
        'Subcommands:',
        '',
        '  use <name>   Switch the active transport (currently: slim)',
        '',
        `See ADR-380 for setup: v3/docs/adr/ADR-380-agntcy-outshift-runtime-integration.md`,
      ].join('\n'),
      'AGNTCY/SLIM Transport',
    );
    output.writeln();
    return { success: true };
  },
};

export { useCommand };
export default transportCommand;
