# ADR-174 — Memory Distillation & Self-Optimizing Learning Loop

- **Status:** Accepted — M0–M5 implemented + tested (pending merge of PR #2570)
- **Date:** 2026-07-04
- **Deciders:** ruflo core
- **Related:** [ADR-170](ADR-170-agenticow-substrate.md) (agenticow substrate), [ADR-171](ADR-171-provenance-tiered-oracle.md) (provenance-tiered oracle + promote-gate), [ADR-172](ADR-172-fable-advisor-harness.md) (Fable advisor, cost-bounded), [ADR-173](ADR-173-remote-gpu-distillation.md) (remote GPU weight distillation)

## Context

Ruflo has been **recording** to `.swarm/memory.db` `memory_entries` for thousands of commits — 7,900+ entries, 100% embedded (384-dim), across `commands` (6k), `feedback` (0.9k, post-edit outcome records), `session`, `cost-tracking`, `tasks`. But the structured intelligence substrate the RETRIEVE→JUDGE→DISTILL→CONSOLIDATE pipeline is supposed to build — `reasoning_patterns`, `pattern_embeddings`, `episodes`, `causal_edges`, `consolidated_memories` — was **completely empty (0 rows)**. Only RETRIEVE (the embeddings) was ever populated.

### Root cause (the load-bearing finding)

The daemon's `consolidate` background worker — scheduled every 30 minutes and `enabled: true` by default (`worker-daemon.ts` `DEFAULT_WORKERS`) — was a **stub**: `runConsolidateWorker()` (`worker-daemon.ts:1443`) wrote a hardcoded `{patternsConsolidated: 0, memoryCleaned: 0, duplicatesRemoved: 0}` to a metrics JSON file and touched no database. Meanwhile the on-demand bridge functions that DO reach the real controllers (`bridgeStorePattern`, `bridgeRecordCausalEdge`, `bridgeConsolidate`) were only ever invoked one entry at a time by MCP callers, never driven in bulk against the accumulated corpus. So 6,000+ commits of "self-learning" recorded everything and distilled nothing. The visible symptoms were `Vectors ●0` (missing `vector_indexes`, fixed separately) and `🧠 0%` on the statusline (accurate — the intelligence substrate was empty).

There is also a structural gap: `reasoning_patterns`/`causal_edges` are populated by controllers that read from `episodes` (0 rows) — **not** from `memory_entries` directly. Nothing performed the `memory_entries → episodes` ETL.

## Decision

Build an incremental, **$0-default** memory distillation service that converts recorded `memory_entries` into auditable **episodes, patterns, embeddings, and explicitly weak relational edges**. The daemon runs it through the existing `consolidate` worker. Promotion is **provenance-gated**: only execution-observed feedback (or explicitly budgeted Fable judgments) can produce *promoted* patterns; structural patterns remain searchable but non-promoted. Configuration is tuned against a held-out split by ruflo's own search tooling, and the winner is promoted as the platform default **only if it satisfies the promotion rule below** (retrieval-neutral + measurable secondary gain).

Named `memory distill …` — deliberately **not** `neural distill …`, which already exists as the GPU/LoRA **weight** distillation pipeline (ADR-150/173, weight-eft). Two unrelated "distill" surfaces must not collide.

### How it works

- **RETRIEVE** — reuse the embeddings already on every row (no re-embedding, $0).
- **JUDGE** — `feedback` entries are recorded post-edit outcomes = execution-observed ground truth → `oracle:test-exec` tier. Everything else → `proxy:structural`. (`judge:fable` is reserved for the explicitly opt-in, cost-bounded LLM path per ADR-172 — not enabled in the $0 default.)
- **DISTILL** — reuse the deterministic sub-millisecond extractor `structured-distill.ts` (`distillTrajectoryContent` → `{summary, detail, labels, paths}`); greedily cluster near-duplicate entries by cosine distance so N near-identical logs collapse into one pattern with `uses` = cluster size.
- **CONSOLIDATE** — write `episodes`, `reasoning_patterns`, `pattern_embeddings` (reusing the representative's existing vector as a Float32 BLOB; guaranteed **1:1** — a cluster with no parseable vector is skipped, never producing an embedding-less pattern), and **weak relational edges** (see below).
- **Promote gate (ADR-171)** — a pattern is `promoted` only if its tier is `oracle:test-exec` (or `judge:fable`). `proxy:structural` patterns are written but **never** promoted — visible for audit, excluded from promoted recall. Enforced in code, not just prose.

### Relational edges are NOT causal proof (high-risk naming)

The `causal_edges` table name is a schema-compatibility artifact (agentdb owns it) and **overclaims** what this service writes. We emit **weak co-occurrence** edges, not established causation. To prevent downstream systems from treating them as causal proof, every edge carries an explicit contract in its metadata:

```
edge_type       = cooccurrence            (never temporal_precedes / intervention_observed here)
provenance_tier = proxy:structural
confidence      = 0.3                      (weak; never asserted as proof)
promoted        = false
```

**Rule (enforced):** proxy co-occurrence edges **may rank retrieval** but **may not justify autonomous action**. Only an `intervention_observed`/oracle-backed edge (a future tier, produced by the doubly-robust `NightlyLearner` path, not by this structural service) could be `promoted`. This is the single biggest future failure mode — a memory system emitting plausible-but-false causal explanations — and the contract exists to foreclose it.

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
| `--dedup-distance` | `0.2` | cosine distance for clustering; promoted after M4 tuning (see promotion rule) |
| `--consolidation-cadence` | 30m | daemon distill cadence |
| `--promote-threshold` | tier-based | min provenance tier that sets `promoted=true` |
| `--aggressive` / `--conservative` | conservative | preset bundles |
| `--since` | cursor-driven | override incremental start (re-backfill) |
| `--dry-run` | off in continuous | report counts, no writes |
| `--max-entries` | unbounded/run | per-invocation work cap |
| `--config <path>` | none | load the platform-default JSON config |

## Self-optimization (ruflo tuning ruflo — Milestone 4)

Objective metric (computed $0, offline): retrieval (MRR@10 / recall@10 of pattern search on a held-out query set derived from held-out `feedback`/`command` entries) vs. the raw-`memory_entries` baseline, plus secondary metrics (pattern-count compression, latency) and a proxy-promotion-violation guard. Time-based train/held-out split (earliest ~80% tune, most-recent ~20% scored once) so tuning isn't circular. Grid searched via `metaharness_evolve` (MAP-Elites) with a plain grid-search fallback — both $0, both real. Search runs only against **isolated copies**, never the live/daemon-attached DB.

### Promotion rule for a tuned default (honest framing)

A tuned config is promoted to the platform default **only if all hold**:

```
MRR@10     >= baseline − 0.002
recall@10  >= baseline − 0.002
pattern count reduced by >= 15%          (the actual value it earns its keep on)
p95 distill latency < 250 ms / 200-row batch
proxy-promotion violations == 0
```

This is deliberate: the M4 retrieval delta is a **statistical tie** (MRR@10 0.753 vs 0.749 baseline = +0.53% relative — not a retrieval win), so `dedupDistance=0.2` is **not** justified as retrieval-improving. It is justified as **compression that is retrieval-neutral**: on the real corpus it produces **2,723 patterns vs 4,350 at 0.12 — a 37% reduction** — at **11.6 ms / 200-row batch** and **0 proxy-promotion violations**. Smaller substrate, same recall, lower daemon cost. That is the value claim; retrieval parity is the guardrail, not the selling point.

## Measured (on copies of the real ~7,900-entry DB)

- **Default `dedupDistance=0.2`:** 7,899 entries → **2,723 patterns** (2,723 embeddings — 1:1, 2,723 episodes, 2,722 edges); 99 promoted (oracle tier from `feedback`), rest proxy. 11.6 ms/200-row batch.
- **vs `dedupDistance=0.12`:** 4,350 patterns (37% more) at 14.5 ms/batch — same held-out recall.
- **Invariants (both):** `memory_entries` unchanged; dry-run wrote nothing; second run processed 0 (idempotent); **0 proxy rows promoted**; **0 patterns without an embedding**.

## Alternatives considered

- **New `distill` worker type** vs. reusing the existing `consolidate` worker — chose reuse for backward-compat with `-w consolidate` scripts, `doctor`, and docs.
- **LLM-judge by default** vs. structural-by-default — chose structural for $0 discipline; LLM judge is opt-in + cost-bounded (ADR-172).
- **Full rescan** vs. **incremental cursor** — chose incremental for safety on a recently-corrupted DB.
- **Reuse `bridgeStorePattern`** (controller path) vs. **direct table writes** — chose direct writes for the initial service so `pattern_embeddings` is guaranteed populated (the controller fallback silently skips it) and so it is testable without the full agentdb controller stack; controller-path integration + health surfacing is a follow-up.

## Operational invariants (the difference between a memory feature and a safe learning loop)

Enforced in code + tests; auditable in SQL at any time.

| Invariant | Required check |
|---|---|
| Source preservation | `memory_entries` row count + content unchanged after a run |
| Idempotence | a second run processes 0 rows at the same cursor |
| Promotion safety | `proxy:structural AND promoted=true` count == 0 |
| Embedding coverage | every pattern has exactly one `pattern_embedding` |

```sql
-- Promotion safety (must be 0)
SELECT COUNT(*) AS proxy_promoted FROM reasoning_patterns
WHERE json_extract(metadata,'$.provenance_tier') = 'proxy:structural'
  AND json_extract(metadata,'$.promoted') = 1;

-- Embedding coverage (must be 0)
SELECT COUNT(*) AS patterns_without_embeddings
FROM reasoning_patterns rp
LEFT JOIN pattern_embeddings pe ON pe.pattern_id = rp.id
WHERE pe.pattern_id IS NULL;

-- Incremental cursor position
SELECT namespace, last_rowid FROM distill_state ORDER BY namespace;

-- Provenance / promotion distribution
SELECT json_extract(metadata,'$.provenance_tier') AS tier,
       json_extract(metadata,'$.promoted') AS promoted, COUNT(*) AS n
FROM reasoning_patterns GROUP BY tier, promoted ORDER BY tier, promoted;
```

(Promotion/provenance live in the `metadata` JSON, not as columns, because the `reasoning_patterns` schema is owned by agentdb — the JSON-extract checks above are the canonical audit.)

## Business value

This turns ruflo memory from a passive audit log into a governed, usable learning substrate **without adding inference cost**. The enterprise story is not "4,260 patterns" — it is:

```
7,899 raw entries  →  2,723 structured patterns (37% compressed, retrieval-neutral)
   99 execution-backed promoted memories
    0 proxy-promoted violations
    0 source mutations
    0 patterns without an embedding
   $0 default runtime (no model spend)
```

Governed memory consolidation with provenance, rollback, and no surprise model spend.

## Acceptance test

Run distill **twice** on a copy of a production DB and require: `memory_entries` unchanged (count + content hash); the second run processes **0** rows; `proxy_promoted == 0`; `patterns_without_embeddings == 0`; and held-out MRR@10 no worse than baseline by more than 0.002. (Covered by `__tests__/memory-distillation.test.ts` + `distill-tuning.test.ts`.)

## Security — signed provenance for the helper auto-refresh

Hook fixes (like the failure-capture change) propagate via a version-stamped
auto-refresh: on CLI startup, an initialized project's `.claude/helpers/*.cjs`
are silently re-copied from the installed package if their stamp is stale. Since
those helpers **auto-execute on every tool use**, the refresh is gated by
**Ed25519 signed provenance** (fail-closed):

- `scripts/sign-helpers.mjs` (publish-time) hashes the critical helpers, builds a
  manifest `{version, files:{name→sha256}}`, signs it with ruflo's private key,
  and writes `.claude/helpers/helpers.manifest.json`. The private key lives in
  **GCP Secret Manager** (`RUFLO_HELPERS_SIGNING_SECRET=ruflo-helpers-signing-key`,
  fetched via `gcloud secrets versions access`), with a local-PEM fallback
  (`RUFLO_HELPERS_SIGNING_KEY`) for air-gapped signing. It is **never committed**.
- The public key is baked into `src/init/helper-signing.ts` (`RUFLO_HELPERS_PUBKEY`).
- Before the refresh installs any helper, it verifies the manifest signature
  against the baked key AND each source helper's SHA-256 against the manifest. A
  tampered helper or manifest — e.g. a sibling package's `postinstall` overwriting
  on-disk hook code — is **refused, not propagated**, and the CLI warns.
- Threat model: this closes post-install / on-disk tampering of the helper files.
  It does not defend against a wholesale-compromised CLI (which could replace the
  baked key too) — but at that point the attacker already owns the binary you run.
- **Publish requirement:** re-run `sign-helpers.mjs` whenever a critical helper
  changes. The `helper-signing.test.ts` "hashes match shipped files" test fails in
  CI if a helper is changed without re-signing, so a stale manifest cannot ship.

## Rollback

Disable via `-w` omission or `--no-distill`. All writes are additive to the previously-empty target tables and never touch `memory_entries`, so full revert = stop the worker and optionally `DELETE FROM reasoning_patterns/pattern_embeddings/episodes/causal_edges` — zero data loss on the source.

## Status of milestones

- **M0 safety harness / M1 distillation service** — implemented + tested.
- **M2 CLI surface** (`memory distill run|status|config`) — implemented + tested.
- **M3 daemon wiring** (replaced the stub `consolidate` worker) — implemented + tested; the loop is now self-sustaining.
- **M4 self-optimization** (`distill-tuning.ts` + `scripts/tune-distill.mjs`) — implemented + tested. Winner `batchSize=200, dedupDistance=0.2` promoted under the promotion rule above: retrieval-neutral (MRR@10 0.753 vs 0.749 — a tie) but **37% fewer patterns** at 11.6 ms/batch with 0 violations. Sold as safe compression, not retrieval lift.
- **M5 platform-default promotion** — the M4 winner is the default in both the service (`dedupDistance` default 0.2) and the daemon (`CONSOLIDATE_DEDUP_DISTANCE = 0.2`); `--aggressive`=0.3 / `--conservative`=0.1 bracket it; override per-run via `memory distill`.
