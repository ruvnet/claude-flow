# ADR-493: Ecosystem capability web and bounded improvement loop

Status: Implemented for bounded evaluation; automatic mutation and promotion excluded

## Outcome

Make package relationships inspectable and convert measured integration gaps into bounded, reproducible improvement work. The target is a tested path from advertised capabilities to useful workflows. More dependencies, graph edges or download events do not establish adoption or runtime compatibility.

Inputs are the captured 401 package npm graph, 42 source evidenced runtime relationships, download measurements and an explicit capability check registry. Outputs are a browser explorer, affected package plans, prioritized proposals, source bound check receipts and a deduplicated learning ledger. Registry refresh and package publication remain distinct operations.

## Constraints and acceptance

1. Preserve original npm declarations and aggregate download counts. Runtime relationships are separately typed evidence.
2. Account for every inventory node, including isolates and foundational leaves. Never insert dependencies merely to make the picture connected.
3. A capability may be declared or observed without being tested. Passing contract fixtures must be labelled as contracts. Environment availability remains unknown until explicitly probed.
4. Execute only registered repository test files through Node argument arrays. No shell strings or commands from registry package metadata. Bound checks, time, output and cycle count.
5. Hash graph, overlay, registry and relevant source/test files. Reject stale plans and receipts. Hashes establish identity, not trusted authorship.
6. A skipped, absent, failing or timed out check cannot establish a passing capability. Missing package coverage remains visible.
7. A candidate needs reproducible baseline and candidate evidence, at least 10 percent improvement in its declared objective and zero applicable regressions before it can be considered for review. Self reported numbers cannot authorize promotion.
8. Default actions produce review evidence. Existing ADR-322A promotion authority, signatures, credentials and release checks remain authoritative. The evaluator does not install, merge, publish or alter active runtime policy.
9. Web rendering uses local data and escaped text without analytics or remote code. It cannot execute tests or mutate packages.

## Selected architecture

The existing connectivity index provides typed forward and reverse traversal and cycle groups. A capability registry maps a small set of advertised, bounded capabilities to owned package names and explicit test files. The registry is reviewed repository configuration, not arbitrary downloaded metadata.

The RSI evaluator selects checks through reverse impact, reports uncovered affected packages, runs the checks under a finite budget and records source identity with each result. Proposal ranking uses observed isolates, floating runtime selectors, unresolved optional peers and measured download regressions. Historical outcomes inform subsequent review priorities. A ledger entry is not a permission grant or a substitute for rerunning checks.

A browser explorer shows the complete package inventory, filtered neighborhoods, edge types, capability evidence and loop results. A prepared web receipt is generated only after local source verification. Its graph, overlay and registry hashes are checked again in the browser. Recorded results describe the measured source state, not the visitor's installed environment.

The bounded loop performs:

```text
observe snapshots and source
validate provenance and registry
rank proposals using evidence and prior outcomes
select affected package checks
execute within the remaining budget
reject failed, skipped, stale or incomplete evidence
record results and review disposition
deduplicate equivalent learning entries
repeat only within explicit cycle budget
```

Success example: a source bound graph planning change passes its registered regression checks, produces a measured improvement and has its coverage limits recorded for review. Failure example: a candidate reports a large gain while its real integration test is skipped. The result remains incomplete and cannot be promoted.

## Alternatives

| Design | Download cost | Evidence quality | Operational risk | Decision |
| --- | --- | --- | --- | --- |
| Add dependencies to connect everything | High; measured umbrella proposal adds 111.97 MB | Connectivity does not prove compatibility | Broad failure and supply chain exposure | Reject |
| Read only package diagram | No consumer cost | Useful inventory but no executed checks | Low | Insufficient alone |
| Typed graph, registry and bounded evaluation loop | No added consumer dependencies for tooling | Reproducible checks with explicit gaps | Limited to reviewed test execution | Select |

## Trust model

Package names, registry contents, proposal text, historical receipts and browser data are untrusted input. Only reviewed local registry test paths are executable. Path traversal, symbolic link escape, shell injection, stale source, forged historical success, skipped tests and output exhaustion are covered by regression tests or explicit fail closed behavior.

The subprocess runner is a budget boundary, not an operating system sandbox. Repository tests can execute code with the caller's permissions. Run untrusted candidate checkouts in an isolated executor without production credentials. The static explorer has no backend authority.

## Adoption and optimization

Useful adoption measures are setup completion, time to first successful task, task success and returning usage, with consent and explicit measurement windows. None is inferred from npm totals. This implementation adds no telemetry collection.

