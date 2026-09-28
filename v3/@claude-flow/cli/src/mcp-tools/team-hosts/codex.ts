/**
 * Codex host. The primary path is `codex exec`, run by `ruflo team run`
 * (an exec host). Checked against codex-cli 0.157.1 flags.
 *
 * Plans never contain --full-auto (absent in 0.157) or any
 * --dangerously-bypass-* flag.
 */

import { readStopIdentity } from './identity.js';
import type { ExecHostAdapter, ExecSpec, SpawnContext } from './types.js';

export const CODEX_PASS_ENV = ['CODEX_HOME', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'];

const MODEL_RE = /^[A-Za-z0-9._:/-]+$/;

export function codexExecSpec(ctx: SpawnContext): ExecSpec {
  const readOnly = ctx.defaults.capability_mode === 'read-only';
  const args = ['exec', '--sandbox', readOnly ? 'read-only' : 'workspace-write'];
  if (!readOnly && ctx.defaults.isolation === 'worktree') args.push('--worktree');
  args.push(
    '--skip-git-repo-check',
    '--json',
    '-o', '{resultFile}',
    '-C', '{cwd}',
    // Pins the child's Ruflo MCP server to the team root, so a child in a
    // worktree does not open a second mailbox there. The runner resolves
    // {mcpServer} and drops this pair when no Ruflo server is configured.
    '-c', 'mcp_servers.{mcpServer}.env.CLAUDE_FLOW_CWD="{teamRoot}"',
  );
  if (ctx.model && MODEL_RE.test(ctx.model)) args.push('-m', ctx.model);
  // Prompt over stdin; the runner closes stdin afterwards (codex exec waits for EOF).
  args.push('-');
  return {
    command: 'codex',
    args,
    promptVia: 'stdin',
    closeStdin: true,
    passEnv: [...CODEX_PASS_ENV],
  };
}

function codexConstraint(mode: string, isolation: string): string {
  if (mode === 'read-only') {
    return 'Constraint: the Codex sandbox is read-only. Read, search, and report.';
  }
  if (isolation === 'worktree') {
    return 'Constraint: Codex runs you in a new git worktree. Stay inside it and report its path when you finish.';
  }
  return 'Constraint: stay inside the files this task names.';
}

export const codexAdapter: ExecHostAdapter = {
  id: 'codex',
  kind: 'exec',
  protocolLines(ctx: SpawnContext): string[] {
    return [
      'You run as one headless `codex exec` turn started by `ruflo team run`. Do not start other agents.',
      codexConstraint(ctx.defaults.capability_mode, ctx.defaults.isolation),
      'If the Ruflo MCP tools team_inbox / team_send are available, use them. If they are not, your final reply is still delivered.',
    ];
  },
  plan(ctx: SpawnContext): Record<string, unknown> {
    const readOnly = ctx.defaults.capability_mode === 'read-only';
    return {
      contract: 'codex-cli-0.157',
      kind: 'exec',
      events: 'codex-jsonl',
      exec: codexExecSpec(ctx),
      advisory: {
        capability_mode: ctx.defaults.capability_mode,
        isolation: readOnly ? 'none' : ctx.defaults.isolation,
        note: 'Run with `ruflo team run --team <team> --agent <agent> --host codex`. Parallelism is process-level: start one `ruflo team run` per agent.',
      },
    };
  },
  stopIdentity(payload: unknown, env: NodeJS.ProcessEnv = process.env) {
    // Codex SubagentStop field names are not verified yet; accept the
    // Claude-shaped names plus the likely Codex ones.
    return readStopIdentity(
      payload,
      ['subagentName', 'agentName', 'agent', 'agent_type', 'agent_id', 'name', 'description', 'toolInput.description'],
      env.SUBAGENT_NAME,
    );
  },
};
