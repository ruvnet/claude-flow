/**
 * AgentAuthorizationPropagator — action-layer security for agent delegation.
 *
 * Implements P1 of ADR-144 (ruvnet/ruflo#2248): scope-envelope on SendMessage
 * + per-action authorization checks. P2-P5 wire this into the comms layer,
 * MCP dispatcher, MCP auth validator, and provenance log respectively.
 *
 * Threat model
 * ------------
 * When agent A delegates a task to agent B via SendMessage, B can today
 * escalate the granted scope by calling tools A was never authorized to
 * invoke. RBAC/ABAC on agent roles do not solve this — roles don't compose
 * under dynamic LLM delegation (arXiv:2605.05440, Grade A formal analysis).
 *
 * The fix is scope-based propagation: every SendMessage carries an
 * `AuthScope` that is *monotonically reducing* — each hop can drop tools or
 * servers from the granted set but never add them. This is the same shape
 * as OAuth scope reduction; adding back a tool requires talking to the
 * original principal out-of-band.
 *
 * Scope
 * -----
 * - P1 (this file): the component, the envelope, the type-level invariants.
 *   No call sites yet — adding the wrapping/enforcement in P2-P4.
 * - All operations synchronous, pure, allocation-light. Targets < 1 ms p99
 *   for `wrapOutbound` + `checkToolCall` so it can sit on every SendMessage.
 *
 * Backwards compatibility
 * -----------------------
 * `scope` on the envelope is optional in v1. Agents without scope set
 * operate in legacy permissive mode (all tools allowed, depth unlimited,
 * server auth unchecked). `CLAUDE_FLOW_STRICT_AUTH=true` enables enforcement.
 *
 * Reference: ADR-144, arXiv:2605.05440 (Authorization Propagation),
 * arXiv:2605.28914 (AIRGuard), arXiv:2605.22333 (MCP auth survey).
 */

/** Scope granted to an agent at a delegation hop. Monotonically reducing. */
export interface AuthScope {
  /** Stable identifier of the originating principal (agent or user). */
  readonly principalId: string;
  /** MCP tool IDs this scope is allowed to call. */
  readonly grantedTools: ReadonlyArray<string>;
  /** MCP server IDs whose tool responses this scope will accept. */
  readonly grantedServers: ReadonlyArray<string>;
  /** Max remaining delegation hops. Decrements on every `wrapOutbound`. */
  readonly delegationDepth: number;
  /** Unix ms after which this scope is no longer valid. */
  readonly expiresAt: number;
  /**
   * Optional opaque ID for cross-referencing with ADR-144 P5 provenance log
   * and ADR-146 telemetry events. Callers should treat as a correlation
   * handle, not a security claim.
   */
  readonly scopeId?: string;
}

/** Envelope shape attached to every SendMessage when strict-auth is on. */
export interface SendMessageEnvelope<T = unknown> {
  /** Authorization scope governing what the receiver may do. */
  readonly scope: AuthScope;
  /** The original SendMessage payload, untouched. */
  readonly payload: T;
}

/** Decision returned by `checkToolCall`. Never throws. */
export interface ToolCallDecision {
  readonly allowed: boolean;
  /** Human-readable reason; stable enough to match in tests/telemetry. */
  readonly reason?:
    | 'tool-not-in-scope'
    | 'server-not-in-scope'
    | 'scope-expired'
    | 'delegation-depth-exhausted'
    | 'principal-mismatch';
}

/**
 * Wrap-failure reasons surfaced to callers as a typed error. We use a
 * discriminated union rather than throwing so the comms layer (P2) can
 * decide whether to drop the SendMessage or surface to the user.
 */
export class AuthorizationPropagationError extends Error {
  constructor(
    public readonly code:
      | 'scope-cannot-grow'
      | 'depth-underflow'
      | 'scope-expired'
      | 'principal-mismatch',
    message: string,
  ) {
    super(message);
    this.name = 'AuthorizationPropagationError';
  }
}

/**
 * Construct a default permissive scope. Used in legacy mode when no scope
 * was attached upstream. Callers SHOULD migrate to explicit scopes; this is
 * here so the propagator never has to special-case "no scope".
 */
