# ADR-402: Host-Agnostic Agent Teams (Grok-first, Claude-portable)

**Status:** Proposed  
**Date:** 2026-07-20  
**Deciders:** Ruflo maintainers  
**Related:** ADR-018 (Claude Code integration), teammate-plugin, swarm-comms mailbox, RuvNet Brain grounding, `init --codex` pattern

---

## Context

Ruflo’s multi-agent “Agent Teams” UX on Claude Code depends on host features:

- Named agents + proprietary **`SendMessage`** mailbox
- Claude `Task` tool / TeammateTool (`@claude-flow/teammate-plugin`, `~/.claude/teams/`)
- Optional `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`

Grok Build already provides strong primitives that Claude Agent Teams lack or only partially have:

| Capability | Grok | Claude Agent Teams |
|------------|------|--------------------|
| Parallel children | `spawn_subagent` + background | Task / teammates |
| Isolation | **`isolation: worktree`** | Shared tree (race-prone) |
| Least privilege | `capability_mode` | Soft / prompt-level |
| Stage continuity | `resume_from` | Message-only handoff |
| Hooks | Claude-compat + SubagentStop | TeammateIdle / TaskCompleted |
| Skills | `.agents` + `.claude` discovery | Claude skills |

Today’s **teammate-plugin is Claude-bound** (peerDep on Claude Code, spawn returns `AgentInput` for Claude Task). A Grok-only prompt convention is not enough: teams, skills, and learning are product-critical and must work **better than Claude Code**.

Existing seed in-tree: `.claude/helpers/swarm-comms.sh` already implements a **filesystem mailbox** under `.claude-flow/swarm/mailbox/`.

## Decision

1. **Put the Agent Teams bus in Ruflo, not in the host.**  
   Comms are MCP + on-disk/AgentDB state. Hosts only execute spawns and run hooks.

2. **Ship `team_*` MCP tools** (host-agnostic contract):

   | Tool | Purpose |
   |------|---------|
   | `team_create` | Create team + topology + max members |
   | `team_spawn` | Register teammate; return **spawn plan** for the host |
   | `team_send` | Enqueue message to named agent (or `*`) |
   | `team_inbox` | Drain / peek mailbox for agent |
   | `team_broadcast` | Fan-out |
   | `team_plan` | Steps + dependencies (pipeline) |
   | `team_status` | Members, queues, plan progress |
   | `team_on_stop` | Idle-assign / train (hook entry) |
   | `team_shutdown` | Graceful teardown |

3. **Spawn plan contract** (host adapter):

```json
{
  "teamId": "team_…",
  "name": "architect",
  "role": "architect",
  "prompt": "…comms protocol embedded…",
  "host": {
    "grok": {
      "subagent_type": "general-purpose",
      "capability_mode": "read-only",
      "isolation": "none",
      "background": true
    },
    "claude": {
      "taskType": "system-architect",
      "note": "optional back-compat path"
    }
  },
  "next": ["developer"]
}
```

Grok lead calls `spawn_subagent` with the plan; it does **not** need `SendMessage`.

4. **Storage**

   - Team state: project-local `.claude-flow/teams/{teamId}/` (not `~/.claude/teams/`)
   - Mailbox: per team, `.claude-flow/teams/{teamId}/mailbox/{agent}/` (+ optional AgentDB namespace `team:{id}`). Not the shared `.claude-flow/swarm/mailbox/`: an agent name is only unique within its team.
   - Learning: existing `post-task` / memory_store patterns

5. **Grok defaults that beat Claude**

   - Write agents: `isolation: worktree`
   - Research/review: `read-only` / explore
   - Pipeline: short cycles + `team_on_stop` idle assign
   - Optional `resume_from` for stage continuity when mailbox payload is large

6. **Grounding (RuvNet Brain)** is in scope for the same host effort:  
   `search_ruvnet` (or forge-mcp) + intent/action policy so the model does not drift to training-prior infra.

