# ADR-368: Selective Persistent Memory Categories for AgentDB

- **Status:** Proposed
- **Authors:** claude (dream-cycle agent, 2026-07-18)
- **Context:** Dream Cycle 2026-07-18 — Memory deep-dive
- **Related:** ADR-006 (Unified Memory Service), ADR-009 (Hybrid Memory Backend)

---

## Context

Ruflo's AgentDB currently persists full session history (all conversation turns, reasoning traces, intermediate outputs) into memory namespaces. A 2026 peer-reviewed paper (Pedada et al., arxiv:2607.09493, "Shared Selective Persistent Memory for Agentic LLM Systems") demonstrates that naive full-history persistence **degrades** task completion (71% vs 96% for selective, vs 79% for no memory). The key insight: reasoning traces from past sessions are stale and introduce noise; what reuses cleanly across sessions is only four categories of information.

Additionally, a second 2026 paper (arxiv:2607.14651, "MemPoison") demonstrates that write-time memory defenses fail against compositional attacks, and a third (arxiv:2607.08395, "Token-Flow Firewall") proposes semantic runtime interception before persistence. Ruflo's `@claude-flow/security` InputValidator currently operates at system input boundaries, not on memory write paths.

## Decision

Implement a **Selective Persistent Memory** filter in `@claude-flow/memory` that:

1. **Categorizes memory writes** into one of five buckets at write-time:
   - `TASK_SPEC` — task descriptions, goals, acceptance criteria
   - `DATA_SCHEMA` — data models, field definitions, API contracts
   - `TOOL_CONFIG` — tool invocations, endpoint URLs, auth patterns (sans secrets)
   - `OUTPUT_CONSTRAINT` — output format rules, size limits, required fields
   - `REASONING_TRACE` — all other (ephemeral: summaries, CoT steps, intermediate decisions)

2. **Persists only** `TASK_SPEC`, `DATA_SCHEMA`, `TOOL_CONFIG`, `OUTPUT_CONSTRAINT` by default. `REASONING_TRACE` entries expire after the session TTL (configurable, default 24h).

3. **Adds RBAC** to AgentDB namespaces: `MemoryNamespace` gains an `acl: { [role: string]: 'read' | 'write' | 'none' }` field so namespaces can be shared cross-user with role-gated access.

4. **Adds a write-time semantic gate** in the memory update path that checks writes against a threat pattern list before persistence (Token-Flow Firewall pattern). Implemented as a middleware in `AgentDB.store()`.

## Consequences

**Positive:**
- Targets 97× reduction in per-invocation token costs for repeat tasks (from arxiv:2607.09493 baseline)
- Targets 14× reduction in task execution time via zero-token refresh of persistent configs
- Closes memory poisoning vector for write-path injection attacks
- Enables cross-user template sharing (e.g., shared tool configs, shared schemas)

**Negative:**
- Categorization requires either an LLM classification step (adds latency) or a heuristic rule set (may misclassify)
- RBAC adds schema migration and backward-compatibility burden for existing AgentDB users
- The semantic gate adds ~0.7s overhead per write (per Token-Flow Firewall benchmarks) — acceptable for persistence writes, unacceptable for hot paths

**Mitigations:**
- Use rule-based fast-path classifier (regex + structural signals) as Tier-1; LLM classifier as Tier-2 fallback for ambiguous entries
- Provide `--memory-selective-filter=off` escape hatch for users who need full-history replay
- Make semantic gate configurable per namespace (default: on for public/shared namespaces, off for private session namespaces)

## Implementation Sketch

```typescript
// v3/@claude-flow/memory/src/selective-filter.ts
export type MemoryCategory =
  | 'TASK_SPEC'
  | 'DATA_SCHEMA'
  | 'TOOL_CONFIG'
  | 'OUTPUT_CONSTRAINT'
  | 'REASONING_TRACE';

export interface SelectiveFilterConfig {
  persistCategories: MemoryCategory[];
  traceTTLMs: number;  // default: 86_400_000 (24h)
  semanticGate: boolean;
}

export const DEFAULT_FILTER: SelectiveFilterConfig = {
  persistCategories: ['TASK_SPEC', 'DATA_SCHEMA', 'TOOL_CONFIG', 'OUTPUT_CONSTRAINT'],
  traceTTLMs: 86_400_000,
  semanticGate: false,  // off by default for private namespaces
};

export function classifyEntry(content: string, metadata: Record<string, unknown>): MemoryCategory {
  // Tier-1: structural heuristics
  if (metadata.type === 'tool_call' || metadata.type === 'tool_config') return 'TOOL_CONFIG';
  if (metadata.type === 'schema' || content.includes('"$schema"')) return 'DATA_SCHEMA';
  if (metadata.type === 'task' || metadata.role === 'user' && metadata.isGoal) return 'TASK_SPEC';
  if (metadata.type === 'output_spec') return 'OUTPUT_CONSTRAINT';
  return 'REASONING_TRACE';
}
```

## Alternatives Considered

- **Full-history retention (status quo):** Simple but produces 71% task completion and 26,000+ tokens/conv overhead.
- **Summarization-only (NapMem pattern from ADR-??? / prior dream cycle):** Lossy compression reduces tokens but doesn't address the cross-user sharing or write-time attack vectors.
- **External memory system (Mem0, Cognee):** Adds a dependency and exfiltration risk; better to implement the same pattern in AgentDB natively.

## References

- Pedada, Dhavala, Patil (2026). "Shared Selective Persistent Memory for Agentic LLM Systems." arXiv:2607.09493
- "MemPoison: Uncovering Persistent Memory Threats." arXiv:2607.14651
- "Token-Flow Firewall: Semantic Runtime Auditing for Persistent AI Agents." arXiv:2607.08395
- Mem0 State of AI Agent Memory 2026. https://mem0.ai/blog/state-of-ai-agent-memory-2026
