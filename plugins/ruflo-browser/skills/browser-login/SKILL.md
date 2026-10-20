---
name: browser-login
description: Drive an authentication flow once, sanitize cookies through AIDefence, and vault a reusable cookie handle in browser-cookies for future sessions
argument-hint: "<login-url> [--vault-name <handle>] [--mfa]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__browser_open mcp__plugin_ruflo-core_ruflo__browser_close mcp__plugin_ruflo-core_ruflo__browser_fill mcp__plugin_ruflo-core_ruflo__browser_type mcp__plugin_ruflo-core_ruflo__browser_click mcp__plugin_ruflo-core_ruflo__browser_wait mcp__plugin_ruflo-core_ruflo__browser_eval mcp__plugin_ruflo-core_ruflo__browser_snapshot mcp__plugin_ruflo-core_ruflo__aidefence_scan mcp__plugin_ruflo-core_ruflo__aidefence_has_pii Bash Read Write
---

# Browser Login

Authenticate against a target site once, then vault the resulting session credentials so subsequent skills (`browser-extract`, `browser-form-fill`, `browser-test`) can reuse them without re-driving the auth flow. Borrows the pattern from Browserbase's `cookie-sync/SKILL.md` but stores the resulting context in AgentDB rather than on a hosted backend.

## When to use

- Establishing reusable auth for a host the agent will visit repeatedly.
- Refreshing a vaulted cookie set whose expiry has passed.
- Capturing an MFA-protected session that requires interactive completion.

## Steps

1. **Open a recorded session** via `browser-record`.
2. **Drive the auth flow** — fill credentials with `browser_fill` / `browser_type`. Credentials come from the user or environment; do **not** read them from `.env` or paste them into the trajectory args.
3. **Handle MFA** (when `--mfa`): pause for user input or invoke the user's TOTP helper; capture only the resulting redirect, not the code itself.
4. **Capture cookie metadata, not values.** Run `browser_eval` with an expression that returns only each cookie's name, value length and a Shannon-entropy estimate, for example `document.cookie.split('; ').map(c => { const [n, ...v] = c.split('='); return { name: n, length: v.join('=').length } })`. Never return `document.cookie` itself: tool output goes straight into the model's context, so the raw values would be exposed before any gate runs. `document.cookie` also cannot see `HttpOnly` cookies, which are usually the session cookie; if the session is `HttpOnly`, record that fact and rely on the browser profile staying alive rather than on a captured value.
5. **Classify** each cookie from the metadata in step 4 (name pattern, length, entropy). Anything that looks like a session or auth token is vault-wrapped (an opaque handle) before AgentDB store; raw values never enter the namespace or the model's context.
6. **Store in `browser-cookies`**:
   ```bash
   npx -y @claude-flow/cli@latest memory store --namespace browser-cookies \
     --key "<host>" \
     --value "{vault_handle:<opaque>, expiry:<iso>, aidefence_verdict:safe}"
   ```
7. **Return the vault handle.** Downstream skills look it up with `browser_cookie_use` (host in, handle record out).

## Caveats

- Never log raw cookie values, tokens, or passwords. The trajectory step for the auth POST records only the form field names and a `<redacted>` placeholder for values.
- `browser_cookie_use` is implemented, but it only returns the handle record (handle, expiry, AIDefence verdict) for a host. No tool injects a vaulted cookie into a live page, so a re-used login still needs a browser profile that already holds the session, or a fresh `browser-login`.
- Some sites bind cookies to a UA fingerprint; if a vaulted cookie fails on reuse, re-run `browser-login`. Do not attempt to fingerprint-match yourself.
- This skill is **not** a credential storage solution. The vault-handle pattern protects against AgentDB leaks, not against compromise of the agent's environment.
