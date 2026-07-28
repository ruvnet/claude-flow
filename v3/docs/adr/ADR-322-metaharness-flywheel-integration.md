# ADR-322: Adopt `@metaharness/{flywheel,darwin}` as pluggable engines behind ruflo's ADR-176 self-improvement flywheel

- **Status**: Accepted — phases 0–2 implemented
- **Date**: 2026-07-28
- **Related**: ADR-176 (self-optimizing harness flywheel — the loop that already exists), ADR-150 (metaharness integration surfaces), ADR-321 (metaharness/router hard dependency), ADR-153 (Darwin/GEPA surfaces), ADR-148/149 (cost-optimal router), ADR-103 (Ed25519 witness manifest), upstream agentic-flow ADR-075 (sister integration), upstream agent-harness-generator ADR-145 (router as an evolvable surface, *Proposed*)
- **Grounded in** (RuvNet brain, read this turn): `agent-harness-generator/packages/darwin-mode/package.json` (`@metaharness/darwin@0.8.0`), npm `@metaharness/flywheel@0.1.7` package surface, `agentic-flow/docs/adr/ADR-075`, and ruflo's own `src/services/harness-flywheel*.ts` / `evolve-proof.ts` / `harness-improvement-ledger.ts`.

## Implementation status

Phases 0–2 are implemented in the CLI package:

- `evaluateFlywheelCandidate` is non-mutating. `runFlywheelTick` preserves implicit application for one compatibility cycle only when `RUFLO_FLYWHEEL_LEGACY_APPLY=1`.
- `flywheel-receipt.ts` implements canonical JSON, distinct candidate/run/receipt identities, deterministic paired-bootstrap decisions, Ed25519 domain separation, and independent statistical recomputation.
- `flywheel-transaction.ts` implements an O_EXCL cross-process lock and one atomic, directory-fsynced compare-and-swap state containing receipt consumption, ledger head, active champion, and serving epoch. Runtime materialization is derived and recoverable.
- `flywheel-proposer.ts` implements `local|auto|darwin`, fail-closed explicit Darwin selection, evaluation-only auto substitution, hard admissibility ceilings, and Pareto filtering before evaluation. The runtime consumes the resulting archive through `candidatePolicies`; Darwin adapters remain candidate generators and never gain promotion authority.
- `ruflo metaharness evolve`, `bench`, and `flywheel run|status|receipts|history|promote` are first-class CLI verbs. `metaharness_flywheel` provides the corresponding MCP surface.
- `@metaharness/darwin@^0.8.0` and `@metaharness/flywheel@^0.1.7` are optional dependencies guarded by `scripts/check-metaharness-pins.mjs`. Removing them leaves the local receipt, transaction, and proposer path operational.
- The acceptance suite covers canonicalization, signer trust, one-byte tampering, statistical recomputation, hard resource constraints, explicit-Darwin failure, safe auto fallback, stale baselines, missing evidence classification, crash recovery, and 100 concurrent promotion attempts producing exactly one commit.

Phases 3–4 remain explicitly out of scope for activation: tool/model-policy evolution and unattended `/loop` promotion stay disabled until their separate privilege, spend, corpus-isolation, and production rollout gates are accepted.

## Context

The user wants ruflo to "better integrate metaharness" using the three published npm packages: `metaharness`, `@metaharness/darwin`, and `@metaharness/flywheel`. Grounding the current state (not from memory) changes the shape of the answer.

### What each package is

| Package | Version | Role in the "freeze the model, evolve the harness" thesis |
|---|---|---|
| `metaharness` | 0.4.1 | Umbrella / scaffolder CLI — **DESCRIBE**: `score` (5-dim readiness), `genome`, `mint`, `mcp-scan`, `threat-model`, provenance `sign/verify`. |
| `@metaharness/darwin` | 0.8.0 | The evolve **ENGINE** — **PROPOSE**: mutate one of 7 policy surfaces (`planner`, `contextBuilder`, `reviewer`, `retryPolicy`, `toolPolicy`, `memoryPolicy`, `scorePolicy`), sandbox-score each, keep measured wins, build a Pareto **archive**. Bin `metaharness-darwin`; `evolve` / `bench create|verify`. Upstream benchmark claims are informative only; they are not evidence for a ruflo promotion unless accompanied by a reproducible corpus, receipt, model/pricing snapshot, and run identifier. |
| `@metaharness/flywheel` | 0.1.7 | The **LOOP** — **GOVERN**: "a verifiable self-improvement loop … promote only what proves lift." Keywords: `promotion`, `lineage`, `receipts`. ESM library with `.` and `./cli` exports (no `bin` — imported/`/cli`, not `npx`). |

### What ruflo already has (ADR-176) — the load-bearing fact

