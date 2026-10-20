# ADR 476: Hive-Mind Gating That Does Not Break Local Users

Status: Accepted

Date: 2026 10 07

Related: #3338 (issue), #3339 (this PR), #3291 (join/leave/vote token), #3599 (HTTP MCP tool authorization)

## Context

`hive-mind_init` returned `hiveToken` to any caller, and `hive-mind_spawn`, `hive-mind_consensus` (`propose`), `hive-mind_broadcast`, `hive-mind_shutdown`, `hive-mind_memory` (`set`/`delete`) and `hive-mind_optimize-memory` required no credential. `spawn` appends to `state.workers`, which `vote` treats as the voting roster, so an unauthenticated caller could mint voters (the Sybil path #3291 meant to close). `state.json`, which holds the token, was written with default permissions.

Severity is medium. The exposure exists only when the MCP surface is reachable by someone who cannot already read the project directory, which in practice means the HTTP or WebSocket transport (tracked separately in #3599). A stdio MCP server and the CLI run as the user who owns the files.

The first version of the fix (round 1 and 2 of #3339) gated every tool on a token and made `hive-mind_init` demand a file-based `bootstrapSecret` as a tool argument. That closed the hole and broke existing users: an MCP-only stdio client could never init, spawn or join (it has no way to read the secret and init no longer returned the token), and `hive-mind-work.test.ts` failed.

## Decision

Authorize by caller class, taken from the server-built `context.transport`, never from a tool argument.

| Caller | How classified | Credential |
|---|---|---|
| In-process call (CLI subcommands, library, tests) | no `context` | none |
| stdio MCP server | `transport: 'stdio'` | none |
| `ruflo mcp exec` | `transport: 'cli'` | none |
| HTTP / WebSocket MCP | `transport: 'http' \| 'websocket'` | operator credential |
| A context that names no transport, or an unknown one | anything else | operator credential (fail closed) |
| Any caller with `RUFLO_HIVE_REQUIRE_AUTH=1` | env | operator credential |

The operator credential is, for every gated tool, `bootstrapSecret`; for every gated tool except `hive-mind_init`, the hive's `hiveToken` is accepted as well. `hive-mind_init` accepts only the secret, because it is the credential-issuance point.

Secret sources, in order: env `RUFLO_HIVE_BOOTSTRAP_SECRET` (at least 16 characters, otherwise ignored), then `.claude-flow/hive-mind/bootstrap.secret`. The file is created (0600, `wx`, never overwritten) by the first local `hive-mind init`, whether through the CLI or a stdio MCP client. A remote call never creates it.

Hardening that applies to everyone:

- No tool response, denial message or log line contains the token or the secret. `hive-mind_init` no longer returns `hiveToken`. Local clients do not need it.
- `state.json` is written 0600 through a same-directory temp file and `rename`, so it is atomic and never briefly world-readable. A pre-existing 0644 file is tightened on the next write. The hive directory is 0700.
- Comparison is constant time over SHA-256 digests, so supplied length is not observable.
- Gated tools: `init`, `join`, `leave`, `spawn`, `consensus` (`propose`, `vote`), `broadcast`, `shutdown`, `memory` (`set`, `delete`), `optimize-memory`.

### Behaviour matrix

| Caller | No credential | Wrong secret/token | Operator secret | hiveToken |
|---|---|---|---|---|
| Local (in-process, stdio, cli) | allowed | allowed | allowed | allowed |
| Remote (http, websocket, unknown) | refused | refused | allowed | allowed (not for `init`) |
| Remote, no secret configured on the server | refused | refused | refused | allowed (not for `init`) |
| Strict mode (`RUFLO_HIVE_REQUIRE_AUTH=1`), any transport | refused | refused | allowed | allowed (not for `init`) |

## Alternatives considered

- **Token and secret required for everyone, secret only in a file (the earlier PR).** Rejected: it breaks every MCP-only client and gives no gain against a caller who can read the file.
- **Keep returning `hiveToken` from `init` to local callers.** Rejected: the requirement is that a tool response never carries a credential, and local callers do not need one.
- **A legacy "ungated" flag for one release.** Not added. Local callers are not broken, so there is nothing to keep open for them. The only users who lose behaviour are remote HTTP callers who relied on the unauthenticated hole, and they must lose it. They have one step: set `RUFLO_HIVE_BOOTSTRAP_SECRET` on the server and send it as `bootstrapSecret`.
- **Trust HTTP on loopback.** Rejected: a browser or any local process can reach loopback, and #3599 owns HTTP authentication.

## Limits (stated plainly)

- For local callers this is not a security boundary. A prompt-injected agent in the same session can read `state.json` and `bootstrap.secret` from disk, and can call the stdio tools directly. The gate matters when the MCP surface is reachable by a caller that cannot read the project directory.
- If a stdio server is bridged to a network (a tunnel, `mcp-remote`, a shared ssh session), the bridge turns remote callers into "stdio" ones. Set `RUFLO_HIVE_REQUIRE_AUTH=1` on such servers.
- `hive-mind_status`, `hive-mind_memory` `get`/`list` and `hive-mind_consensus` `status` stay readable by any caller. They return no credential but do expose roster and shared-memory contents.
- The remote credential travels as a tool argument, so a remote agent that holds it can echo it. It is a bearer secret handed over out of band, not a per-caller identity.

## Enforcement

- `hive-mind-gate-matrix.test.ts`: caller x credential matrix for every gated tool, env override, short env secret, no-overwrite of an existing file, strict mode, constant-time digests, no token or secret in any response or console/stdout/stderr output, 0600/0700 permissions (POSIX), atomic write.
- `hive-mind-spawn-broadcast-shutdown-auth.test.ts` and `hive-mind-consensus-sybil-vote.test.ts`: the original denial assertions, now driven as a remote caller, with zero-state-change checks after a fresh reload.
- `hive-mind-gate-dispatch-contract.test.ts`: each dispatcher labels its transport, and the classifier never reads tool arguments.
- Mutation checks run on the core: always-local classification, skipped authorization, non-constant-time compare, 0644 modes, token in the `init` response, file-beats-env, no strict mode, token accepted by `init`, weak env secret. Each is caught by at least one test.

## Consequences

- Local users: no change, no extra step. `hive-mind init` now also writes `.claude-flow/hive-mind/bootstrap.secret`.
- MCP clients that read `hiveToken` from the `init` response get `undefined`. Over stdio they can omit it everywhere. Over HTTP they use the operator secret.
- Remote HTTP clients: refused until the operator sets `RUFLO_HIVE_BOOTSTRAP_SECRET` (or reads the file) and passes it as `bootstrapSecret`.
- `hive-mind_join` and `hive-mind_leave` no longer list `hiveToken` as required in their schemas.
- Semver: minor. The break is a security fix to a surface that was an unauthenticated hole.

## Update 2026-10-07: checked against the merged code; #3599 has landed

Read against `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (`classifyCaller`, `readBootstrapSecret`, `ensureBootstrapSecret`,
`authorizeHive`, `constantTimeEqual`, the eleven `authorizeHive(` call sites, the state write), `v3/@claude-flow/cli/src/mcp-server.ts`
(the transport labels at the two `callMCPTool` calls), `v3/@claude-flow/cli/src/commands/mcp.ts` and `v3/@claude-flow/cli/src/mcp-client.ts`.
The decision and the behaviour matrix hold. There is no drift in what is gated or who is exempt; these are details the text leaves out or
states slightly more strongly than the code.

**Confirmed, no drift**

- Classification is from the server-built `context` and never a tool argument: no context is local (in-process: the CLI, library,
  tests; `callMCPTool` passes `context` through untouched, so none means none); `transport` `stdio` and `cli` are local; `http`,
  `websocket`, an unknown string or a context without one are remote. The labels are set at `mcp-server.ts` (`stdio` for the stdio server,
  `http` or `websocket` for the port-bound transports) and `commands/mcp.ts` (`cli` for `mcp exec`). `RUFLO_HIVE_REQUIRE_AUTH` makes every
  caller remote only when it is exactly `1`.
- The eleven gated call sites are `spawn`, `init`, `join`, `leave`, `consensus` (`propose` and `vote`), `broadcast`, `shutdown`,
  `memory` (`set` and `delete`) and `optimize-memory`. `status`, `memory` `get`/`list` and `consensus` `status` are not gated, as the Limits say.
- `init` accepts only the operator secret (`allowToken: false`); the other ten accept the secret or the hive token. A local `init` creates
  `.claude-flow/hive-mind/bootstrap.secret` (`wx`, 0600); a remote one never does.
- Constant-time compare is over SHA-256 digests (`constantTimeEqual`); `state.json` is written 0600 through a temp file and rename; the
  hive directory is 0700.

**Where the text is looser than the code**

1. **A short env secret is ignored; a short file secret is not.** `RUFLO_HIVE_BOOTSTRAP_SECRET` must be at least 16 characters or it is
   skipped and the file is used. The file has no length floor: any non-empty content (after trimming) is the secret. A server with a valid
   env secret never creates the file.
2. **"Wrong secret/token: refused" means neither credential was valid.** `authorizeHive` tries the secret, then the hive token; a call that
   carries a wrong `bootstrapSecret` and a valid `hiveToken` is allowed (except for `init`).
3. **The denial text depends on what was sent.** Nothing supplied: `bootstrapSecret is required (...)` for `init`, `hiveToken is required
   (...)` for the others; something supplied: `Invalid bootstrapSecret` if a secret was sent, else `Invalid hiveToken`. Neither names a value.
4. **A remote server with no secret configured** (the third row of the matrix) can still be driven with a valid `hiveToken` for every
   gated tool except `init`, which can then never succeed remotely: only a local `init` creates the secret.

**Interaction with the HTTP bearer token (ADR-479, #3599).** The Related line says #3599 owns HTTP authentication, and it now does:
the HTTP transport can require `Authorization: Bearer <token>` and refuses a non-loopback bind without one. The two are separate layers and
neither satisfies the other. A request that passes the bearer check still arrives with `transport: 'http'` and is a remote caller here, so
hive-mind tools still need the operator secret or the hive token, on loopback as well (this ADR still rejects "trust HTTP on loopback").
Conversely, holding the hive credential authenticates nothing at the HTTP layer. An operator exposing the HTTP transport needs both
(`RUFLO_MCP_HTTP_TOKEN` for the transport, `RUFLO_HIVE_BOOTSTRAP_SECRET` for the hive tools).
