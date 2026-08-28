# ADR-381 — Sequential Promotion Evidence: α-Stream Governance, Reset Epochs, and accept/v2+seq

- **Status**: Proposed
- **Date**: 2026-08-10
- **Related**: ADR-176 (stateful flywheel / single-round proof-of-mechanism), ADR-322 (flywheel receipt protocol + atomic promotion transaction), ADR-150 (MetaHarness optional/removable augmentation), PR #2956 (strict sequential promotion evidence — the mechanism this ADR governs)
- **Prompted by**: the August-10 MetaHarness integration review, which found that per-candidate significance testing "does not control error across an adaptive candidate stream", and the follow-on question PR #2956 deliberately left open: what happens when the family-wise α budget is spent, and which promotion streams are covered.

## Context

PR #2956 added the mechanism: evaluation receipts carry task-level `pairedOutcomes`, and `promoteFlywheelCandidate` (the ADR-322 authority) requires an anytime-valid e-process verdict at an allocated per-test α, with allocation `α_k = α_total · 6/(π²k²)` so that `Σ α_k = α_total = 5%` across arbitrarily many adaptively-chosen candidates. The 1,000-null-simulation acceptance test measures 0.6% family-wise false promotion.

Three governance questions were intentionally deferred:

1. **Budget exhaustion.** The spend ledger (`sequentialTests`) only grows. As k rises, `α_k` shrinks polynomially and the e-value threshold `1/α_k` rises; a long-lived project eventually cannot promote anything. That is the mathematics working as designed — but without a legitimate recovery path it converts a safety property into a dead end, and operators will route around a gate that cannot be reopened, which is worse than a governed reset.

2. **Stream identity.** What is "the stream" the family-wise guarantee quantifies over? Receipt `lineageId` is unsuitable: it defaults to a fresh UUIDv7 per evaluation run, so scoping the ledger by `lineageId` would give every receipt its own stream at test 1 and silently void the control.

3. **Coverage.** The ADR-176 self-supervised generations loop (`runFlywheelGeneration`, driven by the daemon) is the *most active* adaptive candidate stream in the system — one candidate per tick, compounding on a persisted champion, with serve-after-shadow — and it still tested each generation at a fresh α=0.05. Extending the control there was deferred because it changes what `verifyReceiptBundle` must replay.

## Decision

### 1. The promotion ledger IS the stream

The α ledger is scoped to the ADR-322 **transaction state** (one per project root): one ledger head, one champion chain, one evidence stream. This matches the statistical object — every candidate tested against that chain is one look at the same adaptive process — and is immune to the auto-generated-`lineageId` trap. No per-lineage sub-streams.

### 2. Reset is an explicit, auditable governance action — an *evidence epoch*

`resetSequentialEvidence(root, { confirm, reason })` starts a new evidence epoch:

- **Requires** `confirm: true` and a non-empty human `reason`. At the CLI/MCP surface it passes through the same ADR-324 policy gate as promotion (`metaharness.evidence.reset`, destructive).
- **Expires all outstanding `evaluated` receipts.** The new epoch may only promote receipts evaluated *after* the reset — this structurally enforces the fresh-data requirement: you cannot reopen the budget and replay old evidence against it. (Under the null, evidence evaluated in the old epoch has already been "looked at"; carrying it into a fresh budget would be exactly the peeking the e-process exists to prevent.)
- **Archives the spend** into an append-only `sequentialResets` audit trail (`epoch`, timestamp, reason, tests spent, receipts expired) and increments `evidenceEpoch`. Nothing is deleted; a reviewer can reconstruct every epoch's spend.
- **Guarantee after reset**: family-wise false-promotion probability is ≤ α_total *per epoch*, and epochs are separated by an explicit, logged human decision with fresh evaluation data. That is the honest statement of what a governed reset can promise — the per-epoch bound is the invariant; the audit trail is what makes the epoch boundary a real governance event rather than a bypass.

Legitimate reasons to reset: baseline rollback, corpus replacement, a policy-schema migration, or a deliberate "we accept a new 5% budget for a new optimization campaign" decision. The `reason` field is free text precisely so the audit trail captures intent.

### 3. The ADR-176 generations loop adopts the control: `accept/v2+seq`

