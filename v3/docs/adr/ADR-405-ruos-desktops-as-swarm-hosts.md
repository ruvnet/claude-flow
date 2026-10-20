# ADR 405: ruOS Desktops as Swarm Execution Hosts

Status: Proposed

Date: 2026 10 01

Related: ADR 150 (removable integrations), ADR 324 (policy chokepoint), ADR 325 (claims plane), ruOS ADR-043 (exec literal filter), ruOS ADR-045 (activity tee), ruOS ADR-053 (per-tenant SSH :2222), ruOS ADR-070 (the desktop executor has no peer authentication), ruOS ADR-071 (remote MCP endpoint and tokens), ruOS ADR-081 (`desktop_exec`), ruOS ADR-094 (frozen remote tool contract), ruOS ADR-105 (async jobs API, live since 2026-10-01)

## Context

ruOS gives each user their own cloud Linux desktops (Fly machines), plus enrolled Macs and PCs. A ruflo swarm can only place agents on the local machine today. Users with ruOS desktops want swarm agents to run there: the desktop has its own disk, toolchain, `claude` CLI and LLM route, and the user can watch it.

There are three ways into a ruOS desktop. They have different trust properties:

| Path | Authentication | Reachable from |
|---|---|---|
| ruOS fleet MCP / REST (`desktop_status`, `desktop_exec`, `desktop_start`, `desktop_stop`, `desktop_keepawake`, `llm_route_get`) | The caller's tenant token: a `ruos_mcp_` bearer or the `@cognitum/ruos` OAuth login. The fleet enforces machine ownership on every call. | **Anywhere.** This is the only path from outside a tenant. |
| sshd on `:2222` (ruOS ADR-053 Phase 2) | Pubkey-only, with a per-tenant ed25519 key minted by the fleet. `authorized_keys` is replaced with that tenant's key each time the desktop is armed. No API returns the private key to an external client. | **Only inside the tenant's Fly 6PN**, i.e. desktop to desktop |
| Desktop executor on `:17870` | None per tenant. It is guarded only by a spoofable `Host` header, binds all interfaces, and every tenant shares one flat Fly 6PN app (ruOS ADR-070). | Any machine on the 6PN |

## Decision

### Host model

A ruOS desktop is a remote execution host for one or more ruflo swarm agents. The `ruflo-ruos` plugin places an agent on a host, starts `claude -p` there as a detached job, streams its output back, and records the agent in ruflo's swarm state. The swarm topology, routing and coordination stay local. The desktop only runs the agent process.

### Transports

1. **External: the fleet MCP / REST only** (`fleet-mcp.mjs`). This covers discovery, start, stop, keepawake, the LLM-route check, and exec.
   - **Credentials.** `RUOS_MCP_URL` + `RUOS_MCP_TOKEN` from the environment, or the `@cognitum/ruos` credentials file (`~/.config/ruos/credentials.json`).
     - Never embedded, logged or echoed; error messages redact the token.
     - With neither present, every networked command exits 2 (`not-configured`) and sends no request.
   - **Token scope.** Exec, start, stop and keepawake need a `desktop:control` token. A read-only token degrades to discovery and status, and control calls fail with `insufficient-scope`. Users should mint a control token with the narrowest lifetime.
   - **Stateless.** Remote `/mcp` is stateless, so each call is a single `tools/call` with no handshake.
   - **Refusals.** The client refuses plain `http` (except localhost) and any URL on port 17870.
2. **In-tenant fan-out: SSH `:2222`** (`ssh.mjs`, opt-in with `--transport ssh` and `RUOS_SSH_KEY`).
   - It works only when ruflo itself runs on one of the tenant's ruOS desktops, reaching sibling desktops at `<fly-id>.vm.<app>.internal`.
   - Peers come from `~/.claude/federation/peers.json` or `GET /api/v1/cluster/peers` on that desktop.
   - `ssh` is spawned with a fixed argv and `shell: false`, with `BatchMode` and `IdentitiesOnly`.
   - `Permission denied (publickey)` maps to `auth-expired`, because arming is probabilistic per ruOS ADR-053.
   - It is never usable from a laptop or workstation.

The `:17870` executor is excluded. Any path that called it would extend ADR-070's cross-tenant shell exposure into ruflo swarms. The plugin opens no connection to that port and sends no `Host` header, and its smoke contract greps for any use of it.

