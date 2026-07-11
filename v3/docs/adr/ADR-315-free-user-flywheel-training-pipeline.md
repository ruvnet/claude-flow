# ADR-315: Self-optimizing flywheel — training meta-llm from free/sponsored-user traffic

- **Status**: Partially implemented — ruflo-side (Tier 2 client wiring) shipped 2026-07-11; meta-llm-side (consent-gated capture + scheduled tick) not started, tracked separately in meta-llm's own scope
- **Date**: 2026-07-10
- **Deciders**: ruv
- **Related**: [ADR-313](ADR-313-sponsored-downtime-proxy-mode.md), [ADR-314](ADR-314-power-saver-mode-and-sponsored-abuse-prevention.md), meta-llm's [ADR-251](https://github.com/cognitum-one/meta-llm/blob/main/docs/adr/ADR-251-microlora-flywheel-service.md) (`POST /v1/microlora/evolve` — the training mechanism this ADR feeds, not reinvents)

## Implementation status (2026-07-11)

**ruflo client-side wiring — shipped**: `training-data-sharing` consent domain
(`src/funnel/types.ts`/`consent.ts`), `ruflo proxy training-share-enable/-disable/-status`
(`src/commands/proxy.ts`), `training_share_enabled/disabled` funnel events. Mirrors the
ADR-313/314 pattern exactly — never bundled with `sponsored-downtime`, its own disclosure text,
its own `training_share_consent_granted` mirror field in `proxy-config.toml`.

**meta-proxy header relay — not yet implemented**: the Sponsored-plane
`X-Cognitum-Training-Consent: true` header (reading the `training_share_consent_granted` mirror
flag, omitted entirely rather than sent `false`) is still open work in `cognitum-one/meta-proxy`'s
`src/routes/messages.rs`.

**meta-llm consent-gated capture + scheduled tick — not started**: this is meta-llm's own scope
per the "Server-side" section below; nothing in this ADR's client-side work depends on it existing
yet — the header is emitted (once meta-proxy adds it) whether or not anything downstream reads it.

## Context

"Create a self-optimizing flywheel to optimize and train meta-llm based on free users."

**This is not a new training mechanism to build — meta-llm already has one, shipped.** ADR-251
(meta-llm) built `POST /v1/microlora/evolve`: a real MicroLoRA/SONA adaptation service that takes
`qualitySignal` + `interactionSummaries` as input, runs a round through the frozen, packaged
`@metaharness/flywheel` promotion gate (`meetsPromotionRule`), and produces a SHADOW candidate that
an operator promotes separately — never auto-serves an unverified adaptation. That machinery is
real, tested (26 tests, full suite 1126/1126 at ship time), and running today.

**What's actually missing, and what this ADR scopes, is two things:**
1. A consent-gated pipeline that turns real sponsored/free-tier traffic into the
   `interactionSummaries` input ADR-251's service already accepts — today nothing feeds it that
   automatically; it's called on-demand, by hand.
2. A scheduled trigger that calls it periodically instead of manually — meta-llm already proved
   this exact pattern for the pod loop (`terraform/pods_scheduler.tf`, Cloud Scheduler cron
   driving a tick job) — reuse it, don't invent a second scheduling mechanism.

This ADR lives in **meta-proxy** per the request, but its center of gravity is properly
server-side (meta-llm) — meta-proxy's own scope here is narrow and specific: it is the boundary
that knows a request is sponsored AND knows the client's consent state, so it's the natural place
to attach (or withhold) the training-data signal before the request ever reaches Cognitum. The
scheduler, the ledger aggregation, and the actual `/v1/microlora/evolve` calls are meta-llm's job,
already built, referenced but not re-specified here.

### The tension this ADR has to resolve honestly, not paper over

Every consent-and-privacy decision in this whole system so far (ADR-302, ADR-305, ADR-309) has
converged on one rule: closed vocabularies, daily-not-precise timestamps, **no raw prompt/command/
path content, ever** — that's ruflo's own local telemetry, and it's permanent by ADR-309's own
wording. Training a model (even via MicroLoRA's lightweight rank-1–4 adaptation) is fundamentally
different from that telemetry: it needs actual interaction *content* — prompts, completions, or at
minimum content-derived quality signals — to produce any adaptation worth shipping. Metadata alone
(latency, tier, cache hit/miss) is exactly what the EXISTING flywheel (ADR-251's macro-loop
precursor, `src/flywheel/`) already uses for routing-parameter calibration, and that part needs no
new consent — it's using data Cognitum already necessarily touches to serve the request at all, for
a purpose (improving the router that serves that same traffic) already implicit in operating the
service. **Content-based training is not that** — it's a second, materially different data use, and
this ADR treats it as such: a separate, explicit, never-bundled consent domain, exactly like every
other consent decision in this codebase.

## Decision

### Two tiers, two different consent bars — do not conflate them

**Tier 1 — Routing calibration (metadata only, already covered by ADR-251's precursor flywheel).**
No new consent needed: this uses usage-ledger data (tier resolved, latency, escalation, cache
hit/miss, tool-use presence, success signal — never prompt/completion text) that Cognitum already
necessarily processes to serve any request. Sponsored/free traffic is simply MORE of the same
input this flywheel already ingests for every tier — nothing new to build here beyond, optionally,
weighting sponsored-traffic volume appropriately in the aggregation (it's zero-marginal-cost data
from Cognitum's side, unlike paid traffic, so there's no reason to exclude it; that's a meta-llm
`src/flywheel/` tuning question, not a new pipeline).

**Tier 2 — Content-based MicroLoRA training (the actual "train meta-llm" ask).** Feeding real
prompt/completion content (or content-derived `interactionSummaries`) into `/v1/microlora/evolve`
requires a **new, separate, opt-in-only consent domain — `training-data-sharing`** — that is:
- **Never bundled with `sponsored-downtime` consent.** Using free capacity must not implicitly mean
  donating your prompts for training; these remain two separate decisions, exactly like every other
  consent pair in this system.
- **Disclosed in plain language before grant**, mirroring `SPONSOR_DISCLOSURE`'s pattern: what data
  (interaction content, not just metadata), what it's used for (MicroLoRA adaptation candidates,
  gated through the existing SHADOW/promotion-rule safety net — never auto-served), and that
  declining has zero effect on sponsored-capacity access.
- **Passed through the SAME opt-in `safety:scan` PII/secret-detection layer** the meta-llm README
  already documents, as a mandatory pre-training filter on this specific data path (not opt-in here
  — training data specifically warrants it, independent of whether a given caller has that scope
  enabled elsewhere).
- **Revocable**, with a real deletion story: revoking consent stops future capture; ADR-315's
  implementation must also define how a user requests deletion of already-captured interaction data
  before it's folded into a training round (a real, not just documented, story — this is the part
  most likely to be treated as a checkbox and skipped, so it's called out explicitly here as a
  requirement, not a nice-to-have).