Ruflo did **not** wait for a published flywheel. It already ships a mature self-improvement loop in `src/services/`:

- **`harness-flywheel.ts` — `runFlywheelTick`**: `HARVEST` a benchmark corpus from the install's real store (self-supervised) blended with the human-labeled ADR-081 anchor → `BASELINE` = active champion → `PROPOSE` neighbor configs and pick the best on a **TRAIN** split (a *local deterministic hill-climb*) → `GATE` the winner on a **HELD-OUT** split with a conjunctive rule: `held_out_improves AND redblue(anchor-no-regress) AND drift ≤ thr AND replay-deterministic AND receipt_coverage AND canary-no-worse`. **Current implementation note:** an accepted result calls `applyChampionParams` inside `runFlywheelTick`; this function is not a dry-run boundary.
- **`harness-improvement-ledger.ts`**: best-effort bounded JSONL. Accepted champions chain `baselineRef == previous championRef` within the retained window, but rotation discards old entries and write failures are swallowed. It is useful operational telemetry, not yet a complete append-only audit history.
- **`harness-flywheel-generations.ts`**: stateful, compounding lineage — each daemon tick uses the persisted champion as the next baseline. The latest promoted champion is automatically served at the start of the following tick (a one-generation delay), not held indefinitely for manual promotion.
- **`evolve-proof.ts`**: a single-round proof-of-mechanism. Held-out scores and significance are recomputed, but the verifier currently trusts the recorded canary rollback rate because the raw canary slice is not embedded.
- **`harness-flywheel-runtime.ts`**: binds the loop to the live neural store; opt-in via `RUFLO_HARNESS_LOOP`; never throws.

Ruflo's gate evaluates more local safety signals than the 0.1.x package surface: anchor no-regression, canary isolation, drift bound, replay-determinism, and receipt coverage. Those signals are valuable, but the current persistence and serve boundaries do not yet justify claims of complete external verifiability or manual-only serving. The deterministic local path is pure Node and costs $0.

### Current Metaharness capability inventory

“Integrated” currently means that a capability has an MCP tool or plugin wrapper that an operator can invoke. It does **not** mean that the ADR-176 runtime flywheel calls it automatically.

| Capability | Current exposure | Used by ADR-176 runtime flywheel today? | Change required by this ADR |
|---|---|---:|---|
| `metaharness score` / `genome` | CLI subcommands, plugin scripts, and `metaharness_score` / `metaharness_genome` MCP tools | No | Admit versioned descriptors as optional fitness metadata; they do not authorize promotion |
| MCP scan, threat model, mint, audit/drift/similarity | CLI subcommands and MCP/plugin surfaces | No | Keep as describe/audit inputs; bind any promotion-relevant output into the receipt |
| Darwin `evolve` | `metaharness_evolve`, `ruflo metaharness evolve`, and `evolve.mjs`; shells out through the pinned `_darwin.mjs` wrapper | Through the ADR-322B proposer contract when a Darwin invoker is supplied | Keep Darwin restricted to PROPOSE; ruflo remains promotion authority |
| Darwin `bench create\|verify` | `metaharness_bench`, `ruflo metaharness bench`, and `bench.mjs`; a verified suite can be passed to on-demand `evolve` | As an explicit proposal/evaluation input, never an authority input | Complete signed corpus-role manifests before unattended use |
| Darwin security bench | `metaharness_security_bench` MCP tool and plugin script | No | Treat as an additional security signal or CI job, not as a substitute for structural authorization invariants |
| Darwin GEPA | `ruflo metaharness gepa`, `metaharness_gepa`, and `gepa.mjs` for genome load/validate/render/analyze; optimization remains behind `metaharness_evolve` | No | Permit GEPA-derived candidates through the same proposer and authoritative ruflo gate |
| Metaharness `learn` | `ruflo metaharness learn`, `metaharness_learn`, and `learn.mjs`; dry-run by default and requires a checkout for real runs | No | Keep opt-in and subject model-backed runs to the same immutable cost envelope |
| Red/blue adversarial testing | `ruflo metaharness redblue`, `metaharness_redblue`, and plugin scripts | Only through existing local gate-specific logic, not as the upstream Flywheel loop | Version and bind the exact red/blue evidence used by a promotion |
| `@metaharness/router` | Hard dependency and independently callable routing product | No; `modelPolicy` is not an evolvable flywheel surface | Add constrained `modelPolicy` only after the signed `SafetyEnvelope` exists |
| `@metaharness/flywheel` | Optional dependency plus API pin guard; ruflo-native `flywheel` CLI/MCP surface | Interoperability package, not promotion authority | Add projection cross-check before external receipt exchange is enabled |

