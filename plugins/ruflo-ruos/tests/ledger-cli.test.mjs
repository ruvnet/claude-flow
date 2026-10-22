// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createLedger } from '../scripts/lib/ledger.mjs';
import { desktop, DESKTOP_ID } from './fakes.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(here, '../scripts/cli.mjs');
const REPO_DIST = resolve(here, '../../../v3/@claude-flow/cli/dist/src/mcp-client.js');
const tmp = () => mkdtempSync(join(tmpdir(), 'ruflo-ruos-ledger-'));
const host = { kind: /** @type {'ruos'} */ ('ruos'), desktopId: DESKTOP_ID, desktopName: 'Work Desktop', transport: /** @type {'fleet-mcp'} */ ('fleet-mcp'), runId: 'r-ledger-0001' };

test('ledger records through ruflo tools (mocked callTool) and owns only .claude-flow/ruos', async () => {
  const cwd = tmp();
  /** @type {Array<[string, any]>} */ const calls = [];
  const ledger = createLedger({ cwd, callTool: async (n, i) => { calls.push([n, i]); return { success: true }; } });
  assert.equal(await ledger.claim('r-ledger-0001', 'a1', 'coder'), true);
  await ledger.registerAgent('a1', 'coder', host, 'task text');
  ledger.event({ type: 'run.started', runId: 'r-ledger-0001' });
  ledger.appendOutput('r-ledger-0001', Buffer.from('out'));
  ledger.snapshotHosts([desktop()]);
  ledger.setHostAgent(DESKTOP_ID, 'a1', true);
  await ledger.updateAgent('a1', 'idle', { exitCode: 0 });
  await ledger.release('r-ledger-0001', 'a1', 'coder');
  assert.deepEqual(calls.map((c) => c[0]), ['claims_claim', 'agent_spawn', 'agent_update', 'agent_update', 'claims_release']);
  assert.deepEqual(calls[0][1], { issueId: 'ruos-run-r-ledger-0001', claimant: 'agent:a1:coder' });
  assert.deepEqual(calls[1][1].config.host, host);
  assert.equal(ledger.swarmLedger, 'cli');
  const hosts = JSON.parse(readFileSync(join(cwd, '.claude-flow/ruos/hosts.json'), 'utf8'));
  assert.deepEqual(hosts.hosts[0].agents, ['a1']);
  assert.equal(statSync(join(cwd, '.claude-flow/ruos/runs/r-ledger-0001.log')).mode & 0o077, 0);
  assert.ok(!existsSync(join(cwd, '.claude-flow/agents')), 'never writes ruflo stores directly');
});

test('hosts.json merges: discovery keeps placements, runs keep other hosts', () => {
  const cwd = tmp();
  const ledger = createLedger({ cwd, callTool: null });
  const other = desktop({ id: 'c'.repeat(32), displayName: 'Other' });
  ledger.snapshotHosts([desktop(), other]);
  ledger.setHostAgent(DESKTOP_ID, 'a1', true);
  ledger.snapshotHosts([desktop({ state: 'started' })]); // single-host refresh mid-run
  ledger.snapshotHosts([desktop(), other]); // full discovery mid-run
  const read = () => JSON.parse(readFileSync(join(cwd, '.claude-flow/ruos/hosts.json'), 'utf8')).hosts;
  assert.equal(read().length, 2);
  assert.deepEqual(read().find((/** @type {any} */ h) => h.desktopId === DESKTOP_ID).agents, ['a1']);
  ledger.setHostAgent(null, 'a1', false);
  assert.deepEqual(read().find((/** @type {any} */ h) => h.desktopId === DESKTOP_ID).agents, []);
});

test('policy denial / missing tool degrades to unavailable without throwing', async () => {
  const ledger = createLedger({ cwd: tmp(), callTool: async () => { throw new Error('policy-denied:enforce; receipt=x'); } });
  await ledger.registerAgent('a1', 'coder', host, 't');
  assert.equal(ledger.swarmLedger, 'unavailable');
  assert.equal(await ledger.claim('r-ledger-0001', 'a1', 'coder'), true, 'no ledger means no claim conflict to report');
  assert.ok(ledger.warnings[0].includes('policy-denied'));
  const conflict = createLedger({ cwd: tmp(), callTool: async () => ({ success: false, error: 'Issue already claimed' }) });
  assert.equal(await conflict.claim('r-ledger-0001', 'a1', 'coder'), false);
  const none = createLedger({ cwd: tmp(), callTool: null });
  assert.equal(none.swarmLedger, 'unavailable');
});

