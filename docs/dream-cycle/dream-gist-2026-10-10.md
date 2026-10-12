# Performance SOTA Report — 2026-10-10

TL;DR: Louvain community detection has one settled 2026 practical lesson, violated tonight: its efficiency case rests on maintaining each community's total degree *incrementally*, not recomputing it from scratch. Ruflo's `graph-analyzer.ts` did the latter — made worse by a correction to 2026-10-09's own recommendation to "wire the real `ruvector` graph exports into `loadRuVector()`": that premise is false. Direct inspection of the installed `ruvector@0.2.27`'s 100+ real exports (and `@ruvector/gnn`'s real API) confirms no published `ruvector`/`@ruvector/wasm` version has ever exported the `hooks_graph_mincut`/`hooks_graph_cluster`/`GraphAnalyzer` surface `loadRuVector()` checks for. Nothing real to wire in — "native acceleration" is permanently dead in every correctly-installed environment, so the plain-JS `fallbackLouvain()`/`fallbackMinCut()` are the *only* code that ever runs. That raised the stakes on their own efficiency: `fallbackLouvain()` rebuilt a `communityTotal` map via a full O(n) node scan, once per node, once per pass — O(n²) per pass vs. the O(n·avg_degree) a correctly incrementalized pass costs. Fixed tonight.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| networkx's `louvain_communities`/`_one_level` maintains per-community total degree (`Stot`) incrementally — `Stot[u_com] -= degree` on removal, `+= degree` on insertion — never rescanning all nodes | Direct read, `networkx/algorithms/community/louvain.py` (networkx.org, accessed 2026-10-10) | A |
| python-louvain (`taynaud/python-louvain`)'s `Status.degrees`/`gdegrees` use the identical subtract/add pattern inside `__one_level`'s inner loop; full modularity only recomputed once per *pass*, not per node move | Direct read, `community/community_louvain.py` (GitHub, accessed 2026-10-10) | A |
| Blondel et al. 2008 (arXiv:0803.0476) makes no formal Big-O claim — reports empirically "complexity is linear on typical and sparse data," with memory (not CPU) as the practical bottleneck at scale (12 min/39M nodes, 152 min/118M nodes) | Direct full-text read (ar5iv mirror, accessed 2026-10-10) | A |
| igraph's own docs state no complexity bound for `community_multilevel`; the commonly-repeated "O(n log n)" figure traces only to community commentary (Wikipedia), which itself notes no rigorous published analysis exists | python.igraph.org API docs + en.wikipedia.org/wiki/Louvain_method (accessed 2026-10-10) | C |
| graphology-communities-louvain's README claims runtime "bounded by the number of edges" (~O(m) per pass), qualitative only, no independent source-level confirmation of its incremental-vs-recompute mechanism | unpkg.com README (accessed 2026-10-10) | B |

No mainstream tool surveyed — including the two JS/TS dependency-graph tools checked (madge, dependency-cruiser) — applies Louvain-style community detection to a *code*-dependency graph specifically; every implementation above targets generic/social-network graphs. Closest precedent: academic Girvan-Newman clustering of Java dependency graphs, a different algorithm, single unverified source. Noted as a genuine framing gap, not padded.

## Ruflo Current Capability

`v3/@claude-flow/cli/src/ruvector/graph-analyzer.ts` builds a code-dependency graph (import/require/dynamic-import/re-export edges) and offers MinCut-based boundary detection and Louvain-based module/community detection, reachable today via the shipped `claude-flow analyze modules <dir>` CLI command (`analyze.ts`, lazy-loaded from `commands/index.ts`) → `analyzeGraph()` → `analyzeModuleCommunities()`.

`loadRuVector()` tries to resolve "native acceleration" from `ruvector` (checking `hooks_graph_mincut`/`hooks_graph_cluster`) or `@ruvector/wasm` (checking a `GraphAnalyzer` class). Verified by direct inspection, not the code's own comments: the installed `ruvector@0.2.27` (`@claude-flow/cli`'s own normal, non-optional pin) resolves and exports 100+ real functions/classes (`VectorDB`, `FlashAttention`, `buildGraph`, `calculateModularity`, `CodeGraph`, etc.) — but not `hooks_graph_mincut`/`hooks_graph_cluster` (`typeof` → `undefined`). `@ruvector/wasm` isn't resolvable at all. `@ruvector/gnn` exists but its real API (`differentiableSearch`, `hierarchicalForward`, `RuvectorLayer`, `TensorCompress`) is GNN-embedding machinery, zero overlap with graph partitioning. **Correction to 2026-10-09's recommendation #1** ("wire the real exports in"): there's nothing real to wire in. `fallbackMinCut()`/`fallbackLouvain()` aren't a degraded-environment fallback — they're the only path that has ever run, in any correctly-installed environment.

