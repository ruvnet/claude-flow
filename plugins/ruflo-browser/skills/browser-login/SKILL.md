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
4. **Capture cookies** via `browser_eval`:
   ```javascript
   document.cookie  // returns the cookie string for the active document
   ```
   Or use the Playwright context API where exposed.
5. **AIDefence sanitize**:
   ```bash
   # Each cookie value passes aidefence_scan to flag raw secrets / high-entropy tokens.
   ```
   Tokens that look raw get vault-wrapped (an opaque handle) before AgentDB store; raw values never enter the namespace.
6. **Store in `browser-cookies`**:
   ```bash
   npx -y @claude-flow/cli@latest memory store --namespace browser-cookies \
     --key "<host>" \
     --value "{vault_handle:<opaque>, expiry:<iso>, aidefence_verdict:safe}"
   ```
7. **Return the vault handle** so downstream skills can mount it via the planned `browser_cookie_use` MCP tool.

## Caveats

- Never log raw cookie values, tokens, or passwords. The trajectory step for the auth POST records only the form field names and a `<redacted>` placeholder for values.
- The `browser_cookie_use` MCP tool is reserved (ADR-0001 §7) but not yet implemented. Until then, downstream skills mount the vaulted cookies via a helper bash function in `scripts/` (TBD).
- Some sites bind cookies to a UA fingerprint; if a vaulted cookie fails on reuse, re-run `browser-login`. Do not attempt to fingerprint-match yourself.
- This skill is **not** a credential storage solution. The vault-handle pattern protects against AgentDB leaks, not against compromise of the agent's environment.
