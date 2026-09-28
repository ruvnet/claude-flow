/**
 * ADR-402: host adapters (Codex, command hosts), team_on_stop
 * outcome/runId handling, and the team.json lock.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { teamTools } from '../src/mcp-tools/team-tools.js';

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

describe('teamTools host adapters and on_stop (ADR-402)', () => {
  let cwd: string;
  let prev: string | undefined;

  let prevTrust: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-hosts-'));
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

  type Exec = { command: string; args: string[]; promptVia: string; closeStdin: boolean; passEnv: string[] };
  type HostEntry = { kind?: string; exec: Exec; prompt: string; events?: string; advisory: Record<string, unknown> };
  const hostsOf = (r: unknown) => (r as { spawnPlan: { host: Record<string, HostEntry> } }).spawnPlan.host;

  function writeHosts(doc: unknown) {
    mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
    writeFileSync(join(cwd, '.claude-flow', 'team-hosts.json'), JSON.stringify(doc));
  }

  it('a codex team plans host.codex next to the store\'s grok and claude entries', async () => {
    await tool('team_create').handler({ name: 'cx', host: 'codex' });
    const r = await tool('team_spawn').handler({ team: 'cx', agent: 'rev', role: 'reviewer', prompt: 'Review' });
    expect(r.success).toBe(true);
    expect(Object.keys(hostsOf(r)).sort()).toEqual(['claude', 'codex', 'grok']);
    const top = (r as { spawnPlan: { prompt: string } }).spawnPlan.prompt;
    expect(top).toBe(hostsOf(r).codex.prompt);
  });

  it('codex plan for a read-only role', async () => {
    await tool('team_create').handler({ name: 'cx', host: 'codex' });
    const r = await tool('team_spawn').handler({ team: 'cx', agent: 'rev', role: 'reviewer', hosts: ['codex'] });
    const codex = hostsOf(r).codex;
    expect(codex.kind).toBe('exec');
    expect(codex.events).toBe('codex-jsonl');
    const { args } = codex.exec;
    expect(args.slice(0, 3)).toEqual(['exec', '--sandbox', 'read-only']);
    expect(args[args.length - 1]).toBe('-');
    expect(args).not.toContain('--worktree');
    expect(args).toContain('--json');
    expect(codex.exec.promptVia).toBe('stdin');
    expect(codex.exec.closeStdin).toBe(true);
    expect(codex.exec.passEnv).toContain('OPENAI_API_KEY');
    expect(args).not.toContain('-m');
  });

  it('codex plan for a write role with worktree isolation, and a model', async () => {
    await tool('team_create').handler({ name: 'cx', host: 'codex' });
    const r = await tool('team_spawn').handler({ team: 'cx', agent: 'dev', role: 'developer', hosts: ['codex'], model: 'gpt-5' });
    const { args } = hostsOf(r).codex.exec;
    expect(args.slice(0, 4)).toEqual(['exec', '--sandbox', 'workspace-write', '--worktree']);
    expect(args.slice(-3)).toEqual(['-m', 'gpt-5', '-']);
  });

  it('no plan contains bypass or full-auto flags', async () => {
    writeHosts({ hosts: { myagent: { kind: 'exec', command: 'myagent', args: ['run', '{prompt}'] } } });
    await tool('team_create').handler({ name: 'all', host: 'grok' });
    for (const role of ['reviewer', 'developer', 'coordinator']) {
      const r = await tool('team_spawn').handler({ team: 'all', agent: role, role, hosts: ['grok', 'claude', 'codex', 'myagent'] });
      expect(r.success).toBe(true);
      const text = JSON.stringify(hostsOf(r));
      expect(text).not.toMatch(/bypass|full-auto/);
    }
  });

  it('command host from team-hosts.json', async () => {
    writeHosts({
      hosts: {
        myagent: {
          kind: 'exec', command: 'myagent', args: ['run', '--message', '{prompt}'],
          promptVia: 'arg', passEnv: ['MYAGENT_HOME'], isolation: 'none',
        },
      },
    });
    const c = await tool('team_create').handler({ name: 'cmd', host: 'myagent' });
    expect(c.success).toBe(true);
    const r = await tool('team_spawn').handler({ team: 'cmd', agent: 'worker', role: 'coder', next: ['lead2'] });
    expect(r.success).toBe(true);
    const h = hostsOf(r);
    expect(Object.keys(h).sort()).toEqual(['claude', 'grok', 'myagent']);
    expect(h.myagent.exec).toEqual({
      command: 'myagent', args: ['run', '--message', '{prompt}'], promptVia: 'arg', closeStdin: true, passEnv: ['MYAGENT_HOME'],
    });
    expect(h.myagent.prompt).toContain('delivered to lead2');
  });

  it.each([
    ['shell metacharacter in command', { kind: 'exec', command: 'myagent;rm', args: ['{prompt}'] }],
    ['{prompt} inside a larger argument', { kind: 'exec', command: 'myagent', args: ['--msg={prompt}'] }],
    ['two {prompt} arguments', { kind: 'exec', command: 'myagent', args: ['{prompt}', '{prompt}'] }],
    ['unknown key', { kind: 'exec', command: 'myagent', args: ['{prompt}'], shell: true }],
    ['kind other than exec', { kind: 'native', command: 'myagent', args: ['{prompt}'] }],
    ['unknown placeholder', { kind: 'exec', command: 'myagent', args: ['{prompt}', '{home}'] }],
    ['a secret-named passEnv (API key)', { kind: 'exec', command: 'myagent', args: ['{prompt}'], passEnv: ['MYAGENT_API_KEY'] }],
    ['a secret-named passEnv (token)', { kind: 'exec', command: 'myagent', args: ['{prompt}'], passEnv: ['GITHUB_TOKEN'] }],
    ['a secret-named passEnv (password)', { kind: 'exec', command: 'myagent', args: ['{prompt}'], passEnv: ['DB_PASSWORD'] }],
    ['a Ruflo identity variable in passEnv', { kind: 'exec', command: 'myagent', args: ['{prompt}'], passEnv: ['CLAUDE_FLOW_PRINCIPAL_ID'] }],
    ['an untrusted shell command', { kind: 'exec', command: 'sh', args: ['-c', 'x', '{prompt}'] }],
    ['an untrusted path-like command', { kind: 'exec', command: '/bin/myagent', args: ['{prompt}'] }],
    ['an untrusted relative command', { kind: 'exec', command: './myagent', args: ['{prompt}'] }],
  ])('rejects a command host with %s', async (_label, host) => {
    writeHosts({ hosts: { myagent: host } });
    const r = await tool('team_create').handler({ name: 'bad', host: 'myagent' });
    expect(r.success).toBe(false);
    expect(String((r as { error: string }).error)).toMatch(/team-hosts\.json/);
  });

  it('rejects an unknown host label', async () => {
    const r = await tool('team_create').handler({ name: 'x', host: 'nosuchhost' });
    expect(r.success).toBe(false);
    await tool('team_create').handler({ name: 'y', host: 'grok' });
    const s = await tool('team_spawn').handler({ team: 'y', agent: 'a', hosts: ['nosuchhost'] });
    expect(s.success).toBe(false);
    expect(String((s as { error: string }).error)).toMatch(/Unknown host/);
  });

  it('on_stop failed does not advance; retry done does', async () => {
    await tool('team_create').handler({ name: 'f', host: 'grok' });
    await tool('team_plan').handler({ team: 'f', steps: ['a', 'b'] });
    await tool('team_spawn').handler({ team: 'f', agent: 'a', role: 'coder' });
    const failed = await tool('team_on_stop').handler({ team: 'f', agent: 'a', outcome: 'failed', runId: 'r1', reason: 'exit 3' });
    expect(failed.success).toBe(true);
    expect((failed as { assign: { hint: string } }).assign.hint).toMatch(/retry/);
    let team = readTeam(cwd, 'f');
    expect(team.plan.index).toBe(0);
    expect(team.plan.steps[0].status).toBe('failed');
    expect(team.members.a.status).toBe('failed');
    expect(team.members.a.lastStopReason).toBe('exit 3');

    await tool('team_on_stop').handler({ team: 'f', agent: 'a', outcome: 'done', runId: 'r2' });
    team = readTeam(cwd, 'f');
    expect(team.plan.index).toBe(1);
    expect(team.plan.steps[1].status).toBe('ready');
  });

  it('a duplicate runId is a no-op', async () => {
    await tool('team_create').handler({ name: 'd', host: 'grok' });
    await tool('team_plan').handler({ team: 'd', steps: ['a', 'b', 'c'] });
    await tool('team_spawn').handler({ team: 'd', agent: 'a', role: 'coder' });
    await tool('team_on_stop').handler({ team: 'd', agent: 'a', runId: 'same' });
    const dup = await tool('team_on_stop').handler({ team: 'd', agent: 'a', runId: 'same' });
    expect((dup as { duplicate?: boolean }).duplicate).toBe(true);
    expect(readTeam(cwd, 'd').plan.index).toBe(1);
  });

  it('normalizes a role:agent label', async () => {
    await tool('team_create').handler({ name: 'n', host: 'grok' });
    await tool('team_plan').handler({ team: 'n', steps: ['architect', 'developer'] });
    await tool('team_spawn').handler({ team: 'n', agent: 'architect', role: 'architect' });
    const r = await tool('team_on_stop').handler({ team: 'n', agent: 'architect:architect' });
    expect(r.success).toBe(true);
    expect((r as { agent: string }).agent).toBe('architect');
    expect(readTeam(cwd, 'n').plan.index).toBe(1);
  });

  it('10 concurrent on_stop calls leave team.json valid with every member marked', async () => {
    await tool('team_create').handler({ name: 'c', host: 'grok', maxAgents: 10 });
    const agents = Array.from({ length: 10 }, (_, i) => `w${i}`);
    for (const a of agents) await tool('team_spawn').handler({ team: 'c', agent: a, role: 'reviewer' });
    const results = await Promise.all(agents.map((a) => tool('team_on_stop').handler({ team: 'c', agent: a })));
    expect(results.every((r) => r.success)).toBe(true);
    const team = readTeam(cwd, 'c');
    for (const a of agents) expect(team.members[a].status).toBe('idle');
    expect(existsSync(join(cwd, '.claude-flow', 'teams', 'c', 'team.lock'))).toBe(false);
  });
});

function readTeam(root: string, name: string) {
  return JSON.parse(readFileSync(join(root, '.claude-flow', 'teams', name, 'team.json'), 'utf-8'));
}
