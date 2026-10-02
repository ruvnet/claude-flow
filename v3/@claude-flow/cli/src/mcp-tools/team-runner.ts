/**
 * `ruflo team run` and `ruflo team hook-stop` (ADR-402).
 *
 * The runner executes a member's exec host (Codex or a command host) as one
 * headless process. The command is rebuilt from the host definition at run
 * time, never read from team.json. Process exit is the stop signal: the
 * runner writes a run file, delivers the final message to the next agent (or
 * the lead), and records the stop. No host hook is needed on this path.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, relative } from 'node:path';
import { getProjectCwd } from './types.js';
import { getAdapter, isProtectedEnvName } from './team-hosts/index.js';
import { resolveExecPlan, type ResolvedExecPlan } from './team-hosts/plan.js';
import { loadBus, loadStore, type BusMessage, type StoreMember, type StoreTeam, type TeamBus } from './team-bus.js';
import {
  codexMcpServer,
  fillPlaceholders,
  isExecEntry,
  memberModel,
  parseCodexEvents,
  planBlock,
  readResultFile,
  runLooksLive,
  withMessages,
  writeRunFile,
} from './team-run-helpers.js';

export { codexMcpServer, fillPlaceholders, parseCodexEvents, planBlock, readResultFile, withMessages } from './team-run-helpers.js';

/** Same rule as the store's safeName (grok-team-store.mjs NAME_RE). */
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export const DEFAULT_RUN_TIMEOUT_MS = 1_800_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const HANDOFF_MAX_CHARS = 64 * 1024;
const TIMEOUT_EXIT_CODE = 124;
const INTERRUPTED_EXIT_CODE = 130;

export interface TeamRunOptions {
  team: string;
  agent: string;
  host?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  dryRun?: boolean;
  /** Resolves {mcpServer} for Codex plans. Defaults to `codex mcp list --json`. */
  resolveMcpServer?: () => string | undefined;
}

export interface TeamRunResult {
  success: boolean;
  exitCode: number;
  error?: string;
  dryRun?: {
    command: string;
    args: string[];
    cwd: string;
    passEnvNames: string[];
    promptVia: string;
    inboxMessages: number;
    /** Command hosts: whether `ruflo team trust-host` recorded this entry. */
    trusted?: boolean;
  };
  runId?: string;
  runFile?: string;
  outcome?: 'done' | 'failed';
  reason?: string;
  warnings?: string[];
  onStop?: unknown;
}

