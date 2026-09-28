/**
 * `ruflo team run` against a fake command host (a node one-liner), and
 * `ruflo team hook-stop` team resolution. No model calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { teamTools } from '../src/mcp-tools/team-tools.js';
import { runTeamAgent, hookStop, fillPlaceholders, parseCodexEvents } from '../src/mcp-tools/team-runner.js';
import { teamCommand } from '../src/commands/team.js';
import { loadTeamHosts, recordTrust } from '../src/mcp-tools/team-hosts/index.js';

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

const node = process.execPath;

describe('team run (fake command host)', () => {
  let cwd: string;
  let prev: string | undefined;

  // The fake host's command is an absolute path to node, so it needs the
  // trust step with --allow-unsafe-command, as a user would record it.
  function writeHosts(args: string[], promptVia: 'arg' | 'stdin' = 'arg') {
    mkdirSync(join(cwd, '.claude-flow'), { recursive: true });
    writeFileSync(join(cwd, '.claude-flow', 'team-hosts.json'), JSON.stringify({
      hosts: { myagent: { kind: 'exec', command: node, args, promptVia } },
    }));
    recordTrust(cwd, 'myagent', loadTeamHosts(cwd).myagent, { allowUnsafeCommand: true });
  }

  async function setup(args: string[], promptVia: 'arg' | 'stdin' = 'arg') {
    writeHosts(args, promptVia);
    await tool('team_create').handler({ name: 'demo', host: 'myagent' });
    await tool('team_plan').handler({ team: 'demo', steps: ['worker', 'checker'] });
    const s = await tool('team_spawn').handler({ team: 'demo', agent: 'worker', role: 'coder', prompt: 'do it', next: ['checker'] });
    expect(s.success).toBe(true);
  }

  const readTeam = () => JSON.parse(readFileSync(join(cwd, '.claude-flow', 'teams', 'demo', 'team.json'), 'utf-8'));
  const inbox = async (agent: string) =>
    (await tool('team_inbox').handler({ team: 'demo', agent, peek: true }) as { messages: Array<{ type: string; from: string; content: string }> }).messages;

  let prevTrust: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-run-'));
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

  it('runs, writes the run file, delivers a result to next, and advances the plan', async () => {
    await setup(['-e', "process.stdout.write('ok:'+process.argv[1].slice(0,40))", '{prompt}']);
    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.success).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.outcome).toBe('done');

    const run = JSON.parse(readFileSync(join(cwd, r.runFile!), 'utf-8'));
    expect(run).toMatchObject({ code: 0, timedOut: false, outcome: 'done', host: 'myagent', agent: 'worker' });
    expect(readFileSync(join(cwd, run.resultFile), 'utf-8')).toMatch(/^ok:You are "worker"/);

    const msgs = await inbox('checker');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ type: 'result', from: 'worker' });
    expect(msgs[0].content).toContain('[run: ');

    const team = readTeam();
    expect(team.plan.index).toBe(1);
    expect(team.members.worker.status).toBe('idle');
    expect(team.members.worker.lastStopRunId).toBe(r.runId);
  });

  it('sends the prompt over stdin when promptVia is stdin', async () => {
    await setup(['-e', "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write('stdin:'+s.length))"], 'stdin');
    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.outcome).toBe('done');
    expect((await inbox('checker'))[0].content).toMatch(/^stdin:[1-9]/);
  });

  it('a non-zero exit is failed, goes to the lead, and does not advance', async () => {
    await setup(['-e', "process.stderr.write('boom');process.exit(3)", '{prompt}']);
    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(3);
    expect(r.outcome).toBe('failed');
    expect(r.reason).toMatch(/exit code 3: boom/);
    const team = readTeam();
    expect(team.plan.index).toBe(0);
    expect(team.plan.steps[0].status).toBe('failed');
    expect(team.members.worker.status).toBe('failed');
    expect(await inbox('checker')).toHaveLength(0);
    expect((await inbox('lead'))[0].type).toBe('result');
  });

  it('a timeout is failed with exit 124', async () => {
    await setup(['-e', 'setTimeout(()=>{}, 20000)', '{prompt}']);
    const r = await runTeamAgent({ team: 'demo', agent: 'worker', timeoutMs: 300 });
    expect(r.outcome).toBe('failed');
    expect(r.exitCode).toBe(124);
    expect(r.reason).toMatch(/timed out/);
    expect(readTeam().plan.index).toBe(0);
  });

  it('delivers queued inbox messages in the prompt and archives them', async () => {
    const seen = join(cwd, 'prompt-seen.txt');
    await setup(['-e', `require('fs').writeFileSync(${JSON.stringify(seen)}, process.argv[1])`, '{prompt}']);
    await tool('team_send').handler({ team: 'demo', to: 'worker', from: 'lead', type: 'task', summary: 'scope', message: 'Only touch src/a.ts' });

    const dry = await runTeamAgent({ team: 'demo', agent: 'worker', dryRun: true });
    expect(dry.dryRun!.inboxMessages).toBe(1);
    expect(await inbox('worker')).toHaveLength(1); // a dry run leaves it queued

    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.outcome).toBe('done');
    const prompt = readFileSync(seen, 'utf-8');
    expect(prompt).toContain('=== Messages for you (1,');
    expect(prompt).toContain('--- from lead · task · scope ---\nOnly touch src/a.ts');
    expect(prompt.indexOf('Only touch src/a.ts')).toBeLessThan(prompt.lastIndexOf('\nTask:\n'));
    expect(await inbox('worker')).toHaveLength(0);
    expect(readdirSync(join(cwd, '.claude-flow', 'teams', 'demo', 'mailbox', 'worker', 'archive'))).toHaveLength(1);
    const run = JSON.parse(readFileSync(join(cwd, r.runFile!), 'utf-8'));
    expect(run.inboxDelivered).toHaveLength(1);
  });

  it('a failed run queues the delivered messages again for the retry', async () => {
    await setup(['-e', 'process.exit(3)', '{prompt}']);
    await tool('team_send').handler({ team: 'demo', to: 'worker', from: 'lead', type: 'task', summary: 'scope', message: 'Only touch src/a.ts' });

    const r = await runTeamAgent({ team: 'demo', agent: 'worker' });
    expect(r.outcome).toBe('failed');
    const queued = await inbox('worker');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ from: 'lead', type: 'task', content: 'Only touch src/a.ts' });
    const run = JSON.parse(readFileSync(join(cwd, r.runFile!), 'utf-8'));
    expect(run.inboxDelivered).toHaveLength(1);
  });

  it('--dry-run resolves argv and starts nothing', async () => {
    await setup(['-e', "require('fs').writeFileSync('ran.txt','x')", '{prompt}']);
    const r = await runTeamAgent({ team: 'demo', agent: 'worker', dryRun: true });
    expect(r.success).toBe(true);
    expect(r.dryRun!.command).toBe(node);
    expect(r.dryRun!.args[2]).toMatch(/^You are "worker"/);
    expect(existsSync(join(cwd, 'ran.txt'))).toBe(false);
    expect(existsSync(join(cwd, '.claude-flow', 'teams', 'demo', 'runs'))).toBe(false);
    expect(readTeam().members.worker.status).toBe('registered');
  });

  it('refuses a member without an exec plan for the host', async () => {
    await tool('team_create').handler({ name: 'g', host: 'grok' });
    await tool('team_spawn').handler({ team: 'g', agent: 'a', role: 'coder' });
    const r = await runTeamAgent({ team: 'g', agent: 'a' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no exec plan/);
  });

  it('the CLI action maps the child exit code', async () => {
    await setup(['-e', 'process.exit(5)', '{prompt}']);
    const run = teamCommand.subcommands!.find((c) => c.name === 'run')!;
    const out = await run.action!({
      args: [], flags: { _: [], team: 'demo', agent: 'worker', json: true }, cwd, interactive: false,
    });
    expect(out).toMatchObject({ success: false, exitCode: 5 });
  });

  it('codex plan: drops the -c pair when no Ruflo MCP server is found', async () => {
    await tool('team_create').handler({ name: 'cx', host: 'codex' });
    await tool('team_spawn').handler({ team: 'cx', agent: 'rev', role: 'reviewer', hosts: ['codex'] });
    const none = await runTeamAgent({ team: 'cx', agent: 'rev', dryRun: true, resolveMcpServer: () => undefined });
    expect(none.dryRun!.args).not.toContain('-c');
    expect(none.warnings).toContain('mcpServerNotFound');
    const found = await runTeamAgent({ team: 'cx', agent: 'rev', dryRun: true, resolveMcpServer: () => 'ruflo' });
    const i = found.dryRun!.args.indexOf('-c');
    expect(found.dryRun!.args[i + 1]).toBe(`mcp_servers.ruflo.env.CLAUDE_FLOW_CWD=${JSON.stringify(cwd)}`);
    expect(found.dryRun!.args[found.dryRun!.args.indexOf('-o') + 1]).toMatch(/runs\/rev-run_.*\.last\.txt$/);
    expect(found.dryRun!.promptVia).toBe('stdin');
  });
});

describe('team run (fake codex on PATH)', () => {
  let cwd: string;
  let bin: string;
  let prevCwd: string | undefined;
  let prevPath: string | undefined;

  function fakeCodex(lines: object[], exitCode = 0) {
    const script = join(bin, 'codex');
    const body = lines.map((l) => JSON.stringify(l)).join('\\n');
    // Reads the prompt from stdin until EOF, then prints the JSONL stream.
    writeFileSync(script, `#!${node}\nprocess.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(${JSON.stringify(body)}.split('\\\\n').join('\\n')+'\\n');process.exit(${exitCode})});\n`);
    chmodSync(script, 0o755);
  }

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-codex-'));
    bin = mkdtempSync(join(tmpdir(), 'ruflo-fake-codex-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    prevPath = process.env.PATH;
    process.env.CLAUDE_FLOW_CWD = cwd;
    process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
    await tool('team_create').handler({ name: 'cx', host: 'codex' });
    await tool('team_plan').handler({ team: 'cx', steps: ['rev'] });
    await tool('team_spawn').handler({ team: 'cx', agent: 'rev', role: 'reviewer', hosts: ['codex'] });
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    process.env.PATH = prevPath;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });

  const readTeam = () => JSON.parse(readFileSync(join(cwd, '.claude-flow', 'teams', 'cx', 'team.json'), 'utf-8'));

  it('turn.completed + exit 0 is done; records the thread id and the last message', async () => {
    fakeCodex([
      { type: 'thread.started', thread_id: 'th-9' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'REVIEW_OK' } },
      { type: 'turn.completed' },
    ]);
    const r = await runTeamAgent({ team: 'cx', agent: 'rev', resolveMcpServer: () => undefined });
    expect(r.outcome).toBe('done');
    const run = JSON.parse(readFileSync(join(cwd, r.runFile!), 'utf-8'));
    expect(run.threadId).toBe('th-9');
    expect(readFileSync(join(cwd, run.resultFile), 'utf-8')).toBe('REVIEW_OK');
    expect(readTeam().members.rev.threadId).toBe('th-9');
    expect(readTeam().plan.index).toBe(1);
  });

  it('turn.failed with exit 0 is failed, with the error as reason', async () => {
    fakeCodex([{ type: 'turn.failed', error: { message: 'usage limit' } }]);
    const r = await runTeamAgent({ team: 'cx', agent: 'rev', resolveMcpServer: () => undefined });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toBe('usage limit');
    expect(r.exitCode).toBe(1);
    expect(readTeam().plan.index).toBe(0);
  });

  it('exit 0 with no terminal event is done with a noTerminalEvent warning', async () => {
    fakeCodex([{ type: 'thread.started', thread_id: 'th-1' }]);
    const r = await runTeamAgent({ team: 'cx', agent: 'rev', resolveMcpServer: () => undefined });
    expect(r.outcome).toBe('done');
    expect(r.warnings).toContain('noTerminalEvent');
  });
});

describe('team runner helpers', () => {
  it('fillPlaceholders is single-pass and JSON-quotes "{name}"', () => {
    expect(fillPlaceholders('{prompt}', { prompt: 'use {cwd}', cwd: '/x' })).toBe('use {cwd}');
    expect(fillPlaceholders('k="{teamRoot}"', { teamRoot: 'C:\\a "b"' })).toBe('k="C:\\\\a \\"b\\""');
    expect(fillPlaceholders('{unknown}', {})).toBe('{unknown}');
  });

  it('parseCodexEvents reads thread, terminal event and last message', () => {
    const stream = [
      'not json',
      JSON.stringify({ type: 'thread.started', thread_id: 't-1' }),
      JSON.stringify({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'ruflo', tool: 'team_inbox' } }),
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello' } }),
      JSON.stringify({ type: 'turn.completed', usage: {} }),
    ].join('\n');
    expect(parseCodexEvents(stream)).toEqual({
      threadId: 't-1', terminal: 'turn.completed', lastMessage: 'hello', mcpTools: ['ruflo.team_inbox'],
    });
    expect(parseCodexEvents(JSON.stringify({ type: 'turn.failed', error: { message: 'quota' } })))
      .toEqual({ terminal: 'turn.failed', failure: 'quota' });
  });
});

describe('team hook-stop', () => {
  let cwd: string;
  let prev: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-hook-'));
    prev = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = cwd;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prev;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('advances the only active team that lists the agent', async () => {
    await tool('team_create').handler({ name: 'one', host: 'grok' });
    await tool('team_plan').handler({ team: 'one', steps: ['architect', 'developer'] });
    await tool('team_spawn').handler({ team: 'one', agent: 'architect', role: 'architect' });
    const r = await hookStop('grok', { description: 'architect:architect' }, {});
    expect(r).toMatchObject({ handled: true, team: 'one', agent: 'architect' });
  });

  it('uses the @team of a spawn description', async () => {
    for (const name of ['one', 'two']) {
      await tool('team_create').handler({ name, host: 'grok' });
      await tool('team_plan').handler({ team: name, steps: ['a'] });
      await tool('team_spawn').handler({ team: name, agent: 'a', role: 'coder' });
    }
    const r = await hookStop('grok', { description: 'coder:a@two' }, {});
    expect(r).toMatchObject({ handled: true, team: 'two', agent: 'a' });
    const one = JSON.parse(readFileSync(join(cwd, '.claude-flow', 'teams', 'one', 'team.json'), 'utf-8'));
    expect(one.plan.index).toBe(0);
  });

  it('does nothing when several active teams list the agent and none is named', async () => {
    for (const name of ['one', 'two']) {
      await tool('team_create').handler({ name, host: 'grok' });
      await tool('team_plan').handler({ team: name, steps: ['a'] });
      await tool('team_spawn').handler({ team: name, agent: 'a', role: 'coder' });
    }
    const r = await hookStop('grok', { description: 'x:a' }, {});
    expect(r.handled).toBe(false);
    expect(r.reason).toMatch(/several active teams/);
    const team = JSON.parse(readFileSync(join(cwd, '.claude-flow', 'teams', 'one', 'team.json'), 'utf-8'));
    expect(team.plan.index).toBe(0);
    const named = await hookStop('grok', { description: 'x:a' }, { TEAM_NAME: 'one' });
    expect(named.handled).toBe(true);
  });
});