The first optimization queue includes the 111.97 MB umbrella payload regression, 37 floating MetaHarness runtime selectors, an unavailable optional peer and 95 unclassified isolates. The loop may prioritize this work; it must not report those issues fixed merely because it generated proposals.

## Rollout and rollback

Ship as repository tooling and a static explorer linked from ecosystem documentation. Keep automatic mutation and release promotion disabled. Registry entries can expand one verified workflow at a time. Rollback removes the tooling and generated artifacts without changing package installation dependencies or existing runtime APIs.

## Validation trace

Acceptance evidence must include: graph search and selected neighborhoods; stale hash rejection; exact affected package selection; bounded execution and failures; honest capability states; finite loop completion; deduplicated ledger entries; unchanged dependency declarations and npm download inventory; and a real RuVector integration cycle. Published documentation will record the commands, coverage limits and remaining work.

## Implemented evidence boundary

The built in graph measurement compares the captured npm graph with the source evidenced runtime overlay. It reduces unexplained isolates from 138 to 95 (31.2 percent) and requires the relationship, graph and installed RuVector checks to pass. This makes the existing relationship annotation eligible for review. It is neither a newly discovered improvement each cycle nor evidence of runtime compatibility or adoption. Caller supplied objective scores cannot pass the promotion gate.

The initial registry covers 10 of 401 packages. Seven checks pass over two cycles, but 391 packages remain without registered checks and global promotion remains rejected. See [usage and validation](../../../docs/ecosystem/capability-web.md).

### Restart-persistent workflow extension

The eighth registered check composes real `@claude-flow/memory` SQL/WASM persistence with native `ruvector` retrieval in separate writer and reader processes. SQLite is authoritative and the vector projection is rebuilt from scoped persisted embeddings. This is application-level composition, not an invented package dependency. Missing native implementation fails closed. The test proves clean shutdown/restart and scoped retrieval; it does not prove crash durability, embeddings quality or AgentDB integration. Total package coverage remains 10/401; integration-covered inventory packages increase from 3 to 5. [Starter v1 and rollback](../../../docs/ecosystem/persistent-memory-v1.md).

## Durable ecosystem improvement extension

Decision accepted as operating policy; autonomous mutation, perpetual scheduling and universal runtime coverage remain unimplemented. Build a renewable service around bounded evaluations: package contracts, typed consumer impact, isolated candidates, independent validation, retained evidence and governed release. Each accepted change becomes the next baseline while a fixed reference detects gradual regressions. Correctness fixes need a reproducer; quantitative optimization claims retain the 10 percent threshold and zero applicable regressions.

Every maintained source package receives AGENTS.md pointing to the shared policy, without replacing existing instructions. The rollout inventory distinguishes local source documentation from external repository work and npm artifact inclusion. The 401 package inventory spans repositories; local coverage must never be reported as ecosystem completion.

Store source identities, environment, baseline and candidate measurements, test results, affected consumers, disposition, rollback and subsequent revalidation in durable evidence. Core memory is the decision record; RuVector retrieval is a rebuildable projection, not promotion authority. Use expiring leases, bounded retries, checkpoints, failure backoff, renewable budgets and an operator stop control.

The overnight pilot remains nine hourly runs, October 17 at 23:00 through October 18 at 07:00 America/Toronto, at most 45 minutes per run. It prioritizes the 111971638 byte payload regression, restart persistent memory and retrieval, then package guidance rollout. A permanent schedule is not established by this ADR.

Seven day acceptance target: at least two independently measured retained improvements, earlier gains preserved, and fixed consumer workflows passing. Report inconclusive experiments honestly. Never equate repeated passes, additional graph edges or downloads with compounding improvement.

