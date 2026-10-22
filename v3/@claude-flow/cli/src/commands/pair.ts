/**
 * `ruflo pair` — pair programming session state.
 *
 * The bundled `pair-programming` skill has told Claude Code to run
 * `claude-flow pair --start --mode tdd` since v2, but the v3 CLI never
 * shipped the command, so the skill's modes could not be activated or
 * switched. This restores a minimal, non-interactive version: the session
 * (mode, who currently drives, when roles last swapped) lives in
 * `.claude-flow/sessions/pair/current.json` in the project so both the human
 * and the agent can read it between turns. There is no REPL — Claude Code
 * cannot type into one — the agent reads `pair status --json` and behaves
 * according to the recorded mode and role.
 *
 * Legacy v2 spellings (`pair --start`, `--status`, `--end`, `--history`)
 * still work so existing skill docs and muscle memory keep functioning.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

export const PAIR_MODES = {
  driver: 'AI writes the code, human reviews and steers',
  navigator: 'Human writes the code, AI reviews and suggests',
  switch: 'Roles swap every --interval (default 10m)',
  tdd: 'Red-green-refactor; AI writes failing tests first',
  review: 'Read-only review of existing code, no edits without approval',
  mentor: 'AI explains every step and asks before acting',
  debug: 'Hypothesis-driven debugging; AI reproduces before fixing',
} as const;

export type PairMode = keyof typeof PAIR_MODES;
export type PairRole = 'driver' | 'navigator';

export interface PairSession {
  id: string;
  mode: PairMode;
  /** Who currently types. Always refers to the AI's role. */
  aiRole: PairRole;
  switchIntervalMinutes: number | null;
  startedAt: string;
  lastSwitchAt: string;
  switches: number;
  endedAt?: string;
}

const SESSION_DIR = ['.claude-flow', 'sessions', 'pair'];
const DEFAULT_SWITCH_INTERVAL_MINUTES = 10;

function sessionDir(cwd: string): string {
  return path.join(cwd, ...SESSION_DIR);
}

function currentPath(cwd: string): string {
  return path.join(sessionDir(cwd), 'current.json');
}

function historyPath(cwd: string): string {
  return path.join(sessionDir(cwd), 'history.jsonl');
}

export function readSession(cwd: string): PairSession | null {
  try {
    return JSON.parse(fs.readFileSync(currentPath(cwd), 'utf-8')) as PairSession;
  } catch {
    return null;
  }
}

function writeSession(cwd: string, session: PairSession): void {
  fs.mkdirSync(sessionDir(cwd), { recursive: true });
  const tmp = currentPath(cwd) + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, currentPath(cwd));
}

export function readHistory(cwd: string): PairSession[] {
  try {
    return fs.readFileSync(historyPath(cwd), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as PairSession);
  } catch {
    return [];
  }
}

/** Accepts `10`, `10m`, `1h`, `90s`; returns minutes or null when unparseable. */
export function parseIntervalMinutes(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') return raw > 0 ? raw : null;
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h)?$/i.exec(String(raw).trim());
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  const minutes = unit === 'h' ? value * 60 : unit === 's' ? value / 60 : value;
  return minutes > 0 ? minutes : null;
}

function isMode(value: unknown): value is PairMode {
  return typeof value === 'string' && value in PAIR_MODES;
}

function otherRole(role: PairRole): PairRole {
  return role === 'driver' ? 'navigator' : 'driver';
}

/** Default AI role implied by a mode, used when --role is not given. */
function defaultRoleFor(mode: PairMode): PairRole {
  return mode === 'navigator' || mode === 'review' ? 'navigator' : 'driver';
}

function switchDue(session: PairSession, now: Date): boolean {
  if (session.mode !== 'switch' || !session.switchIntervalMinutes) return false;
  const elapsedMinutes = (now.getTime() - new Date(session.lastSwitchAt).getTime()) / 60_000;
  return elapsedMinutes >= session.switchIntervalMinutes;
}

function describe(session: PairSession, now: Date): Record<string, unknown> {
  return {
    ...session,
    modeDescription: PAIR_MODES[session.mode],
    humanRole: otherRole(session.aiRole),
    switchDue: switchDue(session, now),
  };
}

