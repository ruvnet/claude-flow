# ADR 490: A three-host e2e integration loop (Claude Code, Codex, OpenRouter)

Status: Accepted (implemented in `scripts/e2e/`; first run recorded in section 8)

Date: 2026-10-11

Builds on: ADR-404 (Claude Code mods), ADR-406 (no command removed or renamed), ADR-444, ADR-448 (live validation practice), ADR-451 (mod capability roadmap; item 7 canary).
Related: ADR-491 (mods host integration across Claude Code and Codex), ADR-489 (standalone TUI `Host` interface).

## 1. Context

ruflo is used from three hosts: Claude Code (mods, hooks, MCP), Codex (MCP, plugins, hooks, skills) and OpenRouter (the model behind
`agent_execute`, the console AI terminal and, as a provider, behind Codex itself). Until now each host had unit tests and per-feature live
scripts (`live-ruflo-mods-*.sh`, `live-ruflo-mods-compact.mjs`, `audit-codex-integration.mjs`, `smoke-agent-execute-providers.mjs`), but nothing
drove the three hosts the way a user does and failed when the pieces did not fit. Two defects found by the first run (section 8) had survived
every unit test, because each side of the seam was correct against its own mock.

## 2. Decision

Add one repeatable harness, `scripts/e2e/host-matrix.mjs`, that produces a **host x assertion matrix** against the real ruflo CLI, MCP server,
mods and plugins, with real hosts where a model is needed. Run it in two modes:

- **Keyless** (default; what CI runs): no model call, `$0`. Real CLI, real MCP stdio server, real `claude`/`codex` binaries for the parts that
  need no model (`mods doctor`, `codex plugin list`, `codex mcp list`), a local OpenAI-compatible stub for OpenRouter.
- **Live** (`RUFLO_E2E_LIVE=1` and `--live`; never in CI): the same assertions plus real sessions, capped by `--cap` (default 6 USD).

`npm run e2e` and `npm run e2e:live` wrap the two. The workflow `.github/workflows/e2e-host-matrix.yml` runs the keyless mode on PRs that touch
the harness or the MCP/Codex seam, weekly, and on demand.

## 3. Harness design

One file per leg (`leg-claude.mjs`, `leg-codex.mjs`, `leg-openrouter.mjs`), a shared `lib.mjs` (assertion recorder, redaction, sandbox, MCP stdio
client, OpenAI-compatible stub) and the orchestrator. Every row is `pass | fail | blocked | skipped | flaky | advisory` with captured, redacted
evidence; flaky and environment-dependent rows are marked, never hidden. Exit code 1 only on `fail`.

