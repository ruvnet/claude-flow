# Intelligence Deep-Dive SOTA Report — 2026-10-17

TL;DR: In 2026, the field-wide gap between "retrieval-based agent memory" and
"parameter-level continual learning" is still unsolved industry-wide (no
competitor framework beats Ruflo's SONA+EWC++ combination). Closer to home,
`agentdb-backend.ts`'s RETRIEVE-phase integration with the real `agentdb`
npm package has been calling a controller name (`'hnsw'`) that package has
never supported — every `store()`/`search()`/`getStats()` call silently
throws, gets caught, and (for search) logs a false "HNSW search failed"
error to stderr on every single call, with zero effect on the actual
(already-correct) brute-force search result. Tonight removes that dead,
noisy code path.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| SLEUTH: structured epistemic working memory gives +5–11pp on multi-hop reasoning (basis of Ruflo's own unimplemented, Proposed ADR-367) | [arXiv:2607.12267](https://arxiv.org/abs/2607.12267), Jul 2026 | A |
| "When Routing Collapses": routers trained on scalar quality scores (not pairwise rank) default to the most expensive model as budget rises; rank-learning fixes it, −17% cost at matched quality on RouterBench | [arXiv:2602.03478](https://arxiv.org/abs/2602.03478), Feb 2026 | B |
| Cheap reward-hack detection: a linear probe on trajectories hits AUC 0.9467, ~4 orders of magnitude cheaper than an LLM judge; an LLM judge given only the trajectory gets just 36.4% accuracy on the same task (BenchShield) | [arXiv:2606.08893](https://arxiv.org/pdf/2606.08893) / [arXiv:2609.11028](https://arxiv.org/pdf/2609.11028) | A |
| HNSW graphs accumulate tombstones under delete/update churn; a repair method (LR-RN) cuts unreachable-node growth ~2/3, holds recall degradation to 1–3% | [CEUR-WS Vol-4250](https://ceur-ws.org/Vol-4250/paper776.pdf), 2026 | B |
| SLoRA: subspace-filtered LoRA updates cut catastrophic forgetting ~29% vs. baseline continual-LoRA, no access to old-task gradients needed | [ACL 2026](https://aclanthology.org/2026.acl-long.247/) | B |
| No framework among LangGraph/AutoGen/CrewAI/OpenAI Agents SDK ships a learned-from-outcomes routing mechanism or an EWC++-class forgetting mitigation — confirmed as a genuine open field-wide gap, not solved-but-unpublished | 9-source competitor survey (below) | B |

## Ruflo Current Capability vs. Competitors

Full survey (LangGraph, AutoGen, CrewAI, OpenAI Agents SDK, Qdrant,
Weaviate, Milvus, LanceDB, Vespa):

| Competitor | Analogous capability? | Grade |
|---|---|---|
| LangGraph | No adaptive routing; checkpointed state, not learned weights | B |
| AutoGen | Retrieval-based memory only; academic lit frames this as a deliberate avoidance of unsolved forgetting, not a solved problem | C |
| CrewAI | "Adaptive learning" is a vendor claim, uncorroborated by any independent benchmark | C |
| OpenAI Agents SDK | No framework-level adaptive routing (GPT-5's product-layer auto-router is a different thing, unpublished mechanism) | B |
| Qdrant/Weaviate/Milvus/LanceDB/Vespa | HNSW ANN at recall@10 ≈0.885–0.96 (independent benchmarks); Vespa's Dec-2025 ANN autotuner is the closest "self-optimizing" index feature found anywhere | B |

**Flag:** no source in the last 12 months benchmarks any of the 5 vector DBs
directly against brute-force on matched hardware — Ruflo's own "1.9x–4.7x vs
brute force" figure remains uncorroborated against competitors on that exact
metric (worth closing before next external publication of this comparison).

## Hypothesis

Given `AgentDBBackend`'s `storeInAgentDB()`, `searchWithAgentDB()`, and
`getStats()` (`v3/@claude-flow/memory/src/agentdb-backend.ts`) each call
`this.agentdb.getController('hnsw')` inside a try/catch, expecting an
optional native HNSW controller from the `agentdb` npm package, when the
real `agentdb` package's `AgentDB.getController()` (confirmed directly from
`agentdb@3.0.0-alpha.20`'s installed `dist/src/core/AgentDB.js`) recognizes
only `'memory'`/`'reflexion'`, `'skills'`, `'causal'`/`'causalGraph'` and
throws `Error('Unknown controller: hnsw')` for anything else — then every
store/search/getStats call pays for a thrown-and-caught exception for a
controller that can never exist, and `searchWithAgentDB` additionally logs a
misleading `console.error('HNSW search failed:', ...)` on every search even
though the code unconditionally falls back to the already-correct
`bruteForceSearch()` either way. Removing the three dead call sites should
(a) eliminate the false error log with zero change to search results, and
(b) remove a real, isolated, measurable per-call exception-handling cost.
Subject to: zero change to returned search results/ranking, zero regression
in the existing `@claude-flow/memory` suite, deterministic $0 evaluation.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8 against a real (not mocked) `agentdb@3.0.0-alpha.20`
instance (`:memory:` db), after a full `pnpm install --filter @claude-flow/memory...`.

- **Baseline reproduction:** a probe test run against the unmodified source
  shows `console.error` called with `["HNSW search failed:", {}]` on a
  normal `store()` + `search()` call — the bug fires in the existing,
  previously-unasserted test fixture, not just in theory.
- **New regression test 1** (`should not log a false "HNSW search failed"
  error...`): stash-isolated — **fails on baseline** (`expected [] to have
  length 0 but got 1`), **passes on candidate**.
- **New regression test 2** (`pins that the real agentdb package has no
  "hnsw" controller`): directly asserts `getController('hnsw')` throws
  `/Unknown controller/` against the real package — a tripwire so a future
  `agentdb` release that *does* add HNSW support fails this test loudly
  instead of the dead code silently staying dead forever.
- Full `agentdb-backend.test.ts`: 21/21 (baseline) → 23/23 (candidate, +2
  new), 0 regressions.
- Full `@claude-flow/memory` suite: 614/616 passed both baseline and
  candidate; the 2 failures are pre-existing and unrelated — a read-only-file
  permission test that doesn't work when running as root (environmental),
  and an N=5000 embedding-dedup perf test that timed out at 34s vs. a 30s
  ceiling (neither test touches `agentdb-backend.ts`; confirmed failing
  identically on baseline via stash isolation for the first).
- `tsc --noEmit`: 0 errors, both ways.
- **Isolated microbenchmark** (NOT an end-to-end store()/search() timing
  claim — a synthetic probe of the exact mechanism removed): a tight loop
  calling a throw-then-catch path 200k times vs. a direct-return path 200k
  times measured ~5.66µs/call vs. ~0.008µs/call, a ~700x difference —
  consistent with V8's well-documented stack-trace-capture cost for thrown
  exceptions. This supports "removes a real per-call cost" without claiming
  it dominates `store()`/`search()`'s end-to-end wall-clock, which also does
  SQLite I/O and embedding work untouched by this fix.

## Darwin Results

Skipped — binary dead-code-removal/log-suppression fix, no continuous or
categorical parameter for Darwin's real interface
(`npx ruvector harness darwin <config> --execute`, confirmed available) to
search over. Same skip class as nearly every accepted fix in this repo's
history (e.g. #3929, #3977, #4053, #3395 before it).

## SOTA Proof & Witness

See PR body for the full witness block (session commit, gist SHA-256,
witness stamp, verifier procedure).

## Recommended Next Steps

1. **Harden or re-benchmark the memory HNSW tombstone path.** A background
   scan this session independently found that `agentdb-backend.ts`'s
   `searchWithAgentDB` requests exactly `options.k` results with no
   over-fetch factor (unlike `hnsw-index.ts`'s own `searchWithFilter`, which
   over-fetches 3x) — moot for the *native agentdb* path fixed tonight (it's
   dead code), but still real for Ruflo's own local `HNSWIndex` class
   (`hnsw-index.ts`, confirmed to have working `removePoint`/`rebuild`
   methods) wherever it's used as the live backend. Combine with the 2026
   LR-RN tombstone-repair literature above for a future `memory` night.
2. **Investigate router rank-collapse (EquiRouter-class risk).** Ruflo's
   3-tier bandit router's escalation confidence is a fixed scalar threshold
   (`confidenceThreshold: 0.85` in `model-router.ts`); 2026's "When Routing
   Collapses" paper gives a reproducible failure mode (scalar-score routers
   over-escalate to expensive tiers as budget allows) and a direct
   structural analogy worth a diagnostic-only sweep script on a future
   `intelligence` night — high expected value if confirmed, since it is a
   directly actionable cost-correctness bug in a system whose core pitch is
   cost-tiering.
3. **Audit the unsigned capability-claim gap in live federation handshake.**
   `plugin-agent-federation/src/domain/services/handshake-service.ts`'s
   `respondToHandshake()`/`verifyChallenge()` signs only the nonce, not the
   `capabilities` list riding alongside it — a verified peer can still
   over-claim capabilities without failing signature verification, unlike
   the sibling `establishDiscoverySession()` path, which signs the whole
   manifest. Found via a capabilities-surface scan tonight; a security-night
   candidate, not bundled into tonight's patch (different file, different
   risk class, needs its own dedicated review).

## STEP 1.2 — Prior Gist Score

2026-10-11 (security) scored **10/10**: benchmark evidence grade A/B (2),
5 competitor rows (2), 3 specific recommendations (2), valid witness (2),
1173 words < 1500 (1), genuinely novel finding — SessionStart hook gap tied
to a real 2026 npm-worm campaign and a real Claude Code CVE (1).
