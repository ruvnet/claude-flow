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
 * Known scope limits (disclosed, not fixed here):
 *   - Despite the policy field's name, this enforces a *session-lifetime
 *     cumulative* cap, not a per-conversational-turn cap that resets — a
 *     long-lived stdio session can exhaust `maxToolCallsPerTurn` (200 in
 *     the shipped `.harness/mcp-policy.json`) under entirely legitimate
 *     use and stay locked out until the MCP server process restarts.
 *     Do not raise this above default-off without a real per-turn reset.
 *   - Only wired into the stdio `tools/call` dispatch
 *     (`MCPServerManager.handleMCPMessage`). The separate HTTP/websocket
 *     path (`startHttpServer()`, via `@claude-flow/mcp`) does not call
 *     this module and is unaffected even when this flag is set.
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
  maxToolCallsPerTurn?: number;
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

interface SessionState {
  callCount: number;
}

const sessionState = new Map<string, SessionState>();

/** Test-only: clear per-session call counters between test cases. */
export function resetPolicyEnforcerState(): void {
  sessionState.clear();
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Increments and checks the calling session's tool-call count against
 * `policy.maxToolCallsPerTurn`. Denies (without incrementing further) once
 * the session is already at or over the limit.
 */
export function checkAndRecordCall(policy: McpPolicy, sessionId: string): PolicyCheckResult {
  const limit = policy.maxToolCallsPerTurn;
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return { allowed: true };
  }
  const state = sessionState.get(sessionId) ?? { callCount: 0 };
  if (state.callCount >= limit) {
    sessionState.set(sessionId, state);
    return { allowed: false, reason: `maxToolCallsPerTurn (${limit}) exceeded for this session` };
  }
  state.callCount += 1;
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

/** Best-effort append; an audit-log write failure must never break tool dispatch. */
export function appendAuditLog(policy: McpPolicy, entry: AuditLogEntry): void {
  if (!policy.auditLog) return;
  try {
    fs.appendFileSync(getAuditLogPath(), `${JSON.stringify(entry)}\n`, 'utf-8');
  } catch {
    // Swallow: audit logging is best-effort and must not affect dispatch.
  }
}
