/**
 * Host registry: built-in adapters first, then labels declared in the
 * project's .claude-flow/team-hosts.json (served by the command adapter).
 * An unknown label is an error, never a silent fallback.
 */

import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { commandAdapter, loadTeamHosts, TeamHostsError } from './command.js';
import { grokAdapter } from './grok.js';
import { findTrust, unsafeCommandReason } from './trust.js';
import type { CommandHostConfig, TeamHostAdapter } from './types.js';

export const BUILT_IN_HOSTS: Record<string, TeamHostAdapter> = {
  grok: grokAdapter,
  claude: claudeAdapter,
  codex: codexAdapter,
};

const RESERVED = [...Object.keys(BUILT_IN_HOSTS), 'command'];

export interface ResolvedHost {
  label: string;
  adapter: TeamHostAdapter;
  hostConfig?: CommandHostConfig;
  /** Command hosts only: the user recorded trust for this exact entry. */
  trusted?: boolean;
}

/**
 * Resolve a host label for planning. Throws TeamHostsError when unknown or
 * invalid, or when a command host names a shell or a path and the user has
 * not trusted that entry with --allow-unsafe-command.
 */
export function resolveHost(label: string, projectRoot: string): ResolvedHost {
  const builtIn = BUILT_IN_HOSTS[label];
  if (builtIn) return { label, adapter: builtIn };
  const hosts = loadTeamHosts(projectRoot, RESERVED);
  const cfg = hosts[label];
  if (!cfg) {
    throw new TeamHostsError(
      `Unknown host "${label}". Built-in hosts: ${Object.keys(BUILT_IN_HOSTS).join(', ')}; ` +
        'declare others in .claude-flow/team-hosts.json',
    );
  }
  const unsafe = unsafeCommandReason(cfg.command);
  const trust = findTrust(projectRoot, label, cfg);
  if (unsafe && !trust?.allowUnsafeCommand) {
    throw new TeamHostsError(
      `team-hosts.json: host "${label}" command "${cfg.command}" is ${unsafe}. ` +
        `If you wrote this entry and want it, run \`ruflo team trust-host ${label} --allow-unsafe-command\`.`,
    );
  }
  return { label, adapter: commandAdapter, hostConfig: cfg, trusted: trust !== undefined };
}

/** Adapter for a stop hook. Labels that are not built in use the command adapter. */
export function getAdapter(label: string): TeamHostAdapter {
  return BUILT_IN_HOSTS[label] ?? commandAdapter;
}

export { claudeAdapter, codexAdapter, commandAdapter, grokAdapter, TeamHostsError };
export { codexExecSpec, CODEX_PASS_ENV } from './codex.js';
export { isProtectedEnvName, loadTeamHosts, parseTeamHosts, validateCommandHost, TEAM_HOSTS_FILE } from './command.js';
export { findTrust, hostConfigDigest, recordTrust, trustFilePath, unsafeCommandReason } from './trust.js';
export { labelTeam, normalizeAgentLabel, pickString } from './identity.js';
export * from './types.js';
