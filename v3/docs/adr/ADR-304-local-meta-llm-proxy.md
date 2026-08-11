# ADR-304 — Local Meta LLM Proxy Product

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-302](ADR-302-post-init-capability-enrollment.md) (enrollment entry point), [ADR-303](ADR-303-credit-exhaustion-experience.md) (exhaustion entry point), [ADR-305](ADR-305-customer-lifecycle-funnel.md) (funnel overview), [ADR-306](ADR-306-cognitum-authentication-account-linking.md) (auth), [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md) (runtime, packaging, service lifecycle), [ADR-308](ADR-308-cognitum-public-api-contract.md) (API contract), [ADR-148](ADR-148-fastgrnn-router-artifact-lifecycle.md) / [ADR-149](ADR-149-per-model-cost-optimal-routing.md) (cost-optimal routing the proxy builds on), [ADR-150](ADR-150-metaharness-integration-surfaces.md) (optional-dependency + removability constraint this must satisfy)

> This ADR defines the **product**: what the proxy does, its data-plane semantics, and its consent gates. The deployable runtime — binary, packaging, bind semantics, platform services, update integrity — is defined in [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md).

## Context

Many RuFlo users already run local models or use multiple providers. Managing endpoints, API keys, and routing policies individually increases friction.

Cognitum provides Meta LLM orchestration through https://api.cognitum.one. A local proxy can expose a single OpenAI-compatible endpoint while transparently routing requests to the optimal provider — the same tier-routing discipline the repo already applies internally (3-tier model routing, `metallm_ask`/`metallm_delegate` gateway delegation, ADR-149 cost-optimal routing).

## Decision

Offer an optional local proxy during onboarding (ADR-302), on credit exhaustion (ADR-303), and on demand via `ruflo proxy install` / `ruflo proxy enable`.

### Architecture

```
Client (any OpenAI-compatible SDK / ruflo agents)
  ↓
localhost:11435
  ↓
Meta Proxy (local process, ruflo-managed)
  ↓
api.cognitum.one
  ↓
Claude │ GPT │ Gemini │ DeepSeek │ OpenRouter │ Local Ollama │ vLLM │ SGLang
```

Local backends (Ollama, vLLM, SGLang) are routed to directly by the local proxy without a cloud round-trip; api.cognitum.one is in the path only for cloud providers and for routing-policy updates.

### Capabilities

- OpenAI-compatible API surface
- Automatic routing (difficulty-tiered, cheap-tier-first — same policy family as `cognitum-auto`)
- Cost optimization
- Latency optimization
- Retry policies
- Provider failover
- Request receipts (metered cost + resolved tier/model returned in-band, matching the `metallm_ask` contract)
- Local caching
- Future harness-evolution integration (ADR-150/151 surfaces)

### Authentication

```
ruflo auth login
```

obtains credentials for proxy operation.

### Data-plane disclosure (cloud routing is off by default)

"Local proxy" is easily read as "local inference." The two must never be conflated:

- **Default state after `ruflo proxy install` is local-only.** The proxy routes exclusively to local backends (Ollama, vLLM, SGLang). No prompt leaves the machine, and no request is made to api.cognitum.one for inference.
- **Cloud routing requires a separate explicit step** — `ruflo proxy config --cloud` — gated on the `cloud-routing` consent domain (ADR-302). Neither enrollment acceptance, `auth login`, nor proxy installation enables it.
- **Pre-activation disclosure is mandatory.** Before cloud routing turns on, the UI states in plain terms what changes. Activating Cloud decides three separate things, each with a different answer than the plane the user is leaving, so the disclosure answers all three: **who processes** the prompt (Cognitum, server-side, at api.cognitum.one), **who pays** (the user's Cognitum account — not their own Claude subscription, which is what the Passthrough plane uses), and **which model runs** (the plane selects a tier per prompt rather than honoring the client's requested model — see the routing-mode addendum below).

  The default answer is No. The exact wording lives in `CLOUD_ROUTING_DISCLOSURE` (`src/commands/proxy.ts`) and is asserted by `proxy-config-command.test.ts`; it is deliberately not transcribed here, because the previous copy in this ADR fell behind the shipped text and a reader could not tell which one was real.
- **Visible at runtime.** `ruflo proxy status` and every request receipt state the data plane used (`local` vs `cloud:<provider>`), so the user can verify where any given prompt went.
- Cloud routing can be disabled at any time, revoking the `cloud-routing` consent receipt. **Disabling is a choice of destination, not one command**: `ruflo proxy config --local-only` goes to a purely local multi-backend router, `ruflo proxy config --passthrough` goes to the user's own Claude subscription. See the 2026-08-05 addendum — treating these as one state is how a user could lose their subscription by turning cloud routing off.

## Relationship to the metallm dev-bridge