The former CLI and dependency exposure gaps are closed. External Flywheel receipt projection remains intentionally disabled until a projection can preserve ruflo's stronger gate and evidence semantics without information loss.

### The actual gaps (what "better integrate" means here)

1. **The PROPOSE step is narrow.** ADR-176 explores by *local deterministic hill-climb over neighbor configs*. `@metaharness/darwin` provides a broader candidate-search mechanism — 7 typed policy surfaces, sandbox scoring, crossover/epistasis, MAP-Elites niches, and a Pareto archive. Its practical superiority over the local proposer must be established on ruflo workloads through controlled quality, cost, latency, and reproducibility comparisons. Ruflo already shells out to Darwin for **GEPA** (`gepa.mjs`) but **not** as the flywheel's proposer.
2. **The receipt/lineage format is bespoke.** Ruflo's champions and receipts use their own schema and do not currently round-trip through the `lineage`/`receipts` model exposed by `@metaharness/flywheel`.
3. **`model`/router is not an evolvable surface.** Ruflo has `@metaharness/router` (hard dep, ADR-321) but the flywheel doesn't evolve routing policy — upstream ADR-145's "8th surface."
4. **No first-class flywheel command surface.** Ruflo has a mixed surface today: the main CLI exposes `score`, `genome`, `gepa`, `learn`, and related commands, while `evolve` and `bench` are MCP/plugin-only. There is no `flywheel` verb or MCP tool exposing the loop that already exists internally.
5. **Evaluation and mutation are coupled.** `runFlywheelTick` both decides and applies. A safe dry-run CLI requires a pure evaluation result that can later be promoted with an explicit, integrity-checked command.
6. **Security envelopes are not explicit.** Authorization, secret/network scope, and spend ceilings must not be expandable by an optimizer merely because a benchmark score improves.

### Dream-cycle reconciliation (2026-07-28)

The five latest `dream-cycle` issues were reviewed against this decision. They contain useful candidate signals, but they do not expand ADR-322 into a general memory, security, ensemble, performance, or swarm redesign.

