/**
 * `ruflo dashboard` - ADR-482 local connector for the hosted ruflo dashboard.
 *
 *   dashboard link --url <https://dashboard> [--name n] [--level read|write|manage|full] [--project dir]
 *   dashboard status | enable | disable | unlink
 *   dashboard set [--level L] [--auto-approve true|false] [--project dir]
 *   dashboard run [--project dir]
 *
 * DEFAULT OFF: nothing connects until the machine is linked (a signed-in user approves a device code in
 * the dashboard) AND enabled, and `run` is an explicit foreground command. Outbound wss only. Every remote
 * command is allowlisted, level-checked and locally approved (TTY prompt; no TTY = deny). State lives in
 * ~/.ruflo/dashboard (RUFLO_DASHBOARD_HOME overrides).
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { fingerprint, LEVELS, type Level } from '../dashboard/protocol/index.js';
import { link } from '../dashboard/link.js';
import { runConnector } from '../dashboard/run.js';
import { ensureDir, loadConfig, saveConfig, stateDir, StateError } from '../dashboard/state.js';
import { unlink } from '../dashboard/unlink.js';
import { resolveRufloCommand, RufloClient } from '../dashboard/exec.js';

const OPS = ['link', 'status', 'enable', 'disable', 'set', 'unlink', 'run'] as const;
type Op = (typeof OPS)[number];

export interface DashboardDeps { rufloVersion?: (projectDir: string) => Promise<string | undefined>; sleep?: (ms: number) => Promise<void> }
let deps: DashboardDeps = {};
/** Test seam (London school): replace version detection / pacing. */
export function setDashboardDeps(next: DashboardDeps | null): void { deps = next ?? {}; }

