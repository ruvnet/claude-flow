# ADR-449: Guidance learning loop on the mod system

Date: 2026-10-04
Status: Proposed
Scope: ruflo-mods guidance adapter, the Guidance Control Plane, and the ADR-322 flywheel promotion path. This ADR defines contracts; it adds no code.
Builds on: ADR-404 (function hooks), ADR-447 (native guidance and observation loop), ADR-322A/322C (evaluation, promotion, receipts), ADR-446 (plugins as mods)

## Context

ADR-447 put versioned guidance in front of the model and started recording what happened,
and deliberately stopped there: its observations are `verified=false` and
`learningEligible=false` (`plugins/ruflo-mods/hooks/guidance/observations.ts:16-17`,
`ADR-447:70-73`), and it states that "an independent evaluator is needed before review
priorities can become accepted learning evidence" (`ADR-447:114-115`). This ADR defines that
evaluator boundary and the path from evidence to changed guidance, using components that
already exist. It does not add a learning engine.

What exists today (all paths verified in this checkout):

- **Task-start guidance.** `createGuidance().prompt` reads the CLI-exported projection,
  selects at most five excerpts / 4096 characters, and records `ruleIds` for the task
  (`plugins/ruflo-mods/hooks/guidance/index.ts:32-50`, `ADR-447:58-63`). With
  `guidanceContext=false` and `guidanceLearning=true`, a task is observed with
  `ruleIds: []` (`index.ts:46-49`): the control arm already exists. Both options default off
  (`hooks/options.ts:33-34`).
- **Enforcement.** `tool.check` runs the chain, then merges ruflo's opinion with `stricter`
  (deny > ask > allow, `hooks/guard/verdict.ts:4,24-29`; `hooks/guard/index.ts:45-77`). It
  can only tighten. A failure fails closed by one step (`guard/index.ts:78-85`).
- **Observations.** Allowlisted metadata only: IDs, `bundleId`, `sourceRevision`, rule IDs,
  verdict and execution counters, completion class (`observations.ts:4-18` mirrored in
  `v3/@claude-flow/cli/src/guidance/mod-projection.ts:26-39`). The CLI consumer rejects any
  forged `verified` or extra field (`mod-projection.ts:88-107`) and its candidate review
  "never feeds the accepted RunEvent ledger or optimizer" (`mod-projection.ts:109`).
- **Compiler and retrieval.** Constitution, shards, hashes (`v3/@claude-flow/guidance/src/compiler.ts`),
  `ShardRetriever` (`retriever.ts:154`), `RunEvent` with `guidanceHash`, `retrievedRuleIds`,
  `testResults`, `violations`, `outcomeAccepted: boolean | null` (`types.ts:231-263`).
- **Evaluators and proof.** `TestsPassEvaluator`, `ForbiddenCommandEvaluator`,
  `ViolationRateEvaluator` (`ledger.ts:35-210`); `ProofChain` with signed, hash-chained
  `ProofEnvelope`s binding a run event, tool-call hashes and `guidanceHash`
  (`proof.ts:80-104,130-232`).
- **Proposals.** `EvolutionPipeline` change proposals (`evolution.ts:27-37`), signed, simulated,
  staged (`evolution.ts:454`).
- **Promotion authority.** ADR-322A: evaluation cannot touch active state; the only interface
  that advances the active champion is `promoteFlywheelCandidate(receiptId, confirmation)`
  under a compare-and-swap (`ADR-322A:41-51`). ADR-322C: signed receipts with
  `corpusRoleManifestRef`, `heldoutEvidenceRef`, and the decision rule
  `relativeLift >= 0.02 AND pairedBootstrapProbability >= 0.95 AND CILow95 > 0 AND
  frozenAnchorRegression <= 0` (`ADR-322C:53-54,70-76,219-223`).

Existing interfaces that must NOT become sinks for mod-collected activity:

- `hooks_post-task` treats an omitted `success` as true (`v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1816`, `params.success !== false`; same pattern at `:1070,:3298,:5539`).
- The guidance hooks set `outcomeAccepted` from task status or the success flag
  (`guidance/src/hooks.ts:405`, `headless.ts:241`), i.e. "the run ended", not "the result was accepted".
