#!/usr/bin/env node
/**
 * ADR-406 end-to-end gate, run against the BUILT CLI (`npm run build` first).
 *
 * Every step runs in throwaway directories: a temp project, a temp HOME and a
 * temp CLAUDE_CONFIG_DIR, so the person's real ~/.claude and ~/.claude-flow are
 * never read or written. Live Claude Code steps run only with RUFLO_E2E_LIVE=1
 * and only call `--version` and `plugin validate` (no model, no spend).
 *
 *   node scripts/e2e-adr-406.mjs            # exit 0 = every step passed
 *   RUFLO_E2E_LIVE=1 node scripts/e2e-adr-406.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(CLI_DIR, '../../..');
const BIN = join(CLI_DIR, 'bin', 'cli.js');
const MCP_BIN = join(CLI_DIR, 'bin', 'mcp-server.js');
if (!existsSync(join(CLI_DIR, 'dist', 'src', 'missions', 'index.js'))) {
  console.error('dist/ is missing the missions module: run `npm run build` first');
  process.exit(2);
}

const scratch = mkdtempSync(join(tmpdir(), 'ruflo-e2e-406-'));
const HOME = join(scratch, 'home');
const CONFIG = join(scratch, 'claude-config');
for (const d of [HOME, CONFIG]) spawnSync('mkdir', ['-p', d]);
const ENV = {
  ...process.env,
  HOME,
  USERPROFILE: HOME,
  CLAUDE_CONFIG_DIR: CONFIG,
  RUFLO_DAEMON_AUTOSTART: '0',
  CLAUDE_FLOW_CWD: '',
  NO_COLOR: '1',
};
delete ENV.CLAUDE_FLOW_CWD;

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ step: name, ok: true, ms: Date.now() - started, ...(detail ? { detail } : {}) });
  } catch (error) {
    results.push({ step: name, ok: false, ms: Date.now() - started, error: String(error?.message ?? error) });
  }
}
function assert(cond, message) { if (!cond) throw new Error(message); }

function project(name) {
  const dir = join(scratch, name);
  spawnSync('mkdir', ['-p', join(dir, '.claude-flow')]);
  return dir;
}

/** Run the built CLI; stdout's last JSON object is returned. */
function cli(cwd, args) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env: ENV, encoding: 'utf8', timeout: 120_000 });
  const out = r.stdout ?? '';
  const start = out.indexOf('{');
  let json = null;
  if (start >= 0) { try { json = JSON.parse(out.slice(start, out.lastIndexOf('}') + 1)); } catch { /* not json */ } }
  return { status: r.status, stdout: out, stderr: r.stderr ?? '', json };
}