- `assembleBundle` accepts an optional `sequential` input (`testIndex`, `alphaTotal`, `lambda`). When present, the promotion rule version recorded in the bundle is **`accept/v2+seq`**, the e-process verdict over the bundle's own embedded per-task holdout becomes an additional conjunct (`promoted = accept() AND bootstrap-significant AND sequential-significant`), and the full verdict (`testIndex`, `alphaAllocated`, `eValue`, `threshold`, `informativePairs`, `significant`) is embedded in the bundle.
- **Replayability is preserved**: `verifyReceiptBundle` recomputes the e-process from the embedded holdout and the recorded `testIndex`/`alphaTotal`/`lambda`, for v2 bundles, and continues to verify v1 bundles under v1 semantics. A lineage may contain both — the rule version is pinned per bundle, which is the whole point of versioned rules.
- **Test index** = number of prior attempts in the persisted stream (`attempts.jsonl`) + 1. Every generation is one look, promoted or not, which is already exactly what `attempts.jsonl` records.
- **Fresh samples per test** come free: each tick harvests a fresh self-supervised corpus from the evolving store.
- **Interaction with plateau**: as k grows the threshold rises and the promotion rate falls; `detectPlateau` will report `local-optimum`/`optimizer-failure` more readily. This is correct — an exhausted budget *is* a plateau signal. `flywheelStatus` surfaces the remaining budget and the next test's threshold so the exhaustion is visible, not mysterious. Recovery for this loop is archival of the flywheel dir (a new stream with a new store state), which the status output points at; a finer-grained governed reset can be added later if operators need it.

### 4. Pre-flight power check — annotate evaluations, protect the gate

`minInformativePairsToClear(testIndex, cfg)` = ⌈ln(1/α_k)/ln(1+λ)⌉ is exported from the sequential-evidence module, and the check applies at two layers with different strengths:

- **Evaluation (soft)**: `evaluateFlywheelCandidate` computes the next test index from the transaction state before running and *annotates* the result (`sequentialPreflight: { viable, heldSize, minPairsRequired, nextTestIndex }`) when the promotion holdout cannot reach the threshold even on a perfect sweep. It does **not** refuse: project anchors may legitimately be as small as 4 tasks, evaluation has learn value independent of promotion (ledger, telemetry), and unsigned local receipts cannot promote anyway. Blocking evaluation would turn `flywheel run` into a permanent no-op for small projects.
- **Promotion (hard, α-free)**: `promoteFlywheelCandidate` refuses a receipt whose paired-outcome count is below the minimum for the next test index **before allocating an α index**. This costs no budget and is statistically sound: the refusal depends only on sample *size*, which is ancillary — independent of the outcomes — so no evidence has been "looked at". A doomed receipt therefore cannot waste α, and the refusal message states exactly how many paired tasks the next test requires.

## Consequences

- **State file**: `FlywheelTransactionState` gains `evidenceEpoch` (default 0) and `sequentialResets` (default empty). Both optional-on-read; version stays 1; pre-existing state needs no migration.
- **Operators** get `flywheel evidence-reset --reason … --confirm` (CLI) and `metaharness_flywheel { operation: "evidence-reset" }` (MCP). Both refuse without a reason.
- **The daemon loop** becomes strictly more conservative: late-stream generations need overwhelming evidence to promote. Serving safety was never dependent on this (shadow delay + drift canary + rollback are unchanged); what changes is that a long run of marginal "improvements" can no longer compound into the champion chain.
- **Not covered**: cross-project or cross-tenant α coordination (each project root is its own stream), and confidence-interval-style effect-size reporting (the e-value is a likelihood ratio, not an interval). Both are out of scope until a concrete need appears.

## Acceptance evidence

- Reset semantics under test: outstanding receipts expired, spend archived, epoch incremented, new-epoch receipts promote from test 1, expired receipts refused.
- v2 bundles: promoted only when all three conjuncts hold; `verifyReceiptBundle` replays v2 (and still v1) from embedded evidence alone; tampering with the recorded sequential verdict is detected.
- Pre-flight: an undersized holdout is annotated at evaluation time and refused at the gate without α spend; a viable holdout allocates and proceeds.
- The PR #2956 null-simulation guarantee is unchanged (per epoch).
