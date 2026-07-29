# ADR-329: Ruflo Capability Brain for MCP Guidance

**Status:** Accepted  
**Date:** 2026-07-28  
**Owners:** Ruflo CLI, Guidance, Security, and Release Maintainers  
**Related:** ADR-150, ADR-176, ADR-320, ADR-322, ADR-324, ADR-325, ADR-327, ADR-328

## Context

Ruflo exposes a broad system through MCP tools, CLI commands, agents, skills,
packages, and plugins. The previous guidance catalog described 16 hand-written
areas and referenced 99 tool names. An audit of the current server found:

- 353 unique live tools when the optional raw-browser runtime is installed;
- 330 always-registered tools without that conditional runtime;
- only 61 of the 353 live tools referenced by the old catalog;
- 292 live tools omitted from that catalog;
- 38 catalog references that no longer resolve to live tool names;
- one exported `testgen_tdd_repair` tool that is not registered by the MCP
  client;
- plugin skills, `.agents/skills`, package ownership, plugin ownership,
  authority, risk, degraded behavior, and implementation-loop placement absent
  from discovery.

This created two failures. Users could not discover most of Ruflo, and agents
could mistake catalog text or MCP registration for proof that a provider was
configured, reachable, healthy, and authorized.

## Decision

Ruflo will ship a capability brain behind `guidance_brain` and enhance the
existing guidance tools without removing their compatibility surface.

The brain is generated from the completed live MCP registry. A static domain
definition supplies semantics; it does not supply runtime presence. The MCP
client injects its registry into guidance after all conditional and filtered
tools have been registered. This avoids a circular import and makes silent
catalog drift testable.

### Truth model

Every domain reports these facts independently:

| Fact | Meaning |
|---|---|
| `catalogued` | This Ruflo version describes the capability. |
| `registered` | The tool exists in this MCP process. |
| `configured` | Required settings/providers are present. |
| `reachable` | A non-mutating dependency probe succeeds. |
| `healthy` | The dependency satisfies its health contract. |
| `authorized` | Current subject may perform the exact action on the resource. |

Only `registered` can be derived from the MCP registry. The other dimensions
remain `unknown` until their dedicated adapters evaluate them. No single
“available” badge may collapse these dimensions.

### Complete capability surface

`guidance_brain` exposes:

1. every live registered MCP tool, assigned exactly once;
2. domain, owner, maturity, authority, risk flags, side-effect class,
   availability mode, implementation-loop phases, and verification guidance;
3. all 52 top-level CLI commands;
4. installed agents and skills from `.claude`, `.agents`, and plugin roots;
5. package and plugin manifests;
6. coverage gaps, duplicates, and fallback classifications;
7. task recommendations filtered to tools actually registered in this process.

The major domains deliberately distinguish:

- policy authorization from exclusive work claims;
- AIDefence content-safety evidence from authorization;
- memory recall from validated memory commit;
- MetaHarness/Darwin/Flywheel evaluation from promotion;
- consensus from authority;
- worktree leases from product or release authority;
- local/runtime capabilities from network and external-service actions.

The compatibility `guidance_capabilities` response remains available, but its
old string catalog is labeled compatibility-only and each legacy reference is
marked registered or unregistered. New routing consumes the live brain.

### Identity and OAuth guidance

The brain includes Ruflo's implemented Cognitum identity lifecycle from
[ADR-306](ADR-306-cognitum-authentication-account-linking.md) as a distinct
control-plane domain:

- `ruflo auth login` uses loopback PKCE on an interactive desktop;
- `ruflo auth login --no-browser` uses the implemented OOB/manual-paste flow;
- noninteractive login refuses unless `--token-stdin` is explicit;
- `ruflo auth status` is offline-safe, while `--check` may perform
  demand-driven keychain refresh;
- scopes remain bound to local consent receipts; `account.create` does not
  imply hosted memory, routing, telemetry, deployment, IAM, or billing;
- local logout clears session/profile/keychain state but does not claim
  server-side revocation, because the currently proven identity surface does
  not expose that operation.

RFC 8628 polling, a new Ruflo-specific OAuth client registration, automatic
existing-install prompts, and hosted memory/device-flow contracts remain
upstream work. Guidance must report those as unavailable rather than inventing
endpoints or silently broadening scope. Authenticated identity is still
independent of service configuration, reachability, health, and action
authorization.

### Capability metadata

The v1 brain uses domain-derived metadata for tools:

```text
name
domain
packageOwner
pluginOwner
availabilityMode
authority
risk
riskFlags
loopPhases
health.registered
health.configured
health.reachable
health.healthy
health.authorized
```