const detectVersion = async (dir: string): Promise<string | undefined> => {
  try { return ((await new RufloClient(resolveRufloCommand(), dir, 15_000).mcp('system_info')) as { version?: string }).version; } catch { return undefined; }
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
function level(v: unknown): Level | undefined {
  const s = str(v);
  if (s === undefined) return undefined;
  if (!(LEVELS as readonly string[]).includes(s)) throw new StateError('bad_level', `level must be one of ${LEVELS.join(', ')}`);
  return s as Level;
}

export async function runDashboard(op: Op, flags: Record<string, unknown>, cwd: string): Promise<CommandResult> {
  const home = stateDir(str(flags.home));
  try {
    switch (op) {
      case 'link': {
        const url = str(flags.url);
        if (!url) throw new StateError('usage', '--url is required');
        if (loadConfig(home)) throw new StateError('already_linked', 'already linked; run `ruflo dashboard unlink` first');
        ensureDir(home);
        const project = str(flags.project);
        const rufloVersion = await (deps.rufloVersion ?? detectVersion)(project ?? cwd);
        const cfg = await link({ home, baseUrl: url, name: str(flags.name), level: level(flags.level), rufloVersion, projectDir: project, out: l => output.writeln(l), sleep: deps.sleep });
        output.writeln(`Linked as ${cfg.deviceId} (level ${cfg.level}). Start streaming with: ruflo dashboard run`);
        return { success: true, exitCode: 0 };
      }
      case 'status': {
        const c = loadConfig(home);
        if (!c) { output.writeln('not linked'); return { success: true, exitCode: 0, data: { linked: false } }; }
        output.writeln([`linked      yes`, `enabled     ${c.enabled}`, `dashboard   ${c.baseUrl}`, `device      ${c.deviceId}`, `fingerprint ${fingerprint(c.publicKey)}`, `level       ${c.level}`, `autoApprove ${c.autoApprove}`, `name        ${c.name}`].join('\n'));
        return { success: true, exitCode: 0, data: { linked: true, enabled: c.enabled, level: c.level, autoApprove: c.autoApprove } };
      }
      case 'enable': case 'disable': {
        const c = loadConfig(home); if (!c) throw new StateError('not_linked', 'not linked');
        saveConfig(home, { ...c, enabled: op === 'enable' }); output.writeln(`${op}d`);
        return { success: true, exitCode: 0 };
      }
      case 'set': {
        const c = loadConfig(home); if (!c) throw new StateError('not_linked', 'not linked');
        const aa = flags.autoApprove;
        if (aa !== undefined && aa !== true && aa !== false && aa !== 'true' && aa !== 'false') throw new StateError('usage', '--auto-approve must be true or false');
        saveConfig(home, { ...c, level: level(flags.level) ?? c.level, autoApprove: aa === undefined ? c.autoApprove : aa === true || aa === 'true', projectDir: str(flags.project) ?? c.projectDir });
        output.writeln('updated');
        return { success: true, exitCode: 0 };
      }
      case 'unlink': {
        const r = await unlink(home);
        output.writeln(r.wasLinked ? `unlinked${r.notified ? '' : ' (server not reachable; revoke the device in the dashboard too)'}` : 'nothing to unlink');
        return { success: true, exitCode: 0, data: r };
      }
      case 'run': {
        const ac = new AbortController();
        for (const s of ['SIGINT', 'SIGTERM'] as const) process.once(s, () => ac.abort());
        const end = await runConnector({ home, projectDir: str(flags.project) ?? cwd, signal: ac.signal, log: l => process.stderr.write(`[dashboard] ${l}\n`) });
        if (end === 'revoked') { output.printError('revoked by the dashboard; local key and config removed'); return { success: false, exitCode: 3 }; }
        return { success: true, exitCode: 0 };
      }
    }
  } catch (e) {
    const msg = e instanceof StateError ? e.message : `${(e as Error).message}`.slice(0, 300);
    output.printError(msg);
    return { success: false, exitCode: 1, message: msg };
  }
}

const sub = (name: Op, description: string): Command => ({
  name, description,
  action: async (ctx: CommandContext) => runDashboard(name, ctx.flags as Record<string, unknown>, ctx.cwd ?? process.cwd()),
});

export const dashboardCommand: Command = {
  name: 'dashboard',
  description: 'Link this ruflo to the hosted dashboard (ADR-482): off by default, outbound-only, signed, allowlisted and locally approved',
  subcommands: [
    sub('link', 'Pair this machine with the dashboard (device code flow)'),
    sub('status', 'Show link state (never prints keys)'),
    sub('enable', 'Allow `run` to connect'),
    sub('disable', 'Stop `run` from connecting without unlinking'),
    sub('set', 'Change local control level, auto-approve (write only) or project dir'),
    sub('unlink', 'Notify the dashboard, then delete the local key and config'),
    sub('run', 'Stream signed state digests and accept allowlisted commands (foreground)'),
  ],
  options: [
    { name: 'url', type: 'string', description: 'link: dashboard base URL (https; http only for localhost)' },
    { name: 'name', type: 'string', description: 'link: device name shown in the dashboard' },
    { name: 'level', type: 'string', description: 'link/set: local control level (off|read|write|manage|full), default read', choices: [...LEVELS] },
    { name: 'auto-approve', type: 'string', description: 'set: skip the local prompt for write-level commands (never for manage/full)' },
    { name: 'project', type: 'string', description: 'Project directory whose ruflo state is published (default: cwd)' },
    { name: 'home', type: 'string', description: 'State directory (default ~/.ruflo/dashboard or $RUFLO_DASHBOARD_HOME)' },
  ],
  examples: [
    { command: 'ruflo dashboard link --url https://flo.example.com', description: 'Pair this machine (shows a code to approve in the browser)' },
    { command: 'ruflo dashboard run', description: 'Stream read-only state; remote commands need local approval' },
    { command: 'ruflo dashboard unlink', description: 'Disconnect and delete the key' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const op = ctx.args[0] as Op | undefined;
    if (!op || !(OPS as readonly string[]).includes(op)) {
      output.printError(`usage: ruflo dashboard <${OPS.join('|')}> [options]`);
      return { success: false, exitCode: op ? 2 : 0 };
    }
    return runDashboard(op, ctx.flags as Record<string, unknown>, ctx.cwd ?? process.cwd());
  },
};

export default dashboardCommand;
