# ADR-380 — AGNTCY/Outshift Runtime Integration: SLIM Transport, CASA Enforcement, IOC Coordination Events

- **Status**: Proposed
- **Date**: 2026-07-30
- **Related**: ADR-150 (MetaHarness integration surfaces — the optional/removable-augmentation precedent this ADR follows), ADR-321 (metaharness hard-dependency exception — explicitly **not** followed here, see Decision §1), Cognitum funnel/tenancy ADRs (ADR-301/305/306 — tenant field alignment)
- **Companion**: metaharness repo ADR-240 (`agent/adr-237-agntcy-outshift-integration` branch) — AGNTCY identity, OASF export, semantic observability. That ADR covers what MetaHarness produces at build/manifest time; this ADR covers what RuFlo does with it at runtime. Neither is complete without the other; they are numbered and shipped as a pair.
- **Prompted by**: a strategic brief evaluating Cisco Outshift's AGNTCY / Internet of Cognition ecosystem (Mycelium is one coordination implementation inside that broader IoC program) as complementary, not competitive, infrastructure:

  > AGNTCY and Outshift define the agent network. MetaHarness builds and evolves the agents. RuFlo executes and coordinates them. Meta LLM governs inference, cost, tenancy, and safety. RuVector supplies local memory and semantic state.

## Context

A repo-wide check found **zero existing references** to AGNTCY, Outshift, OASF, CASA, SLIM, or Mycelium anywhere in this codebase — genuinely greenfield, not a gap in an existing effort.

Two of the "clean positioning" stack's five legs are already real, shipping components and require no new work to be true:

- **"Meta LLM governs inference, cost, tenancy, and safety"** — already this repo's documented role for the meta-llm gateway (`metallm_delegate`/`metallm_ask`, root `CLAUDE.md`'s "Gateway-Delegated Development" section): cost-tier routing, metered spend, cwd-sandboxed agentic sub-tasks.
- **"RuVector supplies local memory and semantic state"** — already shipping (`ruflo-ruvector` plugin, `vector-engineer` agent, HNSW/RaBitQ-backed AgentDB memory).

This ADR is scoped to the two genuinely new legs RuFlo itself needs: AGNTCY-identified, SLIM-transported coordination, and CASA-enforced authorization — plus optional IOC Layer 9 coordination events layered on top of existing swarm/hive-mind orchestration.

## Decision

### 1. Optional, removable augmentation — follows ADR-150, not ADR-321

