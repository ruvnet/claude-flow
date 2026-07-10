# ADR-307 — Proxy Runtime, Packaging, and Service Lifecycle

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-304](ADR-304-local-meta-llm-proxy.md) (product definition), [ADR-306](ADR-306-cognitum-authentication-account-linking.md) (auth), [ADR-308](ADR-308-cognitum-public-api-contract.md) (API contract), [ADR-150](ADR-150-metaharness-integration-surfaces.md) (removability discipline)

## Context

ADR-304 defines what the local Meta LLM proxy *is*; nothing defines the deployable runtime — language, packaging, bind semantics, service management, or update path. Those decisions determine the security surface of a long-running local process and must precede implementation.

## Decision

### Runtime

- **Rust single binary.** No runtime dependency on Node; the ruflo CLI manages it but does not host it.
- **OpenAI-compatible HTTP server.**
- **Default bind: `127.0.0.1:11435`.** Loopback only. External bind requires explicit configuration (`proxy.bind` in config or `RUFLO_PROXY_BIND`) and prints a warning at startup.
- **No privileged port.** The proxy never requires elevation to install or run.
- **Foreground mode by default.** `ruflo proxy start` runs attached; managed service install is a separate, explicit step.
- **Local access control:** loopback is reachable by every local user on multi-user systems, so the proxy requires a per-user bearer token generated at install (`~/.ruflo/proxy-token`, `0600`) on every request.

### Platform service model (optional, explicit)

| Platform | Managed mode |
|---|---|
| macOS | launchd **user agent** (never a system daemon) |
| Linux | systemd **user service** |
| Windows | per-user background process, or Windows service for enterprise deployments |
| Containers | foreground process only; no service install inside containers |

### Lifecycle commands

```
ruflo proxy install      # fetch + verify binary, write config, generate local token
ruflo proxy start        # foreground by default; --service to use the managed unit
ruflo proxy stop
ruflo proxy status       # includes data plane per ADR-304: local vs cloud:<provider>
ruflo proxy logs
ruflo proxy update       # explicit only — the proxy never self-updates
ruflo proxy uninstall    # removes binary, service unit, token, and consent receipt
```

### Packaging and update integrity

- The binary is **not** bundled in the npm packages (size, and ADR-150 removability: ruflo works with the proxy absent). `proxy install` downloads a platform artifact from the official release channel, verifies **checksum + Ed25519 signature** before writing to disk, and refuses on any mismatch.
- `proxy update` repeats the same verification. There is no auto-update path; the statusline may *suggest* an update (educational message class, ADR-301), but only the explicit command applies one.
- Version compatibility between CLI and proxy is declared in the proxy's `/status` response; incompatibility degrades to a clear error, never undefined behavior.

## Key invariant

**"Local proxy" means the proxy *process* is local. It does not imply inference is local.**

Every cloud-bound request path exposes routing before first use (per ADR-304's disclosure gate):

```
This request may send prompt content to api.cognitum.one
and the selected provider.
```

Default state after install is local-only routing; cloud routing activates only through the ADR-304 disclosure flow backed by the ADR-302 `cloud-routing` consent receipt and the ADR-306 `cloud.route` scope.

## Consequences

- A new repository/workspace for the Rust proxy with its own release pipeline; ruflo pins compatible proxy versions per release.
- `ruflo doctor --component proxy` checks: binary signature, version compatibility, bind address, token file permissions, service unit state.
- Failure isolation holds (ADR-304): proxy down → normal connection error; the proxy never silently reroutes local-only traffic to cloud (ADR-308 failure policy).
