# ADR-163: Multi-Agent Performance Benchmarking Suite

- **Status:** Proposed
- **Date:** 2026-06-20
- **Authors:** claude (dream-cycle agent, 2026-06-20)
- **Dream Cycle:** SLOT=0, DEEP=performance

## Context

As of June 2026, all major competing frameworks publish a task-completion-rate benchmark:

| Framework | Task Completion | Cost/Task | Source |
|-----------|----------------|-----------|--------|
| LangGraph | 62% | $0.08 | Independent 2026 benchmark, 2,000 runs, Grade B |
| AutoGen | 58% | ~$0.10 est | Same source |
| CrewAI | 54% | ~$0.12 est | Same source |
| Ruflo | **Not published** | Not published | — |

Ruflo's CLAUDE.md documents performance *targets* (`<100ms MCP`, `<500ms CLI startup`) and internal micro-benchmarks (HNSW speedup, SONA adaptation time), but publishes no end-to-end multi-agent task completion rate, cost-per-task, or throughput-per-dollar figure comparable to what competitors report. This creates a marketing credibility gap and blocks data-driven tuning of the 3-tier routing thresholds.

Two 2026 papers further motivate action:
- **arXiv:2606.19920** (Deep-Unfolded Coordination): distributed task-assignment optimization 6.18–9.44× faster than conventional ADMM solvers — applicable to Ruflo swarm task decomposition.
- **arXiv:2606.18837** (Skill-MAS): Meta-Skill evolution transfers across unseen tasks and LLMs; Ruflo's ReasoningBank lacks multi-trajectory rollout.

## Decision

Implement a reproducible multi-agent performance benchmark suite in `scripts/benchmark-multiagent.mjs` (mirroring the existing `scripts/benchmark-intelligence.mjs` pattern), and publish results in CLAUDE.md under a new "Multi-Agent Benchmarks" table.

### Benchmark design

**5-task corpus** (same topology as the LangGraph/AutoGen/CrewAI 2026 independent benchmark):

| Task | Type | Success criterion |
|------|------|-----------------|
| T1: Code generation | Single-agent Tier-2 | Correct output, ≤2 retries |
| T2: Multi-file refactor | Hierarchical swarm (3 agents) | All target files modified, tests pass |
| T3: Research synthesis | Mesh swarm (4 agents) | ≥5 cited sources, coherent output |
| T4: Security audit | Specialized swarm (reviewer+auditor) | ≥3 findings categorized |
| T5: End-to-end feature | Full pipeline (architect→coder→tester→reviewer) | Feature works + tests green |

**Metrics per run:**
- Task completion (pass/fail)
- Wall-clock time (ms)
- Total token count (input + output)
- Estimated cost at standard API rates
- MCP round-trip latency distribution (p50/p95/p99)

**Run configuration:**
- 100 runs per task × 5 tasks = 500 total
- Model: claude-sonnet-4-6 (Tier-3) for all tasks to ensure fair comparison
- Topology: hierarchical (current default) for T2–T5
- Report: markdown table auto-appended to `scripts/benchmark-intelligence.mjs` output pattern

**Target:** ≥65% overall task completion rate (beating LangGraph's 62%).

### Secondary deliverable: deep-unfolded task decomposition (research spike)

In a follow-up PR, explore replacing the fixed round-robin task assignment in `swarm_init` with a lightweight 3-iteration unfolded ADMM solver for workload distribution across agents. No production change without benchmark evidence.

## Consequences

**Positive:**
- Closes the benchmark credibility gap vs LangGraph/AutoGen/CrewAI.
- Enables data-driven tuning of 3-tier routing thresholds (currently set by heuristic).
- Provides a regression baseline for future performance changes.
- Reveals whether Ruflo's ReasoningBank token savings (-32%) translate to fewer retries and higher completion rate.

**Negative:**
- 500-run benchmark at Tier-3 pricing (~$0.10–0.15/run) costs ~$50–75 per full run; must be gated to CI nightly, not per-PR.
- Benchmark task corpus is not identical to the 2026 independent benchmark (different model backend may have been used); comparisons remain Grade B.

**Neutral:**
- No architectural change to existing swarm or routing code; purely additive benchmarking infrastructure.

## References

- arXiv:2606.19920 — Deep-Unfolded Coordination (6.18–9.44× speedup)
- arXiv:2606.19758 — SIGMA skill-bundle agents (+2.06–2.36 pts)
- arXiv:2606.18837 — Skill-MAS Meta-Skill evolution
- Independent 2026 multi-agent benchmark: LangGraph 62%, AutoGen 58%, CrewAI 54%
- CLAUDE.md §V3 Performance Targets
- Dream Cycle issue: #ISSUE_NUM (2026-06-20, SLOT=0, DEEP=performance)
