# ADR-402: Broad skill discovery and verified small model training for Ruflo

Status: Proposed
Date: 2026-10-01
Decision owner: Ruflo maintainers
Tracking issue: https://github.com/ruvnet/ruflo/issues/3603
Scope: Architecture and evaluation contract; no runtime implementation or trained checkpoint is included.
Source baseline: 6cfd88654f2c571940f32704d79a2a1892de4392

## 1. Decision

Use the discoverable Agent Skills ecosystem as a versioned retrieval catalog and curriculum source. Train a compact routing model first. Train an optional small execution model only on provenance tracked, independently verified trajectories. Retain current skill retrieval and a stronger model fallback.

“All available skills” means all sources reachable through declared discovery adapters during a bounded snapshot window. It does not mean a complete census of the internet, permission to execute every skill, or permission to train on every source.

Separate discovery, retrieval eligibility, execution eligibility, and training eligibility. Each has an explicit state and evidence. A source can be discoverable while being ineligible for execution or training.

This ADR does not change default routing, permissions, release authority, or existing promotion gates. It proposes an opt in experiment. Default changes require existing gates and any separately reviewed gate amendment.

## 2. Context and evidence

The skills CLI discovers, installs and loads SKILL.md packages. It is a distribution mechanism, not a weight training pipeline. Skill packages can contain instructions, references and executable resources.

Ruflo already has related work:

1. [ADR-353](./ADR-353-dream-cycle-intelligence-skill-distillation.md) proposes trace to procedural skill distillation. This decision adds ecosystem ingestion and skill conditioned model training; it does not assert ADR-353 is implemented.
2. [ADR-391](./ADR-391-router-benchmark-gate.md) records a frozen router benchmark and no candidate promotion. Its historical results are not a measurement of the current head. Its accuracy, dependency and latency gates remain binding for changes to the default router.
3. [ADR-322A](./ADR-322A-evaluation-promotion-transaction.md) separates evaluation from promotion and owns promotion transactions.
4. [ADR-381](./ADR-381-sequential-promotion-evidence-governance.md) describes sequential evidence governance. Verify the active runtime implementation and policy before integration; a proposed document is not evidence of an active enforcement mechanism.

The public skill corpus has unknown coverage, duplication, license eligibility and executable quality. Downloads, stars and textual plausibility are not outcome labels. Repository research claims are not imported as verified performance claims.

## 3. Goals and non goals

Goals:

1. Discover relevant skills across a large, changing catalog.
2. Reduce cost per verified successful task while preserving task quality.
3. Learn skill selection, tool arguments, bounded recovery and appropriate escalation.
4. Generalize to instructions for skill families absent from training.
5. Preserve permission boundaries, tenant isolation, reproducibility and rollback.
6. Produce reusable outcome evidence that improves Ruflo independently of model choice.

Non goals:

1. Train a foundation model from scratch.
2. Memorize every skill in model weights.
3. Replace authorization with model confidence or a learned safety score.
4. Launch unrestricted crawling, paid training, production execution or automatic promotion through this documentation change.
5. Claim benchmark gains, corpus completeness or hardware capacity before measurement.

## 4. Alternatives

Scores are design judgments from 1 (poor) to 5 (strong), not measurements. Higher operational simplicity means less maintenance.

| Option | Freshness | Potential execution specialization | Operational simplicity | Provenance control |
| --- | --- | --- | --- | --- |
| Retrieval with existing model | 5 | 2 | 5 | 5 |
| Train all raw skill text into weights | 1 | 2 | 2 | 1 |
| Learned router with retrieval | 5 | 3 | 4 | 5 |
| Verified execution adapter with retrieval and fallback | 5 | 5 | 2 | 4 |

Choose the router first. Advance to an execution adapter only if the retrieval baseline exposes a repeatable gap and the pilot produces enough valid training examples.

## 5. Architecture and boundaries

### 5.1 Discovery and immutable snapshots

Inputs: explicit source lists, discovery adapters, source credentials scoped to read, crawl budgets and a snapshot cutoff.
Outputs: a manifest of discovered packages, fetch receipts, failures and coverage counts.
Assumption: adapters may provide incomplete or stale listings.

Use skills CLI compatible discovery where supported, without assuming an undocumented bulk export API. Pin the CLI version and source commits. Prefer reading repository objects to installing untrusted packages. Discovery must never execute skill scripts, package lifecycle hooks or instructions.

Apply maximum file count, depth, bytes, redirects and archive expansion limits. Reject traversal and escaping symlinks. Record inaccessible sources and partial results. Resumable ingestion uses stable source identities and content hashes.

### 5.2 Catalog and RuVector retrieval

Inputs: manifests and parsed packages.
Outputs: lexical and vector indexes, family clusters and eligibility decisions.
Assumption: embedding similarity does not establish trust or capability.

