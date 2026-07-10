# ADR-303 — Intelligent Credit Exhaustion Experience

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-301](ADR-301-promotional-status-surface.md) (promo status surface), [ADR-302](ADR-302-post-init-capability-enrollment.md) (post-init enrollment), [ADR-304](ADR-304-local-meta-llm-proxy.md) (local Meta LLM proxy), [ADR-305](ADR-305-customer-lifecycle-funnel.md) (funnel overview)

## Context

Users currently encounter failed requests after exhausting available hosted resources (daily hosted credits, provider quota, rate limits). The failure is a generic error with no recovery path — maximum frustration at exactly the moment the user most wants to keep working.

This is simultaneously the funnel's highest-conversion moment: the user has a concrete, immediate problem that a Cognitum account and the local Meta LLM proxy (ADR-304) directly solve.

## Decision

Replace generic quota failures with contextual upgrade messaging that presents an immediate recovery path.

### Unauthenticated user

```
Daily hosted credits exhausted.

Continue immediately by enabling
your free local Meta LLM Proxy.

Benefits
  ✓ Unlimited local requests
  ✓ Automatic model routing
  ✓ Lower latency
  ✓ Privacy preserving
  ✓ Cloud fallback

Sign in:
  ruflo auth login
```

### Authenticated user

```
Start local proxy?
[Y/n]
```

If accepted, the CLI runs:

```
ruflo proxy enable
```

### Required clarity

The experience must clearly distinguish between:

- **Local inference** — requests served by local models (Ollama, vLLM, SGLang) with no cloud involvement
- **Cloud inference** — requests routed through api.cognitum.one to hosted providers
- **Premium hosted services** — paid Cognitum tiers (hosted memory, enterprise rate limits, premium agents)

so that "unlimited local requests" is never conflated with unlimited cloud usage.

## Error Taxonomy (deterministic, fail-closed)

The recovery experience is gated on a **deterministic classifier over explicit provider codes** — never on text-matching provider messages, which will eventually misclassify outages or authentication failures as exhaustion.

Every provider error is normalized into a category by an explicit code table:

| Provider signal | Category | `confidence` |
|-----------------|----------|--------------|
| HTTP 429 + provider code `insufficient_quota` / `credit_exhausted` / `billing_hard_limit_reached` | `quota_exhausted` | 1 |
| HTTP 429 + `rate_limit_exceeded` (retryable) | `rate_limited` | 1 |
| HTTP 401/403 | `auth` | 1 |
| HTTP 5xx, timeouts, connection resets | `provider_outage` | 1 |
| Anything unmapped | `unknown` | 0 |

The code table lives in one module per provider adapter, is versioned, and unmapped codes land in `unknown` — never coerced into `quota_exhausted`.

The gate is fail-closed:

```ts
showCreditRecovery =
  error.category === 'quota_exhausted' &&
  error.confidence === 1 &&
  !error.retryable &&
  !session.creditPromptShown;
```

`rate_limited`, `auth`, `provider_outage`, and `unknown` always fall through to the ordinary error path. A missed upsell opportunity is acceptable; a wrong "out of credits" claim during a provider outage is not.

## Requirements

- The upgrade message appears **only** when the classifier above fires — never on transient network failures, auth errors, provider outages, or unmapped errors.
- The original error remains available (`--verbose` / exit code unchanged) — the contextual message wraps the failure, it does not mask it.
- Non-TTY and CI environments get the plain error plus a single-line pointer (`Hint: ruflo auth login enables the free local Meta LLM proxy`), no interactive prompt.
- Frequency-capped: at most one full contextual screen per session; subsequent exhaustions in the same session show the single-line hint.
- Fully disableable via config (`funnel.creditExhaustionUpsell: false`), consistent with ADR-305 opt-out principles.

## Goals

Convert failure into education rather than frustration: the user leaves the error with a working path forward, and Cognitum gains a signup at the moment of demonstrated need.
