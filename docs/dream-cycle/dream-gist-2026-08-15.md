# Performance SOTA Report — 2026-08-15

**TL;DR**: Ruflo's AgentDB-backed `HNSWIndex` (`v3/@claude-flow/memory/src/hnsw-index.ts`) defaults query-time candidate-pool size (`ef`) to the *build-time* `efConstruction` (200) whenever a caller omits `ef` — which is the path every production caller in `agentdb-adapter.ts` hits unless it opts in. Decoupling this into a dedicated, smaller `efSearch` default (50) cuts per-query latency ~56-58% (paired t≈-31, n=60, both N) but breaches a pre-declared recall@10≥0.90 invariant at N=8000 (0.8767). **Verdict: REJECT as specified** — real, statistically strong effect, real safety-invariant breach, evidence retained for a follow-up with a higher or scale-adaptive default.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| LangGraph checkpoint-serialization: 85% storage bloat / 37.8% token overhead, reproducible | GH langchain-ai/langgraph#7714 (May 2026) | A |
| Agent-benchmark protocol validity broadly questioned; "do-nothing" agents pass 38% of some benchmark tasks | arXiv:2407.01502, arXiv:2607.22368 (Jul 2026) | A |
| No vector DB (Qdrant/Milvus/Weaviate/LanceDB/Vespa) publishes a benchmark shaped like real agent-memory workload (small writes, read-after-write, recency bias) — all optimize bulk-ANN corpora instead | Synthesized from vendor benchmark pages, no counter-example found | — (structural gap, not a single-source claim) |
| Self-Anchored Consensus (SAC): decentralized filter-refine BFT alternative needing no leader/supermajority vote, graph-robustness conditions instead | arXiv:2605.09076 (May-Jun 2026) | B |
| CVE-2025-59536 (`.claude/settings.json` hook-injection RCE, CVSS 8.7) + CVE-2025-6514 (mcp-remote OAuth MITM, CVSS 9.6) not yet cited in Ruflo's security ADRs | NVD + 3 independent 2026 vendor analyses | A/B |

## Ruflo Current Capability

`agentdb-adapter.ts` (the primary AgentDB memory backend — binary `.hnsw` snapshot persistence, used by `consolidator.ts` and `agentdb-backend.ts`) wraps `HNSWIndex` and forwards `options.ef` only when a caller supplies it (`agentdb-adapter.ts:410`). No caller found in-repo currently supplies it, so effectively every AgentDB memory search runs with `ef≈efConstruction` (200) today. Separately, `v3/@claude-flow/cli/src/ruvector/vector-db.ts` wraps the *native* `ruvector` NAPI package — a different implementation entirely — and is the actual source of CLAUDE.md's cited "~1.9x-4.7x, recall@10 ~0.99" numbers via `scripts/benchmark-intelligence.mjs`. Tonight's candidate touches only the TypeScript `HNSWIndex` fallback/primary-persistence path, not the native ruvector path — this report does not claim to move the CLAUDE.md-cited number.

## Competitor Comparison

| Framework | Performance practice | Evidence | Grade | 2026 status |
|---|---|---|---|---|
| LangGraph | No official framework-isolated benchmark; real, reproducible checkpoint-serialization tax (85% storage, 37.8% tokens) | GH #7714 | A | Open, unresolved |
| AutoGen/AG2 | "2.5-6x token overhead" vs LangGraph — near-identical phrasing across content-farm sites, single unaudited origin | aggregator blogs | C | Maintenance mode (AutoGen); AG2 fork active |
| CrewAI | "~3x tokens" claim contradicted by an independent GH benchmark showing CrewAI 48% faster/34% fewer tokens on structured tasks | GH kunpeng-ai-research/autogen-vs-crewai-benchmark | B (contradicts the C-grade claim above — task-dependent, not a stable ranking) | Active |
| OpenAI Agents SDK | Deliberately publishes no SDK-level latency number; ships per-call tracing instead, on the stated grounds that model choice, not the SDK, dominates | official docs | A (for the design choice; N/A for a number, since none exists) | Stable |