The repository already carries an internal meta-llm gateway surface (`metallm_ask` / `metallm_delegate`, the dev-bridge MCP server). This proxy is related but **not** the same thing, and the boundary is explicit:

| | metallm dev-bridge | ADR-304 proxy |
|---|---|---|
| Audience | Internal orchestration interface for development of ruflo itself | Supported, customer-facing product |
| Contract | Best-effort, may change with the gateway | Versioned public API (ADR-308) |
| Routing core | Shared (cognitum tier-routing policy family) | Shared |
| Network contract | **No implicit dependency in either direction** | ADR-308 |

- The shared routing core is a library boundary; the dev-bridge and the proxy consume it independently.
- A **compatibility layer, explicitly versioned**, mediates anywhere the two must interoperate — the internal dev-bridge never becomes the de facto public contract, and public-contract changes never break internal tooling silently.
- Deprecating or changing the dev-bridge has no effect on proxy customers, and vice versa.

## Constraints

- **Optional and removable** (ADR-150 discipline): the proxy ships as an optional component; ruflo remains fully operational with it absent or uninstalled. No `dependencies` entry — install is an explicit user action.
- **No credentials in the repo or config files**: tokens live in the OS keychain where available, else `~/.ruflo/credentials` with `0600` permissions; never in project config, never committed (existing `@claude-flow/security` boundary rules apply).
- **Local-first privacy posture**: prompts routed to local backends never leave the machine; the cloud path is explicit and visible in request receipts.
- **Default port 11435** (adjacent to Ollama's 11434, non-conflicting), configurable.
- **Failure isolation**: if the proxy is down, clients get a normal connection error — the proxy must never silently fall back from local-only mode to cloud routing.

## Consequences

- New CLI surface: `ruflo proxy …` — full lifecycle command set (`install|start|stop|status|logs|update|uninstall`) specified in ADR-307, plus `proxy config` for routing mode.
- `ruflo doctor` gains a proxy health check component (details in ADR-307).
- This is the conversion product the ADR-301/302/303 touchpoints funnel toward; activation rate is a North Star metric in ADR-305.

## Addendum (2026-07-16) — `ruflo proxy config` implemented; real TOML wire values confirmed

`ruflo proxy config --cloud [--yes] | --local-only` is implemented in
`v3/@claude-flow/cli/src/commands/proxy.ts` (`configSub`), reusing the same consent-gated
disclosure pattern the ADR-313/314/315 subcommands in that file already use
(`hasConsent`/`recordConsent`/`revokeConsent` against the `cloud-routing` consent domain, plus a
TOML mirror write to `proxy-config.toml`).

**The exact wire value was confirmed two ways, not assumed**: reading meta-proxy's actual
`DataPlane` enum (`src/config.rs`) showed `#[derive(Serialize, Deserialize)]` +
`#[serde(rename_all = "snake_case")]` — so the TOML field is `default_data_plane = "<value>"`
with `"local"` / `"cloud"` / `"sponsored"` / `"passthrough"` (lowercase; snake_case has no effect
on these single-word variant names beyond lowercasing). This was cross-checked behaviorally
against the real v0.1.0 binary: `default_data_plane = "Local"` (PascalCase, the wrong guess)
silently fell back to the default plane (Passthrough) rather than erroring — consistent with this
ADR's own "a malformed config must never crash the proxy" design, but a real trap for anyone
guessing the casing from the Rust variant names alone. `"local"` (lowercase) took a visibly
different code path in the same test. At the time only `"local"`/`"cloud"` were written by this
command; `"sponsored"` stays owned by ADR-313's own `sponsor-enable`/`sponsor-disable`.
**`"passthrough"` is now written too, by `--passthrough` — see the 2026-08-05 restore addendum;
the original "never written (the proxy's own untouched default)" is superseded.**

`ruflo proxy config` (no flags) reports the current plane by reading the same file, defaulting to
`"passthrough"` (matching the Rust struct's own default) when no config file exists yet.

## Addendum (2026-08-05) — Cloud tier selection is a user-visible setting, and the disclosure now says so

Two gaps closed together, both traceable to meta-proxy#43.

**1. The Cloud plane does not use the client's requested model, and we never said so.** meta-proxy
ADR-321 rev-2 (shipped v0.6.0, work item M2 of cognitum-one/meta-proxy#43) applies tier selection to
*all* Cloud traffic. Previously it applied only on the quota-failover reasons, so a deliberately
configured Cloud plane forwarded the client's own model name — and since Claude Code names a
frontier model by default, every request was served at the top tier with no ceiling and no proxy
daily cap. That was the defect; difficulty-routing all Cloud traffic is the fix, not a regression.

The boundary that matters for this ADR's local-first posture is unchanged and explicit in rev-2:
**Passthrough and Local are untouched.** Those are the user's own subscription and their own
backend; the proxy never rewrites a model there. A ruflo user reaches the Cloud plane only by
running `proxy config --cloud`, and automatic movement off Passthrough still requires the ADR-313 /
ADR-314 consent gates.

Our disclosure never mentioned any of this — a user could enable Cloud believing their model choice
still held. #43 M5a added processor/billing confirmation to the Developer Console selector; **M5b
("equivalent disclosure to any terminal flow that explicitly activates Cloud") is this command**,
and it is what the rewritten `CLOUD_ROUTING_DISCLOSURE` closes.

**2. `ruflo proxy config --routing-mode <auto|low|mid|high>`.** rev-2's escape hatch is the
`routing_mode` config field; the Developer Console gained a control for it (meta-proxy#52) and ruflo
had none, so a ruflo user was stuck with `auto` with no way to disagree. The scorer reads prompt
*shape* (length bands, code/reasoning markers, `max_tokens` bands), not task difficulty, so a
short-but-hard prompt can under-escalate — pinning a tier is how a user overrides that judgement.

Wire values were confirmed against meta-proxy's `RoutingMode` enum (`src/config.rs`, same
`#[serde(rename_all = "snake_case")]` treatment as `DataPlane`): `routing_mode = "auto" | "low" |
"mid" | "high"`, `#[serde(default)]` so an existing config file that omits it keeps working and
means `auto`. An unrecognized value already in the file is reported as `auto` rather than echoed
back, matching the proxy's own degrade-to-safe-default behavior.

**Setting a tier must never activate Cloud.** meta-proxy ADR-321 Revision 3 keeps the plane choice
and this Cloud-only secondary setting as separate controls, so `--routing-mode` alone writes only
`routing_mode`, asks for no consent it does not need, and tells the user the setting is inert until
Cloud is on. `--routing-mode` with `--local-only` is refused rather than silently resolved, and an
unconfirmed `--cloud` still writes nothing at all.

**Still open upstream, deliberately not implemented here:** #43 M3 — a Cloud tier ceiling and daily
cap. Sponsored has `sponsored_daily_cap_usd`; Cloud has no proxy-side equivalent. #43 records the
cap amount and reset semantics as a product decision that must not be guessed, so the disclosure
makes no claim about caps in either direction.

## Addendum (2026-08-05) — turning cloud routing off has two destinations, and only one was reachable

`--local-only` was the sole exit from the cloud plane, and it writes
`default_data_plane = "local"`. `local` is the user's own Ollama/vLLM/SGLang backend.
`passthrough` — meta-proxy's own default, and the plane that uses the user's own Claude
subscription — was unreachable from this command by design ("`passthrough` is never written",
above).

That made the advertised undo wrong. A user on `passthrough` who followed our own disclosure
("Disable anytime: `ruflo proxy config --local-only`") landed on a **third** state they never chose,
pointed at a local backend that may not be installed. Two consequences, neither visible:

1. **Their Claude subscription stops being used at all.** This is precisely the harm
   cognitum-one/meta-proxy#51 closed on the login path — *"Combining those decisions silently
   switches a user away from Passthrough — their own Claude subscription — to api.cognitum.one"* —
   arriving here through a different door.
2. **Automatic quota failover silently stops applying.** meta-proxy gates it on the plane
   (`src/routing.rs`: `automatic_eligible = cfg.default_data_plane == DataPlane::Passthrough`),
   because Passthrough is the only plane that sees Anthropic's own rate-limit headers (ADR-320). A
   user parked on `local` is opted out of ADR-321 entirely and nothing tells them.

The command's own no-flag report papered over the distinction, printing one line —
*"Cloud routing is OFF — requests never leave this machine (or use your own Claude subscription on
Passthrough)"* — for two planes that behave differently.

**Decision.** `--local-only` keeps its meaning exactly (the flag name and this ADR both promise a
local backend; changing its target silently would be a second surprise). Instead:

- **`ruflo proxy config --passthrough` is added**, writing `default_data_plane = "passthrough"` and
  revoking `cloud-routing` consent the same way `--local-only` does. The plane is now reachable.
- **The disclosure names both exits** rather than presenting `--local-only` as *the* undo.
- **`--cloud` reads the plane it is leaving before overwriting it** and prints the exact command to
  restore it. That read is the only moment ruflo knows where the user was; nothing in the config
  file answers it afterwards, and this avoids persisting a "previous plane" that could go stale
  against a hand-edited TOML.
- **`--local-only` says what it did**, including that the Claude subscription is not used on that
  plane and how to choose it instead.
- **The no-flag report describes each plane distinctly**, and calls out the ADR-321 failover
  consequence while on `local`.
- **Plane flags are mutually exclusive** — passing more than one is refused rather than resolved by
  precedence, since any precedence order would silently discard something the user asked for.

This does not change any default. A user who never runs the command is on `passthrough`, exactly as
before.
