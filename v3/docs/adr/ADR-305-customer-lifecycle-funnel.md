# ADR-305 — Customer Lifecycle Funnel (RuFlo → Cognitum)

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-301](ADR-301-promotional-status-surface.md) (promo status surface), [ADR-302](ADR-302-post-init-capability-enrollment.md) (post-init enrollment), [ADR-303](ADR-303-credit-exhaustion-experience.md) (credit exhaustion), [ADR-304](ADR-304-local-meta-llm-proxy.md) (local Meta LLM proxy)

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

### Automatic disable (circuit breaker)

The biggest failure mode is optimizing signup rate while degrading developer trust. Guardrails therefore act, not just report:

- A level-0 breach (security regression or consent violation) **disables all funnel surfaces remotely** via the same signed helper/config channel (ADR-174/177) — the kill switch is a signed config flag, shipped like any other manifest update, and locally honored without user action.
- A sustained level-1 or level-2 breach (latency, failure rate, or opt-out threshold crossed over a full release window) disables the offending surface in the next release, and re-enabling requires the metric back under threshold plus an ADR amendment noting the cause.
- The circuit breaker state is inspectable: `ruflo doctor` reports whether funnel surfaces are active, disabled by user config, or disabled by guardrail.

## Acceptance Test

The funnel does not ship until the following passes end-to-end, and it remains a release-gate regression test thereafter:

1. Take an **existing installation** (initialized on a prior version). Do **not** run `ruflo init`.
2. Upgrade the package and execute one normal CLI command.
3. Verify the signed helper refresh fired: helpers manifest version stamp updated, signature verified, `statusline.cjs` replaced.
4. Confirm the promotional row appears **only** in an interactive TTY — and is absent under CI env vars, non-TTY stdout, and `NO_COLOR` static mode constraints.
5. Set `funnel.enabled: false`. Prove that the ADR-301 promo row, the ADR-302 enrollment prompt, and the ADR-303 exhaustion screen are all suppressed — and that core CLI behavior (exit codes, command output, operational statusline rows, latency) is byte-for-byte unchanged from the enabled run apart from the suppressed surfaces.

## Future Extensions

The same promotion framework can surface context-aware recommendations, such as suggesting GPU acceleration when local hardware is detected, enterprise features in team environments, or relevant MetaHarness integrations based on observed usage patterns. This creates a scalable discovery system while keeping the CLI experience lightweight and developer-focused.

Any such extension inherits this ADR's principles and guardrails and requires its own ADR before shipping.
