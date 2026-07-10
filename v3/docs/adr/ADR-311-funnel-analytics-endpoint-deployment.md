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
