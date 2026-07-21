# ADR-317: Developer revenue share on the Cognitum funnel

- **Status**: Proposed
- **Date**: 2026-07-14
- **Deciders**: ruv
- **Related**: [ADR-301](ADR-301-cognitum-customer-lifecycle-funnel.md) (funnel foundation), [ADR-302](ADR-302-post-init-capability-enrollment.md) (consent domains, enrollment gate pattern), [ADR-305](ADR-305-funnel-control-precedence.md) (precedence chain), [ADR-309](ADR-309-funnel-governance-privacy-ecosystem.md) (privacy invariants), [ADR-311](ADR-311-funnel-analytics-endpoint-deployment.md) (click-redirect + attribution), [ADR-313](ADR-313-sponsored-downtime-proxy-mode.md) (independent consent domain pattern), kickbacks.ai (the market comparable this ADR responds to)

## Context

"Can we do something similar to kickbacks.ai?" — a Kickbacks-style ad marketplace splits ad revenue 50/50 with the developer whose install shows the ad. Ruflo already ships the ad-serving half: ADR-301's Cognitum funnel has message rotation, impression + click attribution (ADR-311), consent gating, disclosure grace, insight-slot local targeting, and sponsored-downtime override. **Today, 100% of that attributed revenue accrues to Cognitum.** No mechanism exists for a ruflo user to earn from the messages their statusline renders.

The gap between ruflo's current funnel and a Kickbacks-clone is not the ad-serving pipeline — it's the payment rail, the tax/legal surface, and the auction/self-serve advertiser portal. This ADR scopes the smallest defensible slice: **share existing Cognitum sponsor revenue 50/50 with users who explicitly opt in**, using the attribution machinery already in place. Auction and advertiser self-serve are explicitly out of scope; those are ADR-320+ material if we ever decide to be a marketplace and not just a publisher.

## Decision

Add a new consent domain `rev-share-payout` and three client-side subcommands (`ruflo funnel enroll` / `earnings` / `unenroll`) that participate in an out-of-repo payout backend hosted alongside `funnel.ruv.io`. The backend owns Stripe Connect, KYC, tax reporting, and payout scheduling; the client owns enrollment token storage, attribution enrichment, and the earnings-status surface.

### Data flow

```
consent + KYC + Stripe Connect (funnel.ruv.io/enroll — web, browser)
        │
        ▼
Backend returns enrollment_token → written to ~/.ruflo/funnel-payout.json
        │
        ▼
Every attribution event (impression/click) enriched with enrollment_token
  when consent + token both present  (funnel/attribution.ts + events.ts)
        │
        ▼
Backend attributes 50% of the sponsor-paid share for that event to the token
        │
        ▼
Backend accrues balance; monthly payout via Stripe Connect when > threshold
        │
        ▼
`ruflo funnel earnings` — GET funnel.ruv.io/v1/earnings — displays balance + history
```

### 1. New consent domain — `rev-share-payout` (types.ts, consent.ts)

Standalone, never-bundled, following the ADR-302 discipline every domain in this family follows:

- Independent of `sponsored-downtime`, `training-data-sharing`, `power-saver`, `advisor-tips`.
- Independent of the funnel-on/off decision itself: a user can have the funnel enabled (seeing rotating messages) without enrolling for payouts; a user cannot enroll without the funnel enabled (nothing to attribute).
- Granting `rev-share-payout` is a **precondition** for enrollment, not the same thing: consent granted + no enrollment token = "willing, not yet enrolled." The distinction matters because Stripe KYC can fail after consent for reasons outside the user's control.

### 2. Enrollment token — `funnel/payout.ts` + `~/.ruflo/funnel-payout.json`

Storage schema:
```jsonc
{
  "enrollment_token": "eyJhbGciOi...",   // opaque JWT from backend
  "enrolled_at": "2026-07-14T18:00:00Z",
  "payout_account_last4": "1234",         // Stripe Connect account, for display only
  "kyc_status": "verified" | "pending" | "failed",
  "policy_version": 1                     // separate from CONSENT_POLICY_VERSION
}
```

The token is opaque — the client never introspects it. Rotation is server-side; the client just re-fetches via `ruflo funnel enroll --refresh` when it expires (401 from `earnings`).

### 3. CLI subcommands (`src/commands/funnel.ts`)

