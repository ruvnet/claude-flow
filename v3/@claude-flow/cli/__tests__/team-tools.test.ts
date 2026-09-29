/**
 * ADR-402 team_* MCP tools + the grok-team-bus.mjs CLI they share a store with.
 * Regression coverage for the #3512 review (scoping, locking, lifecycle, hook).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs, {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { teamTools } from '../src/mcp-tools/team-tools.js';

const STORE = join(resolve(__dirname, '..', 'templates', 'grok', 'scripts'), 'grok-team-store.mjs');

const SCRIPTS = resolve(__dirname, '..', 'templates', 'grok', 'scripts');
const BUS = join(SCRIPTS, 'grok-team-bus.mjs');
const HOOK = join(SCRIPTS, 'grok-subagent-stop-hook.mjs');

type Result = { success: boolean; error?: string } & Record<string, any>;

function tool(name: string) {
  const t = teamTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return (input: Record<string, unknown>) => t.handler(input) as Promise<Result>;
}

function runNode(
  script: string,
  args: string[],
  opts: { cwd: string; stdin?: string; env?: Record<string, string> },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, CLAUDE_PROJECT_DIR: opts.cwd, TEAM_NAME: '', SUBAGENT_NAME: '', ...opts.env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => done({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(opts.stdin ?? '');
  });
}

function readTeam(cwd: string, name: string) {
  return JSON.parse(readFileSync(join(cwd, '.claude-flow', 'teams', name, 'team.json'), 'utf-8'));
}

describe('teamTools (ADR-402)', () => {
  let cwd: string;
  let prev: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-team-'));
    prev = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = cwd;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prev;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('create → plan → spawn → send → inbox → on_stop → shutdown', async () => {
    const create = await tool('team_create')({ name: 'demo', maxAgents: 4, host: 'grok' });
    expect(create.success).toBe(true);
    expect(existsSync(join(cwd, '.claude-flow', 'teams', 'demo', 'team.json'))).toBe(true);

    expect((await tool('team_plan')({ team: 'demo', steps: ['architect', 'developer'] })).success).toBe(true);

    const spawned = await tool('team_spawn')({
      team: 'demo',
      agent: 'architect',
      role: 'architect',
      prompt: 'Design the feature',
      next: ['developer'],
    });
    expect(spawned.success).toBe(true);
    const grok = spawned.spawnPlan.host.grok;
    expect(Object.keys(grok.spawn).sort()).toEqual(['background', 'description', 'isolation']);
    expect(grok.spawn).toEqual({ description: 'architect:architect@demo', background: true, isolation: 'none' });
    expect(grok.advisory.capability_mode).toBe('read-only');

    const send = await tool('team_send')({
      team: 'demo',
      to: 'developer',
      from: 'architect',
      summary: 'design',
      message: 'Use layered architecture',
    });
    expect(send.success).toBe(true);

    // Pre-spawn handoff: status counts developer's mailbox before registration
    const early = await tool('team_status')({ team: 'demo' });
    expect(early.pendingMail.developer).toBe(1);

    await tool('team_spawn')({ team: 'demo', agent: 'developer', role: 'developer', prompt: 'Implement' });
    const inbox = await tool('team_inbox')({ team: 'demo', agent: 'developer', peek: true });
    expect(inbox.messages).toHaveLength(1);

    const onStop = await tool('team_on_stop')({ team: 'demo', agent: 'architect' });
    expect(onStop.assign.agent).toBe('developer');

    expect((await tool('team_shutdown')({ team: 'demo' })).success).toBe(true);
    expect(readTeam(cwd, 'demo').status).toBe('shutdown');
  });

  it('rejects invalid team names', async () => {
    expect((await tool('team_create')({ name: '../evil' })).success).toBe(false);
    expect((await tool('team_inbox')({ team: '../evil', agent: 'a' })).success).toBe(false);
  });

  it('scopes mailboxes and status to one team (review #3)', async () => {
    await tool('team_create')({ name: 'alpha' });
    await tool('team_create')({ name: 'beta' });
    await tool('team_spawn')({ team: 'alpha', agent: 'coder' });
    await tool('team_spawn')({ team: 'beta', agent: 'coder' });
    await tool('team_send')({ team: 'alpha', to: 'coder', message: 'only for alpha' });

    const beta = await tool('team_inbox')({ team: 'beta', agent: 'coder' });
    expect(beta.success).toBe(true);
    expect(beta.messages).toEqual([]);
    expect((await tool('team_status')({ team: 'beta' })).pendingMail).toEqual({ coder: 0 });
    expect((await tool('team_status')({ team: 'alpha' })).pendingMail).toEqual({ coder: 1 });

    const alpha = await tool('team_inbox')({ team: 'alpha', agent: 'coder' });
    expect(alpha.messages.map((m: { content: string }) => m.content)).toEqual(['only for alpha']);
    expect((await tool('team_inbox')({ agent: 'coder' })).success).toBe(false); // team is required
  });

  it('registers all 30 members when spawns race across processes (review #4)', async () => {
    await tool('team_create')({ name: 'race', maxAgents: 50 });
    const cli = Array.from({ length: 15 }, (_, i) =>
      runNode(BUS, ['spawn', '--root', cwd, '--team', 'race', '--agent', `cli-${i}`], { cwd }),
    );
    const mcp = Array.from({ length: 15 }, (_, i) => tool('team_spawn')({ team: 'race', agent: `mcp-${i}` }));
    const results = await Promise.all([...cli, ...mcp]);
    for (const r of results) {
      if ('code' in r) expect(r.code, r.stdout + r.stderr).toBe(0);
      else expect(r.success, r.error).toBe(true);
    }
    const team = readTeam(cwd, 'race');
    expect(Object.keys(team.members)).toHaveLength(30);
    expect(existsSync(join(cwd, '.claude-flow', 'teams', 'race', 'team.lock'))).toBe(false);
    expect(readdirSync(join(cwd, '.claude-flow', 'teams', 'race')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  }, 60_000);

  it('breaks a stale lock left by a crashed holder, and releases its own', async () => {
    await tool('team_create')({ name: 'stale' });
    const lock = join(cwd, '.claude-flow', 'teams', 'stale', 'team.lock');
    writeFileSync(lock, 'crashed-holder');
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    expect((await tool('team_spawn')({ team: 'stale', agent: 'a' })).success).toBe(true);
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(join(cwd, '.claude-flow', 'teams', 'stale')).filter((f) => f.includes('.stale.'))).toEqual([]);
  });

  it('re-verifies a stale lock before breaking it, and never renames one that changed underneath it (review N2)', async () => {
    // Reproduces the round-2 review's race: waiter W1 reads a stale lock's
    // token; meanwhile another waiter breaks that same lock and a third
    // party re-acquires a fresh, live one at the same path. A buggy
    // breakStaleLock would rename that live lock away regardless (and, in a
    // real multi-process run, risk a fourth party grabbing the vacated slot
    // before it's put back — two holders at once). The fix re-verifies the
    // token immediately before renaming and backs off if it changed.
    await tool('team_create')({ name: 'race2' });
    const dir = join(cwd, '.claude-flow', 'teams', 'race2');
    const lock = join(dir, 'team.lock');
    writeFileSync(lock, 'crashed-holder', { encoding: 'utf8' });
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);

    const store: any = await import(pathToFileURL(STORE).href);

    const realReadFileSync: any = fs.readFileSync;
    const realRenameSync: any = fs.renameSync;
    let renamed = false;
    let triggered = false;
    (fs as any).readFileSync = (...args: any[]) => {
      const result = realReadFileSync(...args);
      if (!triggered && args[0] === lock && result === 'crashed-holder') {
        triggered = true;
        // Simulate another waiter breaking this exact lock and a third
        // party re-acquiring a fresh one, right after we read the stale
        // token but before we act on it.
        writeFileSync(lock, 'C-token', { encoding: 'utf8' });
        const now = new Date();
        utimesSync(lock, now, now);
      }
      return result;
    };
    (fs as any).renameSync = (...args: any[]) => {
      renamed = true;
      return realRenameSync(...args);
    };

    try {
      store.breakStaleLock(lock, 'our-break-token');
    } finally {
      (fs as any).readFileSync = realReadFileSync;
      (fs as any).renameSync = realRenameSync;
    }

    expect(triggered).toBe(true);
    expect(renamed).toBe(false); // never touched the lock once it saw it had changed
    expect(readFileSync(lock, 'utf8')).toBe('C-token'); // untouched, not clobbered/restored
    expect(readdirSync(dir).filter((f) => f.includes('.stale.'))).toEqual([]);
  });

  it('breaks a stale lock safely with several real concurrent waiters, no lost updates (review N2/N3)', async () => {
    await tool('team_create')({ name: 'race-stale', maxAgents: 10 });
    const dir = join(cwd, '.claude-flow', 'teams', 'race-stale');
    const lock = join(dir, 'team.lock');
    writeFileSync(lock, 'crashed-holder', { encoding: 'utf8' });
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);

    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        runNode(BUS, ['spawn', '--root', cwd, '--team', 'race-stale', '--agent', `w${i}`], { cwd }),
      ),
    );
    for (const r of results) expect(r.code, r.stdout + r.stderr).toBe(0);

    const team = readTeam(cwd, 'race-stale');
    expect(Object.keys(team.members).sort()).toEqual(['w0', 'w1', 'w2']);
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(dir).filter((f) => f.includes('.stale.') || f.endsWith('.tmp'))).toEqual([]);
  }, 30_000);

  it('lock-wait timeout covers the stale window, so a wait never gives up before the lock could be broken (review N3)', async () => {
    const store: any = await import(pathToFileURL(STORE).href);
    // Import the same constants indirectly: a lock that just turned stale
    // must still be breakable well within one wait attempt's own timeout —
    // otherwise every spawn in the gap between "give up" and "now stale"
    // fails even though nothing is actually stuck.
    await tool('team_create')({ name: 'timing' });
    const dir = join(cwd, '.claude-flow', 'teams', 'timing');
    const lock = join(dir, 'team.lock');
    writeFileSync(lock, 'crashed-holder', { encoding: 'utf8' });
    // Just past the stale threshold used in grok-team-store.mjs (4s) — not
    // past the wait timeout (4.5s), so this must succeed, not time out.
    const justStale = new Date(Date.now() - 4_050);
    utimesSync(lock, justStale, justStale);
    const result = await store.withTeamLock(cwd, 'timing', () => 'held');
    expect(result).toBe('held');
  });

  it('clears the old mailbox when force-recreating a team (review N4)', async () => {
    await tool('team_create')({ name: 'reborn' });
    await tool('team_spawn')({ team: 'reborn', agent: 'old-member' });
    await tool('team_send')({ team: 'reborn', to: 'old-member', message: 'from the old incarnation' });
    const mailbox = join(cwd, '.claude-flow', 'teams', 'reborn', 'mailbox');
    expect(readdirSync(join(mailbox, 'old-member')).filter((f) => f.endsWith('.json'))).toHaveLength(1);

    const recreated = await tool('team_create')({ name: 'reborn', force: true });
    expect(recreated.success).toBe(true);
    expect(existsSync(join(mailbox, 'old-member'))).toBe(false); // wiped, not carried over
    expect(readTeam(cwd, 'reborn').members).toEqual({});

    await tool('team_spawn')({ team: 'reborn', agent: 'new-member' });
    expect((await tool('team_inbox')({ team: 'reborn', agent: 'new-member' })).messages).toEqual([]);
  });

  it('closes the team on shutdown and enforces maxAgents (review #8)', async () => {
    await tool('team_create')({ name: 'small', maxAgents: 2 });
    expect((await tool('team_spawn')({ team: 'small', agent: 'a' })).success).toBe(true);
    expect((await tool('team_spawn')({ team: 'small', agent: 'b' })).success).toBe(true);
    const full = await tool('team_spawn')({ team: 'small', agent: 'c' });
    expect(full.success).toBe(false);
    expect(full.error).toMatch(/full \(maxAgents=2\)/);
    // Re-spawning an existing member is an update, not a new seat
    expect((await tool('team_spawn')({ team: 'small', agent: 'a', prompt: 'again' })).success).toBe(true);

    await tool('team_send')({ team: 'small', to: 'a', message: 'before close' });
    await tool('team_shutdown')({ team: 'small' });
    for (const [name, input] of [
      ['team_spawn', { team: 'small', agent: 'd' }],
      ['team_send', { team: 'small', to: 'a', message: 'after close' }],
      ['team_broadcast', { team: 'small', message: 'after close' }],
      ['team_plan', { team: 'small', steps: ['a'] }],
    ] as const) {
      const r = await tool(name)(input);
      expect(r.success, name).toBe(false);
      expect(r.error).toMatch(/is shutdown/);
    }
    // Remaining mail can still be drained
    expect((await tool('team_inbox')({ team: 'small', agent: 'a' })).messages).toHaveLength(1);
  });

  it('rejects a broadcast with no members, delivers one with members (review minor)', async () => {
    await tool('team_create')({ name: 'bc' });
    const empty = await tool('team_broadcast')({ team: 'bc', message: 'anyone?' });
    expect(empty.success).toBe(false);
    expect(empty.error).toMatch(/no members/);
    await tool('team_spawn')({ team: 'bc', agent: 'x' });
    await tool('team_spawn')({ team: 'bc', agent: 'y' });
    expect((await tool('team_broadcast')({ team: 'bc', message: 'hi all' })).recipients).toEqual(['x', 'y']);
    expect((await tool('team_inbox')({ team: 'bc', agent: 'y' })).messages[0].type).toBe('broadcast');
  });

  it('validates priority and sorts numerically (review minor)', async () => {
    await tool('team_create')({ name: 'prio' });
    await tool('team_spawn')({ team: 'prio', agent: 'p' });
    for (const bad of ['abc', -1, 1.5, 1000, '1e2', '0x10', '0o20', '0b101']) {
      const r = await tool('team_send')({ team: 'prio', to: 'p', message: 'm', priority: bad });
      expect(r.success, String(bad)).toBe(false);
      expect(r.error).toMatch(/priority must be an integer/);
    }
    await tool('team_send')({ team: 'prio', to: 'p', message: 'ten', priority: 10 });
    await tool('team_send')({ team: 'prio', to: 'p', message: 'two', priority: 2 });
    await tool('team_send')({ team: 'prio', to: 'p', message: 'zero', priority: '0' });
    const files = readdirSync(join(cwd, '.claude-flow', 'teams', 'prio', 'mailbox', 'p')).filter((f) => f.endsWith('.json'));
    expect(files.every((f) => /^\d{3}_msg_/.test(f))).toBe(true);
    const inbox = await tool('team_inbox')({ team: 'prio', agent: 'p' });
    expect(inbox.messages.map((m: { content: string }) => m.content)).toEqual(['zero', 'two', 'ten']);
  });

  it('refuses a symlinked mailbox directory (review minor)', async () => {
    await tool('team_create')({ name: 'sym' });
    const outside = mkdtempSync(join(tmpdir(), 'ruflo-outside-'));
    try {
      const box = join(cwd, '.claude-flow', 'teams', 'sym', 'mailbox');
      mkdirSync(box, { recursive: true });
      symlinkSync(outside, join(box, 'victim'), 'dir');
      const r = await tool('team_send')({ team: 'sym', to: 'victim', message: 'escape?' });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/not a real directory/);
      expect(readdirSync(outside)).toEqual([]);
      expect((await tool('team_inbox')({ team: 'sym', agent: 'victim' })).success).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('two concurrent drains split the mail without ENOENT (review minor)', async () => {
    await tool('team_create')({ name: 'drain' });
    await tool('team_spawn')({ team: 'drain', agent: 'd' });
    for (let i = 0; i < 40; i++) {
      await tool('team_send')({ team: 'drain', to: 'd', message: `m${i}` });
    }
    const [a, b] = await Promise.all([
      runNode(BUS, ['inbox', '--root', cwd, '--team', 'drain', '--agent', 'd'], { cwd }),
      runNode(BUS, ['inbox', '--root', cwd, '--team', 'drain', '--agent', 'd'], { cwd }),
    ]);
    expect(a.code, a.stdout).toBe(0);
    expect(b.code, b.stdout).toBe(0);
    const got = [...JSON.parse(a.stdout).messages, ...JSON.parse(b.stdout).messages].map((m) => m.content);
    expect(got).toHaveLength(40);
    expect(new Set(got).size).toBe(40);
  }, 30_000);
});

describe('SubagentStop hook (review #5)', () => {
  let cwd: string;
  let prev: string | undefined;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'ruflo-hook-'));
    prev = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = cwd;
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prev;
    rmSync(cwd, { recursive: true, force: true });
  });

  it('advances the plan from the spawn description team_spawn returns', async () => {
    await tool('team_create')({ name: 'pipe' });
    await tool('team_plan')({ team: 'pipe', steps: ['alice', 'bob'] });
    const plan = await tool('team_spawn')({ team: 'pipe', agent: 'alice', role: 'coder' });
    const description = plan.spawnPlan.host.grok.spawn.description;
    expect(description).toBe('coder:alice@pipe');

    const r = await runNode(HOOK, [], { cwd, stdin: JSON.stringify({ description }) });
    expect(r.code, r.stderr).toBe(0);
    const team = readTeam(cwd, 'pipe');
    expect(team.plan.steps.map((s: { status: string }) => s.status)).toEqual(['done', 'ready']);
    expect(team.members.alice.status).toBe('idle');
  });

  it('ignores non-team subagents and reports failures on stderr', async () => {
    await tool('team_create')({ name: 'one' });
    await tool('team_create')({ name: 'two' });
    await tool('team_spawn')({ team: 'one', agent: 'dup' });
    await tool('team_spawn')({ team: 'two', agent: 'dup' });

    const unrelated = await runNode(HOOK, [], { cwd, stdin: JSON.stringify({ description: 'Explore the repo for X' }) });
    expect(unrelated.code).toBe(0);
    expect(unrelated.stderr).toBe('');

    const ambiguous = await runNode(HOOK, [], { cwd, stdin: JSON.stringify({ description: 'coder:dup' }) });
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toMatch(/several active teams \(one, two\)/);

    const missing = await runNode(HOOK, [], { cwd, stdin: JSON.stringify({ description: 'coder:dup@nope' }) });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toMatch(/Team "nope" not found/);
  });

  it('does not lose updates when hooks fire in parallel', async () => {
    await tool('team_create')({ name: 'par', maxAgents: 20 });
    const names = Array.from({ length: 12 }, (_, i) => `w${i}`);
    for (const n of names) await tool('team_spawn')({ team: 'par', agent: n });
    const runs = await Promise.all(
      names.map((n) => runNode(HOOK, [], { cwd, stdin: JSON.stringify({ description: `coder:${n}@par` }) })),
    );
    for (const r of runs) expect(r.code, r.stderr).toBe(0);
    const team = readTeam(cwd, 'par');
    expect(names.every((n) => team.members[n].status === 'idle' && team.members[n].lastStopAt)).toBe(true);
  }, 30_000);
});