type InboxMessage = BusMessage;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Send through the store; a failure becomes a warning, never an exception.
 * `sendMessage` returns the team-lock promise, so this must be awaited:
 * a try/catch around the call does not see a rejection (#3513 round-3).
 */
async function trySend(bus: TeamBus, root: string, opts: Record<string, unknown>, warnings: string[], tag: string): Promise<void> {
  try {
    await bus.sendMessage(root, opts);
  } catch {
    warnings.push(tag);
  }
}

function fail(error: string, exitCode = 1): TeamRunResult {
  return { success: false, exitCode, error };
}

type Claim = { error: string } | { team: StoreTeam; member: StoreMember; staleRun?: string };

export async function runTeamAgent(opts: TeamRunOptions): Promise<TeamRunResult> {
  const teamName = String(opts.team || '');
  const agent = String(opts.agent || '');
  if (!NAME_RE.test(teamName)) return fail(`Invalid team "${teamName}" — use 1-64 alphanumeric, dash, underscore`);
  if (!NAME_RE.test(agent)) return fail(`Invalid agent "${agent}" — use 1-64 alphanumeric, dash, underscore`);
  const root = getProjectCwd();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const warnings: string[] = [];
  const [bus, store] = await Promise.all([loadBus(), loadStore()]);

  // Check team and plan state, and claim the member, in one locked step so
  // two runners cannot both start the same agent.
  let claim: Claim;
  try {
    claim = await store.updateTeam<Claim>(root, teamName, (team) => {
      store.assertActive(team); // throws after team_shutdown
      const member = team.members?.[agent];
      if (!member) return { error: `Agent "${agent}" is not registered on team "${teamName}" — call team_spawn first` };
      if (member.status === 'shutdown') return { error: `Agent "${agent}" on team "${teamName}" is shut down` };
      const blocked = planBlock(team, agent);
      if (blocked) return { error: `Not running "${agent}": ${blocked}` };
      let staleRun: string | undefined;
      if (member.status === 'running' && member.runId) {
        if (runLooksLive(member)) {
          return {
            error:
              `Agent "${agent}" is already running (run ${member.runId}${member.runPid ? `, pid ${member.runPid}` : ''}). ` +
              'Wait for it to finish; if that runner is gone, record the stop with `ruflo team on-stop` and outcome "failed".',
          };
        }
        staleRun = String(member.runId);
      }
      if (!opts.dryRun) {
        member.status = 'running';
        member.runId = runId;
        member.runPid = process.pid;
        member.runHost = hostname();
        member.runStartedAt = new Date().toISOString();
      }
      return { team, member, staleRun };
    });
  } catch (err) {
    return fail(errText(err));
  }
  if ('error' in claim) return fail(claim.error);
  const { team, member } = claim;
  if (claim.staleRun) warnings.push(`staleRunReplaced:${claim.staleRun}`);

  // Release the claim when the run cannot start after all.
  const abandon = async (error: string): Promise<TeamRunResult> => {
    if (!opts.dryRun) {
      try {
        await store.updateTeam(root, teamName, (t) => {
          const m = t.members?.[agent];
          if (m && m.runId === runId) m.status = 'idle';
        });
      } catch {
        /* the claim goes stale; the next run replaces it */
      }
    }
    return fail(error);
  };

  const label = opts.host || team.host || '';
  const entry = member.spawn?.[label];
  if (!isExecEntry(entry)) {
    return abandon(
      `Agent "${agent}" has no exec plan for host "${label}". Exec hosts are codex and command hosts; ` +
        `re-run team_spawn with hosts:["${label}"] (plans from older Ruflo versions are not runnable).`,
    );
  }

  // The command comes from the host definition now, never from team.json.
  let plan: ResolvedExecPlan;
  try {
    plan = resolveExecPlan(team, agent, member.role, member.next ?? [], label, bus.ROLE_DEFAULTS, memberModel(member, entry));
  } catch (err) {
    return abandon(errText(err));
  }
  if (JSON.stringify(plan.exec) !== JSON.stringify(entry.exec)) warnings.push('storedPlanIgnored');
  if (plan.hostConfig && !plan.trusted && !opts.dryRun) {
    return abandon(
      `Command host "${label}" is not trusted for this project. Review its entry in .claude-flow/team-hosts.json, ` +
        `then run \`ruflo team trust-host ${label}\`. Trust is tied to the entry; editing it needs a new trust step.`,
    );
  }

  const runsDir = join(store.teamDir(root, teamName), 'runs');
  const resultFile = join(runsDir, `${agent}-${runId}.last.txt`);
  const runFile = join(runsDir, `${agent}-${runId}.json`);
  const basePrompt = String(entry.prompt ?? '');
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const vars: Record<string, string> = {
    team: teamName,
    agent,
    role: member.role,
    cwd: root,
    teamRoot: root,
    resultFile,
  };
  let rawArgs = [...plan.exec.args];
  if (rawArgs.some((a) => a.includes('{mcpServer}'))) {
    const server = (opts.resolveMcpServer ?? codexMcpServer)();
    if (server) {
      vars.mcpServer = server;
    } else {
      // Drop the `-c mcp_servers.{mcpServer}...` pair; the child still runs.
      rawArgs = rawArgs.filter((a, i) => !a.includes('{mcpServer}') && !(a === '-c' && rawArgs[i + 1]?.includes('{mcpServer}')));
      warnings.push('mcpServerNotFound');
    }
  }
  const { command, promptVia } = plan.exec;
  // Built-in adapters pass their own auth names; a command host never passes secrets.
  const passEnv = plan.hostConfig ? plan.exec.passEnv.filter((n) => !isProtectedEnvName(n)) : plan.exec.passEnv;
  if (promptVia === 'arg') warnings.push('promptInArgv');

  if (opts.dryRun) {
    // Peek only: a dry run shows the queued messages but leaves them queued.
    const queued = bus.readInbox(root, { team: teamName, agent, peek: true }).messages;
    const args = rawArgs.map((a) => fillPlaceholders(a, { ...vars, prompt: withMessages(basePrompt, queued) }));
    return {
      success: true,
      exitCode: 0,
      dryRun: {
        command, args, cwd: root, passEnvNames: [...passEnv], promptVia, inboxMessages: queued.length,
        ...(plan.hostConfig ? { trusted: plan.trusted } : {}),
      },
      warnings,
    };
  }

  const dual = await import('@claude-flow/codex/dual-mode').catch(() => undefined);
  if (!dual || typeof dual.runHeadlessProcess !== 'function') {
    return abandon('`ruflo team run` needs a newer @claude-flow/codex (runHeadlessProcess is missing)');
  }

  // Exec children may have no Ruflo MCP (or a sandbox that blocks it), so the
  // runner drains this team's inbox for the member (archived, as team_inbox
  // does) and delivers the queued messages in the prompt.
  let delivered: InboxMessage[];
  try {
    delivered = bus.readInbox(root, { team: teamName, agent }).messages;
  } catch (err) {
    return abandon(errText(err));
  }
  // From here the inbox has been drained: an exception anywhere below (in
  // run-directory, result-file, or run-file handling) must not strand the
  // member "running" forever with its messages silently dropped. It either
  // requeues `delivered` (unless the normal failed-outcome path below
  // already did) and releases the run claim, or — if `onStop` already ran —
  // leaves the state `onStop` already settled alone (#3513 MINOR 4).
  let messagesRequeued = false;
  const requeueDelivered = async (): Promise<void> => {
    if (messagesRequeued) return;
    messagesRequeued = true;
    for (const m of delivered) {
      await trySend(bus, root, {
        team: teamName, to: agent, from: m.from, type: m.type, summary: m.summary,
        message: m.content, priority: m.priority,
      }, warnings, `requeueFailed:${m.id}`);
    }
  };
  let onStopSettled = false;
  const releaseRunClaim = async (): Promise<void> => {
    if (onStopSettled) return;
    try {
      await store.updateTeam(root, teamName, (t) => {
        const m = t.members?.[agent];
        if (m && m.runId === runId) m.status = 'idle';
      });
    } catch {
      /* the claim goes stale; a future run replaces it */
    }
  };

  try {
    const prompt = withMessages(basePrompt, delivered);
    const args = rawArgs.map((a) => fillPlaceholders(a, { ...vars, prompt }));

    store.ensureRealDir(root, runsDir);
    const env = dual.buildWorkerEnvironment(process.env, { principalId: `agent:${agent}`, passEnv });
    env.CLAUDE_FLOW_CWD = root;
    const startedAt = new Date().toISOString();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    let code: number | null = null;
    let timedOut = false;
    let aborted = false;
    let ms = 0;
    let stdout = '';
    let stderr = '';
    let spawnError: string | undefined;
    // The child leads its own process group, so Ctrl-C or a closed terminal
    // no longer reaches it; forward SIGINT/SIGTERM/SIGHUP as an abort that
    // stops the tree. SIGHUP (a closed terminal/SSH session) was previously
    // NOT forwarded, so the runner died on its own SIGHUP-default handling
    // while the detached child kept running, untracked (#3513 MEDIUM D).
    // SIGKILL of the runner itself cannot be caught by definition; see the
    // "known limitation" note in docs/adr/ADR-402-host-agnostic-agent-teams.md.
    const ac = new AbortController();
    const onSignal = () => ac.abort();
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    process.once('SIGHUP', onSignal);
    try {
      const r = await dual.runHeadlessProcess({
        command,
        args,
        cwd: root,
        env,
        stdinText: promptVia === 'stdin' ? prompt : undefined,
        timeoutMs,
        maxOutputBytes,
        signal: ac.signal,
      });
      ({ code, timedOut, ms, stdout, stderr } = r);
      aborted = (r as { aborted?: boolean }).aborted === true;
      if ((r as { truncated?: boolean }).truncated) warnings.push('outputTruncated');
    } catch (err) {
      spawnError = err instanceof Error ? err.message : String(err);
    } finally {
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      process.removeListener('SIGHUP', onSignal);
    }

    const events = plan.events === 'codex-jsonl' ? parseCodexEvents(stdout) : undefined;
    const fromFile = readResultFile(resultFile, maxOutputBytes);
    if (fromFile.truncated) warnings.push('resultFileTruncated');
    if (fromFile.refused) warnings.push(`resultFileIgnored:${fromFile.refused}`);
    let text = fromFile.text;
    if (!text.trim()) text = events ? events.lastMessage ?? '' : stdout;
    if (!existsSync(resultFile) && !fromFile.refused) writeFileSync(resultFile, text, 'utf-8');

    let reason: string | undefined;
    if (spawnError) reason = `could not start ${command}: ${spawnError}`;
    else if (aborted) reason = 'interrupted';
    else if (timedOut) reason = `timed out after ${timeoutMs}ms`;
    else if (code !== 0) reason = `exit code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ''}`;
    else if (events?.terminal === 'turn.failed') reason = events.failure;
    const outcome: 'done' | 'failed' = reason === undefined ? 'done' : 'failed';
    if (events && outcome === 'done' && !events.terminal) warnings.push('noTerminalEvent');

    // A failed run (including an interrupted one — SIGINT/SIGTERM/SIGHUP, or
    // a timeout) did not act on the delivered messages. Queue them again in
    // the same team so a retry with `ruflo team run` sees them (the archived
    // copies stay as history).
    if (outcome === 'failed') await requeueDelivered();

    writeRunFile(runFile, {
      runId,
      team: teamName,
      agent,
      host: label,
      command,
      startedAt,
      code,
      timedOut,
      ms,
      outcome,
      ...(reason ? { reason } : {}),
      resultFile: relative(root, resultFile),
      ...(events?.threadId ? { threadId: events.threadId } : {}),
      ...(events ? { mcpTools: events.mcpTools ?? [] } : {}),
      inboxDelivered: delivered.map((m) => m.id),
      warnings,
    });

    if (events?.threadId) {
      try {
        await store.updateTeam(root, teamName, (t) => {
          const m = t.members?.[agent];
          if (m) m.threadId = events.threadId;
        });
      } catch {
        warnings.push('threadIdNotRecorded');
      }
    }

    // A failed run goes to the lead only; the next step is not ready.
    const targets = outcome === 'done' && member.next?.length ? member.next : ['lead'];
    const body = text.trim()
      ? text.length > HANDOFF_MAX_CHARS ? `${text.slice(0, HANDOFF_MAX_CHARS)}\n…(truncated)` : text
      : `(no final message${reason ? `; ${reason}` : ''})`;
    for (const to of targets) {
      await trySend(bus, root, {
        team: teamName,
        to,
        from: agent,
        type: 'result',
        summary: `${agent} ${outcome}`,
        message: `${body}\n\n[run: ${relative(root, runFile)}]`,
      }, warnings, `sendFailed:${to}`);
    }

    let onStop: unknown;
    try {
      onStop = await bus.onStop(root, { team: teamName, agent, outcome, runId, reason });
      onStopSettled = true;
    } catch (err) {
      onStop = { success: false, error: errText(err) };
      warnings.push('onStopFailed');
    }
    const exitCode = code === 0 && outcome === 'done' ? 0 : aborted ? INTERRUPTED_EXIT_CODE : timedOut ? TIMEOUT_EXIT_CODE : code || 1;
    return {
      success: outcome === 'done',
      exitCode,
      runId,
      runFile: relative(root, runFile),
      outcome,
      reason,
      warnings,
      onStop,
    };
  } catch (err) {
    await requeueDelivered();
    await releaseRunClaim();
    return fail(`run-directory, result-file, or run-file handling failed: ${errText(err)}`);
  }
}

export interface HookStopResult {
  handled: boolean;
  reason?: string;
  team?: string;
  agent?: string;
  onStop?: unknown;
}

/**
 * Map a native stop-hook payload to the store's onStop. Team resolution:
 * the payload (or the `@team` of a spawn description), then TEAM_NAME,
 * then the only active team that lists the agent. When several teams list
 * it and none is named it does nothing rather than guess.
 */
export async function hookStop(host: string, payload: unknown, env: NodeJS.ProcessEnv = process.env): Promise<HookStopResult> {
  const id = getAdapter(host).stopIdentity(payload, env);
  if (!id.agent) return { handled: false, reason: 'no agent in payload' };
  const root = getProjectCwd();
  const bus = await loadBus();
  let team = id.team || env.TEAM_NAME;
  if (!team) {
    const teams = bus.teamsWithMember(root, id.agent);
    if (teams.length !== 1) {
      return {
        handled: false,
        reason: teams.length ? `several active teams list "${id.agent}" and none is named` : `no active team lists "${id.agent}"`,
        agent: id.agent,
      };
    }
    team = teams[0];
  }
  try {
    const onStop = await bus.onStop(root, { team, agent: id.agent, outcome: id.outcome });
    return { handled: true, team, agent: id.agent, onStop };
  } catch (err) {
    return { handled: false, reason: errText(err), team, agent: id.agent };
  }
}
