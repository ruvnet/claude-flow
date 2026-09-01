/**
 * MCP Governance Policy Enforcer (opt-in).
 *
 * `.harness/mcp-policy.json` declares governance intent (defaultDeny,
 * auditLog, maxToolCallsPerTurn, dangerousPatterns, ...) for the claude-flow
 * MCP server, but until now nothing in the running server (mcp-server.ts)
 * ever read it: `harness mcp-scan` grades the file's *posture* offline, the
 * live `tools/call` dispatch never consulted it. Any connected MCP client
 * could call every registered tool with no audit trail and no call budget.
 *
 * This module wires the two policy fields that are actually in this
 * server's jurisdiction, per the policy file's own rationale comment
 * (`dangerousPatterns` / `allowShell` / `allowNetwork` / `allowFileWrite`
 * describe the native-Claude-Code-tool layer — Bash/Write/Edit/WebFetch —
 * not this MCP server's memory_-, hooks_-, agentdb_-prefixed tool surface,
 * so they are intentionally left unenforced here):
 *   - `auditLog`: append a JSONL record for every `tools/call`.
 *   - `maxToolCallsPerTurn`: bound calls per MCP *session* (one stdio
 *     process lifetime), deny once exceeded.
 *
 * Fully opt-in via `RUFLO_MCP_ENFORCE_POLICY=1` (or `true`). Unset/false
 * means every function below is a no-op on the hot path — the pre-existing
 * `tools/call` behavior is unchanged.
 *
 * FAIL-CLOSED once enforcement is enabled (PR #3139 review round 1):
 * a missing/malformed policy file, or a failed mandatory audit-log write,
 * denies the call rather than silently degrading to unrestricted execution.
 * The whole point of opting in is a restriction that actually holds; an
 * enforcement flag that quietly falls back to "no restriction" on its own
 * misconfiguration defeats the feature. See `evaluateToolCall()`.
 *
 * Known scope limits (disclosed, not fixed here):
 *   - Only wired into the stdio `tools/call` dispatch
 *     (`MCPServerManager.handleMCPMessage`). The separate HTTP/websocket
 *     path (`startHttpServer()`, via `@claude-flow/mcp`) does not call
 *     this module and is unaffected even when this flag is set.
 *
 * `maxToolCallsPerTurn` reset semantics (dream-cycle 2026-09-01, follow-up
 * to 2026-08-31 review round 1): despite the field's name, the original
 * implementation enforced a *session-lifetime cumulative* cap that never
 * reset — a long-lived stdio session could exhaust the budget under
 * entirely legitimate use and stay locked out until the MCP server process
 * restarted. Research that night (see the dream-cycle gist) found: (1) the
 * MCP spec only mandates "rate limit tool invocations" with zero mechanism
 * guidance, and its 2026-07-28 revision (SEP-2567) is actively removing the
 * session concept from the protocol entirely; (2) every framework/product
 * that gets this right (FastMCP's rate-limiting middleware, the PolicyLayer
 * MCP firewall, Cloudflare's public rate limiter) anchors the reset to
 * wall-clock time, not to a turn or session counter that never decays —
 * a turn-count reset is gameable by a chatty loop re-arming its own budget,
 * which wall-clock time is not. This module now enforces a *sliding
 * wall-clock window*: `maxToolCallsPerTurn` calls are allowed per rolling
 * `turnWindowMs` (default 60000) per session, keyed by call timestamp so
 * calls fall out of the window as time passes rather than accumulating
 * forever. `now` is an injectable parameter (defaults to `Date.now`) so
 * production callers need no change and tests stay fully deterministic via
 * `vi.useFakeTimers()`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface McpPolicy {
  schema?: number;
  policyVersion?: number;
  harnessId?: string;
  defaultDeny?: boolean;
  auditLog?: boolean;
  requireApprovalForDangerous?: boolean;
  toolTimeoutMs?: number;
  /**
   * Despite the name, this is a WALL-CLOCK rate limit, not a literal
   * conversational-turn counter — MCP has no protocol-level concept of a
   * "turn" to count against (confirmed: the spec is silent on it, and its
   * 2026-07-28 revision removes the session concept entirely). Enforced as
   * "at most this many calls in any rolling `turnWindowMs` window" per
   * session. Treat it, and document it to callers, as rate limiting.
   */
  maxToolCallsPerTurn?: number;
  /** Rolling window (ms) over which `maxToolCallsPerTurn` is counted. Default 60000. */
  turnWindowMs?: number;
  dangerousPatterns?: string[];
  approvedServers?: string[];
  [key: string]: unknown;
}

