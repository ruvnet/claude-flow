---
name: browser-auth-flow
description: Probe a site's authentication flow for redirect leaks, missing CSRF, weak session cookies, and OAuth misconfiguration; produces an auth findings.md
argument-hint: "<login-url> [--credentials <handle>] [--probes csrf,redirect,cookie,oauth]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__browser_open mcp__plugin_ruflo-core_ruflo__browser_close mcp__plugin_ruflo-core_ruflo__browser_fill mcp__plugin_ruflo-core_ruflo__browser_type mcp__plugin_ruflo-core_ruflo__browser_click mcp__plugin_ruflo-core_ruflo__browser_wait mcp__plugin_ruflo-core_ruflo__browser_eval mcp__plugin_ruflo-core_ruflo__browser_snapshot mcp__plugin_ruflo-core_ruflo__browser_get-url mcp__plugin_ruflo-core_ruflo__aidefence_has_pii mcp__plugin_ruflo-core_ruflo__aidefence_scan Bash Read Write
---

# Browser Auth Flow

Adversarial probe of a site's authentication. Drives the login flow once, records the trajectory, then runs a configurable set of probes against the captured artifacts and live page. Output is a structured `findings.md` inside the RVF container.

## When to use

- Pre-deployment audit of a new auth flow.
- Investigating a suspected token leak or redirect issue.
- Establishing a baseline for ongoing regression checks.

## Steps

1. **Open a recorded session** via `browser-record`.
2. **Drive the auth flow** as in `browser-login` (credentials come from `--credentials <handle>` referencing `browser-cookies` if the run is a re-auth probe).
3. **Run probes**:

   - **`csrf`**: inspect the login POST in the trajectory; verify a same-origin token field is present and non-empty.
   - **`redirect`**: watch `browser_get-url` after each nav for cross-origin redirects with auth state in the URL or fragment. Flag any token-bearing URL that crosses an origin boundary.
   - **`cookie`**: `document.cookie` exposes only name=value of non-`HttpOnly` cookies; it cannot show `Secure`, `SameSite` or expiry. Via `browser_eval`, return only each visible cookie's name, value length and entropy estimate (never the values themselves), and flag any session-looking name that is visible at all, because a visible cookie is by definition not `HttpOnly`. For `Secure`/`HttpOnly`/`SameSite`/expiry, read the `Set-Cookie` response headers (for example `curl -sS -D - -o /dev/null <login-url>` for pre-auth cookies); post-login attributes are not observable with these tools, so mark them `not-assessed` and ask for a HAR or devtools export instead of guessing.
   - **`oauth`**: if the flow involves a third-party provider, capture the authorization request, verify `state` and `nonce` are present and high-entropy, verify `redirect_uri` matches the registered callback domain.

4. **Quarantine** any token / credential / PII captured during probing — it stays inside the RVF container's findings, never returns to the model unredacted (`aidefence_is_safe` gate from `browser-extract` applies if you read the findings back).
5. **Write `findings.md`** with one section per probe, severity rating per finding, and a `verdict` (pass / warn / fail).
6. **Index** the session in `browser-sessions` with `tag: auth-probe` so future audits compare against it.

## Caveats

- **Authorization first.** Only probe a site you own or have written permission to test; state which in the report. The skill must refuse third-party production sites.

- This skill probes; it does not exploit. Do not chain follow-up requests using a captured token.
- Credentials must come from a vaulted handle or interactive entry. Never hardcode them in the field map.
- Some probes require multiple page loads. Trajectory step count for an auth probe typically lands at 15–40 steps; budget accordingly.
- The output is structured for human review. Do not auto-act on findings without surfacing them to the user first.
