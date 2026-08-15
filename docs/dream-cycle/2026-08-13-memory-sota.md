# Memory SOTA Report — 2026-08-13

**TL;DR:** Ruflo's `@claude-flow/memory` package (v3.0.0-alpha.21) has a real, non-trivial
`smartSearch()` retrieval pipeline (RRF fusion + recency boost + MMR diversity + session
round-robin), but its default-on multi-query fan-out awaited each of 2-3 query variants
*sequentially*, paying N x single-search latency for no benefit. Tonight's candidate replaces
that with `Promise.all`-based concurrent fan-out: measured **2.9x-5x speedup** (66-80%
latency reduction) on realistic scenarios, byte-identical output, zero regression on the
single-variant path, adversarially reviewed and independently reproduced. A separate,
larger finding — the SessionStart hook's own "self-learning DISABLED" warning tonight —
was root-caused to `v3/@claude-flow/memory` never being built by the documented dev
bootstrap (`scripts/prepare-root-publish.mjs` omits it from its `pnpm --filter` list) and
is recorded as a follow-up, not bundled into tonight's diff.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| OpenAI Assistants API sunsets Aug 2026; no built-in long-term memory replaces it | developers.openai.com deprecation notice | A |
| Qdrant TurboQuant (May 2026): rotation-based quantization, tuning-free, pairs with binary quantization | qdrant.tech | B |
| Weaviate native multi-tenancy w/ tenant lifecycle (ACTIVE/INACTIVE/OFFLOADED) | weaviate.io | B |
| Milvus GPU_CAGRA now builds on binary-quantized vectors | milvus.io / Zilliz | B |
| LanceDB zero-copy table versioning — instant revert per write | lancedb.com | B |
| Extended RaBitQ (SIGMOD 2025, provable error bound) | dl.acm.org/10.1145/3654970 | A |
| OWASP ASI06 — Memory & Context Poisoning named as a Top-10 agentic risk, 80-99% reported undefended attack success | genai.owasp.org | A |
| Filtered-ANN: partition/IVF-style indexes beat graph-based HNSW at low filter selectivity | arXiv 2602.11443 | A |

## Ruflo Current Capability

Two parallel vector-search implementations exist in this package: `AgentDBAdapter`
(pure-TS HNSW, the default `MemoryService` path) and `AgentDBBackend` (wraps the external
`agentdb` npm package, the ADR-009-documented "hybrid" default). They duplicate ID-hashing
and fallback logic, and only `AgentDBBackend` has the ADR-377 prompt-injection retrieval
guard wired in — the more commonly used `AgentDBAdapter` path has **no retrieval-injection
defense regardless of configuration**. CLAUDE.md's "measured" HNSW benchmark numbers come
from `@claude-flow/cli`'s `dist/ruvector/vector-db.js`, not from anything in this package —
this package's own dedicated `benchmark.test.ts` contains zero vector-search benchmarks.
`smart-retrieval.ts`'s RRF/MMR/session pipeline is real and non-trivial (ADR-090), but its
default multi-query fan-out was sequential — tonight's candidate.

## Competitor Comparison

| System | 2026 capability | Ruflo equivalent? |
|---|---|---|
| LangGraph | thread-checkpointer vs. namespaced cross-thread store split | Partial |
| CrewAI | 3-tier contextual memory (short/long/entity) | Partial |
| Qdrant | TurboQuant rotation-based quantization | Partial (has int8 3.84x, RaBitQ 32x, not rotation-based) |
| Weaviate | tenant lifecycle w/ cold-storage offload | No |
| LanceDB | zero-copy versioning/instant revert | **No — most actionable gap** |

**Most actionable competitor gap:** no versioning/rollback on the memory store. If EWC++
consolidation or a bad LoRA distillation corrupts a namespace, there's no snapshot to
revert to. Out of scope for tonight (too large for a same-night patch); recommended for a
future cycle.

## Hypothesis (frozen before evaluation)

Given a `smartSearch()` call with default `multiQuery=true` (2-3 variants), when the
sequential fan-out loop is replaced with `Promise.all`-based concurrent fan-out, then
wall-clock latency should improve vs. baseline, subject to: (1) byte-identical result sets,
(2) no error-rate increase, (3) >=30% improvement on multi-variant scenarios and <15% delta
on the single-variant path.

## Benchmarks & Evaluation

Self-contained, git-reproducible benchmark (`docs/dream-cycle/evidence/2026-08-13-memory/`)
compiled the real pre-candidate baseline (git-extracted) and real candidate (working tree)
via `tsc`, ran both against identical mock search functions, 5 repeats/scenario:

