# ADR-304 — Local Meta LLM Proxy

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-302](ADR-302-post-init-capability-enrollment.md) (enrollment entry point), [ADR-303](ADR-303-credit-exhaustion-experience.md) (exhaustion entry point), [ADR-305](ADR-305-customer-lifecycle-funnel.md) (funnel overview), [ADR-148](ADR-148-fastgrnn-router-artifact-lifecycle.md) / [ADR-149](ADR-149-per-model-cost-optimal-routing.md) (cost-optimal routing the proxy builds on), [ADR-150](ADR-150-metaharness-integration-surfaces.md) (optional-dependency + removability constraint this must satisfy)

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

obtains credentials for proxy operation. Users retain full control and may disable cloud routing at any time (`ruflo proxy config --local-only`), leaving the proxy as a purely local multi-backend router.

## Constraints

- **Optional and removable** (ADR-150 discipline): the proxy ships as an optional component; ruflo remains fully operational with it absent or uninstalled. No `dependencies` entry — install is an explicit user action.
- **No credentials in the repo or config files**: tokens live in the OS keychain where available, else `~/.ruflo/credentials` with `0600` permissions; never in project config, never committed (existing `@claude-flow/security` boundary rules apply).
- **Local-first privacy posture**: prompts routed to local backends never leave the machine; the cloud path is explicit and visible in request receipts.
- **Default port 11435** (adjacent to Ollama's 11434, non-conflicting), configurable.
- **Failure isolation**: if the proxy is down, clients get a normal connection error — the proxy must never silently fall back from local-only mode to cloud routing.

## Consequences

- New CLI surface: `ruflo proxy install|enable|disable|status|config`.
- `ruflo doctor` gains a proxy health check component.
- This is the conversion product the ADR-301/302/303 touchpoints funnel toward; activation rate is a North Star metric in ADR-305.
