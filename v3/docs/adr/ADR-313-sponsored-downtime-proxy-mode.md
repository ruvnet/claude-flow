# ADR-313: Sponsored downtime mode — free Cognitum capacity during rate limits

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-304](ADR-304-local-meta-llm-proxy.md) (proxy product), [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md) (proxy runtime), [ADR-303](ADR-303-credit-exhaustion-experience.md) (credit-exhaustion recovery pattern this reuses), [ADR-312](ADR-312-usage-limit-downtime-prevention.md) (usage-limit detection research this depends on), [ADR-309](ADR-309-funnel-governance-privacy-ecosystem.md) (consent/privacy discipline)

## Context

ADR-304/307 already define the Meta LLM Proxy product and its Rust runtime. ADR-312 established that Claude Code does not currently expose a way to *automatically* detect an approaching or exhausted usage limit, and proposed a phased plan: a manual self-reported flag now (Phase 0), an upstream capability request (Phase 1), and full automatic detection once that lands (Phase 2).

This ADR adds a new, orthogonal capability to the proxy itself: **sponsored downtime**. When a user tells ruflo (via the Phase 0 flag, or eventually the Phase 2 automatic signal) that they've hit a Claude usage limit, the Meta LLM Proxy can route their traffic through Cognitum's own model capacity **at Cognitum's expense, not the user's** — free, time-boxed, rate-limited on Cognitum's side to bound cost exposure — so the user can keep working in ruflo/Claude Code until their own Claude quota resets.

This is explicitly a **marketing-and-goodwill product**, not a credit-purchase upsell (that's already ADR-303's job). The framing is: *"Free capacity sponsored by Cognitum.one — keep working while you wait for your Claude limit to reset."*

## Decision

### New proxy capability: sponsored mode

The Meta LLM Proxy (ADR-304/307, Rust binary, `127.0.0.1:11435`) gains a **sponsored-mode** on top of its existing local/cloud routing:

```
Client (Claude Code / any OpenAI-compatible SDK)
  ↓
localhost:11435  (existing ADR-304/307 proxy)
  ↓
  ├─ normal mode: local backends OR user's own cloud-routing (ADR-304, unchanged)
  └─ sponsored mode: api.cognitum.one/v1/sponsor/*  (NEW — this ADR)
       ↓
     Cognitum-hosted model capacity, billed to Cognitum, not the user
```

Sponsored mode is a **distinct data-plane state**, not a variant of the existing `local` / `cloud:<provider>` states — `ruflo proxy status` reports it as a third value: `sponsored:cognitum`. This keeps ADR-304's data-plane disclosure invariant intact: a request receipt always says exactly which plane handled it.

### Activation

Sponsored mode requires **all** of:

1. **Explicit consent** — a new consent domain, `sponsored-downtime`, alongside the existing `account` / `proxy-install` / `telemetry` / `cloud-routing` / `hosted-memory` domains (ADR-302). Granted once via `ruflo proxy sponsor-enable`, which shows the disclosure text below before asking.
2. **A rate-limited signal** — either the Phase 0 manual flag (`ruflo settings notices rate-limited`, ADR-312) or, once it exists, the real Phase 1/2 automatic signal. Sponsored mode auto-activates ONLY while this flag is set; it deactivates automatically when the flag clears (manually, or on its TTL).
3. **The proxy installed and running** (ADR-307 lifecycle). If not installed, the CTA offers `ruflo proxy install` first.

Sponsored mode is never silently entered. The pre-activation disclosure (mirroring ADR-304 §"Data-plane disclosure"):

```
Enabling sponsored downtime mode.

While your Claude usage limit resets, requests can be routed through
Cognitum's own model capacity, sponsored at no cost to you. This is a
separate data plane from your own cloud-routing config — Cognitum sees
these prompts (server-side, same handling as any api.cognitum.one
request), never your own Claude account.

Sponsored capacity is rate-limited and best-effort — Cognitum may throttle
or decline requests under load. Disable anytime: ruflo proxy sponsor-disable.

Enable sponsored downtime mode? [y/N]
```

Default answer is No, same as every other consent gate in this system (ADR-302/309 discipline).

### Server-side: rate limiting Cognitum's own exposure

`cognitum-one/meta-proxy` (the Rust binary repo ADR-307 already calls for as a consequence) implements the client half; the sponsored-mode backend lives in the existing `cognitum-one/ruflo-funnel-api` Cloud Function family (or a sibling function) with:

