# ADR-174 — Memory Distillation & Self-Optimizing Learning Loop

- **Status:** Proposed (finalized after Milestone 4 self-optimization lands the tuned defaults)
- **Date:** 2026-07-04
- **Deciders:** ruflo core
- **Related:** [ADR-170](ADR-170-agenticow-substrate.md) (agenticow substrate), [ADR-171](ADR-171-provenance-tiered-oracle.md) (provenance-tiered oracle + promote-gate), [ADR-172](ADR-172-fable-advisor-harness.md) (Fable advisor, cost-bounded), [ADR-173](ADR-173-remote-gpu-distillation.md) (remote GPU weight distillation)

## Context

Ruflo has been **recording** to `.swarm/memory.db` `memory_entries` for thousands of commits — 7,900+ entries, 100% embedded (384-dim), across `commands` (6k), `feedback` (0.9k, post-edit outcome records), `session`, `cost-tracking`, `tasks`. But the structured intelligence substrate the RETRIEVE→JUDGE→DISTILL→CONSOLIDATE pipeline is supposed to build — `reasoning_patterns`, `pattern_embeddings`, `episodes`, `causal_edges`, `consolidated_memories` — was **completely empty (0 rows)**. Only RETRIEVE (the embeddings) was ever populated.

### Root cause (the load-bearing finding)

The daemon's `consolidate` background worker — scheduled every 30 minutes and `enabled: true` by default (`worker-daemon.ts` `DEFAULT_WORKERS`) — was a **stub**: `runConsolidateWorker()` (`worker-daemon.ts:1443`) wrote a hardcoded `{patternsConsolidated: 0, memoryCleaned: 0, duplicatesRemoved: 0}` to a metrics JSON file and touched no database. Meanwhile the on-demand bridge functions that DO reach the real controllers (`bridgeStorePattern`, `bridgeRecordCausalEdge`, `bridgeConsolidate`) were only ever invoked one entry at a time by MCP callers, never driven in bulk against the accumulated corpus. So 6,000+ commits of "self-learning" recorded everything and distilled nothing. The visible symptoms were `Vectors ●0` (missing `vector_indexes`, fixed separately) and `🧠 0%` on the statusline (accurate — the intelligence substrate was empty).

There is also a structural gap: `reasoning_patterns`/`causal_edges` are populated by controllers that read from `episodes` (0 rows) — **not** from `memory_entries` directly. Nothing performed the `memory_entries → episodes` ETL.

## Decision

Build an incremental, **$0-by-default**, provenance-tagged **memory distillation service** that mines `memory_entries` into `episodes → reasoning_patterns (+ pattern_embeddings) → causal_edges`, replace the stub `consolidate` worker with it so the daemon does it automatically, use ruflo's own search tooling to tune the configuration against a held-out split, and promote the winning configuration as the platform default.

Named `memory distill …` — deliberately **not** `neural distill …`, which already exists as the GPU/LoRA **weight** distillation pipeline (ADR-150/173, weight-eft). Two unrelated "distill" surfaces must not collide.

### How it works

