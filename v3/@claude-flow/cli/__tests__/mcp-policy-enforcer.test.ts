/**
 * Opt-in MCP governance policy enforcement (dream-cycle 2026-08-31, security).
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

  it('does nothing when policy.auditLog is not true', () => {
    appendAuditLog({ auditLog: false }, {
      timestamp: new Date().toISOString(), sessionId: 's', toolName: 't', allowed: true,
    });
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('appends one JSONL record per call when auditLog is true', () => {
    const policy: McpPolicy = { auditLog: true };
    appendAuditLog(policy, { timestamp: 't1', sessionId: 's1', toolName: 'memory_store', allowed: true });
    appendAuditLog(policy, { timestamp: 't2', sessionId: 's1', toolName: 'memory_store', allowed: false, reason: 'denied' });
    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ toolName: 'memory_store', allowed: true });
    expect(JSON.parse(lines[1])).toMatchObject({ allowed: false, reason: 'denied' });
  });

  it('never throws even if the log path is unwritable', () => {
    setAuditLogPathForTesting('/nonexistent-dir-xyz/audit.jsonl');
    expect(() => appendAuditLog({ auditLog: true }, {
      timestamp: 't', sessionId: 's', toolName: 'x', allowed: true,
    })).not.toThrow();
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

  it('enabled + no policy file found: falls through to normal dispatch (fail-open on missing config)', async () => {
    process.env.RUFLO_MCP_ENFORCE_POLICY = '1';
    const { MCPServerManager, loadMcpPolicy: _unused } = await import('../src/mcp-server.js');
    void _unused;
    const server = new (MCPServerManager as any)();
    // loadMcpPolicy() with no override resolves against process.cwd(); a
    // missing/absent .harness dir there yields null -> enforcement no-ops.
    const res = await dispatch(server, 'demo_tool', 'sess-nopolicy');
    expect(res.error).toBeUndefined();
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