[Shared package policy](../../../docs/ecosystem/package-improvement-policy.md), [rollout inventory](../../../data/ecosystem-guidance-rollout.json), and [core memory decision](https://github.com/ruvnet/core-memory/issues/186).

## Isolated candidate handoff extension

Specification: connect a current proposal to bounded, explicit executor work without granting proposal text execution authority or letting a candidate weaken its evaluator. Inputs are a clean expected base commit, current proposal hash, external destination and 1–20 exact allowed files. The existing loop remains observational. This extension does not implement an autonomous code generator.

Architecture: an atomic expiring lease coordinates each base/proposal pair; a detached worktree isolates edits. The evaluator uses the baseline registry and immutable controls, checks actual disk bytes and executable modes against the baseline tree, and constructs a candidate tree with an isolated Git index. Hidden index flags, staged additions, out-of-scope edits and candidate source movement fail closed. Both baseline and candidate execute the same selected registered checks. An isolated reverse patch must reconstruct the exact baseline tree.

Refinement: independent review reproduced hidden assume-unchanged tests, staged-addition omission and stale-lease cleanup failure. The implementation now directly hashes tracked files, includes index-only additions, rejects hidden index flags and validates lease ownership separately from evaluation freshness. Seventeen focused tests cover these failures and the failing-baseline/passing-candidate path. Submodules are explicitly unsupported in this first version.

Completion boundary: outputs are a source-bound patch, paired check receipts and manual PR text. Passing checks means review required, never improvement established or promotion allowed. A source rollback proof does not roll back database state. A trusted local executor is required; restricted environment forwarding, worktree isolation and child timeouts are not an OS sandbox. Crash-left coordination guards require operator inspection, not blind lease stealing. The check budget excludes some filesystem/Git overhead, and the outer run budget remains authoritative.

The payload and restart workflow remain retained baselines, not new gains on each rerun. This extension adds no dependencies, telemetry, merges or release authority. [Exact commands and recovery](../../../docs/ecosystem/candidate-work.md).

## Atomic memory snapshot correctness extension

Specification: preserve a completed writer when a previously opened reader exits, and retain a complete retrievable database when a writer process is interrupted. The baseline SQL/WASM shutdown exports its in-memory state even for a reader. An executable separate-process reproducer demonstrates loss of a newer saved record on baseline `039927ac4c953ff61e8c61738d3d5cc63dfb0595`.

Architecture and pseudocode: canonicalize a trusted private parent; readers copy and discard; writers acquire an exclusive adjacent five-minute lease, copy existing state into a same-filesystem staging directory, perform actual backend operations, close the backend, validate and fsync the complete export, verify lease ownership/expiry, rename atomically, fsync the parent, and clean only owned artifacts. Competing and expired locks fail closed rather than being stolen. Post-publication errors disclose committed state so callers do not blindly retry an append.

Refinement: independent targeted review caught blocking FIFO reads and ambiguous errors after publication. Nonblocking regular-file validation and committed-state annotations now have executable regressions. Actual package tests coordinate stale readers and writers through IPC and SIGKILL at both publication boundaries. The same race test fails on baseline and passes on the candidate. Source hashes and retained-baseline references are recorded in [snapshot safety evidence](../../../data/ecosystem-memory-atomic.validation.json).

Completion boundary: the starter now demonstrates process-interruption safety and cooperating-writer exclusion on local Linux/POSIX storage. This does not establish power-loss durability, malicious same-user isolation, network-filesystem semantics, Windows support or safety of old writers bypassing the wrapper. Package source and dependency declarations are unchanged; this is not a published backend fix. Stale locks require operator inspection and verified owner death. Source rollback cannot undo committed data and would reintroduce the stale-reader defect. Registry coverage remains eight checks over ten packages; unchanged payload savings are retained evidence, not a new quantitative gain.

## Namespace-safe memory lifecycle extension

October 18 follow-up: direct JavaScript callers can supply sparse arrays that JSON cannot represent. Array iteration that skips holes allowed an invalid embedding to be committed. The consumer now snapshots every array slot before finite Float32 validation, rejecting sparse writes, updates and retrieval queries before opening database state. The same three regressions fail on the prior source and pass on the candidate, including unchanged database bytes and successful subsequent restart retrieval. This is a correctness fix, not a new package integration or speed claim.

Specification: allow a caller to revise and delete saved content/embeddings, then exit and retrieve authoritative current state through a freshly rebuilt native vector index. Preserve IDs on update, exclude deleted records, leave unrelated namespaces untouched and reject a stale or partly invalid batch without changing authoritative bytes. Baseline reproducers demonstrate implicit duplicate-key replacement and cross-batch dimensional poisoning; both are correctness defects, not quantitative optimization targets.

Pseudocode and architecture: validate bounded input; acquire the existing snapshot writer lease; load all scoped rows including expired keys; preflight the entire batch; reject duplicate inserts, missing targets, ID/version conflicts, dimension mismatch or namespace capacity overflow; call actual backend update/delete with only allowlisted fields; verify results; close, sync and publish via the existing atomic snapshot protocol. ID plus version fences delete/recreate ABA. Namespace selection remains routing, not authorization. Missing update/delete databases fail rather than being synthesized.

Refinement: independent review reproduced both baseline defects, identified ABA when using version alone, and found that pinned backend `get(missingId)` returns a truthy empty record. The consumer requires expected ID plus version and verifies deletion using a scoped query. Source-bound tests cover complete restart sequences, ranking changes, stale requests, cross-namespace batches, invalid inputs, expired keys, capacity and SIGKILL on both sides of update/delete publication. No installed package source or dependency declaration is changed.

Completion: [v2 starter](../../../docs/ecosystem/persistent-memory-v2.md) demonstrates six real operations in six processes. [Lifecycle evidence](../../../data/ecosystem-memory-lifecycle.validation.json) preserves fixed and last accepted baselines, exact source identities, test commands and rollback. The functional loop budget increases from 60 to 120 seconds for the expanded test suite; the hard maximum and existing improvement thresholds stay unchanged. Coverage remains eight checks over ten packages. Deletion is logical, not secure erasure: existing readers, old stages or backups can retain content. Source rollback does not reverse data mutations. Actual agent execution, semantic embedding quality, physical power-loss durability and signed release validation remain separate acceptance gates.


## Bounded agent execution with persistent retrieval

Specification: execute an actual installed harness task, persist its verified result, exit, retrieve the saved result with native vector search after restart, and use it in a second real task. Denied execution and failed verification must leave authoritative database bytes unchanged. This extends verified memory into deterministic agent/tool execution, not model training or intelligence.

Architecture: compose the public HarnessKernel, AgentPool, AlgorithmRouter, PolicyGate and VerifierRegistry from exact harness 0.2.0 with the existing snapshot-protected memory workflow. Preflight exact qualified versions before mutation. Use fixed single-step local arithmetic workers, bounded inputs and an independent fixed-result oracle. Guard the memory callback with successful result plus valid receipt chain because the actual package invokes the callback on failed runs too. Persist successful outputs; rebuild scoped native retrieval in the next process.

Trust boundary: the kernel retrieves memory before its worker policy check, so execution denial is not memory-read authorization. Namespace selection remains routing. Upstream receipt input hashes omit goal/context; a separate unsigned consumer-input digest records those inputs without claiming authenticated provenance. Version checks are compatibility checks, not installed-code integrity. No general DAG correctness, hostile-code sandbox, semantic embeddings, LLM reasoning or training improvement is claimed.
Completion: the versioned [agent-memory v1 starter](../../../docs/ecosystem/persistent-agent-memory-v1.md) and required installed test are registered in CI and the bounded loop. Nine checks cover 11/401 inventory packages, with six integration-registered packages and 390 still uncovered. Tooling uses an explicit harness fixture without adding consumer dependencies to manufacture graph connectivity. Fixed payload, atomic-snapshot and lifecycle baselines remain retained evidence, not new gains. Existing promotion and signing gates remain unchanged. Source rollback removes this composition but cannot reverse saved task records.

## Fixed held-out task evaluation extension

Specification: evaluate actual task execution and saved results against three fixed public arithmetic cases, without training or accepting worker self-scores as proof. Preserve all cases in the denominator and reject supplied training IDs that overlap the holdout. This is a new executable package composition, not evidence of model improvement or a quantitative optimization.

Architecture and pseudocode: validate exact Weight EFT 0.1.2 and disjoint IDs before work; for each fixed case create a disposable private database, execute the existing first task, exit, execute the retrieval-dependent second task in another process, then independently retrieve its persisted output. Compare literal answers, input digests, qualified versions, worker calls and restart/persistence links. Pass resulting outcomes to actual Weight EFT summarizeCascade. No training export or model call occurs. The dataset hash is fixed in regression tests.

Refinement: independent review added a literal dataset-hash assertion and malformed evidence controls. Seven installed tests include a real verification-failed task that writes no database, wrong-output self-reports, missing/duplicate/substituted cases, ID overlap and absent dependency failures. Evidence remains unsigned and forgeable by a caller; validation checks consistency, not authentication. ID disjointness cannot prove content isolation or model generalization. The public holdout is an integration fixture, not a hidden benchmark.

Completion: [versioned starter](../../../docs/ecosystem/heldout-agent-memory-v1.md), required installed test, CI and bounded loop register the tenth check. Overall coverage stays 11/401 with 390 uncovered; integration-registered packages increase from six to seven because Weight EFT joins the real composition. Existing payload and memory references are retained unchanged. Promotion remains prohibited by this evaluator; independent security, release and signing gates stay in force. Rollback removes the new consumer/registry entry and restores the previous check count without mutating stored consumer data.
