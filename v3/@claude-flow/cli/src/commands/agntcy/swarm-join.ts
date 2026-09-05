/**
 * V3 CLI `ruflo swarm join <namespace>` — ADR-380 §2.
 *
 * Joins a SLIM group-membership channel scoped to a Cognitum tenant/project
 * namespace (e.g. `cognitum/research/security`). This is an AGNTCY/SLIM
 * concept layered on top of — never a replacement for — this repo's own
 * `swarm_init`/`hive-mind_*` MCP-tool coordination, which remains the
 * default for single-host swarms per ADR-380 §2.
 *
 * NOT WIRED INTO THE MAIN CLI ROUTER YET. This file is exported for a
 * later integration pass to attach as a new subcommand of the existing
 * `swarm` command (`v3/@claude-flow/cli/src/commands/swarm.ts`).
 */

import type { Command, CommandContext, CommandResult } from '../../types.js';
import { output } from '../../output.js';
import {
  AGNTCY_NOT_CONFIGURED_MESSAGE,
  AGNTCY_PACKAGE_NAME,
  detectAgntcyRuntime,
} from './runtime.js';

/**
 * SLIM group-membership namespaces are slash-delimited (e.g.
 * `cognitum/research/security`), matching the ADR-380 §2 example. Validate
 * the shape locally — deterministic, no SDK required — before ever
 * attempting a network join.
 */
export function validateNamespace(namespace: string): { valid: boolean; error?: string } {
  if (!namespace || namespace.trim().length === 0) {
    return { valid: false, error: 'namespace must be a non-empty string' };
  }
  // Deliberately NOT filtering empty segments — a leading/trailing/double
  // slash (e.g. "cognitum//security") is a malformed namespace, not a
  // cosmetic one, and should be rejected rather than silently repaired.
  const segments = namespace.split('/');
  if (segments.length === 0) {
    return { valid: false, error: 'namespace must contain at least one segment' };
  }
  const validSegment = /^[a-zA-Z0-9_-]+$/;
  const bad = segments.find((s) => !validSegment.test(s));
  if (bad !== undefined) {
    return { valid: false, error: `invalid namespace segment "${bad}" — only [a-zA-Z0-9_-] allowed per segment` };
  }
  return { valid: true };
}

interface AgntcySlimGroupModule {
  joinGroup?: (opts: { endpoint: string; namespace: string }) => Promise<{ members?: number }>;
}

const joinCommand: Command = {
  name: 'join',
  description: 'Join a SLIM group-membership channel scoped to a namespace (ADR-380 §2)',
  examples: [
    { command: 'ruflo swarm join cognitum/research/security', description: 'Join the SLIM group-membership channel for a tenant namespace' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const namespace = (ctx.args[0] || (ctx.flags.namespace as string) || '').trim();

    if (!namespace) {
      output.printError('Namespace is required. Usage: ruflo swarm join <namespace> (e.g. cognitum/research/security)');
      return { success: false, exitCode: 1 };
    }

    const nsCheck = validateNamespace(namespace);
    if (!nsCheck.valid) {
      output.printError(`Invalid namespace "${namespace}": ${nsCheck.error}`);
      return { success: false, exitCode: 1 };
    }

    const status = await detectAgntcyRuntime();

    if (!status.configured) {
      output.printInfo(AGNTCY_NOT_CONFIGURED_MESSAGE);
      output.printInfo(
        `Namespace "${namespace}" was not joined via SLIM. Local swarm/hive-mind coordination ` +
          '(swarm_init / hive-mind_* MCP tools) remains available and unaffected.',
      );
      return {
        success: true,
        data: { joined: false, namespace, configured: false, reason: status.reason },
      };
    }

    try {
      const mod = (await import(AGNTCY_PACKAGE_NAME)) as AgntcySlimGroupModule;
      if (typeof mod.joinGroup !== 'function') {
        throw new Error(`"${AGNTCY_PACKAGE_NAME}" is installed but does not export joinGroup()`);
      }
      const result = await mod.joinGroup({ endpoint: status.endpoint as string, namespace });
      output.printSuccess(
        `Joined SLIM group "${namespace}"${typeof result?.members === 'number' ? ` (${result.members} members)` : ''}.`,
      );
      return { success: true, data: { joined: true, namespace, members: result?.members } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.printError(`SLIM group join failed: ${message}`);
      return { success: true, data: { joined: false, namespace, error: message } };
    }
  },
};

export { joinCommand as swarmJoinCommand };
export default joinCommand;
