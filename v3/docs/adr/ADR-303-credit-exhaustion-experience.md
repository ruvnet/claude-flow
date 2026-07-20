# ADR-303 — Intelligent Credit Exhaustion Experience

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-301](ADR-301-promotional-status-surface.md) (promo status surface), [ADR-302](ADR-302-post-init-capability-enrollment.md) (post-init enrollment), [ADR-304](ADR-304-local-meta-llm-proxy.md) (local Meta LLM proxy), [ADR-305](ADR-305-customer-lifecycle-funnel.md) (funnel overview), [ADR-308](ADR-308-cognitum-public-api-contract.md) (`GET /v1/credits`, error taxonomy)

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

## Credit Authority

There is exactly one source of truth for credit balances: the **Cognitum account service**. The CLI and proxy query `GET /v1/credits` (ADR-308) — they never infer balances from provider errors, local counters, or heuristics. "Daily hosted credits exhausted" may only ever be asserted by the service that owns the ledger.

## Error Taxonomy (deterministic, fail-closed)

The recovery experience is gated on a **deterministic classifier over explicit provider codes** — never on text-matching provider messages, which will eventually misclassify outages or authentication failures as exhaustion.

Each provider adapter maps its native, machine-readable error codes into a canonical taxonomy:

```ts
enum CreditErrorCode {
  COGNITUM_CREDIT_EXHAUSTED,   // Cognitum ledger says balance is spent — the ONLY funnel trigger
  PROVIDER_QUOTA_EXHAUSTED,    // upstream provider's own quota, not Cognitum credits
  PROVIDER_RATE_LIMITED,       // retryable 429
  AUTHENTICATION_FAILED,       // 401/403
  SERVICE_UNAVAILABLE,         // 5xx, timeouts, connection resets
}
```

Mapping rules:

- Adapters map **codes, never message text**. An error with no mapped code stays unclassified (`confidence: 0`) — it is never coerced into `COGNITUM_CREDIT_EXHAUSTED`.
- The mapping table lives in one versioned module per provider adapter and mirrors the ADR-308 server-side error taxonomy 1:1.
- `PROVIDER_QUOTA_EXHAUSTED` is deliberately distinct from `COGNITUM_CREDIT_EXHAUSTED`: a provider's own quota running out is not a Cognitum upsell moment and must not claim to be one.

The gate is fail-closed — **only** `COGNITUM_CREDIT_EXHAUSTED` triggers the funnel surface:

```ts
showCreditRecovery =
  error.code === CreditErrorCode.COGNITUM_CREDIT_EXHAUSTED &&
  error.confidence === 1 &&
  !error.retryable &&
  !session.creditPromptShown;
```

`PROVIDER_QUOTA_EXHAUSTED`, `PROVIDER_RATE_LIMITED`, `AUTHENTICATION_FAILED`, `SERVICE_UNAVAILABLE`, and unclassified errors always fall through to the ordinary error path. A missed upsell opportunity is acceptable; a wrong "out of credits" claim during a provider outage is not.

## Requirements

- The upgrade message appears **only** when the classifier above fires — never on transient network failures, auth errors, provider outages, or unmapped errors.
- The original error remains available (`--verbose` / exit code unchanged) — the contextual message wraps the failure, it does not mask it.
- Non-TTY and CI environments get the plain error plus a single-line pointer (`Hint: ruflo auth login enables the free local Meta LLM proxy`), no interactive prompt.
- Frequency-capped: at most one full contextual screen per session; subsequent exhaustions in the same session show the single-line hint.
- Fully disableable via config (`funnel.creditExhaustionUpsell: false`), consistent with ADR-305 opt-out principles.

## Goals

Convert failure into education rather than frustration: the user leaves the error with a working path forward, and Cognitum gains a signup at the moment of demonstrated need.