7. **Product entry:** `npx ruflo init --grok` (later) mirrors `init --codex` — writes `.grok/config.toml`, rules, agents, MCP registration.

## Consequences

### Positive

- Same team semantics on Grok, Codex, Claude (Claude becomes one adapter).
- Worktree isolation reduces multi-agent file conflicts vs Claude shared-tree teams.
- Federation can later ride the same bus.
- Upstreamable: host-agnostic core can be proposed back to ruvnet/ruflo.

### Negative / costs

- Must implement and maintain `team_*` tools and adapters.
- Grok may not inject `UserPromptSubmit` stdout the way Claude injects `additionalContext` — route/brain hooks need file or MCP fallbacks.
- Skill/tool surface must be curated to avoid context drowning (300+ MCP tools + 100+ skills).

### Neutral

- teammate-plugin remains for native Claude TeammateTool users until migrated to the agnostic bus.
- CLAUDE.md Claude-specific examples stay valid for Claude hosts; Grok overlay (`.grok/rules/ruflo-grok.md`) takes precedence on Grok.

## Implementation plan (summary)

1. Phase 0: project `.grok/config.toml` + rules + MCP smoke — **done**.
2. Phase 1: mailbox-backed `team_create/send/inbox/status` MVP — **done** (CLI + MCP).
3. Phase 2: `team_spawn` spawn plans + Grok agent defs + SubagentStop → `team_on_stop` — **done**.
4. Phase 3: RuvNet Brain MCP + grounding rules — **done** (`KB_DIR` required).
5. Phase 4: `init --grok` — **done**. A host conformance bench is proposed separately.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Prompt-only “pretend SendMessage” | No durable bus, no idle assign, not better than Claude |
| Depend on Grok adding SendMessage | Speculative; bus should not be proprietary |
| Codex-style “single executor + swarm records only” | Fails requirement: agent teams + skills are critical |
| Fork forever without agnostic bus | Blocks upstream and multi-host |

## Amendment (2026-09-27) — Grok Build 1.0.41

Re-checked against `grok 1.0.41` and `~/.grok/docs/user-guide/` on that binary. The spawn example in the Decision section above matches Grok as of 2026-07-20. The live tool no longer matches it.

- `spawn_subagent` accepts `prompt`, `description`, `background`, `isolation`, and optionally `cwd`, `resume_from`, and `model`. It does not accept `subagent_type` or `capability_mode`. An omitted type is `general-purpose`. Capability is a property of the agent definition, which spawn cannot select.
- Nesting depth is 1. Only the lead calls `spawn_subagent`.
- Project `.grok/config.toml` contributes `[mcp_servers]`, `[plugins]`, `[permission]`, and `[mcp].max_output_bytes`. `[subagents]` in that file is ignored.
- `.grok/agents/*.md` are session profiles (`--agent-profile`, `/agents`).
- MCP tools are still reached through `search_tool` / `use_tool` (`ruflo__team_create`). `grok mcp add` still defaults to user scope; `--scope project` / `-s project` writes `./.grok/config.toml`.
- Folder trust (`/hooks-trust`, `grok --trust`) gates project MCP, hooks, skills, and rules together.

`team_spawn` now returns `host.grok.spawn` (the arguments to pass) and `host.grok.advisory` (role constraint, not a spawn argument). The prompt states the read-only or worktree constraint. `isolation: "worktree"` remains the enforced isolation knob. Operator steps and the re-check list live in `v3/@claude-flow/cli/templates/grok/docs/README.md` (copied to `docs/grok/README.md` by `init --grok`).

## Amendment (2026-09-28) — review of #3512

