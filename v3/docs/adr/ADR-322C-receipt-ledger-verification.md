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

## Update (2026-08-19) — normative recomputation procedure, ledger status, projection status

Raised by ruflo#3069 during the ADR-322C contract extraction for the RuV Perpetual
Intelligence Runtime (ruflo#3066, PR #3067). Appended rather than edited into the
text above, per this repo's norms around honest documentation.

**The problem.** This ADR's central claim is that a verifier *recomputes* the
statistics rather than trusting the proposer's reported numbers. But the sections
above specify only the bootstrap **seed**, not the generator it drives, the
resampling procedure, or the decimal encoding of the results. An independent
verifier therefore could not reproduce a receipt's statistics from this document —
the only way to recompute correctly was to read `flywheel-receipt.ts`, which is a
copy, not an independent check. The recomputation requirement was unverifiable in
practice. The procedure below closes that; it is transcribed from
`flywheel-receipt.ts:206-307` and is normative from this Update onward.

### 1. Deterministic PRNG

```text
digest = SHA-256("ruflo/bootstrap/v1" || corpusHash || candidateId ||
                 baselineRef || evaluationRunId)      # concatenation, no separator
seedHex = lowercase hex of the full 32-byte digest    # recorded in the receipt
state   = uint32 big-endian read of digest[0..4]      # FIRST FOUR BYTES ONLY
```

Each draw advances a linear congruential generator and returns a value in `[0, 1)`:

```text
state = (1664525 * state + 1013904223) mod 2^32
draw  = state / 2^32
```

The multiplier, increment, and modulus are exact. `state` is unsigned throughout.
The first draw uses the *advanced* state, never the seed value itself.

### 2. Resampling procedure

`iterations` defaults to 10,000, must be an integer, and must be `>= 100`. Let `n`
be the length of `heldOutDeltas`.

```text
if n == 0:
    every resample mean is 0
else:
    for b in 0 .. iterations-1:
        total = 0
        for i in 0 .. n-1:
            total += heldOutDeltas[ floor(draw() * n) ]
        means[b] = total / n
```

Draw order is load-bearing: exactly `n` draws per iteration, consumed in sequence.
An implementation that draws indices in a different order, or draws once per
iteration, produces a different — and non-conforming — result.

```text
pairedBootstrapProbability  = count(means[b] > 0) / iterations      # strictly greater
pairedBootstrapDeltaCILow95 = the floor(0.025 * iterations)-th smallest of means
                              # 0-based order statistic (selection, not sorting;
                              # any correct selection algorithm is conforming)
```

### 3. Decision

```text
relativeLift = (candidateScore - baselineScore) / max(|baselineScore|, metricEpsilon)
metricEpsilon defaults to 1e-12
significant  = pairedBootstrapProbability >= 0.95 AND pairedBootstrapDeltaCILow95 > 0
accepted     = relativeLift >= 0.02 AND significant AND frozenAnchorRegression <= 0
decision     = "accepted" if (accepted AND every value in gates is true) else "rejected"
```

Comparisons are on the numeric values, before decimal encoding.

### 4. Decimal encoding of results

The `statistics` object must reproduce **byte-for-byte** under JCS, so its encoding
is part of the contract. Every fractional field is encoded by:

```text
1. fixed-point render at scale 12 (twelve digits after the decimal point)
2. strip trailing zeros, then a trailing decimal point if one remains
3. if the result is "" or "-0", emit "0"
```

So `0.0928571428571...` renders `"0.092857142857"`, `1` renders `"1"`, and `0`
renders `"0"`. This applies to `relativeLift`, `pairedBootstrapProbability`,
`pairedBootstrapDeltaCILow95`, and `frozenAnchorRegression`, and to the
`baselineScore`, `candidateScore`, and `heldOutDeltas` fields.

**A producer must compute the statistics from the encoded values, not from its
internal full-precision values.** A verifier has only the encoded strings, so any
precision the producer used but did not record is precision the verifier cannot
reproduce. Stated as a rule: decode `baselineScore`, `candidateScore`, and
`heldOutDeltas` back from their encoded form and compute from *those*, so producer
and verifier are evaluating identical inputs by construction.

**Known divergence (2026-08-19).** `createFlywheelReceipt` currently violates this:
it computes `statistics` from full-precision means while storing scale-12 strings,
so a receipt whose mean needs more than twelve decimals fails its own
`verifyFlywheelReceipt` with `statistical decision does not recompute`. Reproduced
with twenty-four 3-decimal task scores (mean `0.7687083333333332`, stored
`"0.768708333333"`), which shifts `relativeLift` by one unit in the last place.
Receipts with exactly-representable means are unaffected, which is why existing
fixtures pass. This is a defect against the rule above, not a change to it.

### 5. Ledger: what is implemented, what is aspirational

The §Ledger section above describes content-addressed segments binding
`segmentId`/`previousSegmentId`/`firstSequence`/`lastSequence`/`commits[]`/
`segmentMerkleRoot`/`createdAt`, plus a **signed** head under
`ruflo/flywheel-ledger-head/v1`. **That is not what `main` implements.** The
implementation (`flywheel-transaction.ts:553-568`, `619-636`) is a flat,
sequence-numbered `commits[]` array inside one transaction-state file:

```text
commitId   = SHA-256(JCS(commit with commitId omitted))
ledgerHead = SHA-256(JCS({ previous: <prior head>, commitId: <commitId> }))
genesis    = sha256:<64 zeros>
```

There are no segments, no `segmentMerkleRoot`, and **the head is not signed** — the
`ruflo/flywheel-ledger-head/v1` domain is specified but unused on `main`. Chain
integrity today rests on the hash chain plus the signed receipt each commit
consumes, not on a head signature.

Consumers anchoring across a repo boundary must therefore anchor the **receipt**
(`ruflo.flywheel-receipt/v1`), the only record type whose signature is implemented.
Anchoring a ledger head today means anchoring an unsigned hash-chain value, and
must be described that way. Segments and head signing remain the intended target;
this Update records the divergence rather than leaving consumers to read the ADR as
a description of what exists.

### 6. Flywheel projection is disabled

Per ADR-322 §"Current Metaharness capability inventory", external Flywheel receipt
projection is intentionally disabled until a projection can preserve ruflo's gate
and evidence semantics without information loss. No upstream round-trip is
available, so a consumer cannot export state and feed it back to confirm the
round-trip preserves meaning. Re-enabling it is gated on the ADR-322 phase-3
projection cross-check landing in CI; until then §Flywheel projection describes an
intended capability, not a shipped one.

### 7. Strictness is versioned

Unknown fields fail verification for a given schema version (§Canonical format).
A consequence worth stating: a verifier implementing `ruflo.flywheel-receipt/v1`
will reject a receipt from a future version that adds fields. That is the correct
behavior for a security property — fail closed on the unrecognized — but it means
schema evolution requires consumers to upgrade before they can verify newer
receipts, not merely to tolerate them.

A language-neutral extraction of this protocol, with JSON Schemas, worked examples,
and a conformance checklist, is maintained at
[`../spec/witness-receipt-contract.md`](../spec/witness-receipt-contract.md).
