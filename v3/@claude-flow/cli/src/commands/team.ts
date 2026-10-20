/**
 * `ruflo team` — non-MCP interface to the host-agnostic Agent Teams bus
 * (ADR-402).
 *
 *   team <verb> --params '<json>'   call a team_* handler in-process, print JSON
 *   team run --team T --agent A     run a member's exec plan (Codex, command host)
 *   team hook-stop --host H         native stop hook → team_on_stop (always exits 0)
 *   team trust-host <label>         allow `team run` to execute a team-hosts.json entry
 */

import type { Command, CommandContext, CommandResult } from '../types.js';

const VERBS: Record<string, string> = {
  create: 'team_create',
  spawn: 'team_spawn',
  send: 'team_send',
  inbox: 'team_inbox',
  broadcast: 'team_broadcast',
  plan: 'team_plan',
  status: 'team_status',
  'on-stop': 'team_on_stop',
  shutdown: 'team_shutdown',
};

function printJson(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function verbCommand(verb: string, toolName: string): Command {
  return {
    name: verb,
    description: `Call ${toolName} with --params JSON and print the result`,
    options: [
      { name: 'params', description: 'Tool input as a JSON object', type: 'string', default: '{}' },
    ],
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      let input: Record<string, unknown>;
      try {
        const raw = ctx.flags.params;
        input = typeof raw === 'string' ? JSON.parse(raw) : {};
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('not an object');
      } catch (err) {
        printJson({ success: false, error: `--params must be a JSON object (${err instanceof Error ? err.message : String(err)})` });
        return { success: false, exitCode: 1 };
      }
      const { teamTools } = await import('../mcp-tools/team-tools.js');
      const t = teamTools.find((x) => x.name === toolName);
      if (!t) {
        printJson({ success: false, error: `${toolName} not registered` });
        return { success: false, exitCode: 1 };
      }
      let result: Record<string, unknown>;
      try {
        result = (await t.handler(input)) as Record<string, unknown>;
      } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
      printJson(result);
      return result.success === false ? { success: false, exitCode: 1 } : { success: true };
    },
  };
}