- `OptimizerLoop` decides promotion from fixed multipliers (`simulateChangeEffect`,
  `optimizer.ts:286-308`, e.g. `affectedRatio * 0.4`) and `applyPromotions` edits a bundle
  (`optimizer.ts:366`); `EvolutionPipeline.promote` only flips a status (`evolution.ts:595-607`).
  Neither is measured, held-out evidence.

## Decision

Close the loop in three stages. Every stage reuses an existing component; the new parts are
records, a join, and gates between them. Nothing in this ADR is enabled by default.

### 1. Apply guidance at task start, with provenance, enforce only by tightening

1. The prompt hook keeps its ADR-447 behaviour: a small bounded set of excerpts from a
   versioned projection, advisory text only.
2. **New: a guidance-use record** per task, extending the observation (not replacing it).
   For every displayed item: rule ID, **per-rule content hash**, `bundleId`,
   `sourceRevision`, and the arm (`guidance-on` / `guidance-off`). ADR-447 records bundle
   version and rule IDs; the per-rule hash and arm are new, so a later change to one rule
   can be told apart from the bundle that carried it. The record stays inside the existing
   strict allowlist, so the writer (`validObservation`, `observations.ts:54`) and the
   reader (`parseModObservations`) change together.
3. **Enforcement stays the one existing path.** A guidance item becomes enforced only by
   being compiled into the policy projection that `tool.check` already reads
   (`guard/index.ts:53,60-61`), and `stricter` guarantees it can only turn allow into
   ask/deny. Guidance can never grant authority (`ADR-447:65-67`). An item of "allow"
   character stays advisory forever. An unreadable enforced projection already tightens
   by one step (`guard/index.ts:34-39`); that behaviour is preserved.
4. Which items are *retrieved* may use the existing lexical selection or `ShardRetriever`;
   retrieval ranking is not an authority and is not part of the acceptance claim beyond the
   arm comparison in §Acceptance.

### 2. Learn from verified outcomes only

Evidence has two classes. Only the strong class can make an observation learning-eligible.

| Class | Signal | Why |
|---|---|---|
| **Strong** | Test result from an independent run bound to a commit/artifact hash (`RunEvent.testResults`, `TestsPassEvaluator`) | Outcome is checked by something other than the model |
| **Strong** | Accepted change: merged, or kept after a review window without being reverted | A person or CI accepted it |
| **Strong** | Explicit person decision: approval, rejection, or an explicit "this was wrong" mark | Direct human judgement |
| **Strong** | Correction: the person reverts or undoes the change, rejects an `ask`, or marks the result wrong | A closed enum, not text |
| **Weak** | A tool call succeeded (`tools.ok`), turn `completed`, the assistant said "done" | Execution is not acceptance (`ADR-447:72-73`) |
| **Weak** | A correction *inferred* from a follow-up prompt | A classifier guess; explicit marks are strong, inferences are not |

Rules:

- Weak evidence is stored but never counts toward promotion and never sets
  `learningEligible`.
- **New: an outcome-evidence record**, written by an evaluator that is *not* the mod, never
  inside the mod's observation file. Fields: observation ID (`runId:taskId` join key),
  evidence kind (closed enum above), subject binding (commit or artifact SHA-256, test-run
  hash), evaluator identity, timestamp, and a signature. Records are appended to the proof
  chain (`ProofChain`, `proof.ts:130`) so the sequence is hash-chained and tamper-evident.
  The observation stays immutable and `verified:false`; eligibility is the join, not an edit.
- A correction is stored as a closed enum (`change-reverted`, `ask-rejected`,
  `marked-wrong`, `turn-interrupted`). The text of the correction is not stored.
- **Privacy boundary (hard rule).** Raw prompts, commands, file paths, tool outputs,
  assistant answers, host IDs and credentials never enter the learning record
  (`ADR-447:70-73` extends to evidence). Evidence is hashes, counts and enums. Credential
  screening (`hooks/guidance/screen.ts`) stays on the read path; `aidefence_has_pii`/
  `transfer_detect-pii` style checks run on any operator-supplied free-text field before
  it is accepted, and such fields are rejected rather than redacted.
- `hooks_post-task`, `RunLedger.logEvent` and `OptimizerLoop` are not called with mod
  observations. Only the evaluator, with strong evidence, may create an accepted `RunEvent`
  (`outcomeAccepted` set from evidence, never from completion).

