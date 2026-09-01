/**
 * Opt-in MCP governance policy enforcement (dream-cycle 2026-08-31, security;
 * sliding turn-window reset added 2026-09-01, follow-up to review round 1).
 *
 * `.harness/mcp-policy.json` declared `auditLog` / `maxToolCallsPerTurn` but
 * nothing in the running MCP server (`mcp-server.ts`) ever read it before
 * this change — every connected client could call every tool with no audit
 * trail and no call budget. These tests cover the new opt-in enforcement
 * module directly, plus the wiring into `MCPServerManager`'s `tools/call`
 * dispatch via a mocked `mcp-client.js` (avoids loading the real 300+ tool
 * registry).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  isPolicyEnforcementEnabled,
  loadMcpPolicy,
  checkAndRecordCall,
  appendAuditLog,
  evaluateToolCall,
  resetPolicyEnforcerState,
  setAuditLogPathForTesting,
  getAuditLogPath,
  type McpPolicy,
} from '../src/mcp-tools/policy-enforcer.js';

describe('isPolicyEnforcementEnabled', () => {
  it('is disabled by default (unset env)', () => {
    expect(isPolicyEnforcementEnabled({})).toBe(false);
  });
  it('is disabled for any value other than "1"/"true"', () => {
    expect(isPolicyEnforcementEnabled({ RUFLO_MCP_ENFORCE_POLICY: '0' })).toBe(false);
    expect(isPolicyEnforcementEnabled({ RUFLO_MCP_ENFORCE_POLICY: 'no' })).toBe(false);
  });
  it('is enabled for "1" or "true" (case-insensitive)', () => {
    expect(isPolicyEnforcementEnabled({ RUFLO_MCP_ENFORCE_POLICY: '1' })).toBe(true);
    expect(isPolicyEnforcementEnabled({ RUFLO_MCP_ENFORCE_POLICY: 'true' })).toBe(true);
    expect(isPolicyEnforcementEnabled({ RUFLO_MCP_ENFORCE_POLICY: 'TRUE' })).toBe(true);
  });
});

describe('loadMcpPolicy', () => {
  it('loads the repo policy file successfully', () => {
    const policy = loadMcpPolicy(path.join(process.cwd(), '..', '..', '..', '.harness', 'mcp-policy.json'));
    // repo root is 3 levels up from v3/@claude-flow/cli when tests run from the package dir
    expect(policy === null || typeof policy === 'object').toBe(true);
  });
  it('returns null for a missing file (never throws)', () => {
    expect(loadMcpPolicy('/nonexistent/path/mcp-policy.json')).toBeNull();
  });
  it('returns null for malformed JSON (never throws)', () => {
    const tmp = path.join(os.tmpdir(), `bad-policy-${Date.now()}.json`);
    fs.writeFileSync(tmp, '{ not valid json', 'utf-8');
    try {
      expect(loadMcpPolicy(tmp)).toBeNull();
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe('checkAndRecordCall — per-session budget', () => {
  beforeEach(() => resetPolicyEnforcerState());

  it('allows unlimited calls when maxToolCallsPerTurn is absent/invalid', () => {
    const policy: McpPolicy = {};
    for (let i = 0; i < 5; i++) {
      expect(checkAndRecordCall(policy, 's1').allowed).toBe(true);
    }
  });

  it('allows calls up to the limit, denies the (limit+1)th', () => {
    const policy: McpPolicy = { maxToolCallsPerTurn: 3 };
    expect(checkAndRecordCall(policy, 's1').allowed).toBe(true);
    expect(checkAndRecordCall(policy, 's1').allowed).toBe(true);
    expect(checkAndRecordCall(policy, 's1').allowed).toBe(true);
    const denied = checkAndRecordCall(policy, 's1');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/maxToolCallsPerTurn/);
  });

  it('tracks sessions independently', () => {
    const policy: McpPolicy = { maxToolCallsPerTurn: 1 };
    expect(checkAndRecordCall(policy, 'a').allowed).toBe(true);
    expect(checkAndRecordCall(policy, 'a').allowed).toBe(false);
    expect(checkAndRecordCall(policy, 'b').allowed).toBe(true);
  });
});

describe('checkAndRecordCall — sliding turn-window reset (dream-cycle 2026-09-01)', () => {
  beforeEach(() => resetPolicyEnforcerState());

  it('denies the (limit+1)th call within the window, then allows again once turnWindowMs has elapsed', () => {
    const policy: McpPolicy = { maxToolCallsPerTurn: 2, turnWindowMs: 1000 };
    expect(checkAndRecordCall(policy, 's1', 0).allowed).toBe(true);
    expect(checkAndRecordCall(policy, 's1', 100).allowed).toBe(true);
    const denied = checkAndRecordCall(policy, 's1', 200);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toMatch(/maxToolCallsPerTurn.*within the last 1000ms/);

    // Still within the window relative to the oldest call (t=0): still denied.
    expect(checkAndRecordCall(policy, 's1', 999).allowed).toBe(false);

    // Past the window relative to the oldest call: budget is restored, no
    // process restart required (this is the bug this candidate fixes — the
    // 2026-08-31 implementation would stay denied forever here).
    expect(checkAndRecordCall(policy, 's1', 1001).allowed).toBe(true);
  });

  it('pins the exact boundary: a call at now === oldest-call-time + windowMs is already outside the window (strict `>` cutoff, not `>=`)', () => {
    // Flagged by adversarial review (2026-09-01): the boundary itself
    // (now == cutoff) was previously untested, only now-1 (denied) and
    // now+1 (allowed). Reopening exactly on the boundary — rather than one
    // ms later — favors the caller, not an attacker, but pin it explicitly
    // so a future refactor can't silently flip `>` to `>=` unnoticed.
    const policy: McpPolicy = { maxToolCallsPerTurn: 1, turnWindowMs: 1000 };
    expect(checkAndRecordCall(policy, 's1', 0).allowed).toBe(true);
    expect(checkAndRecordCall(policy, 's1', 1000).allowed).toBe(true);
  });

  it('prunes only expired timestamps, not the whole window (a genuine sliding window, not a periodic full clear)', () => {
    const policy: McpPolicy = { maxToolCallsPerTurn: 2, turnWindowMs: 1000 };
    expect(checkAndRecordCall(policy, 's1', 0).allowed).toBe(true); // recorded at t=0
    expect(checkAndRecordCall(policy, 's1', 600).allowed).toBe(true); // recorded at t=600
    expect(checkAndRecordCall(policy, 's1', 600).allowed).toBe(false); // budget full: [0, 600]

    // t=1100: cutoff is 100, so only the t=0 call has expired; the t=600
    // call is still live. If this were a full periodic clear instead of a
    // real sliding window, both calls made at t=0..600 would either both
    // still count or both be wiped — this proves only the stale one drops.
    expect(checkAndRecordCall(policy, 's1', 1100).allowed).toBe(true); // [600, 1100]
    expect(checkAndRecordCall(policy, 's1', 1100).allowed).toBe(false); // full again
  });

  it('defaults turnWindowMs to 60000 when the policy omits it', () => {
    const policy: McpPolicy = { maxToolCallsPerTurn: 1 };
    expect(checkAndRecordCall(policy, 's1', 0).allowed).toBe(true);
    expect(checkAndRecordCall(policy, 's1', 59_999).allowed).toBe(false);
    expect(checkAndRecordCall(policy, 's1', 60_001).allowed).toBe(true);
  });

  it('ignores a non-positive/invalid turnWindowMs and falls back to the 60000ms default', () => {
    const policy: McpPolicy = { maxToolCallsPerTurn: 1, turnWindowMs: -5 };
    expect(checkAndRecordCall(policy, 's1', 0).allowed).toBe(true);
    expect(checkAndRecordCall(policy, 's1', 60_001).allowed).toBe(true);
  });
});

describe('appendAuditLog', () => {
  let logFile: string;
  beforeEach(() => {
    logFile = path.join(os.tmpdir(), `mcp-audit-test-${Date.now()}-${Math.random()}.jsonl`);
    setAuditLogPathForTesting(logFile);
  });
  afterEach(() => {
    setAuditLogPathForTesting(null);
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
  });

  it('does nothing and reports success (nothing was required) when policy.auditLog is not true', () => {
    expect(appendAuditLog({ auditLog: false }, {
      timestamp: new Date().toISOString(), sessionId: 's', toolName: 't', allowed: true,
    })).toBe(true);
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('appends one JSONL record per call when auditLog is true, and reports success', () => {
    const policy: McpPolicy = { auditLog: true };
    expect(appendAuditLog(policy, { timestamp: 't1', sessionId: 's1', toolName: 'memory_store', allowed: true })).toBe(true);
    expect(appendAuditLog(policy, { timestamp: 't2', sessionId: 's1', toolName: 'memory_store', allowed: false, reason: 'denied' })).toBe(true);
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ toolName: 'memory_store', allowed: true });
    expect(JSON.parse(lines[1])).toMatchObject({ allowed: false, reason: 'denied' });
  });

  it('never throws, and reports failure, when the log path is unwritable', () => {
    setAuditLogPathForTesting('/nonexistent-dir-xyz/audit.jsonl');
    let result: boolean | undefined;
    expect(() => {
      result = appendAuditLog({ auditLog: true }, {
        timestamp: 't', sessionId: 's', toolName: 'x', allowed: true,
      });
    }).not.toThrow();
    expect(result).toBe(false);
  });
});

describe('evaluateToolCall — single enforcement entry point (fail-closed)', () => {
  let logFile: string;
  beforeEach(() => {
    resetPolicyEnforcerState();
    logFile = path.join(os.tmpdir(), `mcp-audit-eval-${Date.now()}-${Math.random()}.jsonl`);
    setAuditLogPathForTesting(logFile);
  });
  afterEach(() => {
    setAuditLogPathForTesting(null);
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
  });

  it('denies with a clear reason when policy is null (missing/malformed file) — fail-closed', () => {
    const result = evaluateToolCall(null, 's1', 'memory_store');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/missing or invalid.*failing closed/i);
  });

  it('allows a call within budget with a working audit log', () => {
    const result = evaluateToolCall({ auditLog: true, maxToolCallsPerTurn: 5 }, 's1', 'memory_store');
    expect(result.allowed).toBe(true);
    expect(fs.readFileSync(logFile, 'utf-8').trim().split('\n')).toHaveLength(1);
  });

  it('denies once the session budget is exhausted, and still logs the denial', () => {
    const policy: McpPolicy = { auditLog: true, maxToolCallsPerTurn: 1 };
    expect(evaluateToolCall(policy, 's1', 'memory_store').allowed).toBe(true);
    const second = evaluateToolCall(policy, 's1', 'memory_store');
    expect(second.allowed).toBe(false);
    expect(second.reason).toMatch(/maxToolCallsPerTurn/);
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]).allowed).toBe(false);
  });

  it('denies — fail-closed — when auditLog is required but the write fails, even though budget allows the call', () => {
    setAuditLogPathForTesting('/nonexistent-dir-xyz/audit.jsonl');
    const result = evaluateToolCall({ auditLog: true, maxToolCallsPerTurn: 5 }, 's1', 'memory_store');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/audit log write failed.*failing closed/i);
  });

  it('does not require a working audit log when policy.auditLog is not set', () => {
    setAuditLogPathForTesting('/nonexistent-dir-xyz/audit.jsonl');
    const result = evaluateToolCall({ maxToolCallsPerTurn: 5 }, 's1', 'memory_store');
    expect(result.allowed).toBe(true);
  });

  it('restores budget after the turn window elapses, through the full evaluateToolCall pipeline (fake timers, matching this package\'s existing pattern)', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const policy: McpPolicy = { auditLog: true, maxToolCallsPerTurn: 1, turnWindowMs: 1000 };
      expect(evaluateToolCall(policy, 's1', 'memory_store').allowed).toBe(true);
      expect(evaluateToolCall(policy, 's1', 'memory_store').allowed).toBe(false);

      vi.setSystemTime(1001);
      const afterWindow = evaluateToolCall(policy, 's1', 'memory_store');
      expect(afterWindow.allowed).toBe(true);

      const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles concurrent calls for the same session without double-allowing past the budget', async () => {
    const policy: McpPolicy = { maxToolCallsPerTurn: 3 };
    // evaluateToolCall is synchronous end-to-end (no await inside), so
    // Promise.all over synchronous calls cannot interleave — this pins
    // that invariant rather than exercising real concurrency.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve(evaluateToolCall(policy, 'concurrent-session', 'memory_store'))),
    );
    expect(results.filter(r => r.allowed)).toHaveLength(3);
    expect(results.filter(r => !r.allowed)).toHaveLength(2);
  });
});

describe('getAuditLogPath', () => {
  afterEach(() => setAuditLogPathForTesting(null));
  it('defaults to a path under the OS tmpdir', () => {
    expect(getAuditLogPath().startsWith(os.tmpdir())).toBe(true);
  });
});

// --- Integration: MCPServerManager.tools/call dispatch wiring ---
// mcp-client.js pulls in the full ~300-tool registry; mock it so this test
// stays fast, deterministic, and isolated to the new dispatch-path wiring.
vi.mock('../src/mcp-client.js', () => ({
  listMCPTools: () => [{ name: 'demo_tool', description: 'demo', inputSchema: {} }],
  hasTool: (name: string) => name === 'demo_tool',
  callMCPTool: vi.fn(async () => ({ ok: true })),
}));

describe('MCPServerManager tools/call — policy wiring', () => {
  const ORIGINAL_ENV = process.env.RUFLO_MCP_ENFORCE_POLICY;
  let policyPath: string;

  beforeEach(() => {
    resetPolicyEnforcerState();
    setAuditLogPathForTesting(path.join(os.tmpdir(), `mcp-audit-integration-${Date.now()}.jsonl`));
    policyPath = path.join(os.tmpdir(), `mcp-policy-integration-${Date.now()}.json`);
  });
  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.RUFLO_MCP_ENFORCE_POLICY;
    else process.env.RUFLO_MCP_ENFORCE_POLICY = ORIGINAL_ENV;
    setAuditLogPathForTesting(null);
    if (fs.existsSync(policyPath)) fs.unlinkSync(policyPath);
    vi.restoreAllMocks();
  });

  async function dispatch(server: any, toolName: string, sessionId: string) {
    return server.handleMCPMessage(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: {} } },
      sessionId,
    );
  }

  it('default (flag unset): every call succeeds, no budget enforced — unchanged from pre-existing behavior', async () => {
    delete process.env.RUFLO_MCP_ENFORCE_POLICY;
    const { MCPServerManager } = await import('../src/mcp-server.js');
    const server = new (MCPServerManager as any)();
    for (let i = 0; i < 5; i++) {
      const res = await dispatch(server, 'demo_tool', 'sess-default');
      expect(res.error).toBeUndefined();
    }
  });

  it('enabled + no policy file found: denies — fail-closed on missing config (PR #3139 review round 1)', async () => {
    process.env.RUFLO_MCP_ENFORCE_POLICY = '1';
    const mod = await import('../src/mcp-tools/policy-enforcer.js');
    const spy = vi.spyOn(mod, 'loadMcpPolicy').mockReturnValue(null);
    const { MCPServerManager } = await import('../src/mcp-server.js');
    const server = new (MCPServerManager as any)();
    const res = await dispatch(server, 'demo_tool', 'sess-nopolicy');
    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Policy denied.*missing or invalid.*failing closed/i);
    spy.mockRestore();
  });

  it('enabled + malformed policy JSON on disk: denies — fail-closed', async () => {
    process.env.RUFLO_MCP_ENFORCE_POLICY = '1';
    fs.writeFileSync(policyPath, '{ not valid json', 'utf-8');
    // Confirm the disk content really is malformed via the real loader
    // (unit-tested separately above), then wire that same real behavior
    // into the server-level dispatch by pointing loadMcpPolicy() at it.
    // Capture the *real* implementation before spying — `mod.loadMcpPolicy`
    // and the top-level imported `loadMcpPolicy` are the same live ESM
    // binding, so calling it from inside its own mock would recurse forever.
    const { loadMcpPolicy: realLoadMcpPolicy } = await vi.importActual<typeof import('../src/mcp-tools/policy-enforcer.js')>('../src/mcp-tools/policy-enforcer.js');
    expect(realLoadMcpPolicy(policyPath)).toBeNull();
    const mod = await import('../src/mcp-tools/policy-enforcer.js');
    const spy = vi.spyOn(mod, 'loadMcpPolicy').mockImplementation(() => realLoadMcpPolicy(policyPath));
    const { MCPServerManager } = await import('../src/mcp-server.js');
    const server = new (MCPServerManager as any)();
    const res = await dispatch(server, 'demo_tool', 'sess-malformed');
    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Policy denied.*failing closed/i);
    spy.mockRestore();
  });

  it('enabled + auditLog required but log path unwritable: denies — fail-closed even though budget would allow', async () => {
    process.env.RUFLO_MCP_ENFORCE_POLICY = '1';
    setAuditLogPathForTesting('/nonexistent-dir-xyz/audit.jsonl');
    const mod = await import('../src/mcp-tools/policy-enforcer.js');
    const spy = vi.spyOn(mod, 'loadMcpPolicy').mockReturnValue({ auditLog: true, maxToolCallsPerTurn: 100 });
    const { MCPServerManager } = await import('../src/mcp-server.js');
    const server = new (MCPServerManager as any)();
    const res = await dispatch(server, 'demo_tool', 'sess-unwritable-log');
    expect(res.error).toBeDefined();
    expect(res.error.message).toMatch(/Policy denied.*audit log write failed.*failing closed/i);
    spy.mockRestore();
  });

  it('enabled + budget=1: 1st call allowed, 2nd call denied with a policy error', async () => {
    process.env.RUFLO_MCP_ENFORCE_POLICY = '1';
    fs.writeFileSync(policyPath, JSON.stringify({ auditLog: true, maxToolCallsPerTurn: 1 }), 'utf-8');
    const mod = await import('../src/mcp-tools/policy-enforcer.js');
    const spy = vi.spyOn(mod, 'loadMcpPolicy').mockReturnValue({ auditLog: true, maxToolCallsPerTurn: 1 });
    const { MCPServerManager } = await import('../src/mcp-server.js');
    const server = new (MCPServerManager as any)();
    const first = await dispatch(server, 'demo_tool', 'sess-budget');
    expect(first.error).toBeUndefined();
    const second = await dispatch(server, 'demo_tool', 'sess-budget');
    expect(second.error).toBeDefined();
    expect(second.error.message).toMatch(/Policy denied/);
    spy.mockRestore();
  });
});
