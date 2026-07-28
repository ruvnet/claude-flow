# ADR-322C: Receipt, ledger, and verification protocol

- **Status**: Accepted — implemented
- **Parent**: ADR-322
- **Rollout flag**: `RUFLO_FLYWHEEL_RECEIPT_V1`
- **Owner**: ruflo verification and lineage

## Scope

This specification defines canonical encoding, identifiers, evidence provenance, statistical decisions, signatures, ledger continuity, independent verification, and projection to `@metaharness/flywheel`. It does not authorize promotion; ADR-322A consumes a verified accepted receipt.

## Canonical format

```text
Canonical JSON: RFC 8785 JCS
Digest:         SHA-256
Signature:      Ed25519(domainPrefix || 0x00 || canonicalBytes)
Content ID:     sha256:<lowercase-hex>
Timestamp:      RFC 3339 UTC as YYYY-MM-DDTHH:mm:ss.sssZ
```

Non-finite numbers and negative zero are forbidden. Signed policy fractions use schema-quantized decimal strings or scaled integers. Metrics declare scale; currency uses integer micros plus ISO-4217 currency, duration uses integer microseconds, and energy uses integer microjoules when available. Unknown fields fail verification for a given schema version.

## Identity domains

```text
candidateId     = SHA-256(JCS(candidate policy))
evaluationRunId = UUIDv7 per execution attempt
receiptId       = SHA-256(JCS(unsigned receipt payload))
lineageId       = UUIDv7 per persistent evolutionary lineage
```

Repeated candidate executions share `candidateId` but receive distinct run and receipt identities.

## RufloFlywheelReceiptV1

The unsigned payload contains:

```text
schemaVersion
receiptIdDomain
lineageId
candidateId
evaluationRunId
baselineRef
expectedLedgerHead
candidatePolicyRef
gateVersion
policySchemaVersion
safetyEnvelopeRef
proposerIdentity
proposerSubstitution
corpusRoleManifestRef
heldoutEvidenceRef
anchorEvidenceRef
canaryEvidenceRef
driftEvidenceRef
replayEvidenceRef
receiptCoverageEvidenceRef
resourceEvidenceRef
statisticalDecision
termVerification[]
decision
issuedAt
expiresAt
```

Every evidence object records origin/provenance type, producer or attestor, authority scope, subject, transformation lineage, content hash, schema version, and collection time. Each authorizing term is labeled `recomputed`, `signature-verified`, or `trusted-assertion`.

## Default statistical rule

```text
relativeLift >= 0.02
AND pairedBootstrapProbability(candidate > baseline) >= 0.95
AND pairedBootstrapDeltaCILow95 > 0
AND frozenAnchorRegression <= 0
```

The paired bootstrap uses 10,000 task-level paired resamples. Its deterministic seed is:

```text
SHA-256("ruflo/bootstrap/v1" ||
       corpusHash ||
       candidateId ||
       baselineRef ||
       evaluationRunId)
```

The receipt records the rule, metric epsilon, sample count, seed, implementation version, quantile rule, point estimates, probability, confidence interval, and paired deltas or their content-addressed object. Gate-rule changes require a new version and are not retroactive.

## Signatures and keys

Receipt domain:

```text
ruflo/flywheel-receipt/v1
```

Ledger-head domain:

```text
ruflo/flywheel-ledger-head/v1
```

Keys use ADR-103's provider mechanism but a distinct purpose/domain. Private material remains outside the repository. Receipts carry public-key ID, algorithm, purpose, issuance time, and rotation/revocation metadata.

## Ledger

The ledger consists of immutable, content-addressed segments. Each segment binds:

```text
segmentId
previousSegmentId
firstSequence
lastSequence
commits[]
segmentMerkleRoot
createdAt
```

A signed head binds `lineageId`, current segment, current sequence, active champion, gate version, and timestamp. Archiving may move segments but cannot delete continuity evidence or report a truncated chain as complete.

Promotion fails closed if the promotion commit and new head cannot be durably committed by ADR-322A.

## Verification

A verifier:

1. Parses the declared schema and rejects unknown or invalid fields.
2. Reconstructs JCS bytes and verifies content IDs and signatures.
3. Resolves every evidence reference and verifies provenance/authority.
4. Recomputes all reproducible terms, statistics, and the decision.
5. Checks corpus-role disjointness and sealed manifests.
6. Checks baseline, safety envelope, gate, policy schema, expiry, and ledger continuity.
7. Reports every term as recomputed, signature-verified, or trusted assertion.

Verification cannot label a promotion independently verified while any authorizing term remains an unapproved assertion.

## Flywheel projection

The adapter projects ruflo policy and evidence into `@metaharness/flywheel` types and round-trips the ruflo envelope unchanged. Because the upstream string-valued policy and four-axis evidence are narrower, projection loss is explicit. Any loss affecting an authorizing term prevents an interoperability claim and can never weaken the ruflo gate.

## Required tests

1. Altering any canonical receipt byte or referenced object fails verification.
2. All authorizing terms reproduce from the fixture or bind to an approved scoped attestor.
3. Float/decimal fixtures produce identical hashes across supported runtimes.
4. Repeated candidate runs retain candidate identity but have distinct run and receipt identities.
5. Segment removal, reordering, or parent alteration breaks head-to-genesis verification.
6. Key revocation and rotation produce the declared historical/current verification behavior.
7. The Flywheel adapter round-trips without loss of ruflo-authorizing evidence; projection loss blocks interoperability claims.
8. Removing optional packages does not disable native receipt or ledger verification.