### 3. Promote through review and measurement

A change to guidance moves through five gates; failing any gate stops it.

1. **Propose.** Candidates come from the CLI review of strong-evidence observations grouped
   by rule and version (`collectModCandidates`, `mod-projection.ts:109`). A proposal is an
   `EvolutionPipeline` `ChangeProposal` of kind `rule-modify|add|remove`
   (`evolution.ts:27-34`) with a diff against the canonical source, signed
   (`evolution.ts` status `signed`). Proposing writes nothing to canonical guidance.
2. **Measure on held-out tasks (new).** A **task-set manifest** names tasks by hash with
   roles `development`, `heldout`, `frozen-anchor` (ADR-322C `corpusRoleManifestRef`). Held-out
   tasks are never shown to the proposer. Tasks are operator-authored; session prompts are
   never harvested into a task set. Each task runs in both arms (guidance on/off, or
   candidate vs current), interleaved in randomised order, with repeats to absorb model
   nondeterminism. Sample size, repeat count and thresholds are fixed in the manifest
   *before* the run (preregistered).
3. **Decide with the existing statistical rule.** ADR-322C's default
   (`relativeLift >= 0.02`, paired bootstrap probability >= 0.95, `CILow95 > 0`,
   `frozenAnchorRegression <= 0`, `ADR-322C:70-76,219-223`) applied to verified task success.
   Correction rate uses the same paired procedure with the sign reversed.
4. **Safety gates (new, hard).** Zero policy violations in the candidate arm
   (`ForbiddenCommandEvaluator`, `ViolationRateEvaluator`, the `tool.check` deny counters);
   no increase in `deny`/`ask` bypass attempts; no regression on frozen anchors; no rise in
   the other primary metric beyond a preregistered tolerance. Any single failure rejects.
5. **Promote through the existing authority.** The result is an `EvaluationReceipt`
   (ADR-322C), and only `promoteFlywheelCandidate(receiptId, confirmation)` may advance the
   active reference, under the ADR-322A compare-and-swap (`ADR-322A:41-51`) with explicit
   human confirmation. The mod, `OptimizerLoop.applyPromotions` and
   `EvolutionPipeline.promote` are not on this path.

**No automatic edits to canonical guidance.** Promotion advances a *reference* to an
approved commit of the guidance sources; it never rewrites `CLAUDE.md` or rule files. The
accepted diff is applied by a person through the normal PR, and the ADR-447 exporter then
projects that exact commit (`ADR-447:36-41`). "Promoted" therefore means: a signed receipt
exists, a person confirmed it, and the exported bundle at the new commit is what the mod
serves.

### Provenance per promoted change

Every promoted change must be reconstructible from: source commit and per-rule hash before
and after; bundle ID; proposal ID and signature; the list of observation IDs and
outcome-evidence IDs that motivated it; task-set manifest hash and arm results; evaluator
identity; receipt ID, ledger head and `servingEpoch`; proof-chain envelope IDs; the
confirming person. A change missing any element is not promotable.

## Existing vs new

| Piece | Status |
|---|---|
| Versioned projection, bounded lexical retrieval, excerpts advisory | **Exists** (ADR-447) |
| `tool.check` tighten-only merge, fail-closed | **Exists** (`guard/index.ts`) |
| Observation queue, strict allowlist, forged-claim rejection | **Exists** |
| Guidance on/off arm via `guidanceContext` / `guidanceLearning` | **Exists** |
| Compiler, `RunEvent`, evaluators, `ProofChain`, `EvolutionPipeline` | **Exists** |
| ADR-322 receipts, statistical rule, compare-and-swap promotion | **Exists** (accepted) |
| Per-rule content hash and arm in the use record | **New** |
| Outcome-evidence record + independent evaluator + join by observation ID | **New** |
| Capture of explicit approval/rejection/"marked wrong" as closed enums | **New** |
| Guidance task-set manifest with held-out/anchor roles and A/B runner | **New** (reuses 322C roles) |
| Guidance-specific hard safety gate set | **New** |
| Receipt-to-guidance-reference promotion and provenance bundle | **New** (reuses 322A/322C) |

## Alternatives

