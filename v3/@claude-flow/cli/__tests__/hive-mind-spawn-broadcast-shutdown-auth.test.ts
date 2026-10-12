/**
 * Regression test — hive-mind_spawn / consensus(propose) / broadcast / shutdown
 * authentication gap (dream-cycle 2026-09-16, follow-up to #3291).
 *
 * PR #3291 (merged 2026-09-15) bound hive-mind_join/leave/vote to a
 * capability token minted by hive-mind_init, closing a Sybil-vote attack.
 * Six sibling MCP tools mutate the same hive state with no such gate:
 *
 *  - hive-mind_spawn pushes attacker-chosen agent ids straight into
 *    `state.workers` — the exact roster `vote` treats as legitimate voters
 *    (`state.workers.includes(voterId)`). An unauthenticated caller could
 *    spawn its own "workers" and then vote as them, bypassing #3291
 *    entirely via this sibling tool rather than defeating it directly.
 *  - hive-mind_consensus's 'propose' action let anyone inject an arbitrary
 *    proposal (type/value of their choosing) for real workers to vote on,
 *    or exhaust raft's one-pending-proposal-per-term slot as a DoS.
 *  - hive-mind_broadcast let anyone inject spoofed messages (arbitrary
 *    fromId) into shared memory every worker reads.
 *  - hive-mind_shutdown let anyone terminate a running hive (wiping
 *    workers/pending consensus/shared memory) with zero proof of
 *    membership.
 *  - hive-mind_memory's 'set'/'delete' actions let anyone tamper with or
 *    erase shared-memory entries every worker/queen reads — the same
 *    attack class broadcast was gated for, on a sibling action in the
 *    same tool (found by an independent adversarial critique of the
 *    first version of this fix, which covered spawn/propose/broadcast/
 *    shutdown but missed this one).
 *  - hive-mind_optimize-memory prunes shared-memory entries with no gate
 *    either (found in round 2 review, #3339).
 *
 * All seven now call the same `requireHiveToken` gate join/leave/vote
 * already use. A denied call makes zero state change, verified below by
 * re-reading state.json fresh off disk (simulating a process restart)
 * after each denial.
 *
 * ADR-476 (rework of #3339): the gate is a boundary for REMOTE callers only.
 * Local stdio/CLI/in-process callers need no credential (so existing flows
 * keep working), and hive-mind_init never returns the token. These tests
 * therefore model an untrusted HTTP caller by passing the server-built
 * context `{ transport: 'http' }`; the full caller x credential matrix,
 * env override, file permissions and no-leak guarantees live in
 * hive-mind-gate-matrix.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hiveMindTools, getHiveTokenForCli } from '../src/mcp-tools/hive-mind-tools.js';

const CLI = join(__dirname, '..', 'bin', 'cli.js');

function runCli(args: string[], cwd: string): { stdout: string; exit: number } {
  try {
    const stdout = execFileSync('node', [CLI, ...args], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_FLOW_CWD: cwd },
    });
    return { stdout, exit: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { stdout: (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? ''), exit: e.status ?? -1 };
  }
}

const REMOTE = { sessionId: 'auth-test', transport: 'http' };
const SECRET = 'operator-secret-for-tests-0123456789';

function tool(name: string) {
  const t = hiveMindTools.find((t) => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return { ...t, handler: (input: Record<string, unknown>) => t.handler(input, REMOTE) };
}

/** The local operator (no context): what the CLI and stdio MCP use. */
function localTool(name: string) {
  const t = hiveMindTools.find((t) => t.name === name);
  if (!t) throw new Error(`tool not found: ${name}`);
  return t;
}

function readPersistedState(dir: string): {
  workers: string[];
  initialized: boolean;
  consensus: { pending: Array<{ proposalId: string }> };
  sharedMemory: Record<string, unknown>;
} {
  const raw = readFileSync(join(dir, '.claude-flow', 'hive-mind', 'state.json'), 'utf-8');
  return JSON.parse(raw);
}