That raised `fallbackLouvain()`'s own efficiency to this file's top priority. Its local-moving loop rebuilt `communityTotal` from a full scan of all n nodes, inside the per-node loop — O(n)×n = O(n²) per pass, ×10 passes — when the reference implementations above (and the algorithm's design intent) maintain it incrementally, O(1) per accepted move. Fixed: `communityTotal` now initializes once before the loop and is patched by ±`nodeDegree` on the two affected communities immediately after each accepted move — the existing modularity-gain arithmetic (which assumes the moving node's own degree is still counted in its current community at evaluation time) is untouched.

## Competitor Comparison

| Tool | Degree-sum tracking | Complexity evidence | Grade |
|---|---|---|---|
| networkx `louvain_communities` | Incremental (`Stot -=`/`+=` per move) | Matches near-linear-per-pass design intent | A |
| python-louvain (Aynaud) | Incremental (`status.degrees` subtract/add) | Same pattern, independently confirmed | A |
| igraph `community_multilevel` | Not disclosed in official docs | No official Big-O; community figure (~O(n log n)) disputed/unproven | C |
| graphology-communities-louvain (JS) | Unconfirmed from README alone | Qualitative "bounded by edge count" claim | B |
| madge / dependency-cruiser (JS, code-dependency-graph tools) | N/A — neither implements community detection at all | N/A | C |

**ruflo (pre-fix)**: communityTotal recomputed from scratch per node per pass — O(n²) per pass, the one practice every implementation above avoids. **ruflo (post-fix)**: incremental, matching the networkx/python-louvain pattern (Grade A precedent).

## Hypothesis (frozen before evaluation)

Given `fallbackLouvain()`'s local-moving phase, when `communityTotal` is initialized once and maintained incrementally (±`nodeDegree` per accepted move) instead of rebuilt via a full node scan per node, then (a) output partitions/modularity should be byte-identical to the pre-fix algorithm, and (b) wall-clock should scale near-linearly with node count at fixed average degree instead of quadratically — subject to: zero change to `fallbackMinCut()`, zero regression across the full suite (byte-identical failing-file set), deterministic $0 evaluation.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, deterministic, $0, zero LLM calls, against a freshly `pnpm install`-ed `v3/` workspace.

New test file `graph-analyzer.louvain-complexity.test.ts` (4 tests), with a frozen verbatim copy of the pre-fix algorithm (`legacyFallbackLouvain`) inline for self-contained, CI-safe comparison:
- Byte-identical community partitions + modularity vs. the frozen pre-fix copy on two differently-shaped synthetic graphs, plus empty-graph/single-node degenerate cases.
- Growth-ratio test (fixed avg. degree, 8x node-count): legacy must show >20x growth (true O(n²) ≈64x, confirming the fixture exercises the quadratic path) and the fix's growth must stay under half that.
- Stash-isolated independently by an adversarial critic: reverting only the source file fails the growth-ratio assertion exactly as predicted; the 3 correctness assertions still pass (reverted, both algorithms are identical).
- Standalone `tsx` measurement (N=200→1600, 8x nodes, fixed avg. degree): baseline 10.37ms→837.29ms (~81x growth); candidate 5.00ms→22.33ms (~4.5x growth) — speedup itself grows, 2.1x→37.5x, the signature of a complexity-class fix.
- Full `@claude-flow/cli` suite, both ways (JSON reporter, 1295 suites): candidate 3266/3632 tests passed (199 failed files), baseline 3265/3632 (200 failed files) — the only difference in the failed-file set between the two runs is the new test file itself (fails on baseline exactly as predicted, passes on candidate); all 199 other failures are byte-identical, pre-existing, unrelated to this change. `tsc --noEmit`: 498 pre-existing errors both ways (unbuilt sibling packages), zero new.