Availability modes are `always-local`, `conditional-registration`,
`registered-degraded`, `configured-remote`, and `policy-filtered`.

Risk flags cover read, local write, memory poisoning, process execution,
network, credentials/PII, spending, concurrency, destructive actions,
approval, and promotion. V1 supplies conservative domain defaults. A future
generated per-tool descriptor may narrow those defaults, but may never
silently lower risk.

### Normative implementation loop

Guidance recommendations and generated `AGENTS.md` files use this loop:

1. **Recall** prior memory and ADR constraints.
2. **Inspect** source, runtime, dependency, policy, and health state.
3. **Route** to the smallest capable topology, agents, skills, and tools.
4. **Plan** acceptance criteria, safety envelope, ownership, and validation.
5. **Execute** in isolated scopes; Ruflo coordinates while an executor works.
6. **Test** focused, regression, and failure paths.
7. **Validate** types, security, policy, compatibility, and artifact integrity.
8. **Benchmark** a source-bound candidate against a source-bound baseline.
9. **Optimize** only measured bottlenecks without weakening safety.
10. **Receipt** claims and evidence against exact source/build inputs.
11. **Handoff** and reconcile concurrent ownership and limitations.
12. **Publish** only through a separately authorized release gate.

Self-learning follows `recall → propose/branch → evaluate/critique →
commit-validated`. A memory or policy mutation requires a content digest and
validation receipt. No memory, neural, MetaHarness, Darwin, Flywheel, claims,
or consensus tool may authorize its own promotion.

## MCP contract

`guidance_brain` supports:

| Mode | Result |
|---|---|
| `overview` | Truth model, coverage, commands, registered domains, loop |
| `capabilities` | Full domain/tool descriptors, optionally one domain |
| `coverage` | Exact tool-to-domain assignments and gaps |
| `ecosystem` | Agents, skills, plugins, packages, and commands |
| `recommend` | Task-ranked live capabilities and guarded loop |
| `implementation-loop` | Normative stages, evidence, mutation class, invariants |

`guidance_discover` also discovers agents, skills, plugins, and packages.

## Backward compatibility

- The five existing guidance tool names and input modes remain.
- `guidance_brain` is additive.
- The old catalog is retained as an explicitly deprecated compatibility view.
- Conditional browser registration remains conditional.
- Optional packages remain registered-degraded where their handlers already
  implement that contract.
- Policy administration remains absent from remote MCP; only evaluation and
  status are registered.
- `testgen_tdd_repair` is catalogued but honestly reports unregistered until a
  separate decision registers it.

## Security and authority invariants

1. Registration never implies configuration, health, or authorization.
2. Recommendation is advisory and cannot invoke a tool.
3. A work claim cannot grant product, network, billing, IAM, or release access.
4. A score, signature, receipt, consensus vote, or memory does not authorize
   itself.
5. A degraded or fallback evaluator cannot promote unless an independent
   policy explicitly permits that exact substitution.
6. External writes, spending, destructive actions, credentials/PII, and
   promotion require explicit risk and approval handling.
7. Publication binds immutable artifacts to exact source/build evidence.

## Validation

Acceptance tests must prove:

1. every live registered tool is assigned exactly once;
2. no duplicate live tool names exist;
3. fallback classifications are reported and fail the repository coverage
   gate until assigned;
4. a catalogued but unregistered capability reports `registered: false`;
5. the five health/authority dimensions remain independent;
6. every recommendation returns the complete implementation loop;
7. publication is the final external-mutation stage and requires independent
   authorization;
8. filesystem discovery covers `.claude`, `.agents`, packages, and plugins;
9. missing optional providers remain degraded/unknown, not “available”;
10. policy authorization, work claims, and content safety remain separate.

The initial implementation classifies all 353 tools observed on Node 22/Linux
with the browser runtime installed, with no fallback classifications or
duplicates. This count is an environment observation, not a fixed protocol
constant; the coverage invariant is percentage and exact assignment.

## Performance budget

Brain construction and recommendation are local metadata operations. The
benchmark profile must measure the maximum live registry, report median and
tail latency, and fail if a future catalog change introduces an accidental
network call or tool execution. Filesystem ecosystem discovery is measured
separately because it performs bounded local I/O.

## Consequences

Users and agents can now ask Ruflo what it can actually do, receive safe
workflow guidance, and see capability gaps without reading hundreds of source
files. The cost is a maintained semantic domain map and mandatory coverage
tests. Service-specific health and authorization probes remain adapter work;
the brain exposes those unknowns instead of inventing a positive answer.