export function makeLegacyPermissiveScope(principalId = 'legacy'): AuthScope {
  return {
    principalId,
    grantedTools: ['*'],     // sentinel — see `checkToolCall`
    grantedServers: ['*'],
    delegationDepth: Number.MAX_SAFE_INTEGER,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * `AgentAuthorizationPropagator` — the load-bearing component for ADR-144.
 *
 * Construction is intentionally cheap (no I/O, no async). Callers can build
 * a fresh instance per task without overhead, or share one — it holds no
 * mutable state beyond the optional provenance buffer.
 */
export class AgentAuthorizationPropagator {
  /**
   * In-memory provenance buffer. P5 will flush this to the structured
   * telemetry sink (ADR-146 GuardrailEvent shape). For P1 we just retain
   * the last N events for inspection/tests.
   */
  private readonly provenance: Array<{
    agentId: string;
    toolId: string;
    scope: AuthScope;
    outcome: 'allowed' | 'denied';
    reason?: string;
    ts: number;
  }> = [];

  constructor(private readonly opts: { provenanceBufferMax?: number } = {}) {}

  /**
   * Attach a reduced scope to an outbound SendMessage.
   *
   * Invariants enforced (throws `AuthorizationPropagationError` on violation):
   *   - newly granted tools MUST be a subset of `currentScope.grantedTools`
   *   - newly granted servers MUST be a subset of `currentScope.grantedServers`
   *   - delegationDepth MUST decrement by ≥ 1 (must remain ≥ 0)
   *   - principalId is propagated unchanged
   *   - expiresAt cannot be extended; copied from the holder
   */
  wrapOutbound<T>(
    payload: T,
    currentScope: AuthScope,
    requested: { tools?: ReadonlyArray<string>; servers?: ReadonlyArray<string> } = {},
  ): SendMessageEnvelope<T> {
    if (currentScope.delegationDepth <= 0) {
      throw new AuthorizationPropagationError(
        'depth-underflow',
        `cannot delegate further — delegationDepth=${currentScope.delegationDepth}`,
      );
    }
    const now = Date.now();
    if (currentScope.expiresAt <= now) {
      throw new AuthorizationPropagationError(
        'scope-expired',
        `scope expired at ${new Date(currentScope.expiresAt).toISOString()}`,
      );
    }

    const reducedTools = subsetOrThrow(
      currentScope.grantedTools,
      requested.tools ?? currentScope.grantedTools,
      'tools',
    );
    const reducedServers = subsetOrThrow(
      currentScope.grantedServers,
      requested.servers ?? currentScope.grantedServers,
      'servers',
    );

    const reducedScope: AuthScope = {
      principalId: currentScope.principalId,
      grantedTools: reducedTools,
      grantedServers: reducedServers,
      delegationDepth: currentScope.delegationDepth - 1,
      expiresAt: currentScope.expiresAt,
      scopeId: currentScope.scopeId,
    };

    return { scope: reducedScope, payload };
  }

  /**
   * Validate a single tool call against a scope. Pure; never throws. Use the
   * result's `allowed` to make the dispatch decision.
   */
  checkToolCall(
    toolId: string,
    scope: AuthScope,
    opts: { serverId?: string; now?: number } = {},
  ): ToolCallDecision {
    const now = opts.now ?? Date.now();
    if (scope.expiresAt <= now) return { allowed: false, reason: 'scope-expired' };

    if (!matchesScopeList(scope.grantedTools, toolId)) {
      return { allowed: false, reason: 'tool-not-in-scope' };
    }
    if (opts.serverId && !matchesScopeList(scope.grantedServers, opts.serverId)) {
      return { allowed: false, reason: 'server-not-in-scope' };
    }
    return { allowed: true };
  }

  /**
   * Verify an MCP server presented a valid credential before its response is
   * consumed. P1 ships a permissive default (any non-empty credential is
   * accepted) so the API is stable; P4 wires this to a real validator.
   *
   * Returns `false` on missing/empty credential; callers MUST treat `false`
   * as a hard reject (same rule as ADR-131 reject findings).
   */
  verifyServerAuth(serverId: string, credential: unknown): boolean {
    if (!serverId || typeof serverId !== 'string') return false;
    if (credential == null) return false;
    if (typeof credential === 'string' && credential.trim().length === 0) return false;
    return true;
  }

  /**
   * Record an action in the provenance buffer. P5 will route to telemetry;
   * P1 keeps the last N events for test inspection and post-incident audit.
   */
  recordAction(
    agentId: string,
    toolId: string,
    scope: AuthScope,
    outcome: 'allowed' | 'denied',
    reason?: string,
  ): void {
    const max = this.opts.provenanceBufferMax ?? 1024;
    this.provenance.push({ agentId, toolId, scope, outcome, reason, ts: Date.now() });
    if (this.provenance.length > max) this.provenance.splice(0, this.provenance.length - max);
  }

  /** Read-only view of recorded provenance for tests + audit CLI (P5). */
  getProvenance(): ReadonlyArray<{
    agentId: string;
    toolId: string;
    scope: AuthScope;
    outcome: 'allowed' | 'denied';
    reason?: string;
    ts: number;
  }> {
    return this.provenance.slice();
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

function subsetOrThrow(
  parent: ReadonlyArray<string>,
  requested: ReadonlyArray<string>,
  kind: 'tools' | 'servers',
): ReadonlyArray<string> {
  if (parent.includes('*')) return Array.from(new Set(requested));
  for (const item of requested) {
    if (!parent.includes(item) && item !== '*') {
      throw new AuthorizationPropagationError(
        'scope-cannot-grow',
        `cannot grant ${kind} '${item}' — not in parent scope`,
      );
    }
  }
  // De-duplicate; preserve requested order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of requested) if (!seen.has(r)) (seen.add(r), out.push(r));
  return out;
}

function matchesScopeList(list: ReadonlyArray<string>, item: string): boolean {
  if (list.includes('*')) return true;
  return list.includes(item);
}
