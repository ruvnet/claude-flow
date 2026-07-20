# ADR-306 — Cognitum Authentication and Account Linking

- **Status:** Proposed
- **Date:** 2026-07-10
- **Deciders:** ruflo core
- **Related:** [ADR-302](ADR-302-post-init-capability-enrollment.md) (consent domains), [ADR-304](ADR-304-local-meta-llm-proxy.md) (proxy product), [ADR-307](ADR-307-proxy-runtime-packaging-lifecycle.md) (proxy runtime), [ADR-308](ADR-308-cognitum-public-api-contract.md) (API contract), [ADR-309](ADR-309-funnel-governance-privacy-ecosystem.md) (governance)

## Context

ADRs 302–304 all hand off to `ruflo auth login`, which does not exist. The funnel cannot ship on an unspecified identity system: token handling, revocation, and storage are security-critical, and every consent decision in ADR-302 ultimately anchors to an account. This ADR specifies the complete identity lifecycle.

## Decision

### Authentication flows

| Environment | Flow |
|---|---|
| Interactive desktop (browser reachable) | OAuth 2.0 Authorization Code + **PKCE**, loopback redirect |
| Headless / SSH / no browser | **Device authorization flow** (RFC 8628): CLI shows user code + verification URL |
| CI / non-TTY | `auth login` refuses interactively; service credentials only via explicit `--token-stdin` for enterprise automation |
| Enterprise SSO | OIDC federation brokered by Cognitum (IdP-initiated flows land on the same token contract); detailed in a follow-up amendment before enterprise GA |

### Token model

- **Access token:** 10–15 minute lifetime, held in process memory; short-lived enough that server-side revocation is honored within one lifetime.
- **Refresh token:** stored in the **OS keychain only** — macOS Keychain, Linux Secret Service (libsecret), Windows Credential Manager. **Never in plain-text config**, never in `claude-flow.config.json`, never in `.env`.
- **No keychain available** (typical headless Linux): tokens are session-only; the CLI re-runs the device flow on expiry rather than writing a refresh token to disk. This is a deliberate usability cost in exchange for never persisting plain-text credentials.
- The CLI's on-disk state (`~/.ruflo/auth.json`, `0600`) stores only: account ID, granted scopes, access-token expiry, keychain entry reference, profile name. No token material.

### Scopes (map 1:1 onto ADR-302 consent domains)

```
account.create        ← consent domain: account
proxy.use             ← consent domain: proxy-install
cloud.route           ← consent domain: cloud-routing
telemetry.write       ← consent domain: telemetry
hosted.memory.use     ← consent domain: hosted-memory (new; same receipt rules)
```

- Scopes are requested **incrementally**: `auth login` requests `account.create` only. Each further scope is requested at the moment its capability is enabled, gated on the corresponding ADR-302 consent receipt.
- Accepting account creation **must not** implicitly grant `cloud.route` or `telemetry.write`. A token bearing a scope without a matching local consent receipt is a level-0 consent violation (ADR-305 gate hierarchy).

### Lifecycle

- **Account creation / linking:** first `auth login` offers create-or-link on the Cognitum side; the CLI only ever receives tokens, never passwords.
- **Refresh:** silent, keychain-backed; failure degrades to logged-out state with a clear message — never a retry storm.
- **Revocation:** `ruflo auth logout` calls `POST /v1/auth/revoke` (ADR-308), removes the keychain entry, clears `auth.json`, and revokes the `account` consent receipt. Server-side revocation (dashboard) takes effect within one access-token lifetime.
- **Multiple accounts:** named profiles — `ruflo auth login --profile work`; one default profile; `ruflo auth status` lists all with scopes and expiry.
- **Offline:** cached identity metadata is readable; no refresh occurs; capabilities requiring auth fail with a clear "offline, sign-in required" error. Core ruflo functionality is never affected by auth being unavailable (ADR-308 failure policy).

## Consequences

