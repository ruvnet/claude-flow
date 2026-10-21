#!/usr/bin/env node
// @ts-check
/**
 * ruflo-ruos CLI (ADR-405). Entry point for the plugin's commands/skills.
 *
 *   hosts                      list your ruOS desktops (fleet MCP)
 *   run --desktop <ref> (--prompt <t> | --prompt-file <f>) [--agent-type coder]
 *       [--model haiku|sonnet|opus] [--timeout 900] [--max-budget-usd n]
 *       [--start] [--ignore-autostop] [--transport fleet-mcp|ssh]
 *       [--jobs auto|exec-poll|jobs-api] [--json]
 *   attach --desktop <ref> --run <id> [--offset n]   re-read a run (e.g. after a restart)
 *   stop --desktop <ref> --run <id> --confirm
 *   desktop-stop --desktop <ref> --confirm
 *   logs --run <id>
 *   build --run <id> --prompt-file <f> [--model m] [--max-budget-usd n]
 *                              print the exact desktop_exec strings (session path)
 *   record <start|output|end> --run <id> ...   feed the swarm ledger (session path)
 *   deploy-info --desktop <ref> --repo <path-under-$HOME>
 *                              read-only: what a deploy from that repo would ship
 *   status                     transport configuration (no network)
 *
 * Credentials: RUOS_MCP_URL + RUOS_MCP_TOKEN, or ~/.config/ruos/credentials.json
 * from @cognitum/ruos. With neither, every networked command exits 2 with
 * `not-configured` and makes no request. SSH (--transport ssh) works only
 * when this CLI runs on a same-tenant ruOS desktop (Fly 6PN).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RuosError } from './lib/types.mjs';
import { FleetMcpClient, fleetConfigFromEnv, createFleet, createFleetTransport, normalizeDesktops } from './lib/fleet-mcp.mjs';
import { createSshTransport, sshConfigFromEnv } from './lib/ssh.mjs';
import { createLedger, resolveCallTool, projectCwd } from './lib/ledger.mjs';
import { RuosHostAdapter } from './lib/adapter.mjs';
import { newRunId, newNonce, assertRunId, assertAgentId, resolveDesktop, assertInt } from './lib/validate.mjs';
import { buildPrepare, buildPromptChunks, buildLaunch, buildPoll, buildStop, buildProbe, buildRepoSummary, parseRepoSummary } from './lib/command-builder.mjs';
import { createExecPollTransport, createJobsApiTransport, createRestJobsBackend } from './lib/jobs.mjs';
import { nextAutoStop } from './lib/autostop.mjs';

/**
 * @param {string[]} argv
 * @returns {{ _: string[], [k: string]: string|boolean|string[] }}
 */
export function parseArgs(argv) {
  /** @type {{ _: string[], [k: string]: string|boolean|string[] }} */
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v : undefined);

/**
 * @param {ReturnType<typeof parseArgs>} args
 * @param {NodeJS.ProcessEnv} env
 */
async function buildAdapter(args, env) {
  const client = new FleetMcpClient(fleetConfigFromEnv(env));
  client.assertConfigured(); // the fleet MCP is always the control plane
  const kind = str(args.transport) ?? env.RUOS_TRANSPORT ?? 'fleet-mcp';
  const exec = kind === 'ssh'
    ? createSshTransport(sshConfigFromEnv(env))
    : kind === 'fleet-mcp' ? createFleetTransport(client) : null;
  if (!exec) throw new RuosError('invalid-input', 'transport must be fleet-mcp or ssh');
  const fleet = createFleet(client);
  const jobs = await pickJobTransport(str(args.jobs) ?? env.RUOS_JOBS ?? 'auto', client, fleet, exec, env);
  const ledger = createLedger({ cwd: projectCwd(env), callTool: await resolveCallTool(projectCwd(env), env) });
  return { adapter: new RuosHostAdapter({ fleet, jobs, ledger, transportKind: /** @type {'fleet-mcp'|'ssh'} */ (kind) }), ledger, exec };
}

/**
 * Use the ruOS jobs API (ADR-105) when it is deployed, else exec-poll.
 * @param {string} mode
 * @param {FleetMcpClient} client
 * @param {import('./lib/types.mjs').Fleet} fleet
 * @param {import('./lib/types.mjs').Transport} exec
 * @param {NodeJS.ProcessEnv} env
 */
async function pickJobTransport(mode, client, fleet, exec, env) {
  if (mode === 'exec-poll') return createExecPollTransport(exec);
  if (mode !== 'auto' && mode !== 'jobs-api') throw new RuosError('invalid-input', 'jobs must be auto, exec-poll or jobs-api');
  const baseUrl = env.RUOS_API_URL || (client.url ? new URL(client.url).origin : undefined);
  const token = /** @type {any} */ (client).token;
  if (!baseUrl || !token) return createExecPollTransport(exec);
  const rest = createRestJobsBackend({ baseUrl, token });
  const first = (await fleet.listDesktops())[0];
  const available = first ? await rest.detect(first.flyMachineId ?? first.id) : false;
  if (!available && mode === 'jobs-api') throw new RuosError('not-configured', 'the ruOS jobs API is not available on this fleet yet');
  return available ? createJobsApiTransport(rest, exec) : createExecPollTransport(exec);
}

