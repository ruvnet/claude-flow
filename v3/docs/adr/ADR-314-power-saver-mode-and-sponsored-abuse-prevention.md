# ADR-314: Power saver mode (auto-route lesser requests) + sponsored-capacity abuse prevention

- **Status**: Proposed
- **Date**: 2026-07-10
- **Deciders**: ruv
- **Related**: [ADR-304](ADR-304-local-meta-llm-proxy.md), [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md), [ADR-312](ADR-312-usage-limit-downtime-prevention.md), [ADR-313](ADR-313-sponsored-downtime-proxy-mode.md)

## Context

Two requests, and they turn out to share a root cause:

1. "Include a power saver mode: if your Claude Code Max/Pro account is below 20%, auto-route
   lesser requests that don't need the extra intelligence to the meta-llm."
2. "Include anti-cheating and abuse capabilities" for the sponsored-capacity system ADR-313 built.

The connection: widening the trigger for routing through Cognitum (from "only when actually
rate-limited" to "proactively, whenever quota looks low") widens the abuse surface at the same
time. This ADR designs both together rather than bolting anti-abuse on afterward.

**A constraint carries over directly from ADR-312 and has to be stated up front:** ruflo cannot
read "your account is at 20%." ADR-312 already established, by direct inspection of the installed
Claude Code CLI, that rate-limit/quota state is populated from response headers
(`anthropic-ratelimit-unified-status`, `-utilization`, etc.) that are **not exposed** to hooks, the
statusline JSON payload, or anywhere else a third-party CLI extension can read. That finding
applies unchanged here — "20%" can't be measured any more precisely than "rate-limited or not" can
be. Building this as if the number were readable would ship something that silently never
activates, or activates on a fabricated value. The design below is honest about that gap.

## Decision

### A. Power saver mode is self-reported, not measured (Phase 0, same pattern as ADR-312)

`ruflo settings notices quota-low [--clear]` sets a manual flag — structurally identical to
`rate-limited` in `rate-limit-notifier.ts`, same 6h TTL, same file-based mechanism
(`~/.ruflo/quota-status.json`). This is **not** automatic detection; it's the same honest
workaround ADR-312 already shipped for the binary case, generalized to a second, lower-severity
signal: "not blocked yet, but I want to start conserving." A future Phase 1/2 (per ADR-312) that
gets real quota data from Anthropic would replace the self-report with a real threshold check —
no design here depends on staying manual forever.

Separate flag from `rate-limited` deliberately: "I'm running low" (proactive, user still has
capacity) and "I'm blocked" (reactive, zero capacity left) are different urgencies with different
correct responses — conflating them would mean either power-saver mode never fires until you're
already blocked (too late to have saved anything) or a false-rate-limited claim silently piggybacks
onto power-saver's less-scrutinized activation path.

### B. Power saver mode routes through the Cloud plane with the model rewritten to `cognitum-auto`

This is the part that makes "auto-route lesser requests" actually work without ruflo building its
own prompt-difficulty classifier — Cognitum's gateway already has one, and it exists for exactly
this purpose (ADR-201's cost-Pareto thesis, `docs/ARCHITECTURE.md` in the meta-llm repo: "cheap
traffic stays cheap and only the hard tail escalates").

**The mechanism that makes this necessary, not just convenient**: Cognitum's `/v1/messages`
translation adapter maps a *named* Anthropic model to a tier by name — opus→high, sonnet→mid,
haiku→low (confirmed reading `src/routes/messages.ts` in the meta-llm repo). The existing
Cloud/Sponsored planes in the proxy forward whatever model Claude Code requested, unchanged. Since
a Claude Code session runs on one model for its whole lifetime (typically opus or sonnet, chosen
once, not varied per-message by task complexity), forwarding the *name* verbatim would map to the
*same* tier — usually high — on every single request. That is not cost savings; it just moves the
same spend to a different biller. Power saver mode instead rewrites the outgoing `model` field to
the literal string `cognitum-auto` before forwarding, so Cognitum's real per-prompt difficulty
scorer (not a name lookup) decides low/mid/high per request. Everyday messages get cheap; a
genuinely hard reasoning turn still escalates to a comparable frontier model — that's the "lesser
requests... don't need the extra intelligence" distinction, made by the router that already exists
for it, not reimplemented client-side.

Power saver mode uses the **Cloud** plane (the user's own `cognitum_api_key`, their own Cognitum
account/billing) — **not** Sponsored. This is the user choosing to spend their own Cognitum credit
to conserve their own Anthropic quota; it is not free capacity, and shouldn't share Sponsored's
"billed to Cognitum, not you" framing or its abuse surface. A user can independently also be
rate-limited and sponsored-consented; if both apply, Sponsored wins (ADR-313's existing precedence
is unchanged — being actually blocked outranks proactively conserving).

### C. Sponsored capacity is now capped at low/mid tier, never high — a direct abuse-surface fix

Independent of power saver mode, this closes a real gap in the shipped ADR-313 sponsored plane:
today it forwards the client's requested model name unchanged, which (per the mapping above) means
a session running on opus forwards as `high` tier every time — Cognitum's *most expensive* tier,
on *Cognitum's own dime*, for every sponsored request, with no client-side ceiling. **Sponsored
requests now always rewrite `model` to a fixed low/mid-capable alias, never a tier that can resolve
to a frontier/high-cost model**, regardless of what Claude Code originally requested. This bounds
Cognitum's worst-case per-request exposure on the free plane independent of anything else in this
ADR, and independent of whether the difficulty scorer itself could ever be gamed into
over-escalating (see the vector list below) — the cap holds even if the scorer is fooled, because
the tier ceiling is enforced before the scorer's decision is even relevant.

### D. Anti-abuse: the vectors, ranked, and what's buildable now vs. blocked on Cognitum-side work

Ranked by severity — most severe first:

1. **Fabricated rate-limited/quota-low claims for free Sponsored capacity — the most severe, and
   currently the ONLY thing standing between "opt-in for genuine downtime" and "unlimited free
   inference on request."** Phase 0 detection (ADR-312) is entirely self-reported with zero
   server-side verification; nothing today distinguishes an honest user who actually hit their
   limit from someone who runs `ruflo proxy sponsor-enable --yes` once and never looks back.
   - **Buildable now (this ADR ships it)**: a cooldown on the `rate-limited`/`quota-low` toggle
     commands — no more than one flip per 10 minutes each. Cheap, purely client-side friction; it
     doesn't stop a determined abuser but it stops casual/accidental always-on gaming and raises
     the bar on scripted abuse.
   - **Blocked on Cognitum-side work**: per-identity sponsored quotas (see #2) are the real fix —
     a cooldown only slows down abuse from a single identity; it can't cap total abuse without a
     stable per-user identity to cap it *against*.
2. **The shared/unattributable API key.** ADR-313's addendum already flagged this as open: there
   is no automated way to provision a real, per-user, scoped `cognitum_api_key` — every sponsored
   user today would share one key (in this session's testing, `COGNITUM_TEST_API_KEY`). A shared
   key means zero per-user accountability, no way to revoke one abuser without cutting off
   everyone, and unlimited blast radius if it ever leaks. **This is the prerequisite for
   meaningfully addressing #1, #4, and #5 below — it is Cognitum-backend work (a key-minting
   endpoint `sponsor-enable` calls on first activation), not something this proxy or ruflo's CLI
   can build unilaterally.** Flagging it here as the single highest-priority follow-up, not
   re-flagging it as "still fine to defer indefinitely."
3. **Power-saver's own difficulty-scorer gaming.** A user could pad trivial prompts to trick
   Cognitum's scorer into escalating to a costlier tier than the content warrants. On the **Cloud**
   plane this is the user spending *their own* credit inefficiently — not a security abuse vector,
   just a self-defeated feature, out of scope to defend against. The reason this is listed at all:
   the same gaming, if it ever applied to **Sponsored** traffic, WOULD be a real abuse vector
   (tricking free capacity into the expensive tier) — which is exactly why mitigation C above
   (hard tier ceiling, enforced before the scorer runs) matters independent of whether the scorer
   itself can be foxed.
4. **Proxy config/token copied across machines to multiply effective throughput.** Buildable
   server-side once #2 lands: per-key concurrent-request and requests/minute caps (not just a
   daily $ cap) bound this regardless of how many machines share one key.
5. **Scripted volume abuse — pure spam against the shared sponsored pool, no benefit to the
   attacker beyond degrading the pool for everyone.** Same fix as #4: per-key rate limiting,
   Cognitum-side, blocked on #2.
6. **Sponsored anonymity as a lower-accountability vector for policy-violating content.**
   Recommend Cognitum's existing opt-in `safety:scan` guardrail layer (documented in the meta-llm
   repo) become **mandatory**, not opt-in, specifically on Sponsored-plane traffic — pseudonymous
   free capacity is exactly the surface this class of abuse would target. Cognitum-backend policy
   change, not a proxy change.

### E. What ships in this ADR's implementation vs. what's tracked as follow-up

**Ships now** (ruflo + meta-proxy, no Cognitum backend changes required):
- `ruflo settings notices quota-low [--clear]` — the power-saver self-report flag
- `power-saver` consent domain (mirrors `sponsored-downtime`'s pattern exactly)
- Proxy: Cloud-plane model rewrite to `cognitum-auto` when power-saver is active and Sponsored
  isn't (precedence: Sponsored > Power-saver > default Passthrough)
- Proxy: Sponsored-plane model rewrite to a fixed low/mid-only alias, always, independent of
  power-saver — this is a standalone hardening fix to the already-shipped ADR-313 plane
- Cooldown (10 min) on `rate-limited`/`quota-low` flag toggles

**Tracked as follow-up, explicitly not solvable from ruflo's side alone:**
- Per-user Cognitum key minting (the real fix for abuse vectors #1, #2, #4, #5)
- Per-key concurrent-request / requests-per-minute caps (Cognitum backend)
- Mandatory safety-scan on Sponsored traffic (Cognitum backend policy)

## Consequences

- Power saver mode's actual value depends entirely on Cognitum's difficulty scorer being good —
  this ADR does not re-litigate or re-verify that scorer's accuracy, it just routes to it.
- The Sponsored tier cap (C) is a behavior change to the already-shipped ADR-313 plane: sponsored
  users lose access to high-tier models entirely, unconditionally. This is intentional — sponsored
  capacity was never framed as "free frontier access," and ADR-313's own text already describes it
  as "best-effort... Cognitum may throttle or decline requests under load."
- Every mitigation ranked "blocked on Cognitov-side work" above means the abuse-prevention story
  for Sponsored mode remains genuinely incomplete until that work lands — this ADR does not claim
  Sponsored mode is abuse-proof, only that it is more bounded than before (D3) and that the
  concrete missing piece is named (D2), not hand-waved.
- No change to the Passthrough plane (ADR-313 addendum) — power saver mode and its abuse surface
  are additive, not a replacement for "normal usage still means your own subscription by default."

## References

- [ADR-304: Local Meta LLM Proxy Product](ADR-304-local-meta-llm-proxy.md)
- [ADR-307: Proxy Runtime, Packaging, and Service Lifecycle](ADR-307-proxy-runtime-packaging-lifecycle.md)
- [ADR-312: Usage-Limit Downtime Prevention](ADR-312-usage-limit-downtime-prevention.md) — the detection-gap constraint this ADR inherits unchanged
- [ADR-313: Sponsored Downtime Mode](ADR-313-sponsored-downtime-proxy-mode.md) — the plane this ADR hardens (tier cap) and extends (power saver's Cloud-plane sibling)
- meta-llm `src/routes/messages.ts`, `docs/ARCHITECTURE.md` — the difficulty-based tier router this design routes to rather than reimplements
