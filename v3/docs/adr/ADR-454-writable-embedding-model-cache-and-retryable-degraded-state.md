# ADR-454 — Writable Embedding Model Cache and Retryable Degraded-Embedder State

**Status**: Proposed
**Date**: 2026-10-05
**Related**: ADR-094 (xenova → @huggingface/transformers migration), ADR-390 (semantic router uses the real embedder), #3692, `v3/@claude-flow/cli/src/benchmarks/gaia-loader.ts` / `gaia-judge.ts` (prior art for `~/.cache/ruflo/*`)
**Surfaces**: `v3/@claude-flow/embeddings/src/transformers-loader.ts`, `v3/@claude-flow/embeddings/src/embedding-service.ts`, `v3/@claude-flow/cli/src/memory/memory-initializer.ts`, `v3/@claude-flow/cli/src/ruvector/task-embedder.ts`

## Context

Issue #3692: on a system-prefix global install (`npm install -g` as root), an
ordinary user running `@claude-flow/cli` hits `EACCES` the first time any of
three independent call sites load the ONNX embedding model
(`Xenova/all-MiniLM-L6-v2`) via `@huggingface/transformers` /
`@xenova/transformers`'s `pipeline('feature-extraction', ...)`:

1. `v3/@claude-flow/embeddings/src/transformers-loader.ts`, resolved by
   `TransformersEmbeddingService.initialize()` in
   `v3/@claude-flow/embeddings/src/embedding-service.ts:398`.
