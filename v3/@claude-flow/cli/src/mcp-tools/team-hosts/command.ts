/**
 * Generic command host: any agent runtime with a one-shot CLI can be a
 * teammate, declared in the project's .claude-flow/team-hosts.json.
 * Ruflo never runs these through a shell.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readStopIdentity } from './identity.js';
import {
  EXEC_PLACEHOLDERS,
  type CommandHostConfig,
  type SpawnContext,
  type ExecHostAdapter,
} from './types.js';

export const TEAM_HOSTS_FILE = join('.claude-flow', 'team-hosts.json');

const NAME_RE = /^[A-Za-z0-9._/-]+$/;
/** Labels become plan keys and `--host` values: no path separators. */
const LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PLACEHOLDER_RE = /\{([A-Za-z]+)\}/g;
const HOST_KEYS = new Set(['kind', 'command', 'args', 'promptVia', 'passEnv', 'isolation', 'description']);
/**
 * Secret-looking names. Broader than the strip in buildWorkerEnvironment
 * (@claude-flow/codex dual-mode/process.ts), which it must stay a superset of.
 */
const SENSITIVE_ENV_NAME = /(?:^|_)(?:API_?KEY|KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)$|SECRET|TOKEN|PASSW(?:OR)?D|PASSPHRASE|CREDENTIAL|PRIVATE|AUTH|COOKIE|SESSION|API_?KEY/i;

/** Names a command host's passEnv may never re-add: secrets and Ruflo's own identity/policy variables. */
export function isProtectedEnvName(name: string): boolean {
  return SENSITIVE_ENV_NAME.test(name) || /^CLAUDE_FLOW_/i.test(name);
}

export class TeamHostsError extends Error {}

function fail(msg: string): never {
  throw new TeamHostsError(`team-hosts.json: ${msg}`);
}

/** Validate one host entry. Throws TeamHostsError with the reason. */
export function validateCommandHost(label: string, raw: unknown, reserved: string[] = []): CommandHostConfig {
  if (!LABEL_RE.test(label)) fail(`label "${label}" must match ${LABEL_RE}`);
  if (reserved.includes(label)) fail(`label "${label}" is a built-in host`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(`host "${label}" must be an object`);
  const h = raw as Record<string, unknown>;
  for (const key of Object.keys(h)) {
    if (!HOST_KEYS.has(key)) fail(`host "${label}" has unknown key "${key}"`);
  }
  if (h.kind !== 'exec') fail(`host "${label}" kind must be "exec"`);
  if (typeof h.command !== 'string' || !NAME_RE.test(h.command)) {
    fail(`host "${label}" command must match ${NAME_RE}`);
  }
  if (!Array.isArray(h.args) || !h.args.every((a) => typeof a === 'string')) {
    fail(`host "${label}" args must be an array of strings`);
  }
  const args = h.args as string[];
  const promptVia = h.promptVia ?? 'arg';
  if (promptVia !== 'arg' && promptVia !== 'stdin') fail(`host "${label}" promptVia must be "arg" or "stdin"`);

  let promptCount = 0;
  for (const arg of args) {
    for (const m of arg.matchAll(PLACEHOLDER_RE)) {
      const name = m[1];
      if (!(EXEC_PLACEHOLDERS as readonly string[]).includes(name)) {
        fail(`host "${label}" uses unknown placeholder {${name}}`);
      }
      if (arg !== `{${name}}`) {
        fail(`host "${label}" placeholder {${name}} must fill a whole argument, not part of "${arg}"`);
      }
      if (name === 'prompt') promptCount += 1;
    }
  }
  if (promptVia === 'arg' && promptCount !== 1) {
    fail(`host "${label}" with promptVia "arg" needs exactly one "{prompt}" argument (found ${promptCount})`);
  }
  if (promptVia === 'stdin' && promptCount !== 0) {
    fail(`host "${label}" with promptVia "stdin" must not use {prompt} in args`);
  }

  const passEnv = h.passEnv ?? [];
  if (!Array.isArray(passEnv) || !passEnv.every((n) => typeof n === 'string' && ENV_NAME_RE.test(n))) {
    fail(`host "${label}" passEnv must be an array of environment variable names`);
  }
  for (const name of passEnv as string[]) {
    if (isProtectedEnvName(name)) {
      fail(
        `host "${label}" passEnv cannot include "${name}": secret-named and CLAUDE_FLOW_* variables are never passed to a command host. ` +
          'Let the host read its credentials from its own config or credential store.',
      );
    }
  }
  const isolation = h.isolation ?? 'none';
  if (isolation !== 'none' && isolation !== 'worktree') fail(`host "${label}" isolation must be "none" or "worktree"`);

  return {
    kind: 'exec',
    command: h.command,
    args: [...args],
    promptVia,
    passEnv: [...(passEnv as string[])],
    isolation,
  };
}

/** Parse and validate a whole team-hosts.json document. */
export function parseTeamHosts(doc: unknown, reserved: string[] = []): Record<string, CommandHostConfig> {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) fail('must be a JSON object');
  const top = doc as Record<string, unknown>;
  for (const key of Object.keys(top)) {
    if (key !== 'hosts' && key !== '$schema') fail(`unknown top-level key "${key}"`);
  }
  const hosts = top.hosts;
  if (!hosts || typeof hosts !== 'object' || Array.isArray(hosts)) fail('"hosts" must be an object');
  const out: Record<string, CommandHostConfig> = {};
  for (const [label, raw] of Object.entries(hosts as Record<string, unknown>)) {
    out[label] = validateCommandHost(label, raw, reserved);
  }
  return out;
}

