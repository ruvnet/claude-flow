# Performance/Security SOTA Report — 2026-10-20

**TL;DR**: Tonight's DEEP slot was `performance`; SCAN was `security`+`hive-mind`. Five parallel research roles surfaced two strong fresh performance candidates (both avoiding the 3x-exhausted busy-poll and native-accel-dead-code patterns) — but the security scan found a HIGH-severity, **live, currently-exploitable** path-containment bypass in the `hooks_codemod` MCP tool (a Tier-1 tool CLAUDE.md tells every agent to call automatically), letting an absolute path like `/project-staging/x.ts` escape `cwd=/project` via an unanchored string-prefix check and get read+written on disk. Tonight overrides the DEEP/SCAN rotation (precedent: 2026-09-24's off-cycle #3411/#3412) to fix this instead of a performance candidate — it scored higher on every axis (production_value, reviewability, novelty) and the fix is a tiny, low-risk anchor-at-separator change matching a pattern already correct elsewhere in this codebase. Both deferred performance candidates, plus a hive-mind topology bug, are documented below for a future night.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| EvoRoute: per-step Pareto-optimal LLM backbone selection, up to 80% cost / 70% latency reduction (GAIA/BrowseComp+) | ACL 2026, preview.aclanthology.org/2026.acl-long.1771 | B |
| No framework (LangGraph/MS Agent Framework/CrewAI/OpenAI Agents SDK) ships a first-party swarm-level cost-aware router as of this search | Direct docs search, Oct 2026 | B |
| CrewAI Flows/triggers = only official, current (2026) design claim for event-driven-vs-polling orchestration among 4 competitors — zero measured before/after numbers published by anyone | docs.crewai.com/concepts/flows, 2026 | B |
| Ruflo's HNSW 1.9x–4.7x and quantization (int8 3.84x, RaBitQ 32x) are at industry parity (Weaviate 4x@8-bit RQ; Qdrant/Vespa headline numbers are >12mo stale) | Weaviate/Qdrant/Milvus/LanceDB/Vespa docs, cross-checked | B |
| OWASP's 2026 cycle (LLM Top 10 + a separate Agentic/ASI Top 10, Dec 2025) ranks Excessive Agency / improper least-privilege on agent tool calls as a top category — directly the class of tonight's fix | CSA/Akamai secondary summaries (did not open genai.owasp.org directly) | C |

## Ruflo Current Capability

`hooks_codemod` (`v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:5380`) is the real Tier-1 ($0, no-LLM) codemod path (ADR-143), explicitly surfaced by CLAUDE.md whenever `[CODEMOD_AVAILABLE]` appears. No competitor framework reviewed ships an equivalent deterministic-codemod tier at all — this remains a genuine Ruflo differentiator, which is exactly why its containment bug mattered: it's a tool agents are told to call automatically, not an edge-case path.

## Competitor Comparison

| Competitor | Cost-aware routing (last 6mo) | Event-driven vs. polling claim | Confidence |
|---|---|---|---|
| LangGraph | None native; third-party "close behind AutoGen" (unreplicated) | Checkpointer = resumability, not explicitly "no polling" | B/C |
| MS Agent Framework (AutoGen successor, GA Apr 2026) | Azure "model router" is platform-level, not framework-level | Superstep/barrier model, structurally non-polling, unbenchmarked | B/C |
| CrewAI | None found | Flows/triggers explicitly replace polling (official docs) — only concrete 2026 design claim of the four | B |
| OpenAI Agents SDK | Single-model reasoning-effort knob only, not cross-model | No claim found | C |
| Field-wide | **Open gap**: no framework ships a swarm-level cost router comparable to Ruflo's 3-tier ADR-026/143 | **Open gap**: no competitor publishes measured before/after polling-removal numbers (Ruflo has shipped 3 such fixes: #3378/#3563/#4215) | — |

No row is a bare "None" — each ties to a dated source or an explicit scope/design reason.

## Hypothesis (frozen before evaluation)

> Given the `hooks_codemod` MCP tool's `resolveTargets()` path-containment checks (`hooks-tools.ts:5432` for `file`/`files[]`, `:5454` for `glob` matches), when a caller supplies an absolute path whose string representation shares `cwd` as a literal prefix without a path-separator boundary (e.g. cwd=`/home/user/ruflo`, target=`/home/user/ruflo-staging/notes.ts`), then the current unanchored `abs.startsWith(cwd)` check incorrectly treats the target as contained and the tool reads and (absent `dryRun`) writes that file outside the project root — then anchoring the check at a path-separator boundary (`abs === cwd || abs.startsWith(cwd + sep)`, matching `@claude-flow/security`'s `isWithinPrefix()` and two other already-correct sites in this codebase) should reject such targets with "path escapes project root" and perform zero I/O, while every legitimate in-root absolute/relative path continues to work identically, subject to: (1) zero change to the no-disk `code` mode; (2) zero regression to codemod-engine/corpus/routing suites; (3) deterministic, $0, zero-LLM Vitest evaluation.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, `@claude-flow/cli` package, after building `cli-core`+`neural` (dist was missing for both). New test file `__tests__/hooks-codemod-path-containment.test.ts`, 4 tests: 2 discriminating (real temp-dir fs I/O, absolute path escaping a sibling-prefix `cwd`, via `file` and `files[]`), 2 non-discriminating controls (legitimate absolute/relative in-root paths). Stash-isolated baseline (`git stash` on just `hooks-tools.ts`): **2 of 2 escape tests fail on baseline** (`success: true`, target file actually overwritten outside root — the live exploit, reproduced for real, not simulated) — candidate: **4/4 pass**. Related suites (`mcp-tools-deep`, `validate-input-*`, `codemod-engine/routing/corpus`): **229/229 both ways, independently reproduced twice** (this session once, an adversarial-critic subagent with no authoring context a second time, including its own fresh stash/pop cycle). `tsc --noEmit`: byte-identical 9 pre-existing environmental errors both ways (unbuilt sibling packages, unrelated).

