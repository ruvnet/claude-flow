# Architecture Decision Records (ADRs)

This directory contains the Architecture Decision Records for the Claude Flow V3 system.

## Table of Contents

| ADR | Title | Status |
|-----|-------|--------|
| [ADR-001](ADR-001-v3-architecture-foundation.md) | V3 Architecture Foundation: Domain-Driven Design with Bounded Contexts | Accepted |
| [ADR-002](ADR-002-memory-unification.md) | Unified Memory Service: AgentDB with HNSW Vector Search | Accepted |
| [ADR-003](ADR-003-security-overhaul.md) | Security Architecture Overhaul: CVE Remediation and Secure-by-Default | Accepted |
| [ADR-004](ADR-004-cli-modernization.md) | CLI Modernization: Interactive Prompts and Command Decomposition | Accepted |
| [ADR-005](ADR-005-mcp-optimization.md) | MCP Server Optimization: Connection Pooling and Load Balancing | Accepted |
| [ADR-006](ADR-006-unified-memory-service.md) | Unified Memory Service Implementation | Accepted |
| [ADR-007](ADR-007-hybrid-memory-backend.md) | Hybrid Memory Backend: SQLite + AgentDB | Accepted |
| [ADR-008](ADR-008-flash-attention-integration.md) | Flash Attention Integration | Proposed |
| [ADR-009](ADR-009-hybrid-memory-backend.md) | Hybrid Memory Backend: SQLite + AgentDB (v2) | Accepted |
| [ADR-010](ADR-010-queen-coordinator.md) | Queen-Led Hierarchical Coordination | Accepted |
| [ADR-011](ADR-011-byzantine-fault-tolerance.md) | Byzantine Fault Tolerance for Consensus | Accepted |
| [ADR-012](ADR-012-raft-consensus.md) | Raft Consensus for Leader-Based Coordination | Accepted |
| [ADR-013](ADR-013-gossip-protocol.md) | Gossip Protocol for Eventual Consistency | Accepted |
| [ADR-014](ADR-014-crdt-synchronization.md) | CRDT Synchronization for Conflict-Free Replication | Accepted |
| [ADR-015](ADR-015-quorum-management.md) | Dynamic Quorum Management | Accepted |
| [ADR-016](ADR-016-performance-benchmarking.md) | Comprehensive Performance Benchmarking Suite | Accepted |
| [ADR-017](ADR-017-security-hardening.md) | Advanced Security Hardening and CVE Remediation | Accepted |
| [ADR-018](ADR-018-sublinear-algorithms.md) | Sublinear Algorithm Integration | Accepted |
| [ADR-019](ADR-019-load-balancing.md) | Dynamic Load Balancing and Work Stealing | Accepted |
| [ADR-020](ADR-020-topology-optimization.md) | Dynamic Swarm Topology Reconfiguration | Accepted |
| [ADR-021](ADR-021-collective-intelligence.md) | Collective Intelligence Coordination | Accepted |
| [ADR-022](ADR-022-neural-training.md) | Neural Pattern Training with SONA | Accepted |
| [ADR-023](ADR-023-embeddings-package.md) | Embeddings Package with HNSW and Hyperbolic Support | Accepted |
| [ADR-024](ADR-024-plugin-system.md) | Plugin System Architecture | Accepted |
| [ADR-025](ADR-025-dual-mode-collaboration.md) | Dual-Mode Claude + Codex Collaboration | Accepted |
| [ADR-026](ADR-026-three-tier-model-routing.md) | 3-Tier Model Routing: Deterministic → Haiku → Sonnet/Opus | Accepted |
| [ADR-027](ADR-027-agent-teams-comms.md) | Agent Teams Communication System with SendMessage | Accepted |
| [ADR-028](ADR-028-claims-authorization.md) | Claims-Based Authorization System | Accepted |
| [ADR-029](ADR-029-deployment-management.md) | Deployment Management and Rollback | Accepted |
| [ADR-030](ADR-030-completions-system.md) | Shell Completions System | Accepted |
| [ADR-031](ADR-031-process-management.md) | Background Process Management | Accepted |
| [ADR-032](ADR-032-migration-v2-v3.md) | V2 to V3 Migration with Rollback Support | Accepted |
| [ADR-033](ADR-033-doctor-diagnostics.md) | System Diagnostics and Health Checks | Accepted |
| [ADR-034](ADR-034-headless-instances.md) | Headless Background Claude Instances | Accepted |
| [ADR-035](ADR-035-gateway-delegation.md) | Gateway-Delegated Development (meta-llm dev-bridge) | Accepted |
| [ADR-036](ADR-036-ipfs-plugin-registry.md) | IPFS Plugin Registry via Pinata | Accepted |
| [ADR-037](ADR-037-sona-neural-architecture.md) | SONA Self-Optimizing Neural Architecture | Accepted |
| [ADR-038](ADR-038-hive-mind-consensus.md) | Hive-Mind Byzantine Fault-Tolerant Consensus | Accepted |
| [ADR-039](ADR-039-ruv-swarm-hooks.md) | Ruv-Swarm Hooks System (17 Hooks + 12 Workers) | Accepted |
| [ADR-040](ADR-040-agentdb-memory-bridge.md) | AgentDB Memory Bridge for Claude Code | Accepted |
| [ADR-041](ADR-041-metaharness-integration.md) | MetaHarness Integration (ADR-150 reference) | Accepted |
| [ADR-042](ADR-042-ewc-forgetting-prevention.md) | Elastic Weight Consolidation for Catastrophic Forgetting Prevention | Accepted |
| [ADR-043](ADR-043-moe-routing.md) | Mixture of Experts Routing for Specialized Agent Selection | Accepted |
| [ADR-044](ADR-044-reasoningbank.md) | ReasoningBank Adaptive Learning with AgentDB | Accepted |
| [ADR-045](ADR-045-ruvector-hnsw.md) | RuVector HNSW: Measured ~1.9x–4.7x Search Speedup | Accepted |
| [ADR-046](ADR-046-quantization.md) | Int8 and RaBitQ Quantization for AgentDB | Accepted |
| [ADR-047](ADR-047-darwin-flywheel.md) | Darwin/Flywheel Evolutionary Optimization | Accepted |
| [ADR-048](ADR-048-ant-colony.md) | Ant Colony Optimization for Swarm Routing | Accepted |
| [ADR-049](ADR-049-redblue-adversarial.md) | Red/Blue Adversarial LLM Testing | Accepted |
| [ADR-050](ADR-050-gepa-learning.md) | GEPA Learning Run Integration | Accepted |
| [ADR-051](ADR-051-stream-chain.md) | Stream-JSON Chaining for Multi-Agent Pipelines | Accepted |
| [ADR-052](ADR-052-agentic-payments.md) | Agentic Payments Multi-Agent Authorization | Accepted |
| [ADR-053](ADR-053-codex-headless.md) | Codex Headless Worker Integration | Accepted |
| [ADR-054](ADR-054-mesh-topology.md) | Peer-to-Peer Mesh Network Topology | Accepted |
| [ADR-055](ADR-055-adaptive-topology.md) | Adaptive Topology Selection | Accepted |
| [ADR-056](ADR-056-collective-intelligence-v2.md) | Collective Intelligence v2: Scout-Explorer Pattern | Accepted |
| [ADR-057](ADR-057-worker-benchmarks.md) | Worker Benchmarking and Performance Analysis | Accepted |
| [ADR-058](ADR-058-worker-integration.md) | Worker-Agent Integration for Intelligent Task Dispatch | Accepted |
| [ADR-059](ADR-059-verification-quality.md) | Verification Quality: Truth Scoring and Rollback | Accepted |
| [ADR-060](ADR-060-tdd-london-school.md) | TDD London School with Mock-First Development | Accepted |
| [ADR-061](ADR-061-domain-driven-design.md) | Domain-Driven Design with Bounded Contexts | Accepted |
| [ADR-062](ADR-062-event-sourcing.md) | Event Sourcing for State Changes | Accepted |
| [ADR-063](ADR-063-input-validation.md) | Input Validation at System Boundaries | Accepted |
| [ADR-064](ADR-064-path-security.md) | Path Traversal Prevention | Accepted |
| [ADR-065](ADR-065-command-injection.md) | Command Injection Protection via SafeExecutor | Accepted |
| [ADR-066](ADR-066-bcrypt-hashing.md) | bcrypt Password Hashing | Accepted |
| [ADR-067](ADR-067-secure-token-generation.md) | Secure Token Generation | Accepted |
| [ADR-068](ADR-068-agent-booster.md) | Agent Booster: Fast-Apply Merge Engine | Accepted |
| [ADR-069](ADR-069-token-optimizer.md) | Token Optimizer: 30–50% Context Reduction | Accepted |
| [ADR-070](ADR-070-darwin-candidates.md) | Darwin Candidate Evaluation and Promotion | Accepted |
| [ADR-071](ADR-071-anti-drift-coding.md) | Anti-Drift Coding Swarm with Hierarchical Topology | Accepted |
| [ADR-072](ADR-072-named-agents.md) | Named Agent Addressability via SendMessage | Accepted |
| [ADR-073](ADR-073-pipeline-coordination.md) | Pipeline Coordination Pattern | Accepted |
| [ADR-074](ADR-074-fan-out-fan-in.md) | Fan-Out / Fan-In Coordination | Accepted |
| [ADR-075](ADR-075-supervisor-worker.md) | Supervisor / Worker Pattern | Accepted |
| [ADR-076](ADR-076-graceful-shutdown.md) | Graceful Agent Shutdown Protocol | Accepted |
| [ADR-077](ADR-077-context-compression.md) | Context Compression via ReasoningBank Retrieval | Accepted |
| [ADR-078](ADR-078-cache-strategy.md) | Prompt Cache Strategy (95% Hit Rate Target) | Accepted |
| [ADR-079](ADR-079-batch-size-optimization.md) | Optimal Batch Size for Token Reduction | Accepted |
| [ADR-080](ADR-080-adr-governance.md) | ADR Governance: Authorship, Review, and Promotion | Accepted |
| [ADR-081](ADR-081-version-lockstep.md) | Version Lockstep Across Public Packages | Accepted |
| [ADR-082](ADR-082-granular-npm-token.md) | Granular npm Access Token for CI Publishing | Accepted |
| [ADR-083](ADR-083-signing-key-handling.md) | Helpers Signing Key Secure Handling | Accepted |
| [ADR-084](ADR-084-concurrent-session-guard.md) | Concurrent Session Helper Corruption Guard | Accepted |
| [ADR-085](ADR-085-dream-cycle-protocol.md) | Dream Cycle Nightly Research Protocol | Accepted |
| [ADR-086](ADR-086-dream-cycle-gist-witness.md) | Dream Cycle Gist Witness Stamp | Accepted |
| [ADR-100](ADR-100-dream-cycle-swarm-pheromone.md) | Pheromone-Based Consensus for Swarm Coordination | Proposed |
| [ADR-130](ADR-130-dream-cycle-security-guardrail.md) | Tool-Output Guardrail for Indirect Prompt Injection | Proposed |
| [ADR-131](ADR-131-dream-cycle-security-guardrail-v2.md) | Tool-Output Guardrail v2 | Proposed |
| [ADR-143](ADR-143-tier1-codemod-scope.md) | Tier-1 Codemod Scope: Deterministic vs. LLM-Routed Transforms | Accepted |
| [ADR-144](ADR-144-dream-cycle-performance.md) | Performance Benchmarking Standard | Proposed |
| [ADR-145](ADR-145-skillgate.md) | SkillGate: Governed Skill Invocation | Proposed |
| [ADR-147](ADR-147-adaptive-topology.md) | Adaptive Topology Selection (v2) | Proposed |
| [ADR-148](ADR-148-metaharness-router.md) | MetaHarness Router Integration | Proposed |
| [ADR-149](ADR-149-metaharness-router-v2.md) | MetaHarness Router v2: Cost-Optimal Triple Gate | Proposed |
| [ADR-150](ADR-150-metaharness-integration-surfaces.md) | MetaHarness Integration Surfaces | Proposed |
| [ADR-151](ADR-151-dream-cycle-swarm.md) | Swarm Topology Gap: TPSC Pheromone Consensus | Proposed |
| [ADR-152](ADR-152-genome-similarity.md) | Genome Structural Similarity Distance | Proposed |
| [ADR-153](ADR-153-bench-suite.md) | Benchmark Suite for Evolve | Proposed |
| [ADR-166](ADR-166-agentdb-retrieval-poison-forensics.md) | AgentDB Retrieval Guard and Poison Forensics | Proposed |
| [ADR-235](ADR-235-gepa-learning-run.md) | GEPA Learning Run: metaharness@0.3.0 | Proposed |
| [ADR-236](ADR-236-ask-auto-tier.md) | metallm_ask Auto-Tier Routing | Proposed |
| [ADR-322](ADR-322-flywheel-protocol.md) | Flywheel: Evaluate Concurrently, Promote Explicitly | Proposed |
| [ADR-326](ADR-326-dream-cycle-memory.md) | AgentDB Retrieval Pipeline: Provenance and Role Attestation | Proposed |
| [ADR-327](ADR-327-dream-cycle-capabilities.md) | PoTRE Heterogeneous Ensemble Composition | Proposed |
| [ADR-330](ADR-330-tpsc-pheromone-consensus.md) | TPSC Pheromone-Based Consensus for Swarm Coordination | Proposed |
| [ADR-333](ADR-333-halluprop-pre-hoc-filtering.md) | HalluProp Pre-Hoc Hallucination Filtering | Proposed |
| [ADR-375](ADR-375-dream-cycle-performance-agentperf-benchmark-mixture-of-agents.md) | Agentic Inference Benchmarking Standard + Mixture-of-Agents Test-Time Scaling | Proposed |
| [ADR-376](ADR-376-dream-cycle-intelligence-heterogeneous-ensemble-api.md) | Heterogeneous Agent Ensemble Composition API | Proposed |
| [ADR-377](ADR-377-agentdb-retrieval-security.md) | AgentDB Retrieval Security Layer | Proposed |
| [ADR-378](ADR-378-npm-trusted-publishing-cicd.md) | npm Trusted Publishing for CI/CD Release Automation | Proposed |
| [ADR-379](ADR-379-statusline-optional-usage-segments.md) | Optional Context/Session/Week Usage Segments and Extra Statusline Lines | Proposed |
| [ADR-380](ADR-380-agntcy-outshift-runtime-integration.md) | AGNTCY/Outshift Runtime Integration: SLIM Transport, CASA Enforcement, IOC Coordination Events | Proposed |
| [ADR-381](ADR-381-dream-cycle-intelligence-manta-in-inference-topology-mutation.md) | MANTA-Style In-Inference Topology Mutation for adaptive-coordinator | Proposed |

## Summary Documents

- [ADR Status Summary](../../implementation/adrs/ADR-STATUS-SUMMARY.md) - Implementation status overview

## Security CVE Status

| CVE | Severity | Status |
|-----|----------|--------|
| CVE-1 | Critical | ✅ Fixed |
| CVE-2 | Critical | ✅ Fixed |
| CVE-3 | Critical | ✅ Fixed |
| HIGH-1 | High | ✅ Fixed |
| HIGH-2 | High | ✅ Fixed |

**Security Score:** 10/10

---

**Last Updated:** 2026-08-02
**CLI Version:** @claude-flow/cli@3.0.0-alpha.104
