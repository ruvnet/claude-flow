/**
 * ADR-145 Part B — per-namespace write authorization for AgentDB.
 *
 * Threat model
 * ------------
 * Prior to this module, `AgentDBAdapter.store()` accepted any write to any
 * namespace with no authorization check — an agent (or a compromised-but-
 * loaded plugin acting through an agent) could write into a namespace it
 * has no business touching. This is the write-authorization precondition
 * ADR-321 (HMAC-sealed collaboration memory) assumes exists: a seal is only
 * meaningful if the sealing/write path is gated by a real grant, not just a
 * hardcoded namespace list.
 *
 * Scope (P1 — this task, tracked as #10)
 * ---------------------------------------
 * - A `NamespaceGrant` describes which namespaces an agent may write to
 *   (and optionally read from).
 * - `checkWrite` is a pure decision function — no I/O, no throwing. The
 *   caller (`AgentDBAdapter.store`) decides what to do with the decision
 *   based on `CLAUDE_FLOW_STRICT_MEMORY`.
 * - Backwards compatible: an `undefined` grant (the overwhelming majority
 *   of existing call sites, which predate this ADR) is always
 *   `legacy-permissive` — allowed, regardless of strict mode. Grants are
 *   opt-in in P1; the v4.0 strict-default flip (P5) is out of scope here.
 *
 * Non-goals (P1)
 * ---------------
 * - Read authorization enforcement (the `readNamespaces` field is captured
 *   in the type for forward-compatibility with a future phase, but nothing
 *   in this pass enforces it).
 * - Any persistence/lookup of grants by agent id — the grant is supplied by
 *   the caller (e.g. the `agent_spawn` MCP tool handler), not fetched here.
 *   `@claude-flow/memory` cannot import from `@claude-flow/cli`, so grant
 *   plumbing across that boundary is the caller's responsibility.
 *
 * Reference: ADR-145 Part B, ADR-321 (sealing precondition).
 */

/** A namespace-write authorization grant for a single agent. */
export interface NamespaceGrant {
  readonly agentId: string;
  readonly writeNamespaces: string[];
  readonly readNamespaces?: string[];
}

/** The outcome of a write-authorization check. Never throws — pure. */
export interface WriteDecision {
  readonly allowed: boolean;
  readonly reason?: 'not-in-write-grant' | 'legacy-permissive';
}

/**
 * Decide whether `grant` authorizes a write to `namespace`.
 *
 * Pure and strict-mode-independent: this function never consults
 * `CLAUDE_FLOW_STRICT_MEMORY`. The strict/warn-then-block gate lives in the
 * caller (`AgentDBAdapter.store`), matching the pattern already established
 * by ADR-144's `propagator.ts`.
 */
export function checkWrite(grant: NamespaceGrant | undefined, namespace: string): WriteDecision {
  if (grant === undefined) {
    return { allowed: true, reason: 'legacy-permissive' };
  }
  return grant.writeNamespaces.includes(namespace)
    ? { allowed: true }
    : { allowed: false, reason: 'not-in-write-grant' };
}

/**
 * Thrown by `AgentDBAdapter.store()` when `CLAUDE_FLOW_STRICT_MEMORY=true`
 * and the supplied grant does not authorize the write. Never thrown when
 * strict mode is off — a denied write is logged and persisted instead
 * (warn-then-block rollout, matching ADR-144/145's existing pattern).
 */
export class MemoryWriteDenied extends Error {
  constructor(
    public readonly namespace: string,
    public readonly agentId: string | undefined,
    public readonly reason: WriteDecision['reason'],
  ) {
    super(
      `Write to namespace "${namespace}" denied${agentId ? ` for agent "${agentId}"` : ''}: ${reason}`,
    );
    this.name = 'MemoryWriteDenied';
  }
}

/**
 * ADR-321 P3 — per-namespace configuration, decoupled from `NamespaceGrant`.
 *
 * `sealed` (ADR-321's HMAC-sealing opt-in) is a property of the NAMESPACE,
 * not of any one agent's grant: two agents with different `NamespaceGrant`s
 * both writing to `collaboration` must agree on whether it's sealed, so
 * this cannot live on the per-agent grant shape without risking exactly
 * that kind of disagreement. This registry is the "real" mechanism ADR-321
 * P3 asks for, replacing `AgentDBAdapter`'s earlier Set-based
 * `sealedNamespaces` config workaround.
 */
export interface NamespaceConfig {
  readonly sealed: boolean;
}

/** Reads and (for opt-in extension) mutates per-namespace configuration. */
export interface NamespaceRegistry {
  getNamespaceConfig(namespace: string): NamespaceConfig;
  setNamespaceConfig(namespace: string, config: Partial<NamespaceConfig>): void;
}

/**
 * Default in-process `NamespaceRegistry`. Namespaces not explicitly
 * configured fall back to `defaultSealedNamespaces` (P1 scope:
 * `collaboration` only) so existing behavior is unchanged out of the box.
 */
export class InProcessNamespaceRegistry implements NamespaceRegistry {
  private readonly configs = new Map<string, NamespaceConfig>();
  private readonly defaultSealedNamespaces: ReadonlySet<string>;

  constructor(defaultSealedNamespaces: readonly string[] = ['collaboration']) {
    this.defaultSealedNamespaces = new Set(defaultSealedNamespaces);
  }

  getNamespaceConfig(namespace: string): NamespaceConfig {
    const explicit = this.configs.get(namespace);
    if (explicit) return explicit;
    return { sealed: this.defaultSealedNamespaces.has(namespace) };
  }

  setNamespaceConfig(namespace: string, config: Partial<NamespaceConfig>): void {
    const current = this.getNamespaceConfig(namespace);
    this.configs.set(namespace, { ...current, ...config });
  }
}
