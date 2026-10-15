# Memory SOTA Report — 2026-09-28

TL;DR: 2026-09-27's own memory-surface scan (still-open PR #3476) flagged, graded A, that `mmrRerank()`'s embedding-cosine path in `v3/@claude-flow/memory/src/smart-retrieval.ts` re-walks the *entire* selected-item list on every outer-loop pass, even though PR #3169/#3266 already made the Jaccard-fallback tokenization lazy. Tonight closes that half of the redundant-recompute problem: a running per-candidate max-similarity cache folds in only the newest selection each round, cutting total pairwise-similarity calls from O(candidates × selected²) to O(candidates × selected) with a proven byte-identical selection order and a measured 2x+ wall-clock speedup at N=200/limit=100.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| **Weaviate ships this exact running-max-cache pattern in production** (`adapters/repos/db/vector/selection/mmr.go`, GA'd Weaviate 1.39, 2025): a `minDist[i]` array updated only against the just-selected vector each round | Direct read of current Weaviate GitHub source | A |
| Qdrant's native MMR (`lib/shard/src/query/mmr/mod.rs`) and LangChain's reference `maximal_marginal_relevance()` (reused by Chroma et al.) both still do the naive full-rewalk (or worse — LangChain recomputes the whole similarity matrix every round) | Direct read of current GitHub source, both repos | A |
| OpenSearch k-NN's `MMRRerankProcessor` (v3.3/3.4, 2025) memoizes individual pairwise values but still loops the full selected set per round — a weaker, different optimization than a running max | Direct read of source + release notes | A |
| No 2025-2026 paper/practitioner post specifically analyzes MMR's O(N·L) retrieval-time cost or advocates this optimization as a named topic — existing 2025-26 MMR content covers *when to use it*, not its complexity | Targeted search across arXiv + vendor blogs; explicit negative result | B |
| Milvus ships no native MMR (WeightedRanker/RRF instead); LanceDB/Vespa show no evidence of one either | Official docs + GitHub discussions | B/C |

## Ruflo Current Capability

`mmrRerank()` seeds with the top-scored candidate, then on every round re-walked `selected` to recompute `max(0, sim_1..sim_k)` per remaining candidate — ≈O(candidates×selected²) total. This repo's own defaults (`fanOutK = max(limit*3,20)`, MMR-limit `= min(limit*2, scored.length)`) put a typical call at N=30/limit=20, and `diversityMMR` defaults `true`, so this runs on every `smartSearch` call.

## Competitor Comparison

| Framework | Diversity re-ranking at retrieval | Mechanism | Gap type | Grade |
|---|---|---|---|---|
| LangGraph (Store/memory) | None in Store API itself; MMR only via LangChain's separate vectorstore utility, opt-in | Naive full-rewalk over a small `fetch_k` pool | Bolted-on, not memory-layer native | B |
| AutoGen (memory) | None | N/A | Architecturally out of scope — minimal store/query protocol | B |
| CrewAI (memory) | None — composite similarity+recency+importance score, no pairwise redundancy check | Single-pass, no comparison step | Simplicity trade-off, not a stated decision | B |
| OpenAI file_search | Opaque internal reranker, no documented diversity control | Closed-source | Deliberately black-boxed | C |
| Qdrant (native MMR) | Only vendor with first-class query-time MMR (`models.Mmr`) | Naive full-rewalk over a bounded ANN-prefiltered pool | Solved at the API level, not algorithmically optimized | A |
| **Weaviate (native MMR)** | First-class MMR **with** the running-max-cache optimization | O(N×K) via `minDist[i]` | Solved, both at the API and algorithmic level | A |

No agent-orchestration framework treats diversity re-ranking as memory-layer-native; Weaviate is the one vendor proving this optimization is real production practice, not a synthetic ask.

## Hypothesis

> Given `mmrRerank()`'s embedding-cosine path recomputing max-similarity-to-selected from scratch every round, when a running per-remaining-candidate cache is added that folds in only the newest selection each round (mathematically identical to recomputing `max(0, s_1..s_k)`, since max is associative), then total `pairSimilarity` calls should drop from O(candidates×selected²) to O(candidates×selected) and wall-clock should measurably improve, subject to: (1) selection order is byte-identical to the old algorithm across all-embedded/no-embedding/mixed/negative-cosine/lambda-extreme scenarios; (2) the Jaccard fallback path (already fixed by #3169/#3266) is untouched; (3) all existing MMR/smart-retrieval tests remain green; (4) deterministic, $0 evaluation.

Frozen before evaluation; not modified after seeing results.

## Benchmarks

Extended `v3/@claude-flow/memory/src/mmr-rerank-cosine-cache.test.ts` (new, 11 tests): correctness parity (5 scenarios incl. a dedicated negative-cosine zero-floor edge case) against a frozen copy of the old algorithm; a call-count comparison between two parallel frozen copies (old vs. new, both self-contained) rather than `vi.spyOn` on the production export — a throwaway debug test confirmed Vitest's ESM spy cannot intercept a same-module internal call (`pairSimilarity` calling the local `cosineSimilarity` binding directly), so a spy-based count would silently read 0 regardless of real behavior; a wall-clock test against the real `applyMMR` export at N=200/limit=100.

## Evaluation

