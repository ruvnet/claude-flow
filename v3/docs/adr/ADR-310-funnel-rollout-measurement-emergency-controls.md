# ADR-310 — Funnel Rollout, Measurement, and Emergency Controls

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-301](ADR-301-promotional-status-surface.md)–[ADR-305](ADR-305-customer-lifecycle-funnel.md) (funnel surfaces and gates), [ADR-308](ADR-308-cognitum-public-api-contract.md) (policy feed), [ADR-309](ADR-309-funnel-governance-privacy-ecosystem.md) (governance)

## Context

ADR-305 defines gates and two measurement planes; nothing defines how the funnel actually reaches the install base, in what order, with what promotion criteria, or how it is rolled back. Shipping all surfaces to 100% of installs at once maximizes exactly the failure mode the whole set guards against: trust damage at fleet scale before guardrail data exists.

## Staged rollout

Cohort assignment for percentage phases is a deterministic local hash of the funnel ID into buckets — decided client-side, no network call, stable across sessions, re-rolled if the ID rotates.

| Phase | Population | Surfaces active |
|---|---|---|
| 0 | CI and maintainer dogfood only | All, behind explicit env flag |
| 1 | New installs only | Disclosure + **educational content only** |
| 2 | 5% of upgraded installs | Same; disclosure required before anything renders |
| 3 | 25% of upgraded installs | Same; monitor disable and issue rates |
| 4 | 100% | Educational surface |
| 5 | 100% | Introduce promotional content, capped at the 1-in-5 ratio (ADR-301) |
| 6 | 100% | Credit-exhaustion recovery (ADR-303) + proxy activation (ADR-304/307) |

**Phase-0 exit criteria** additionally include: ADR-309 legal review complete (LIA, privacy notice, regional storage) and the acceptance test below green on all platforms.

### Promotion criteria (each phase → next)

- Disable rate **< 5%** in the current phase's cohort.
- Complaint rate **< 0.1%** of active users (funnel-labeled GitHub issues / support contacts).
- No regression in CLI latency or command failures (ADR-305 level-1 gates, measured by the release-qualification plane).
- No open policy, legal, or accessibility blocker.

A failed criterion holds the phase; two consecutive failed evaluation windows roll back one phase.

## Rollback and release discipline

- Rollback ships through the same three-package publication sequence as any release: `@claude-flow/cli` → `claude-flow` → `ruflo`, with all dist-tags updated and verified per the repo's publishing rules.
- A release gate verifies **all three packages carry the same funnel schema version and policy version** — a mixed fleet where the umbrella and the CLI disagree about funnel policy is a release-blocking error.
- Rollback restores the prior signed policy and prior helper manifest version; the ADR-174/177 stamp mechanism propagates it to initialized projects on their next command.

## Emergency controls

Operationalizes the ADR-305 kill-switch model:

- **Release kill switch** (default, all users): a policy flag in the npm package. Activation latency: next installed upgrade. Works offline.
- **Freshness kill switch** (opt-in only): signed `GET /v1/funnel-policy` fetch (ADR-308). Consumer default **off**; enterprise managed deployments may enable a **6-hour** polling interval. Never carries executable code — schema-validated policy data only.
- **Emergency revocation TTL: 24 hours maximum** — a freshness-delivered disable persists locally and does not require the feed to stay reachable; a freshness-delivered *enable* expires after its TTL unless renewed, so a compromised or stale feed can never durably re-enable anything.
- **Failure mode:** last known valid signed policy, else package default. Signature or schema failure → the fetched policy is discarded entirely.
- Precedence always holds (ADR-301/305): no remote policy can override `RUFLO_FUNNEL=0`, enterprise managed policy, or user config.

## Release qualification (measurement plane 1 — CI, enforces gates)

CI benchmark on every funnel-touching release:

- Cold and warm startup: p50, p95, p99.
- Memory delta, output correctness (byte-for-byte on operational output), TTY vs non-TTY behavior, CI suppression.
- Failure injection: proxy unavailable, policy corrupt, credential unavailable.

Test matrix: {funnel on, off} × {new install, upgraded install} × {Linux, macOS, Windows} × {interactive TTY, pipe} × {standard, screen-reader/reduced-motion} × {online, offline}.

Hard gates (release-blocking):

| Gate | Threshold |
|---|---|
| Startup p95 regression | < 10 ms |
| Memory regression | < 5 MB |
| Command failure delta | 0 |
| Unexpected network calls | 0 |
| Promo output in CI or non-TTY | 0 |
| Promotional display before disclosure on upgraded install | 0 |

## Product analytics (measurement plane 2 — adoption only)

Disclosure acceptance, disable rate, signup initiation, account completion, proxy activation, 7-day and 30-day retention, paid conversion — per the ADR-305/309 event schema and consent rules. **These metrics never override release safety gates.**

## Acceptance test (release-gate regression test)

Take an existing **offline** installation, upgrade it, and run the CLI in TTY, non-TTY, CI, screen-reader/reduced-motion, and enterprise-disabled configurations. Prove that:

1. No promotional content appears before the ADR-301 disclosure.
2. No network request occurs without opt-in (verified by the zero-unexpected-network-calls gate under packet capture).
3. `RUFLO_FUNNEL=0` suppresses every funnel surface (ADR-301, 302, 303).
4. All core ruflo commands remain behaviorally identical — exit codes, operational output, and latency within gate thresholds — across every configuration above.
