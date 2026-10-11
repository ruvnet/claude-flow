# Changelog

All notable changes to the Ruflo project (formerly Claude Flow) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.56.5] - 2026-10-11

Patch release: one fix in `@claude-flow/cli`. No leaf package changed since 3.56.4 (`git diff v3.56.4..HEAD -- v3/@claude-flow` touches only `cli`; the `integration` change drops `publishConfig.tag` and has no runtime effect).

### Fixed

- The graph-edge-writer encryption-header sniff no longer closes the raw DB file descriptor, which dropped live SQLite POSIX locks; the header is read in a bounded child process (#4044, fixes #4040).

## [3.56.4] - 2026-10-10

Patch release: security hardening of the plugin-trust and helper paths, MCP/task fixes, and the Node 24 sqlite fix. Standalone leaves published first: `@claude-flow/memory` 3.0.4, `@claude-flow/integration` 3.0.1, `@claude-flow/plugins` 3.0.2, `@claude-flow/mcp` 3.1.1 (bundled; republished standalone), `@claude-flow/security` 3.0.4 (bundled; republished standalone). Then `@claude-flow/cli`, `claude-flow`, `ruflo` 3.56.4.

### Security

- Plugin registry trust: a placeholder (all-zero) trust anchor is a small-order Ed25519 key and no longer vouches for anything; signature verification uses strict (non-ZIP-215) rules; an unsigned registry no longer grants "official" trust (#3948).
- `plugins upgrade` no longer runs the new version's `postinstall` or registers `shell:exec` hooks without the install-time gate (#3951).
- Plugin and helper locators stop walking up at `node_modules`, so a project-local install cannot reach project `plugins/ruflo-*` code (#3986, replaces #3954).
- Helpers: session ids and session paths are validated, module roots are no longer project-chosen (#3949); the statusline no longer interpolates `HELPER_ROOT` into a shell string, and `npx` runs the helper CLI from the helper root (#3990, replaces #3953).
- User-level settings pin home helpers (#3952).
- `task_assign` rejects `__proto__` agent ids that wrote onto `Object.prototype` (#3967).

### Fixed

- Node 24: `better-sqlite3` is routed to a build that does not abort at exit (#3955).
- Importing the `agentic-flow` root entry no longer runs its CLI (#3958).
- MCP resource cache: stale writes are fenced after invalidation (#4019). `security scan` code patterns no longer report the false positives seen on a real tree (#3999).
- MCP, task and CLI fixes: #3975, #3974, #3970, #3969, #3968, #3980, #3947; graph path search ~94x faster at n=3200 (#3977).

## [3.56.3] - 2026-10-09

Patch release: AgentDB `3.0.0-alpha.20` update. `@claude-flow/memory` 3.0.3 (published standalone; the CLI pins it exactly) and `@claude-flow/cli` 3.56.3. `neural`, `shared` and `cli-core` are unchanged.

### Changed

- AgentDB floor raised from `^3.0.0-alpha.17` to `^3.0.0-alpha.20` (`memory`, `cli`, root, `ruflo`). alpha.20 swaps `@xenova/transformers` for `@huggingface/transformers`, `@ruvector/rvf` 0.1.9 -> 0.2.3 and `ruvector` -> 0.2.x. Semantic search scores shift slightly (same-text cosine ~0.992 against alpha.17 embeddings); an entry scored just under the 0.3 default threshold under alpha.17 can now appear just above it, ranked far below the exact-keyword hit.

### Fixed

- Dev tree only: `v3/package.json` gains a `pnpm.packageExtensions` entry declaring `onnxruntime-common` 1.24.3 for `@huggingface/transformers@4.2.0` (it imports it without declaring it, so pnpm's hoist gave it 1.14.0 and AgentDB silently fell back to mock embeddings in the pnpm workspace; npm installs were not affected).
- AgentDB alpha.20 refuses a sql.js save when the database changed under an open handle or when `<db>.agentdb.lock` exists, and a lock left by a crashed writer was never cleared, so every later save failed and the database file was never created. `@claude-flow/memory` now removes that lock only when it is provably stale (regular file named exactly `<db>.agentdb.lock`, numeric PID that is dead, older than 10 s, re-verified after an atomic rename-aside), retries once, and otherwise throws `AgentdbLockError`. A failed persist on shutdown is surfaced (`ControllerRegistry`, `AgentDBBackend`, `HybridBackend`, `shutdownBridge`), never swallowed. This only affects the sql.js path (no native better-sqlite3).

## [3.56.2] - 2026-10-09

Patch release: one bug fix in `@claude-flow/cli`. No leaf package changed since 3.56.1 (`git diff v3.56.1..HEAD -- v3/@claude-flow` touches only `cli`). The `ruflo-console` fixes merged since 3.56.1 (console 0.40.4-0.40.8, #3933, #3935, #3938, #3941, #3942) and `ruflo-swarm` 0.3.6 ship through the plugin marketplace, not this npm release.

### Fixed

- `task_update` accepts only the five task statuses; a task stored as `complete` is no longer shown as pending or re-dispatched (#3932, fixes #3931).

## [3.56.1] - 2026-10-08

Patch release: five bug fixes (four in `@claude-flow/cli`, one console). No leaf package changed since 3.56.0 (`git diff v3.56.0..HEAD -- v3/@claude-flow` touches only `cli`), and no behaviour is removed. The `ruflo-console` plugin fixes merged since 3.56.0 (console 0.40.2/0.40.3, #3917, #3924) ship through the plugin marketplace, not this npm release.

### Fixed

- The policy trust mirror and key now honour `HOME` and `XDG_CONFIG_HOME` instead of a fixed home directory, so a throwaway `HOME` no longer yields `policy-anchor-log-missing` (#3922, fixes #3919, reported by @HF-teamdev).
- `ensureSchemaColumns` rewrites the store only when a column was actually added; an up-to-date encrypted memory store is no longer rewritten by a read such as `memory stats` (#3923, fixes #3918, reported by @HF-teamdev).
- `config reset --section <name>` resets only that section and removes the matching flat overrides, preserving unrelated configuration (#3901, @rudycelekli).
- MCP config tools (`config_get/set/list/export/import/reset`) now work on the plain nested JSON document written by the `config` CLI command instead of assuming a `{values, scopes}` envelope; existing envelope stores keep their format (#3902, @rudycelekli). This does not change how the daemon reads `config.json` (see #3192, #3449, #3239).
- Console approvals badge counts only rows that have an approve or deny action (#3924, fixes #3920, reported by @HF-teamdev); delivered as `ruflo-console` 0.40.3 via the plugin marketplace.

## [3.56.0] - 2026-10-08

Minor release: a hardening and correctness batch from @rudycelekli, @nicholas-ruest, @martinvlad, @HF-teamdev, @drakeo338 and @stuinfla. Several fixes change behaviour on purpose (see Behaviour changes). Integrated by merging each PR head, so authorship is preserved.

### Behaviour changes

- **Unknown ids and value-less options are now errors (#3911, @martinvlad)** — `agent status` / `task status` with an unknown id print `not found` and exit 1; a declared string/number option with no value (`hooks route --task`) now reports `Option --task needs a value` instead of silently becoming `true`. Applies to every command.
- **`session_save` captures the persisted task/agent/memory stores by default, and `session_import` rejects malformed stores (#3489, #3490)**; explicit `false` still excludes a store.
- **Default project memory backup snapshots both `memory.db` and `agentdb-memory.db` (#3903)**; explicit `--db` and a non-blank `CLAUDE_FLOW_DB_PATH` still select one file.
- **Agent pool scale-to-zero is honored and invalid targets fail before writing (#3488)**; a zero fallback retry budget is honored (#3496).
- **Project path validators block sensitive directory names anywhere under the project root, not only at the leaf (#3504, `@claude-flow/security` 3.0.3)**.
- **The OAuth callback server retains an early callback and ignores unrelated requests (#3507, `@claude-flow/security` 3.0.3)**.
- **Provider selection honors an explicit execution provider (#3493) and Anthropic gateway credentials/endpoint (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`; #3494, fixes #3100)**; provider timeouts now cover reading the response body (#3495).
- **`hooks_route` consults persisted SONA outcome patterns before local routing (#3904)** — only a supported agent at confidence >= 0.6 is used; `useSemanticRouter: false` keeps keyword routing. **With the opt-in neural router, selection uses calibrated quality predictions (#3498)** so calibration can move the pick across the quality bar.
- **The WAL-sidecar safety gate is liveness-based (#3894, fixes #3161)** — leftover `-wal`/`-shm` files from a closed connection no longer block `memory store`/`list`; a genuinely open holder is still refused.
- **`ruflo init` no longer pins a Claude model in generated `.claude/settings.json` (#3528, fixes #3527)**.
- **The `ruflo` wrapper pins the matching `@claude-flow/cli` and warns when the resolved CLI version differs (#3438, fixes #3306)**; it warns and continues, it does not refuse.
- **Claims are stored in one lossless format shared by CLI and MCP; unreadable stores are refused rather than replaced (#3502)**.
- **Native immutable conditional append for `memory store` (`--append-only`, `--append-conditions`, `--require-native`, `--no-embedding`; #3750, @stuinfla)** — additive, CLI only.

### Fixed

- Shipped `.claude/settings.json` had unescaped quotes in hook commands and did not parse (#3895, fixes #3888, @nicholas-ruest); a new test checks that every shipped settings/plugin JSON parses.
- Remaining `better-sqlite3` opens go through the shared loader (#3896, fixes #3883's sites, @nicholas-ruest); an RFE1-encrypted store is reported as encrypted, not broken (#3906, fixes #2889, @nicholas-ruest); the demo-registry fallback is labelled as unverified (#3897, @martinvlad).
- `analyze` preserves machine-readable JSON (#3910); `doctor` rejects unsupported component selections (#3907) and loads MetaHarness modules via file URLs on Windows (#3523, fixes #3186); `daemon start` honors explicit scheduled workers (#3586).
- Unreadable task/agent records are preserved, not overwritten (#3484); async agent-registry updates do not revive retired agents (#3492); fallback learning is attributed to each attempted model (#3497).
- Workflow step boundaries are validated (#3491), persisted workflows resume without duplicate executors (#3500) and keep control signals and sibling state across awaits (#3505).
- Memory JSON import reports rejected writes accurately (#3499); export reads all pages only after successful reads (#3501); concurrent rotating-token refreshes coalesce (#3506).
- Test fixtures no longer break under pnpm's `NODE_PATH` (#3543, fixes #3529) and the vitest runner is resolved via `package.json`.
- `@claude-flow/memory` 3.0.2: cache admission accounts for replacement sizes (#3679, fixes #3678) and invalidation matches each key independently (#3687, fixes #3686).
- Removed an empty `.claude/agents/tmp.json` that shipped in the CLI tarball.

### Not included

#3503 (fail-closed policy envelope: it would deny MCP dispatch for any envelope with a ceiling because dispatch does not supply the metering), #3892, #3831, #3879, #3835, #3751, #3694, #3909 and the draft security PRs: see each PR for the status.

### Leaf packages published with this release

`@claude-flow/memory` 3.0.2, `@claude-flow/security` 3.0.3.

## [3.55.0] - 2026-10-07

Minor release. Contains a security behaviour change: `ruflo mcp start -t http` on a non-loopback host now refuses to start without a token (see Security and Breaking changes).

### Security

- **MCP HTTP transport: refuse unauthenticated non-loopback binds, optional bearer-token auth (#3598, #3599)** — `ruflo mcp start -t http --host 0.0.0.0` (or any non-loopback host) now exits 1 unless a token is set (`RUFLO_MCP_HTTP_TOKEN`, `--auth-token-file`, `--auth-token`) or the operator opts out with `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1`. With a token, `/rpc`, `/mcp` and `/info` need `Authorization: Bearer <token>` (constant-time compare); `/health` stays public and minimal. Also fixes a fail-open in `@claude-flow/mcp` where auth enabled with an empty token list accepted any bearer value. **Not closed:** loopback with no token is still unauthenticated (any local process can call every tool, and DNS rebinding is not blocked because there is no `Host` allow-list); set a token whenever the HTTP transport is used. A valid token grants every tool (no per-tool authorization).
- **Hive-mind gating that keeps local users working (ADR-476, #3338, #3339)** — `hive-mind_init` no longer returns `hiveToken`, and `spawn`, `consensus` `propose`, `broadcast`, `shutdown`, `memory` `set`/`delete` and `optimize-memory` (plus the existing `join`/`leave`/`vote`) now require an operator credential from **remote** callers (HTTP/WebSocket MCP). Local stdio MCP, `ruflo mcp exec`, the `hive-mind` CLI and in-process callers need no credential and no extra step. Remote clients set `RUFLO_HIVE_BOOTSTRAP_SECRET` (or read `.claude-flow/hive-mind/bootstrap.secret`, created 0600 by the first local `hive-mind init`) and send it as `bootstrapSecret`; `RUFLO_HIVE_REQUIRE_AUTH=1` applies the same rule to stdio on bridged servers. `state.json` is now written 0600 atomically and the hive directory 0700. Migration: clients that read `hiveToken` from the `init` response must drop that (it is `undefined`); over stdio they omit it everywhere. This is a speed bump, not a boundary, against a local prompt-injected agent that can read the files.
- **Policy ledger anchor can no longer be deleted and silently re-established (#3602, #3886, ADR-475)** — `policy verify` no longer trusts an anchor stored only in `state.json`. A second, hash-chained anchor log plus a mirror under `~/.config/ruflo/policy-trust/` now detect truncation, and `policy verify --establish-anchor` (interactive TTY only) is the logged repair path. Limit: this does not defend against an attacker who can rewrite both the project directory and `~/.config/ruflo`; stronger evidence needs an external witness. A pre-#3568 ledger with receipts and no anchor now fails policy transactions with `policy-ledger-anchor-missing` until repaired. Ships in `@claude-flow/security` 3.0.2.

### Fixed

- **Resilience batch (#3885; fixes #3676 #3674 #3668 #3670 #3682 #3672 #3593 #3592; thanks @rudycelekli)** — `@claude-flow/shared` 3.0.2: event-store pagination, bulkhead sync-throw handling, retry timeout cleanup, connection-pool reservation (also in `@claude-flow/mcp`); cli: production retry on non-Error rejections, worker-queue terminal outcomes and cancelled head, bounded worker pool with an already-aborted input.
- **`@claude-flow/memory` 3.0.1 — `mmrRerank()` caches embedding-cosine max-similarity across rounds (#3516, #3517)**.
- **`@claude-flow/swarm` 3.0.1** — Byzantine quorums now intersect for every cluster size (#3560, #3587, @rudycelekli); `spawnAgent()` auto-domain branch registers the agent in its pool (#3538, #3539); `MessageBus` is event-driven instead of a 10 ms unconditional poll (#3563).
- **`@claude-flow/plugin-agent-federation` 1.0.1** — outbound sends are authorized with the peer's current trust, not a stale snapshot (#3561, #3588, @rudycelekli).
- **CLI string options keep their declared value (#3594, #3601)**, **config cache is isolated per project directory (#3590, #3591)**, **nested config defaults are cloned (#3595, #3600)** — all @rudycelekli.
- **Hive consensus commands fail when the hive rejects the operation (#3609, #3654, @rudycelekli)**.
- **`daemon start --workers` selection reaches the WorkerDaemon (#3547, #3875)**.
- **Plugins run the installed ruflo CLI before `npx @claude-flow/cli@latest` (#3558, #3559, @HF-teamdev)** — ruflo-cost-tracker 0.27.2, ruflo-adr 0.5.4, ruflo-metaharness 0.2.4, ruflo-goals 0.4.3.
- **ruflo-adr edge keys use a separator the memory validator accepts (#3633, #3636, @drakeo338)**.
- ruflo-console 0.36.1: Settings lists Claude control and spending first (#3887).

### Breaking changes

- Binding the MCP HTTP transport off loopback (for example Docker with `--host 0.0.0.0`) now requires `RUFLO_MCP_HTTP_TOKEN` (and clients must send the header) or `RUFLO_MCP_ALLOW_UNAUTHENTICATED_HTTP=1`; otherwise `mcp start` exits with an error. Loopback users are unaffected.
- `hive-mind_init` no longer returns `hiveToken` (ADR-476).

### Leaf packages published with this release

`@claude-flow/shared` 3.0.2, `@claude-flow/memory` 3.0.1, `@claude-flow/swarm` 3.0.1, `@claude-flow/security` 3.0.2, `@claude-flow/mcp` 3.1.0, `@claude-flow/plugin-agent-federation` 1.0.1.

## [3.34.0] - 2026-07-31

### Added

- **AGNTCY/Outshift runtime integration (ADR-378/379/380)** — optional, removable augmentation per ADR-150's pattern; the kernel stays fully operational with these packages absent. `ruflo transport use slim`, `ruflo agent publish`, and `ruflo swarm join <namespace>` CLI verbs; CASA (Continuous Agentic Semantic Authorization) envelope schema, deterministic compiler, and deny-by-default enforcement gate with Ed25519-signed decision receipts (`.swarm/casa-receipts.jsonl`); AGNTCY OTel span attributes (`coordination.episode`, `authorization.decision`). All verbs exit 0 with a clear message when `RUFLO_AGNTCY_SLIM_ENDPOINT` is unset — no fake success paths. Companion Rust crate `v3/crates/ruflo-agntcy` mirrors the TS enforcement logic, with a real in-process `LocalTransport` and a `SlimTransport` stub behind a non-default `slim` Cargo feature. Companion package `@metaharness/agntcy` (build-time half — identity, OASF export, Directory publish, semantic observability) ships from the sibling `metaharness` repo. (`v3/@claude-flow/cli/src/commands/agntcy/`, `plugins/ruflo-agntcy/`, `v3/crates/ruflo-agntcy/`, `v3/docs/adr/ADR-378-*.md`, `ADR-379-*.md`, `ADR-380-*.md`)
- **npm Trusted Publishing (OIDC) release workflow (ADR-378)** — `.github/workflows/stable-npm-release.yml` publishes the three-package stable train (`@claude-flow/cli`, `claude-flow`, `ruflo`) from an immutable, tag-pinned checkout with a full test/build/pack/install smoke-test gate before any registry write, verifies published-package integrity against the locally-built archive, and rolls out `latest`/`alpha`/`v3alpha` dist-tags together. Manual `workflow_dispatch` only, gated to the `ruvnet` actor.
- Configurable statusline cost segment via two environment variables (defaults unchanged):
  - `RUFLO_STATUSLINE_COST_SYMBOL` — override the leading `$` (e.g. `⚡`, `€`, `🌱`); empty string shows the number alone.
  - `RUFLO_STATUSLINE_HIDE_COST` — `1`/`true`/`yes`/`on` hides the segment. `cost.total_cost_usd` is a client-side estimate that may differ from the actual bill and is misleading on subscription plans.

### Fixed

- **`@agntcy/slim-bindings` pinned to the confirmed-working alpha** — the SLIM maintainers moved off `uniffi-bindgen-react-native` (which shipped raw, uncompiled TypeScript incompatible with plain Node `require`/`import` — filed as agntcy/slim#1916, reproduced and confirmed) onto `@ubjs/core`/`@ubjs/node` in the `2.0.0-alpha.4+` dist-tag, not yet promoted to `latest`. `v3/@claude-flow/cli/package.json` now pins the exact working alpha version (deliberate exact-pin for a pre-release channel, not a caret range) rather than the still-broken `latest`; verified live end-to-end (server bring-up, client connect, graceful shutdown, zero `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `detectAgntcyRuntime()` required zero logic changes — its existing graceful-degradation design already returned `configured: true` once the upstream package resolved.
- **`security scan` failed open on unvalidated `--depth` / `--type` / `--target`** — an unrecognised `--type` matched none of the three phase guards, so no phase ran at all and the command still printed "No security issues found!" and exited 0; an unrecognised `--depth` fell through chained ternaries to the *shallowest* traversal (so `--depth full` scanned less than the default `standard`), which on a tree whose only HIGH finding sat below that budget also flipped the critical/high exit-code gate from 1 to 0; and a non-existent or non-directory `--target` read nothing, which the swallowed dir-read catches turned into a clean banner, exit 0, and a **persisted CLEAN report** that `getSecurityStatus` then surfaced as CLEAN. All three now fail closed before anything is scanned or written. Chained ternaries replaced with exhaustive `Record<ScanDepth, number>` maps behind real type predicates, and the recursion guard now positive-tests its budget so a bad value stops traversal instead of disabling the limiter. (`v3/@claude-flow/cli/src/commands/security.ts`)

### Changed

- **`security scan --depth full` is deprecated, not removed** — `full` was never a supported depth, but the CLI itself emitted it (statusline insight, announcement, the CLAUDE.md `init` generates, two shipped agent definitions). It is now normalised to `deep` with a warning rather than rejected, and those emitters have been updated to `--depth deep`. (`v3/@claude-flow/cli/src/funnel/insights.ts`, `funnel/messages.ts`, `commands/announcements.ts`, `init/claudemd-generator.ts`, `.claude/agents/v3/security-architect*.md`)

### Removed

- **`security scan --type container` is rejected instead of silently reporting clean** — it had been advertised in `--type`'s help since the command was written, but no phase ever implemented it, so it scanned nothing and printed a clean bill of health. It now exits 1 with an explicit "not implemented" message, and the help text no longer offers it. **Breaking** for any pipeline passing `--type container`, which previously exited 0. (`v3/@claude-flow/cli/src/commands/security.ts`)

## [3.32.10] - 2026-07-26

Bug-fix release closing the tracker-fire sweep from 2026-07-24 → 2026-07-26. All fixes are surgical and additive; no API surface change, no schema change, patch semver.

### Fixed

- **Statusline promo row blank on new installs** — restored the cold-start local seed pool that ADR-311 had emptied. The remote Cognitum-served pool (`funnel.ruv.io/v1/messages`) remains authoritative via `eligibleMessagesFromPools` (remote wins by `id`); the seed only renders during the ≤ 60s cold-start window before the first successful remote fetch lands. Nine seed messages ship: one disclosure, seven educational tips (all pointing at `cognitum.one` docs), one promotional. (`v3/@claude-flow/cli/src/funnel/messages.ts`)
- **#2777** — `ruflo init` no longer imports the entire ruvnet/ruflo repo (97 MB, 384 `SKILL.md`) into `.agents/skills/ruflo/`. Materialization now writes only the single platform `SKILL.md`, and the idempotency gate detects a "bloated" prior install (Cargo.toml/crates/ present or size > 1 MB) and wipes+re-materializes. (`v3/@claude-flow/cli/src/commands/init.ts`)
- **#2781** — `ruflo-adr adr-index` no longer silently drops ADR data: status regex accepts the `- **Status**: proposed` form `adr-create` emits, single-line and wrapped relation lines parse fully, and `CLI_CORE=1` no longer forks writes into an alternate store the default reader can't see (warns and unifies on `@claude-flow/cli@latest`). Dry-run over the repo's 531 ADRs now captures 608 edges cleanly. (`plugins/ruflo-adr/scripts/lib/parse-adrs.mjs`, `import.mjs`, `reindex.mjs`)
- **#2770** — Windows: `browser-session` MCP tools and two init-flow `execFileSync('npx', …)` sites now set `shell: process.platform === 'win32'` so cmd.exe can resolve `npx.cmd`. POSIX behavior unchanged. Each site carries a shell-injection note for future editors. (`v3/@claude-flow/cli/src/mcp-tools/browser-tools.ts`, `v3/@claude-flow/cli/src/commands/init.ts`)
- **#2782** — `WorkerDaemon.saveState()`, `autopilot-state.saveState()`, and `autopilot-state.appendLog()` no longer race on a shared `.tmp` filename under in-process concurrent workers. All three sites now call the existing `writeFileAtomic` helper (pid + timestamp + random-suffixed temp) so concurrent callers cannot collide; each write is wrapped in try/catch so a losing racer can't crash the daemon. (`v3/@claude-flow/cli/src/services/worker-daemon.ts`, `v3/@claude-flow/cli/src/autopilot-state.ts`)
- **#2785** — `ruflo hooks post-task` now accepts `--task` (short `-t`) and `--store-results` flags, matching the CLAUDE.md-documented usage. Routing outcomes finally persist to the namespace `hooks_metrics` reads, so the "Pattern Learning" / "Agent Routing" numbers become non-zero. (`v3/@claude-flow/cli/src/commands/hooks.ts`)
- **#2786** — AgentDB no longer silently fails to initialize when `CLAUDE_FLOW_ENCRYPT_AT_REST=1` is set. Added `getAgentDbPath()` which returns the same directory as `getDbPath()` but with basename `agentdb-memory.db`, so the ControllerRegistry (native better-sqlite3) opens a distinct file from the sql.js CRUD writer's `memory.db` (which stays encrypted). `learningSystem`/`reasoningBank` populate correctly with encryption enabled. (`v3/@claude-flow/cli/src/memory/memory-bridge.ts`)
- **#2776** — Statusline security segment: `STALE` and `IN_PROGRESS` states are now reachable via a local overlay (`getLocalSecurity`) that recomputes freshness on every render from `.claude/security-scans/scan-*.json`. Configurable via `RUFLO_SCAN_STALE_HOURS` (default 24) and `RUFLO_SCAN_PENDING_CAP_MIN` (default 30); STALE renders dim gray so it stops shouting for attention once escalated. (`.claude/helpers/statusline.cjs`)
- **#2775** — Memory store to an existing key no longer dead-ends: `bridgeStoreEntry` uses `INSERT ... ON CONFLICT` with tombstone auto-resurrect; UNIQUE returns a typed error instead of `null` (no more misleading demotion into the #2735 guard); `bridgeDeleteEntry` runs `wal_checkpoint(PASSIVE)`; CLI `memory store --upsert` default now applies at the parser layer (root cause: `parser.ts:applyDefaults` only walked `globalOptions`); the `memory_store` MCP tool schema defaults `upsert: true` for CLI parity. (`v3/@claude-flow/cli/src/memory/memory-bridge.ts`, `commands/memory.ts`, `parser.ts`, `mcp-tools/memory-tools.ts`)

### Investigated

- **#2774** — Reporter's diagnosis "Codex MCP generator registers management CLI instead of stdio server" appears incorrect: `ruflo mcp start` IS a working stdio server per `v3/@claude-flow/cli/src/commands/mcp.ts` (`MCP Server started on stdio`), and upstream `d20f1323b fix(codex): ship stable Windows-safe Ruflo integration` cleanly centralized the Codex MCP config in `mcp-config.ts` using the same command shape. A proposed swap to `claude-flow-mcp` was reverted during rebase. Recommend closing the issue unless the reporter can produce a fresh repro against 3.32.9+.

## [3.5.0] - 2026-02-27

### Ruflo v3.5 — First Major Stable Release

This release marks the official rebranding from **Claude Flow** to **Ruflo** and represents the first major stable release after 5,800+ commits, 55 alpha iterations, and 10 months of development.

### Highlights

- **Rebranding**: Claude Flow → Ruflo across all packages (`@claude-flow/cli`, `claude-flow`, `ruflo`)
- **agentic-flow v3.0.0-alpha.1 Integration**: Full deep integration with 10 subpath exports (ReasoningBank, Router, Orchestration, Agent Booster, SDK, Security, QUIC transport)
- **AgentDB v3.0.0-alpha.9**: 8 new controllers (HierarchicalMemory, MemoryConsolidation, SemanticRouter, GNNService, RVFOptimizer, MutationGuard, AttestationLog, GuardedVectorBackend) + 6 MCP tools
- **215 MCP Tools**: Full Model Context Protocol server with vector memory, neural training, swarm coordination
- **Security Hardening**: Command injection fix, TOCTOU race fix, eliminated hardcoded HMAC keys, timing attack fixes
- **Doctor Health Check**: New `agentic-flow` diagnostic (filesystem-based, ESM-compatible)
- **0 Production Vulnerabilities**: Clean `npm audit` across all packages

### Added

- `agentic-flow-bridge.ts` — Unified lazy-loading bridge for all agentic-flow v3 modules
- Tiered embedding resolution: ReasoningBank WASM (Tier 1) → @claude-flow/embeddings (Tier 2) → mock fallback (Tier 3)
- Agent Booster local import with npx fallback
- `checkAgenticFlow()` doctor health check
- 7 TypeScript module declarations for agentic-flow subpath exports
- ADR-056: agentic-flow v3 Integration Architecture

### Fixed

- Command injection vulnerability in enhanced-model-router.ts (SAFE_LANGUAGES whitelist)
- TOCTOU race condition in bridge singleton initialization (Promise-based caching)
- 22 agent/skill files updated from stale v1.5.11/v2.0.0-alpha to v3.0.0-alpha.1
- ESM compatibility for doctor checks (filesystem-based instead of `require.resolve`)
- @ruvector/gnn pinned to 0.1.25 to fix fatal process crash (issue #216)

### Changed

- All 3 packages bumped from `3.1.0-alpha.55` to `3.5.0`
- Publish tags changed from `alpha`/`v3alpha` to `latest`
- agentic-flow minimum version: `0.1.0` → `3.0.0-alpha.1`
- agentdb minimum version: `2.0.0-alpha.3.4` → `3.0.0-alpha.10`

---

## [3.1.0-alpha.55] - 2026-02-27

### AgentDB 3.0.0-alpha.9 Integration (ADR-053/ADR-055)

- Activated 8 AgentDB v3 controllers with MutationGuard proof engine
- Added 6 new MCP tools: `agentdb_hierarchical_*`, `agentdb_consolidation_*`, `agentdb_semantic_*`
- Fixed controller registry activation bugs (ADR-055)
- Statusline fixes for real-time controller status
- Pinned @ruvector/gnn@0.1.25 to fix fatal process crash

## [3.1.0-alpha.43] - 2026-02-15

### Ruflo Branding Fix

- Fixed CLI branding: show 'ruflo' instead of 'claude-flow' when run via `npx ruflo`
- Fixed Windows ESM import crash with `pathToFileURL`
- Fixed init hook prompt overflow and description field

## [3.1.0-alpha.36] - 2026-02-10

### Stability & Compatibility

- Fixed hooks backward compatibility: `--success` and `--file` made optional
- Fixed Windows npm install crash (404 optional dependencies)
- Bumped agentdb to 2.0.0-alpha.3.6
- Fixed V3 build errors (missing helmet, VERSION type, vitest spy)

## [3.1.0-alpha.29] - 2026-02-01

### Security & Agent Teams

- Security fixes, backward compatibility, and Agent Teams hooks
- Added `--settings` flag to upgrade command for Agent Teams
- Fixed npm 11 install crash by pinning agentdb

---

## v3.0.0-alpha Series (2025-10 to 2026-02)

### v3.0.0-alpha.184 — CLI Help & Categorization (2025-12)

- Fixed CLI help categorization across 26 commands
- Published install optimizations
- curl-style installer script
- SEO-optimized npm packages for discovery

### v3.0.0-alpha.170 — Plugins & Marketplace (2025-12)

- **Plugin Marketplace**: 8 official plugins + IPFS registry via Pinata
- **Gas Town Bridge Plugin**: WASM-accelerated orchestrator integration
- **10 RuVector WASM Plugins**: 50 MCP tools for neural computation
- **@claude-flow/teammate-plugin**: MCP tools for Agent Teams coordination

### v3.0.0-alpha.150 — SONA & SemanticRouter (2025-11)

- **SemanticRouter**: SONA WASM integration with verified benchmarks
- Fixed phantom Claude popups on Windows
- Fixed statusline safe multi-line output for Claude Desktop
- Fixed MCP tool naming (`/` → `_`) for Claude Desktop compatibility
- Memory namespace support in delete command

### v3.0.0-alpha.100 — @claude-flow/guidance (2025-11)

- **@claude-flow/guidance Control Plane**: Governance, compliance, and policy enforcement
- Wave 1: Proof, gateway, memory-gate, coherence, hooks, persistence primitives
- Wave 2: Conformance kit, capability algebra, evolution pipeline, artifact ledger
- Wave 3: Civilization-grade primitives (trust, truth, uncertainty, time, authority)
- **Rust WASM Policy Kernel**: SIMD128-accelerated policy evaluation
- **ContinueGate**: Safety gate for agent continuation decisions
- 22-benchmark suite with before/after performance reporting
- CLAUDE.md generators, analyzer, and auto-optimizer
- Content-aware executor with statistical validation (Spearman ρ, Cohen's d)

### v3.0.0-alpha.50 — Core V3 Implementation (2025-10)

- Complete V3 implementation across all ADRs
- ADR-003: Coordinator consolidation + security tests
- Complete hooks system with AgentDB, HNSW, tests
- ReasoningBank guidance system with CLI
- V2→V3 migration documentation
- MCP memory tools upgraded to sql.js + HNSW backend
- Claims-based authorization (ADR-016)
- Node.js worker daemon system
- Auto-update system for @claude-flow packages (ADR-025)
- Replaced all mock implementations with real functionality

### v3.0.0-alpha.1 — Foundation (2025-10)

- Complete V3 monorepo structure (`@claude-flow/cli`, `shared`, `memory`, `hooks`, `security`)
- 26 CLI commands with 140+ subcommands
- 215 MCP tools via FastMCP 3.x
- RuVector intelligence system (SONA, MoE, HNSW, EWC++, Flash Attention)
- Hive-Mind consensus (Byzantine, Raft, Gossip, CRDT, Quorum)
- 17 hooks + 12 background workers
- 60+ specialized agent types
- Cross-platform helper system

---

## v2.7.x Series (2025-08 to 2025-10)

### v2.7.34 — PostgreSQL & Neural Persistence

- PostgreSQL Bridge with attention, GNN, hyperbolic embeddings
- Neural pattern persistence to disk
- Hive-mind `--claude` flag for spawn command
- Real statusline data, hive-mind shutdown fixes, daemon persistence
- Multi-platform builds (Linux, macOS, Windows) in CI/CD

### v2.7.0 — agentic-flow Integration

- Deep integration with agentic-flow coordination engine
- SDK architecture analysis and hooks & learning integration
- Modular installation strategy
- Optimized v3 migration plan

---

## v2.0.0-alpha Series (2025-05 to 2025-08)

### v2.0.0-alpha.128 — Maturity

- Comprehensive hive-mind optimization
- Database schema robustness (missing columns, optimization errors)
- Auto-rebuild better-sqlite3 on NODE_MODULE_VERSION mismatch
- InMemoryStore interval cleanup for clean process exit

### v2.0.0-alpha.53 — Hook Safety

- Critical hook safety system
- Hive-mind optimization command
- Safety & security features documentation
- Neural Link System with safety protocols

### v2.0.0-alpha.33 — Windows & WSL

- Windows/WSL compatibility fixes
- Module import error resolution
- README restructure for v2.0.0 features
- Comprehensive test suite

---

## v1.x Series (2025-01 to 2025-05)

### v1.0.71 — Final v1 Release

- npm publishing compatibility
- Full CLI command functionality
- SPARC integration with full prompt loading
- Cross-platform support

### v1.0.50 — Swarm & SPARC

- Parallel execution for swarm tasks
- Background task management
- Swarm command with improved error handling
- Claude Code slash commands integration

### v1.0.28 — Project Management

- CLI project management commands
- System monitoring and SPARC commands
- Orchestration templates (monitoring, optimization, security review)

### v1.0.1 — Initial Release (2025-01-01)

- Complete Claude-Flow AI Agent Orchestration System
- Configuration guide and comprehensive tests
- Initial commit

---

## Milestone Summary

| Milestone | Version | Date | Key Feature |
|-----------|---------|------|-------------|
| Initial Release | v1.0.1 | 2025-01 | AI agent orchestration system |
| SPARC Integration | v1.0.50 | 2025-03 | Swarm + SPARC methodology |
| Alpha Foundation | v2.0.0-alpha.33 | 2025-05 | V2 alpha with hook safety |
| agentic-flow | v2.7.0 | 2025-08 | agentic-flow coordination engine |
| V3 Foundation | v3.0.0-alpha.1 | 2025-10 | V3 monorepo, 215 MCP tools |
| Plugin Marketplace | v3.0.0-alpha.170 | 2025-12 | 8 plugins + IPFS registry |
| Guidance Control Plane | v3.0.0-alpha.100 | 2026-01 | WASM policy kernel, ContinueGate |
| AgentDB v3 | v3.1.0-alpha.55 | 2026-02 | 8 controllers, MutationGuard |
| **Ruflo v3.5** | **v3.5.0** | **2026-02-27** | **First stable release, rebranding** |