| Issue | Signal relevant to ADR-322 | Routing decision |
|---|---|---|
| [#2803](https://github.com/ruvnet/ruflo/issues/2803) — MemIR provenance-role collapse | Promotion evidence needs typed origin, authority, subject, producer, and transformation lineage; a flat string is insufficient | Add typed evidence provenance to `RufloFlywheelReceiptV1`. The proposed AgentDB-wide schema and plugin SDK migration require a separate ADR |
| [#2792](https://github.com/ruvnet/ruflo/issues/2792) — heterogeneous reasoning ensembles | A heterogeneous topology may be a strong `planner`/`modelPolicy` candidate | Treat it as one candidate phenotype; it receives no privileged promotion path and must beat the same sealed holdout under the same cost envelope |
| [#2783](https://github.com/ruvnet/ruflo/issues/2783) — ShareLock and ChannelGuard | Per-tool inspection is insufficient for composed tool descriptions, and individually safe agents do not guarantee safe channels | Composite-tool inspection and inter-agent channel controls are structural preconditions for evolving those surfaces, not optional benchmark terms |
| [#2778](https://github.com/ruvnet/ruflo/issues/2778) — agentic inference and mixture-of-agents performance | Quality must be evaluated jointly with tokens, latency, money, and, when measurable, energy | Record resource observations in receipts and compare candidates on a declared Pareto policy; do not describe higher quality as “free” without measured equal-resource evidence |
| [#2768](https://github.com/ruvnet/ruflo/issues/2768) — least-privilege delegation | Privilege selection is a demonstrated orchestration bottleneck | Reinforces the signed, non-expanding `SafetyEnvelope`; an optimizer may select or narrow pre-approved grants but cannot mint or widen them |

The research signals are hypotheses and candidate generators, not promotion evidence. An arXiv preprint is not classified as peer-reviewed merely because it is recent; every benchmark claim used by the flywheel must record publication status, exact artifact/version, corpus, model, configuration, pricing snapshot, and reproducible run receipt.

#### ADR-number and branch governance

The dream branches currently contain multiple unrelated files named ADR-320, and the #2803 branch contains `ADR-322-dream-cycle-memory-typed-provenance.md`. This ADR already owns number 322 for Metaharness Flywheel integration. Before any dream branch is merged:

1. Allocate a unique ADR number from the target branch at merge time.
2. Rename the file and update its internal title, related links, issue body, and cross-references atomically.
3. Rebase onto the accepted ADR index and fail CI if a number maps to more than one decision.
4. Treat a report hash concatenated with a starting/session commit as provenance metadata, not proof that the report was committed or independently attested. Merge evidence must bind the final report blob, final branch commit, source references, and reviewer decision.

## Decision

Do **not** rip out the ADR-176 loop to adopt a 0.1.x package. Instead, treat the three npm packages as **pluggable engines and a shared interop format behind ruflo's existing gate**, in three tracks. Ruflo's gate currently evaluates a broader set of promotion conditions than the upstream package surface (held-out + anchor + drift + replay + receipt + canary + shadow) and stays the authority on promotion throughout.

### Normative implementation specifications

ADR-322 is the architectural umbrella. Acceptance of this decision does not imply that all three implementation contracts ship as one change. The implementation is divided into independently testable specifications, each with its own schema version, feature flag, rollout, and acceptance report:

1. **[ADR-322A — Evaluation and promotion transaction model](./ADR-322A-evaluation-promotion-transaction.md)**
   - Owns pure evaluation, promotion eligibility, atomic compare-and-swap, serving state, crash recovery, idempotency, and the legacy compatibility boundary.
   - Rollout flag: `RUFLO_FLYWHEEL_TRANSACTION_V1`.
2. **[ADR-322B — Darwin proposer adapter](./ADR-322B-darwin-proposer-adapter.md)**
   - Owns `auto|local|darwin` selection, package compatibility, candidate/archive translation, sandbox and model budgets, fallback behavior, and proposer comparisons.
   - Rollout flag: `RUFLO_FLYWHEEL_DARWIN_V1`.
3. **[ADR-322C — Receipt, ledger, and verification protocol](./ADR-322C-receipt-ledger-verification.md)**
   - Owns canonicalization, identifiers, signatures, evidence provenance, statistical decision records, durable lineage, verification, export, and Flywheel projection.
   - Rollout flag: `RUFLO_FLYWHEEL_RECEIPT_V1`.

No specification may rely on another specification's unversioned internal representation. Their contracts meet only through versioned policy, evaluation, promotion, and receipt schemas.

The A/B/C suffixes identify subordinate normative specifications owned by ADR-322; they do not allocate three independent entries in the global ADR-number registry.

### Track A — `@metaharness/darwin` as the flywheel's PROPOSE/evolve engine

Make the proposer pluggable behind a stable interface:

- `RUFLO_FLYWHEEL_PROPOSER=darwin` → the PROPOSE step invokes `@metaharness/darwin evolve` (via the existing `plugins/ruflo-metaharness/scripts/_darwin.mjs` subprocess pattern, `--sandbox real|mock|agent`, `--selection pareto`, `--mutator deterministic|ruvllm`) and returns its Pareto archive as candidate configs.
- `RUFLO_FLYWHEEL_PROPOSER=local` → the existing local hill-climb (byte-reproducible, $0, no network).
- `RUFLO_FLYWHEEL_PROPOSER=auto` (the default) → use Darwin when installed and compatible. If Darwin is unavailable, record the attempted proposer, failure classification, and substitution in the evaluation receipt, then allow the local proposer to produce **evaluation-only** candidates. A substituted proposer cannot promote unless an administrator-signed policy explicitly allows that exact substitution; the default substitution policy denies promotion.
- An explicitly requested `darwin` proposer **fails closed** if Darwin is unavailable or incompatible; it must not silently run a different optimizer.
- With no model credential, only the deterministic mutator is permitted. The `ruvllm` mutator requires `--confirm` plus explicit immutable limits for maximum USD, requests, tokens, concurrency, and wall time. The implementation must enforce those limits locally and, where supported, at the provider; forwarding an opaque `--risk-budget` alone does not establish a monetary hard cap.

The candidates Darwin proposes still pass **ruflo's** held-out gate before a promotion receipt can be issued — Darwin proposes, ruflo disposes.

### Track B — `@metaharness/flywheel` as the interop lineage/receipt format + the standard surface

- Introduce a versioned `RufloFlywheelReceiptV1` envelope and a canonical adapter to `@metaharness/flywheel` lineage commits. The adapter serializes numeric and structured policy values canonically; records the adapter, gate, corpus, and policy-schema versions; and carries the raw evidence needed to recompute every ruflo gate term.
- A portable receipt must include, or content-address, the held-out and canary observations, baseline/candidate outputs, anchor results, drift observations, replay transcript, receipt-coverage result, resource measurements (tokens, latency, USD, and energy when available), policy manifests, promotion decision, and signatures. Every evidence object records its provenance type, producer/attestor, authority scope, subject, transformation lineage, and content hash. A verifier must label each term as **recomputed**, **signature-verified**, or **trusted assertion**. “Externally verifiable” means all promotion-authorizing terms are recomputed or cryptographically bound to an identified trusted attestor.
- Split the current loop into two explicit interfaces:
  - `evaluateFlywheelCandidate(input) -> EvaluationPlan | EvaluationReceipt`: pure with respect to the active policy; it may write a candidate receipt but cannot apply or serve it.
  - `promoteFlywheelCandidate(receiptRef, confirmation) -> PromotionReceipt`: revalidates receipt integrity, gate version, policy version, corpus identity, expiry, and the current baseline before applying exactly once.
- Add `evolve` and `bench` to the main `ruflo metaharness` CLI map for parity with their existing MCP tools. Add a `metaharness_flywheel` MCP tool + `ruflo metaharness flywheel <run|status|promote|history|receipts>` CLI subcommand over the new evaluation/promotion interfaces. `run` is dry-run by construction. `promote` requires `--confirm`, refuses stale-baseline receipts, and is the only new command allowed to mutate the active policy. It must **not** call the side-effecting `runFlywheelTick` as its dry-run implementation.
- Use `@metaharness/flywheel`'s reference rule as a **projection cross-check** in CI. Its `Policy` and `PromotionEvidence` types cannot represent all ruflo evidence directly, so CI must test the canonical projection separately from the authoritative ruflo gate. A disagreement fails the compatibility job and blocks claiming interoperability, but never promotes a candidate.

#### Canonical wire format and identities

All signed or hashed ADR-322C objects use the following normative format:

```text
Canonical JSON: RFC 8785 JSON Canonicalization Scheme (JCS)
Digest:         SHA-256
Signature:      Ed25519 over domainPrefix || 0x00 || canonicalBytes
Content ID:     sha256:<lowercase-hex>
Timestamp:      RFC 3339 UTC, normalized to YYYY-MM-DDTHH:mm:ss.sssZ
```

- Non-finite JSON numbers (`NaN`, positive/negative infinity, negative zero) are forbidden.
- Evolvable fractional policy fields are quantized according to the versioned policy schema and encoded as canonical decimal strings or scaled integers; raw binary floating-point values are not signed policy inputs.
- Measured fractional metrics are encoded as canonical decimal strings with the scale declared by the metric schema. Currency uses integer micros in an identified ISO-4217 currency; durations use integer microseconds; energy uses integer microjoules when available.
- Unknown fields are rejected while verifying a schema version. Schema evolution requires a new version and an explicit migration whose input and output hashes are both recorded.

Identity domains are separate:

```text
candidateId     = SHA-256(JCS(candidate policy))
evaluationRunId = UUIDv7 generated for each execution attempt
receiptId       = SHA-256(JCS(unsigned receipt payload))
lineageId       = UUIDv7 created once for a persistent evolutionary lineage
```

Re-evaluating the same candidate produces the same `candidateId`, a new `evaluationRunId`, and a new `receiptId`. Retries, independent verification, and multiple lineages therefore cannot be conflated with policy identity.

#### Statistical promotion rule

“Held-out improves” is not a raw positive delta. Every receipt embeds the complete, versioned decision rule and per-item paired observations. The initial default rule is:

```text
relativeLift >= 0.02
AND pairedBootstrapProbability(candidate > baseline) >= 0.95
AND pairedBootstrapDeltaCILow95 > 0
AND frozenAnchorRegression <= 0
```

Domains may configure stricter thresholds or an approved alternative test, but cannot omit a noise/significance rule. A change to the statistical rule creates a new gate version and cannot be applied retroactively to an existing evaluation receipt.

For the default rule:

- `relativeLift = (candidateMean - baselineMean) / max(abs(baselineMean), metricEpsilon)`, where `metricEpsilon` is fixed by the versioned metric schema.
- The paired bootstrap uses 10,000 resamples over task-level paired deltas.
- Its deterministic PRNG seed is `SHA-256("ruflo/bootstrap/v1" || corpusHash || candidateId || baselineRef || evaluationRunId)`.
- `pairedBootstrapProbability` is the fraction of resampled mean deltas strictly greater than zero; `pairedBootstrapDeltaCILow95` is the 2.5th percentile using the gate-versioned quantile rule.
- The receipt records sample count, seed, implementation version, point estimates, interval, probability, and all paired deltas or their content-addressed evidence object.

### Track C — `metaharness` + darwin bench as the DESCRIBE/fitness backend

- Keep `metaharness score`/`genome` (already integrated) as the fitness **descriptors** and baseline readiness signal feeding the flywheel's selection.
- Allow a signed **darwin bench suite** (`darwin bench create|verify`, taskHash-stamped so it cannot be silently hand-edited), subject to strict corpus-role isolation:
  - **Selection/train** may be read by Darwin while proposing candidates.
  - **Promotion holdout** is sealed before proposal and is unavailable to Darwin and all candidate-selection logic.
  - **Frozen anchor** is versioned, human-reviewed, and never optimized against.
  A suite used for Darwin selection cannot later serve as promotion holdout for the same lineage. The receipt binds every task ID to exactly one role. The gate remains “improve promotion holdout AND no frozen-anchor regression.”

### What ruflo evolves — the surface map (7 + 1)

Darwin's abstract policy surfaces map onto ruflo's real, already-configurable knobs:

| Darwin surface | Ruflo phenotype it mutates |
|---|---|
| `planner` | swarm topology + strategy (hierarchical/mesh, maxAgents, specialized) |
| `contextBuilder` | memory retrieval: HNSW ef/threshold, hybrid vs semantic, RRF/MMR weights |
| `reviewer` | verification-quality gate thresholds (truth-score, adversarial verify depth) |
| `retryPolicy` | hooks retry/escalation policy (3-tier routing thresholds) |
| `toolPolicy` | Selection within an administrator-signed MCP tool/AuthScope envelope; evolution may narrow or choose among pre-approved bundles but cannot add tools, claims, secret scopes, network destinations, or privilege |
| `memoryPolicy` | AgentDB tiers, consolidation cadence, EWC++ retention |
| `scorePolicy` | intelligence-pipeline JUDGE verdict weights |
| **`modelPolicy`** *(8th, ADR-145)* | Selection among administrator-approved `@metaharness/router` candidates and quality thresholds; immutable provider/model allowlists and per-run/per-day cost ceilings remain outside the genome |

The evolvable genome is subordinate to an administrator-signed `SafetyEnvelope`. Before sandbox execution and again before promotion, ruflo rejects any candidate that expands authorization, secret access, network reachability, model/provider access, concurrency, or spending beyond that envelope. Candidates that alter tool composition or inter-agent message policy must also clear the applicable composite-tool and channel guardrails before execution. These are structural preconditions, not benchmark scores and not overrideable warnings.

Resource constraints are also eligibility gates, not merely Pareto dimensions. Before ranking, a candidate must satisfy every hard limit in the signed envelope, including:

```text
p95LatencyMicros <= envelope.maxP95LatencyMicros
costMicrosPerTask <= envelope.maxCostMicrosPerTask
tokensPerTask <= envelope.maxTokensPerTask
failureRate <= envelope.maxFailureRate
evaluationCostMicros <= envelope.maxEvaluationCostMicros
```

Only admissible candidates enter Pareto selection. Missing resource evidence fails eligibility unless the envelope explicitly marks that metric unavailable and non-authorizing. A candidate cannot compensate for violating a hard resource or safety limit by improving quality.

### Dependency policy

- When implemented, `@metaharness/darwin` and `@metaharness/flywheel` will be declared in **`optionalDependencies`** (`^0.8.0` / `^0.1.7`), **not** `dependencies`. Unlike `@metaharness/router` (a hot-path import, hard dep per ADR-321) and `metaharness` (hard dep), the flywheel and evolve engines are **opt-in, heavy, explicitly-invoked loops**. The ADR-150 removability constraint (“works without them”) stays in force. Graceful fallback applies only to `auto`; explicit engine selection fails closed.
- The implementation change must add both pins to a companion guard (`scripts/check-metaharness-pins.mjs` + `metaharness-pin-drift.yml`) and verify package API compatibility, not merely semver freshness. Until those artifacts and optional dependencies land, this ADR records intent rather than shipped state.

### Persistence and key boundaries

- Replace bounded destructive rotation with immutable, content-addressed ledger segments plus a signed head/checkpoint that links each segment to its predecessor. Retention may archive old segments, but must not make a truncated chain report itself as complete.
- Promotion fails closed if its receipt or ledger commit cannot be durably persisted. Best-effort telemetry may still fail open, but it is not promotion evidence.
- Reuse ADR-103's key **provider and storage mechanism**, not an undifferentiated signing domain. Flywheel receipts use a distinct Ed25519 domain-separation prefix and key purpose (`ruflo/flywheel-receipt/v1`) so a witness signature cannot be replayed as a promotion signature.
- Store private signing material outside the repository. Receipts include the public-key identifier, algorithm, signing domain, issuance time, and rotation metadata.

### Active-policy promotion transaction

ADR-322A defines promotion as an atomic compare-and-swap transaction, not a sequence of best-effort file writes. The transaction is eligible only when:

```text
activeChampionRef == receipt.baselineRef
AND receipt.decision == "accepted"
AND receiptState.promotedAt == null
AND ledgerHead == receipt.expectedLedgerHead
AND receipt.gateVersion == activeGateVersion
AND receipt.policySchemaVersion == activePolicySchemaVersion
AND receipt.safetyEnvelopeRef == activeSafetyEnvelopeRef
AND receipt.expiresAt > transactionTime
```

Within one serializable transaction, the promotion authority must:

1. Persist the immutable promotion commit and mark the separate receipt-state record as consumed; the signed evaluation receipt itself remains immutable.
2. Append the commit to lineage and advance the signed ledger head.
3. Compare-and-swap the active champion reference from `baselineRef` to `candidateId`.
4. Allocate and record the next serving epoch.
5. Record `promotedAt`, transaction ID, proposer identity/substitution status, and recovery metadata.

The transaction commits all five state changes or none. Implementations may use a transaction-capable state store or a write-ahead transaction journal with deterministic recovery, but must expose one authoritative state machine. Policy materialization into runtime files occurs from the committed champion and serving epoch; it is idempotent and recoverable, never a second source of truth.

Concurrent attempts against the same receipt or baseline produce at most one successful commit. Repeating an already successful transaction returns its recorded result without reapplying the policy. A stale baseline, changed ledger head, consumed receipt, expired receipt, or changed safety envelope fails closed.

### Threat model

The implementation must trace controls and tests to at least these attackers and failures:

| Threat | Required control |
|---|---|
| Malicious candidate policy | Schema validation, signed non-expanding `SafetyEnvelope`, sandboxing, structural tool/channel checks, held-out and frozen-anchor gates |
| Compromised proposer process | Proposer has no promotion authority; canonical candidate output is treated as untrusted input; explicit proposer identity and substitution are recorded |
| Tampered benchmark corpus | Signed/content-addressed corpus manifest, sealed role assignment, task hashes, and corpus version bound into the receipt |
| Compromised evidence attestor | Attestor allowlist and scope, provenance per term, independent recomputation where possible, revocation and key rotation |
| Replay of an old accepted receipt | Baseline/ledger-head compare-and-swap, expiry, consumed state, lineage and safety-envelope binding |
| Concurrent promoters | Serializable transaction, unique constraint on receipt consumption and serving epoch, idempotent result |
| Compromised signing key | Purpose/domain separation, external key storage, rotation/revocation metadata, incident procedure that prevents new promotions and marks affected receipts |
| Evaluation resource exhaustion | Signed per-run and aggregate budgets, concurrency/wall-time limits, cancellation, sandbox quotas, and fail-closed budget exhaustion |
| Crash or partial persistence | Atomic transaction or write-ahead recovery; fault injection at every boundary; one authoritative champion after recovery |

## Consequences

**Positive**
- A broader explorer (Darwin's 7-surface evolve + Pareto archive) behind ruflo's existing broader promotion gate. Whether it produces better candidates per unit cost is measured rather than assumed.
- Once the V1 evidence requirements and compatibility tests pass, ruflo champions/receipts become portable to the metaharness ecosystem and third parties can independently verify every promotion-authorizing term.
- `modelPolicy` closes the loop between the router product (ADR-148/149) and the evolutionary engine — "which model, when" becomes evolved, not hand-tuned.
- Convergence path: one loop concept, cross-checked against the productized package, instead of two parallel implementations drifting apart.

**Negative / risks**
- **Goodhart / benchmark quality.** A weak held-out corpus evolves toward the wrong objective. Mitigation: keep the ADR-081 human anchor as a hard no-regression guard and darwin's safety rails (exit 99 = safety-disqualified) — never promote on the training corpus alone.
- **Two gates could disagree.** Ruflo's gate and `@metaharness/flywheel`'s gate may differ; ruflo's is the authority. The package's gate is a CI cross-check, never the promoter.
- **0.1.x churn.** `@metaharness/flywheel@0.1.x` will move fast and may break; the pin-drift guard + optionalDependency + graceful fallback bound the blast radius.
- **MCP/CLI surface growth** and **evolve cost** (sandbox + optional model calls) — all opt-in; evaluation is non-serving by default, and model-backed evolution requires explicit locally enforced limits.
- **Receipt key management** (Ed25519) — reuse ADR-103's key-provider mechanism with a flywheel-specific signing domain and key purpose; do not reuse witness signatures across protocols.
- **Compatibility projection can be lossy.** The package's string-valued policy and four-axis evidence are narrower than ruflo's native schema. The versioned adapter and compatibility tests make any loss explicit; ruflo receipts remain the authoritative evidence until the upstream schema can carry every gate term.

**Neutral**
- Default agent behavior remains opt-in (`RUFLO_HARNESS_LOOP`). At the time of this decision, the legacy generational runner auto-serves the previous promotion on the following tick; the new CLI/MCP surface must not inherit that behavior. Removing the two proposed optional engine packages leaves the local proposer and core CLI operational (ADR-150).

## Phased rollout

- **Phase 0 — implemented.** Evaluation is separate from application; promotion is an explicit, idempotent transaction. The legacy mutation path is disabled by default and available for one compatibility cycle behind `RUFLO_FLYWHEEL_LEGACY_APPLY=1`.
- **Phase 1 — implemented.** `RufloFlywheelReceiptV1`, durable lineage, signature domain separation, independent verification, CLI parity, and CLI/MCP flywheel surfaces are present. `run` is non-serving; `promote --confirm` is explicit.
- **Phase 2 — implemented for bounded retrieval-policy candidates.** Both engines are optional and API-guarded. `auto|local|darwin`, resource admissibility, Pareto filtering, and fail-closed/evaluation-only substitution semantics are enforced. Model-backed mutation remains disabled unless a caller supplies a separately budgeted Darwin invoker.
- **Phase 3 — governed policy expansion.** Introduce the signed `SafetyEnvelope`; then enable constrained `toolPolicy` and `modelPolicy`. Add role-isolated Darwin suites and the Flywheel projection cross-check in CI.
- **Phase 4 — durable autopilot.** Integrate with `/loop` only after fault-injection tests establish idempotency, crash recovery, complete lineage, no privilege expansion, budget enforcement, and explicit serving semantics. Evaluate convergence onto `@metaharness/flywheel` only once its evidence model is provably at least as strong as ruflo's.

## Normative acceptance criteria

ADR-322 is not implementation-complete until automated evidence demonstrates all of the following:

1. Evaluation cannot modify the active champion, serving epoch, or runtime policy under normal operation or injected process, filesystem, and database failures.
2. One hundred concurrent promotion attempts against one accepted receipt produce exactly one successful commit and one stable idempotent result for all retries.
3. A receipt whose baseline or expected ledger head is stale is rejected without mutation.
4. A candidate cannot expand any field of the signed `SafetyEnvelope`, including authorization, tools, claims, secrets, network, provider/model access, concurrency, or spending.
5. Altering any canonical receipt byte, referenced evidence object, policy manifest, or lineage link causes verification to fail.
6. Every promotion-authorizing term is either independently recomputed or cryptographically bound to an approved, scoped attestor and reported as such.
7. Explicit Darwin mode fails closed when Darwin is absent, incompatible, times out before producing a complete archive, or violates its resource budget.
8. `auto` proposer substitution is evaluation-only unless the active signed policy authorizes the exact substitution and the receipt records it.
9. Local proposer mode is byte-reproducible for identical versioned inputs, seed, platform contract, and corpus.
10. Fault injection before and after every promotion transaction operation recovers to exactly one consistent active champion, ledger head, receipt-consumption state, and serving epoch.
11. Removing both optional packages leaves local evaluation, local promotion, receipt verification, and the core CLI operational.
12. The default statistical gate rejects improvements below its lift/significance thresholds and reproduces the recorded decision from paired observations.
13. Hard latency, cost, token, failure-rate, and evaluation-budget violations are rejected before Pareto ranking.
14. An ADR-322C interoperability fixture round-trips through the Flywheel adapter without changing any ruflo-authorizing evidence; any intentionally unrepresentable field is reported as projection loss and prevents an interoperability claim.
15. The temporary legacy mutation flag emits a deprecation event, is never used by the new CLI/MCP surface, and is removed on the stated release boundary.

The load-bearing concurrency/fault test is:

> Run 100 concurrent promotion attempts against one accepted receipt while injecting process termination at every persistence boundary. Exactly one promotion succeeds; one champion and serving epoch are active; one receipt is consumed; and the signed ledger verifies from head to genesis.

## Alternatives considered

- **Rip-and-replace: adopt `@metaharness/flywheel` as the runtime, retire ADR-176.** Rejected — a 0.1.7 package would replace ruflo's broader local gate (anchor/canary/drift/replay/receipt coverage) and its live-neural-store integration with something unproven. Convergence, not replacement.
- **Status quo (bespoke flywheel only).** Rejected — leaves the weak hill-climb proposer, no ecosystem-portable receipts, and no evolvable routing. Ignores the user's explicit request to use the three packages.
- **Hard-dependency the evolve/flywheel engines (like ADR-321).** Rejected — they are opt-in, explicitly-invoked, heavy loops, not hot-path imports; keeping them optional preserves ADR-150 removability at zero functional cost.
- **Numeric-genome evolution à la MetaBioHacker/PixelRAG** (evolve a JSON genome, not source surfaces). Noted as the right model for ruflo's *config* surfaces (which are parameters, not source), and folded into Track A — darwin's `mapLimit`/`paretoFront` primitives over a ruflo config genome, with `evolve()`'s source-surface mutation reserved for the harness files it actually owns.
