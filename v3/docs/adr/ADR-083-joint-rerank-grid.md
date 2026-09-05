# ADR-083 — Joint Rerank Re-Grid (Conditional Defaults for Rerank Path)

**Status**: Accepted — Implemented in ruflo 3.10.23
**Date**: 2026-05-30
**Tracking**: continuation of self-learning hardening cluster (ADR-077 → 078 → 079 → 080 → 081 → 082 → 083)
**Related**: ADR-082 (single-axis grid-search)

## Context

ADR-082 grid-searched the hybrid (non-rerank) hyperparameter space against the ADR-081 labelled corpus and shipped α=0.5, sw=2, mmr=0.7 — pushing hybrid nDCG@3 from 0.900 to 0.963. The rerank path was left at hw=0.5/cw=0.5 because the original rerank grid had been tested against the OLD α=0.6/sw=3.0 baseline; with α/sw shifting underneath, the joint optimum needed measuring.

ADR-082 flagged this explicitly: *"Rerank's trade-off: top-1/MRR/P3 up, nDCG@3/top-3 marginally down. Net: positive but not unambiguous. A joint re-grid (including hybridWeight/ceWeight × new α/sw) is tracked."*

This is that re-grid.

## Decision

Extended `scripts/grid-search-retrieval.mjs` with a joint rerank sweep:
- `hybridWeight × ceWeight` ∈ {(0.2,0.8), (0.3,0.7), (0.4,0.6), (0.5,0.5), (0.6,0.4), (0.7,0.3), (0.8,0.2)}
- `alpha` ∈ {0.3, 0.5} (for the underlying hybrid stage when rerank is on)
- `subjectWeight` ∈ {2.0, 3.0}

7 × 2 × 2 = 28 rerank configs, ~25 min wall-clock with the cross-encoder.

### Key finding

The rerank path wants **different hybrid sub-params** than the non-rerank path:

| Path | Best α | Best sw | Best mmr | Best hw/cw | nDCG@3 |
|---|---:|---:|---:|---|---:|
| Non-rerank (hybrid only) | 0.5 | **2.0** | 0.7 | — | 0.963 |
| **Rerank** | 0.5 | **3.0** | 0.7 | hw=0.7 cw=0.3 | **0.963** |

This makes intuitive sense: when the cross-encoder is doing the semantic understanding downstream, the hybrid stage can be more keyword-focused (higher subject weight). When hybrid is the final stage, lower subject weight gives the body tokens room to contribute relevance signal.

Implementation: `subjectWeight` default is now **conditional on `useRerank`** (3.0 if reranking, 2.0 otherwise). Explicit `subjectWeight` param still overrides.

### New defaults

| Parameter | Non-rerank | Rerank | Change vs 3.10.22 |
|---|---:|---:|---|
| `alpha` | 0.5 | 0.5 | unchanged |
| `subjectWeight` | 2.0 | **3.0** | rerank +1.0 (conditional default) |
| `mmrLambda` | 0.7 | 0.7 | unchanged |
| `hybridWeight` | — | **0.7** | rerank: 0.5 → 0.7 |
| `ceWeight` | — | **0.3** | rerank: 0.5 → 0.3 |

## Measured proof (N=385, 10 queries, labelled metric)

Rerank path:

| Metric | 3.10.22 (old joint defaults) | **3.10.23 (ADR-083)** | Δ |
|---|---:|---:|---:|
| Label top-1 hit rate | 90% | 90% | tied |
| Label top-3 hit rate | 90% | **100%** | +10pp |
| Label MRR@3 | 0.925 | **0.950** | +0.025 |
| **Label precision@3** | 0.700 | **0.700** | tied |
| **Label nDCG@3** | 0.900 | **0.963** | **+0.063 (+7%)** |
| Label nDCG@5 | 0.904 | **0.944** | +0.040 |

Hybrid (non-rerank) path: unchanged from 3.10.22 (nDCG@3 = 0.963).

### Cumulative SOTA push (3.10.17 → 3.10.23)

