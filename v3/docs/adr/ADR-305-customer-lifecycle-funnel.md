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

## Success Metrics

North Star metrics:

- Cognitum account creation rate
- Local proxy activation rate
- Authenticated monthly active users
- Free-to-paid conversion
- Thirty-day retention after signup
- Enterprise trial initiation

Guardrail metrics (regressions here override funnel gains):

- CLI startup latency unchanged (<500ms target holds)
- No increase in command failure rate
- Prompt dismissal rate
- Opt-out rate
- User satisfaction and issue volume (funnel-related issue reports tracked as a first-class label)

All measurement follows the ADR-301 telemetry policy: anonymous aggregates only, only when telemetry is enabled, attribution via campaign parameters rather than client identity.

## Future Extensions

The same promotion framework can surface context-aware recommendations, such as suggesting GPU acceleration when local hardware is detected, enterprise features in team environments, or relevant MetaHarness integrations based on observed usage patterns. This creates a scalable discovery system while keeping the CLI experience lightweight and developer-focused.

Any such extension inherits this ADR's principles and guardrails and requires its own ADR before shipping.