**Why "None" isn't the end of the story**: none of the above isolate orchestration overhead from model latency the way Ruflo's own unmerged Mode-A fake-LLM-stub harness (`perf/sota-comparator-benchmarks`) is designed to — a genuine, still-open, checkable gap, not a solved-but-unpublished one.

## Hypothesis

> Given AgentDB's `HNSWIndex`-backed memory search, when the query-time default candidate-pool size is decoupled from `efConstruction` via a dedicated `efSearch` default (50), then per-query search latency should decrease relative to baseline, subject to: (1) recall@10 must not drop below 0.90 at any measured corpus size, (2) build/insert-time behavior (`efConstruction` itself) is unchanged, (3) existing HNSW/AgentDB tests remain green.

Procedural honesty note: the benchmark harness was run once against the candidate before this recall floor was written down, solely to confirm the harness itself worked end-to-end (not a real evaluation pass). The 0.90 floor was chosen afterward as a standard, conservative ANN-quality threshold — not reverse-fit, since the candidate actually fails it at N=8000 — but an independent adversarial critic reviewed this ordering explicitly (see Evaluation).

## Benchmarks

New deterministic, seeded benchmark: `v3/@claude-flow/memory/benchmarks/results/scripts/efsearch-default-benchmark.mjs`. Clustered synthetic corpus (256-dim, N=3000/8000, 60 queries/N), brute-force-computed recall@10 ground truth (live per run, never stored/gameable), paired per-query latency. Baseline measured by `git stash`-ing the candidate diff, rebuilding, and running the identical script; candidate measured after restoring the diff and rebuilding — same script, same seeds, two code states.

| N | Baseline ms/q | Candidate ms/q | Δ | Baseline recall@10 | Candidate recall@10 | Δ | Floor (0.90) |
|---|---|---|---|---|---|---|---|
| 3000 | 2.002 | 0.882 | **-55.9%** (t=-30.5, n=60) | 0.995 | 0.9633 | -3.17pp | held |
| 8000 | 3.326 | 1.412 | **-57.5%** (t=-32.7, n=60) | 0.9517 | 0.8767 | -7.5pp | **BREACHED** |

## Evaluation

**evaluated: rejected**. Existing test suite: 456/456 pre-candidate minus 1 pre-existing environmental failure (a read-only-file permission test that fails identically with/without the candidate because this session runs as root, which bypasses unix permission checks — confirmed via stash/rebuild on both commits) → same 455/456 post-candidate. Zero regressions attributable to the candidate. An independent adversarial-critic agent reviewed the diff, harness, and stats script (see repo PR for full critic report); reviewed specifically: gold-answer integrity (computed live, not stored), evaluator exploitation, baseline fairness (stash/rebuild methodology), paired-t correctness, whether the diff does what's claimed, corpus realism, and the honesty-note ordering.

Per this pipeline's own promotion rule — a failed mandatory pre-declared criterion REJECTs regardless of primary-effect strength — the recall-floor breach at N=8000 is dispositive. The efSearch=50 default is real, tested, and ~57% effective at latency, but too aggressive at larger corpus sizes; the degradation trend (-3.17pp at N=3000 → -7.5pp at N=8000) suggests it gets worse, not better, at CLAUDE.md's cited N=20k scale.