- **RETRIEVE** — reuse the embeddings already on every row (no re-embedding, $0).
- **JUDGE** — `feedback` entries are recorded post-edit outcomes = execution-observed ground truth → `oracle:test-exec` tier. Everything else → `proxy:structural`. (`judge:fable` is reserved for the explicitly opt-in, cost-bounded LLM path per ADR-172 — not enabled in the $0 default.)
- **DISTILL** — reuse the deterministic sub-millisecond extractor `structured-distill.ts` (`distillTrajectoryContent` → `{summary, detail, labels, paths}`); greedily cluster near-duplicate entries by cosine distance so N near-identical logs collapse into one pattern with `uses` = cluster size.
- **CONSOLIDATE** — write `episodes`, `reasoning_patterns`, `pattern_embeddings` (reusing the representative's existing vector as a Float32 BLOB), and weak co-occurrence `causal_edges`.
- **Promote gate (ADR-171)** — a pattern is `promoted` only if its tier is `oracle:test-exec` (or `judge:fable`). `proxy:structural` patterns are written but **never** promoted — visible for audit, excluded from promoted recall. Enforced in code, not just prose.

### Safety (the DB was just recovered from corruption)

- **Incremental** via a `distill_state` cursor (per namespace, by monotonic `rowid`) — never rescans processed rows.
- **Non-destructive** — never mutates or deletes `memory_entries`; only inserts into the previously-empty target tables.
- **Transactional** per batch — a failure rolls back the batch and advances no cursor.
- **quick_check gate** before any write — skips (does not throw) on a corrupt DB, deferring to `recoverMemoryDatabase`.
- **better-sqlite3 optional** — silent no-op if the native module is absent (WASM-only hosts).

## Parameter surface (alternative usage scenarios)

`memory distill run|status|config|tune` with:

| Flag | Default | Purpose |
|---|---|---|
| `--mode` | `dry-run` first / `continuous` in daemon | `dry-run \| one-shot \| continuous` |
| `--budget-usd` | `0` | `0` = offline structural ($0). `>0` unlocks the cost-capped Fable judge (ADR-172) |
| `--judge` | `structural` | `structural \| fable`; `fable` requires `--budget-usd > 0` |
| `--namespace` | all | comma-separated scope (e.g. `feedback,commands`) |
| `--batch-size` | 200 (tuned by M4) | rows per transaction |
| `--dedup-distance` | 0.12 (tuned by M4) | cosine distance for pattern clustering |
| `--consolidation-cadence` | 30m | daemon distill cadence |
| `--promote-threshold` | tier-based | min provenance tier that sets `promoted=true` |
| `--aggressive` / `--conservative` | conservative | preset bundles |
| `--since` | cursor-driven | override incremental start (re-backfill) |
| `--dry-run` | off in continuous | report counts, no writes |
| `--max-entries` | unbounded/run | per-invocation work cap |
| `--config <path>` | none | load the platform-default JSON config |

## Self-optimization (ruflo tuning ruflo — Milestone 4)

Objective metric (computed $0, offline): retrieval uplift (MRR@10 / recall@10 of pattern search on a held-out query set derived from held-out `feedback` task descriptions) vs. the raw-`memory_entries` baseline, plus causal precision and $0/latency guards. Time-based train/held-out split (earliest ~80% tune, most-recent ~20% scored once) so tuning isn't circular. Param grid searched via `metaharness_evolve` (MAP-Elites) with a plain grid-search fallback when the optional dep is absent — both $0, both real (measured, not claimed). Search runs only against **isolated copies**, never the live/daemon-attached DB.

## Measured (first M1 run, on a copy of the real 7,900-entry DB)

7,899 entries → **4,260 reasoning_patterns** (4,259 pattern_embeddings, 4,260 episodes, 4,258 causal_edges); 182 promoted (oracle tier from `feedback`), 4,078 proxy. `memory_entries` unchanged. Dry-run wrote nothing. Second run processed 0 (idempotent). 0 proxy rows promoted.

## Alternatives considered

- **New `distill` worker type** vs. reusing the existing `consolidate` worker — chose reuse for backward-compat with `-w consolidate` scripts, `doctor`, and docs.
- **LLM-judge by default** vs. structural-by-default — chose structural for $0 discipline; LLM judge is opt-in + cost-bounded (ADR-172).
- **Full rescan** vs. **incremental cursor** — chose incremental for safety on a recently-corrupted DB.
- **Reuse `bridgeStorePattern`** (controller path) vs. **direct table writes** — chose direct writes for the initial service so `pattern_embeddings` is guaranteed populated (the controller fallback silently skips it) and so it is testable without the full agentdb controller stack; controller-path integration + health surfacing is a follow-up.

## Rollback

Disable via `-w` omission or `--no-distill`. All writes are additive to the previously-empty target tables and never touch `memory_entries`, so full revert = stop the worker and optionally `DELETE FROM reasoning_patterns/pattern_embeddings/episodes/causal_edges` — zero data loss on the source.

## Status of milestones

- **M0 safety harness / M1 distillation service** — implemented + tested.
- **M2 CLI surface** (`memory distill run|status|config`) — implemented + tested.
- **M3 daemon wiring** (replaced the stub `consolidate` worker) — implemented + tested; the loop is now self-sustaining.
- **M4 self-optimization** (`distill-tuning.ts` + `scripts/tune-distill.mjs`) — implemented + tested; winner `batchSize=200, dedupDistance=0.2`, held-out MRR@10 0.753 vs 0.749 baseline (measured on-par).
- **M5 platform-default promotion** — the M4 winner is the daemon default (`CONSOLIDATE_DEDUP_DISTANCE = 0.2` in `worker-daemon.ts`); override per-run via `memory distill`.