/** Load the project's command hosts. A missing file means no hosts. */
export function loadTeamHosts(projectRoot: string, reserved: string[] = []): Record<string, CommandHostConfig> {
  const file = join(projectRoot, TEAM_HOSTS_FILE);
  if (!existsSync(file)) return {};
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(file, 'utf-8'));
  } catch (err) {
    fail(`not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
  return parseTeamHosts(doc, reserved);
}

export const commandAdapter: ExecHostAdapter = {
  id: 'command',
  kind: 'exec',
  protocolLines(ctx: SpawnContext): string[] {
    const lines = [
      `You run as one headless turn of the "${ctx.label}" host, started by \`ruflo team run\`. Do not start other agents.`,
    ];
    if (ctx.defaults.capability_mode === 'read-only') {
      lines.push('Constraint: do not create, edit, delete, or move files, and do not run commands that change the repo. Read, search, and report.');
    } else {
      lines.push('Constraint: stay inside the files this task names.');
    }
    lines.push('If the Ruflo MCP tools team_inbox / team_send are available, use them. If they are not, your final reply is still delivered.');
    return lines;
  },
  plan(ctx: SpawnContext): Record<string, unknown> {
    const cfg = ctx.hostConfig;
    if (!cfg) throw new TeamHostsError(`host "${ctx.label}" has no command config`);
    return {
      contract: 'command-host-v1',
      kind: 'exec',
      exec: {
        command: cfg.command,
        args: [...cfg.args],
        promptVia: cfg.promptVia,
        closeStdin: true,
        passEnv: [...cfg.passEnv],
      },
      advisory: {
        capability_mode: ctx.defaults.capability_mode,
        isolation: cfg.isolation,
        note: `Run with \`ruflo team run --team <team> --agent <agent> --host ${ctx.label}\`. Read-only is advisory for command hosts: the host enforces its own sandbox, if any.`,
      },
    };
  },
  stopIdentity(payload: unknown, env: NodeJS.ProcessEnv = process.env) {
    return readStopIdentity(payload, ['agent', 'agentName', 'name', 'subagentName'], env.SUBAGENT_NAME);
  },
};
