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

## Addendum (2026-07-16) — implementation reality check + injected-token bridge design

The lifecycle command set (`install|start|stop|status|logs|update|uninstall`) is now implemented
in `v3/@claude-flow/cli/src/proxy/{paths,release,verify,install,lifecycle}.ts` +
`src/commands/proxy-lifecycle.ts`, verified end-to-end against the real `cognitum-one/meta-proxy`
v0.1.0 release on Windows (install → Ed25519+checksum verify → extract → place → start → real
HTTP request against the running server, enforcing its bearer token → stop). Findings that
correct or firm up this ADR's assumptions:

- **Release signing, confirmed exactly as specified**: ONE combined `SHA256SUMS.sig`
  (raw Ed25519, base64, over the exact bytes of `SHA256SUMS`) per release, not a per-binary
  signature — `crypto.verify(null, sumsBytes, pubkey, sigBuffer)` against the pinned SPKI key
  committed in meta-proxy's `signing-key.pub.pem`. Asset naming:
  `meta-proxy-<version>-<target-triple>.<tar.gz|zip>`, 5 published triples (macOS arm64/x64,
  Linux x64/arm64 gnu, Windows x64 msvc).
- **`meta-proxy` has no `--version`/`--help` flag** — any invocation starts the live server as a
  side effect. `ruflo doctor`'s binary check must never spawn the binary to probe a version;
  version comes from the install manifest ruflo writes at install time plus, once running, the
  proxy's own `/status` endpoint. **Now implemented**: `checkProxyProcess` calls
  `GET /status` (bearer-token-authed with the local `proxy-token`, 2s timeout) only after PID
  signal-0 liveness already confirmed a process is running. Confirmed response shape against the
  real v0.1.0 binary:
  ```json
  {"version":"0.1.0","data_plane":"passthrough:anthropic","bind":"127.0.0.1:11435","sponsored_available":false,"proxy_token_valid":true}
  ```
  A version mismatch against the install manifest is a `warn` ("a stale process from a previous
  version?"), not a `fail` — the process is genuinely running, just possibly stale.
  `/status` being unreachable (still starting up, or a network hiccup) does not downgrade an
  already-passed PID-liveness check to a warning; it's reported inline on the `pass` result.
- **Production release distribution is implemented.** Signed artifacts are published to the
  public `cognitum-one/meta-proxy-dist` repository while source remains private. `ruflo proxy
  install` performs bounded unauthenticated downloads, then verifies the pinned Ed25519 signature
  over `SHA256SUMS` and the selected archive checksum before extraction. The dev-only private-repo
  `gh` path remains available behind `RUFLO_DEV_PROXY_INSTALL=1` for maintainers.
- **OS service-manager registration (launchd/systemd/Windows Service) is deliberately deferred.**
  `start --service` ships as a detached background process + PID file + log file for v1 — "survives
  terminal close, not a reboot" — with an honest status line rather than three divergent,
  hard-to-test OS integrations, one of which (a real Windows Service) typically needs elevation
  and would contradict this ADR's own "never requires elevation" line.

### Injected-token bridge (draft design for meta-proxy, NOT implemented in meta-proxy — ruflo side only)

ADR-306 gives `ruflo auth` its own OAuth implementation (a TypeScript port of meta-proxy's proven
`oauth/{client,pkce,browser,callback_server}.rs`, reusing meta-proxy's registered `client_id` —
confirmed live 2026-07-16 that `auth.cognitum.one` accepts an arbitrary ruflo-controlled loopback
`redirect_uri` for that client without a new registration). `ruflo`'s access token is deliberately
process-memory-only (never written to disk), while meta-proxy is a long-running daemon needing a
durable credential — so a bridge has to be `ruflo` *actively pushing* a token, not meta-proxy
reading a file that already holds one.

**Sketch, not implemented**: `ruflo proxy start` (once logged in with `proxy.use` scope) writes
`~/.ruflo/proxy-injected-token` (0600, deliberately separate from `auth.json`) containing the
bearer string + expiry, refreshed on an interval (~every 8 min, given the 15-minute access-token
lifetime) by ruflo's own refresh loop while it supervises the process. Meta-proxy's
`oauth::cloud_auth::resolve()` would gain ONE new highest-priority branch (checked before its
existing two — own OAuth token, own `cog_` key): read `~/.ruflo/proxy-injected-token` (path
overridable via a new, additive `ruflo_injected_token_path: Option<PathBuf>` field, meta-proxy
`ProxyConfig`'s 13th field, none of the current 12 touched); if present/parseable/unexpired, use
it as Bearer; on any failure, fall through silently to the existing two branches. `meta-proxy
login` would keep working completely unchanged for existing users.

**Explicitly unresolved, not hand-waved**: who runs the refresh pump in `--service`/background
mode, since `ruflo` itself is not resident once `start --service` detaches. This needs its own
design pass — most likely the refresh loop has to live inside the same detached background
process `ruflo` spawns for itself, which is a larger change than this addendum's scope — before
any Rust is written or a PR opened against `cognitum-one/meta-proxy`. Not implemented in this
branch; parked here as the design starting point for that follow-up.

### Ruflo-side gap closure (2026-07-16)

The three client-side gaps found during the implementation review are closed:

1. `ruflo proxy config --cloud [--yes] | --local-only` now writes the confirmed lowercase
   `default_data_plane` wire values and maintains the `cloud-routing` consent receipt (ADR-304
   addendum).
2. `ruflo doctor --component proxy` now authenticates to the live process's `/status` endpoint
   after PID liveness succeeds, reporting the data plane and warning on a running-vs-installed
   version mismatch.
3. ADR-306's refresh implementation now has a demand-driven consumer through `getValidAccessToken`
   and `ruflo auth status --check`, including refresh-token rotation ordering and fail-closed
   scope/consent checks.

The bridge is implemented by meta-proxy v0.2.0 and ruflo's resident supervisor: only the short-lived
access token crosses the process boundary, while ruflo retains the rotating refresh token in the OS
keychain. Production installation is implemented through the signed public distribution channel.

### v0.4.0 pinned install default (2026-07-17)

`ruflo proxy install --yes` now selects the reviewed Meta-Proxy v0.4.0 release
without requiring a user to discover and type a version. This is a pinned,
reproducible default, not an unauthenticated "latest" lookup: the installer
continues to verify the public distribution's Ed25519-signed `SHA256SUMS` and
the selected platform archive before extraction. An operator keeps control of
later changes through explicit `ruflo proxy update --release <x.y.z>` or an
explicit `install --release <x.y.z>` override.