- One implementation: `templates/grok/scripts/grok-team-bus.mjs` is the store. The `team_*` MCP tools import it; `init --grok` copies it into a project as a CLI; the SubagentStop hook imports it. No repo-root copies.
- `team.json` writes take a cross-process lock (`team.lock`, an O_EXCL file with an owner token; a stale lock is broken by rename and token check, never by a blind delete) and go through temp file + rename. Mail is per team (`teams/{id}/mailbox/{agent}/`); a drain claims each file by rename, so concurrent drains are disjoint. Mailbox paths that are symlinks are refused.
- `team_shutdown` closes the team (spawn, send, plan, on-stop refuse); `team_spawn` enforces `maxAgents`; a broadcast with no members is refused; `priority` is an integer 0-999 in a zero-padded filename.
- The spawn description is `<role>:<agent>@<team>`; the SubagentStop hook parses it, and reports on stderr (exit 1) when a team subagent cannot be recorded or the team is ambiguous.
- `init --grok` writes only inside the project unless `--grok-statusline` is passed; then it installs `~/.grok/ruflo/host-statusline.mjs` and merges `[ui.status_line]` into `~/.grok/config.toml` with a TOML parser, or prints the snippet when it cannot merge safely. `--dry-run` lists what would be written. The project MCP entry is pinned to the running Ruflo version (the one that ships `team_*`), not `@latest`.

## Amendment (2026-09-28) — exec hosts: Codex and command hosts (#3513)

Builds on the store above; nothing here adds a second store. The `.mjs` store gains two optional inputs: `spawnMember` takes `hostPlans` (extra `host.<label>` entries, merged after `grok` and `claude`) and `model`, and `onStop` takes `outcome`, `runId` and `reason`.

### Host kinds

- A **native-spawn host** (Grok, Claude) spawns children itself; the store builds its plan entry, and its stop hook reports completion.
- An **exec host** is a CLI that runs one headless turn and exits. `ruflo team run` executes it, and process exit is the stop signal. Codex and every command host are exec hosts. Their adapters live in `cli/src/mcp-tools/team-hosts/` and implement `protocolLines`, `plan` and `stopIdentity`.

`team_spawn` takes optional `hosts: string[]` (default `[team.host, "claude"]`) and `model`. Exec labels get a `host.<label>` entry with its own `prompt`; when the team host is an exec host, the top-level `prompt` is that entry's. Built-in labels resolve first, then `.claude-flow/team-hosts.json`. An unknown label is an error. `team_create` checks its `host` the same way. `team_spawn` rejects unknown parameters (`task` suggests `prompt`).

### Command hosts

Any one-shot agent CLI can be a teammate, declared in `.claude-flow/team-hosts.json`:

```json
{ "hosts": { "myagent": {
    "kind": "exec", "command": "myagent", "args": ["run", "--message", "{prompt}"],
    "promptVia": "stdin", "passEnv": ["MYAGENT_HOME"], "isolation": "none"
} } }
```

- The label matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and cannot redeclare a built-in; `kind` is `exec`; unknown keys are rejected.
- The placeholders are `{prompt}`, `{team}`, `{agent}`, `{role}`, `{cwd}`, `{teamRoot}` and `{resultFile}`, and each fills a whole argv element. `promptVia: "arg"` needs exactly one `{prompt}`; `"stdin"` has none.
- `passEnv` holds variable names. Secret-looking names (key, token, secret, password, credential, auth, session, cookie, private) and `CLAUDE_FLOW_*` are rejected: a command host reads its own credentials.
- The runner never uses a shell.

### Trust model

`team-hosts.json` and `team.json` are part of the checkout, so anyone who can edit the checkout can edit them. Therefore:

