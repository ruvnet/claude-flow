# ADR-400: Task-Conditioned Resource Admission

Status: proposed

Date: 2026-09-21

Issue: #3388

## Context

Agent serving mixes remote model latency with local tool execution, so end-to-end task latency is a poor proxy for local resource demand. `Not All AI Agents Are Equal: Characterizing Resource and Performance Dynamics` (arXiv:2609.19947, submitted 2026-09-17) reports task-dependent CPU, memory, disk-I/O, and remote-wait behavior across retrieval-augmented QA, web search, and coding. The originating team reports CPU-aware tool admission improving CPU-sensitive task latency by up to about 5.4x and task-aware CPU allocation reducing mixed-workload average latency by about 32% versus its native-agent baseline.

The paper is an originating-team result, not an independently reproduced RuFlo claim. Its systems measurements replay recorded Gemini 3 Flash trajectories on an Azure VM with 24 vCPU AMD EPYC 7V13 and 216 GB RAM. GPU inference is out of scope because the model is accessed remotely.

RuFlo already contains generic load-balancing and resource-allocation guidance. The missing reusable primitive is a deterministic policy that separates measured task/tool resource phenotype from current host pressure and from host-supplied safety ceilings.

## Decision

Add a pure `ResourceAdmissionPolicy` primitive to `@claude-flow/performance`.

The policy consumes a provenance-bound resource profile, a fresh host telemetry snapshot, a fixed host policy, and requested concurrency. It returns only an admission recommendation and CPU allocation recommendation.

It does not execute a task, mutate container limits, kill another task, alter RVM authority, or widen a host ceiling. Every decision carries `authority: none`.

CPU allocation is reduced for remote-wait-dominant work because additional local cores are unlikely to improve the critical path. CPU-sensitive work receives more of the available per-task envelope when pressure allows it. High CPU, memory, or I/O pressure causes defer decisions for workloads sensitive to the pressured resource. Stale evidence fails closed.

The decision fingerprint is deterministic but intentionally non-authoritative and non-cryptographic. Production provenance or signing belongs at the RVF/RVM boundary.

## Invariants

1. A recommendation never exceeds the profile, host, or policy CPU ceiling.
2. Aggregate recommendation under declared concurrency never exceeds current allocatable CPU after configured headroom.
3. Stale or future evidence cannot result in an expanded allocation.
4. Malformed profile or telemetry evidence is rejected.
5. Natural-language task descriptions are not policy input.
6. The primitive grants no execution capability and carries no authority.
7. Resource history from RuVector may inform a future profile estimator, but retrieval confidence cannot override a host ceiling.
8. A task-conditioned policy cannot preempt an incumbent task; destructive conflict resolution remains a separate RVM-controlled decision.

## Falsification

Independent MetaHarness evaluation must compare fixed allocation, generic utilization-only allocation, task-conditioned allocation, and a retrospective oracle under matched model, workload, host, resource budget, and evaluator conditions.

Required workloads include CPU-bound retrieval, remote-wait-heavy search, I/O-heavy coding, bursty memory workloads, malformed profiles, stale telemetry, resource exhaustion, and adversarial attempts to exceed a ceiling.

Reject this architecture if generic utilization-only control matches it within noise, if a stale profile causes unsafe admission, or if gains on one workload come from starving another.

## Benchmark contract

Report baseline and candidate, exact commit, hardware, operating system, Node version, workload, model/API version where relevant, seeds, sample size, p50 and p95 latency, throughput, CPU-seconds per completed task, memory peak, disk I/O, task success, failures, variance, cost, energy where measurable, ablations, and reproduction commands.

The pure policy benchmark requires zero ceiling violations, zero non-deterministic decisions, and less than 100 microseconds p95 decision overhead.

System-level promotion requires at least one of:

1. at least 15% lower p95 tool latency;
2. at least 15% higher throughput at the same resource budget;
3. at least 20% lower CPU-seconds per completed task;

with no task-success regression greater than 2 absolute points and no protected fairness or starvation regression.

## Cross-stack mapping

RuFlo consumes the policy for future scheduling and admission.

MetaHarness owns independent systems evaluation and protected fairness tests.

RVM remains the effect and resource-ceiling enforcement boundary.

Core Memory stores accepted profiles and benchmark evidence with provenance.

RuVector and RuVector WASM may retrieve historical resource phenotypes but never grant allocation authority.

RVF binds profile, telemetry, decision, and evaluation digests. RVForge packages only reproduced policy artifacts.

Autogenous and Dream Machine may improve profile estimation after baselines freeze, but cannot modify resource ceilings or acceptance thresholds.

MidStream carries telemetry and phase-boundary observations.

RuView, RuField, and WorldGraph can use the same primitive for sensing and spatial pipelines where task resource profiles differ materially.

LatentMesh can contribute distributed pressure observations without creating trust.

Cognitum can use accepted policy behavior to improve tenant density, latency, and gross margin under explicit SLA ceilings.

MCP supplies tool identity; host-bound policy decides local admission.

## Migration and rollback

The change is additive. Existing scheduling behavior remains unchanged until a later, separately reviewed integration chooses to consume the policy. Rollback removes the module, export, tests, workflow, and ADR. No durable schema migration is required.

## Governance

No autonomous merge, deployment, scheduler integration, resource-limit mutation, credential escalation, or weakening of admission and evaluation gates is permitted. Independent MetaHarness evidence and human approval are required before integration.