| Scenario | Variants | Baseline (ms) | Candidate (ms) | Speedup | Quality identical |
|---|---|---|---|---|---|
| default, fast store | 3 | 46.6 | 15.9 | 2.94x | yes |
| default, slow store | 3 | 182.9 | 60.5 | 3.02x | yes |
| multiQuery off | 1 | 60.4 | 60.4 | 0.999x | yes |
| explicit 5 variants | 5 | 301.6 | 60.4 | 4.99x | yes |

**Verdict: ACCEPT** against the frozen threshold. Full package suite: 452/453 tests pass
(1 pre-existing, environment-caused failure unrelated to this change, confirmed via
git-stash isolation). Independent adversarial critic reproduced the benchmark 3x, verdict
**CONFIRMED**, with two honest caveats: the mock can't model real backend contention, and a
partial-failure (`search()` rejects) scenario is untested by either the benchmark or new
unit tests.

## Darwin Results

Bounded 1-generation, 3-candidate local exploration (frozen fitness:
`0.35*quality + 0.20*success_rate + 0.15*latency + 0.10*cost_efficiency +
0.10*reproducibility + 0.10*safety`) over 3 fan-out strategies. `variant-b`
(`Promise.allSettled`, fault-tolerant) wins on composite fitness (0.996 vs 0.730) due to
surviving a simulated partial-store-failure scenario that both baseline and the shipped
candidate do not — but it changes `smartSearch()`'s error-propagation contract, which is
out of scope for tonight's frozen hypothesis. **Not shipped**; retained as a well-evidenced
follow-up. `variant-c` (bounded concurrency, cap=2) provides no benefit at the actual
default variant count (<=3) — rejected, persisted as negative evidence.

## SOTA Proof & Witness

Session commit: `2462cf7870bce359115ade64cf8b1a8256dc3257` (session start) /
branch `claude/practical-gauss-f15m07`. Full evidence trail and reproduction commands are
in `docs/dream-cycle/evidence/2026-08-13-memory/` (evaluation receipt, Darwin lineage,
adversarial critique).

- Session commit: `2462cf7870bce359115ade64cf8b1a8256dc3257`
- Report SHA256 (of the pre-stamp report body, see verifier procedure): `19063b387493764e662f8efea63e35b10528f53e665a2eb5d6992ce428401ab5`
- Witness stamp: `498a9cea038a562f54cf51214df1bd9fbebd885bbe3b68e8e2ff264b94547dac`
- Evaluation receipt: `docs/dream-cycle/evidence/2026-08-13-memory/receipt-2026-08-13.json`
- Flywheel evidence: `docs/dream-cycle/evidence/2026-08-13-memory/flywheel-evidence.json`
- Darwin lineage: `docs/dream-cycle/evidence/2026-08-13-memory/darwin-lineage-2026-08-13.json`

**Verifier procedure:** the Report SHA256 above was computed over this same file with
both the "Report SHA256" and "Witness stamp" bullet values above blanked (replaced with an
empty string each), i.e. the report body as it existed immediately before these two values
were filled in — not the byte content you're currently reading, which already has them
filled in. Witness stamp = SHA256(Report SHA256 + session commit). An external verifier
who only has the published gist cannot re-derive the exact pre-stamp byte sequence from
the text alone (the two bullet lines' original blank/placeholder form isn't preserved
verbatim in the published copy) — the authoritative reproduction path is instead the
checked-in evidence trail in `docs/dream-cycle/evidence/2026-08-13-memory/`, which every
number in this report traces back to and which anyone can independently re-run.

## Recommended Next Steps

1. **Merge tonight's candidate** (smart-retrieval.ts concurrent fan-out) after human
   review — small diff (~20 lines + 2 tests), ACCEPT-grade evidence, zero behavior change
   beyond latency.
2. **Add `@claude-flow/memory` to `scripts/prepare-root-publish.mjs`'s pnpm `--filter`
   list** — a 1-line fix that resolves the exact "self-learning imports DISABLED" warning
   this very session hit at startup on a fresh checkout. Kept out of tonight's PR to
   preserve "one conceptual change"; low risk, high DX value, worth a fast follow-up.
3. **Open a DEEP=security Dream Cycle on the AgentDBAdapter retrieval-guard gap** — the
   default `MemoryService` path has zero prompt-injection defense on retrieved memory
   content regardless of env-flag configuration, unlike the less-used `AgentDBBackend`
   path. OWASP ASI06 names this exact risk class as a 2026 Top-10 concern (80-99% reported
   undefended attack success in cited studies).
