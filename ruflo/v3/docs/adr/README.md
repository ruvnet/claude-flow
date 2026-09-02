# Claude Flow V3 - Architecture Decision Records

All ADRs are located in [`/v3/implementation/adrs/`](../../implementation/adrs/).

## Quick Links

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](../../implementation/adrs/ADR-001-AGENT-IMPLEMENTATION.md) | Adopt agentic-flow as Core Foundation | Complete |
| [ADR-002](../../implementation/adrs/ADR-002-DDD-STRUCTURE.md) | Domain-Driven Design Structure | Complete |
| [ADR-003](../../implementation/adrs/ADR-003-CONSOLIDATION-COMPLETE.md) | Single Coordination Engine | Complete |
| [ADR-004](../../implementation/adrs/ADR-004-PLUGIN-ARCHITECTURE.md) | Plugin Architecture | Complete |
| [ADR-005](../../implementation/adrs/ADR-005-implementation-summary.md) | MCP-First API Design | Complete |
| [ADR-006](../../implementation/adrs/ADR-006-UNIFIED-MEMORY.md) | Unified Memory Service | Complete |
| [ADR-007](../../implementation/adrs/ADR-007-EVENT-SOURCING.md) | Event Sourcing | Complete |
| [ADR-008](../../implementation/adrs/ADR-008-VITEST.md) | Vitest Testing | Complete |
| [ADR-009](../../implementation/adrs/ADR-009-IMPLEMENTATION.md) | Hybrid Memory Backend | Complete |
| [ADR-010](../../implementation/adrs/ADR-010-NODE-ONLY.md) | Node.js Only | Complete |
| [ADR-011](../../implementation/adrs/ADR-011-llm-provider-system.md) | LLM Provider System | Complete |
| [ADR-012](../../implementation/adrs/ADR-012-mcp-security-features.md) | MCP Security Features | Complete |
| [ADR-013](../../implementation/adrs/ADR-013-core-security-module.md) | Core Security Module | Complete |
| [ADR-014](../../implementation/adrs/ADR-014-workers-system.md) | Workers System | Complete |
| [ADR-015](../../implementation/adrs/ADR-015-unified-plugin-system.md) | Unified Plugin System | Complete |
| [ADR-016](../../implementation/adrs/ADR-016-collaborative-issue-claims.md) | Collaborative Issue Claims | Complete |
| [ADR-017](../../implementation/adrs/ADR-017-ruvector-integration.md) | RuVector Integration | Complete |
| [ADR-018](../../implementation/adrs/ADR-018-claude-code-integration.md) | Claude Code Integration | Complete |
| [ADR-019](../../implementation/adrs/ADR-019-headless-runtime-package.md) | Headless Runtime Package | Complete |
| [ADR-020](../../implementation/adrs/ADR-020-headless-worker-integration.md) | Headless Worker Integration | Complete |

## Summary Documents

- [ADR Status Summary](../../implementation/adrs/ADR-STATUS-SUMMARY.md) - Implementation status overview
- [V3 ADRs Master](../../implementation/adrs/v3-adrs.md) - Complete ADR document
- [Full README](../../implementation/adrs/README.md) - Detailed index with roadmap

## Performance Targets

| Metric | Target | Status |
|--------|--------|--------|
| HNSW Search | 150x-12,500x faster | ✅ Achieved |
| Flash Attention | 2.49x-7.47x speedup | ✅ Achieved (alpha.102) |
| Memory Reduction | 50-75% | ✅ Achieved |
| MCP Response | <100ms | ✅ Achieved |
| CLI Startup | <500ms | ✅ Achieved |

## Neural Features (alpha.102+)

| Component | Status | Lines | Notes |
|-----------|--------|-------|-------|
| SONA Optimizer | ✅ Real | 841 | Pattern learning from trajectories |
| EWC++ Consolidation | ✅ Real | ~600 | Fisher matrix, prevents forgetting |
| MoE Router | ✅ Real | ~500 | 8 experts with gating network |
| Flash Attention | ✅ Real | ~500 | O(N) block attention |
| LoRA Adapter | ✅ Real | ~400 | 128x compression (rank=8) |
| Hyperbolic Embeddings | ✅ Real | - | Poincaré ball model |
| Int8 Quantization | ✅ Real | - | 3.92x memory savings |

## Security Status

| CVE | Severity | Status |
|-----|----------|--------|
| CVE-2 | Critical | ✅ Fixed |
| CVE-3 | Critical | ✅ Fixed |
| HIGH-1 | High | ✅ Fixed |
| HIGH-2 | High | ✅ Fixed |

**Security Score:** 10/10

---

**Last Updated:** 2026-01-14
**CLI Version:** @claude-flow/cli@3.0.0-alpha.104