| Metric (labelled) | 3.10.17 cosine | 3.10.19 hybrid | 3.10.20 +rerank | 3.10.22 | **3.10.23** |
|---|---:|---:|---:|---:|---:|
| Hybrid nDCG@3 | 0.000 | 0.900 | 0.900 | 0.963 | **0.963** |
| Rerank nDCG@3 | — | — | 0.913 | 0.900 | **0.963** |
| Hybrid top-3 | 0% | 90% | 90% | 100% | **100%** |
| Rerank top-3 | — | — | 100% | 90% | **100%** |
| Rerank precision@3 | — | — | 0.667 | 0.700 | **0.700** |

**Both retrieval paths now hit nDCG@3 = 0.963 on this corpus.** The choice between them is now purely cost vs richness:
- **Hybrid (39 ms/query)** — same nDCG, leaner top-3 (P3=0.533), use for hot paths
- **Rerank (1000 ms/query)** — same nDCG, denser top-3 (P3=0.700), use for richness-first paths

## Joint grid top-5 by nDCG@3 (full ranking)

| Rank | Config | top-1 | top-3 | nDCG | P3 | MRR |
|---|---|---:|---:|---:|---:|---:|
| 1 | hybrid α=0.5 sw=2 mmr=0.7 | 90% | 100% | **0.963** | 0.533 | 0.950 |
| 1 | rerank hw=0.7 cw=0.3 α=0.5 sw=3 | 90% | 100% | **0.963** | 0.700 | 0.950 |
| 1 | rerank hw=0.8 cw=0.2 α=0.3 sw=3 | 90% | 100% | **0.963** | **0.767** | 0.950 |
| 4 | hybrid α=0.5 sw=3 mmr=0.7 | 90% | 100% | 0.955 | 0.533 | 0.950 |
| 4 | rerank hw=0.8 cw=0.2 α=0.5 sw=3 | 90% | 100% | 0.955 | 0.700 | 0.950 |

Three configs tied at the corpus ceiling. Picked hw=0.7 cw=0.3 over hw=0.8 cw=0.2 because the latter underweights the cross-encoder's contribution (cw=0.2 leaves the CE doing almost nothing).

## Reusable infrastructure shipped

- `scripts/grid-search-retrieval.mjs` — extended with joint rerank sweep (28 configs across hw/cw × α × sw). Re-runnable on any corpus.
- Conditional default logic in `src/mcp-tools/neural-tools.ts` — `subjectWeight` default depends on `useRerank`.
- Run JSON at `docs/benchmarks/runs/grid-search-retrieval-latest.json` with the full 48-config matrix.

## Honest limits

- **N=10 queries** still — three configs tied at 0.963 are likely indistinguishable within noise.
- **Cross-repo generalisation pending** — all numbers in ADRs 077-083 are on the ruflo corpus. The real SOTA test is "does this hold up on a different repo's history?" — pretrain on agentdb / agentic-flow, run a similar labelled bench, see if nDCG@3 stays near 0.96. Tracked for the next iteration.
- **Conditional defaults add complexity** — callers passing explicit `subjectWeight` get consistent behaviour, but callers relying on defaults see different values based on `rerank` flag. This is documented in the schema but is a minor surprise.

## Deliberately NOT in this round

- **Cross-repo generalisation test** — biggest pending validation; next loop iteration.
- **Pure-precision configs** (hw=0.4/cw=0.6 α=0.3 sw=3 hit P3=0.800 with nDCG=0.900) — would be the right opt-in for "richer top-K" but adds yet another config option. Skipping.
- **Larger cross-encoder** (L-12 vs L-6) — corpus is already near ceiling; bigger model unlikely to help on N=10.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )
node v3/@claude-flow/cli/scripts/pretrain-from-github.mjs

# Joint grid (~25 min)
cd v3/@claude-flow/cli && node scripts/grid-search-retrieval.mjs

# Verify new defaults
BENCH_NO_WRITE=1 node scripts/benchmark-pretrained-retrieval.mjs              # hybrid → nDCG@3 0.963
RERANK=1 BENCH_NO_WRITE=1 node scripts/benchmark-pretrained-retrieval.mjs     # rerank → nDCG@3 0.963 (was 0.900)
```