function printSession(session: PairSession, now: Date): void {
  output.writeln(`Session:   ${session.id}`);
  output.writeln(`Mode:      ${session.mode} — ${PAIR_MODES[session.mode]}`);
  output.writeln(`AI role:   ${session.aiRole}   (human: ${otherRole(session.aiRole)})`);
  if (session.switchIntervalMinutes) {
    output.writeln(`Interval:  every ${session.switchIntervalMinutes}m, ${session.switches} switch(es) so far`);
    if (switchDue(session, now)) output.printWarning('Role switch is due — run `ruflo pair switch`.');
  }
  output.writeln(`Started:   ${session.startedAt}`);
}

function noSession(ctx: CommandContext): CommandResult {
  if (ctx.flags.json) output.printJson({ active: false });
  else output.writeln('No active pair session. Start one with `ruflo pair start --mode <mode>`.');
  return { success: true, data: { active: false } };
}

async function startAction(ctx: CommandContext): Promise<CommandResult> {
  // `pair start tdd` and `pair start --mode tdd` both work; a bare word wins
  // over the option default so it is never silently ignored.
  const mode = ctx.args[0] ?? ctx.flags.mode ?? 'driver';
  if (!isMode(mode)) {
    output.printError(`Unknown mode "${String(mode)}". Choose one of: ${Object.keys(PAIR_MODES).join(', ')}`);
    return { success: false, exitCode: 1 };
  }
  const existing = readSession(ctx.cwd);
  if (existing) {
    output.printError(`A pair session is already active (${existing.id}). End it first with \`ruflo pair end\`.`);
    return { success: false, exitCode: 1, data: describe(existing, new Date()) };
  }
  const interval = ctx.flags.interval !== undefined ? parseIntervalMinutes(ctx.flags.interval) : null;
  if (ctx.flags.interval !== undefined && interval === null) {
    output.printError(`Invalid --interval "${String(ctx.flags.interval)}". Use e.g. 10m, 90s or 1h.`);
    return { success: false, exitCode: 1 };
  }
  const role = ctx.flags.role;
  const now = new Date();
  const session: PairSession = {
    id: `pair_${now.getTime()}`,
    mode,
    aiRole: role === 'driver' || role === 'navigator' ? role : defaultRoleFor(mode),
    switchIntervalMinutes: mode === 'switch' ? (interval ?? DEFAULT_SWITCH_INTERVAL_MINUTES) : interval,
    startedAt: now.toISOString(),
    lastSwitchAt: now.toISOString(),
    switches: 0,
  };
  writeSession(ctx.cwd, session);
  if (ctx.flags.json) output.printJson(describe(session, now));
  else {
    output.printSuccess('Pair session started.');
    printSession(session, now);
  }
  return { success: true, data: describe(session, now) };
}

const startSub: Command = {
  name: 'start',
  description: 'Start a pair programming session',
  options: [
    { name: 'mode', short: 'm', description: 'Collaboration mode', type: 'string', default: 'driver', choices: Object.keys(PAIR_MODES) },
    { name: 'role', description: "AI's starting role (defaults from mode)", type: 'string', choices: ['driver', 'navigator'] },
    { name: 'interval', short: 'i', description: 'Role switch interval for switch mode (e.g. 10m, 1h)', type: 'string' },
    { name: 'json', description: 'Output as JSON', type: 'boolean', default: false },
  ],
  action: startAction,
};

async function statusAction(ctx: CommandContext): Promise<CommandResult> {
  const session = readSession(ctx.cwd);
  if (!session) return noSession(ctx);
  const now = new Date();
  if (ctx.flags.json) output.printJson({ active: true, ...describe(session, now) });
  else printSession(session, now);
  return { success: true, data: { active: true, ...describe(session, now) } };
}

const statusSub: Command = {
  name: 'status',
  description: 'Show the active pair session',
  options: [{ name: 'json', description: 'Output as JSON', type: 'boolean', default: false }],
  action: statusAction,
};

async function switchAction(ctx: CommandContext): Promise<CommandResult> {
  const session = readSession(ctx.cwd);
  if (!session) return noSession(ctx);
  const now = new Date();
  session.aiRole = otherRole(session.aiRole);
  session.lastSwitchAt = now.toISOString();
  session.switches += 1;
  writeSession(ctx.cwd, session);
  if (ctx.flags.json) output.printJson(describe(session, now));
  else output.printSuccess(`Switched — AI is now ${session.aiRole}, human is ${otherRole(session.aiRole)}.`);
  return { success: true, data: describe(session, now) };
}

