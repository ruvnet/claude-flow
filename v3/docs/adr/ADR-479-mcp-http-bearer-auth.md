# ADR 479: MCP HTTP transport: bearer token, and refusal to serve a network without one

Status: Accepted

Date: 2026-10-07

Related: ADR-012 (MCP security features), ADR-476 (hive-mind gating, a separate layer on the same transport)

Numbering: ADR-478 is reserved for the console's What's new page. This ADR documents what #3598 and #3599 (merged as 42ce158f0, shipped in
3.55.0) built; it was written afterwards, from the code, because no ADR existed for them.

## 1. Context

`ruflo mcp start -t http` served every registered MCP tool (`memory_*`, `hooks_*`, `agentdb_*`, `hive-mind_*`, and the rest) to any client
that could reach its host and port, with no authentication, and it would bind any `--host`. `@claude-flow/mcp` has an authorization
mechanism for tool calls, but it is opt-in (`requireToolAuthorization`, `toolAuthorizer`) and the CLI never turned it on. The shape is the
one behind CVE-2026-81735 (an optional auth middleware never wired by the integrating CLI, plus a non-loopback bind). In
`@claude-flow/mcp` an enabled auth config with an empty token list also accepted any bearer value (fail open).

## 2. Decision

**Two controls, both in the places that already existed.** The CLI refuses a network-reachable bind that has no authentication. The
HTTP transport requires `Authorization: Bearer <token>` on every request when a token is configured.

### 2.1 The gate (CLI, before anything binds)

`startHttpServer()` in `v3/@claude-flow/cli/src/mcp-server.ts` evaluates `shouldRefuseUnauthenticatedHttp(host, env, authenticated)` before it
imports or binds anything. It refuses (the start throws, `mcp start` exits 1) exactly when

    host is not loopback  AND  no token is configured  AND  RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP is not set

- **Loopback** is exact-string: `localhost`, `127.0.0.1`, `::1`. Nothing is resolved. `0.0.0.0`, `[::1]`, `127.0.0.2`, `LOCALHOST` and every
  hostname or LAN address count as non-loopback, so a spelling nobody anticipated fails closed.
- `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP` is on for the values `1` and `true`, nothing else. It is the documented opt-out for a server behind
  a reverse proxy or a network boundary that enforces authentication itself.
- A loopback bind is never refused, with or without a token.

### 2.2 The token

Supplied three ways, in this precedence (`resolveMcpHttpAuthToken`): `--auth-token <value>`, then `--auth-token-file <path>`, then the
environment variable `RUFLO_MCP_HTTP_TOKEN`. An unset or empty variable means no token. Rules:

- 16 to 512 printable ASCII characters, no space (`[\x21-\x7e]`). A token that is set but malformed is an error, never "no token": the
  start fails with a message that does not echo the value, so a typo cannot start an unauthenticated server.
- A file is read as UTF-8 and one trailing newline is removed. An unreadable file is an error.
- `--auth-token` is visible in `ps` and shell history; the command's own help says to prefer the file or the variable. The `starting` event
  redacts it.
- Resolution runs before the transport is looked at, so a malformed `RUFLO_MCP_HTTP_TOKEN` also stops `mcp start` for the stdio transport. A
  valid token with stdio is ignored. With `-t websocket` a token is refused (`An MCP HTTP auth token is only supported with --transport
  http`): see 2.4.

### 2.3 What the transport enforces

`v3/@claude-flow/mcp/src/transport/http.ts`. With a token configured the CLI passes `auth: { enabled: true, method: 'token', tokens: [token] }`:

- A middleware, mounted after CORS and the rate limiter (so failed attempts are bounded: 120 per minute on `/rpc` and `/mcp` by default) and
  before the JSON body parser (so an unauthenticated client cannot make the server read a body), requires a valid bearer token on every
  route except `GET` or `HEAD` of `/health`. That covers `POST /rpc`, `GET` and `POST /mcp` (the SSE and legacy path) and `GET /info`.
- The comparison hashes both sides with SHA-256 and uses `timingSafeEqual`, with no early exit across the configured tokens.
- Every failure is the same response: HTTP 401, `WWW-Authenticate: Bearer`, body `{"jsonrpc":"2.0","id":null,"error":{"code":-32001,
  "message":"Unauthorized"}}`. The header and token are never logged.