Store a canonical content record separately from source occurrences. Preserve every occurrence's license and attribution. Deduplication must not erase provenance or transfer permissions from a permissive copy to an unrelated source.

Retrieve by task similarity, then filter by platform, available tools, tenant visibility, skill version and execution eligibility. Resolve conflicts explicitly. An empty eligible result is valid and must trigger abstention or the existing route.

Pin the embedding model, dimensions, index parameters and chunker. Record recall at k on a labeled retrieval set. Compare approximate retrieval against exact search on sampled queries so index errors are separated from ranking errors.

### 5.3 Learned router

Inputs: task, eligible skill descriptors, available tools and constrained resource envelope.
Outputs: ranked skill IDs, agent/model route, calibrated confidence and abstention reason.
Assumption: the correct answer can include multiple skills or no skill.

Start with an embedding based classifier or reranker. Benchmark against lexical retrieval, RuVector retrieval without training, and current Ruflo routing. The router cannot invent tools or expand permissions. Confidence thresholds are calibrated on development data and frozen before test evaluation.

### 5.4 Optional execution specialist

Inputs: task, current retrieved skill instructions, tool schemas and sanitized observations.
Outputs: schema constrained action proposals, stop or escalation.
Assumption: a 1B to 3B parameter model may handle bounded repeated workflows, but adequacy is unproven.

Use a pinned base model with acceptable license and tool support. Start with supervised adapter training; compare the untrained base with exactly the same retrieval and harness. Preference optimization is deferred until outcome labels justify it. Runtime quantization is a separate candidate requiring evaluation after conversion.

A deterministic execution boundary validates tool existence, argument schema, authorization, tenant scope, budget and action prerequisites before every side effect. A valid JSON object is not proof of a permitted or correct action.

### 5.5 Evidence and promotion

Inputs: immutable candidate, baseline, evaluation specification and task receipts.
Outputs: pass, fail or inconclusive evidence and a candidate registration.
Assumption: evaluation runs in isolated environments with frozen verifiers.

Reuse the existing MetaHarness evaluation boundary and ADR-322A promotion authority where implementation compatibility is verified. Do not create a competing champion pointer or implicit promotion path. An accepted evaluation alone must not activate a model.

## 6. Minimum data contracts

Implement these as versioned schemas before collecting training data. Field names below are proposed contracts.

| Record | Required fields |
| --- | --- |
| SkillManifest | schemaVersion, skillId, sourceUri, sourceCommit, relativePath, contentHash, resourceHashes, discoveredAt, snapshotId, licenseEvidence, attribution, visibility, tenantId where private, familyId, platform, requiredTools, eligibility states and reasons |
| TaskFixture | taskId, familyId, sourceRepo, taskType, inputHash, environmentDigest, initialStateHash, verifierHash, budgets, expected authorization constraints, split |
| Trajectory | trajectoryId, taskId, skillHashes, modelRevision, harnessCommit, toolSchemaHashes, observations, action proposals, actual calls, policy decisions, outcomes, verifier result, costs, timings, redactionVersion |
| DatasetManifest | datasetId, sourceSnapshot, recordHashes, splitManifestHash, family clustering revision, filtering revision, license inventory, retention policy, teacher provenance |
| Candidate | candidateId, baseModelHash, tokenizerHash, adapterHash, quantizationHash if used, datasetHash, trainerVersion, seed, hyperparameters, retrievalSnapshot, serving configuration |
| EvaluationReceipt | baselineRef, candidateRef, gateVersion, corpusHash, verifierHash, hardware, perTaskOutcomeRefs, uncertainty estimates, cost assumptions, safety results, exclusions, decision |

Do not train on hidden reasoning. Capture observable actions, tool results and concise decision labels. Remove credentials and identifying content before export. Private traces stay in tenant scoped storage; shared training requires explicit eligibility. Revocation removes affected retrieval records, blocks new training and marks derived checkpoints for review or retirement. Weight deletion is not claimed as reliable unlearning.

## 7. Training data production

1. Freeze sources, permissions and benchmark splits before synthetic generation.
2. Cluster forks, copies, templates and semantically overlapping skill families. Review boundary samples manually.
3. Hold out entire families and source repositories. Do not generate training examples from held out instructions.
4. Create tasks with externally checkable final state and negative cases: unavailable tools, insufficient permissions, contradictory versions, missing prerequisites and tasks with no matching skill.
5. Execute teacher runs in disposable environments with bounded calls, time, network and spend.
6. Verify outcomes independently of teacher assertions. Store unsuccessful, timed out and invalid runs rather than silently dropping them from evaluation.
7. Use verified successful action traces for supervised execution training. Use verified failures and recovery pairs for routing or preference labels with explicit objectives; never label a failed action sequence as success.
8. Maintain a human audited sample of labels and report disagreement. Quarantine unreliable verifier families.
9. Train on training data, calibrate on development data, then evaluate frozen candidates once on the final holdout.
10. Record all candidates and outcomes, including losses.