**Independent critic's verdict: CRITIC_FLAGS, REJECT reinforced (not overturned).** Confirmed clean: gold ground-truth computed live per run (never stored/cacheable), no evaluator exploitation, correct paired-t math, seeding independent of baseline/candidate label (exact pairing). Two real issues surfaced, neither of which rescues the candidate: (1) the benchmark ran at 256-dim while every production default is 1536-dim (`hnsw-index.ts:744`, `agentdb-adapter.ts:73`) — since ANN recall generally degrades with dimensionality, this makes tonight's REJECT an *optimistic*, not pessimistic, proxy for production risk; (2) `HNSWIndex.deserialize()` (`hnsw-index.ts:660-664`) never persists/restores `efSearch` — any index round-tripped through the binary `.hnsw` snapshot silently reverts to the new default regardless of the original config, an unaddressed gap the candidate's "build-time behavior unchanged" claim doesn't cover (persistence-time is a different axis). Also flagged as an unrelated pre-existing side discovery: `agentdb-backend.ts` already declares an unused `hnswEfSearch: 100` field (`:91-92`, never wired — that backend doesn't use `HNSWIndex`) that now collides in name with tonight's real field; unfixed here.

## Darwin Results

**Skipped**, mirroring last night's precedent: STEP 12's precondition is "candidate passed basic evaluation" — this one didn't (recall-floor breach at N=8000). Running bounded generations over a rejected baseline would tune toward passing a floor that already caught a real problem, which the adversarial-critique step exists to prevent. The natural next-night candidate is exactly what Darwin would explore anyway: a higher or scale-adaptive `efSearch` default (e.g. `efSearch = max(50, round(sqrt(N)))`-style scaling) — but as a fresh, separately-evaluated candidate, not a retroactive threshold change on tonight's result.

## SOTA Proof & Witness

| Field | Value |
|---|---|
| Session commit | `45e65b5dae5d2c312e70cd5ba90df0701ea05c28` |
| Report SHA-256 (pre-witness content) | `2f2de7910ca69da3752d18c67964927871cf8a8b8ce1c470d1d798170f5e81fd` |
| Witness stamp | `d756e6d92234275d44976fe47668e8713fa359481abd3d9d85e983ec94a4dd2d` |
| Evaluation receipts | `v3/@claude-flow/memory/benchmarks/results/` — `receipt-baseline.json`/`receipt-candidate.json` regenerated by `efsearch-default-benchmark.mjs`; `comparison-efsearch-final.json` regenerated by `compare-efsearch-receipts.mjs` |
| Flywheel evidence identity | No signed `@metaharness/flywheel` bundle produced — bespoke deterministic benchmark, not an LLM-task corpus the replay/verify tooling targets; evidence retained as committed receipts + this report instead |
| Darwin lineage identity | N/A — skipped, candidate failed its own pre-declared quality invariant (see Evaluation) |

**Verifier:** strip this table's values back to placeholders, `sha256sum` the file, concatenate with the session commit, `sha256sum` again → must equal the witness stamp above. (Report SHA-256 is computed on the content *before* this table was filled in — a known self-referential limitation of the scheme, carried over from prior nights, not unique to tonight.)

## Recommended Next Steps

1. **Do not merge tonight's `efSearch=50` default as-is** — REJECT stands (recall-floor breach at N=8000, reinforced by critic's dimension-mismatch finding). A follow-up hypothesis should test a higher fixed default (e.g. 75-100) or a scale-adaptive formula, evaluated fresh at production-realistic 1536-dim, not by loosening tonight's 0.90 floor after the fact — and must also fix `HNSWIndex.deserialize()` to persist/restore `efSearch` before any future candidate in this direction is considered mergeable.
2. **Execute the already-designed, never-run `perf/sota-comparator-benchmarks` Mode-A harness** (`docs/benchmarks/sota-workload-spec.md`, proposed 2026-05-24, still v1.0-unexecuted) — it is the one orchestration-overhead comparison in this space that would be both differentiated and independently reproducible, since every competitor either fakes, refuses to isolate, or leaves broken the exact number it measures.
3. **File the two newly-surfaced CVEs** (CVE-2025-59536 `.claude/settings.json` hook-injection RCE; CVE-2025-6514 mcp-remote OAuth MITM) as a scoped security follow-up — neither is cited in any existing Ruflo security ADR despite directly touching this repo's own hooks/OAuth surface.
4. **Small, separate cleanup**: `agentdb-backend.ts`'s unused `hnswEfSearch: 100` config field (never wired to any actual search path) now collides in name with tonight's new, real `HNSWConfig.efSearch` — worth renaming or removing independently of this candidate's fate.
