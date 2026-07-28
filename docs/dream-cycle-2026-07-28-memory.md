# Memory SOTA Report — 2026-07-28

**TL;DR:** MemIR-style typed memory with provenance separation outperforms flat retrieval on LoCoMo and BEAM-100K; Ruflo's AgentDB stores flat text embeddings with no claim-typing, exposing it to provenance-role collapse in multi-agent shared namespaces — a distinct gap from last week's consolidation-strategy finding.

## What's New in 2026

| Finding | Source | Confidence |
|---------|--------|------------|
| **Provenance-Role Collapse**: flat memory causes source-monitoring errors when multiple agents share a namespace | arXiv 2605.25869 (MemIR, May 2026) | A |
| **MemIR Typed Representation**: 3-layer architecture (raw evidence → retrieval cues → factual claims) with provenance-scoped utilization consistently beats all baselines on LoCoMo + BEAM-100K | arXiv 2605.25869 | A |
| **Mem0 April 2026 Algorithm**: hybrid triple-scorer (semantic similarity + BM25 + entity matching) reaches LoCoMo 92.5 / LongMemEval 94.4 / BEAM-1M 64.1 — 3.74× token efficiency vs 2025 baseline | mem0.ai state-of-agent-memory-2026 (Apr 2026) | B |
| **H-MEM EACL 2026**: 4-level hierarchy (Domain → Category → Trace → Episode) with index-based routing avoids exhaustive HNSW scans; consistently outperforms MemoryBank across all 5 LoCoMo QA tasks | arXiv 2507.22925 / EACL 2026 | A |
| **Always-On Agents AOEP-v0**: survey of 435 works shows literature concentrates on accumulation/retrieval; governance, recovery, and forgetting are under-researched; introduces AOEP-v0 scoring protocol | arXiv 2606.30306 (Jun 2026) | A |
| **MemSyco-Bench**: retrieved memories induce sycophancy — agents over-align with user-stated facts at cost of factual accuracy across 5 task types including conflict resolution and memory-scope respect | arXiv 2607.01071 (Jul 2026) | A |

## Ruflo Current Capability

| Area | Current State | Gap |
|------|--------------|-----|
| Storage format | Flat text + 384-dim ONNX embedding (all-MiniLM-L6-v2) in AgentDB sql.js | No provenance typing (raw evidence vs user claim vs agent output not separated) |
| Retrieval | HNSW with measured ~1.9× speedup at N=20k (ruvector NAPI) | No index-based hierarchical routing (all entries are same-level) |
| Consolidation | EWC++ prevents forgetting; `consolidate` background worker | No governance lifecycle (no AOEP-v0-equivalent: no auditing, rollback, forgetting API) |
| Sycophancy guard | None | MemSyco-Bench tasks (conflict resolution, scope respect) not tested |
| Token efficiency | Flat retrieval pulls full entries | No triple-scorer hybrid (semantic+BM25+entity) like Mem0 April 2026 |
| Memory bus | Shared namespaces (collaboration, patterns, tasks) | Namespace writes from different agents intermix without claim provenance |

## Competitor Comparison

| Framework | Memory Architecture | Typed Provenance? | Sycophancy Guard? | Token Efficiency |
|-----------|--------------------|--------------------|-------------------|-----------------|
| **LangGraph** | Graph state checkpoint + time-travel; flat message history in retriever | No | No | High (state diff only) |
| **AutoGen** | Flat conversation history + external vector stores | No | No | Low (full history by default) |
| **CrewAI** | Entity / short-term / long-term structural tiers (built-in) | Structural (tier) only, no claim-level provenance | No | Medium |
| **OpenAI Agents SDK** | Stateless by default; context window only | No | No | Highest (no persistence overhead) |
| **Mem0** | Hybrid triple-scorer (semantic+BM25+entity); 21 framework integrations | No (flat facts) | No | 3.74× over 2025 baseline |
| **Ruflo AgentDB** | HNSW + sql.js + EWC++ + SONA; 5 namespaces | **No** | **No** | Moderate (full entry retrieval) |

## Benchmarks