/** @param {unknown} o */
const print = (o) => process.stdout.write((typeof o === 'string' ? o : JSON.stringify(o, null, 2)) + '\n');

/**
 * @param {ReturnType<typeof parseArgs>} args
 * @returns {string}
 */
function readPrompt(args) {
  const file = str(args['prompt-file']);
  if (file) return readFileSync(file, 'utf8');
  const p = str(args.prompt);
  if (p) return p;
  throw new RuosError('invalid-input', 'pass --prompt or --prompt-file');
}

/**
 * @param {string[]} argv
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<number>}
 */
export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  switch (cmd) {
    case 'status': {
      const f = fleetConfigFromEnv(env);
      print({
        fleetMcp: f.url && f.token ? 'configured' : 'not-configured',
        credentialSource: f.source,
        ssh: env.RUOS_SSH_KEY ? 'configured' : 'not-configured',
        transport: env.RUOS_TRANSPORT ?? 'fleet-mcp',
        nextAutoStop: new Date(nextAutoStop(Date.now())).toISOString(),
        swarmLedger: (await resolveCallTool(projectCwd(env), env)) ? 'cli' : 'unavailable',
      });
      return 0;
    }
    case 'hosts': {
      const { adapter } = await buildAdapter(args, env);
      const ds = await adapter.discover();
      if (args.json) print(ds);
      else for (const d of ds) print(`${d.id}  ${(d.displayName ?? d.name).padEnd(32)}  ${d.state ?? '-'}/${d.heartbeatStatus ?? '-'}`);
      return 0;
    }
    case 'run': {
      const { adapter } = await buildAdapter(args, env);
      const runId = newRunId(randomBytes);
      const outcome = await adapter.run({
        desktop: String(args.desktop ?? ''),
        prompt: readPrompt(args),
        runId,
        agentId: str(args['agent-id']) ?? `ruos-${runId}`,
        agentType: str(args['agent-type']) ?? 'coder',
        model: /** @type {any} */ (str(args.model)),
        maxBudgetUsd: str(args['max-budget-usd']) ? Number(args['max-budget-usd']) : undefined,
        timeoutSecs: str(args.timeout) ? Number(args.timeout) : undefined,
        allowStart: args.start === true,
        ignoreAutoStop: args['ignore-autostop'] === true,
        onOutput: args.json ? undefined : (c) => process.stdout.write(c),
      });
      if (args.json) print(outcome);
      else process.stderr.write(`\n[ruflo-ruos] ${outcome.status} exit=${outcome.exitCode} run=${outcome.runId} ledger=${outcome.swarmLedger}\n`);
      return outcome.status === 'completed' ? 0 : 1;
    }
    case 'stop': {
      const { adapter } = await buildAdapter(args, env);
      print(await adapter.stopRun({ desktop: String(args.desktop ?? ''), runId: String(args.run ?? ''), confirm: args.confirm === true }));
      return 0;
    }
    case 'desktop-stop': {
      const { adapter } = await buildAdapter(args, env);
      print(await adapter.stopDesktop({ desktop: String(args.desktop ?? ''), confirm: args.confirm === true }));
      return 0;
    }
    case 'deploy-info': {
      // Read-only hand-off: report repo state; never push or deploy.
      const { adapter, exec } = await buildAdapter(args, env);
      const n = newNonce(randomBytes);
      const cmdline = buildRepoSummary(String(args.repo ?? ''), n);
      const d = await adapter.resolve(String(args.desktop ?? ''));
      print({ desktopId: d.id, repo: args.repo, ...parseRepoSummary((await exec.exec(d, cmdline, 30)).stdout, n),
        next: 'prepare a branch/PR and this summary for a human to review, merge and deploy; ruflo-ruos never pushes, deploys or publishes' });
      return 0;
    }
    case 'attach': {
      const { adapter } = await buildAdapter(args, env);
      const r = await adapter.attach({ desktop: String(args.desktop ?? ''), runId: String(args.run ?? ''), offset: str(args.offset) ? Number(args.offset) : 0,
        onOutput: args.json ? undefined : (c) => process.stdout.write(c) });
      if (args.json) print(r); else process.stderr.write(`\n[ruflo-ruos] ${r.status} exit=${r.exitCode} offset=${r.offset}\n`);
      return r.status === 'completed' ? 0 : 1;
    }
    case 'logs': {
      const runId = assertRunId(args.run);
      const f = join(projectCwd(env), '.claude-flow', 'ruos', 'runs', `${runId}.log`);
      if (!existsSync(f)) throw new RuosError('invalid-input', 'no local log for that run');
      process.stdout.write(readFileSync(f));
      return 0;
    }
    case 'build': {
      // Session path: Claude calls mcp__ruos__desktop_exec with these strings.
      const runId = str(args.run) ? assertRunId(args.run) : newRunId(randomBytes);
      const prompt = readPrompt(args);
      const chunks = buildPromptChunks(runId, prompt);
      // One nonce for this printout; output markers are `RUOS<nonce>_NAME`.
      const n = str(args.nonce) ?? newNonce(randomBytes);
      print({
        runId,
        nonce: n,
        promptSha256: chunks.sha256,
        steps: [buildPrepare(runId, n), ...chunks.commands, buildLaunch({ runId, prompt, runner: 'claude', model: /** @type {any} */ (str(args.model)), maxBudgetUsd: str(args['max-budget-usd']) ? Number(args['max-budget-usd']) : undefined }, n)],
        poll: buildPoll(runId, assertInt(str(args.offset) ?? 0, 0, Number.MAX_SAFE_INTEGER, 'offset'), n),
        stop: buildStop(runId, n),
        probe: buildProbe(n),
      });
      return 0;
    }
    case 'record':
      return record(args, env);
    default:
      print('usage: cli.mjs <status|hosts|run|attach|stop|desktop-stop|logs|build|record|deploy-info> [options]  (see header)');
      return cmd ? 2 : 0;
  }
}