Pilot scope: 20 to 50 reviewed executable skills and 500 attempted training trajectories, with realized valid yield reported. Expansion to 5,000 to 20,000 verified trajectories is conditional on measured yield and learning curves. Evaluation fixtures are separate from those training trajectories.

## 8. Evaluation protocol

### 8.1 Experimental arms

| Arm | Model and retrieval | Purpose |
| --- | --- | --- |
| A | Existing Ruflo configuration pinned to source | Production reference |
| B | Existing capable model with catalog retrieval | Isolate catalog value |
| C | Untrained small model with identical retrieval | Establish small model baseline |
| D | Trained small model with identical retrieval | Isolate training contribution |
| E | D with calibrated stronger model fallback | Measure deployable economics |
| R | Learned router with existing executor | Isolate routing value |

Use identical tools, permissions, task fixtures and maximum budgets. Count teacher fallback work in E. Randomize execution order and restore initial state between arms. Record cold and warm measurements, hardware, concurrency and caches. Include verifier cost consistently.

### 8.2 Test strata

1. Familiar skill families with novel tasks.
2. At least 100 entirely unseen skill families where catalog size allows it.
3. Newer skill versions with changed commands or conflicting previous guidance.
4. Similar skills with incompatible prerequisites.
5. Multi skill compositions and cross tool injection attempts.
6. Missing, revoked, unavailable or irrelevant skills.
7. Tenant isolation, secret leakage and unauthorized action attempts.
8. Timeouts, provider outages, malformed tool results and retry exhaustion.

No claim about unknown skills is valid if those instructions leaked into training. Base model pretraining contamination cannot be ruled out completely; report it and include private newly authored fixtures where feasible.

### 8.3 Metrics

Primary: independently verified task success and total cost per verified success.

Cost per success = total cost of all attempted tasks / number of verified successes.
If there are zero successes, cost per success is infinite. Include failed runs, retries, fallback, model hosting, retrieval, verification, data production and amortized training. Report marginal inference and fully loaded costs separately.

Secondary: macro skill selection F1, recall at k, schema validity, execution success, unnecessary escalation, failure without escalation, confidence calibration, p50/p95 end to end latency, cold start, peak memory, tool calls and provider tokens.

Safety: count proposed unauthorized actions separately from executed violations; report both denominators. Report task family and platform slices so aggregate gains cannot hide regressions.

### 8.4 Statistical rules and gates

Begin with 500 evaluation tasks distributed across at least 100 held out families when available. This is a pilot size, not a promise of sufficient power.

Before final evaluation, estimate required sample size from development discordance and family clustering. Freeze the sample size, noninferiority margin, cost target and analysis method. Use paired comparisons and cluster resampling by family for uncertainty; seeds and method are recorded.

Proposed opt in deployment gates, all required:

1. One sided 95% lower confidence bound on candidate success minus strong baseline success exceeds minus 0.02.
2. One sided 95% upper confidence bound on fully loaded cost per success ratio is at most 0.70.
3. End to end p95 latency is at most 1.10 times the baseline under the registered workload; also report absolute values.
4. No observed executed permission violations in the frozen adversarial suite, and all deterministic boundary tests pass.
5. Reproducible receipts and a demonstrated rollback.
6. Existing repository gates remain satisfied wherever applicable.

For the first small model cohort, use B as the strong task baseline and also report A. Training value compares D against C. Router default changes still require ADR-391; a favorable end to end result cannot silently replace its component latency or accuracy rules.

A confidence interval crossing a bound is inconclusive, not passing. Do not repeatedly add tasks until significance appears. Any extension follows a preregistered sequential method or uses a fresh confirmatory set with recorded error control. Repeated candidate selection must use the active governed evidence stream; confirm implementation before relying on ADR-381.

Zero observed violations is not proof of zero risk. With 500 independent trials and zero events, the approximate 95% upper bound is 3/500, or 0.6%; correlated adversarial cases weaken that interpretation. Production controls remain mandatory.

## 9. Capacity and economics

Illustrative planning arithmetic, not observed corpus statistics:

1. 100,000 skills at 2,000 tokens each produce 200 million source tokens.
2. One 768 dimension float16 embedding per skill requires 153,600,000 bytes, about 154 MB decimal, before graph, metadata and chunk overhead.
3. A 1B to 3B parameter model at four bits needs approximately 0.5 to 1.5 GB for raw weights, excluding scales, runtime, activations and KV cache. Training requires substantially more memory.
4. If a local attempt costs 5% of a teacher execution and 30% need a full teacher fallback, marginal cost is approximately 0.35 times baseline before retry and infrastructure overhead. This is only beneficial at comparable verified success.
5. Break even task count = incremental data and training cost / savings per task, only when savings are positive.

