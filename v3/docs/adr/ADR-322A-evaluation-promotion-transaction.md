# ADR-322A: Evaluation and promotion transaction model

- **Status**: Accepted — implemented
- **Parent**: ADR-322
- **Rollout flag**: `RUFLO_FLYWHEEL_TRANSACTION_V1`
- **Owner**: ruflo flywheel runtime

## Scope

This specification defines the boundary between evaluating a candidate and making it active. It owns purity, eligibility, compare-and-swap promotion, serving epochs, idempotency, concurrency, crash recovery, and temporary legacy behavior. It does not define how candidates are proposed (ADR-322B) or how receipts are encoded and verified (ADR-322C).

## State model

The promotion authority maintains one serializable state machine:

```text
ActivePolicyState {
  lineageId
  activeChampionRef
  activeGateVersion
  activePolicySchemaVersion
  activeSafetyEnvelopeRef
  ledgerHead
  servingEpoch
  transactionVersion
}

ReceiptState {
  receiptId
  promotedAt: timestamp | null
  promotionTransactionId: UUIDv7 | null
  status: evaluated | consumed | expired | revoked
}
```

Signed evaluation receipts are immutable. Consumption and promotion metadata live in `ReceiptState`.

## Interfaces

```text
evaluateFlywheelCandidate(input) -> EvaluationReceipt
promoteFlywheelCandidate(receiptId, confirmation) -> PromotionResult
materializeServingEpoch(servingEpoch) -> MaterializationResult
recoverPromotionState() -> RecoveryResult
```

`evaluateFlywheelCandidate` may persist evidence and receipts but cannot modify `ActivePolicyState`, runtime policy files, or served state.

`promoteFlywheelCandidate` is the only ADR-322 interface authorized to advance the active champion. It requires explicit confirmation for interactive CLI/MCP calls.

## Promotion compare-and-swap

Promotion is eligible only when:

```text
activeChampionRef == receipt.baselineRef
AND receipt.decision == "accepted"
AND receiptState.promotedAt == null
AND receiptState.status == "evaluated"
AND ledgerHead == receipt.expectedLedgerHead
AND receipt.gateVersion == activeGateVersion
AND receipt.policySchemaVersion == activePolicySchemaVersion
AND receipt.safetyEnvelopeRef == activeSafetyEnvelopeRef
AND receipt.expiresAt > transactionTime
```

Within one serializable transaction:

1. Persist the immutable promotion commit.
2. Mark `ReceiptState` consumed and bind its transaction ID.
3. Append lineage and advance the signed ledger head.
4. Compare-and-swap `activeChampionRef`.
5. Increment and record `servingEpoch`.
6. Record `promotedAt`, proposer/substitution identity, and recovery metadata.

All changes commit or none do. A transaction-capable store is preferred; a write-ahead journal is acceptable only when deterministic recovery is proven by the same fault suite.

## Serving

The committed active champion is authoritative. Runtime materialization is derived, idempotent state:

```text
ServedPolicyState {
  championRef
  servingEpoch
  materializedAt
  materializationHash
}
```

Materialization writes a complete epoch to a temporary location, validates its hash, then atomically switches the runtime pointer. A crash can leave the previous epoch served temporarily, but cannot create two authoritative champions. Recovery converges to the committed `ActivePolicyState`.

## Idempotency and concurrency

- A unique constraint covers `ReceiptState.receiptId` consumption.
- A unique monotonic constraint covers each lineage's `servingEpoch`.
- Repeating a successful transaction returns the recorded `PromotionResult`.
- Concurrent attempts using one receipt or baseline produce at most one commit.
- Stale baseline, ledger, gate, policy schema, safety envelope, expiry, or receipt state fails closed.

## Legacy boundary

For at most one release, legacy implicit application is available only with:

```text
RUFLO_FLYWHEEL_LEGACY_APPLY=1
```

Every use emits a structured deprecation event. New CLI/MCP surfaces never set or honor this flag. Without it, the compatibility wrapper evaluates only. The implicit-application path is removed in the following release.

## Required tests

1. Evaluation cannot modify active, served, or runtime policy state under fault injection.
2. One hundred concurrent attempts against one receipt produce exactly one promotion.
3. Stale baseline and ledger-head receipts are rejected.
4. Repeating a successful transaction is idempotent.
5. Process termination at every transaction and materialization boundary recovers to one active champion, one ledger head, one receipt state, and one serving epoch.
6. Legacy mutation is disabled by default, emits deprecation when enabled, and is unreachable from new CLI/MCP handlers.