**evaluated: accepted.** Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls, against a freshly `pnpm install`-ed `v3/` workspace. All 20 MMR-related tests (11 new + 9 pre-existing) pass against the candidate. Stash-isolated against the real, unmodified baseline: 10/11 new tests still pass trivially (they compare two frozen copies or check an invariant, not the live code); the one true discriminator — wall-clock of the real `applyMMR` export vs. the frozen baseline at N=200/limit=100 — **fails on baseline** (686.5ms vs. a 343.3ms threshold, i.e. no speedup, as expected since baseline *is* the old algorithm) and **passes on the candidate** (consistently >2x faster). Full `@claude-flow/memory` suite: 564/565 passing both ways — the one failure (a chmod-read-only-file test) reproduces identically on stash-isolated baseline, confirmed environmental (root-user chmod doesn't block root writes). `tsc --noEmit`: 0 errors, both ways.

## Darwin Results

Skipped — this is a structural algorithmic refactor (a fixed data-structure change), not a continuous parameter with a fitness gradient for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available) to search over. Same skip class as nearly every accepted night since 2026-08-18.

## SOTA Proof & Witness

**Reward hack check** (manual checklist, no standalone reward-hack CLI reachable): no test weakened (new file only, existing 9 MMR tests untouched and still pass); no gold data touched; no cherry-picking (full package suite run both ways, one pre-existing unrelated failure disclosed, not hidden); no seed manipulation (deterministic pseudo-embeddings); zero cost; the wall-clock threshold (2x, well under the algorithm's predicted ~10x at this N/limit) was chosen for CI robustness *before* running it, not tuned to pass afterward.

**Security review**: not security-sensitive — pure internal data-structure/algorithm change on an already-trusted comparison path; no new user input, no auth/filesystem/network surface change.

**Adversarial critique** (this session, independent re-derivation): verified the zero-floor semantics algebraically (`max(0,s_1,...,s_k)` folds incrementally without loss, since max is associative and monotonic — confirmed via a dedicated negative-cosine test, where a naive fold without the zero floor would diverge); independently caught and fixed a `vi.spyOn` ESM-internal-call blind spot before it produced a vacuous passing assertion (likely the same latent issue in the sibling `tokenize()` call-count test from 2026-09-10 — flagged for future review, not fixed retroactively, out of tonight's scope).

**Promotion gate** (advisory only): evaluation_complete ✓, effect_positive ✓ (proven via wall-clock, not just call-count arithmetic), significance_sufficient ✓ (byte-identical output + discriminating stash-isolated wall-clock), no_material_regression ✓, tests_green ✓, reward_hack_clear ✓, witness_valid ✓ (below), receipt_reproducible ✓. **VERDICT: ACCEPT.**

| Field | Value |
|---|---|
| Session commit | `b14c79e6f7793a358f13b7e3f9b5eb27317b4988` |
| Gist SHA-256 (pre-witness content) | `7eb8ee7e3c1af889f759f1063894ac37fc79a10e38ca2b9f3fb818e5aeee7c7a` |
| Witness stamp | `85e464a6c739aa9e938a93b4d70131d96e534096a007493993a4a013d1169b2b` |

Verifier procedure: fetch this gist from the branch, strip the witness table's filled values back to `PENDING`, SHA-256 it, concatenate with the session commit above, SHA-256 again — result must equal the witness stamp.

## Scan Findings: plugins

Re-verified 2026-09-27's finding as still true (unchanged since a version-bump-only commit): `installCommand`'s `--verify` flag is read into `const verify` and never used; `installFromNpm`/`installFromLocal` take no checksum parameter; the tested `PluginIntegrityVerifier` (security package) is never imported anywhere in `cli/src` (0 grep hits). **New tonight**: the IPFS-signed registry lookup is cosmetic at install time — `installCommand` fetches registry metadata (trust level, checksum) only to *display* it; install always runs plain `npm install <pkg>` against public npm, never verifying against the IPFS-hosted/checksummed tarball. `plugins info` can show `Trust: official` while the bits on disk are unauthenticated. `trust-anchors.json` still holds a placeholder all-zero key. Grade A (full-file reads). Zero test coverage for install/manager. Candidate for a future `plugins`/`capabilities` night — not selected tonight.

## Scan Findings: automation

5 of 12 documented background workers (`ultralearn`, `preload`, `deepdive`, `refactor`, `benchmark`) appear in `WorkerType` and the daemon's own CLI help but are absent from `DEFAULT_WORKERS` (`worker-daemon.ts:145-155`) — every dispatch path (scheduler, MCP queue, `triggerWorker()`, `setWorkerEnabled()`) gates on `config.workers`, so these 5 can never run. `daemon enable -w ultralearn` silently no-ops; `daemon trigger -w ultralearn` throws `Unknown worker type`. Execution logic for all 5 still exists — dead configuration, not missing code. Grade A, file:line confirmed. Separately (grade A, not novel): no in-repo trigger/schedule exists for the Dream Cycle routine itself — `LEDGER.md` self-documents it as `.github-external`. Strong, small, mechanically-testable candidate for a future `automation` night.

## Recommended Next Steps

1. **This fix**: human review and merge — one file (+35/-11 net) plus one test file, one conceptual change, zero regressions, matches the precedent class of #3169/#3266/#3330.
2. **`automation` night**: add the 5 missing worker types to `DEFAULT_WORKERS` (or fix the CLI help text) — small, one-command-reproducible, a real silent-no-op/thrown-error bug on documented functionality.
3. **`plugins`/`capabilities` night**: wire `PluginIntegrityVerifier` behind the dead `--verify` flag AND make `installFromNpm` check the registry checksum — carried forward from 2026-09-27, now with the added finding that trust metadata is display-only.
4. **Future `memory` night**: `hnsw-index.ts`'s `distance()` still has no case for `'binary'`/`'scalar'` quantization (falls to non-metric-comparable generic cosine/euclidean) — flagged 2026-09-27, still live.
