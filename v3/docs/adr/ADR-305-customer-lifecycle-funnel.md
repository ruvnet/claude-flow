# ADR-305 — Customer Lifecycle Funnel (RuFlo → Cognitum)

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-301](ADR-301-promotional-status-surface.md) (promo status surface), [ADR-302](ADR-302-post-init-capability-enrollment.md) (post-init enrollment), [ADR-303](ADR-303-credit-exhaustion-experience.md) (credit exhaustion), [ADR-304](ADR-304-local-meta-llm-proxy.md) (local Meta LLM proxy product), [ADR-306](ADR-306-cognitum-authentication-account-linking.md) (auth), [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md) (proxy runtime), [ADR-308](ADR-308-cognitum-public-api-contract.md) (API contract), [ADR-309](ADR-309-funnel-governance-privacy-ecosystem.md) (governance/privacy), [ADR-310](ADR-310-funnel-rollout-measurement-emergency-controls.md) (rollout, measurement, emergency controls)

## Context

RuFlo has millions of monthly package downloads and a large active user base, but relatively little product discovery beyond the CLI itself. Cognitum One (https://cognitum.one) offers adjacent paid capabilities — Meta LLM routing, hosted memory, premium agents, enterprise features — that most ruflo users never encounter.

The objective is a low-friction progression from open-source user to Cognitum customer without interrupting developer workflows. ADRs 301–304 define the individual touchpoints; this ADR defines the funnel they compose, its principles, and how success is measured.

## Decision

Establish a lifecycle funnel integrated into natural product touchpoints:

```
npm install ruflo
      ↓
Initialization
      ↓
Optional capability enrollment          (ADR-302)
      ↓
CLI usage
      ↓
Rotating status messages                (ADR-301)
      ↓
Feature discovery
      ↓
Credit exhaustion guidance              (ADR-303)
      ↓
Authentication (ruflo auth login)
      ↓
Local Meta Proxy                        (ADR-304)
      ↓
Multi-model routing
      ↓
Premium capabilities
      ↓
Enterprise adoption
```

Each stage is independently valuable to the user (a working install, a useful tip, a recovery path, a free local proxy) — conversion is a byproduct of delivered value, not a gate in front of it.

## Design Principles

- **Helpful before promotional.** Every message provides immediate user value.
- **One action per prompt.** No multi-step upsell flows inside the CLI.
- **Never interrupt active workflows.** Touchpoints live in idle surfaces (status row, post-init, post-failure) only.
- **Respect prior dismissal and opt-out preferences.** Dismissals persist at the user level, across projects.
- **Fully disableable through configuration.** A single `funnel.enabled: false` (plus per-surface flags in ADRs 301–303) turns every touchpoint off; CI and non-TTY environments are always off.
- **Open-source ruflo stays whole.** No existing capability moves behind the funnel; ADR-150 removability discipline applies to every funnel component.

## Control Precedence (normative)

Suppression sources are strictly ordered. **A lower-precedence source must never re-enable a higher-precedence disable.**

```
1. RUFLO_FUNNEL=0                 (environment — shells, dev containers, CI images, MDM-pushed profiles)
2. Enterprise managed policy      (managed settings file deployed by endpoint management)
3. User config: funnel.enabled    (claude-flow.config.json / user-level config)
4. Package default
5. Remote signed policy           (only when the freshness feed is enabled; see kill switches below)
```

```ts
effectiveFunnelEnabled =
  env !== false &&
  enterprisePolicy !== false &&
  userConfig !== false &&
  packageDefault === true &&
  remotePolicy !== false;
```

Enterprise documentation must cover: shell-environment deployment, dev-container configuration, CI environment defaults, MDM/endpoint-management deployment, air-gapped configuration, and audit verification (`ruflo doctor` prints the effective state and which source decided it).

## Attribution Rules

Conversion numbers are meaningless unless they are reproducible. The following are defined **before** implementation, and no funnel event ships without them:

- **Event vocabulary (closed set).** `promo_impression`, `promo_dismiss`, `promo_open`, `enroll_shown`, `enroll_accept`, `enroll_skip`, `exhaustion_shown`, `exhaustion_accept`, `auth_login_started`, `auth_login_completed`, `proxy_installed`, `proxy_activated`, `cloud_routing_enabled`, `funnel_opt_out`. New events require an ADR amendment.
- **Anonymous identifiers.** Events carry a random, locally generated funnel ID (UUIDv4 in `~/.ruflo/funnel-id`) that is: not derived from hardware, account, email, or install path; rotated every 90 days; deleted on opt-out. It exists solely to deduplicate impressions and to join a signup back to its originating surface. It is never joined to the Cognitum account ID server-side beyond the attribution window.
- **Attribution windows.** A signup attributes to a surface (301/302/303) only if `auth_login_completed` occurs within **7 days** of the surface event; proxy activation attributes to a signup within **30 days**. Outside the window, the conversion counts as organic.
- **Retention windows.** Raw events retained ≤ 90 days; only aggregates persist beyond that. Aggregates contain no identifiers.
- **Deletion behavior.** `funnel_opt_out` (or telemetry off) stops emission immediately, deletes the local funnel ID, and triggers server-side deletion of that ID's raw events. Deletion is verifiable via a documented endpoint.
- All measurement follows the ADR-301 telemetry policy: emitted only when telemetry is enabled; attribution via campaign parameters and the funnel ID above, never client identity.

## Gate Hierarchy

Gates are ordered: a failure at any level makes the levels below it irrelevant. Growth metrics can never be traded against integrity metrics.

| Level | Gate | Threshold |
|-------|------|-----------|
| 0 — Integrity | Security regressions | **0** |
| 0 — Integrity | Consent violations (any capability active without its ADR-302 receipt) | **0** |
| 1 — Product health | CLI latency p95 increase | **< 10 ms** |
| 1 — Product health | Command failure rate increase | **< 0.1 percentage points** |
| 2 — Trust | Opt-out rate | **< 10%** |
| 3 — Growth | Signup conversion | **> 1%** |
| 3 — Growth | Thirty-day activated retention | **> 20%** |
| 3 — Growth | Paid conversion (of activated accounts) | **> 2%** |

Level 3 targets are goals; levels 0–2 are hard gates.

### Automatic disable (kill switches — two mechanisms, honestly characterized)

The biggest failure mode is optimizing signup rate while degrading developer trust. Guardrails therefore act, not just report. But the transport matters: the ADR-174/177 signed helper channel is **release-bound, not immediate** — it propagates on the next installed upgrade, not on demand. Claiming "immediate fleet-wide shutdown" over that channel would be false. Two distinct mechanisms, each with its real latency:

| | Release kill switch | Freshness kill switch |
|---|---|---|
| Transport | Policy flag ships in the npm package (ADR-174/177 stamp propagates to initialized projects) | Optional signed remote fetch: `GET /v1/funnel-policy` (ADR-308) |
| Activation latency | **Next installed upgrade** | **Bounded by polling interval** |
| Works offline | Yes | No (falls back to last valid signed policy) |
| Default | **On — the default mechanism for all users** | **Off** — enabled only by explicit user or enterprise-administrator opt-in |
| Payload | Policy data in-package | Signed, schema-validated policy data — **never executable code** |

Policy:

- **Consumer default: release-bound only.** No runtime network activity is introduced by the kill-switch mechanism itself.
- **Enterprise managed deployments:** may opt into the signed freshness feed at a **6-hour** polling interval.
- **Emergency revocation TTL: 24 hours maximum** — freshness-delivered *enables* expire unless renewed; freshness-delivered *disables* persist locally (see ADR-310 for full semantics).
- **Failure mode: last known valid signed policy**, else package default. Invalid signature or schema → the fetched policy is discarded entirely.
- A level-0 breach (security regression or consent violation) triggers both mechanisms: immediate policy publication to the freshness feed (reaches opted-in fleets within the polling interval) and an expedited release (reaches everyone else on upgrade).
- A sustained level-1 or level-2 breach disables the offending surface in the next release; re-enabling requires the metric back under threshold plus an ADR amendment noting the cause.
- Remote policy sits at the **bottom** of the control precedence — it can disable surfaces but can never re-enable anything a higher-precedence source turned off.
- The state is inspectable: `ruflo doctor` reports whether funnel surfaces are active, disabled by user config, disabled by enterprise policy, or disabled by guardrail — and which mechanism delivered the decision.

### Two measurement planes

Opt-in production telemetry cannot enforce release gates — its sample is biased (opt-outs correlate with telemetry-off), and correctness must be provable before shipping, not observed after. Measurement therefore splits into two planes:

1. **Release qualification (CI, enforces the hard gates).** Deterministic benchmarks and failure injection on every funnel-touching release — cold/warm startup percentiles, memory delta, output correctness, TTY/non-TTY/CI behavior, offline behavior, corrupt-policy and missing-credential injection — across the full platform × install-state × accessibility matrix. Levels 0–2 of the gate hierarchy are enforced **here**. Full specification in ADR-310.
2. **Product analytics (production, adoption only).** Disclosure acceptance, disable rate, signup initiation and completion, proxy activation, 7/30-day retention, paid conversion — under the ADR-309 event schema and consent rules. Level-3 growth metrics are read **here**, and **never override release safety gates**.

## Rollout and Acceptance

Staged rollout (phases, cohort mechanics, promotion criteria, rollback discipline) and the full release-gate acceptance test are owned by [ADR-310](ADR-310-funnel-rollout-measurement-emergency-controls.md). In summary, the funnel does not ship until this passes end-to-end on an existing **offline** installation, upgraded in place, across TTY, non-TTY, CI, screen-reader/reduced-motion, and enterprise-disabled configurations:

1. The signed helper refresh fires (manifest stamp updated, signature verified, `statusline.cjs` replaced) without running `ruflo init`.
2. **No promotional content appears before the ADR-301 disclosure.**
3. **No network request occurs without opt-in** (packet-capture verified).
4. **`RUFLO_FUNNEL=0` suppresses every funnel surface** (ADR-301, 302, 303).
5. All core ruflo commands remain behaviorally identical — exit codes, operational output, and latency within gate thresholds — in every configuration.

## Future Extensions

The same promotion framework can surface context-aware recommendations, such as suggesting GPU acceleration when local hardware is detected, enterprise features in team environments, or relevant MetaHarness integrations based on observed usage patterns. This creates a scalable discovery system while keeping the CLI experience lightweight and developer-focused.

Any such extension inherits this ADR's principles and guardrails and requires its own ADR before shipping.
