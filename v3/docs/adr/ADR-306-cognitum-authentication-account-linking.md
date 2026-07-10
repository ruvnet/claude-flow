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