describe('hive-mind_spawn / consensus(propose) / broadcast / shutdown capability-token authentication', () => {
  let dir: string;
  let prevCwd: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hive-mind-auth-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    process.env.RUFLO_HIVE_BOOTSTRAP_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.RUFLO_HIVE_BOOTSTRAP_SECRET;
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    rmSync(dir, { recursive: true, force: true });
  });

  async function initHive(): Promise<string> {
    const init = (await localTool('hive-mind_init').handler({ consensus: 'raft' })) as any;
    expect(init.success).toBe(true);
    expect(init.hiveToken).toBeUndefined();
    return getHiveTokenForCli() as string;
  }

  it('hive-mind_spawn is denied without the token, and mints zero workers (verified after a fresh state reload)', async () => {
    await initHive();

    const denied = (await tool('hive-mind_spawn').handler({ count: 3 })) as any;
    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/hiveToken is required/);

    const deniedWrongToken = (await tool('hive-mind_spawn').handler({
      count: 3,
      hiveToken: 'forged',
    })) as any;
    expect(deniedWrongToken.success).toBe(false);
    expect(deniedWrongToken.error).toMatch(/Invalid hiveToken/);

    const persisted = readPersistedState(dir);
    expect(persisted.workers).toEqual([]);
  });

  it('hive-mind_spawn succeeds with the correct token and the spawned worker can then legitimately vote', async () => {
    const token = await initHive();

    const spawn = (await tool('hive-mind_spawn').handler({ count: 1, prefix: 'w', hiveToken: token })) as any;
    expect(spawn.success).toBe(true);
    expect(spawn.workers).toHaveLength(1);
    const agentId = spawn.workers[0].agentId as string;

    const propose = (await tool('hive-mind_consensus').handler({
      action: 'propose',
      type: 'test',
      value: 'x',
      strategy: 'raft',
      hiveToken: token,
    })) as any;
    expect(propose.status).toBe('pending');

    const vote = (await tool('hive-mind_consensus').handler({
      action: 'vote',
      proposalId: propose.proposalId,
      vote: true,
      voterId: agentId,
      hiveToken: token,
    })) as any;
    expect(vote.error).toBeUndefined();
  });

  it('without the spawn gate, an attacker could have minted a Sybil voter and crossed quorum -- with the gate, the attempt to vote as a never-joined id is rejected', async () => {
    // Regression guard for the actual attack chain #3291 left open via
    // hive-mind_spawn: attacker calls spawn (now denied) to try to mint a
    // voter, then tries to vote as a fabricated id anyway. Both steps must
    // fail and the vote must never be recorded.
    const token = await initHive();

    const spawnDenied = (await tool('hive-mind_spawn').handler({ count: 1 })) as any;
    expect(spawnDenied.success).toBe(false);

    const propose = (await tool('hive-mind_consensus').handler({
      action: 'propose',
      type: 'test',
      value: 'x',
      strategy: 'raft',
      hiveToken: token,
    })) as any;

    const forgedVote = (await tool('hive-mind_consensus').handler({
      action: 'vote',
      proposalId: propose.proposalId,
      vote: true,
      voterId: 'sybil-worker-0',
      hiveToken: token,
    })) as any;
    expect(forgedVote.error).toMatch(/not a registered hive-mind worker/);

    const persisted = readPersistedState(dir);
    const persistedProposal = persisted.consensus.pending.find((p) => p.proposalId === propose.proposalId) as any;
    expect(persistedProposal?.votes ?? {}).toEqual({});
  });

  it("hive-mind_consensus 'propose' is denied without the token, and records zero proposals (verified after a fresh state reload)", async () => {
    await initHive();

    const denied = (await tool('hive-mind_consensus').handler({
      action: 'propose',
      type: 'malicious',
      value: 'attacker-controlled',
      strategy: 'raft',
    })) as any;
    expect(denied.error).toMatch(/hiveToken is required/);

    const persisted = readPersistedState(dir);
    expect(persisted.consensus.pending).toEqual([]);
  });

  it('hive-mind_broadcast is denied without the token, and stores zero messages (verified after a fresh state reload)', async () => {
    await initHive();

    const denied = (await tool('hive-mind_broadcast').handler({
      message: 'attacker-controlled announcement',
      fromId: 'queen',
    })) as any;
    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/hiveToken is required/);

    const persisted = readPersistedState(dir);
    expect((persisted.sharedMemory.broadcasts as unknown[] | undefined) ?? []).toEqual([]);
  });

  it('hive-mind_broadcast succeeds with the correct token', async () => {
    const token = await initHive();
    const ok = (await tool('hive-mind_broadcast').handler({ message: 'hello', hiveToken: token })) as any;
    expect(ok.success).toBe(true);

    const persisted = readPersistedState(dir);
    expect(persisted.sharedMemory.broadcasts as unknown[]).toHaveLength(1);
  });

  it('hive-mind_shutdown is denied without the token, and leaves the hive fully initialized (verified after a fresh state reload)', async () => {
    const token = await initHive();
    await tool('hive-mind_join').handler({ agentId: 'worker-0', hiveToken: token });

    const denied = (await tool('hive-mind_shutdown').handler({ force: true })) as any;
    expect(denied.success).toBe(false);
    expect(denied.error).toMatch(/hiveToken is required/);

    const persisted = readPersistedState(dir);
    expect(persisted.initialized).toBe(true);
    expect(persisted.workers).toEqual(['worker-0']);
  });

  it('hive-mind_shutdown succeeds with the correct token', async () => {
    const token = await initHive();
    await tool('hive-mind_join').handler({ agentId: 'worker-0', hiveToken: token });

    const ok = (await tool('hive-mind_shutdown').handler({ force: true, hiveToken: token })) as any;
    expect(ok.success).toBe(true);

    const persisted = readPersistedState(dir);
    expect(persisted.initialized).toBe(false);
    expect(persisted.workers).toEqual([]);
  });

  it("hive-mind_memory 'set' is denied without the token, and writes zero entries (verified after a fresh state reload)", async () => {
    await initHive();

    const denied = (await tool('hive-mind_memory').handler({
      action: 'set',
      key: 'attacker-key',
      value: 'attacker-controlled',
    })) as any;
    expect(denied.error).toMatch(/hiveToken is required/);

    const persisted = readPersistedState(dir);
    expect(persisted.sharedMemory).toEqual({});
  });

  it("hive-mind_memory 'set' succeeds with the correct token", async () => {
    const token = await initHive();
    const ok = (await tool('hive-mind_memory').handler({
      action: 'set',
      key: 'k',
      value: 'v',
      hiveToken: token,
    })) as any;
    expect(ok.success).toBe(true);

    const persisted = readPersistedState(dir);
    expect(persisted.sharedMemory).toEqual({ k: 'v' });
  });

  it("hive-mind_memory 'delete' is denied without the token, and leaves an existing entry untouched (verified after a fresh state reload)", async () => {
    const token = await initHive();
    await tool('hive-mind_memory').handler({ action: 'set', key: 'k', value: 'v', hiveToken: token });

    const denied = (await tool('hive-mind_memory').handler({ action: 'delete', key: 'k' })) as any;
    expect(denied.error).toMatch(/hiveToken is required/);

    const persisted = readPersistedState(dir);
    expect(persisted.sharedMemory).toEqual({ k: 'v' });
  });

  it("hive-mind_memory 'delete' succeeds with the correct token", async () => {
    const token = await initHive();
    await tool('hive-mind_memory').handler({ action: 'set', key: 'k', value: 'v', hiveToken: token });

    const ok = (await tool('hive-mind_memory').handler({ action: 'delete', key: 'k', hiveToken: token })) as any;
    expect(ok.deleted).toBe(true);

    const persisted = readPersistedState(dir);
    expect(persisted.sharedMemory).toEqual({});
  });

  it('hive-mind_optimize-memory is denied without the token, and prunes nothing (verified after a fresh state reload)', async () => {
    const token = await initHive();
    await tool('hive-mind_memory').handler({ action: 'set', key: 'empty', value: null, hiveToken: token });

    const denied = (await tool('hive-mind_optimize-memory').handler({})) as any;
    expect(denied.optimized).toBe(false);
    expect(denied.error).toMatch(/hiveToken is required/);

    const persisted = readPersistedState(dir);
    expect(persisted.sharedMemory).toEqual({ empty: null });
  });

  it('hive-mind_optimize-memory succeeds with the correct token', async () => {
    const token = await initHive();
    await tool('hive-mind_memory').handler({ action: 'set', key: 'empty', value: null, hiveToken: token });

    const ok = (await tool('hive-mind_optimize-memory').handler({ hiveToken: token })) as any;
    expect(ok.removed).toBe(1);

    const persisted = readPersistedState(dir);
    expect(persisted.sharedMemory).toEqual({});
  });

  describe('hive-mind_init operator-secret gate for remote callers (ADR-476)', () => {
    it('is denied without a bootstrapSecret on first-time (fresh) init, and mints no hive at all', async () => {
      const denied = (await tool('hive-mind_init').handler({ consensus: 'raft' })) as any;
      expect(denied.success).toBe(false);
      expect(denied.error).toMatch(/bootstrapSecret is required/);
      expect(existsSync(join(dir, '.claude-flow', 'hive-mind', 'state.json'))).toBe(false);
    });

    it('is denied with a forged bootstrapSecret, and mints no hive', async () => {
      const denied = (await tool('hive-mind_init').handler({
        consensus: 'raft',
        bootstrapSecret: 'forged-secret-attacker-guessed',
      })) as any;
      expect(denied.success).toBe(false);
      expect(denied.error).toBe('Invalid bootstrapSecret');
      expect(existsSync(join(dir, '.claude-flow', 'hive-mind', 'state.json'))).toBe(false);
    });

    it('never echoes the operator secret back to a denied caller', async () => {
      const denied = (await tool('hive-mind_init').handler({ consensus: 'raft', bootstrapSecret: 'wrong' })) as any;
      expect(JSON.stringify(denied)).not.toContain(SECRET);
    });

    it('succeeds with the correct bootstrapSecret, and still does not return the token', async () => {
      const ok = (await tool('hive-mind_init').handler({ consensus: 'raft', bootstrapSecret: SECRET })) as any;
      expect(ok.success).toBe(true);
      expect(ok.hiveToken).toBeUndefined();
      expect(JSON.stringify(ok)).not.toContain(getHiveTokenForCli() as string);
    });

    it('a remote hiveToken cannot (re)initialize: init accepts only the operator secret', async () => {
      const token = await initHive();
      const denied = (await tool('hive-mind_init').handler({ consensus: 'byzantine', hiveToken: token })) as any;
      expect(denied.success).toBe(false);
    });

    it('re-init on an already-initialized hive is ALSO denied without the secret, and changes nothing (verified after a fresh state reload)', async () => {
      await initHive();
      const before = readPersistedState(dir);

      const denied = (await tool('hive-mind_init').handler({ consensus: 'byzantine', topology: 'ring' })) as any;
      expect(denied.success).toBe(false);
      expect(denied.error).toMatch(/bootstrapSecret is required/);

      expect(readPersistedState(dir)).toEqual(before);
    });

    it('re-init with the correct secret succeeds and keeps the existing hiveToken (does not rotate it)', async () => {
      const token = await initHive();
      const reinit = (await tool('hive-mind_init').handler({ consensus: 'byzantine', bootstrapSecret: SECRET })) as any;
      expect(reinit.success).toBe(true);
      expect(getHiveTokenForCli()).toBe(token);
    });
  });

  describe('real CLI-process integration (not just direct handler calls)', () => {
    it('`hive-mind init` then `hive-mind spawn` succeed end-to-end through the actual CLI binary in a fresh child process', () => {
      const initResult = runCli(['hive-mind', 'init', '--consensus', 'raft'], dir);
      expect(initResult.exit).toBe(0);
      expect(existsSync(join(dir, '.claude-flow', 'hive-mind', 'state.json'))).toBe(true);

      // Fresh state read (this is a separate `node` process from the one
      // that ran init -- no in-process cache of any kind survives between
      // these two runCli() calls).
      const spawnResult = runCli(['hive-mind', 'spawn', '--count', '1'], dir);
      expect(spawnResult.exit).toBe(0);

      const persisted = readPersistedState(dir) as any;
      expect(persisted.workers.length).toBe(1);
    });

    it('a raw MCP-style call with no bootstrapSecret cannot bootstrap a hive via the real dispatch path either (spawning `hive-mind spawn` with no prior init fails)', () => {
      // No init was ever run in this fresh temp dir/process.
      const spawnResult = runCli(['hive-mind', 'spawn', '--count', '1'], dir);
      expect(spawnResult.exit).not.toBe(0);
      expect(existsSync(join(dir, '.claude-flow', 'hive-mind', 'state.json'))).toBe(false);
    });
  });
});
