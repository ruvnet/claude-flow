# Project Memory — Ruflo (claude-flow)

## Architecture
- **Monorepo**: CLI + MCP server + plugins in one package
- **Stack**: TypeScript, Vitest, Node.js
- **Package names**: `@claude-flow/cli`, `claude-flow`, `ruflo` (all same package)
- **Entry**: `src/index.ts` → compiled via `tsc`

## Key Patterns
- Domain-Driven Design with bounded contexts
- Event sourcing for state changes
- Hierarchical-mesh topology for swarm coordination
- AgentDB with HNSW indexing for vector search
- ONNX embeddings (all-MiniLM-L6-v2, 384 dims)

## Agent Roles (16 typed + custom)
- Core: coder, reviewer, tester, planner, researcher
- Specialized: security-architect, security-auditor, memory-specialist, performance-engineer
- Coordination: hierarchical-coordinator, mesh-coordinator, adaptive-coordinator
- GitHub: pr-manager, code-review-swarm, issue-tracker, release-manager

## MCP Tools
- 314 tools across memory, swarm, agents, hive-mind, hooks, workers, security, neural

## Testing
- Framework: Vitest
- Security tests: `v3/__tests__/security/`
- Integration tests: `tests/`
- Run: `npm test`