### Jobs: a `JobTransport` with two implementations

The adapter drives a `JobTransport` (`jobs.mjs`) through `start`, `poll(offset)` and `cancel`:

- **`ExecPollTransport`** is available now. It uses `desktop_exec` (ruOS ADR-081), which is synchronous. Its timeout defaults to 30 s and is clamped to 1–300 s; the same timeout bounds the wait for the desktop's run lock, so exec calls on one desktop serialise. Each call is audited and owner-scoped.
  - **Launch.** The prompt is staged as base64 chunks into `~/.ruflo-ruos/runs/<runId>/`. HOME survives the 23:00 stop; `/tmp` does not. A detached `nohup setsid sh -c '<constant>'` runner then starts, and launch prints the prompt's sha256 and the runner's pid.
  - **Poll.** Each poll returns `RUOS_POLL:<exit>:<size>:<alive>:<base64 slice>`.
    - Only whole base64 quanta are decoded, so a truncated result never skips bytes.
    - The `alive` flag (`kill -0`) detects a runner killed before it wrote its exit code. The exit code is written atomically (`tmp` + `mv`).
    - The offset is tracked client-side.
- **`JobsApiTransport`** targets the ruOS async jobs API. That API is **live in production** since 2026-10-01 (ruos-desktop #380, fleet `64261be`, ruos-desktop ADR-105). `--jobs auto` (the default) feature-detects it with `GET /api/v1/desktop/jobs?machine=` and falls back to exec-poll.
  - **Auth.** A Bearer token with `desktop:control` scope: a control `ruos_mcp_` token or the OAuth access token.
  - **Create.** `POST /api/v1/desktop/jobs {machine, command, timeout_secs, idempotency_key}`.
    - `idempotency_key` is required; it is the run id.
    - A new job returns `202 {job_id, state}`.
    - Replaying the same key returns `200 {…, idempotent_replay: true}`; the adapter treats that as success and reuses `job_id`.
    - The same key with a different request returns `409`. That is a client bug, so it surfaces as `invalid-input` and is never retried.
    - The per-tenant cap of 4 returns `429`, with no server-side queue. That maps to `capacity`, and the adapter backs off 5 s, 10 s and 20 s, so the queueing happens in the swarm.
    - `timeout_secs` above 21 600 is clamped by the server; the client clamps too.
  - **Read.** `GET …/jobs/{id}?offset&max=65536&wait_ms=20000` returns `chunk` (base64), `next_offset`, `running`, `state`, `exit_code`, `truncated`, `desktop` (`up|asleep|unknown`), `stop_at` and more.
    - `running` stays true while the job is `queued`, meaning "keep polling".
    - `wait_ms` is a long-poll, so the adapter skips its own sleep, guarded against a server that answers instantly.
    - `503` means the desktop is up but the poll didn't answer; it is retried with 1 s, 2 s and 4 s backoff.
    - Polls do not take the desktop's run lock.
  - **Cancel and list.** `DELETE …/jobs/{id}` returns `200`, sends TERM, then KILL after 10 s. The job ends `cancelled` with `exit_code` 143 (SIGTERM) and keeps the output written before the cancel. The adapter keeps reading output for up to 15 s after a cancel, and reports `cancelled` as **stopped**, never failed. `GET …/jobs?machine=` lists jobs newest first.
  - **States.**
    - `exited` carries any exit code; only 0 counts as `completed`.
    - `failed` means the launch never reached the desktop, or the job's own timeout fired.
    - `stopped` is re-pollable after `desktop_start`, so it is surfaced as resumable `auto-stopped`.
    - `queued`, `running`, `cancelled` and `lost` are the others.
  - **Errors.** A `400` (e.g. targeting a Lite browser, which has no shell) maps to `invalid-input` and is never retried. A `404` means "not yours, or gone" and is never retried. 401 maps to `auth-expired`, 403 to `insufficient-scope`.
  - **Backends.** REST with the tenant token, or the local stdio `@cognitum/ruos` server's `desktop_job_start/poll/list/cancel`. Those tools are stdio-only; the hosted remote MCP is unchanged at 42 tools (ruOS ADR-094).
  - **Verification status:** ruOS validated the jobs API contract live (end-to-end by the ruOS lane, fleet `64261be`, Work Desktop):
    - POST returned 202 `queued`;
    - a replay returned 200 `idempotent_replay` with the same `job_id`;
    - the same key with a different command returned 409;
    - `wait_ms=5000` long-poll returned all output in order, then `exited` with exit 0;
    - `stop_at` was the next 23:00 ET;
    - an unknown id returned 404, and the list was newest first;
    - a Lite target returned 400;
    - DELETE returned 200, and the job ended `cancelled` with exit 143.

    ruflo's `JobsApiTransport` is **contract-tested against it, not called live by ruflo**. The mocks reproduce those exact codes and fields. ruflo made no live call: no control-scoped token was available, and a call would need separate spend approval.

Polling is adaptive: 1 s while output flows, backing off to 10 s when idle. Every exec poll is an audited call that waits behind the run lock. Jobs-API polls long-poll server-side instead.

### Command construction

Every shell string sent to a desktop comes from one audited module, `command-builder.mjs`. The same strings go over every transport.

- Each command is one line of at most 4000 bytes.
- The only variable regions are:
  - a run id: `r-` + 128 random bits in hex;
  - integers;
  - a model name from a fixed enum;
  - a canonicalised budget number;
  - base64 text inside single quotes.
- Prompt text travels only as base64 and reaches `claude -p` on stdin.
- No command contains push, deploy or destructive literals, so ruOS's `validate_run` filter (ADR-043) never misfires. That filter is a mistake guard, not a sandbox.

**Live finding:** `desktop_exec` stdout is framed. It begins with a `▶ run: <command>` echo and ends with `✓ SUCCESS…` and `📝 transcript:` trailers.

- The echo repeats the command, so markers are made echo-proof in three layers:
  - Every command gets a fresh 64-bit **nonce**, and each marker line is `RUOS<nonce>_NAME`.
  - The marker is printed as `printf 'RUOS%s_NAME' '<nonce>'`, so that token never appears contiguously in the command text or its echo.
  - Parsers accept only whole lines carrying that command's nonce. `normalizeExec` also strips the frame.
- A test replays the raw echo of commands that contain every marker name, and asserts that nothing matches.
- stdout is head-capped at about 4 KiB, including that echo (`… [output truncated]`), so a poll slice is 2 KiB raw.

### Swarm state, claims and audit

The plugin does not add a claims system or an agent store. ADR-325 already describes four disconnected claim mechanisms. This plugin uses ruflo's local work-ownership board, the `claims_*` MCP tools (`.claude-flow/claims/claims.json`), which is ADR-325's "work ownership" responsibility in single-node form.

| What | ruflo tool (called in-process via `callMCPTool`, so ADR-324 policy applies) |
|---|---|
| Register a remote agent | `agent_spawn` with `domain: "ruos"`, `config.host = {kind:"ruos", desktopId, desktopName, transport, jobs, runId, stopAt}` |
| Running / done | `agent_update` (`busy` → `idle`, `config.lastRemoteResult`) |
| Ownership of the run | `claims_claim` / `claims_release`, issue `ruos-run-<runId>`, claimant `agent:<agentId>:<agentType>` |

`stopAt` is the next forced 23:00 America/Toronto stop for cloud desktops. A scheduler can use it to avoid starting long jobs near the stop.

The plugin itself owns only `.claude-flow/ruos/`:

- `events.jsonl` holds lifecycle events: ids, sizes and states, never prompt or output text.
- `hosts.json` is a merged snapshot of hosts and their current agents.
- `audit.jsonl` holds one record per run: run id, job id, desktop, transport, the sha256 of the launched command, start, end, status, exit code and bytes. The detached process's output is not in the ruOS activity feed (ruOS ADR-045 tees only chat-proxy runs), so ruflo keeps its own record.
- `runs/<runId>.log` is a local copy of the output, mode 0600.

If the CLI cannot be resolved, or policy denies a call, the ledger degrades to the plugin files and reports `swarmLedger: "unavailable"`.

### LLM route

`claude -p` on the desktop uses the desktop's own Claude auth and LLM route. Before launch the adapter calls `llm_route_get`:

- **No usable route** (missing, `none`, `disabled` or `off`): the run fails fast with `llm-unconfigured`.
- **`{gateway: "unconfigured", key_present: false, route: "shared"}`:** this is only a warning. That exact shape was observed live on 2026-10-01, and `claude -p` succeeded with it (`RUFLO_RUOS_LIVE_OK 42`). The lead agreed on 2026-10-01 to treat it as a warning.

### Cost and auto-stop

- Starting a desktop is billable. The adapter starts one only with an explicit `--start`, and then waits for a fresh `last_heartbeat_at`, not `ready`.
- The fleet stops cloud desktops at 23:00 America/Toronto every weekday. `desktop_keepawake` blocks only idle autosleep. The adapter computes the next stop with `Intl` (DST-aware) and refuses a run whose timeout crosses it unless the user passes `--ignore-autostop`. At launch it holds keepawake for the timeout plus 5 minutes.
- A desktop stopped mid-run is reported as `auto-stopped` and treated as resumable. HOME persists, so after `desktop_start`, `attach --run <id>` re-reads the run directory from any offset.

### Deletion and deploy

- The swarm never issues `desktop_delete` or `secret_delete`; deletion stays a human action. The client refuses those names before any request, and a test asserts that no file in the plugin emits them.
- Deploy is **read-only**. After a run, `deploy-info` reports branch, HEAD, dirty count and commits ahead on the desktop. The hand-off is a branch or PR plus that summary, for a human to review, merge and deploy. ruflo-ruos never pushes, deploys or publishes, and there is no ruOS deploy tool to call.

### Removability (ADR-150 style)

- ruflo works identically when the plugin is absent. The PR changes no file under `v3/`, apart from this ADR.
- The plugin has no npm dependencies.
- The ruflo CLI is resolved at runtime and is optional.
- The `$.ruos` and `$.ruflo` Claude Code mod nouns are never required. `$.ruos.desktops()` makes no network calls and may be stale, so freshness always comes from `desktop_status`.
- **Mod part** (`hooks/register.ts`, `hooks/segment.ts`). This shipped after ruflo-mods landed `segment` in #3608 (ADR-404).
  - On `session.start`, on each `prompt.submit` and every 15 s, it reads only the plugin's own `hosts.json` and sets `$.ruflo.segment({ id: 'ruos', text })`, e.g. "ruOS 2 agents · Work Desktop", with `text: null` once no agent runs.
  - `claude plugin validate` allows only flat `$.noun.method(input)` calls and rejects feature detection, so the call sits in try/catch. Without the ruflo mod it rejects and nothing is drawn.
  - It makes no network calls, takes no `$.ruos` dependency and issues no destructive tool.
  - The `$.ruflo` type is vendored in `types/index.d.ts`, with a parity test against `plugins/ruflo-mods/types/index.d.ts`.
  - It is verified by `claude plugin validate` and by `claude plugin test`: 3 tests, using a stand-in `$.ruflo` noun, plus a run without it.
  - `$.ruos` (flat and read-only in `@cognitum/ruos@0.2.0`: `desktops()`, `lite()`, `lastAudit({n})`, `viewOpen({machine})`, `viewClose()`, `viewIsOpen()`) is not consumed yet. `/ruflo-ruos:view` delegates to `/ruos view` instead.

## Failure modes

Each failure surfaces as a typed `RuosError` code:

| Failure | Detection | Code |
|---|---|---|
| Credential expired or revoked | HTTP 401, or a tool error mentioning auth | `auth-expired` |
| Read-only token on a control tool | HTTP 403 or a scope error | `insufficient-scope` |
| Fleet unreachable | `fetch` network error | `network-down` |
| Request hangs | `AbortSignal.timeout` | `timeout` |
| Desktop stopped before the run | Heartbeat not fresh, and `--start` not given | `desktop-stopped` |
| Desktop stopped mid-run | Poll fails and `desktop_status` shows the desktop down, or the jobs API reports `stopped` | `auto-stopped` (resumable) |
| Run would cross the auto-stop | `checkWindow` (cloud desktops only) | `autostop-window` |
| Desktop not the caller's, or a Lite browser | Not in the hosted `desktop_status` list | `not-owned` |
| Job id belongs to another tenant, or is gone | Jobs API 404 | `not-owned` (no retry) |
| Tenant job concurrency cap | Jobs API 409/429 | `capacity`, after 3 backoffs |
| No LLM route on the desktop | `llm_route_get` | `llm-unconfigured` |
| Prompt corrupted in transit | sha256 mismatch | `remote-error` |
| `claude` missing on the desktop | `RUOS_NO_RUNNER` line | `remote-error` |
| Runner killed without an exit code | `alive=0` and no exit code, twice | `remote-error` |
| Run outlives its timeout | Wall-clock check; the job is cancelled | `timeout` |

On every failure the agent is set `idle`, the claim is released, and an audit record is written.

## Threat model

| Threat | Mitigation |
|---|---|
| Cross-tenant shell via `:17870` | Transport excluded. Smoke check. Client refuses the port. |
| Acting on another tenant's desktop or job | Ids resolve only against the caller's own `desktop_status`. The fleet re-checks ownership. A jobs-API 404 is never retried. |
| Shell injection from task text (including a prompt-injected agent writing the task) | Base64-only payloads. One builder. Tests run hostile prompts through a real `/bin/sh`, and also attempt to break out of the `sh -c '…'` quoting. |
| Injection via ids, model, budget, offset or repo path | Allow-list regexes. Canonical numbers. `..` and leading `-` refused. |
| Marker spoofing via the exec echo | Frame stripped. Whole-line marker matching. Tested with live-captured output. |
| Credential leakage | Token comes only from env or the credentials file. Never logged or written to events or audit. Redacted in errors. |
| Prompt or output leakage into shared state | Events and audit carry ids, hashes and sizes only. Output is kept in a 0600 local file and a 0700 remote run dir. |
| Accidental spend | No start without `--start`. Auto-stop window check. `--max-budget-usd` passes through to `claude -p`. Capacity backoff is bounded. |
| Destructive operations | Cancel and `desktop-stop` require `--confirm`. `desktop_delete` and `secret_delete` are never issued. Deploy is read-only. |
| Silent success (cognitum#620 pattern) | Every run needs a positive terminal state with an exit code. A lost runner, a missing run dir or a missing pid is an error. |
| SSH host-key trust | **Accepted risk:** `StrictHostKeyChecking=accept-new` is trust-on-first-use. This is acceptable only inside one tenant's 6PN, where the peer set comes from the fleet and the key is per-tenant. |

Residual risk: the remote `claude -p` runs with the desktop user's full trust. That is the user's own desktop, and its tool permissions are governed by its own Claude Code settings.

## Consequences

**Positive:**
- Swarm agents can run on the user's own ruOS desktops, visible in the swarm pane.
- No new trust path is added.
- One source of truth for swarm state.
- The jobs API slots in behind the same interface when it lands.

**Negative:**
- On the exec-poll fallback, streaming is poll-based over audited exec calls, with about 2 KiB per poll because of the head cap. The jobs API removes that limit, with 64 KiB chunks and long-polling.
- SSH works only desktop to desktop.

## Verification

- `bash plugins/ruflo-ruos/scripts/smoke.sh` runs the structural checks, the no-`:17870` grep, an offline exit-2 check, `tsc --checkJs`, and the full `node --test` suite.
- The suite includes:
  - London-school adapter tests;
  - transport failure typing;
  - jobs-API contract mocks: idempotency, 404, capacity, states;
  - injection tests through a real `/bin/sh`;
  - parsing of live-captured exec output;
  - the deletion-tool guard;
  - an integration test against the in-tree CLI's `agent_spawn` and `claims_*`.

**Live end-to-end, 2026-10-01**, on rUv's existing "Work Desktop" (approved, bounded):

- **Window:** `desktop_start` at 21:45:48Z, `desktop_stop` at 21:47:35Z. `desktop_status` then showed `state: stopped`, `heartbeat_status: asleep`.
- **LLM route:** `llm_route_get` returned `{route: "shared", gateway: "unconfigured", key_present: false}`.
- **Run:** the builder's launch steps started `claude -p --model haiku --max-budget-usd 0.10`.
  - The prompt's sha256 matched on the desktop.
  - The detached runner survived the exec returning (`alive=1`).
  - The second poll returned exit 0 with `RUFLO_RUOS_LIVE_OK 42`, about 11 s after launch.
- **Latency:** spacing between 9 back-to-back `desktop_exec` calls, measured on the desktop clock, had a median of 676 ms, p95 842 ms and minimum 174 ms. The whole batch of 10 calls took 9.45 s including session overhead.
- **Output cap:** about 4 KiB, including the echo.

Not verified live:
- SSH (6PN-only);
- the env-token terminal path;
- the jobs API: it is live in production but only contract-tested here (see above).
