/**
 * Live harness status.
 *
 * This is not `doctor` and not `status`. Those describe install health or
 * call tool handlers inside this process. `harness` reports what is already
 * running for this working tree: the host session, a live daemon pid, ruflo
 * MCP servers whose cwd is this tree, processes holding the memory databases
 * open, and teams that are still active.
 *
 *   ruflo harness
 *   ruflo harness --json
 *   ruflo harness --hook               # SessionStart payload for Codex (and Claude)
 *   ruflo harness --print-codex-hook   # opt-in .codex/hooks.json for this install
 *
 * `harness` is observe-only: bin/cli.js runs it through `runHarnessCli`
 * before the normal CLI starts, so no daemon autostart, update check, policy
 * migration or config adoption runs, and nothing is written to disk. The CLI
 * class also exempts it from those side effects (see OBSERVE_ONLY_COMMANDS).
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { collectLiveHarness, type LiveHarness } from '../services/live-harness.js';

export type { LiveHarness } from '../services/live-harness.js';
export { collectLiveHarness } from '../services/live-harness.js';

type Mode = 'text' | 'json' | 'hook' | 'codex-hook';

function renderText(report: LiveHarness): string {
  const out = [report.line];
  if (Object.keys(report.session).length) {
    out.push(`session ${Object.entries(report.session).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
  for (const server of report.mcp.servers) out.push(`mcp ${server.pid} ${server.command}`);
  if (report.memory.openPids?.length) out.push(`memory held by ${report.memory.openPids.join(',')}`);
  for (const team of report.teams) out.push(`team ${team.name} ${team.status} members=${team.members}`);
  if (report.staleTeams.length) out.push(`stale teams (no activity, not shut down) ${report.staleTeams.join(',')}`);
  return out.join('\n') + '\n';
}

function renderHook(report: LiveHarness): string {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: report.line },
  }) + '\n';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** This install's bin/cli.js, from dist/src/commands/harness.js (or src/commands). */
export function installedCliPath(moduleUrl: string = import.meta.url): string {
  return join(dirname(fileURLToPath(moduleUrl)), '..', '..', '..', 'bin', 'cli.js');
}

/**
 * A .codex/hooks.json that runs this install's harness on SessionStart. The
 * path is absolute, so the hook does not depend on the session's git root.
 * Autostart and the update check are off, and failures stay silent.
 */
export function codexHookConfig(cliPath: string = installedCliPath()): string {
  const command = `RUFLO_DAEMON_AUTOSTART=0 node ${shellQuote(cliPath)} harness --hook --no-update 2>/dev/null || true`;
  return JSON.stringify({
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact|fork',
          hooks: [{ type: 'command', command, timeout: 8 }],
        },
      ],
    },
  }, null, 2) + '\n';
}

function render(mode: Mode, collect: () => LiveHarness): { text: string; report?: LiveHarness } {
  if (mode === 'codex-hook') return { text: codexHookConfig() };
  const report = collect();
  if (mode === 'hook') return { text: renderHook(report), report };
  if (mode === 'json') return { text: JSON.stringify(report, null, 2) + '\n', report };
  return { text: renderText(report), report };
}

function modeOf(flags: { hook?: unknown; json?: unknown; printCodexHook?: unknown }): Mode {
  if (flags.printCodexHook) return 'codex-hook';
  if (flags.hook) return 'hook';
  if (flags.json) return 'json';
  return 'text';
}

/**
 * Entry used by bin/cli.js before the CLI class loads. Returns the exit code.
 * With --hook it never fails: on any error it prints nothing and returns 0,
 * so a SessionStart hook can't break a session.
 */
export function runHarnessCli(
  argv: string[],
  write: (text: string) => void = (text) => { process.stdout.write(text); },
  collect: () => LiveHarness = () => collectLiveHarness(),
): number {
  const mode = modeOf({
    hook: argv.includes('--hook'),
    json: argv.includes('--json'),
    printCodexHook: argv.includes('--print-codex-hook'),
  });
  try {
    write(render(mode, collect).text);
    return 0;
  } catch (error) {
    if (mode === 'hook') return 0;
    process.stderr.write(`ruflo harness: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export const harnessCommand: Command = {
  name: 'harness',
  description: 'Show the running harness for this tree (live pids and open state, not install config)',
  options: [
    { name: 'json', description: 'Print the live report as JSON', type: 'boolean', default: false },
    {
      name: 'hook',
      description: 'Print a SessionStart additionalContext payload for Codex or Claude',
      type: 'boolean',
      default: false,
    },
    {
      name: 'print-codex-hook',
      description: 'Print an opt-in .codex/hooks.json that runs this install on SessionStart',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    { command: 'ruflo harness', description: 'One line plus any live mcp, memory holders, and teams' },
    { command: 'ruflo harness --json', description: 'Machine-readable live report' },
    { command: 'ruflo harness --hook', description: 'SessionStart payload' },
    { command: 'ruflo harness --print-codex-hook > .codex/hooks.json', description: 'Opt in to the Codex SessionStart hook' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const mode = modeOf(ctx.flags as Record<string, unknown>);
    const { text, report } = render(mode, () => collectLiveHarness());
    process.stdout.write(text);
    return { success: true, data: report };
  },
};

export default harnessCommand;