- **Per-user daily/hourly sponsored-token ceiling** — mirrors the existing `funnel_credit` ceiling pattern already shipped in ADR-311's Cloud Function (`checkCreditBudget`/`bumpCreditCounter`), but keyed to a distinct `funnel_sponsored_usage` collection so sponsored consumption never touches or inflates the user's real Cognitum credit ledger.
- **Global daily cap** — a circuit breaker independent of per-user ceilings, so a traffic spike can't blow Cognitum's sponsorship budget; when tripped, sponsored mode returns a clear `SPONSORED_CAPACITY_EXHAUSTED` error and the proxy falls back to whatever the user's normal (non-sponsored) routing would have done.
- **Model selection is Cognitum's to make**, not the user's — sponsored mode intentionally does not let the client pick the model; a cheap-tier model keeps the sponsorship sustainable. This is stated plainly in the disclosure and in `ruflo proxy status` output.

### Client wiring (ruflo)

- `funnel/rate-limit-notifier.ts` (ADR-312 Phase 0) — new module, exact structural mirror of `credit-notifier.ts`: `markRateLimited()` / `clearRateLimitStatus()` / `rateLimitNotice()`, state at `~/.ruflo/rate-limit-status.json`.
- `ruflo settings notices rate-limited [--clear]` — the manual flag command (ADR-312).
- `ruflo proxy sponsor-enable` / `ruflo proxy sponsor-disable` / `ruflo proxy sponsor-status` — new subcommands under the existing `ruflo proxy` command family (ADR-307), following its exact lifecycle-command conventions.
- **Statusline priority override** — when `rate-limited` is flagged AND `sponsored-downtime` consent is granted AND the proxy is running, the funnel promo row (ADR-301/311 rotation) is preempted by a dedicated CTA, exactly the way ADR-303's credit-exhaustion recovery already preempts normal rotation. Two states:
  - Sponsored mode available but not yet enabled: *"⚡ Free Cognitum capacity available while you wait → ruflo proxy sponsor-enable"*
  - Sponsored mode active: *"⚡ Running on sponsored Cognitum capacity · resets when your Claude limit does"*
- **Event vocabulary** — `sponsor_mode_enabled` / `sponsor_mode_disabled` / `sponsor_capacity_exhausted` added to the closed `FunnelEventName` set (ADR-305/309 discipline), following the exact pattern `promo_impression`/`promo_open` established in ADR-311.

### Repository

**`cognitum-one/meta-proxy`** (private) — the Rust proxy binary ADR-307 already specifies as a "new repository/workspace" consequence. This ADR is the trigger to actually create it. Scope of the initial scaffold:

- `axum`-based OpenAI-compatible HTTP server (`/v1/chat/completions`, `/v1/models`, `/status`)
- Bind `127.0.0.1:11435` per ADR-307, loopback-only by default
- Per-user bearer token at `~/.ruflo/proxy-token` (`0600`), required on every request
- `/v1/sponsor/chat/completions` — the sponsored-mode route, forwards to `api.cognitum.one` with a distinct auth header (`X-Cognitum-Sponsored: true`) so the server side can apply the sponsored ceiling independently of the user's own credit ledger
- `/status` reports `{ data_plane: "local" | "cloud:<provider>" | "sponsored:cognitum", version, proxy_token_valid }`
- Config file `~/.ruflo/proxy-config.toml`: bind address, default data plane, sponsored-mode consent flag mirror (source of truth stays client-side in ruflo's consent store; the proxy reads it, never writes it)

## Consequences

- Sponsored mode is a **goodwill / acquisition feature**, and its entire cost-control burden sits server-side (Cognitum's ceiling + circuit breaker) — the client never needs to reason about Cognitum's sponsorship budget, only about the boolean "is sponsored mode currently available/active."
- This ADR does **not** solve ADR-312's core detection gap — sponsored mode activation still depends on the same Phase 0 manual flag (or a future Phase 1/2 automatic signal) that ADR-312 already scoped. When Phase 1 lands, sponsored mode's activation trigger upgrades automatically; no change needed here.
- New closed-vocabulary events and a new consent domain are additive, backwards-compatible extensions of ADR-302/305/309's existing schemas — no breaking change to any already-shipped funnel surface.
- `ruflo doctor --component proxy` (ADR-307) gains a sponsored-mode health check: consent state, rate-limited flag state, and last-known sponsored-capacity-exhausted timestamp.

## References

- [ADR-304: Local Meta LLM Proxy Product](ADR-304-local-meta-llm-proxy.md)
- [ADR-307: Proxy Runtime, Packaging, and Service Lifecycle](ADR-307-proxy-runtime-packaging-lifecycle.md)
- [ADR-303: Credit-Exhaustion Experience](ADR-303-credit-exhaustion-experience.md) — the priority-override UX pattern this design reuses
- [ADR-312: Usage-Limit Downtime Prevention](ADR-312-usage-limit-downtime-prevention.md) — the detection research and phased plan this activates on top of
- [ADR-311: Funnel Analytics Endpoint Deployment](ADR-311-funnel-analytics-endpoint-deployment.md) — the credit-ceiling pattern the sponsored-usage ceiling mirrors
- Server repo: `cognitum-one/meta-proxy` (private, created by this ADR)
