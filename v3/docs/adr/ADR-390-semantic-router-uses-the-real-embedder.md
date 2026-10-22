# ADR-390 — The Semantic Router Uses the Real Sentence Embedder

**Status**: Implemented as opt-in (3.44.0); default unchanged — did not pass the ADR-391 gate
**Date**: 2026-09-23
**Related**: ADR-389 (keyword router refresh), ADR-391 (router benchmark gate), #2312 (embedder recursion), #3375, PR #3407
**Surfaces**: `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (`getSemanticRouter`, `hooks_route`)

## Context

`hooks_route` picks an agent by comparing the task with each agent pattern's
keywords in a vector index (`@ruvector/router` VectorDb, or a pure-JS fallback).
Both sides of that comparison come from `generateSimpleEmbedding`
(`hooks-tools.ts:148`): the pattern keywords (`:369`, `:392`) and the incoming
task (`:1197`). That function is a character-hash, not a language model. It measures
spelling overlap, not meaning.

Observed on the published 3.43.0: "sync and review latest issues" routes to
`tester` at **58%** through the semantic path. The word-boundary fix (#3402) doesn't
help here, because this path never matches words; it compares hash vectors, and
"latest" shares character patterns with "test".

RuFlo already ships and loads a real sentence model. Memory uses
`all-MiniLM-L6-v2`, 384-d, the same dimension the router index uses, through
`generateEmbedding` / `generateLocalEmbedding` in `memory-initializer.ts`. On the
3.43.0 release check it found a stored entry by meaning at 0.83. The router uses
none of it.

## Decision

Embed the router's pattern keywords and incoming tasks with the local sentence
model, keeping the hash embedder as the fallback:

1. At router init, embed each pattern's keywords with `generateLocalEmbedding`.
   It must be the **local** chain, never the bridge-first `generateEmbedding`,
   which recursed without bound in #2312. Cache the vectors per pattern set.
2. Embed the incoming task with the same function, so both sides share one space.
   Mixing hash and model vectors in one index is forbidden.
3. If the local model reports `backend !== 'onnx'` (mock or hash), use
   `generateSimpleEmbedding` for **both** sides, as today, and report
   `embedder: 'hash'` in the routing result.
4. Every result gains an `embedder` field (`minilm` | `hash`), so a degraded route
   is visible, not silent.

Model loading is lazy and happens once per process. `hooks_route` already awaits
async work.

## Consequences

- Routing should follow meaning, not spelling. This is a hypothesis until ADR-391
  measures it. The ADR ships behind its gate, not on faith.
- First-call latency rises by the model load if memory hasn't already loaded it.
  Per-call cost is one 384-d embedding. ADR-391's latency criterion decides whether
  that's acceptable.
- No new dependency. Installs without the model behave exactly as today and say so.

## Verification

- Unit tests (London-school, with the embedder mocked):
  - when onnx is available, pattern and query vectors come from the same function
  - mock/hash backend falls back to `generateSimpleEmbedding` on both sides
  - the `embedder` field is reported
  - there is no call path to the bridge-first `generateEmbedding`
- Promotion to default happens only if ADR-391's gate passes.