export function isPolicyEnforcementEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.RUFLO_MCP_ENFORCE_POLICY;
  return v === '1' || (v ?? '').toLowerCase() === 'true';
}

export function loadMcpPolicy(
  policyPath: string = path.join(process.cwd(), '.harness', 'mcp-policy.json'),
): McpPolicy | null {
  try {
    const raw = fs.readFileSync(policyPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as McpPolicy;
  } catch {
    return null;
  }
}

const DEFAULT_TURN_WINDOW_MS = 60_000;

interface SessionState {
  /** Timestamps (ms) of calls still believed to be within the current sliding window. */
  callTimes: number[];
}

const sessionState = new Map<string, SessionState>();

/** Test-only: clear per-session call state between test cases. */
export function resetPolicyEnforcerState(): void {
  sessionState.clear();
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Checks (and, if allowed, records) a tool call against
 * `policy.maxToolCallsPerTurn`, counted over a sliding window of
 * `policy.turnWindowMs` (default 60000ms) rather than the session's whole
 * lifetime. Calls older than the window are pruned before comparing count
 * to limit, so a session that pauses gets its budget back rather than
 * staying denied until the process restarts. `now` defaults to `Date.now`
 * for production callers; tests inject a controlled clock instead.
 */
export function checkAndRecordCall(
  policy: McpPolicy,
  sessionId: string,
  now: number = Date.now(),
): PolicyCheckResult {
  const limit = policy.maxToolCallsPerTurn;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true };
  }
  const configuredWindow = policy.turnWindowMs;
  const windowMs =
    typeof configuredWindow === 'number' && Number.isFinite(configuredWindow) && configuredWindow > 0
      ? configuredWindow
      : DEFAULT_TURN_WINDOW_MS;

  const state = sessionState.get(sessionId) ?? { callTimes: [] };
  const cutoff = now - windowMs;
  state.callTimes = state.callTimes.filter((t) => t > cutoff);

  if (state.callTimes.length >= limit) {
    sessionState.set(sessionId, state);
    return {
      allowed: false,
      reason: `maxToolCallsPerTurn (${limit}) exceeded within the last ${windowMs}ms for this session`,
    };
  }
  state.callTimes.push(now);
  sessionState.set(sessionId, state);
  return { allowed: true };
}

export interface AuditLogEntry {
  timestamp: string;
  sessionId: string;
  toolName: string;
  allowed: boolean;
  reason?: string;
}

let auditLogPathOverride: string | null = null;

/** Test-only: redirect the audit log to a temp file instead of the default path. */
export function setAuditLogPathForTesting(p: string | null): void {
  auditLogPathOverride = p;
}

function defaultAuditLogPath(): string {
  return path.join(os.tmpdir(), 'ruflo-mcp-audit.jsonl');
}

export function getAuditLogPath(): string {
  return auditLogPathOverride ?? defaultAuditLogPath();
}

/**
 * Appends one JSONL audit record. Returns `true` if `policy.auditLog` is not
 * set (nothing was required) or the write succeeded; `false` only when
 * `auditLog` is required and the write itself failed (disk full, unwritable
 * path, etc). Never throws — the caller (`evaluateToolCall`) decides what a
 * failed *mandatory* write means for the call (fail-closed: deny it).
 */
export function appendAuditLog(policy: McpPolicy, entry: AuditLogEntry): boolean {
  if (!policy.auditLog) return true;
  try {
    fs.appendFileSync(getAuditLogPath(), `${JSON.stringify(entry)}\n`, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Single enforcement entry point for a `tools/call` dispatch. Combines, in
 * order: fail-closed on a missing/malformed policy, the per-session call
 * budget, and fail-closed on a failed mandatory audit-log write. `policy`
 * is the result of `loadMcpPolicy()` — pass `null` straight through when it
 * failed to load, rather than re-deciding that here.
 */
export function evaluateToolCall(
  policy: McpPolicy | null,
  sessionId: string,
  toolName: string,
  now: number = Date.now(),
): PolicyCheckResult {
  if (policy === null) {
    return {
      allowed: false,
      reason: 'RUFLO_MCP_ENFORCE_POLICY is set but .harness/mcp-policy.json is missing or invalid — failing closed',
    };
  }

  const budget = checkAndRecordCall(policy, sessionId, now);
  const auditOk = appendAuditLog(policy, {
    timestamp: new Date(now).toISOString(),
    sessionId,
    toolName,
    allowed: budget.allowed,
    reason: budget.reason,
  });

  if (!budget.allowed) return budget;
  if (!auditOk) {
    return {
      allowed: false,
      reason: 'audit log write failed and policy.auditLog is required — failing closed',
    };
  }
  return { allowed: true };
}