- New CLI surface: `ruflo auth login|logout|status [--profile <name>]`.
- `@claude-flow/security` owns token handling primitives (keychain adapters, PKCE verifier generation); no other package touches token material.
- `ruflo doctor` gains an auth component (keychain availability, token expiry, scope-vs-receipt consistency check).
- The scope-vs-receipt consistency check is enforced client-side on every authenticated call: a scope with no receipt drops the capability and reports, fail-closed.

## Addendum (2026-07-16) — implemented against the proven surface, not the ADR-308 spec

`ruflo auth login|logout|status` is implemented in `v3/@claude-flow/cli/src/auth/` +
`src/commands/auth.ts`, backed by a new OAuth+PKCE+keychain module in `@claude-flow/security`
(`src/oauth/{client,pkce,browser,callback-server}.ts`, `src/keychain-adapter.ts`). Two decisions
made during implementation, differing from this ADR's original text:

- **Targets `auth.cognitum.one/oauth/{authorize,token}` + `/v1/oauth/code-exchange`, NOT
  `api.cognitum.one/v1/auth/{device,token,revoke}`.** The latter is what ADR-308's checked-in
  OpenAPI spec describes, but reading meta-proxy's actual, currently-shipping OAuth client
  (`oauth/client.rs`) showed it hits a different host and a different path scheme entirely — and
  meta-proxy's flow is real, tested, and working in production. Building against ADR-308's spec
  would have meant shipping a client for endpoints nobody has confirmed exist. This is a genuine
  drift between what was specified and what the identity server actually serves — see the
  ADR-308 addendum.
- **Reuses meta-proxy's registered `client_id=meta-proxy`, not a new `ruflo`-specific
  registration.** Confirmed live 2026-07-16: `GET /oauth/authorize` with `client_id=meta-proxy`
  and an arbitrary ruflo-controlled loopback `redirect_uri` returns a working consent page, not a
  redirect_uri-mismatch error — so `services/identity`'s `validate_redirect_uri` does not enforce
  a per-client exact-URI allowlist for this client, at least today. This is empirical behavior,
  not a documented contract, and could tighten later; if it ever does, `ruflo auth` needs its own
  registered client as a follow-up, not a silent breakage.
- **Device flow (RFC 8628) was not built as a separate mechanism.** The OOB/manual-paste flow
  meta-proxy already implements (`--no-browser`: print an authorize URL with the
  `urn:ietf:wg:oauth:2.0:oob` redirect, prompt for a pasted code, exchange it via
  `/v1/oauth/code-exchange`) serves the same headless use case this ADR's "device authorization
  flow" row describes, and is what was ported. A true RFC 8628 device-code polling flow is not
  implemented and is not currently known to exist on the identity server.

`@claude-flow/security` is only an `optionalDependency` of the CLI — `ruflo auth` degrades to a
clear, specific error (not a raw `ERR_MODULE_NOT_FOUND`) when it's absent, via
`auth/security-bridge.ts`'s lazy-load wrapper.

### Addendum (2026-07-16) — demand-driven silent refresh is wired

`src/auth/client.ts::getValidAccessToken(profile)` is now the single consumer-facing token
accessor. It returns an in-process token only when more than 60 seconds of validity remain;
otherwise it loads the profile's refresh token from the OS keychain and performs exactly one
refresh. Cognitum rotates refresh tokens with reuse detection, so the returned refresh token is
written to the keychain **before** the new access token is placed in process memory or returned.
If that keychain write fails, the access token is not published and the spent refresh token is
not retried by this layer.

The accessor also enforces the scope-to-consent invariant before returning any token. Profiles
without a persisted refresh token fail with an explicit session-only/login-required error rather
than persisting token material elsewhere.

Refresh remains demand-driven, not timer-driven: plain `ruflo auth status` reads cached identity
metadata and performs no network request, preserving this ADR's offline behavior. `ruflo auth
status --check` is the first explicit consumer; it validates the selected profile(s), silently
refreshes when necessary, and reports only credential state (`valid`, `login-required`, or
`unavailable`) — never token material. Future authenticated Cognitum API calls must use this same
accessor rather than reading the keychain or session cache directly.
