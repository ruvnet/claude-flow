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
- **Pre-activation disclosure is mandatory.** Before cloud routing turns on, the UI states in plain terms what changes:

  ```
  Enabling cloud routing.

  With cloud routing ON, prompts for cloud-tier requests are sent to
  api.cognitum.one and forwarded to the selected provider
  (Claude / GPT / Gemini / DeepSeek / OpenRouter).

  Requests routed to local backends never leave this machine.

  Enable cloud routing? [y/N]
  ```

  The default answer is No.
- **Visible at runtime.** `ruflo proxy status` and every request receipt state the data plane used (`local` vs `cloud:<provider>`), so the user can verify where any given prompt went.
- Cloud routing can be disabled at any time (`ruflo proxy config --local-only`), reverting to a purely local multi-backend router and revoking the `cloud-routing` consent receipt.

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
different code path in the same test. Only `"local"`/`"cloud"` are written by this command;
`"sponsored"` stays owned by ADR-313's own `sponsor-enable`/`sponsor-disable`, and `"passthrough"`
is never written (the proxy's own untouched default).

`ruflo proxy config` (no flags) reports the current plane by reading the same file, defaulting to
`"passthrough"` (matching the Rust struct's own default) when no config file exists yet.