Isolation, per leg: a throwaway `HOME` (and `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, XDG dirs), a fresh git project, provider keys removed from the
inherited environment. The CLI under test is `npx ruflo@<version>` or, with `--cli-path`, a workspace build, so the same assertions run against the
published artifact (what users have) and against a branch (what is about to ship).

### 3.1 Claude Code leg

Keyless: `ruflo init`; lifecycle hooks registered; no hook command goes through `cmd /c` on this platform (#4045); `mods doctor` exits 0, reports
the mod enabled and the classic handshake, and says plainly that a headless `-p` run does not clone the marketplace; the generated PreToolUse(Bash)
command runs and exits 0 within its declared timeout and does not execute or redirect the hook's stdin JSON; the MCP server answers `tools/list`
(381 tools on 3.56.5), serves every capability it advertises, round-trips `memory_store` / `memory_search`, `task_create` / `task_list`, and
survives a prototype-named agent id in `task_assign` (#3967).

Live: headless `claude -p` (haiku) with `ruflo-mods` and `ruflo-console` loaded from the checkout through `--plugin-dir`, ruflo as the only MCP
server. Haiku calls the ruflo tools and finds the value; Claude Code ran the project hooks (`hook_started` / `hook_response` events); the plugins
are loaded; the cost-tracker ledger counts the session; `console_state` is model-safe (no ESC/OSC bytes, no other project's path, bounded);
`costHardStop` refuses a new subagent past the budget, **asserted on the `tool_result` text, not on the model's description of it**.

### 3.2 Codex leg

Pinned to Codex **0.162.0**: the 0.162.1 build crashes with a #GP (stack misalignment), so the leg calls the 0.162.0 binary by path
(`RUFLO_E2E_CODEX_BIN` overrides) and never reads `codex` from `PATH` or touches the install `current` links. If the pinned binary is absent the
leg is `blocked`, not skipped silently.

Keyless: `init --dual` on a fresh `CODEX_HOME` leaves `ruflo-core@ruflo` installed; Codex reads the Claude-format `.claude-plugin/marketplace.json`
(46 plugins listed) and installs `ruflo-swarm` from the checkout as a local marketplace; ruflo registers as an MCP server; the cost-tracker Codex
ledger tests pass (#4047/#4048); the generated `.codex/config.toml` is checked for permissive defaults (an advisory, section 8).

Live: Codex runs **with OpenRouter as its model provider** (`model_provider = "openrouter"`, Responses wire, model `openai/gpt-5.1-codex-mini`),
read-only sandbox, ruflo as an MCP server with `default_tools_approval_mode = "approve"` (exec otherwise declines every MCP call:
"approval policy is never"). Assertions: `mcp_tool_call` items to the ruflo server for `memory_store` and `memory_search*`, parsed from the event
stream (not words in the reply); the stored key is reported; command hooks fire (with `--dangerously-bypass-hook-trust`, in the throwaway home
only); the installed `ruflo-core` plugin hooks raise no hook error; the cost ledger counts the run under one owning session; and two **policy
probes** that make ADR-491's table evidence instead of documentation: a `UserPromptSubmit` hook's `additionalContext` reaches the model
(ruflo-mods route equivalent) and a `PreToolUse` hook's deny stops a shell call (ruflo-mods guard equivalent). A small model sometimes answers
without calling the tool, so the MCP and route probes get one retry and record the attempt count; a probe whose trigger never occurred is `flaky`.

### 3.3 OpenRouter leg

Keyless: `agent_spawn` + `agent_execute` through ruflo's own provider path (`RUFLO_PROVIDER=openrouter`, `OPENROUTER_BASE_URL` at a local stub): the
reply returns, the request is `POST /v1/chat/completions` with a bearer header, usage tokens surface, the key never appears in tool output, and a
provider 429 / 500 is reported as a failure (not a success) with the key absent. Live: the same path against openrouter.ai with a cheap model.
(`claude-sonnet-5`, the model name ruflo sends, is accepted by OpenRouter as an alias: checked, not a defect.)

## 4. Safety and spend

- Hard cap `--cap` (default 6 USD) summed across legs; each Claude session also has `--max-budget-usd`. Models: haiku; `gpt-5.1-codex-mini`
  (0.25 / 2.00 USD per million tokens); stub for the keyless OpenRouter leg.
- Read-only sandboxes for Codex, tools restricted by `--allowedTools` / `--disallowedTools` for Claude. No destructive action, no network except
  the providers (plus GitHub for `init --dual`'s marketplace clone).
- Spend accounting is conservative: Claude's `total_cost_usd`; for Codex-through-OpenRouter the larger of the key's usage delta and a
  token-based estimate. The key used in development is shared, so its delta includes other traffic: the figure is an **upper bound**.

## 5. Key handling

- `OPENROUTER_API_KEY` from the environment, else Secret Manager (`ruv-dev`, then `cognitum-20260110`) **only if `gcloud` is `ruv@ruv.net`**. It is
  read into this process's memory (never a file, never argv), passed to children by environment, and registered with the redactor.
- Every string that reaches a report passes `redact()`, which knows the loaded secret values plus token shapes (`sk-or-v1-`, `sk-ant-`, JWTs,
  Bearer values, `access_token` / `refresh_token` / `api_key` pairs). The JSON report is redacted before it is written.
- Claude: only the **access token** is copied into the throwaway config (no refresh token), mode 0600, removed with the sandbox.
- Codex: **the ChatGPT login is never copied.** A throwaway home that refreshed the refresh token would invalidate the real `~/.codex/auth.json`
  (the refresh token is single-use). Access-token-only copies fail with 401 because the id token expires first (observed: id token 3 days old,
  access token valid to 2026-10-18). The leg therefore authenticates Codex through OpenRouter. A ChatGPT-auth variant would need an explicit
  consent flag and a write-back protocol and is not built.

## 6. CI versus live

| | keyless (CI) | live |
|---|---|---|
| model calls | none | haiku, `gpt-5.1-codex-mini` |
| network | npm, GitHub (marketplace clone) | plus Anthropic, OpenRouter |
| trigger | PR touching `scripts/e2e/**`, the MCP bins, `mcp-server.ts`, the Codex package; weekly; dispatch | by hand: `RUFLO_E2E_LIVE=1 npm run e2e:live` |
| gate | `fail` rows fail the workflow | report only; a person reads it |

Unit tests for each defect the loop finds live with the code they cover (section 8).

## 7. Pass criteria

The loop is green when the matrix has no `fail` row. `blocked` (missing credential or pinned binary) and `flaky` rows must name their reason.
`advisory` rows record a posture question that needs a decision, not a defect. A defect found live is not closed by a harness change: it needs a
failing unit test, a fix, and the matrix row passing on the workspace build.

## 8. Results of the first run (2026-10-11)

Against the **published 3.56.5** (live, Claude + Codex): 33 pass, **2 fail**, 1 advisory, 1 skipped. Against the **workspace build with the fixes**
(all three legs, live): 46 pass, 0 fail, 1 advisory, 1 skipped. Recorded spend, upper bound: under 4 USD across all development runs, of the
6 USD cap.

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| 1 | **`ruflo mcp start` advertised `resources: { subscribe, listChanged }` and answered every `resources/*` with -32601.** Three independent stdio servers carry the same block (`bin/cli.js`, `bin/mcp-server.js`, `src/mcp-server.ts`). Codex offers `list_mcp_resources` for any server; with `gpt-5-mini` the model called it first, got "Method not found", and gave up before reaching the tools. | Unit tests failed first (3 + 2); e2e row failed on 3.56.5 and passes on the workspace build. | Fixed: capability is `resources: {}`; `resources/list` and `resources/templates/list` answer empty, `resources/read` answers -32002. Needs a cli release (`@claude-flow/cli`). |
| 2 | **`init --dual` on a fresh `CODEX_HOME` failed to install `ruflo-core@ruflo`.** `codex plugin marketplace add ruvnet/ruflo` is a git clone: 17.5 s measured alone; the 20 s `execSync` budget was exceeded under init's own load, the error was swallowed, and the user saw only "plugin `ruflo-core` was not found in marketplace `ruflo`". | Reproduced three times in sandboxes; later a quiet machine finished inside 20 s (so the row is timing-dependent, not deterministic). Unit tests failed first (2). | Fixed: 180 s clone budget, 60 s plugin-add, and the marketplace failure is named in the warning. `@claude-flow/codex` is bundled, so it ships with the train. |
| 3 | Advisory: `init --dual` writes a gitignored `.codex/config.toml` with `sandbox_mode = "danger-full-access"`, `approval_policy = "never"`, `web_search = "live"`, labelled "Development profile - more permissive". | Row `advisory`. | **Resolved in #4070**: the generated file is now `workspace-write` / `on-request` / `cached`; the permissive file needs `--codex-trust full` (or `RUFLO_CODEX_TRUST=full`), and an existing file is never rewritten. The harness row passes on a build with that change. |
| 4 | Not defects (checked): OpenRouter accepts the `claude-sonnet-5` name ruflo sends; `--no-codex-detect` gates only *auto*-detection, `--codex` / `--dual` configure Codex by design. | Direct calls; source read. | None. |

**Open, not understood.** On GitHub-hosted runners (and only there; it passed on three local setups, including an npm-global Codex under a trimmed
`PATH`) `init --dual` printed "Codex CLI not found" while a Node replay of the initializer's exact call (`execSync('which codex', { stdio: 'pipe' })`,
same env and cwd) found the binary. Five CI iterations narrowed it to *inside the ruflo process* (or its `npx @claude-flow/codex@latest` child, which
is what a fresh project runs when no initializer is installed) but did not find the cause. The matrix reports that row as `flaky` with the evidence
whenever this exact signature appears; it is never reported as a pass. Worth an issue of its own.

Also worth knowing: `init --dual` in a project without `@claude-flow/codex` runs `npx -y @claude-flow/codex@latest init`, i.e. the *published*
adapter (3.0.3 at the time of writing, with the 20 s budget), not the workspace source, so finding 2's fix reaches that path only once
`@claude-flow/codex` is republished.

Harness bugs found and fixed on the way (not ruflo bugs): the redactor's `sk-` pattern masked task ids (`task-...`) and its callback mis-printed
offsets; a `__proto__` assertion tested the wrong property (the pollution is covered by the unit test from #3967); a costHardStop assertion that
matched the model's prose would also pass on a hallucinated refusal and now reads the `tool_result`.

## 9. Not verified

- Windows and macOS (everything ran on Linux x86_64, Node 22, claude 2.1.289, codex 0.162.0).
- `PreCompact`, `SubagentStart`, `SubagentStop` under Codex: the events exist in the binary but `codex exec` cannot force a compaction or a
  subagent spawn (row `skipped`).
- A Codex run authenticated by ChatGPT; models other than haiku and the two named above; the desktop and terminal UIs.
- `init --dual`'s marketplace clone depends on GitHub and network speed; the fix removes the timing hazard, it cannot remove the network.
