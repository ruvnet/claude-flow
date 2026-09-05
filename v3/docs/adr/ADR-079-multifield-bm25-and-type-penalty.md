# ADR-079 — Multi-Field BM25 + Opt-In Type Penalty

**Status**: Accepted — Implemented in ruflo 3.10.19
**Date**: 2026-05-30
**Tracking**: continuation of the self-learning hardening cluster (#2245 → ADR-074 → ADR-075 → ADR-076 → ADR-077 → ADR-078)
**Related**: ADR-078 (hybrid retrieval)

## Context

ADR-078's hybrid retrieval lifted top-1 hit rate from 0% (cosine) to 50% and MRR@3 from 0 to 0.583 on the same 10-query bench. The 50% miss rate was traceable to two failure modes I observed in the per-query top-K output:

1. **Body-noise drowns out subject signal.** A commit's subject (`feat(intelligence): structured distillation (ADR-076)`) carries the high-signal tokens — file paths, action verbs, ADR refs. Its body is often a list of bullets, links, or boilerplate. A single-field BM25 averages them together — the subject's signal gets diluted by the body's noise.

2. **Release/merge commits dominate top-1.** `chore(release): bump 3.10.10 → 3.10.11 (4-issue bug cluster)` bundles every issue number from a release window. It shares low-IDF tokens with almost any query and outranks the *actual fix commits* for those issues.

## Decision

Two changes, opt-in tuning, one release:

### 1. Multi-field BM25 (default ON)

Add `multiFieldBM25()` to `src/memory/hybrid-retrieval.ts`. Treats subject (pattern `name`) and body (pattern `content` minus the subject prefix if it starts with it) as separate fields with independent corpus statistics, then linearly combines:

```
score = subjectWeight * BM25(query, subject, subjectStats)
      + bodyWeight   * BM25(query, body,    bodyStats)
```

Default weights `subjectWeight=3.0, bodyWeight=1.0` reflect the empirical 3:1 signal asymmetry. Both fields use the same Okapi parameters (k1=1.5, b=0.75) but build their own IDF maps — subjects are short (~10 tokens) and bodies long (~50-200 tokens), so they need independent IDF distributions.

Wired into `neural_patterns` search as the default replacement for single-field BM25. Single-field is still reachable via `{subjectWeight: 0, bodyWeight: 1}`.

### 2. Type penalty (default OFF, opt-in)

Add `typePenalty(name, factor)` + exported `META_COMMIT_REGEX`. Multiplies the hybrid score of any pattern whose name matches the regex (`^chore(release)|^Merge\s|^bump\s|^publish\s\d|^\[Dream Cycle\b`) by `factor`.

Default factor: **1.0 (disabled)**. The ablation below shows multi-field BM25 alone gives better top-1 than multi-field + penalty (8/10 vs 7/10) — some real work commits start with `Merge feat/...` and get falsely penalised. Callers wanting aggressive meta-commit suppression can pass `{typePenaltyFactor: 0.5}`.

## Measured proof — full ablation (N=385, 10 queries, same harness as ADR-078)

| Configuration | Top-1 hit | Top-3 hit | MRR@3 | Top-1 diversity |
|---|:---:|:---:|:---:|:---:|
| **Cosine baseline (3.10.17)** | 0/10 (0%) | 0/10 (0%) | 0.000 | 100% |
| Single-field BM25, no penalty (~3.10.18) | 5/10 (50%) | 7/10 (70%) | 0.600 | 80% |
| Single-field BM25 + type penalty 0.5 | 7/10 (70%) | 7/10 (70%) | 0.700 | 100% |
| **Multi-field BM25 3:1, no penalty (3.10.19 default)** | **8/10 (80%)** | **8/10 (80%)** | **0.800** | **100%** |
| Multi-field BM25 3:1 + type penalty 0.5 | 7/10 (70%) | 8/10 (80%) | 0.750 | 100% |

Cumulative since cosine baseline (3.10.17 → 3.10.19): **0% → 80% top-1, 0.000 → 0.800 MRR@3**. Cumulative since 3.10.18 hybrid: **+30pp top-1, +10pp top-3, +0.217 MRR@3, +20pp diversity**, at no extra latency cost (39 ms vs 40 ms).

The "type penalty disabled by default" decision was driven by the ablation, not intuition. Both rows with penalty trade top-1 hit rate for diversity — when the underlying BM25 is already good (multi-field 3:1), the penalty's downside (mislabelling `Merge feat/...` as meta-commit) outweighs its upside.

## Reusable infrastructure shipped

- `multiFieldBM25(queryTokens, subjectTokens, bodyTokens, subjectStats, bodyStats, subjectWeight=3.0, bodyWeight=1.0)`
- `typePenalty(name, factor=0.5, regex=META_COMMIT_REGEX)` + exported `META_COMMIT_REGEX`
- `neural_patterns` MCP tool — new params: `subjectWeight`, `bodyWeight`, `typePenaltyFactor`
- 18 new unit tests in `__tests__/hybrid-retrieval.test.ts` (39 total in the file)

## Honest limits

- The 10-query bench is small and uses regex-over-subject as a relevance proxy. A held-out labelled corpus would give tighter confidence intervals. Direction (0% → 80%) is robust to noise; absolute magnitudes could shift on a different corpus.
- The 3:1 subject:body weight was chosen by inspection, not grid-search. A future tuning pass could grid-search `subjectWeight ∈ {1,2,3,5,8}, bodyWeight ∈ {0.5,1,2}` against the same harness. Tracked.
- The type penalty regex is hand-curated against ruflo's commit conventions (`chore(release)`, `Merge`, `bump`, `publish`, `[Dream Cycle]`). Other repos with different conventions need their own regex — the function takes one as a param.

## Deliberately NOT in this round

- **Cross-encoder reranker** — still tracked for 3.11.0. The lift remaining (80% → 100% top-1) is exactly what a cross-encoder is good at.
- **Grid-search for subject/body weights** — would belong in a future tuning ADR with a wider corpus.
- **HyDE (Hypothetical Document Embeddings)** — too LLM-expensive to ship as a default.

## Verification

```bash
git clone https://github.com/ruvnet/ruflo && cd ruflo
npm install && ( cd v3/@claude-flow/cli && npx tsc )

# Unit tests — 39 tests (21 from ADR-078 + 18 new)
( cd v3/@claude-flow/cli && npx vitest run __tests__/hybrid-retrieval.test.ts __tests__/pretrain-from-github.test.ts )

# Live A/B
cd v3/@claude-flow/cli
node scripts/pretrain-from-github.mjs
node scripts/benchmark-pretrained-retrieval.mjs                    # 3.10.19 default — 80% top-1, MRR 0.800
HYBRID=0 node scripts/benchmark-pretrained-retrieval.mjs           # cosine — 0% top-1
```
