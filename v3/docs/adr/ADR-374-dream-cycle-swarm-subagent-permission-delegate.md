# ADR-374 — SubagentPermissionDelegate: Workspace-Scoped Privilege Delegation for Swarm Agents

**Status:** Proposed  
**Authors:** claude (dream-cycle agent, 2026-07-24)  
**Related:** Dream Cycle 2026-07-24, arXiv 2606.31174 (ClawArena-Team)

---

## Context

The ClawArena-Team benchmark (arXiv 2606.31174, 2026) evaluated 41 subagent orchestration scenarios across 258 rounds and found:

- No tested LLM model exceeded 50% workspace-permission precision when acting as team lead
- The primary management bottleneck for LLM-orchestrated swarms is **privilege granting**, not perception or reasoning
- API cost and management quality are decoupled — 100× cost span yields <4× quality span

Ruflo's current `swarm init` spawns subagents with no formal permission delegation protocol. Each agent inherits the full capability set of the invoking session. This is equivalent to running all swarm workers as root — it violates least-privilege, makes audit trails impossible, and is the exact failure mode ClawArena-Team identifies as the bottleneck.

---

## Decision

Add a **SubagentPermissionDelegate** protocol to `swarm init` that:

1. Assigns each spawned agent a **workspace-scoped capability token** derived from the swarm topology and the agent's declared role
2. Enforces the token at the hook layer (`pre-task`, `pre-edit`) before any file system or MCP tool access
3. Generates an audit trail of permission grants/denials per swarm run in `.swarm/permission-audit.jsonl`

### Token Shape (minimal)

```typescript
interface SubagentCapabilityToken {
  agentId: string;
  swarmId: string;
  role: AgentRole;              // 'coder' | 'reviewer' | 'tester' | ...
  allowedPaths: string[];       // glob patterns, e.g. ['src/**', 'tests/**']
  allowedTools: string[];       // e.g. ['Read', 'Edit', 'Bash']
  denyTools: string[];          // e.g. ['git push', 'npm publish']
  expiresAt: number;            // epoch ms
}
```

### Integration Points

- `swarm init --with-permissions` flag enables the protocol (opt-in initially)
- `@claude-flow/security`'s `InputValidator` validates token at hook boundaries
- `@claude-flow/hooks` `pre-task` hook enforces allowedTools check
- Default role-to-permission maps ship in `config/swarm-permission-defaults.json`

---

## Consequences

**Positive:**
- Closes the #1 ClawArena-Team bottleneck for Ruflo swarms
- Enables auditable, reproducible swarm runs
- Path to >50% workspace-permission precision on ClawArena-style eval

**Negative:**
- Adds configuration overhead for swarm setup
- Default permission maps will be wrong for some workflows; users must tune
- Breaking change if `--with-permissions` becomes default in a future minor release

**Neutral:**
- Scope: this is a protocol + hook integration; no changes to existing agent types or MCP tools
- Does NOT require consensus changes (raft stays unchanged)

---

## Alternatives Considered

1. **Full sandbox isolation per agent** (Docker/E2B per agent): Too expensive (~200-500ms setup per agent, disk cost); ruled out for standard swarms. Reserved for `isolation: 'worktree'` mode already implemented.
2. **No change**: Status quo permits swarms to work but leaves ClawArena-level precision gap unaddressed.

---

## Implementation Notes

- `no ADR` classification does NOT apply: this is an architectural protocol change, not a parameter tweak
- First milestone: permission-audit.jsonl with read-only enforcement (allowedPaths)
- Second milestone: tool-level enforcement (allowedTools/denyTools)
- Benchmark target: measure against ClawArena-Team criteria after implementation
