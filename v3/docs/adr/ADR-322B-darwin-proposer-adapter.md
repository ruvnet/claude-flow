# ADR-322B: Darwin proposer adapter

- **Status**: Accepted — implemented for bounded retrieval-policy candidates
- **Parent**: ADR-322
- **Rollout flag**: `RUFLO_FLYWHEEL_DARWIN_V1`
- **Owner**: ruflo Metaharness integration

## Scope

This specification defines proposer selection, Darwin invocation, archive translation, sandbox and resource controls, substitution behavior, and comparison with the local proposer. A proposer produces untrusted candidates only. It cannot issue promotion decisions or mutate active policy.

## Interface

```text
proposeCandidates({
  proposerMode,
  baselinePolicy,
  policySchemaVersion,
  selectionCorpusRef,
  safetyEnvelopeRef,
  budget,
  seed
}) -> CandidateArchive
```

`CandidateArchive` records:

```text
archiveVersion
requestedProposer
effectiveProposer
substitutionReason
packageName
packageVersion
packageIntegrity
invocationHash
baselineRef
selectionCorpusRef
safetyEnvelopeRef
seed
candidates[]
resourceUsage
completed
```

Each candidate has a canonical `candidateId`, mutation description, parent references, surface, raw proposer score, and policy-schema validation result. Proposer scores are selection metadata, not ruflo promotion evidence.

## Modes

- `local`: run the deterministic local proposer.
- `darwin`: require a compatible Darwin package and complete archive; any absence, incompatibility, timeout, malformed output, safety exit, or budget violation fails closed.
- `auto`: prefer Darwin. If it cannot complete, record the failure and permit local evaluation-only substitution.

An `auto` substitution cannot promote unless the active administrator-signed substitution policy explicitly allows `darwin -> local` for the current gate and safety-envelope versions. Default policy denies promotion.

## Darwin invocation

The initial adapter invokes:

```text
@metaharness/darwin@~0.8.0
metaharness-darwin evolve
--sandbox real|mock|agent
--selection pareto
--mutator deterministic|ruvllm
```

The adapter verifies package version, resolved package integrity, supported command/API shape, exit classification, complete archive schema, and candidate count before accepting output.

No model credential means only the deterministic mutator is permitted. `ruvllm` requires explicit confirmation and immutable ceilings for USD, requests, tokens, concurrency, wall time, and sandbox resources. Budget exhaustion cancels the run and produces no promotable archive.

## Safety and corpus boundaries

- All proposer output is untrusted and validated against the versioned policy schema.
- Candidates that expand the signed `SafetyEnvelope` are rejected before execution.
- Tool-composition and inter-agent channel mutations clear structural guards before sandboxing.
- Darwin reads only the selection corpus. It cannot access sealed promotion holdout or frozen-anchor answers.
- Selection, holdout, and anchor task IDs are bound to disjoint signed role manifests.

## Admissibility and ranking

Hard envelope limits for authorization, latency, cost, tokens, failure rate, evaluation cost, network, and concurrency are evaluated before Pareto ranking. Only admissible candidates enter the archive presented to ADR-322A.

## Comparative claim

Darwin is described as broader, not inherently superior. Any superiority claim requires a controlled comparison using identical baselines, selection budgets, sealed holdouts, gate versions, seeds, and resource accounting. Report quality lift, accepted-candidate rate, wall time, tokens, USD, and reproducibility for both Darwin and local modes.

## Required tests

1. Explicit Darwin mode fails closed for missing, incompatible, timed-out, malformed, incomplete, or over-budget runs.
2. `auto` substitution is fully recorded and evaluation-only by default.
3. Local mode is byte-reproducible for identical versioned inputs and platform contract.
4. Darwin cannot read sealed holdout or anchor answers.
5. Safety-envelope expansion is rejected before sandbox execution.
6. Package and invocation identity are bound into every archive and downstream receipt.
7. Only admissible candidates enter Pareto ranking.
