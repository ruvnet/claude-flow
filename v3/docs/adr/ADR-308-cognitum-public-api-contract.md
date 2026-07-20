# ADR-308 — Cognitum Public API and Server Contract

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-303](ADR-303-credit-exhaustion-experience.md) (error taxonomy), [ADR-305](ADR-305-customer-lifecycle-funnel.md) (attribution, kill switches), [ADR-306](ADR-306-cognitum-authentication-account-linking.md) (auth flows), [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md) (proxy runtime), [ADR-309](ADR-309-funnel-governance-privacy-ecosystem.md) (privacy/retention)

## Context

The funnel spans an organizational boundary: ruflo is open source; api.cognitum.one is a proprietary service. Auth (ADR-306), attribution events (ADR-305), deletion (ADR-305/309), funnel policy (ADR-305 freshness kill switch), routing (ADR-304/307), and credits (ADR-303) all cross it. Without a versioned, independently testable contract, every one of those ADRs has an unspecified dependency, and conversion numbers are irreproducible.

## Decision

Define a versioned public API contract, owned jointly and checked into both repositories.

### Endpoints (v1)

```
POST   /v1/auth/device                 # device authorization flow (RFC 8628)
POST   /v1/auth/token                  # code/refresh exchange
POST   /v1/auth/revoke                 # token + session revocation
POST   /v1/events                      # funnel event ingestion (idempotent)
DELETE /v1/events/{subject_id}         # verifiable deletion (ADR-305/309)
GET    /v1/funnel-policy               # signed policy feed (freshness kill switch, opt-in only)
POST   /v1/proxy/chat/completions      # OpenAI-compatible cloud routing
GET    /v1/credits                     # credit balances (the single credit authority, ADR-303)
```

### Contract requirements

- **OpenAPI specification** checked into **both** repositories (ruflo: `v3/docs/api/cognitum-v1.openapi.yaml`; server repo mirrors it). CI in both repos validates against the shared spec; drift fails the build.
- **Semantic API versioning.** `/v1` is stable; breaking changes require `/v2` with a documented overlap window. The CLI declares the API versions it supports.
- **Idempotency keys** required on `POST /v1/events` (client-generated UUID per event batch) — retries never double-count impressions or conversions.
- **Explicit rate limits**, documented in the spec and returned in headers; the CLI backs off and never retries into a limit.
- **Error taxonomy:** all errors return machine-readable codes that map 1:1 onto the ADR-303 `CreditErrorCode` / category tables. No client ever parses human-readable message text.
- **Data retention guarantees** in the contract itself: raw events ≤ 90 days, aggregates thereafter (ADR-305); deletion honored per ADR-309.
- **Service degradation behavior** documented per endpoint (see failure policy below).
- **Terms and privacy-policy version receipt:** token and event responses carry the policy versions in force; a version bump beyond the recorded consent receipt triggers re-consent (ADR-302 `policyVersion` rules).

### Failure policy (client-side, normative)

| Unavailable | Client behavior |
|---|---|
| Auth | Local ruflo continues working fully; auth-gated capabilities degrade with a clear error |
| Telemetry (`/v1/events`) | Drop, or bounded local queue (≤ 24 h, ≤ 1 MB); **never block or slow the CLI** |
| Funnel policy | Use last valid **signed** policy, else package default; never fail open into showing promo |
| Proxy backend | Normal error to caller; **never silently reroute** to another paid or cloud provider |
| Deletion | Return a durable request receipt to the user and retry server-side until confirmed |

## Consequences

- The OpenAPI spec is the review artifact for any server change that touches the CLI; PRs to either repo that change the boundary must update the shared spec first.
- Contract tests run in ruflo CI against a mock server generated from the spec — the funnel surfaces are testable with zero network and no Cognitum dependency.
- `GET /v1/funnel-policy` responses are Ed25519-signed with the same key-management discipline as the helper channel; the CLI validates signature + policy schema before honoring anything (ADR-305 freshness kill switch is inert otherwise).

## Addendum (2026-07-16) — the `/v1/auth/*` contract does not match the live identity server

While implementing ADR-306, reading meta-proxy's actual, currently-shipping OAuth client
(`oauth/client.rs` in `cognitum-one/meta-proxy`, real integration tests passing against
production) showed it targets `auth.cognitum.one/oauth/{authorize,token}` +
`auth.cognitum.one/v1/oauth/code-exchange` — a different host AND a different path scheme than
this ADR's `/v1/auth/{device,token,revoke}` on `api.cognitum.one`. No open issue or PR in either
`meta-proxy` or `dashboard` (which has its own separate, third, already-production OAuth+keychain
CLI — `apps/cli`, per dashboard's ADR-005 — with its own endpoint usage not yet cross-checked
against this spec either) discusses reconciling this.

This is real drift between a checked-in contract and production reality, not a hypothetical
future risk: `ruflo auth` (ADR-306) was implemented against the proven `auth.cognitum.one`
surface instead of this ADR's `/v1/auth/*` shape, specifically to avoid shipping a client for
endpoints nobody has confirmed exist. The `v3/docs/api/cognitum-v1.openapi.yaml` spec checked
into this repo is consequently aspirational for the auth endpoints, not authoritative — flagged
here rather than silently left to mislead the next person who builds against it. Reconciling the
spec with reality (or vice versa) needs the API/identity owners, not a unilateral client-side fix.