/**
 * Session-path ledger feed: the Claude session drives the fleet MCP tools
 * itself and reports lifecycle here so the swarm state stays one source.
 * @param {ReturnType<typeof parseArgs>} args
 * @param {NodeJS.ProcessEnv} env
 */
async function record(args, env) {
  const phase = args._[1];
  const runId = assertRunId(args.run);
  const agentId = assertAgentId(args['agent-id'] ?? `ruos-${runId}`);
  const agentType = assertAgentId(args['agent-type'] ?? 'coder');
  const ledger = createLedger({ cwd: projectCwd(env), callTool: await resolveCallTool(projectCwd(env), env) });
  if (phase === 'start') {
    // The desktop must come from the caller's own desktop_status output.
    const statusFile = str(args['desktop-status-file']);
    if (!statusFile) throw new RuosError('invalid-input', 'record start needs --desktop-status-file (desktop_status JSON)');
    const d = resolveDesktop(normalizeDesktops(JSON.parse(readFileSync(statusFile, 'utf8'))), String(args.desktop ?? ''));
    if (!(await ledger.claim(runId, agentId, agentType))) throw new RuosError('invalid-input', 'run already claimed');
    const stopAt = d.flyMachineId ? new Date(nextAutoStop(Date.now())).toISOString() : null;
    await ledger.registerAgent(agentId, agentType, { kind: 'ruos', desktopId: d.id, desktopName: d.displayName ?? d.name, transport: 'fleet-mcp', jobs: 'exec-poll', runId, stopAt }, String(args.task ?? ''));
    ledger.snapshotHosts([d]);
    ledger.setHostAgent(d.id, agentId, true);
    ledger.event({ type: 'run.started', runId, agentId, desktopId: d.id, desktopName: d.displayName ?? d.name });
  } else if (phase === 'output') {
    const b64 = String(args.b64 ?? '');
    if (!/^[A-Za-z0-9+/=]*$/.test(b64)) throw new RuosError('invalid-input', 'b64 is not base64');
    const chunk = Buffer.from(b64, 'base64');
    ledger.appendOutput(runId, chunk);
    ledger.event({ type: 'run.output', runId, agentId, bytes: chunk.length });
  } else if (phase === 'end') {
    const exit = args.exit === undefined ? null : assertInt(args.exit, 0, 255, 'exit');
    const status = exit === 0 ? 'completed' : 'failed';
    ledger.event({ type: status === 'completed' ? 'run.completed' : 'run.failed', runId, agentId, exitCode: exit });
    await ledger.updateAgent(agentId, 'idle', { runId, status, exitCode: exit });
    await ledger.release(runId, agentId, agentType);
    ledger.setHostAgent(null, agentId, false);
  } else {
    throw new RuosError('invalid-input', 'record phase must be start|output|end');
  }
  print({ ok: true, runId, agentId, swarmLedger: ledger.swarmLedger, warnings: ledger.warnings });
  return 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '');
if (isMain) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c; }, (err) => {
    if (err instanceof RuosError) {
      process.stderr.write(`ruflo-ruos: ${err.code}: ${err.message}\n`);
      process.exitCode = err.code === 'not-configured' || err.code === 'confirm-required' ? 2 : 1;
    } else {
      process.stderr.write(`ruflo-ruos: ${String(err?.stack ?? err)}\n`);
      process.exitCode = 1;
    }
  });
}
