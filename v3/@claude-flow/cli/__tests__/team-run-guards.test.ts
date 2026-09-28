/**
 * `ruflo team run` guards from the #3513 review: the command comes from the
 * host definition (never team.json), command hosts need a trust step, runs
 * respect team and plan state, one run per agent at a time, and the result
 * file read is bounded. No model calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { teamTools } from '../src/mcp-tools/team-tools.js';
import { planBlock, readResultFile, runTeamAgent } from '../src/mcp-tools/team-runner.js';
import { loadTeamHosts, recordTrust, unsafeCommandReason } from '../src/mcp-tools/team-hosts/index.js';
import { parseHookPayload, readHookPayload } from '../src/commands/team.js';

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

const node = process.execPath;

describe('team run guards', () => {
  let cwd: string;
  let prev: string | undefined;
  let prevTrust: string | undefined;

  const teamFile = (team = 'demo') => join(cwd, '.claude-flow', 'teams', team, 'team.json');
  const readTeam = (team = 'demo') => JSON.parse(readFileSync(teamFile(team), 'utf-8'));
  const writeTeam = (t: unknown, team = 'demo') => writeFileSync(teamFile(team), JSON.stringify(t));

  function writeHosts(hosts: Record<string, unknown>) {
    mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
    writeFileSync(join(cwd, '.claude-flow', 'team-hosts.json'), JSON.stringify({ hosts }));
  }

  function trust(label = 'myagent') {
    recordTrust(cwd, label, loadTeamHosts(cwd)[label], { allowUnsafeCommand: true });
  }

  async function setup(args: string[], steps = ['worker', 'checker']) {
    writeHosts({ myagent: { kind: 'exec', command: node, args, promptVia: 'arg' } });
    trust();
    await tool('team_create').handler({ name: 'demo', host: 'myagent' });
    await tool('team_plan').handler({ team: 'demo', steps });
    for (const agent of ['worker', 'checker']) {
      const s = await tool('team_spawn').handler({ team: 'demo', agent, role: 'coder', prompt: 'do it' });
      expect(s.success).toBe(true);
    }
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-guards-'));
    prev = process.env.CLAUDE_FLOW_CWD;
    prevTrust = process.env.RUFLO_TEAM_TRUST_FILE;
    process.env.CLAUDE_FLOW_CWD = cwd;
    process.env.RUFLO_TEAM_TRUST_FILE = join(cwd, 'trust.json');
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prev;
    if (prevTrust === undefined) delete process.env.RUFLO_TEAM_TRUST_FILE;
    else process.env.RUFLO_TEAM_TRUST_FILE = prevTrust;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('delivers only this team\'s mail and re-queues it to the same team', async () => {
    const seen = join(cwd, 'prompt-seen.txt');
    await setup(['-e', `require('fs').writeFileSync(${JSON.stringify(seen)}, process.argv[1]);process.exit(3)`, '{prompt}']);
    await tool('team_create').handler({ name: 'other', host: 'myagent' });
    await tool('team_spawn').handler({ team: 'other', agent: 'worker', role: 'coder' });
    await tool('team_send').handler({ team: 'other', to: 'worker', message: 'SECRET-FOR-TEAM-OTHER-ONLY' });
    await tool('team_send').handler({ team: 'demo', to: 'worker', message: 'for demo' });

    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.outcome).toBe('failed');
    const prompt = readFileSync(seen, 'utf-8');
    expect(prompt).toContain('for demo');
    expect(prompt).not.toContain('SECRET-FOR-TEAM-OTHER-ONLY');

    const inbox = async (team: string) =>
      ((await tool('team_inbox').handler({ team, agent: 'worker', peek: true })) as { messages: Array<{ content: string }> })
        .messages.map((m) => m.content);
    expect(await inbox('other')).toEqual(['SECRET-FOR-TEAM-OTHER-ONLY']);
    expect(await inbox('demo')).toEqual(['for demo']);
  });

  it('never executes an exec plan edited into team.json', async () => {
    const marker = join(cwd, 'INJECTED');
    await setup(['-e', "process.stdout.write('real')", '{prompt}']);
    const t = readTeam();
    t.members.worker.spawn.myagent.exec = { command: '/bin/sh', args: ['-c', `touch '${marker}'`], promptVia: 'stdin', closeStdin: true, passEnv: [] };
    writeTeam(t);

    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.outcome).toBe('done');
    expect(r.warnings).toContain('storedPlanIgnored');
    expect(existsSync(marker)).toBe(false);
  });

  it('rebuilds a Codex plan from the adapter, ignoring an edited team.json', async () => {
    await tool('team_create').handler({ name: 'cx', host: 'codex' });
    await tool('team_spawn').handler({ team: 'cx', agent: 'rev', role: 'reviewer', hosts: ['codex'], model: 'gpt-5' });
    const t = readTeam('cx');
    t.members.rev.spawn.codex.exec.command = '/bin/sh';
    t.members.rev.spawn.codex.exec.args = ['-c', 'touch x'];
    t.members.rev.spawn.codex.exec.passEnv = ['GITHUB_TOKEN'];
    writeTeam(t, 'cx');
    const r = await runTeamAgent({ team: 'cx', agent: 'rev', dryRun: true, resolveMcpServer: () => undefined });
    expect(r.dryRun!.command).toBe('codex');
    expect(r.dryRun!.args.slice(0, 3)).toEqual(['exec', '--sandbox', 'read-only']);
    expect(r.dryRun!.args).toContain('gpt-5');
    expect(r.dryRun!.passEnvNames).not.toContain('GITHUB_TOKEN');
  });

  it('refuses an untrusted command host, and trust is tied to the exact entry', async () => {
    writeHosts({ myagent: { kind: 'exec', command: 'myagent', args: ['{prompt}'] } });
    await tool('team_create').handler({ name: 'demo', host: 'myagent' });
    await tool('team_spawn').handler({ team: 'demo', agent: 'worker', role: 'coder' });

    const dry = await runTeamAgent({ team: 'demo', agent: 'worker', dryRun: true });
    expect(dry.dryRun!.trusted).toBe(false);
    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not trusted.*ruflo team trust-host myagent/s);
    expect(readTeam().members.worker.status).toBe('idle');

    recordTrust(cwd, 'myagent', loadTeamHosts(cwd).myagent);
    expect((await runTeamAgent({ team: 'demo', agent: 'worker', dryRun: true })).dryRun!.trusted).toBe(true);

    writeHosts({ myagent: { kind: 'exec', command: 'myagent', args: ['--evil', '{prompt}'] } });
    expect((await runTeamAgent({ team: 'demo', agent: 'worker', dryRun: true })).dryRun!.trusted).toBe(false);
  });

  it('allows a shell command host only after trust with allowUnsafeCommand', async () => {
    writeHosts({ sh1: { kind: 'exec', command: 'sh', args: ['-c', 'cat', '{prompt}'] } });
    const cfg = loadTeamHosts(cwd).sh1;
    recordTrust(cwd, 'sh1', cfg);
    expect((await tool('team_create').handler({ name: 'a', host: 'sh1' })).success).toBe(false);
    recordTrust(cwd, 'sh1', cfg, { allowUnsafeCommand: true });
    expect((await tool('team_create').handler({ name: 'a', host: 'sh1' })).success).toBe(true);
  });

  it('classifies unsafe commands', () => {
    for (const c of ['sh', 'bash', 'zsh', 'cmd.exe', 'powershell', 'pwsh.exe', 'env', '/bin/x', './x', 'C:\\x.exe', 'bin/x']) {
      expect(unsafeCommandReason(c), c).toBeDefined();
    }
    for (const c of ['codex', 'aider', 'myagent', 'goose']) expect(unsafeCommandReason(c), c).toBeUndefined();
  });

  it('refuses to run after team_shutdown', async () => {
    await setup(['-e', "require('fs').writeFileSync('ran','x')", '{prompt}']);
    await tool('team_shutdown').handler({ team: 'demo' });
    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/is shutdown/);
    expect(existsSync(join(cwd, 'ran'))).toBe(false);
  });

  it('refuses a member whose plan step is not ready, or already done', async () => {
    await setup(['-e', "process.stdout.write('ok')", '{prompt}']);
    const early = await runTeamAgent({ team: 'demo', agent: 'checker' });
    expect(early.success).toBe(false);
    expect(early.error).toMatch(/not ready: the current step is "worker"/);

    expect((await runTeamAgent({ team: 'demo', agent: 'worker' })).outcome).toBe('done');
    const again = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(again.success).toBe(false);
    expect(again.error).toMatch(/every plan step for "worker" is done/);
  });

  it('runs a member with no plan step ad hoc', async () => {
    await setup(['-e', "process.stdout.write('ok')", '{prompt}'], ['worker']);
    expect(planBlock(readTeam(), 'checker')).toBeUndefined();
  });

  it('refuses a second concurrent run of the same agent', async () => {
    await setup(['-e', 'setTimeout(()=>{}, 1500)', '{prompt}']);
    const first = runTeamAgent({ team: 'demo', agent: 'worker', timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 300));
    const second = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(second.success).toBe(false);
    expect(second.error).toMatch(/already running/);
    const r1 = await first;
    expect(r1.outcome).toBe('done');
    expect(readTeam().members.worker.lastStopRunId).toBe(r1.runId);
  });

  it('replaces a run whose runner process is gone', async () => {
    await setup(['-e', "process.stdout.write('ok')", '{prompt}']);
    const t = readTeam();
    Object.assign(t.members.worker, { status: 'running', runId: 'run_dead', runPid: 2 ** 22 + 12345, runHost: (await import('node:os')).hostname() });
    writeTeam(t);
    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.outcome).toBe('done');
    expect(r.warnings).toContain('staleRunReplaced:run_dead');
  });

  it('caps the {resultFile} read at maxOutputBytes', async () => {
    await setup(['-e', "require('fs').writeFileSync(process.argv[1], 'y'.repeat(50000))", '{resultFile}', '{prompt}']);
    const r = await runTeamAgent({ team: 'demo', agent: 'worker', maxOutputBytes: 1000 });
    expect(r.outcome).toBe('done');
    expect(r.warnings).toContain('resultFileTruncated');
  });

  it('refuses a symlinked result file', () => {
    const target = join(cwd, 'secret.txt');
    writeFileSync(target, 'secret');
    const link = join(cwd, 'result.txt');
    symlinkSync(target, link);
    expect(readResultFile(link, 100)).toMatchObject({ text: '', refused: 'symlink' });
    expect(readResultFile(target, 3)).toEqual({ text: 'sec', truncated: true });
  });

  it('team_spawn rejects unknown keys with a hint', async () => {
    await tool('team_create').handler({ name: 'demo', host: 'grok' });
    const r = await tool('team_spawn').handler({ team: 'demo', agent: 'a', task: 'do it' });
    expect(r.success).toBe(false);
    expect(String((r as { error: string }).error)).toMatch(/"task" \(did you mean "prompt"\?\)/);
    expect((await tool('team_spawn').handler({ team: 'demo', agent: 'a', prompt: 'x', _meta: {} })).success).toBe(true);
  });
});

describe('hook-stop payload read', () => {
  it('waits for a slow writer instead of substituting {}', async () => {
    const s = new PassThrough();
    const read = readHookPayload(s, { firstByteMs: 2000, maxMs: 5000 });
    s.write('{"agentName":');
    setTimeout(() => { s.write('"architect"}'); s.end(); }, 600);
    const r = await read;
    expect(r.ended).toBe(true);
    expect(parseHookPayload(r)).toEqual({ payload: { agentName: 'architect' } });
  });

  it('reports incomplete or invalid JSON instead of an empty payload', async () => {
    const s = new PassThrough();
    const read = readHookPayload(s, { firstByteMs: 500, maxMs: 300 });
    s.write('{"agentName":"arch');
    const r = await read;
    expect(r.ended).toBe(false);
    const p = parseHookPayload(r);
    expect('error' in p && p.error).toMatch(/still incomplete/);
    expect(parseHookPayload({ raw: '[1]', ended: true })).toEqual({ error: 'hook payload is not a JSON object' });
    expect(parseHookPayload({ raw: '', ended: false })).toEqual({ payload: {} });
  });
});