Unlike metaharness (ADR-321's hard-dependency exception, justified because metaharness is this project's own sibling tooling with an established track record), AGNTCY/SLIM/CASA/IOC are early-stage, externally governed (Cisco Outshift-led, Linux Foundation) protocols this project does not control. Every new package this ADR introduces — a TS `@claude-flow/agntcy` package and/or a Rust `ruflo-agntcy` crate (§6) — MUST live in `optionalDependencies`, MUST degrade gracefully (`MODULE_NOT_FOUND` / connection-refused → fall back to today's local transport and existing tool-authorization model), and MUST pass a "works without AGNTCY installed" smoke test — mirroring ADR-150's four architectural-constraint rules verbatim: removable, optional-only, graceful degradation, CI-gated.

### 2. SLIM transport for distributed coordination — local transport stays the default

Add three new `ruflo` CLI verbs:

```text
ruflo transport use slim
ruflo agent publish
ruflo swarm join cognitum/research/security
```

`ruflo transport use slim` switches the active swarm/hive-mind transport from today's in-process/local-hooks routing to SLIM (Rust, secure messaging for MCP/A2A, hierarchical routing, reliable delivery, group membership, MLS end-to-end encryption; JWT/mTLS/SPIFFE/WebSocket/Unix-socket auth) for agents coordinating across hosts or across a Cognitum tenant boundary.

**Keep the current local transport as the default for single-host swarms.** The originating brief is explicit that SLIM infrastructure adds unnecessary operational cost there, and this repo already has a working local coordination path (`swarm_init`/`hive-mind_*` MCP tools, the hierarchical-mesh anti-drift topology) that must not regress in the common case.

`ruflo agent publish` emits the AGNTCY-identified, OASF-described agent record (produced build-time by metaharness ADR-240 §2.1/2.2) to the configured Directory. `ruflo swarm join <namespace>` joins a SLIM group-membership channel scoped to a Cognitum tenant/project namespace.

Estimated effort: 15–25 days.

### 3. CASA intent-scoped authorization enforcement

MetaHarness (companion ADR-240 §4) compiles a user's objective into a bounded authority envelope. RuFlo is where that envelope is **enforced** at every tool invocation:

```json
{
  "objective": "review repository security",
  "allow": ["repository.read", "tests.execute"],
  "deny": ["git.push", "secret.export", "deployment.create"],
  "budget_usd": 8,
  "expires_at": "2026-07-30T22:00:00Z"
}
```

- **Meta LLM** enforces `budget_usd` and provider policy — already its documented role; the new work is wiring this envelope's budget field into the existing `metallm_delegate`/`metallm_ask` cost-governance path, not inventing new budget machinery.
- **CASA** enforces `allow`/`deny`/`expires_at` at the network/tool-authority layer — this is new: a deterministic gate in front of every MCP tool call and every `Agent`/`Task` dispatch, checked against the envelope *before* dispatch, never after.
- **RuFlo logs every decision into signed receipts** — extends this repo's own signed-manifest precedent (`ruflo-core:witness-curator`, the ADR-103-style fix-attestation model) to per-invocation authorization decisions, not just release-time fix state.

**The single non-negotiable design constraint in this entire integration**, restated plainly because it is also the brief's explicitly named biggest failure mode: the *translation* of intent into the envelope may use an LLM (that's MetaHarness's job, companion ADR-240 §4). *Enforcement* must never ask a model whether an action is permitted at invocation time — it checks a bounded schema (explicit resource strings, explicit deny list, numeric budget, expiry timestamp) with deterministic code, deny-by-default. No code path in this ADR's implementation may let an LLM's runtime judgment substitute for the compiled envelope's `allow`/`deny` lists. This must be verified with explicit bypass-attempt tests, not just translation-quality tests, before enabling CASA enforcement by default for any tenant.

Estimated effort: 15–25 days (shared with companion ADR-240's compiler half: schema + translation-quality tests there; wiring + enforcement + bypass-attempt tests + receipts here).

### 4. IOC Layer 9 cognition envelopes — optional coordination events, not a replacement

Support Cisco's semantic protocols above MCP/A2A — Semantic Information Exchange, Cognition and Interoperability, Semantic Alignment Broadcast, Team Formation via Polling — as **optional RuFlo coordination events**, layered on top of existing swarm/hive-mind coordination (`hive-mind_broadcast`, `hive-mind_consensus`, `coordination_consensus`). This never replaces RuFlo's own orchestration — it is additive, consistent with this repo's existing anti-drift preference for RuFlo-owned hierarchical coordination as the default.

The schemas are Apache-2.0 with existing Python and Go bindings. Ship a native Rust implementation as a genuine upstream contribution to `outshift-open/ioc-protocols-models`, not a private fork — the same posture this project already takes toward other upstream ecosystems it depends on.

Estimated effort: 10–15 days.

### 5. AGNTCY semantic observability — the runtime-only spans

Map RuFlo spans and Flywheel-style receipts onto AGNTCY's OTel extensions (`agent.identity`, `agent.capability`, `agent.intent`, `agent.parent`, `coordination.episode`, `authorization.decision`, `model.route`, `memory.provenance`, `evaluation.score`, `receipt.hash`). RuFlo owns `coordination.episode` and `authorization.decision` specifically — the two attributes companion ADR-240 §2.3 explicitly defers here, since both only exist once SLIM/CASA are active at runtime. Wire this through the existing `ruflo-observability` plugin (`observe-trace`/`observe-metrics` skills) rather than inventing a second tracing pipeline.

Estimated effort: 5–8 days (shared line item with ADR-240 §2.3 — RuFlo emits the two runtime-only attributes; MetaHarness emits the rest).

### 6. `@claude-flow/agntcy` package and Rust `ruflo agntcy` crate

Mirrors metaharness's own sibling-package pattern (`@metaharness/darwin`, `@metaharness/redblue`) and this repo's own plugin-package convention (`plugins/ruflo-*`): an isolated, optional package rather than code folded into `@claude-flow/cli` directly, so §1's removability constraint has a clean boundary to enforce against.

The Rust crate specifically targets SLIM (already Rust) and the native IOC Layer 9 implementation (§4) — natural Rust surfaces, not TypeScript. This is a good technical fit independent of any workstation-level preference, given SLIM's own implementation language; existing Rust CI plumbing in this repo (`.github/workflows/federation-peer-rust.yml`) is a candidate to extend rather than standing up a second Rust CI pipeline from scratch.

## Consequences

### Positive

- Two of the "clean positioning" stack's five legs (Meta LLM cost/tenancy governance, RuVector local memory) are already real and require zero new work to be true — this ADR only has to build the two genuinely new legs (AGNTCY-identified execution/coordination, CASA-enforced authority) plus the optional IOC layer.
- SLIM's opt-in design (§2) means single-host swarms — the overwhelming common case today — see zero behavior change and zero new operational cost.
- Extending the existing witness/receipt-signing precedent to per-invocation CASA decisions reuses a pattern this repo already trusts, instead of inventing a second audit-log format.

### Negative / risks

- CASA enforcement is a new mandatory gate in front of every tool dispatch once enabled — a bug here is a security regression, not a feature bug. It needs the "no LLM-in-the-enforcement-loop" test discipline from §3 verified by explicit bypass-attempt tests before shipping enabled-by-default for any tenant.
- SLIM introduces a new Rust dependency surface and a new network topology (group membership, MLS encryption) this repo doesn't operate today — a real operational learning curve, mitigated by keeping it strictly opt-in per §1/§2.
- AGNTCY/Outshift ecosystem immaturity risk, same caveat as companion ADR-240: treat every new package here as optional and versioned, never load-bearing, until the upstream specs stabilize past 1.0.

## Alternatives Considered

- **Building CASA-equivalent enforcement as a bespoke ruflo-only authorization layer instead of adopting CASA.** Rejected — this repo already has `claims_*`/AuthScope machinery (the `claims-authorizer` agent); the intent-scoped, budget-and-expiry-bearing envelope CASA describes is a genuine capability gap that machinery doesn't currently cover, and building a second bespoke scheme when an emerging standard exists trades a small integration cost now for a larger reconciliation cost later.
- **Making SLIM the default transport immediately.** Rejected per the brief's own explicit guidance — unnecessary operational cost for single-host coordination, which is most of this repo's actual usage today.
- **Treating IOC Layer 9 as a replacement for RuFlo's own hive-mind/swarm orchestration.** Rejected — explicitly scoped as optional coordination *events* layered on top, consistent with this repo's existing anti-drift preference for RuFlo-owned hierarchical coordination as the default.

## Acceptance Test

Shared with companion ADR-240: generate a MetaHarness agent, publish its signed OASF record (ADR-240), discover it from a second network (ADR-240, via Directory), verify its AGNTCY identity (ADR-240 §2.1), invoke it through SLIM (this ADR §2), reject one out-of-scope tool call through CASA (this ADR §3, using ADR-240 §4's compiled envelope), and reconstruct the complete run from OpenTelemetry spans and Flywheel receipts (this ADR §5 + ADR-240 §2.3).

## Open Questions

- Should `ruflo transport use slim` be a per-swarm setting or a global session default? (Leaning: per-swarm, consistent with per-tenant SLIM group membership.)
- Does the existing `claims_*` AuthScope machinery get subsumed by CASA envelopes over time, or do they stay parallel (claims = internal agent-to-agent authorization, CASA = user-intent-to-network authorization)? Worth its own follow-up ADR once §3 ships and the overlap (or lack of one) is concretely observable.
- Where does the Rust `ruflo agntcy` crate live — a new top-level package, or folded into the existing federation-peer-rust surface given the CI plumbing already exists there?

## Update (2026-07-31) — corrected: real AGNTCY packages exist

This ADR's original text (and the code it shipped with, PR #2879) stated
that no AGNTCY/SLIM/Outshift npm package existed anywhere under any
plausible name. **That was wrong**, and is corrected here rather than
silently edited out of the history above, per this repo's own norms around
honest documentation.

The original check only tried *guessed, scoped* names (`@agntcy/slim`,
`@agntcy/dir`) and got 404s. The real packages are unscoped or differently
suffixed:

- **`@agntcy/slim-bindings`** (npm, v1.4.1 stable / v2.0.0-alpha.4) — real
  SLIM Node.js bindings, documented for exactly the plain-Node use case §2
  needs. Now correctly named in `runtime.ts`'s `AGNTCY_PACKAGE_NAME` and
  declared in `optionalDependencies`.
- **`agntcy-dir`** (npm, v1.5.0) — real Directory JS/TS SDK, used by the
  companion ADR-240 §2.2 for real, live-tested push/publish/lookup against
  a real Directory server (Go apiserver + zot + postgres, run locally from
  `agntcy/dir`'s own `install/docker/docker-compose.yml`).

**SLIM specifically is still not live-connectable today** — not because no
package exists, but because of a real, verified, upstream packaging bug: a
transitive dependency (`uniffi-bindgen-react-native`) ships raw,
uncompiled TypeScript as its package.json `main` with no build output,
which only works inside a bundler (Metro) and fails to load under plain
Node `require`/`import`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, reproduced directly).
Filed upstream: [agntcy/slim#1916](https://github.com/agntcy/slim/issues/1916)
(downstream impact — their own README's plain-Node example is currently
broken by this) and
[jhugman/uniffi-bindgen-react-native#422](https://github.com/jhugman/uniffi-bindgen-react-native/issues/422)
(root cause). `detectAgntcyRuntime()`'s existing graceful-degradation
design (§1) already handles this correctly with zero code changes needed —
its catch-all branch surfaces the real error and falls back to local
transport, verified against the exact real failure mode.

Root cause investigated (in `agntcy/oasf-sdk`, hoping to find something
patchable) before concluding a PR wasn't possible for the Directory-side
class-name validation bug either — that validation logic turned out to be
a remote hosted service (`schema.oasf.outshift.com`), not local source in
any AGNTCY repo. Filed as
[agntcy/dir#1943](https://github.com/agntcy/dir/issues/1943) instead.

## Update (2026-07-31, part 2) — both filed bugs resolved; SLIM is now live

**agntcy/dir#1943 was our bug, not upstream's.** Maintainer @akijakya
identified the real cause: the record pushed to the Directory declared
`schema_version: '0.8.0'` while the skill ids/names being sent were derived
from OASF **1.1.0**'s taxonomy — the server validates a skill against the
taxonomy for the record's *own declared* version, so every 1.1.0-derived
id/name was checked against 0.8.0 and correctly rejected. `id=60101`
"worked" only by coincidence (0.8.0 has an unrelated skill, "indexing", at
that same numeric slot). Fixing `schema_version` to `'1.1.0'` in the
companion metaharness package resolved it completely — verified live, all
9 previously-"broken" ids now push, and `id`+`name` sent together also
works. Closed the issue with the resolution.

**agntcy/slim#1916 is now live-connectable.** The SLIM maintainers
confirmed they've moved off `uniffi-bindgen-react-native` onto
`@ubjs/core`/`@ubjs/node` (compiled output) in the `alpha` dist-tag
(`2.0.0-alpha.4+`), not yet promoted to `latest`. Verified live: a real
server bring-up + client connect + graceful shutdown against
`@agntcy/slim-bindings@2.0.0-alpha.5` succeeds under plain Node with zero
errors. `package.json` now pins that exact version (deliberately, not a
caret range — this is a pre-release channel) until the fix is promoted to
`latest`. `detectAgntcyRuntime()` needed **zero code changes** — its
existing graceful-degradation design already handled both directions
correctly; only the pinned dependency version and its own doc comments
changed. Real, end-to-end verified: `detectAgntcyRuntime()` now returns
`configured: true` when `RUFLO_AGNTCY_SLIM_ENDPOINT` is set, not just in
theory.

## References

- Cisco AGNTCY overview — https://outshift.cisco.com/the-internet-of-agents/agntcy
- AGNTCY Identity — https://github.com/agntcy/identity
- AGNTCY Directory — https://github.com/agntcy/dir
- AGNTCY Observe — https://github.com/agntcy/observe
- SLIM architecture — https://github.com/agntcy/slim
- Cisco CASA overview — https://outshift.cisco.com/blog/ai-ml/continuous-agentic-semantic-authorization-for-mas
- IOC protocol repository — https://github.com/outshift-open/ioc-protocols-models
- Companion: metaharness repo ADR-240 (`agent/adr-237-agntcy-outshift-integration` branch) — build-time half of this integration
- ADR-150 (`v3/docs/adr/ADR-150-metaharness-integration-surfaces.md`) — the optional/removable-augmentation precedent this ADR follows