### Client-side (meta-proxy's actual scope)

- New consent domain wired the same way `sponsored-downtime` and `power-saver` are (ADR-313/314
  pattern): `ruflo proxy training-share-enable/-disable/-status`, its own disclosure text, its own
  `power_saver`-shaped consent mirror field (`training_share_consent_granted`) in
  `proxy-config.toml`.
- When a request is on the Sponsored plane AND `training_share_consent_granted` is true, the proxy
  adds `X-Cognitum-Training-Consent: true` alongside the existing `X-Cognitum-Sponsored: true`
  header. Absent or false → header omitted entirely (not sent as `false` — an omitted header is a
  clearer "no" than a spoofable boolean value a bug could flip).
- No other proxy behavior changes — no request/response shape changes, no new data captured or
  buffered client-side. The proxy is a consent-signal relay here, nothing more; meta-llm decides
  what to do with the header entirely server-side.

### Server-side (meta-llm — named here as the dependency, not specified in full; that's meta-llm's
own ADR to write against ADR-251)

- `X-Cognitum-Training-Consent: true` on an inbound request is meta-llm's signal to retain that
  interaction (post safety-scan) as flywheel training input; its absence means the interaction is
  used exactly as today — served, metered, and NOT retained for training.
- A new scheduled tick (Cloud Scheduler, same pattern as `pods_scheduler.tf`) periodically batches
  accumulated consented interactions into `interactionSummaries` and calls the EXISTING
  `/v1/microlora/evolve` — this ADR does not change that service's own safety posture
  (SHADOW-only, `meetsPromotionRule`-gated, human-promoted) in any way; the new work is purely
  "where the input now comes from and on what cadence," not "how adaptation or promotion works."

## Consequences

- Tier 1 (routing calibration) ships with effectively no new privacy surface — it's an existing
  system consuming more of the same kind of data it already consumes.
- Tier 2 (content training) is real new surface, and this ADR is deliberately conservative about
  it: opt-in only, never bundled, safety-scanned, revocable with an actual deletion path. If any of
  those four properties can't be delivered at implementation time, Tier 2 should not ship until
  they can — this is the one place in the whole sponsored-downtime feature family where getting the
  consent story wrong has consequences beyond a UX papercut.
- This ADR deliberately does NOT re-specify `/v1/microlora/evolve`, its promotion gate, or its
  lineage/replay verification — all of that is ADR-251's, shipped, and unchanged. Duplicating that
  design here would risk the two documents drifting out of sync with the real implementation.
- Add to the implementation loop as: (1) meta-proxy consent wiring + header (small, self-contained,
  same shape as ADR-313/314's client work), (2) meta-llm consent-gated capture + scheduled tick
  (larger, backend work, meta-llm's own scope to design and ship against this ADR + ADR-251).

## References

- [ADR-313: Sponsored Downtime Mode](ADR-313-sponsored-downtime-proxy-mode.md)
- [ADR-314: Power Saver Mode + Abuse Prevention](ADR-314-power-saver-mode-and-sponsored-abuse-prevention.md) — the consent-domain and disclosure pattern this ADR reuses exactly
- meta-llm ADR-251 (MicroLoRA flywheel service) — the training mechanism this ADR feeds
- meta-llm `src/flywheel/`, `docs/ARCHITECTURE.md` §"Flywheel — assumed → measured" — the existing metadata-only routing calibration (Tier 1)
- meta-llm `terraform/pods_scheduler.tf` — the scheduled-tick pattern the new training cadence should reuse, not reinvent
- ADR-309 (ruflo) — the "no raw prompt content, ever" constraint this ADR explicitly distinguishes itself from (that's ruflo's own local telemetry; this is Cognitum's server-side training pipeline, a different data flow with its own, separately-designed consent bar)