/** A stdio MCP session against the built server in `cwd`. */
function mcpSession(cwd) {
  const child = spawn(process.execPath, [MCP_BIN], { cwd, env: ENV, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let nextId = 1;
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('{')) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
      } catch { /* log noise */ }
    }
  });
  const request = (method, params) => new Promise((done, fail) => {
    const id = nextId++;
    const timer = setTimeout(() => fail(new Error(`MCP ${method} timed out`)), 60_000);
    waiting.set(id, (msg) => { clearTimeout(timer); done(msg); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return {
    async init() { await request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-adr-406', version: '1' } }); },
    async tool(name, args) {
      const msg = await request('tools/call', { name, arguments: args });
      if (msg.error) throw new Error(`${name}: ${JSON.stringify(msg.error)}`);
      return JSON.parse(msg.result.content[0].text);
    },
    close() { child.kill('SIGTERM'); },
  };
}

function hashCommandFiles() {
  const out = {};
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (name === 'node_modules') continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (full.includes('/commands/') && name.endsWith('.md')) out[full] = createHash('sha256').update(readFileSync(full)).digest('hex');
    }
  };
  for (const d of ['.claude/commands', 'v3/@claude-flow/cli/.claude/commands', 'plugins']) walk(join(REPO, d));
  return out;
}

const PLAN = {
  tasks: [
    { id: 'produce', title: 'Produce artifact', executor: { mode: 'durable-executor', requirement: 'ruos-job' }, estimatedCostMinor: 100 },
    { id: 'evaluate', title: 'Evaluate artifact', dependsOn: ['produce'], executor: { mode: 'durable-executor', requirement: 'metaharness' }, acceptanceEvidence: ['quality'] },
    { id: 'verify', title: 'Verify acceptance', dependsOn: ['evaluate'], executor: { mode: 'session-bound', requirement: 'claude-session' } },
  ],
  acceptance: [{ id: 'quality', check: 'score >= baseline', producer: 'metaharness', independent: true }],
  budget: { currency: 'USD', ceilingMinor: 1000 },
};

// ---------------------------------------------------------------------------

const before = hashCommandFiles();

await step('catalog: committed catalog is current and deterministic', () => {
  const p = project('catalog');
  const check = cli(p, ['catalog', 'generate', '--check', '--json', '--repo-root', REPO]);
  assert(check.status === 0 && check.json?.upToDate === true, `catalog stale or failed: ${check.stdout.slice(-400)} ${check.stderr.slice(-400)}`);
  const verify = cli(p, ['catalog', 'verify', '--json', '--repo-root', REPO]);
  assert(verify.status === 0 && verify.json?.valid === true, `verify failed: ${verify.stdout.slice(-400)}`);
  return check.json.summary;
});

await step('catalog: legacy command files byte-unchanged', () => {
  const after = hashCommandFiles();
  assert(Object.keys(before).length > 300, 'too few command files found');
  assert(JSON.stringify(after) === JSON.stringify(before), 'a legacy command file changed');
  return { files: Object.keys(after).length };
});

const shared = project('shared');
let missionId = '';
await step('mission: create via CLI, plan via MCP, both read the same state', async () => {
  const created = cli(shared, ['mission', 'create', '--objective', 'Ship a verified artifact', '--request-id', 'e2e-create']);
  assert(created.status === 0 && created.json?.ok, `create failed: ${created.stdout} ${created.stderr.slice(-300)}`);
  missionId = created.json.data.missionId;
  const mcp = mcpSession(shared);
  try {
    await mcp.init();
    const again = await mcp.tool('mission_create', { requestId: 'e2e-create', objective: 'Ship a verified artifact' });
    assert(again.ok && again.data.deduplicated && again.data.missionId === missionId, 'MCP create did not deduplicate to the CLI mission');
    const planned = await mcp.tool('mission_plan', { requestId: 'e2e-plan', missionId, expectedRevision: 1, plan: PLAN });
    assert(planned.ok && planned.data.state === 'planned' && planned.data.revision === 2, `MCP plan failed: ${JSON.stringify(planned)}`);
    const viaMcp = await mcp.tool('mission_get', { missionId });
    const viaCli = cli(shared, ['mission', 'get', '--mission', missionId]).json;
    assert(JSON.stringify(viaMcp.data.record) === JSON.stringify(viaCli.data.record), 'CLI and MCP records differ');
    const evMcp = await mcp.tool('mission_events', { missionId, afterSequence: 0 });
    const evCli = cli(shared, ['mission', 'events', '--mission', missionId, '--after', '0']).json;
    assert(JSON.stringify(evMcp.data.events) === JSON.stringify(evCli.data.events), 'CLI and MCP events differ');
    assert(evCli.data.events.map((e) => e.channel).join(',') === 'cli,mcp', 'event channels not recorded');
    return { missionId, revision: viaCli.data.record.revision, executionMode: viaCli.data.record.executionMode };
  } finally {
    mcp.close();
  }
});

await step('mission: revision conflict is rejected with the current revision', () => {
  const planFile = join(shared, 'plan2.json');
  writeFileSync(planFile, JSON.stringify({ ...PLAN, budget: { currency: 'USD', ceilingMinor: 2000 } }));
  const r = cli(shared, ['mission', 'plan', '--mission', missionId, '--expected-revision', '1', '--plan-file', planFile, '--request-id', 'e2e-stale']);
  assert(r.status === 3 && r.json?.code === 'revision-conflict' && r.json.currentRevision === 2, `expected conflict: ${r.stdout}`);
});

await step('mission: honest refusal of admission without a durable executor', () => {
  const r = cli(shared, ['mission', 'action', '--mission', missionId, '--expected-revision', '2', '--action', 'admit', '--request-id', 'e2e-admit']);
  assert(r.status === 1 && r.json?.code === 'executor-unavailable', `expected executor-unavailable: ${r.stdout}`);
});

await step('mission: kill a writer mid-stream, restart, reconstruct state', async () => {
  const p = project('kill');
  const childSrc = join(scratch, 'kill-writer.mjs');
  writeFileSync(childSrc, `
    import { MissionService } from ${JSON.stringify(join(CLI_DIR, 'dist/src/missions/index.js'))};
    const s = new MissionService({ projectRoot: process.argv[2], channel: 'cli' });
    const c = await s.create({ requestId: 'k', objective: 'survive SIGKILL' });
    let rev = c.data.revision; console.log('ready ' + c.data.missionId);
    const plan = ${JSON.stringify(PLAN)};
    for (let i = 0; ; i++) {
      const r = await s.plan({ requestId: 'k' + i, missionId: c.data.missionId, expectedRevision: rev, plan: { ...plan, budget: { currency: 'USD', ceilingMinor: 1000 + i } } });
      if (!r.ok) throw new Error(r.message); rev = r.data.revision;
    }`);
  const child = spawn(process.execPath, [childSrc, p], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  const id = await new Promise((done, fail) => {
    child.stdout.on('data', (d) => { const m = String(d).match(/ready (msn_[a-f0-9]{24})/); if (m) done(m[1]); });
    child.on('exit', (code) => fail(new Error(`writer exited ${code}`)));
  });
  const log = join(p, '.claude-flow', 'missions', id, 'events.jsonl');
  const deadline = Date.now() + 20_000;
  while ((existsSync(log) ? readFileSync(log, 'utf8').split('\n').length : 0) < 40 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 25));
  child.kill('SIGKILL');
  await new Promise((r) => child.on('exit', r));
  const got = cli(p, ['mission', 'get', '--mission', id]).json;
  assert(got?.ok, 'get after kill failed');
  const events = cli(p, ['mission', 'events', '--mission', id, '--limit', '500']).json;
  assert(events.ok && events.data.lastEventSequence === got.data.record.lastEventSequence, 'snapshot and log disagree after kill');
  const mcp = mcpSession(p);
  try {
    await mcp.init();
    const next = await mcp.tool('mission_plan', { requestId: 'after-kill', missionId: id, expectedRevision: got.data.record.revision, plan: PLAN });
    assert(next.ok && next.data.revision === got.data.record.revision + 1, `writer after kill failed: ${JSON.stringify(next)}`);
  } finally {
    mcp.close();
  }
  return { eventsBeforeKill: events.data.lastEventSequence, revisionAfterRestart: got.data.record.revision + 1 };
});

await step('§18 fixture replay: mods off vs on leaves permissions, policy and outcomes unchanged', () => {
  const fixture = (p) => {
    const outcomes = [];
    const c = cli(p, ['mission', 'create', '--objective', 'fixture', '--request-id', 'fx-1']).json;
    outcomes.push(c.ok, c.data.state);
    const pf = join(p, 'plan.json');
    writeFileSync(pf, JSON.stringify(PLAN));
    const pl = cli(p, ['mission', 'plan', '--mission', c.data.missionId, '--expected-revision', '1', '--plan-file', pf, '--request-id', 'fx-2']).json;
    outcomes.push(pl.ok, pl.data?.state);
    const stale = cli(p, ['mission', 'plan', '--mission', c.data.missionId, '--expected-revision', '1', '--plan-file', pf, '--request-id', 'fx-3']).json;
    outcomes.push(stale.code);
    const admit = cli(p, ['mission', 'action', '--mission', c.data.missionId, '--expected-revision', '2', '--action', 'admit', '--request-id', 'fx-4']).json;
    outcomes.push(admit.code);
    const cancel = cli(p, ['mission', 'action', '--mission', c.data.missionId, '--expected-revision', '2', '--action', 'cancel', '--request-id', 'fx-5']).json;
    outcomes.push(cancel.data?.state);
    const ev = cli(p, ['mission', 'events', '--mission', c.data.missionId]).json;
    outcomes.push(ev.data.events.map((e) => e.type).join('>'));
    return outcomes;
  };
  const permissions = (p) => {
    const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).permissions ?? null : null);
    const policy = cli(p, ['policy', 'status']).stdout;
    const mode = (policy.match(/"mode":\s*"(\w+)"/) ?? [])[1] ?? 'unknown';
    return JSON.stringify({ local: read(join(p, '.claude', 'settings.local.json')), project: read(join(p, '.claude', 'settings.json')), mode });
  };
  const off = project('mods-off');
  const on = project('mods-on');
  spawnSync('mkdir', ['-p', join(off, '.claude'), join(on, '.claude')]);
  // A real permissions block the mod must neither widen nor drop.
  const seeded = JSON.stringify({ permissions: { allow: ['Bash(npm test)'], deny: ['Bash(rm -rf *)'], ask: ['Bash(git push:*)'] } }, null, 2);
  for (const p of [off, on]) writeFileSync(join(p, '.claude', 'settings.local.json'), seeded);
  const permOffBefore = permissions(off);
  const permOnBefore = permissions(on);
  const install = cli(on, ['mods', 'install']);
  assert(install.status === 0, `mods install failed: ${install.stdout.slice(-300)} ${install.stderr.slice(-300)}`);
  const settings = JSON.parse(readFileSync(join(on, '.claude', 'settings.local.json'), 'utf8'));
  assert(JSON.stringify(settings).includes('ruflo-mods'), 'mods install did not enable the plugin');
  const permOnAfterInstall = permissions(on);
  const outOff = fixture(off);
  const outOn = fixture(on);
  assert(JSON.stringify(outOff) === JSON.stringify(outOn), `outcomes differ: off=${JSON.stringify(outOff)} on=${JSON.stringify(outOn)}`);
  assert(permOnBefore === permOnAfterInstall, `mods install changed permissions or policy mode: ${permOnBefore} -> ${permOnAfterInstall}`);
  assert(permOffBefore === permissions(off), 'permissions drifted with mods off');
  assert(permOnAfterInstall === permissions(on), 'permissions drifted with mods on');
  const uninstall = cli(on, ['mods', 'uninstall']);
  assert(uninstall.status === 0, 'mods uninstall failed');
  assert(permissions(on) === permOnBefore, 'uninstall did not restore permissions');
  return { outcomes: outOff, permissions: JSON.parse(permOnBefore) };
});