1. **Run time never trusts `team.json`.** `ruflo team run` rebuilds the command from the host definition every time: the built-in adapter for Codex, or the validated `team-hosts.json` entry. The stored `exec` block is informational; when it differs, the run records the warning `storedPlanIgnored`.
2. **Command hosts need an explicit trust step.** `ruflo team trust-host <label>` records the project root, label and a SHA-256 of the validated entry in `~/.claude-flow/trusted-team-hosts.json` (outside any checkout; `RUFLO_TEAM_TRUST_FILE` overrides the path). `team run` refuses an untrusted entry, and editing the entry invalidates the record. `--dry-run` reports `trusted` and runs nothing. Trust is a CLI step only; there is no MCP tool for it.
3. **Shells and paths need more.** A command that is a shell or command wrapper (`sh`, `bash`, `zsh`, `cmd`, `powershell`, `pwsh`, `env`, `sudo`, `xargs`, a general-purpose interpreter like `node`/`python`/`perl`/`ruby`, …) or a path (`./x`, `/bin/x`, `C:\x`) is refused by `team_create`, `team_spawn` and `team run` unless the trust record was made with `--allow-unsafe-command`.
4. **Secrets stay out.** The child environment comes from `buildWorkerEnvironment` (`@claude-flow/codex`): secret-named variables and Ruflo identity/policy variables are stripped, via the same `isProtectedEnvName` deny policy (`@claude-flow/codex` `dual-mode/env-policy.ts`) the `passEnv` validation below consults — one source of truth for both, not two regexes that can drift (round-2 amendment below). `passEnv` re-adds names, but for a command host it can never re-add a secret-named or `CLAUDE_FLOW_*` name (validated at load, filtered again at run). The Codex adapter's own `passEnv` (`CODEX_HOME`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`) is fixed in code, not configurable.
5. **The bus is not authenticated.** It is a set of files in the project. `team_send`'s `from` is whatever the caller says, and `team_on_stop` / `ruflo team hook-stop` mark whichever agent is named. Anything that can write `.claude-flow/teams/` can do the same directly. Treat messages as untrusted input, and do not use the bus across trust boundaries.

### Runner

`ruflo team run --team T --agent A [--host <label>] [--timeout ms] [--max-output bytes] [--dry-run] [--json]`:

- **State checks.** Under the team lock it refuses a shut-down team or member, a member whose plan step is not the current one (or whose steps are all done), and an agent that is already `running` with a live runner (`runPid` on the same host). It then marks the member `running` with `runId`, `runPid`, `runHost`. A `running` record whose process is gone is replaced (`staleRunReplaced`). One run per agent at a time; parallelism is one `ruflo team run` per agent.
- **Messages.** Exec children may have no Ruflo MCP, so the runner drains this team's mailbox for the agent (`readInbox`, which archives) and puts the messages in a `=== Messages for you … ===` block before the task. When the run fails, they are queued again in the same team. `--dry-run` only peeks.
- **Process.** The child runs in its own process group (POSIX). A timeout or an interrupt (SIGINT/SIGTERM/SIGHUP to the runner) sends SIGTERM to the group, then SIGKILL after a grace period; on Windows `taskkill /T /F` ends the tree. The SIGKILL escalation runs to completion once armed, even if the group leader's `close` event resolves the run early (a descendant that trapped SIGTERM and detached its own stdio must still be killed — see the round-2 amendment below). The run returns only after the child has exited, so a retry never races it. The dual-mode orchestrator uses the same helper for `stopAll`. **Known limitation:** a `SIGKILL` of the *runner itself* cannot be caught by definition — the child it started is then orphaned, untracked, and any inbox messages already drained for that run are not delivered by this run and must be recovered with `ruflo team on-stop --outcome failed` (which requeues them the same way a normal failure does) once the stale claim is confirmed dead.
- **Output.** stdout and stderr are capped at `--max-output` (1 MB). A capped stream keeps its first 16 KB and its tail, so Codex's `thread.started` and `turn.completed` both survive, and it is decoded as UTF-8 once, at the end. `{resultFile}` is read up to the same cap and only if it is a regular file (a symlink is ignored).
- **Prompt in argv.** With `promptVia: "arg"` the full prompt, inbox included, is in the child's argv and visible to other local users in the process list; the run records `promptInArgv`. Prefer `stdin` when the CLI supports it (Codex does).
- **Outcome.** For `events: "codex-jsonl"`, `done` means exit 0 and no `turn.failed`; otherwise `done` means exit 0 and no timeout. The runner writes `.claude-flow/teams/T/runs/A-<runId>.json`, sends the final message (`type: "result"`, capped at 64 KB) to each `next` agent, or to `lead` when there is none or the run failed, and calls `onStop` with `outcome`, `runId` and `reason`. It exits with the child's code, 124 on timeout, 130 when interrupted.