Full `@claude-flow/cli` suite: ~480/503 files pass both before and after. The ~21-22 consistently-failing files (`mcp-policy-enforcer` policy-wiring, `memory-search-recall-2558`, `self-learning-2245`/`unified-stats-2245` shared-counter flakiness across parallel workers, `p1-commands`) are the same set by file/test name in both runs and touch none of: `hooks-tools.ts`, the codemod engine, or path validation — consistent with pre-existing environmental/shared-state flakiness, not a regression. Full disclosure: the second (baseline) full-suite run was contaminated mid-run by this session reverting the fix on disk to run a stash-isolated comparison, then promptly restoring it once a stop-hook flagged the dirty tree — so it is not a clean byte-identical diff and is not relied on as the authoritative check; the narrower, clean, twice-reproduced related-suite run above is.

## Darwin Results

Skipped — binary path-containment correctness fix (anchor an existing check at a separator boundary), no continuous/categorical parameter for Darwin's real interface (`npx ruvector harness darwin <config> --execute`, confirmed available in STEP 0.5) to search over. Same skip class as nearly every accepted security fix since 2026-08-18.

## Reward Hack Check

No standalone reward-hack CLI reachable this session (`@metaharness/weight-eft` loaded as a library dependency per STEP 0.5's doctor output, but no `npx`-callable entry point found). Manual checklist, independently re-verified by the adversarial critic from a fresh context: no test weakened, no gold/benchmark data touched, no cherry-picking (full suite disclosed, including the contaminated-run caveat above rather than hiding it), no evaluator exploitation, $0 cost (the tool's own output reports `cost: 0, tier: 1`), no seed manipulation.

## Security Review

This finding *is* the security fix. Independent adversarial critique (separate subagent, no authoring context): **CONFIRMED-WITH-CAVEATS, no blocking issues.** The critic independently reproduced the stash-isolated comparison, confirmed the diff was scoped to exactly 2 checks + 1 import + 1 test file, and built its own standalone repro proving the glob-branch fix (the second call site) is real defense-in-depth, not cosmetic (an absolute glob pattern bypasses the pre-existing `glob.includes('..')` guard and would have passed the old unanchored check). It also found and disclosed a **non-blocking** follow-up: the fix compares the resolved-but-not-realpath'd path, so a symlink inside the project root pointing outside it still escapes containment (CWE-59, a distinct/broader gap than the CWE-22 bug fixed tonight) — disclosed in-source as a KNOWN LIMITATION comment and left for a future night's realpath-based hardening, matching this repo's established non-blocking-caveat convention rather than scope-creeping tonight's patch.

## SOTA Proof & Witness

No `.claude-flow/flywheel/` state exists in this repo (same as every prior night). Evidence retained as: 4 new discriminating/control tests, the stash-isolated comparison (real file I/O, not simulated), an independent adversarial critique (including its own independent repro of the symlink gap), issue/PR links, and the witness below.

```
Session commit:   070349a6949aee7d5cb798a354f0712121285324
Candidate commit: (this branch's head — see commit list: 71a6c07d fix, 93743766 disclosure)
Gist SHA-256 (pre-witness, witness block stripped to PENDING): 85acdd27963f7d5598df7857acad2e609bdcfd83caee4dbe8dbda666e0ad2840
Witness stamp:    d501ab489f819875de9f3ee2028bb5b4d2ad2705a3c31092c67bbde0bb77bbe3
```
Verifier: fetch `docs/dream-cycle/dream-gist-2026-10-20.md` from this branch, strip the Witness block's filled-in values back to `PENDING`, SHA-256 the file, concatenate with the session commit above, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **Implement `CacheManager.estimateSize()` fix** (arch-reviewer's top performance pick, score 4.85/5): every `set()`/`delete()`/`evictLRU()` in `v3/@claude-flow/memory/src/cache-manager.ts` pays a full `JSON.stringify` on every mutation for a `memoryUsage` stat that `agentdb-adapter.ts`'s real production wiring never gates eviction on (`maxMemory` is never passed). Cache the computed size once per entry instead of re-deriving it.
2. **Fix `TopologyManager.calculateInitialConnections()`'s raw-vs-resolved role bug** (hive-mind scan): uses the caller's *requested* role instead of `determineRole()`'s *resolved* role, so a demoted-to-worker node re-requesting queen/coordinator still gets wired with leader-level connections to all existing nodes (`topology-manager.ts:77/82/365-396`). Same single-source-of-truth fix shape as the 10-19 `promoteToRole()` fix.
3. **Decide the second-order path-containment instances found tonight**: `v3/@claude-flow/mcp/src/resource-registry.ts:513-523` and `v3/@claude-flow/shared/src/security/input-validation.ts:119-155` have the identical unanchored-prefix bug, but no confirmed attacker-reachable call site in this scan — verify exploitability before treating as tracked issues.
4. Pursue `AttentionCoordinator.getOrCreateEmbedding()` memoization (deep-researcher's pick, score 4.70) on a future performance night: O(2n²·L)→O(n·L) in the live `hyperbolic`-mode dispatch.
