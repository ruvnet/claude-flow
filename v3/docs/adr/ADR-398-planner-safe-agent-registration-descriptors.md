# ADR 398: Planner Safe Agent Registration Descriptors

Status: proposed

Date: 2026-09-16

Issue: #3342

## Context

Third party agent registries increasingly expose natural language descriptions to a central planner. `Misleading the Planner through Deceptive Resumes: Registration-Time Injection in Centralized Multi-Agent Systems` (arXiv:2609.15516, submitted 2026-09-14) demonstrates that malicious registration descriptions can change task decomposition, capability grounding, and subtask instructions before any worker is invoked. The originating team reports task success falling from 84.31 percent to 37.25 percent in a severe case and resource overhead above 111 percent in some attack settings.

The paper's DescGuard defense keeps only worker-scoped interface information before planner exposure. The strongest architectural lesson is that free form third party prose is an input to be minimized, not trusted because it was registered before the user request.

Current Ruflo A2A ingestion already provides a partial defense. `fromAgentCard` enters remote peers as untrusted and copies skill identifiers into the federation capability shape while omitting the card description and skill descriptions. There is no demonstrated exploit through that path. The risk is architectural drift: a future marketplace, gallery, MCP, plugin, or A2A planning integration could expose the currently discarded prose directly to a planner.

RVM issue 55 governs the later tool lifecycle and invocation boundary. This ADR governs the earlier planner registration boundary.

## Decision

Add a reusable `PlannerSafeAgentDescriptor` projection to the agent federation package.

A remote registration contributes only a canonical bounded capability identifier. Planner-visible semantics are resolved from a host-controlled capability catalog. The remote card description, skill description, examples, tags, provider text, documentation URL, extension parameters, and other free form fields are absent from the output type.

Unknown or malformed capability identifiers are omitted. The projection carries `authority: none`. It cannot grant invocation permission, change trust level, or bypass RVM authorization.

## Invariants

1. Third party free form registration text does not enter planner-visible output.
2. Capability identifiers are normalized with NFKC and restricted to a bounded ASCII identifier grammar.
3. Control, bidi, and invisible characters are rejected.
4. Unknown capabilities are not exposed to the planner.
5. Host-resolved planner fields are independently bounded and reject control characters.
6. Duplicate remote identifiers produce one planner capability.
7. The planner descriptor is deterministic for the same card and host policy.
8. The descriptor always carries `authority: none`.
9. Existing A2A discovery and trust semantics remain unchanged.
10. RVM remains the privileged effect boundary.

## Threat model

Covered attacks include instructions embedded in card descriptions, skill descriptions, examples, tags, provider metadata, extension parameters, Unicode controls, duplicate capability entries, unknown capability names, and resolver substitution.

This primitive does not attempt to prove that a host-authored capability definition is semantically correct. The host catalog is policy configuration and must remain independently reviewed. It also does not solve malicious tool behavior after registration. RVM issue 55 remains responsible for lifecycle validation and invocation authority.

## Benchmark

The deterministic structural benchmark uses five seeds and 10,000 generated cards. It compares a raw registration-text baseline with the safe projection and reports hostile free form exposure, unknown capability exposure, clean recognized capability retention, throughput, p95 batch latency, variance, runtime, cost, and energy availability.

Reproduction:

```text
cd v3/@claude-flow/plugin-agent-federation
npm ci
npm test
npm run benchmark:planner-descriptor
```

Structural acceptance requires zero hostile free form exposure, zero unknown capability exposure, and 100 percent retention of recognized clean capabilities on the frozen corpus. Task-level utility is a separate MetaHarness experiment and must not be inferred from the structural benchmark.

## Security review

The largest residual risk is catalog poisoning. If an attacker controls the host resolver, the trust boundary has merely moved. Production integrations therefore need catalog provenance, review, and version binding outside the remote registration path.

The second risk is capability identifier squatting. Federation identity or marketplace ownership must decide who may advertise a recognized capability identifier. The descriptor projection does not establish identity or ownership.

The third risk is denial of service through oversized registrations. The projection rejects cards above the fixed remote skill bound and caps planner-visible capabilities.

## Cross stack mapping

RuFlo owns registration and planner exposure. RVM owns invocation authority. RVF can bind source card and descriptor digests. MetaHarness evaluates attack success and planner utility. RuVector and RuVector WASM may index validated descriptors but cannot infer capability from untrusted description embeddings. Cognitum can reuse the boundary for partner catalogs and MCP discovery. Core Memory may record registration, review, and revocation evidence without granting authority.

## Migration and rollback

The change is additive. Existing `fromAgentCard`, discovery, trust evaluation, routing, and invocation behavior are unchanged. Consumers opt into the safe planner projection. Rollback removes the module, export, tests, benchmark, and documentation without persistent data migration.

## Governance

No autonomous merge, deployment, credential escalation, capability widening, evaluator mutation, threshold weakening, or irreversible migration. Human release approval remains required.