`onStop` with `failed` marks the member and its current step `failed` and does not advance; a later `done` advances normally. A repeated `runId` for the same member is a no-op, so a hook and the runner reporting the same stop are safe.

`ruflo team hook-stop --host <id>` is the entry point for native stop hooks (Codex's `SubagentStop`). It reads the hook JSON on stdin until EOF (2 s for the first byte, 10 s overall), maps it through the adapter's `stopIdentity`, and resolves the team from the payload or the `@team` of a spawn description, then `TEAM_NAME`, then the only active team that lists the agent. An unparseable payload or an ambiguous team is reported on stderr and records nothing. It always exits 0.

The `team` command skips the CLI's update check, helper refresh and daemon autostart, because hooks and runners call it once per agent turn. `ruflo team <verb> --params '<json>'` calls the same handlers as the MCP tools.

### Codex host

The primary Codex path is `codex exec` through the runner (native Codex subagents are delegated by the model's prompt, not deterministically). Plan, from the codex-cli 0.157.1 flags:

- `exec --sandbox read-only|workspace-write [--worktree] --skip-git-repo-check --json -o {resultFile} -C {cwd} -c mcp_servers.{mcpServer}.env.CLAUDE_FLOW_CWD="{teamRoot}" [-m <model>] -`, prompt over stdin, stdin then closed. Never `--full-auto` or `--dangerously-bypass-*`.
- `{mcpServer}` resolves at run time to the first enabled `ruflo` or `claude-flow` in `codex mcp list --json`; without one the `-c` pair is dropped (`mcpServerNotFound`). Pinning `CLAUDE_FLOW_CWD` keeps a child in a worktree on the team's mailboxes.
- The thread id from `thread.started` is recorded on the member.

`init --codex` adds a Team Bus section to AGENTS.md, an `agent-teams` skill, and (unless `--no-team-hooks`) one `SubagentStop` entry in `.codex/hooks.json` running `npx --no-install ruflo team hook-stop --host codex`, which Codex asks the user to trust in `/hooks`. `runHeadlessProcess`, `killProcessTree` and `buildWorkerEnvironment` are exported from `@claude-flow/codex/dual-mode`; with an older `@claude-flow/codex`, `team run` says so and runs nothing.

## Amendment (2026-09-29) — round-2 review fixes (#3513)

A QE pass with live reproduction scripts (cross-checked by an independent review) found several gaps in the exec-host and command-host implementation above. All are fixed on this branch; each item names the file that changed.

- **One environment deny policy, not two.** `buildWorkerEnvironment` (`@claude-flow/codex` `dual-mode/process.ts`) and the `passEnv` validation for command hosts (`@claude-flow/cli` `team-hosts/command.ts`) used to keep separately maintained regexes for "secret-shaped" names. The base-environment strip's regex was the narrower one and did not generalize `CLAUDE_FLOW_*` (only three exact names), so a trusted command host's *base* environment — copied before `passEnv` is ever consulted — still leaked `PGPASSWORD`, `DATABASE_URL`, `SSH_AUTH_SOCK`, `GITHUB_PAT`, `MYSQL_PWD`, `SESSION_SECRET_X`, `MY_AUTH`, `SLACK_WEBHOOK_URL`, and every other `CLAUDE_FLOW_*` variable, regardless of what `passEnv` would have refused. Both call sites now import `isProtectedEnvName` from `@claude-flow/codex` `dual-mode/env-policy.ts` — the single source of truth — which also covers the previously-missed name shapes.
- **SIGKILL escalation now runs to completion.** `runHeadlessProcess`'s `settle()` used to clear every pending timer — including a just-armed SIGKILL escalation — as soon as the group *leader's* `close` event fired. A descendant that traps SIGTERM and detaches its own stdio (`exec >/dev/null 2>&1`) no longer holds the leader's pipes open, so `close` can fire (and resolve the run as timed out) well before that descendant is actually dead, leaving it to run to completion unkilled. The SIGKILL escalation is no longer cancellable by `settle()`: once armed, it fires after the grace period regardless of leader state.
- **Re-spawning a member mid-run no longer drops its concurrency claim.** `spawnMember` (`grok-team-bus.mjs`) used to overwrite a member's whole record, including `status`/`runId`/`runPid`/`runHost` set by a live `ruflo team run`. A re-spawn while a run was in flight silently reset the record to `"registered"`, letting a second `team run` start concurrently. Re-spawning now carries a live claim (`status: "running"` with a `runId`) forward. `onStop` also now validates the runId it is given against the member's *current* `runId` before releasing the claim — a stop report with no runId, or a stale one, is ignored rather than clobbering a concurrently-running claim.
- **The unsafe-command list covers general-purpose interpreters.** `trust.ts`'s `UNSAFE_COMMANDS` set (gating `--allow-unsafe-command`) did not include `node`, `python`/`python3`, `perl`, `ruby`, `npx`, `git`, `find`, and similar tools that can trivially run arbitrary code via a flag (`node -e`, `python -c`, …). They are now on the list alongside the existing shells and wrappers.
- **Look before you trust.** `ruflo team trust-host` used to persist the trust record before showing the resolved host entry (command, args, passEnv, isolation) to the operator. It now prints the resolved entry first and persists only after.
- **SIGHUP is forwarded like SIGINT/SIGTERM.** The runner used to forward only SIGINT and SIGTERM to the child's process group; a closed terminal or SSH session (SIGHUP) killed the runner while its detached child kept running, untracked, and any messages already drained from the inbox for that run were neither delivered nor requeued. SIGHUP is now forwarded the same way, which (because an aborted run already takes the "failed" outcome path) also makes the drained-but-undelivered messages requeue automatically.
- **The runs directory, result file and run file are exception-safe.** An exception while creating the runs directory, reading the result file, or writing the run file — all *after* the inbox has already been drained for the run — used to propagate uncaught, stranding the member `"running"` forever with its drained messages silently gone. That window is now wrapped: on any exception the drained messages are requeued (unless the normal failed-outcome path already did) and the run claim is released, unless `onStop` already settled the member's state.
- **The trust file takes a lock.** `recordTrust` did a read-modify-write of `~/.claude-flow/trusted-team-hosts.json` (temp file + rename) with no lock at all — reproduced as lost records under concurrent `trust-host` calls and a `--revoke` clobbered by a racing write. It now takes the same kind of cross-process lock `team.json` already used (`grok-team-store.mjs`'s `withTeamLock`), adapted for a single global file.
- **`.codex/hooks.json` refuses a symlinked `.codex` directory.** `mergeTeamStopHook` (`@claude-flow/codex` `initializer.ts`) gained the same symlink-on-path refusal the Grok-side init path already had.
- **`{resultFile}` reads are TOCTOU-safe.** `readResultFile` used to `lstat` the path and then `open` it as two separate syscalls, so the file could be swapped for a symlink in between. It now opens with `O_NOFOLLOW` and stats the already-open descriptor, so the symlink check and the read are atomic with respect to the path.

## References

- [RuvNet Brain](https://isovision.ai/ruvnet-brain/) — grounding at intent + action; `search_ruvnet`
- `v3/plugins/teammate-plugin` — Claude-bound prior art
- `.claude/helpers/swarm-comms.sh` — mailbox seed
- `v3/@claude-flow/cli/templates/grok/rules/ruflo-grok.md` — Grok host doctrine
- Grok user guide: MCP, hooks, subagents, skills, Claude compat
)
