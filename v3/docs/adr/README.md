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
| [ADR-046](../../implementation/adrs/ADR-046-ruflo-rebrand.md) | Dual Umbrella: claude-flow + ruflo | Accepted |
| [ADR-047](../../implementation/adrs/ADR-047-fast-mode-integration.md) | Fast Mode Integration | Proposed |
| [ADR-178](ADR-178-dream-cycle-security-vmg-repe-ipi.md) | Verifiable Memory Governance and RepE IPI Detection | Proposed |
| [ADR-301](ADR-301-promotional-status-surface.md) | Promotional Status Surface for CLI Runtime | Proposed |
| [ADR-302](ADR-302-post-init-capability-enrollment.md) | Post-Initialization Capability Enrollment | Proposed |
| [ADR-303](ADR-303-credit-exhaustion-experience.md) | Intelligent Credit Exhaustion Experience | Proposed |
| [ADR-304](ADR-304-local-meta-llm-proxy.md) | Local Meta LLM Proxy Product | Proposed |
| [ADR-305](ADR-305-customer-lifecycle-funnel.md) | Customer Lifecycle Funnel (RuFlo → Cognitum) | Proposed |
| [ADR-306](ADR-306-cognitum-authentication-account-linking.md) | Cognitum Authentication and Account Linking | Proposed |
| [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md) | Proxy Runtime, Packaging, and Service Lifecycle | Proposed |
| [ADR-308](ADR-308-cognitum-public-api-contract.md) | Cognitum Public API and Server Contract | Proposed |
| [ADR-309](ADR-309-funnel-governance-privacy-ecosystem.md) | Funnel Governance, Privacy, and Ecosystem Policy | Proposed |
| [ADR-310](ADR-310-funnel-rollout-measurement-emergency-controls.md) | Funnel Rollout, Measurement, and Emergency Controls | Proposed |
| [ADR-320](ADR-320-mcp-composition-inspector-channel-guardrails.md) | MCP Tool Composition Inspector + Inter-Agent Channel Guardrails | Accepted |
| [ADR-323](ADR-323-typed-memory-provenance.md) | Typed Memory Provenance in AgentDB (MemIR-style claim typing, corrects #2804's dream-cycle proposal) | Accepted |
| [ADR-324](ADR-324-agentic-policy-engine-codex-swarm.md) | Agentic Policy Engine and Policy-Governed Codex Swarms | Accepted |
| [ADR-325](ADR-325-claim-federation-zero-trust-capability-plane.md) | Claim Federation as a Zero-Trust Capability and Work-Ownership Plane | Proposed |
| [ADR-326](ADR-326-cognitum-product-plane-claim-federation.md) | Cognitum Product-Plane Claim Federation Profile | Proposed |
| [ADR-327](ADR-327-federated-concurrent-development-harness.md) | Federated Concurrent Development Harness | Proposed |
| [ADR-328](ADR-328-cognitum-assisted-agent-learning.md) | Cognitum-Assisted Agent Learning Capability Plane | Proposed |
| [ADR-329](ADR-329-ruflo-capability-brain-mcp-guidance.md) | Ruflo Capability Brain for MCP Guidance | Accepted |
| [ADR-330](ADR-330-adaptive-pheromone-swarm-consensus.md) | Adaptive Pheromone Swarm Consensus | Accepted |
| [ADR-331](ADR-331-dream-cycle-memory-entity-context-graph.md) | AgentDB Entity-Context Graph for Zero-Mem-Style Retrieval | Proposed |
| [ADR-332](ADR-332-dream-cycle-intelligence-manta-topology.md) | MANTA In-Inference Topology Self-Evolution | Proposed |
| [ADR-333](ADR-333-dream-cycle-security-adaptive-trust-scoring.md) | Adaptive Trust Scoring for Agent Memory Persistence | Proposed |
| [ADR-334](ADR-334-dream-cycle-swarm-swarmchannel-latent-comm.md) | SwarmChannel Latent Communication Protocol | Proposed |
| [ADR-335](ADR-335-dream-cycle-intelligence-envace-world-rehearsal.md) | SONA Pre-Execution World Rehearsal (EnvACE-Style Buffer) | Proposed |
| [ADR-336](ADR-336-dream-cycle-memory-scrubber-temporal-decay.md) | ScrubJay Temporal Decay for AgentDB Memory Perishability | Proposed |
| [ADR-337](ADR-337-dream-cycle-swarm-pso-topology-autogeneration.md) | Task-Driven Swarm Topology Auto-Generation via PSO | Proposed |
| [ADR-338](ADR-338-dream-cycle-performance-mixture-of-agents.md) | Mixture-of-Agents Test-Time Scaling | Proposed |
| [ADR-339](ADR-339-dream-cycle-security-constitutional-ai.md) | Constitutional AI Safety Layer | Proposed |
| [ADR-340](ADR-340-dream-cycle-intelligence-tool-routing.md) | Intelligent Tool Routing | Proposed |
| [ADR-341](ADR-341-dream-cycle-memory-dual-process-retrieval.md) | Dual-Process Memory Retrieval | Proposed |
| [ADR-342](ADR-342-dream-cycle-swarm-dynamic-agent-pruning.md) | Dynamic Agent Pruning and Role Consolidation | Proposed |
| [ADR-343](ADR-343-dream-cycle-performance-context-compression.md) | Context Compression and Token Budget Management | Proposed |
| [ADR-344](ADR-344-dream-cycle-security-adversarial-testing.md) | Adversarial Red-Team Testing Framework | Proposed |
| [ADR-345](ADR-345-dream-cycle-intelligence-multi-modal-reasoning.md) | Multi-Modal Reasoning Integration | Proposed |
| [ADR-346](ADR-346-dream-cycle-memory-episodic-working-memory.md) | Episodic Working Memory Architecture | Proposed |
| [ADR-347](ADR-347-dream-cycle-swarm-emergent-role-discovery.md) | Emergent Role Discovery in Swarms | Proposed |
| [ADR-348](ADR-348-dream-cycle-performance-topology-selector.md) | Automatic Topology Selector for Swarm Init | Proposed |
| [ADR-349](ADR-349-dream-cycle-security-sandboxed-tool-execution.md) | Sandboxed Tool Execution for Agent Security | Proposed |
| [ADR-350](ADR-350-dream-cycle-intelligence-chain-of-thought-distillation.md) | Chain-of-Thought Distillation for Agent Learning | Proposed |
| [ADR-351](ADR-351-dream-cycle-memory-semantic-chunking.md) | Semantic Chunking for Long-Context Memory | Proposed |
| [ADR-352](ADR-352-dream-cycle-swarm-consensus-voting.md) | Multi-Agent Consensus Voting Protocol | Proposed |
| [ADR-353](ADR-353-dream-cycle-performance-batch-inference.md) | Batch Inference Optimization for Agent Swarms | Proposed |
| [ADR-354](ADR-354-dream-cycle-security-role-based-access.md) | Role-Based Access Control for Agent Capabilities | Proposed |
| [ADR-355](ADR-355-dream-cycle-intelligence-meta-learning.md) | Meta-Learning for Rapid Task Adaptation | Proposed |
| [ADR-356](ADR-356-dream-cycle-memory-cross-session-persistence.md) | Cross-Session Memory Persistence | Proposed |
| [ADR-357](ADR-357-dream-cycle-swarm-fault-tolerant-coordination.md) | Fault-Tolerant Swarm Coordination | Proposed |
| [ADR-358](ADR-358-dream-cycle-performance-streaming-inference.md) | Streaming Inference for Real-Time Agent Responses | Proposed |
| [ADR-359](ADR-359-dream-cycle-security-output-sanitization.md) | Output Sanitization and Content Filtering | Proposed |
| [ADR-360](ADR-360-dream-cycle-intelligence-reasoning-trees.md) | Tree-of-Thought Reasoning for Complex Tasks | Proposed |
| [ADR-361](ADR-361-dream-cycle-memory-forgetting-curves.md) | Forgetting Curves for Adaptive Memory Retention | Proposed |
| [ADR-362](ADR-362-dream-cycle-swarm-load-balancing.md) | Dynamic Load Balancing in Agent Swarms | Proposed |
| [ADR-363](ADR-363-dream-cycle-performance-speculative-execution.md) | Speculative Execution for Agent Task Prediction | Proposed |
| [ADR-364](ADR-364-dream-cycle-security-audit-logging.md) | Comprehensive Audit Logging for Agent Actions | Proposed |
| [ADR-365](ADR-365-dream-cycle-intelligence-self-reflection.md) | Agent Self-Reflection and Metacognition | Proposed |
| [ADR-366](ADR-366-dream-cycle-memory-retrieval-augmented.md) | Retrieval-Augmented Memory for Agent Context | Proposed |
| [ADR-367](ADR-367-dream-cycle-swarm-emergent-communication.md) | Emergent Communication Protocols in Swarms | Proposed |
| [ADR-368](ADR-368-dream-cycle-performance-quantization.md) | Model Quantization for Efficient Agent Inference | Proposed |
| [ADR-369](ADR-369-dream-cycle-security-prompt-hardening.md) | Prompt Hardening Against Injection Attacks | Proposed |
| [ADR-370](ADR-370-dream-cycle-intelligence-curriculum-learning.md) | Curriculum Learning for Progressive Agent Training | Proposed |
| [ADR-371](ADR-371-dream-cycle-memory-hierarchical-indexing.md) | Hierarchical Indexing for Scalable Memory Search | Proposed |
| [ADR-372](ADR-372-dream-cycle-swarm-negotiation-protocols.md) | Agent Negotiation Protocols for Resource Allocation | Proposed |
| [ADR-373](ADR-373-dream-cycle-performance-caching-strategies.md) | Multi-Level Caching Strategies for Agent Systems | Proposed |
| [ADR-374](ADR-374-dream-cycle-security-zero-trust-agents.md) | Zero-Trust Architecture for Multi-Agent Systems | Proposed |
| [ADR-375](ADR-375-dream-cycle-performance-agentperf-benchmark-mixture-of-agents.md) | Agentic Inference Benchmarking Standard + Mixture-of-Agents Test-Time Scaling | Proposed |
| [ADR-376](ADR-376-dream-cycle-intelligence-heterogeneous-ensemble-api.md) | Heterogeneous Agent Ensemble Composition API | Proposed |
| [ADR-377](ADR-377-agentdb-retrieval-security.md) | AgentDB Retrieval Security Layer | Proposed |
| [ADR-378](ADR-378-npm-trusted-publishing-cicd.md) | npm Trusted Publishing for CI/CD Release Automation | Proposed |
| [ADR-379](ADR-379-statusline-optional-usage-segments.md) | Optional Context/Session/Week Usage Segments and Extra Statusline Lines | Proposed |
| [ADR-380](ADR-380-agntcy-outshift-runtime-integration.md) | AGNTCY/Outshift Runtime Integration: SLIM Transport, CASA Enforcement, IOC Coordination Events | Proposed |
| [ADR-381](ADR-381-dream-cycle-performance-cross-agent-kv-cache-sharing.md) | Cross-Agent KV Cache Sharing for Swarm Prefill Performance | Proposed |

## Summary Documents

- [ADR Status Summary](../../implementation/adrs/ADR-STATUS-SUMMARY.md) - Implementation status overview
- [V3 ADRs Master](../../implementation/adrs/v3-adrs.md) - Complete ADR document
- [Full README](../../implementation/adrs/README.md) - Detailed index with roadmap

## Performance Targets

> Source of truth: [`docs/reviews/intelligence-system-audit-2026-05-29.md`](../../docs/reviews/intelligence-system-audit-2026-05-29.md) + [`scripts/benchmark-intelligence.mjs`](../../scripts/benchmark-intelligence.mjs). Numbers below are measured unless marked "target/unverified".

| Metric | Measured / Target | Status |
|--------|-------------------|--------|
| HNSW Search | ~1.9x at N=20k, ~3.2x–4.7x at N=5k vs brute force (recall@10 ~0.99) | **Measured** |
| Int8 Quantization | 3.84x compression, reconstruction cosine 0.99999 | **Measured** |
| RaBitQ Quantization | 32x compression, 0.60ms/query | **Measured** |
| SONA Adaptation | 0.0043ms/adapt (target <0.05ms met) | **Measured** |
| MCP Response | <100ms | target |
| CLI Startup | <500ms | target |
| Flash Attention | integration available; measured speedup pending benchmark | **Not measured** |

---

**Last Updated:** 2026-08-10
**CLI Version:** @claude-flow/cli@3.7.x
