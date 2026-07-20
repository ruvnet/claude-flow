# ADR-311: Funnel analytics endpoint — deployment & repo split

**Status:** Accepted
**Date:** 2026-07-10
**Amends:** ADR-308 (public API contract), ADR-309 (governance & privacy)
**Companion of:** ADR-305 (customer lifecycle funnel), ADR-303 (credit-exhaustion recovery)

## Context

ADR-308 defined the client-facing contract for the funnel event endpoint
(`POST /v1/events`, idempotency key, closed vocabulary, 90-day retention,
402 credit-exhausted signal). It intentionally left the **server** side out
of the ruflo repo — the CLI ships without a bundled backend, and the
contract is what the two sides agree on.

The ADR-308 endpoint has now been implemented, deployed, and verified live.
This ADR records the concrete decisions that came out of standing it up.

## Decisions

### 1. Server home: separate repo, separate lifecycle

The server implementation lives in
[**`github.com/cognitum-one/ruflo-funnel-api`**](https://github.com/cognitum-one/ruflo-funnel-api),
not in the ruflo repo, so that:

- The commercial-side ADR-311 evolution (rate limits, tenant model,
  BigQuery export, dashboards) doesn't churn the OSS CLI's PR history.
- The client contract in ADR-308 stays the single source of truth for what
  the wire looks like — the server can be swapped or forked without
  changing what the CLI sends.
- Server security surface (Firestore rules, service-account IAM, key
  rotation) is owned by whoever runs the endpoint. Not tangled with CLI
  release cadence.

The `services/cognitum-analytics/` directory in the ruflo repo has been
replaced with a `README.md` pointing at the dedicated repo.

### 2. Domain: `funnel.ruv.io` (Cloud Run mapping)

Client `DEFAULT_ENDPOINT` is `https://funnel.ruv.io/v1/events`. Reasoning:

- **rUv authors ruflo → telemetry lives on rUv's domain.** Putting analytics
  on `cognitum.one` would conflate OSS-tool telemetry with the commercial
  Cognitum product's URLs. The OSS/commercial line stays visible.
- **Cloud Run domain mapping decouples URL from Cloud Run hostname hash.**
  A redeploy assigning a new random hash doesn't break the client.
- **DNS is Cloudflare-managed; CNAME is unproxied** so Cloud Run terminates
  TLS directly (Cloud Run cannot use Cloudflare's TLS).

### 3. Runtime: Cloud Function gen2, Node 22, us-central1, 256 MiB

Deployed via `gcloud functions deploy --gen2` from
`ruflo-funnel-api/deploy.sh`. Configuration:

| Setting | Value | Reason |
|---|---|---|
| Runtime | `nodejs22` | LTS at deploy time, matches ruflo build env |
| Region | `us-central1` | Cheapest tier + closest to Firestore `nam5` |
| Memory | `256Mi` | Handler is stateless + O(batch size); no ML |
| Concurrency | `80` | Cloud Run default; batches are small + fast |
| Max instances | `100` | Adjust up when we know the impression volume |
| Timeout | `30s` | Firestore batch writes finish in ms; padding for cold starts |
| Allow unauthenticated | `--allow-unauthenticated` | CLI has no auth; abuse gated by ceiling + Cloudflare in front |

### 4. Storage: Firestore native, 4 collections

| Collection | Purpose | ADR-309 retention |
|---|---|---|
| `funnel_events` | Raw events, one doc per event, includes `receivedAt` | ≤ 90 days |
| `funnel_aggregates` | Rolling counts by (surface, event, day, release) | Indefinite (no PII) |
| `funnel_credit` | Per-tenant daily counter — triggers 402 when exceeded | Rolling |
| `funnel_idem` | `Idempotency-Key` → { at, count } — dedup journal | Rolling |

The `funnel_events` `receivedAt` field is a server-side timestamp for
retention scheduling; it does NOT replace the client's `timestampBucket`
(day-only, ADR-309 privacy invariant).

### 5. Credit-exhaustion signal (ADR-303 wire-in)

Server replies **HTTP 402 Payment Required** with body
`{"error": "COGNITUM_CREDIT_EXHAUSTED", ...}` when the per-tenant daily
counter exceeds `CREDIT_CEILING_PER_DAY` (default `1000000`). Client
transport picks up either signal:

- `res.status === 402`, OR
- `res.body` string-contains `'COGNITUM_CREDIT_EXHAUSTED'`

and calls `markCreditExhausted()` in `funnel/credit-notifier.ts`. The
recovery surface fires on the next appropriate CLI render, per ADR-303.

### 6. Impression + click tracking (ADR-305 vocabulary amendment)

The event vocabulary in `funnel/types.ts` is expanded (amends ADR-305)
with two new terms:

| Event | Fired by | Carries |
|---|---|---|
| `promo_impression` | Client — every `rotation.selectMessage()` | `messageId` |
| `promo_open` | Server — on every `/v1/click/{id}` redirect | `messageId`, `country` |

`FunnelEvent` gains an optional `messageId` field (length ≤ 64, matches
`[a-z0-9-]`). Any event WITHOUT the promo_impression / promo_open name
drops `messageId` server-side so the schema stays predictable.

### 7. Click redirect (`GET /v1/click/{messageId}`)

Promotional messages route through a server-side redirect so the click
can be recorded before the user leaves the terminal:

```
✨ Unlock Meta LLM routing → funnel.ruv.io/v1/click/promo-cognitum-meta-llm?to=…
```

Server flow:
1. Validate `messageId` against `MESSAGE_ID_RE` (`/^[a-z0-9][a-z0-9-]{0,63}$/i`)
2. Validate the `to` URL: must be https AND host must be in
   `CLICK_ALLOWED_HOSTS` (`cognitum.one` variants + `agentics.org`
   variants — allowlist ships in code, NOT in Firestore so a compromised
   admin can't redirect users off-platform)
3. Extract coarse geo (`extractCountry(req)`): ISO-3166 alpha-2 country
   ONLY, from `CF-IPCountry` or `X-Appengine-Country`. Never city, never
   lat/long — ADR-309 privacy invariant
4. Firestore write: `funnel_events` doc + `funnel_aggregates` row keyed by
   `(surface, event, day, release, messageId, country)`
5. Firestore write failure **never blocks the redirect** — user intent to
   navigate wins over analytics precision (ADR-308 failure policy)
6. 302 to the target with `Cache-Control: no-store` so caches don't
   swallow subsequent clicks

Client wraps promotional URLs via `attribution.clickTrackedUrl(msgId, target, input)`
before OSC 8 rendering. If the client-side wrap fails (unknown id, malformed
target), it falls back to the direct UTM-decorated link.

### 8. Coverage summary

The Phase 2 analytics plane now answers:

| Question | How |
|---|---|
| How many impressions per message per day? | `promo_impression` events + aggregates |
| How many clicks per message per day? | `promo_open` events + aggregates |
| Click-through rate | ratio of the two above |
| Where in the world are clicks coming from? | `country` field on `promo_open` |
| Conversions | `signup_opened`, `account_created`, `proxy_activated` (existing) |
| Which install disabled notices | `funnel_disabled` (existing) |

Zero PII, zero prompt content, zero paths — everything is either a closed
enum, a message id (allowlisted shape), a country code (ISO alpha-2), or
a daily bucket.

## Verified state at time of adoption

- Cloud Run endpoint `cognitum-analytics-63rzcdswba-uc.a.run.app` — live
- Domain mapping `funnel.ruv.io` — created; DNS live; TLS cert issuance
  polled hourly by Cloud Run (Google side, asynchronous)
- **API contract (8/8 tests green)** — see the dedicated repo's README
- **Firestore writes** — 9 raw events, 5 aggregates, 5 idempotency journal
  entries, 1 credit counter row from initial smoke + verification batches

## Consequences

- Anyone forking ruflo who wants their own telemetry endpoint clones
  `cognitum-one/ruflo-funnel-api`, deploys to their own project, and sets
  `RUFLO_FUNNEL_EVENTS_ENDPOINT=…` in their env or configures a fork of
  `event-transport.ts` — the ADR-308 contract is what they conform to,
  not this specific deployment.
- Server-side changes to the endpoint are documented in the dedicated
  repo; only wire-format changes need a corresponding ADR-308 amendment
  in ruflo.

## References

- [ADR-308: Public API contract](ADR-308-cognitum-public-api-contract.md)
- [ADR-309: Governance, privacy, ecosystem](ADR-309-funnel-governance-privacy-ecosystem.md)
- [ADR-303: Credit-exhaustion recovery](ADR-303-credit-exhaustion-experience.md)
- [Server repo: cognitum-one/ruflo-funnel-api](https://github.com/cognitum-one/ruflo-funnel-api)