1. **Let the mod feed `hooks_post-task` / `RunLedger` directly.** Rejected: completion is not
   acceptance and `success` defaults true (`hooks-tools.ts:1816`).
2. **Use `OptimizerLoop` as the decider.** Rejected: its metrics are constants, not
   measurements (`optimizer.ts:286-308`).
3. **Auto-apply promoted rules to canonical files.** Rejected: guidance is policy; a person
   merges it. A bad automatic edit would also invalidate the exporter's source-identity checks.
4. **Learn per-user weights or embeddings in the mod.** Rejected: a second learning engine,
   unauditable, and it would need raw text.
5. **Infer corrections from follow-up prompt text.** Kept only as weak evidence; making it
   strong would let the model's phrasing steer its own training signal.

## Non-goals

- No new learning, ranking or embedding model; no change to `ShardRetriever` or SONA.
- No automatic promotion, no automatic edits to canonical guidance, no self-expanding tools,
  network, secrets, spend or concurrency (repository rule on self-promotion).
- No change to ADR-322 statistics or to the `tool.check` merge.
- No claim of measured improvement: this ADR defines how it would be measured.
- No cross-user or cross-machine sharing of evidence.

## Risks

- **Proxy gaming.** Tests passing is not task success; a rule could teach the model to
  satisfy the harness. Mitigation: frozen anchors, held-out tasks never shown to the proposer,
  corrections as a second independent signal.
- **Small samples and nondeterminism.** A/B on LLM runs is noisy and costs money. The
  preregistered sample size may make most proposals "inconclusive"; inconclusive is a reject.
- **Correction signal is gameable and sparse.** Only explicit marks are strong; a person who
  never marks yields no learning, by design.
- **Evaluator trust.** The evaluator's key and identity become the root of trust; compromise
  there forges eligibility. Keys follow the existing signing-key handling.
- **Unauthenticated observation namespace.** The run ID is "never an authenticated host
  session identity" (`observations.ts:47`); the join is by ID, so evidence must bind to an
  artifact hash, not to the ID alone.
- **Crash loss.** The native queue has no atomic append (`observations.ts:76-81`); lost
  observations only reduce evidence, never fabricate it.
- **Injection through guidance sources.** A promoted rule is future prompt text. Source
  screening (`screen.ts`) and the human merge are the controls; a malicious accepted rule is
  still possible and reviewers must read diffs.
- **Goodhart on corrections.** Guidance that makes the model ask first lowers corrections and
  raises friction; the success-must-not-drop clause is the counterweight.

## Open questions

1. Whether ADR-322A's serving-epoch materialisation fits a pointer to a git commit, or the
   guidance reference needs its own epoch type.
2. Where the independent evaluator runs (CI, a local `claude -p` judge, or a person); a model
   judge is itself weak evidence unless it checks executable results.
3. Whether the explicit "marked wrong" action belongs in ruflo-console (ADR-444 tools) or the
   CLI; either must write the closed enum only.

## Acceptance

On the same preregistered held-out task set, run guidance enabled vs disabled (same model,
interleaved, repeated). The loop passes when **all** hold:

1. **Benefit:** verified task success improves, **or** user corrections drop, each by the
   ADR-322C paired-bootstrap rule (lift >= 0.02, probability >= 0.95, `CILow95 > 0`).
2. **No regression:** the metric not claimed does not worsen beyond the preregistered
   tolerance, and `frozenAnchorRegression <= 0`.
3. **Zero policy violations** in the guidance-enabled arm, and no weakening of any
   `tool.check` verdict (all nine permission combinations remain monotonic).
4. **Full provenance** for every promoted change, as listed above, verifiable offline from
   the proof chain and receipt without trusting the mod.
5. **Privacy:** a scan of every learning record finds no prompt, command, path, output or
   credential content (allowlist test plus a seeded-secret test).
6. **No canonical edit:** the guidance sources and `guidance/events.ndjson` are byte-identical
   before and after evaluation; only a confirmed promotion advances the reference.

Fixture tests prove the plumbing (forged evidence rejected, weak evidence ignored, stale
baseline refused, per-rule hash changes detected). They do not prove learning uplift; only a
live held-out comparison under item 1 can, and its numbers belong in the linked PR evidence.