- **`ruflo funnel enroll`** — refuses if funnel is disabled or disclosure is declined (same guards as `accept`). Prints a URL to `funnel.ruv.io/enroll?device_code=…` and opens it via the same `execFile` path `funnel open` uses (v3.29.0 pattern — never through a shell). The browser flow captures KYC + Stripe Connect + tax info, then redirects to a `ruflo-enrollment://callback?token=…` handler that ruflo picks up via a lightweight local HTTP listener bound to `127.0.0.1:0` (chosen at start, printed in the URL, closed on receipt). This is standard OAuth device-code shape; no persistent server.
- **`ruflo funnel earnings [--json]`** — `GET funnel.ruv.io/v1/earnings` with the enrollment token. Prints: accumulated balance (unpaid), lifetime paid, current period impressions/clicks, next payout date. `--json` for programmatic use.
- **`ruflo funnel unenroll`** — revokes consent locally + deletes the enrollment file + `POST funnel.ruv.io/v1/enrollment/revoke` (best-effort; server may retain the record for accounting). Funnel itself stays enabled — user still sees messages, just doesn't earn.

### 4. Attribution enrichment (`funnel/attribution.ts`)

`clickTrackedUrl()` and `recordFunnelEvent()` accept an optional `attributor` param derived from `~/.ruflo/funnel-payout.json`. If consent AND token both present, the token is included:
- In `clickTrackedUrl` — as an additional query param (`&a=<token>`) so the backend's redirect handler credits the click.
- In `recordFunnelEvent` — as an event field, so impression counts also credit.

Absent either consent or token, no attributor is attached — behavior is byte-identical to today's funnel. The attribution surface itself is unchanged; this is purely additive.

### 5. Statusline earnings indicator (opt-in, off by default)

The user can turn on `RUFLO_STATUSLINE_EARNINGS=1` to append a subtle `💰 $0.12/mo` to the statusline row 2 (system metrics). Off by default because a running earnings ticker in every render feels crass; a user who wants to see their earnings can run `ruflo funnel earnings`.

## Consequences

**Positive**
- Direct answer to "can we do this?" — yes, and with less new code than a Kickbacks-clone would need because the attribution/consent/rotation pipeline is already shipped.
- Aligns Cognitum + user incentives — a user who earns from their statusline is more likely to keep the funnel enabled, more likely to click, less likely to opt out.
- Independent consent domain preserves the ADR-302 discipline — no bundling, no dark patterns.
- Reuses `funnel.ruv.io` infrastructure — no new hostname, no new attribution scheme, no new privacy invariant.

**Negative / Risks**
- **Legal/tax burden on the backend.** Publisher TOS, Stripe Connect terms, 1099-K collection (US), W-8BEN (non-US), state nexus considerations, VAT/GST on payouts. None of this is client-side but all of it blocks a real launch.
- **Fraud surface.** A malicious user can spawn thousands of `ruflo` sessions, farm impressions, self-click. Server-side rate limits + per-account impression caps + click-through-rate anomaly detection are required before the first payout goes out.
- **Cannibalizes some Cognitum margin.** By design — 50% is 50%. The upside is a larger, more engaged funnel base.
- **Small-market risk.** Kickbacks is the only current comparable. If they don't reach scale, we probably don't either. Mitigation: this ADR ships the client scaffold; the backend/legal work is gated on a separate go/no-go decision.

**Neutral**
- The 50% split is a starting number, not a covenant. Backend can adjust with policy-version bump + fresh consent prompt.

## Out of scope (deliberately)

- Auction / real-time bidding — Kickbacks does this; we don't. The Cognitum funnel remains a fixed remote pool.
- Advertiser self-serve portal — see above.
- VS Code / editor extension — new placement surface would be a separate ADR (ADR-318+).
- Non-terminal placements (Slack, browser, mobile) — same, separate ADR.
- Stripe Connect integration on the client — the client never touches Stripe; enrollment is web-only.
- Content moderation for the message pool — already handled at meta-proxy ingest.

## Phased delivery

- **Phase 0 — this PR (client scaffold, no backend hookup yet):** consent domain, `payout.ts` state module, three CLI subcommands with a stub URL, attribution enrichment plumbing, ADR itself. Ships in a v3.30.x with the enrollment URL 501-ing until Phase 1 is up.
- **Phase 1 — backend enrollment endpoint (out of this repo, cognitum-one/meta-proxy):** `POST /v1/enrollment` (device-code + Stripe Connect start), `POST /v1/enrollment/complete` (KYC callback), `POST /v1/enrollment/revoke`, `GET /v1/earnings`. Blocks on legal review.
- **Phase 2 — attribution + payout engine:** per-token impression/click ledger, monthly payout scheduler, Stripe Connect transfers, 1099 generation. Blocks on Phase 1.
- **Phase 3 — public launch:** publisher TOS, help docs, blog post, upgrade path from v3.29.x.

Each phase gates on the previous. Client scaffold can ship immediately without exposing users to a half-built payout flow — enroll refuses with a clear "enrollment not yet available" message until Phase 1 is live.