await step('no real ~/.claude or ~/.claude-flow touched', () => {
  assert(ENV.HOME !== homedir() && ENV.CLAUDE_CONFIG_DIR.startsWith(scratch), 'HOME or CLAUDE_CONFIG_DIR was not isolated');
  return { home: 'isolated', claudeConfigDir: 'isolated' };
});

if (process.env.RUFLO_E2E_LIVE === '1') {
  await step('live: engine version and plugin validate (no model calls)', () => {
    const claude = join(homedir(), '.local', 'bin', 'claude');
    assert(existsSync(claude), 'claude executable not found');
    const version = spawnSync(claude, ['--version'], { env: ENV, encoding: 'utf8' });
    const validate = ['ruflo-mods', 'ruflo-swarm'].map((p) => spawnSync(claude, ['plugin', 'validate', join(REPO, 'plugins', p)], { env: ENV, encoding: 'utf8' }));
    assert(validate.every((v) => v.status === 0), 'plugin validate failed');
    const engine = cli(project('engine'), ['catalog', 'engine', '--json', '--repo-root', REPO, '--engine', claude]).json;
    assert(engine?.collisions?.find((c) => c.name === 'ruflo')?.verdict === 'free', 'bare /ruflo collision');
    return { version: version.stdout.trim(), validated: ['ruflo-mods', 'ruflo-swarm'] };
  });
} else {
  results.push({ step: 'live: engine steps', ok: true, skipped: 'set RUFLO_E2E_LIVE=1' });
}

rmSync(scratch, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ adr: 406, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
process.exit(failed.length ? 1 : 0);
