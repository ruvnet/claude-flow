#!/usr/bin/env node
/** Deterministic process E2E: real detached workers, real Git worktrees and production run persistence.
 * No model/provider calls. Run on Linux/macOS: node scripts/e2e-recovery.mjs [--disconnect-seconds 60].
 * The transport fixture uses local process files instead of the hosted jobs API. It deliberately returns
 * server IDs different from client IDs and drops the connection after the first committed output chunk.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuosHostAdapter } from './lib/adapter.mjs';
import { createLedger } from './lib/ledger.mjs';
import { RuosError } from './lib/types.mjs';

const secondsAt = process.argv.indexOf('--disconnect-seconds');
const disconnectSeconds = secondsAt < 0 ? 60 : Number(process.argv[secondsAt + 1]);
assert(Number.isInteger(disconnectSeconds) && disconnectSeconds >= 1 && disconnectSeconds <= 120);
const startedAt = Date.now();
const root = mkdtempSync(join(tmpdir(), 'ruflo-recovery-e2e-'));
const repo = join(root, 'project');
const remote = join(root, 'remote');
mkdirSync(repo); mkdirSync(remote);
const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
git('init', '-q');
writeFileSync(join(repo, 'README.md'), 'Recovery acceptance fixture\n');
git('add', 'README.md');
git('-c', 'user.name=Recovery test', '-c', 'user.email=recovery@example.invalid', 'commit', '-qm', 'fixture');
const commit = git('rev-parse', 'HEAD');
const worktrees = ['a', 'b'].map(name => {
  const path = join(root, `worktree-${name}`);
  git('worktree', 'add', '-qb', name, path);
  return path;
});
const worker = join(root, 'worker.mjs');
writeFileSync(worker, `import{writeFileSync,appendFileSync}from'node:fs';
const[dir,workspace,ms]=process.argv.slice(2);
appendFileSync(workspace+'/executions.txt','started\\n');
appendFileSync(dir+'/output','start\\n');
setTimeout(()=>{appendFileSync(dir+'/output','complete\\n');writeFileSync(workspace+'/result.txt','verified\\n');writeFileSync(dir+'/exit','0');},Number(ms));`);
const descriptor = { id: 'e2e-owned-host', name: 'deterministic local worker', displayName: 'E2E', flyMachineId: null,
  heartbeatAt: Math.floor(Date.now() / 1000), heartbeatStatus: 'fresh', ready: true, state: 'started' };
const fleet = { listDesktops: async () => [{ ...descriptor, heartbeatAt: Math.floor(Date.now() / 1000) }],
  llmRoute: async () => ({ route: 'test-fixture', provider: 'none', gateway: 'configured', keyPresent: false }),
  start: async () => { throw Error('unexpected wake') }, stop: async () => { throw Error('unexpected desktop stop') }, keepAwake: async () => {} };
let launches = 0, cancellations = 0;
const children = [];
const failures = new Set();
const delay = ms => new Promise(done => setTimeout(done, ms));
/** @type {import('./lib/types.mjs').JobTransport} */
const jobs = {
  kind: 'jobs-api',
  async start(_desktop, spec) {
    launches++;
    const jobId = `server-${spec.runId}`;
    const dir = join(remote, jobId); mkdirSync(dir);
    writeFileSync(join(dir, 'output'), '');
    const child = spawn(process.execPath, [worker, dir, spec.prompt, String((disconnectSeconds + 1) * 1000)], { detached: true, stdio: 'ignore' });
    children.push(child.pid); child.unref();
    await delay(200);
    return { jobId, commandSha256: createHash('sha256').update(readFileSync(worker)).digest('hex') };
  },
  async poll(_desktop, jobId, offset) {
    assert(jobId.startsWith('server-'), 'must use persisted server job ID');
    if (offset > 0 && !failures.has(jobId)) {
      failures.add(jobId);
      throw new RuosError('network-down', 'injected client disconnect');
    }
    const dir = join(remote, jobId);
    const all = readFileSync(join(dir, 'output'));
    const done = existsSync(join(dir, 'exit'));
    return { chunk: all.subarray(offset), nextOffset: all.length, state: done ? 'exited' : 'running', running: !done, exitCode: done ? 0 : null, truncated: false };
  },
  async cancel() { cancellations++; throw Error('unexpected cancel') },
};
const make = () => {
  const ledger = createLedger({ cwd: repo, callTool: null });
  return { ledger, adapter: new RuosHostAdapter({ fleet, jobs, ledger, sleep: ms => delay(Math.min(ms, 100)) }) };
};
try {
  const initial = make();
  const runIds = ['r-recovery-e2e-a', 'r-recovery-e2e-b'];
  for (const [index, runId] of runIds.entries()) {
    await assert.rejects(initial.adapter.run({ desktop: descriptor.id, runId, agentId: `agent-${index}`, prompt: worktrees[index],
      timeoutSecs: 180, binding: { worktree: worktrees[index], commit, missionId: `msn_${String(index).repeat(24)}`, missionRevision: 2 } }), /disconnect/);
  }
  const before = initial.ledger.runs.required(runIds[0]);
  assert.equal(before.nextOffset, 6);
  assert.notEqual(before.state, 'failed');
  assert.equal(before.connection, 'disconnected');
  assert.equal(launches, 2);
  process.stdout.write(JSON.stringify({ phase: 'disconnected', workers: 2, nextOffset: before.nextOffset, disconnectSeconds }) + '\n');
  await delay(disconnectSeconds * 1000);
  // New service and new ledger: no object from the first client supplies its attachment identity/cursor.
  const recovered = make();
  for (const runId of runIds) {
    const result = await recovered.adapter.attach({ desktop: descriptor.id, runId, timeoutSecs: 10 });
    assert.equal(result.status, 'completed');
    assert.equal(result.exitCode, 0);
    assert.equal(readFileSync(join(repo, '.claude-flow/ruos/runs', `${runId}.log`), 'utf8'), 'start\ncomplete\n');
    await recovered.adapter.attach({ desktop: descriptor.id, runId, timeoutSecs: 2 });
    assert.equal(readFileSync(join(repo, '.claude-flow/ruos/runs', `${runId}.log`), 'utf8'), 'start\ncomplete\n');
  }
  await assert.rejects(recovered.adapter.stopRun({ desktop: descriptor.id, runId: runIds[0], confirm: true,
    expectedRevision: before.revision, bindingDigest: before.bindingDigest }), /revision|stale|terminal|completed/i);
  for (const workspace of worktrees) {
    assert.equal(readFileSync(join(workspace, 'executions.txt'), 'utf8'), 'started\n');
    assert.equal(readFileSync(join(workspace, 'result.txt'), 'utf8'), 'verified\n');
  }
  const cli = resolve(fileURLToPath(new URL('./cli.mjs', import.meta.url)));
  const saved = JSON.parse(execFileSync(process.execPath, [cli, 'runs', '--run', runIds[0]], { cwd: repo, env: { ...process.env, CLAUDE_FLOW_CWD: repo } }).toString());
  assert.equal(saved.jobId, `server-${runIds[0]}`);
  assert.equal(launches, 2); assert.equal(cancellations, 0);
  process.stdout.write(JSON.stringify({ passed: true, evidence: 'real detached deterministic processes; local transport fixture, no hosted API or LLM',
    workers: 2, worktrees: 2, disconnectSeconds, duplicateExecutions: 0, duplicateOutputBytes: 0, cancellationCalls: cancellations,
    staleApprovalRejected: true, savedServerJobId: true, persistedCursor: true, elapsedMs: Date.now() - startedAt }) + '\n');
} finally {
  for (const pid of children) { try { process.kill(pid, 'SIGTERM') } catch {} }
  rmSync(root, { recursive: true, force: true });
}