## Darwin Results

Skipped — binary, correctness-preserving complexity fix with no continuous/categorical parameter to search over (same skip class as nearly every accepted fix since 2026-08-18). `npx ruvector harness darwin --help` was reachable during STEP 0.5 but went transiently unreachable on retry; noted, not a blocker — this candidate skips regardless.

## SOTA Proof & Witness

See issue/PR for the full reward-hack checklist, adversarial critique (independent verdict: CONFIRMED, no blocking caveats), and security review. Witness stamp at the end of this file.

## Recommended Next Steps

1. **Correct `loadRuVector()`'s "fallback" framing** (not a fallback — the only path) via a doc/comment fix, or remove the permanently-dead native-detection branch outright in a future `ruvector-integration` night, so "wire in the real exports" isn't reproposed again.
2. **`fallbackMinCut()`'s docstring claims "Stoer-Wagner MinCut"; it is not** — it's a randomized-restart maximum-adjacency heuristic with no global-minimum guarantee (real Stoer-Wagner contracts the graph per phase). Low-priority naming fix, correctness not performance, not bundled tonight.
3. **hive-mind scan (carried, not bundled):** `v3/@claude-flow/swarm/src/consensus/raft.ts:513-578`'s `handleVoteRequest()`/`handleAppendEntries()` are a second, fully unreachable Raft receiver, only exercised by unit tests, already diverged from the real transport path (`handleInboundRaftMessage()`, lines 99-147) — e.g. its commit-index clamp uses `this.node.log.length` instead of `lastLogInfo().index`. False confidence in safety-critical logic. Testable-tonight-sized for a future `swarm`/`hive-mind` night.

## Scan Findings: security

MCP tool-result injection screening (`applyContentBoundaryGuardrail`, `mcp-client.ts` ~304-351) only scans top-level string values of a tool's return object — anything nested in an array/sub-object is skipped by design. `memory_search`'s real shape (`{ results: [...] }`, each entry carrying `.content`) is exactly that skipped shape, so poisoned memory content passes unfiltered even with the opt-in flag on (off by default). A separate, independently-gated AgentDB-level retrieval guard exists but isn't wired to this path. Testable-tonight-sized (bounded recursion, capped for latency) but not bundled tonight — flagged for a future `security` night.

## Scan Findings: hive-mind

See Recommended Next Steps #3 for the primary finding. Also confirmed: `AgentPool.updateAgentHeartbeat()` (`agent-pool.ts:439`), flagged as dead code by 2026-10-09's own gist, still has zero production callers as of tonight — the open question from last night is settled (no, it has not gained a caller).

## Competitors Reviewed

networkx, python-louvain (taynaud), igraph, graphology-communities-louvain, madge, dependency-cruiser (Louvain/community-detection comparison); OWASP agentic/LLM guidance (security scan).

## Witness

```
Session commit (STEP 0): 6c046548e29506be9bfd6640186d6e85a444e849
Gist SHA-256 (pre-witness, this block's filled values stripped to PENDING): c179941b356c8a09bf9b9f2d1ea4598bd1fe65d45d809823f1cf847087a41b70
Witness stamp: 81e2148140bfe55da2e1d1ff613171d3c1d8252322c065480c7273357cf6b32e
```

Verifier: fetch this file from the branch, strip this block's filled values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.
