# ruflo-agntcy

AGNTCY/Outshift Internet-of-Cognition (IOC) runtime integration for Ruflo — the "AGNTCY-identified, SLIM-transported, CASA-authorized" leg of the clean-positioning stack described in [ADR-380](docs/adrs/ADR-380-agntcy-outshift-runtime-integration.md).

> AGNTCY and Outshift define the agent network. MetaHarness builds and evolves the agents. RuFlo executes and coordinates them. Meta LLM governs inference, cost, tenancy, and safety. RuVector supplies local memory and semantic state.

## Status: optional, removable augmentation

This plugin follows the **ADR-150 precedent**, not the ADR-321 hard-dependency exception (see [ADR-380 §1](docs/adrs/ADR-380-agntcy-outshift-runtime-integration.md#1-optional-removable-augmentation--follows-adr-150-not-adr-321)). AGNTCY/SLIM/CASA/IOC are early-stage, externally governed protocols (Cisco Outshift-led, Linux Foundation) this project does not control. Concretely:

- Every AGNTCY-facing package this plugin references (`@claude-flow/agntcy` and/or a Rust `ruflo-agntcy` crate) MUST live in `optionalDependencies`, never in `dependencies`.
- Ruflo MUST remain fully operational with every AGNTCY package removed — `npm ls --without @claude-flow/agntcy` (or equivalent) must still produce a working CLI.
- Every code path that touches AGNTCY infrastructure MUST catch `MODULE_NOT_FOUND` / connection-refused and fall back to today's local transport and existing tool-authorization model.
- This MUST pass a "works without AGNTCY installed" smoke test, mirrored on ADR-150's CI-gated architectural-constraint pattern.

## Upstream package status — corrected, and now live

**This section originally claimed no AGNTCY/SLIM/Outshift npm package existed under any plausible name.** That was wrong — the original check only tried guessed, scoped names and got 404s. The real SLIM package is `@agntcy/slim-bindings`, and as of 2026-07-31 it is genuinely live-connectable (pinned to the confirmed-working `2.0.0-alpha.5`; see [ADR-380's own "Update" sections](docs/adrs/ADR-380-agntcy-outshift-runtime-integration.md#update-2026-07-31--corrected-real-agntcy-packages-exist) for the full history, including two real upstream bugs found, filed, and resolved along the way). `detectAgntcyRuntime()` needed zero code changes for this — its existing graceful-degradation design already handled both "package resolves" and "package missing" correctly; only the pinned dependency version changed.

The remaining honest gaps: AGNTCY Identity has no JS/TS SDK (genuinely Go-only, verified), and this plugin's CASA policy compiler is a real, tested implementation but enforcement still lives in the runtime layer per ADR-380 §3, never in this compiler. Nothing here fakes a success it hasn't earned.

## What's Included (per ADR-380)

| Area | ADR-380 section | Scope |
|------|------------------|-------|
| **SLIM transport** | §2 | Opt-in transport switch (`ruflo transport use slim`) for cross-host/cross-tenant swarm and hive-mind coordination. Local in-process transport stays the default for single-host swarms — zero behavior change, zero new operational cost in the common case. |
| **CASA authorization** | §3 | Deterministic, deny-by-default enforcement of a compiled intent envelope (`allow`/`deny`/`budget_usd`/`expires_at`) in front of every MCP tool call and `Agent`/`Task` dispatch. Enforcement never asks an LLM whether an action is permitted — that would defeat the entire point of the gate. |
| **IOC Layer 9 coordination events** | §4 | Optional semantic coordination events (Semantic Information Exchange, Cognition and Interoperability, Semantic Alignment Broadcast, Team Formation via Polling) layered on top of — never replacing — Ruflo's own `hive-mind_broadcast` / `hive-mind_consensus` / `coordination_consensus` orchestration. |
| **AGNTCY identity/observability** | §5 | OTel span attributes (`agent.identity`, `agent.capability`, `agent.intent`, `agent.parent`, `coordination.episode`, `authorization.decision`, `model.route`, `memory.provenance`, `evaluation.score`, `receipt.hash`) wired through the existing `ruflo-observability` plugin rather than a second tracing pipeline. Ruflo owns the two runtime-only attributes (`coordination.episode`, `authorization.decision`); the rest are emitted build-time by companion metaharness ADR-240. |

## Companion ADR

This plugin's runtime half is paired with metaharness repo ADR-240 (build-time half — AGNTCY identity generation, OASF export, semantic observability at manifest time). Neither ADR is complete without the other; see [ADR-380's "Companion" note](docs/adrs/ADR-380-agntcy-outshift-runtime-integration.md).

## Requires

- `ruflo-core` plugin (provides the MCP server this plugin's tools/commands attach to)
- `ruflo-observability` plugin (span/trace sink for §5's AGNTCY OTel attributes)
- Optionally, once upstream stabilizes: `@claude-flow/agntcy` (TS) and/or a Rust `ruflo-agntcy` crate targeting SLIM (§6)

## Architecture Decisions

- [`ADR-380` — AGNTCY/Outshift Runtime Integration: SLIM Transport, CASA Enforcement, IOC Coordination Events](docs/adrs/ADR-380-agntcy-outshift-runtime-integration.md)

## References

- Cisco AGNTCY overview — https://outshift.cisco.com/the-internet-of-agents/agntcy
- AGNTCY Identity — https://github.com/agntcy/identity
- AGNTCY Directory — https://github.com/agntcy/dir
- AGNTCY Observe — https://github.com/agntcy/observe
- SLIM architecture — https://github.com/agntcy/slim
- Cisco CASA overview — https://outshift.cisco.com/blog/ai-ml/continuous-agentic-semantic-authorization-for-mas
- IOC protocol repository — https://github.com/outshift-open/ioc-protocols-models