Record data generation cost, accepted trajectory yield, GPU hours, storage, host utilization and projected monthly task volume. Derive a pilot budget from a small measured batch before starting paid work. No monetary spend is authorized by this ADR.

## 10. Security and governance invariants

1. Ingestion never executes imported instructions.
2. Catalog presence is not authorization.
3. Retrieval applies tenant visibility before returning content.
4. Skill claims, model confidence and training labels cannot expand the SafetyEnvelope.
5. Delegation can only narrow capabilities and resource budgets.
6. External side effects require the existing action policy at execution time.
7. Teacher and student cannot modify hidden verifiers or promotion rules.
8. Immutable hashes bind source, data, model, tools, gate and environment.
9. Test fixtures and evaluation outcomes never enter training without retiring that holdout.
10. Updates and revoked sources invalidate eligibility as appropriate; promotion uses a fresh compatible receipt.
11. Candidate evaluation cannot mutate the active or served champion.
12. A public documentation repository must not contain private trajectories, credentials or licensed corpus copies without eligibility.

## 11. Integration plan

These are proposed seams, not claims that adapters already exist.

| Milestone | Inputs and assumptions | Outputs | Exit condition |
| --- | --- | --- | --- |
| M0: contracts and baseline | Pinned Ruflo source, existing router benchmark and policy inspection | Schemas, baseline receipts, bounded source list, budget estimate | Baseline reproduces or discrepancies are documented |
| M1: catalog | Eligible readable sources, frozen parser and embedder | Snapshot, dedupe families, filtered retrieval | Deterministic manifest; malicious archives and tenant tests pass |
| M2: routing | Independently labeled tasks and frozen splits | Classifier or reranker, calibration report | Demonstrated value over retrieval alone; existing gate respected |
| M3: trajectories | Reviewed skills, isolated executors, hidden verifiers | 500 attempted pilot traces and yield report | Provenance complete; audited labels and no export leakage |
| M4: execution adapter | Adequate eligible traces and measured budget | Pinned adapter, untrained control, evaluation receipts | Pass all gates or explicitly retain baseline |
| M5: shadow and canary | Valid receipt, existing promotion authority | Shadow report, bounded canary, rollback proof | Separate authorization and policy gates satisfied |

Prefer existing Ruflo hooks, AgentDB/RuVector indexing and MetaHarness receipts after source inspection. Keep model dependencies optional and the feature disabled by default. Define CLI and MCP schemas in implementation review, rather than advertising nonexistent commands here.

## 12. Rollout and rollback

Start offline, then shadow without side effects, then a bounded opt in canary. Pin the complete model and retrieval bundle. Keep existing routing available when the model fails to load, exceeds latency, abstains, or receives revoked content.

Promotion uses the existing atomic serving epoch transaction. Rollback restores the prior model, tokenizer, adapter, retrieval snapshot, thresholds and configuration as one compatible bundle. Halt the canary on any executed permission violation, verifier integrity failure, unauthorized data exposure or breached registered quality/cost limit. Preserve evidence and report the reason.

New verified production traces become candidates for a later dataset revision, never immediate live weight updates.

## 13. Risks and open decisions

Primary risk: polished imitation of instructions without executable competence. Mitigation: independent final state verification and unseen family evaluation.

Other risks include low usable corpus yield, disputed labels, source license uncertainty, malicious compositions, stale instructions, fallback consuming all savings, and benchmark overfitting.

Resolve during M0: accessible catalog adapters, training eligible license policy, tenant data retention, initial task domain, target hardware, base model license, active promotion implementation and compute budget. Model selection follows measurement; no particular base checkpoint is mandated.

## 14. Acceptance and review checklist

1. The design clearly distinguishes discovery, retrieval, execution and training.
2. A snapshot is replayable from hashes and pinned sources; missing sources are reported.
3. Dataset lineage proves family and repository separation.
4. Evaluation includes retrieval only and untrained model controls.
5. All costs include failures, retries and escalation.
6. Uncertainty can produce an inconclusive result.
7. Default router and promotion gates are unchanged.
8. Runtime authorization is independent of model output.
9. Quantized deployment is evaluated as the actual served artifact.
10. Rollback is demonstrated before activation.

## 15. References

1. Skills CLI: https://github.com/vercel-labs/skills
2. SFT training and tool calling data: https://huggingface.co/docs/trl/sft_trainer
3. Adapter quantization guidance: https://huggingface.co/docs/peft/developer_guides/quantization
4. Repository instructions: https://github.com/ruvnet/ruflo/blob/6cfd88654f2c571940f32704d79a2a1892de4392/AGENTS.md

External URLs are explanatory references. Any implementation must pin the actual dependency versions and licenses. All numerical deployment improvements in this ADR are targets or explicitly labeled illustrations, not achieved results.