const switchSub: Command = {
  name: 'switch',
  description: 'Swap driver and navigator roles',
  options: [{ name: 'json', description: 'Output as JSON', type: 'boolean', default: false }],
  action: switchAction,
};

async function modeAction(ctx: CommandContext): Promise<CommandResult> {
  const session = readSession(ctx.cwd);
  if (!session) return noSession(ctx);
  const mode = ctx.args[0];
  if (!isMode(mode)) {
    output.printError(`Usage: ruflo pair mode <${Object.keys(PAIR_MODES).join('|')}>`);
    return { success: false, exitCode: 1 };
  }
  const now = new Date();
  session.mode = mode;
  if (mode === 'switch' && !session.switchIntervalMinutes) {
    session.switchIntervalMinutes = DEFAULT_SWITCH_INTERVAL_MINUTES;
    session.lastSwitchAt = now.toISOString();
  }
  writeSession(ctx.cwd, session);
  if (ctx.flags.json) output.printJson(describe(session, now));
  else output.printSuccess(`Mode changed to ${mode} — ${PAIR_MODES[mode]}.`);
  return { success: true, data: describe(session, now) };
}

const modeSub: Command = {
  name: 'mode',
  description: 'Change the mode of the active session: ruflo pair mode <mode>',
  options: [{ name: 'json', description: 'Output as JSON', type: 'boolean', default: false }],
  action: modeAction,
};

async function endAction(ctx: CommandContext): Promise<CommandResult> {
  const session = readSession(ctx.cwd);
  if (!session) return noSession(ctx);
  session.endedAt = new Date().toISOString();
  fs.appendFileSync(historyPath(ctx.cwd), JSON.stringify(session) + '\n', 'utf-8');
  fs.rmSync(currentPath(ctx.cwd), { force: true });
  if (ctx.flags.json) output.printJson(session);
  else output.printSuccess(`Pair session ${session.id} ended after ${session.switches} role switch(es).`);
  return { success: true, data: session };
}

const endSub: Command = {
  name: 'end',
  description: 'End the active session and append it to the history',
  options: [{ name: 'json', description: 'Output as JSON', type: 'boolean', default: false }],
  action: endAction,
};

async function historyAction(ctx: CommandContext): Promise<CommandResult> {
  const history = readHistory(ctx.cwd);
  if (ctx.flags.json) output.printJson(history);
  else if (history.length === 0) output.writeln('No past pair sessions.');
  else for (const s of history) output.writeln(`${s.id}  ${s.mode.padEnd(9)}  ${s.startedAt} → ${s.endedAt ?? '?'}  (${s.switches} switches)`);
  return { success: true, data: history };
}

const historySub: Command = {
  name: 'history',
  description: 'List past pair sessions',
  options: [{ name: 'json', description: 'Output as JSON', type: 'boolean', default: false }],
  action: historyAction,
};

export const pairCommand: Command = {
  name: 'pair',
  description: 'Pair programming session: modes, driver/navigator roles, switching',
  subcommands: [startSub, statusSub, switchSub, modeSub, endSub, historySub],
  // Top-level flags kept for the v2 spelling used throughout the skill docs.
  options: [
    { name: 'start', description: 'Alias for `pair start`', type: 'boolean', default: false },
    { name: 'status', description: 'Alias for `pair status`', type: 'boolean', default: false },
    { name: 'end', description: 'Alias for `pair end`', type: 'boolean', default: false },
    { name: 'history', description: 'Alias for `pair history`', type: 'boolean', default: false },
    ...(startSub.options ?? []),
  ],
  examples: [
    { command: 'ruflo pair start --mode tdd', description: 'Start a test-first session with the AI driving' },
    { command: 'ruflo pair start --mode switch --interval 15m', description: 'Swap roles every 15 minutes' },
    { command: 'ruflo pair status --json', description: 'Machine-readable state for the agent to read each turn' },
    { command: 'ruflo pair switch', description: 'Swap driver and navigator now' },
    { command: 'ruflo pair mode review', description: 'Change mode mid-session' },
    { command: 'ruflo pair end', description: 'End the session and record it in the history' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    if (ctx.flags.start) return startAction(ctx);
    if (ctx.flags.end) return endAction(ctx);
    if (ctx.flags.history) return historyAction(ctx);
    return statusAction(ctx);
  },
};

export default pairCommand;
