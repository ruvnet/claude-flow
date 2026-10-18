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