test('real ruflo CLI: agent store carries config.host and claims round-trip', { skip: !existsSync(REPO_DIST) && 'v3 CLI not built' }, () => {
  const cwd = tmp();
  const status = join(cwd, 'status.json');
  writeFileSync(status, JSON.stringify({ desktops: [{ machine_id: DESKTOP_ID, fly_machine_id: '85050dc77130e8', name: 'w', display_name: 'Work Desktop', state: 'started', heartbeat_status: 'ok', last_heartbeat_at: 1 }] }));
  const env = { ...process.env, RUFLO_CLI_MCP_CLIENT: REPO_DIST, CLAUDE_FLOW_CWD: '' };
  const run = (/** @type {string[]} */ a) => JSON.parse(execFileSync('node', [CLI, ...a], { cwd, env, encoding: 'utf8' }));
  const start = run(['record', 'start', '--run', 'r-ledger-0002', '--agent-id', 'ruos-int-1', '--desktop', 'Work Desktop', '--desktop-status-file', status, '--task', 'demo']);
  assert.equal(start.swarmLedger, 'cli');
  const store = JSON.parse(readFileSync(join(cwd, '.claude-flow/agents/store.json'), 'utf8'));
  assert.equal(store.agents['ruos-int-1'].status, 'busy');
  const h = store.agents['ruos-int-1'].config.host;
  assert.deepEqual({ ...h, stopAt: undefined }, { kind: 'ruos', desktopId: DESKTOP_ID, desktopName: 'Work Desktop', transport: 'fleet-mcp', jobs: 'exec-poll', runId: 'r-ledger-0002', stopAt: undefined });
  assert.match(h.stopAt, /T0[34]:00:00\.000Z$/, '23:00 Toronto deadline recorded');
  const claims = JSON.parse(readFileSync(join(cwd, '.claude-flow/claims/claims.json'), 'utf8'));
  assert.equal(claims.claims['ruos-run-r-ledger-0002'].claimant.agentId, 'ruos-int-1');
  run(['record', 'output', '--run', 'r-ledger-0002', '--agent-id', 'ruos-int-1', '--b64', Buffer.from('hi').toString('base64')]);
  run(['record', 'end', '--run', 'r-ledger-0002', '--agent-id', 'ruos-int-1', '--exit', '0']);
  const after = JSON.parse(readFileSync(join(cwd, '.claude-flow/agents/store.json'), 'utf8'));
  assert.equal(after.agents['ruos-int-1'].status, 'idle');
  const events = readFileSync(join(cwd, '.claude-flow/ruos/events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).type);
  assert.deepEqual(events, ['run.started', 'run.output', 'run.completed']);
  assert.equal(readFileSync(join(cwd, '.claude-flow/ruos/runs/r-ledger-0002.log'), 'utf8'), 'hi');
  // A foreign desktop is refused even on the session path.
  assert.throws(() => execFileSync('node', [CLI, 'record', 'start', '--run', 'r-ledger-0003', '--desktop', 'f'.repeat(32), '--desktop-status-file', status], { cwd, env, stdio: 'pipe' }));
});

test('CLI with no configuration: exits 2, makes no network call', () => {
  const cwd = tmp();
  const env = { PATH: process.env.PATH ?? '', HOME: cwd };
  for (const cmd of [['hosts'], ['run', '--desktop', 'x', '--prompt', 'y']]) {
    let code = 0;
    let stderr = '';
    try {
      execFileSync('node', [CLI, ...cmd], { cwd, env, stdio: 'pipe' });
    } catch (e) {
      const err = /** @type {any} */ (e);
      code = err.status;
      stderr = String(err.stderr);
    }
    assert.equal(code, 2, cmd.join(' '));
    assert.match(stderr, /not-configured/);
  }
  const status = JSON.parse(execFileSync('node', [CLI, 'status'], { cwd, env, encoding: 'utf8' }));
  assert.equal(status.fleetMcp, 'not-configured');
  assert.ok(!existsSync(join(cwd, '.claude-flow')), 'nothing written when unconfigured');
});

test('CLI build prints the audited session-path strings', () => {
  const cwd = tmp();
  const pf = join(cwd, 'p.txt');
  writeFileSync(pf, 'do $(rm -rf ~) the thing');
  const out = JSON.parse(execFileSync('node', [CLI, 'build', '--run', 'r-build-0001', '--prompt-file', pf, '--model', 'haiku'], { cwd, encoding: 'utf8' }));
  assert.equal(out.runId, 'r-build-0001');
  assert.ok(out.steps.length >= 3);
  assert.ok(!JSON.stringify(out).includes('rm -rf ~'));
  assert.match(out.poll, /RUOS%s_POLL/);
  assert.match(out.nonce, /^[0-9a-f]{16}$/);
  assert.ok(out.poll.includes(`'${out.nonce}'`));
});