const runCommand: Command = {
  name: 'run',
  description: "Run a registered member's exec plan (codex exec or a command host) and advance the team",
  options: [
    { name: 'team', description: 'Team name', type: 'string', required: true },
    { name: 'agent', description: 'Agent name (registered with team_spawn)', type: 'string', required: true },
    { name: 'host', description: 'Host label (default: the team host)', type: 'string' },
    { name: 'timeout', description: 'Timeout in ms (default 1800000)', type: 'number' },
    { name: 'max-output', description: 'Max captured stdout/stderr bytes (default 1048576)', type: 'number' },
    { name: 'dry-run', description: 'Print the resolved command and exit without running it', type: 'boolean' },
    { name: 'json', description: 'Print the full result as JSON', type: 'boolean' },
  ],
  examples: [
    { command: 'ruflo team run --team demo --agent reviewer --host codex', description: 'Run one Codex turn for "reviewer"' },
    { command: 'ruflo team run --team demo --agent reviewer --dry-run', description: 'Show the argv without running it' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { runTeamAgent } = await import('../mcp-tools/team-runner.js');
    const f = ctx.flags;
    const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
    const result = await runTeamAgent({
      team: String(f.team ?? ''),
      agent: String(f.agent ?? ''),
      host: f.host === undefined ? undefined : String(f.host),
      timeoutMs: num(f.timeout),
      maxOutputBytes: num(f.maxOutput),
      dryRun: f.dryRun === true,
    });
    if (f.json || f.dryRun || result.error) {
      printJson(result.dryRun ? { ...result.dryRun, warnings: result.warnings } : result);
    } else {
      process.stdout.write(
        `${result.outcome}: ${result.runFile}${result.reason ? ` (${result.reason})` : ''}\n`,
      );
    }
    return result.success ? { success: true } : { success: false, exitCode: result.exitCode || 1 };
  },
};

export interface HookPayloadRead {
  raw: string;
  /** The writer closed stdin. False means the read gave up waiting. */
  ended: boolean;
}

/**
 * Read a hook payload until the writer closes stdin. Gives up when nothing
 * arrives within `firstByteMs` (no payload), or `maxMs` after the start (a
 * stuck writer), so a hook can never hang its host.
 */
export function readHookPayload(
  stream: NodeJS.ReadableStream & { isTTY?: boolean },
  opts: { firstByteMs?: number; maxMs?: number } = {},
): Promise<HookPayloadRead> {
  const firstByteMs = opts.firstByteMs ?? 2000;
  const maxMs = opts.maxMs ?? 10_000;
  return new Promise((resolve) => {
    if (stream.isTTY) return resolve({ raw: '', ended: true });
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (ended: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(first);
      clearTimeout(cap);
      stream.removeListener('data', onData);
      stream.pause();
      resolve({ raw: Buffer.concat(chunks).toString('utf8'), ended });
    };
    const onData = (c: Buffer | string) => {
      clearTimeout(first);
      chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
    };
    const first = setTimeout(() => { if (!chunks.length) done(false); }, firstByteMs);
    const cap = setTimeout(() => done(false), maxMs);
    stream.on('data', onData);
    stream.once('end', () => done(true));
    stream.once('error', () => done(false));
    stream.resume();
  });
}

/**
 * Parse a hook payload. An empty payload is `{}` (identity then comes from
 * the environment); anything else must be a JSON object, or the stop is not
 * recorded and the reason is returned.
 */
export function parseHookPayload(read: HookPayloadRead): { payload: unknown } | { error: string } {
  if (!read.raw.trim()) return { payload: {} };
  try {
    const payload = JSON.parse(read.raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'hook payload is not a JSON object' };
    return { payload };
  } catch (err) {
    const why = read.ended ? 'is not valid JSON' : 'was still incomplete when the read timed out';
    return { error: `hook payload ${why} (${read.raw.length} bytes; ${err instanceof Error ? err.message : String(err)})` };
  }
}

const hookStopCommand: Command = {
  name: 'hook-stop',
  description: 'Stop-hook entry point: read the hook JSON on stdin and call team_on_stop. Always exits 0.',
  options: [
    { name: 'host', description: 'Host id whose payload shape to read (grok, claude, codex, command)', type: 'string', default: 'claude' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const parsed = parseHookPayload(await readHookPayload(process.stdin));
      if ('error' in parsed) {
        // Fail open, but never silently: the host shows hook stderr.
        process.stderr.write(`ruflo team hook-stop: stop not recorded: ${parsed.error}\n`);
        return { success: true };
      }
      const { hookStop } = await import('../mcp-tools/team-runner.js');
      const r = await hookStop(String(ctx.flags.host || 'claude'), parsed.payload);
      if (!r.handled && r.reason) process.stderr.write(`ruflo team hook-stop: stop not recorded: ${r.reason}\n`);
      if (process.env.RUFLO_TEAM_HOOK_DEBUG) printJson(r);
    } catch (err) {
      /* fail-open: a hook must never block the host */
      process.stderr.write(`ruflo team hook-stop: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    return { success: true };
  },
};

const trustHostCommand: Command = {
  name: 'trust-host',
  description:
    'Trust one command host from .claude-flow/team-hosts.json for this project, so `team run` may execute it. ' +
    'Trust is stored in your home directory and tied to the exact entry.',
  options: [
    { name: 'allow-unsafe-command', description: 'Also allow a shell, a command wrapper, or a path as the command', type: 'boolean' },
    { name: 'revoke', description: 'Remove the trust record instead', type: 'boolean' },
  ],
  examples: [
    { command: 'ruflo team trust-host myagent', description: 'Trust the "myagent" entry as it is now' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const label = String(ctx.args[0] ?? '');
    const { getProjectCwd } = await import('../mcp-tools/types.js');
    const hosts = await import('../mcp-tools/team-hosts/index.js');
    const root = getProjectCwd();
    let cfg;
    try {
      cfg = hosts.loadTeamHosts(root, [...Object.keys(hosts.BUILT_IN_HOSTS), 'command'])[label];
    } catch (err) {
      printJson({ success: false, error: err instanceof Error ? err.message : String(err) });
      return { success: false, exitCode: 1 };
    }
    if (!cfg) {
      printJson({ success: false, error: `No command host "${label}" in ${hosts.TEAM_HOSTS_FILE} (usage: ruflo team trust-host <label>)` });
      return { success: false, exitCode: 1 };
    }
    const unsafe = hosts.unsafeCommandReason(cfg.command);
    if (unsafe && !ctx.flags.allowUnsafeCommand && !ctx.flags.revoke) {
      printJson({
        success: false,
        error: `Command "${cfg.command}" is ${unsafe}. Re-run with --allow-unsafe-command if you wrote this entry and mean it.`,
        host: cfg,
      });
      return { success: false, exitCode: 1 };
    }
    // Look-before-you-trust (#3513 MEDIUM B): show the resolved entry — the
    // exact command, args, passEnv and isolation that a future `team run`
    // will execute — BEFORE persisting the trust record, not after. A user
    // piping this through a pager or a CI log sees what they are trusting
    // in time to Ctrl-C, rather than a record that already exists on disk.
    if (!ctx.flags.revoke) {
      printJson({ preview: true, label, host: cfg, unsafe: unsafe ?? null, action: 'about to trust' });
    }
    const entry = hosts.recordTrust(root, label, cfg, {
      allowUnsafeCommand: ctx.flags.allowUnsafeCommand === true,
      revoke: ctx.flags.revoke === true,
    });
    printJson({ success: true, action: ctx.flags.revoke ? 'revoked' : 'trusted', label, host: cfg, record: entry, file: hosts.trustFilePath() });
    return { success: true };
  },
};

export const teamCommand: Command = {
  name: 'team',
  description: 'Host-agnostic Agent Teams bus (ADR-402): call team_* handlers, run exec hosts, handle stop hooks',
  subcommands: [
    ...Object.entries(VERBS).map(([verb, toolName]) => verbCommand(verb, toolName)),
    runCommand,
    hookStopCommand,
    trustHostCommand,
  ],
  examples: [
    { command: `ruflo team create --params '{"name":"demo","host":"codex"}'`, description: 'Create a team' },
    { command: 'ruflo team run --team demo --agent reviewer', description: 'Run a Codex or command-host member' },
    { command: 'ruflo team hook-stop --host grok', description: 'Stop-hook entry (reads hook JSON on stdin)' },
  ],
};

export default teamCommand;
