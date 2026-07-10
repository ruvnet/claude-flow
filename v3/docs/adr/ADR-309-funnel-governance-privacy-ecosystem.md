# ADR-309 — Funnel Governance, Privacy, and Ecosystem Policy

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-301](ADR-301-promotional-status-surface.md) (content policy), [ADR-302](ADR-302-post-init-capability-enrollment.md) (consent receipts), [ADR-305](ADR-305-customer-lifecycle-funnel.md) (attribution), [ADR-308](ADR-308-cognitum-public-api-contract.md) (retention/deletion contract), [ADR-310](ADR-310-funnel-rollout-measurement-emergency-controls.md) (rollout)

## Context

The funnel turns an open-source developer tool into an acquisition channel for a proprietary service. That carries package-ecosystem risk, privacy-regulation obligations, and a content-governance burden that no technical ADR covers. This ADR is the single place those are decided.

## Package-ecosystem policy

- **Precedent:** npm banned install-time terminal advertising after the 2019 `funding`/`standard` incident. The funnel is materially different — runtime, first-party, in ruflo's own CLI, fully disableable — but the reputational blast radius of that precedent is the reference point for every content decision.
- **Commitments (normative):**
  - Zero output at `npm install` / postinstall time. The funnel exists only inside interactive ruflo commands.
  - First-party promotion only — never third-party advertising, sponsorships, or paid placements.
  - All funnel code, message copy, and policy files live in the open repository, reviewable like any code.
  - Forks may strip the funnel freely; no license term, technical measure, or update mechanism may penalize doing so.

## Privacy classification and lawful basis

- The pseudonymous funnel ID (ADR-305) plus server-side raw events constitute **personal data** under GDPR and are treated as such under CCPA/CPRA. "Anonymous" is not claimed anywhere identifiers exist.
- **Operational telemetry** (crash/health, disable rates): **legitimate-interest** basis, with a documented, minimized Legitimate Interest Assessment checked into the repo.
- **Marketing attribution** (signup/conversion events): **explicit opt-in only** — rides the telemetry consent domain (ADR-302), never inferred from product usage.
- **No cross-product behavioral profiling** without a separate, explicit consent — a Cognitum account must not silently enrich funnel events, and vice versa.
- **Prohibited in any funnel event, permanently:** raw prompts, command lines, file paths, repository names, model inputs/outputs, hostnames, usernames.
- Regional handling: EU-originating events stored in-region; region derived from coarse request geography, never collected from the client beyond an optional self-declared region field.
- **Rights handling:** deletion and access requests flow through `DELETE /v1/events/{subject_id}` (ADR-308) keyed by the local funnel ID, which the CLI can print on demand (`ruflo funnel id`). Deletion returns a durable receipt.
- **Privacy-notice versioning:** the notice version rides API responses (ADR-308); a bump beyond the recorded consent receipt forces re-consent (ADR-302 `policyVersion`).

## Event schema (constrained, closed)

```ts
interface FunnelEvent {
  schemaVersion: 1;
  event:
    | "disclosure_shown"
    | "funnel_disabled"
    | "signup_opened"
    | "account_created"
    | "proxy_activated";
  surface: "statusline" | "init" | "credit_exhaustion";
  release: string;              // ruflo version, e.g. "3.8.0"
  region?: string;              // coarse, self-declared only
  pseudonymousId?: string;      // ADR-305 funnel ID; absent when attribution consent is off
  timestampBucket: string;      // "2026-07-10" or "2026-07-10T18" — never full timestamps
}
```

- The event union is **closed**; adding a member requires amending this ADR.
- `timestampBucket` is daily by default, hourly at most. Full timestamps are never transmitted — bucket granularity is chosen per metric, and daily suffices for every ADR-305 North Star metric.
- Schema-validated client-side before emission; invalid events are dropped locally, never "fixed" server-side.

## Content approval ownership

- A named content owner (role, recorded in `MAINTAINERS`/`CODEOWNERS`) approves every message entering the ADR-301 rotation; message changes are PRs with the owner as required reviewer.
- Review checklist enforced in PR template: schema-valid, ratio-compliant (≥ 4:1 educational:promotional, ADR-301), no urgency/scarcity/dark patterns, allowlisted URL, accessibility-clean (no reliance on color or motion), localization key present.
- **Localization:** messages ship as keyed strings; untranslated locales fall back to English rather than machine translation. **Accessibility:** every message must read correctly as static plain text, since marquee and color are stripped under reduced-motion/screen-reader/`NO_COLOR` modes (ADR-301).

## Consequences

- Legal review of the LIA, privacy notice, and regional storage design is a Phase-0 exit criterion in ADR-310 — no funnel event leaves a client before it completes.
- This ADR is the governance anchor: ADR-301's content rules, ADR-302's receipts, ADR-305's attribution, and ADR-308's retention clauses all cite it; conflicts resolve in favor of the stricter rule.