2. `v3/@claude-flow/cli/src/memory/memory-initializer.ts:2337`,
   `loadLocalEmbeddingChain()`'s `pipelineFn('feature-extraction',
   'Xenova/all-MiniLM-L6-v2')`.
3. `v3/@claude-flow/cli/src/ruvector/task-embedder.ts:62`, same pipeline call
   with `{ quantized: true }`.

None of the three passes a cache-dir override. Without one, the HF/Xenova
loader defaults to a path under its own package's
`node_modules/@huggingface/transformers/.cache`. Under a system-prefix global
install that directory tree is root-owned, so the runtime user's download
fails with `EACCES`. Reproduced by the reporter across five existing servers;
creating only the exact model-cache directory as the runtime user (`0700`),
without touching package ownership, let the normal loader download the model
and produce real embeddings — confirming the cache path, not the package
install, is the fixable boundary.

A second, compounding bug lives only in `memory-initializer.ts`. The `EACCES`
throw is caught by `loadLocalEmbeddingChain()`'s inner try/catch (around
line 2352, which carries a comment referencing #2461) and falls through to
the hash fallback at line ~2448:

```ts
embeddingModelState = {
  loaded: true,
  model: null, // Will use simple hash-based fallback
  tokenizer: null,
  dimensions: 128
};
```

Every caller short-circuits on `embeddingModelState?.loaded` — inside
`loadLocalEmbeddingChain` itself (line 2293) and inside
`generateLocalEmbedding` (line 2532). Because `loaded: true` is set
permanently on a transient, environmental failure, the degraded hash state is
memoized for the rest of the process's life — this is exactly the "already
running workers required a restart/refresh" symptom from the issue. Fixing
the cache-directory permissions mid-run does not help a worker that already
tripped this path; only a process restart does.

ADR-390 already established that a degraded embedder must be reported
truthfully rather than silently returning meaningless vectors, via an
explicit `backend: 'onnx' | 'mock'` field on `generateLocalEmbedding` /
`generateEmbedding`'s return value (`memory-initializer.ts`, line 2526 type
definition, lines 2562 and 2578 for assignments) and an `embedder: 'minilm' |
'hash'` field on router results. That reporting already exists and already
satisfies part of the issue's "report mock/degraded status truthfully"
expectation — the gap this ADR closes is specifically (a) where the model is
allowed to try to write, and (b) how long a fixable failure is allowed to
stay remembered.

The repo already has a convention for a user-writable, XDG-adjacent cache
outside any package directory: `path.join(os.homedir(), '.cache', 'ruflo',
...)`, used today by `gaia-loader.ts` (`~/.cache/ruflo/gaia`) and
`gaia-judge.ts` (`~/.cache/ruflo/gaia/judgments`).

## Decision

1. **One writable cache-dir default, applied at all three call sites.**
   Resolve a cache directory for ONNX model downloads with this precedence:
   - `TRANSFORMERS_CACHE` or `HF_HOME`, if the environment already sets one
     (don't override a choice the user or host environment already made);
   - otherwise `~/.cache/ruflo/models`, matching the existing
     `~/.cache/ruflo/<subpath>` convention.

   Centralize this resolution in one shared helper (in
   `transformers-loader.ts`, since it is the only one of the three call
   sites that is already a shared module) rather than tripling the
   precedence logic across `embedding-service.ts`, `memory-initializer.ts`,
   and `task-embedder.ts`. Each call site passes the resolved directory to
   the loaded package's cache-dir mechanism (`env.cacheDir` on the
   `@huggingface/transformers` / `@xenova/transformers` `env` singleton)
   before calling `pipeline('feature-extraction', ...)`.

2. **Never assume a system package directory is writable.** State this as
   the root cause, not an edge case: a global, system-prefix install is
   root-owned by construction, and a runtime user downloading a model into
   it is the fragile path, not a rare misconfiguration. The fix is to stop
   defaulting into package-relative storage at all, not to special-case
   root-owned installs.

3. **Make the degraded state retryable, not permanent.** Distinguish two
   failure classes in `loadLocalEmbeddingChain()`:
   - **No better backend exists at all** — e.g. neither
     `@huggingface/transformers` nor `@xenova/transformers` is installed, or
     `pipeline` isn't exported. This is legitimately permanent for the
     process's dependency set; memoizing `loaded: true` with the hash
     fallback is correct here, since nothing will change without a
     reinstall.
   - **A real backend exists but initialization failed for an
     environmental/fixable reason** (`EACCES`, `ENOSPC`, a transient
     network failure on first download, etc.). This must **not** be
     memoized as permanent degraded state. Either:
     - don't set `embeddingModelState.loaded = true` on this path — leave it
       `null`/unset so the next call to `loadLocalEmbeddingChain()`
       re-attempts initialization, or
     - keep the memoized hash state but record the failure class alongside
       it (e.g. `embeddingModelState.degradedReason: 'permanent' |
       'retryable'`) and have `generateLocalEmbedding` re-attempt the real
       loader when the reason is `'retryable'`, bounded by a minimum retry
       interval so a persistently broken environment doesn't retry on every
       call.

   Either shape removes the "worker requires a restart after fixing cache
   permissions" symptom — the next real request should recover without a
   process restart once the writable cache directory exists.

4. **Keep ADR-390's truthful `backend` / `embedder` reporting unchanged.**
   This ADR extends it (the retryable/permanent distinction above should be
   visible through the existing status surface, e.g. alongside
   `embeddings_status.ruvectorStatus`) but does not replace or regress it.

## Consequences

**Positive:**
- Closes the actual failure mode in #3692 without requiring provider
  credentials or manual model downloads, matching the reporter's expected
  behavior.
- A single resolution point for the cache directory means a future change
  (e.g. supporting an additional env var) lands once instead of three times.
- Recovery after an admin fixes cache-dir permissions no longer requires
  restarting already-running workers.

**Negative:**
- `task-embedder.ts` and `memory-initializer.ts` each inline their own
  dynamic `import('@xenova/transformers')` rather than routing through
  `transformers-loader.ts`'s ADR-094 provider-agnostic loader (the
  `memory-initializer.ts` site does this deliberately, per ADR-094's
  "Implementation status" note, to avoid a circular optional-dependency at
  install time). The shared cache-dir helper this ADR proposes must be
  importable from all three without reintroducing that circularity — it
  should be a small, dependency-free utility (just path resolution plus
  setting `env.cacheDir`), not bundled with the loader's provider-selection
  logic.
- Honoring `TRANSFORMERS_CACHE` / `HF_HOME` means a host that already has
  one of those set to a non-writable location keeps failing — deliberately
  not overriding an explicit environment choice is weighed above
  auto-recovering from a user's own misconfiguration.

**Risk:**
- The retryable/permanent distinction adds a small amount of state-machine
  complexity to `loadLocalEmbeddingChain()`, which this ADR explicitly keeps
  inside `memory-initializer.ts`'s existing inline state rather than
  introducing a new shared abstraction, to avoid growing the file past the
  500-line-per-file guidance beyond what's already there.

## Verification

- Unit tests (London-school, with the transformers package mocked):
  - cache-dir resolution prefers `TRANSFORMERS_CACHE`/`HF_HOME` when set, and
    falls back to `~/.cache/ruflo/models` otherwise.
  - `env.cacheDir` (or equivalent) is set before `pipeline(...)` is called,
    at all three call sites.
  - an `EACCES` (or similarly environmental) failure during pipeline init
    does **not** leave `embeddingModelState.loaded === true` pinned to the
    hash fallback in a way that blocks a subsequent real attempt — a
    follow-up call after the condition is fixed succeeds with
    `backend: 'onnx'`.
  - a genuinely missing dependency (no transformers package importable)
    still memoizes the hash fallback permanently — this ADR must not
    regress that case into unbounded retry loops.
  - `generateLocalEmbedding` / `generateEmbedding`'s `backend`/`embedder`
    fields keep reporting accurately in both the recovered and the
    permanently-degraded case (ADR-390 regression guard).
- Manual repro: on a system-prefix global install as root with no
  pre-existing writable cache, run as an unprivileged user; confirm the
  model downloads into `~/.cache/ruflo/models` (or `TRANSFORMERS_CACHE` if
  set) rather than attempting a write under the package directory.