| Benchmark | System | Score | Grade |
|-----------|--------|-------|-------|
| LoCoMo (5 tasks) | Mem0 April 2026 | 92.5 | **A** (mem0.ai, Apr 2026) |
| LongMemEval | Mem0 April 2026 | 94.4 | **A** |
| BEAM-1M tokens | Mem0 April 2026 | 64.1 | **A** |
| BEAM-10M tokens | Mem0 April 2026 | 48.6 | **A** |
| LoCoMo (all 5 task types) | H-MEM vs MemoryBank | Consistently superior | **A** (EACL 2026) |
| MemIR vs baselines | MemIR on LoCoMo + BEAM-100K | Consistently outperforms all baselines | **A** (arXiv 2605.25869) |
| Temporal reasoning improvement | Mem0 Apr vs 2025 | +29.6 pts | **A** |
| Multi-hop reasoning improvement | Mem0 Apr vs 2025 | +23.1 pts | **A** |
| Ruflo HNSW speedup at N=20k | ruvector NAPI | ~1.9× vs brute force | **A** (in-tree benchmark) |

> **No 2026 head-to-head benchmark between MemIR/H-MEM and Ruflo AgentDB exists.** The Ruflo gap is inferred from architectural analysis.

## SOTA Proof & Witness

*(To be filled after gist publish — see Witness section below)*

- **Session commit:** a158418a8b774f678dd36831be4ad1d5619b3395
- **Report SHA-256:** 43158830adbafd7b1a8e755ac8a1c68b2bdf3b700536ea2ba16e833cb82e8296
- **Witness stamp:** 098f7d45fb76dcb4388818c5d1678d2d14ad546457613fc87b9e139df52b14c0

To verify: `sha256sum <raw-gist-file>` → concat with session commit → `sha256sum` → must equal witness stamp.

## Scan Findings — plugins

**Signal:** GitHub's "Continuous AI" technical preview (Feb 2026) introduces declarative workflow logic in plain Markdown with AI handling routing decisions — a direct parallel to Ruflo's hooks/automation system. CrewAI Flows added event-driven mode; Microsoft Agent Framework ships with A2A + MCP built in.

**Gap:** Ruflo's 21 plugins write to memory namespaces as flat text without typed provenance. A `@claude-flow/plugin-code-intelligence` storing a code analysis result is indistinguishable at retrieval time from a user-stated claim about the same code. Plugin-emitted memories need claim-type metadata.

## Scan Findings — automation

**Signal:** Self-healing CI/CD is the most mature agentic automation capability in production mid-2026 (Zylos Research, May 2026). MCP-wired orchestrators receive alert webhooks, dispatch specialist agents (diagnosis → remediation → verification → learning), and auto-close incidents. CrewAI Flows event-driven mode enables declarative trigger/response chains.

**Gap:** Ruflo's `self-healing` hook pattern and 12 background workers handle post-task learning but lack webhook-triggerable incident response chains comparable to Kubernetes-level MCP-wired remediation. The `audit` worker (critical priority) runs on schedule, not on alert signal.

## Competitors Reviewed

| Competitor | Memory Angle | Plugin/Automation Angle |
|------------|-------------|------------------------|
| LangGraph | Checkpoint + time-travel; flat vector retrieval | Event-based workflows via LangGraph Platform |
| AutoGen | External vector store only | Pluggable tools; no typed registry |
| CrewAI | Entity/short/long-term tiers | Event-driven Flows; A2A support added |
| OpenAI Agents SDK | Context-only; no persistence | Native tool-calling, stateless |

## Recommended Next Steps

1. **Implement MemIR-style claim typing in AgentDB** (ADR-322): Add `provenance_type` field to the `vector_indexes` table (values: `user_claim`, `agent_output`, `system_observation`, `tool_result`). Update `memory store` CLI and MCP tools to accept and enforce the field. Filter by provenance at retrieval time to prevent cross-type sycophancy.

2. **Add plugin-emitted memory provenance**: Require all official plugins to pass a `source_plugin` and `trust_level` metadata field when writing to shared namespaces. Update the plugin SDK contract and add a lint gate in the `pre-edit` hook to catch flat writes in plugin code.

3. **Wire the `audit` worker to an alert signal**: Add a webhook endpoint (or MCP tool `trigger_audit`) that fires the `audit` background worker on-demand when a CI failure or security alert is received, matching the self-healing MCP-orchestrator pattern seen in production mid-2026.