- Fail closed: auth enabled with an empty token list accepts nothing (this was the fail-open fixed with this change).
- `GET /health` stays public and, when auth is on, answers only `{"status":"ok"}`: no timestamp, no connection count.
- The WebSocket endpoint on this transport (`/ws`) checks the token in its connection handler, from `Authorization: Bearer` or from a
  `?token=` query parameter, and closes the socket with 4001 (none) or 4003 (invalid). An HTTP upgrade does not pass through the middleware
  above, so this handler is the only check on that path.
- Tool calls reach the handler with `transport: 'http'` (or `'websocket'`), which is what ADR-476 uses to classify a caller as remote.

### 2.4 Behaviour matrix

`mcp start -t http`. Token set means a valid token from 2.2.

| host | token | `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP` | result |
|---|---|---|---|
| loopback | unset | any | starts; **unauthenticated**; the CLI prints a warning naming local processes and DNS rebinding |
| loopback | set | any | starts; bearer required on everything except `/health` |
| non-loopback | unset | unset | **refused**, exit 1, the error names the three ways out |
| non-loopback | unset | `1` or `true` | starts; unauthenticated; the CLI prints a warning |
| non-loopback | set | any | starts; bearer required (the opt-out does not weaken a token that is set) |

Other transports: `-t stdio` has no network surface and is not gated. `-t websocket` goes through the same refusal rule, but the CLI cannot
authenticate it (a token is refused, and the standalone websocket transport has no working token check), so a non-loopback websocket server
starts only with `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP`, and a loopback one is unauthenticated.

### 2.5 Environment and flags

| name | what it does |
|---|---|
| `RUFLO_MCP_HTTP_TOKEN` | the bearer token (2.2), lowest precedence |
| `--auth-token-file <path>` | read the token from a file; preferred over `--auth-token` |
| `--auth-token <value>` | the token as an argument (visible in argv) |
| `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP` | `1` or `true`: allow a non-loopback bind with no token |

## 3. Not closed (stated plainly)

- **Loopback with no token is unauthenticated.** Any local process, and any web page that can reach `127.0.0.1` from the person's browser,
  can call every tool. This is deliberate for the default (`localhost`), documented, and warned about at start; it is not fixed.
- **There is no `Host` allow-list.** Nothing in `@claude-flow/mcp` rejects a request by its `Host` header, so DNS rebinding is not blocked.
  By reasoning (not tested here), a rebound page is same-origin to the browser, so the CORS settings do not help. Set a token whenever the
  HTTP transport is used, loopback included.
- **A valid token grants every tool.** No ToolAuthorizer is wired, so there is no per-tool or per-caller authorization, no scopes, no
  identity beyond "holds the token". Only the hive-mind tools add their own check (ADR-476), and it is a different credential.
- **One static shared secret.** No rotation, expiry, revocation list, or per-client token; the configured token list has one entry.
- **No TLS.** The transport is Node's plain `http` server; `tlsEnabled`, `tlsCert` and `tlsKey` exist in the config types but nothing reads
  them. A bearer token on a non-loopback bind crosses the network in clear text unless a TLS-terminating proxy sits in front.
- **The WebSocket token can ride in the URL** (`?token=`), where proxies and access logs may record it. Use the header form where the client
  allows.
- **`/health` is public** by design (liveness only), and `GET /health` is the one request that works without the token.
- **The opt-out is a footgun by design.** `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1` on a reachable host is the pre-change behaviour; the
  only guard is the warning.

## 4. Consequences

- A deployment that bound a non-loopback host (Docker with `--host 0.0.0.0` is the usual one) stops starting until it sets
  `RUFLO_MCP_HTTP_TOKEN` and its clients send the header, or sets the opt-out. Loopback users are unaffected. This is listed under Breaking
  changes in the 3.55.0 changelog.
- The refusal is a pure function and the wiring is tested through the real `MCPServerManager.start()` with `@claude-flow/mcp` mocked, so
  deleting the `throw` fails the tests (`v3/@claude-flow/cli/__tests__/mcp-http-nonloopback-auth-gate.test.ts`). Transport enforcement is
  tested in `v3/@claude-flow/mcp/__tests__/http-transport-auth.test.ts`.
- Touches `@claude-flow/cli` and `@claude-flow/mcp` (bundled). Semver: minor.

## 5. Not done, and why

- **A `Host` allow-list**, and per-tool authorization, would close two of the gaps in section 3. Both are larger changes to
  `@claude-flow/mcp` than this one and were left for their own decision.
- **Defaulting a token on for loopback** was not done: it would break every existing local HTTP client at once.
