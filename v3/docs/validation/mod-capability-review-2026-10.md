# Mod system capability review, 2026-10-04

Scope: `plugins/ruflo-{mods,console,swarm,ruos,agentdb}`, the 39 ADR-446 per-plugin mods, ADRs 404, 444 to 448, and the CLI and guidance code they connect to. Base: `origin/main` a962c403e.

Method and limits, stated up front:

- The machine-checkable columns come from `node scripts/mod-capability-matrix.mjs` (reads files only; 8 node:test tests in `scripts/__tests__/mod-capability-matrix.test.mjs`).
- Four read-only review agents read ADRs and code: ruflo-mods (ADR-404), agentdb/swarm/ruos (ADR-445, 405), guidance and cross-mod (ADR-447), console (ADR-444/448). The console agent was told to stop early on budget, so ADR-443 and the console's `/ruflo` command tests are "not checked".
- **Nothing here was live-verified in a `claude -p` session.** The session budget ran out on the review agents before any live run. "Live-verified" is "no" in every row. What was run: `claude plugin validate` and `claude plugin test` (the engine kit, not a model session) on all 44 mods.
- ADR-449 does not exist (`v3/docs/adr` stops at 448). The brief's reference to it is a mistake.

## 0. Measured baseline

| Check | Result |
|---|---|
| Plugin directories with `hooks/register.ts` | 44 (5 core mods + 39 per-plugin); `ruflo-core` and `ruflo-cost-tracker` have no mod, by ADR-446 design |
| Mods registering `tool.call` | 40 of 44 (not `agntcy`, `arena`, `plugin-creator`, `ruos`) |
| `claude plugin test`, all 44 | **647 pass, 20 fail** |
| Failing plugins | agntcy 3, arena 4, graph-intelligence 11, plugin-creator 1, **console 1** |
| `claude plugin validate` | passes for all 44; warnings for arena, graph-intelligence, workflows |
| Static test titles (`test(`/`it(` grep) | 751; the run count differs (console static 138 vs 210 run, parametrised tests), so static counts are not a substitute |

ADR-446 explained the agntcy/arena/graph-intelligence/plugin-creator failures as the harness loading non-mod vitest files. **The console failure is not explained there and was not investigated here.** First thing to look at: `cd plugins/ruflo-console && claude plugin test`.

## 1. Capability matrix

Columns: where, events, default, proof (test file::title), live-verified (all "no"), known gaps. `P:` = `plugins/<name>/tests/`; `C:` = `v3/@claude-flow/cli/__tests__/mods/` (the only one CI runs; the `P:` kit tests are not in CI).

| Capability | Where | Events | Default | Proof | Gaps |
|---|---|---|---|---|---|
| In-process routing | ruflo-mods `route/*` | prompt.submit | on if mod owns `route` | P:register "routes a prompt in-process: the route rides as context, #3567 no-match included"; C:mods-route "carries router.cjs TASK_PATTERNS exactly" | none found |
| Tighten-only tool.check | ruflo-mods `guard/*` | tool.check | on | P:register "tool.check: the dangerous-command list tightens an allow; a deny is never loosened"; C:mods-guard (3x3 verdict loop) | research guard (ADR-440) missing from ADR-404 and README |
| Edit learning | ruflo-mods `learn/*` | tool.call, turn.complete, session.end | on if mod owns `post-edit` | P:register "records a finished edit once per turn, in the classic pending-insights format" | session.end flush untested; `FLUSH_AT=50` flushes early |
| Cost ladder | ruflo-mods `cost/*` | session.measure, agent.spawn | **off** (`costBudgetUsd` 0) | P:cost "the budget ladder says each rung once on the way up; HARD_STOP halts new agents" | rung re-announced if cost falls and rises (`cost/index.ts:166`) |
| Secret guard (ruflo-mods) | none | none | n/a | none | **claimed, no code**: `guard/` has no secret logic (see 2) |
| Recall into prompt | ruflo-agentdb `recall.ts` | prompt.submit | **off** | P:register "on: attaches screened memory as framed per-prompt context, once per prompt (cached after)" | deadline bounds `read` only |
| Memory write guard | ruflo-agentdb + 38 per-plugin `guard.ts` | tool.call | on | P:register "refuses a secret in a memory write, passes a clean one, ignores other tools" | **fails open**, see 4 |
| Console control by Claude | ruflo-console `model-tools.ts`, `register.ts:215` | tool.call (own `mcp__ruflo-console__*` names) | **off** setting `modelControl`; confirm `auto` | model-tools.spec "refuses and cancels an action above the level, even in auto mode: nothing runs"; "are four, each with an object schema…" | level gate bypassed by remembered "always" actions (4, item 7) |
| Room feed (ADR-448) | ruflo-console `hooks/{room,data/room,views/room}.ts` | in-memory events, control log | named-only page | room.spec "interleaves events, Claude's console actions and what was said, newest first" | memory only (WeakMap, cap 50): not "shared" across sessions; no ✦ ask buttons in "Who's here" |
| Mods section | ruflo-console `data/mods.ts`, `views/mods.ts` (rendered on the Room page, counted on Overview) | reads `.claude-flow/<x>-mod/status.json`, 60 folders, 8 KB, version 1 | on | mods-section.spec "reads only *-mod folders and skips a folder with no status file"; "caps the folders read at 60 and says so" | ADR-446 "console does not list them yet" is stale: it does |
| Status files | 38 per-plugin `status.ts` + agentdb | session.start, tool.call | on | per plugin `mod.test.ts` | one reader (console, agentdb only); 38 writers with no reader |
| `/<x>-mod` commands | per-plugin `command.ts` | command.run | on | e.g. ruflo-adr P:mod "status and scan answer locally" | `/agentdb-mod` README text describes the wrong command (2) |
| Trust gate | ruflo-mods `trust.ts` | plugin.register | `modTrust` observe | P:trust "observe (default): names what a later mod can do, and loads it" | none found |
| Handshake ownership | ruflo-mods `session.ts`, `ownership.ts`; CLI `hook-handler.cjs` | session.start | on | C:mods-ownership "exactly one routing block per prompt with a handshake-aware helper (the mod)" | none found |
| Guidance observation | ruflo-mods `guidance/*` | inside existing handlers | **off** (both options) | P:guidance "default settings add no guidance or candidate observations"; "native lifecycle stores only unverified metadata once, with failures and final denies" | one manual reader (`ruflo guidance mod-candidates`); learning-only mode records no rule ids |
| Swarm pane | ruflo-swarm | ui.render, ui.close, command.run, turn.*, agent.spawn, tool.call | `panel` command | P:register "by default (panel command) nothing opens unasked…" | `panel: off` does not stop `/ruflo swarm pane` |
| Swarm CLI buttons | ruflo-swarm `actions/` | pane actions | npx-offline | controller.test "stealing a task asks first, then runs one fixed argv and checks the claim moved on disk" | none found |
| ruos segment | ruflo-ruos | session.start, prompt.submit, 15 s clock | on | mod.test "sets the ruos segment from hosts.json and clears it when agents finish" | none found |

The generated half (per-plugin events, userConfig, status paths, guarded tools) is the JSON from the script; regenerate rather than copying numbers from this file.

## 2. Claims versus reality

Not substantiated, stale or wrong:

1. **ruflo-mods README:20** says ruflo-console is "pending until released". It is released and `required: true` in `install.ts`.
2. **ADR-404 testing table** quotes "engine kit 15/15", "harness 99/99", "smoke ruflo-mods 10/10", "plugin-creator 11/11". Actual: 28 kit tests; about 147 `it(` calls in `__tests__/mods`; smoke has 11 steps; plugin-creator smoke has 15.
3. **ADR-404** says plugin-creator 0.3.0 adds `create-mod`; it is 0.4.0.
4. **ADR-404 and README** omit the research guard (`guard/research.ts`), the `command.run` events and the guidance loop in the behaviour tables.
5. **ruflo-mods `plugin.json` / `marketplace.json`** still say "opt-in"; Amendment 1 made it the `ruflo init` default.
6. **ADR-404 security model** says "no secrets"; enforced only by smoke step 8 (a regex for `key = "literal"`). The brief's "secret guard" for ruflo-mods does not exist.
7. **ruflo-swarm `plugin.json`**: `panel: off` "never opens it" is wrong. The `pane` subcommand calls `openPane()` with no option check (`register.ts:313-325`); only auto-open and `:watch` are gated. No test sets `panel: 'off'`.
8. **ruflo-agentdb**: README:63 describes `/agentdb-mod` as health and session management (that is the markdown `/agentdb`); README:5 says v0.3.0 (plugin is 0.4.0); the `plugin.json` description and `register.ts:123` docstring say `/agentdb`, the real mod command is `/agentdb-mod`.
9. **ADR-445 §6** says all hook files are "under 120 lines"; `register.ts` is 171.
10. **ADR-445 and README** list six guarded writers; `WRITERS` has seven (`hooks_intelligence_pattern-store`). Judged from names only, these write tools are unguarded: `agentdb_feedback`, `agentdb_session-end`, `hive-mind_memory`, `memory_import`, `session_save`, `rvf_ingest`, `hooks_compress_store`.
11. **Swarm activity file** `.claude-flow/metrics/swarm-activity.json`: nothing in the swarm plugin writes or reads it; the CLI and hooks code reference it. Writer not traced.
12. **ADR-447 numbers** "47 contract cases" and "189 tests across 10 files" could not be reconciled by static count (about 45 and about 150). Not run, so unverified rather than wrong.
13. **ADR-446** is dated 2026 10 05; today is 2026-10-04.
14. **ADR-446** says the plugins are "unchanged" for the five existing mods and "46 of 46" smoke; this review found 46 plugin directories with a manifest, 44 with mods. Not re-run.
15. **The brief's** "ADR-449" does not exist.
16. **ADR-444** status is "Proposed" but it ships (Settings rows `model-control`, `model-confirm`). "Anything unclear counts as the most dangerous class" is wrong: `classOf` falls through to `write` (`model-tools.ts:60`). "270 palette entries; 105/101/27/2/4+" is pinned by no test and the parts sum to 239.
17. **ADR-448** scope says `palette.ts` and `runner.ts(ask)` changed and `console_state` reads the feed; no room code is in `palette.ts` or `model-tools.ts`. "Shared" feed is in-memory per session. "vitest 871" is stale (about 961 test lines in 101 files). Line references are off by 1 to 3.
18. **ruflo-console `plugin.json`** description omits Missions, Room, Mods, Sandbox, Secure, Perf, Automate, Neural, Vector, Evolve, Dev Tools, Market, Settings and the plugin catalog.
19. **ADR-446 "39 mods"** versus 34 `-mod` commands and 35 `status.ts` files found by the console agent; the generator counts 44 mods in all. Reconcile with the matrix JSON.
20. `/ruflo` and `/ruflo-console` are hooked by three plugins (console, ruflo-mods `session.ts:89`, ruflo-swarm `register.ts:353`); delegation relies on each calling `next`.

Verified and matching: ruflo-mods userConfig defaults (8 keys, `plugin.json` = `options.ts` = README); agentdb "26 tests" (12 + 14); registration order matches its comment (trust outermost); guidance defaults both off; guidance tighten-only (`stricter()` returns ours only when strictly higher; the research guard was not read); CLI `mods` subcommands exist.

## 3. Cross-mod interactions

- **Stacking.** A denying guard returns `{ deny }` without calling `next`, a passing one returns `next(e)`; by ADR-404 "first registered wraps the rest", the outer denier short-circuits, so two mods cannot both emit a reason for one call. Which plugin is outer across plugins is engine-defined and **not verified**.
- **Overlapping watchers.** `memory_store` is named in 15 guard files, `agentdb_hierarchical-store` in 12, `agentdb_pattern-store` in 10 (generator, guard files only). Several guards (music, agentdb, rag-memory) screen every write with no namespace check, others are namespace-gated (security-audit, goals, intelligence).
- **False refusal across plugins (from reading, not executed).** With ruflo-music or ruflo-agentdb installed, a `memory_store` of a fixture holding a fake `AKIA…` key into any namespace is refused, and the reason names that plugin even if the user's task is the security-audit plugin's.
- **No command-name collisions.** Zero shared registered names across 44 mods; none equal a markdown command name. `ruflo-swarm:watch` wraps the markdown command and calls `next`, deliberately.
- **Status paths.** No two mods write the same path; the generator's only repeated path is console reading `agentdb-mod/status.json`.
- **userConfig keys.** `guard` is declared by 36 plugins, `cli` and `panel` by console and swarm. Whether Claude Code namespaces them per plugin was not verified here; if it does not, they collide.
- **Reads of other mods' files.** Only console reads one mod file (agentdb status). Console and swarm also read CLI-written stores under `.claude-flow/`.

## 4. Real defects found

1. **The memory write guard fails open.** Reproduced by an agent against a copy of `screen.ts`, `guard.ts` and `tools.ts`. A `ghp_` token passes when it is: after char 20,000 of one string (`bare()` slices before the regex); after about 20k characters of earlier fields (the `textsOf` budget returns `[]`); an object key (`Object.values` skips keys); item or field 201; depth 7 (depth 6 is blocked); split across two fields; base64. **`{password: "<20 chars>"}` and `{key: "api_key", value: "..."}` also pass**, because the key-assignment regex needs name and value in one string and structured input splits them. This affects JSON-shaped writes such as `agentdb_hierarchical-store` and `agentdb_batch`. No test covers truncation, budget, keys or structured credentials. The same `textsOf`/`bare` pair is copied into the other mods (ADR-446 §3), so the other 38 guards very likely share it; only agentdb's was reproduced.
2. **`panel: off` is not honoured** by the pane subcommand (claim 7).
3. **Cost rung re-announced** after cost falls then rises (`cost/index.ts:166-169`); contradicts "once per rung".
4. **`guidance.prompt` runs before the `owned.has('route')` check** (`route/index.ts:236`), so with `guidanceLearning` on, a project that does not own routing still records guidance observations. README:72 promises no writes there.
5. **Observation loss past 256 tool ids per task** is silent beyond the status line.
6. **Console `claude plugin test` has 1 failure** (cause not investigated).
7. **Console level gate bypass.** `runner.ask` runs an action whose kind is in `state.allowed` at once, with no pending action; `console_run` classifies only pending actions (`runner.ts:135-141`, `model-tools.ts:285-291`). After a person picks "always" on a write, network or delete action, Claude at level `read` can run it by id and get "Done" without reaching `allows()`. Not reproduced live.
8. `runById` runs `filterPalette(text)[0]` when the id is missing and `text` is set (`runner.ts:204`), so a typo'd id can run a different entry (class gate still applies).

## 5. Dead and duplicate code

- **Screen:** `screen.ts` exists in 38 mods in 18 distinct byte-variants (group sizes 17, 5, then 16 singletons). `status.ts`, `command.ts` and `guard.ts` are not byte-identical in any two plugins (they carry per-plugin names and rules); `options.ts` has 21 variants (largest group 9). The shared logic (secret regex set, `textsOf`, `splitName`, flag parsing, `statusText`) has no owner. Drift is already real: the browser copy adds `nsec1`, the injection set is absent in some.
- A fourth secret-regex implementation lives in `ruflo-mods/hooks/guidance/screen.ts`, whose header still says "for the AgentDB mod"; its `hasSecret` and `tidy` have no callers.
- `PLUGIN_NAME` (`ruflo-swarm/hooks/state.ts:8`), `parseProbe` (`ruflo-ruos/scripts/lib/command-builder.mjs:235`): exported, never used.
- `isStrings` duplicated (`trust.ts`, `policy.ts`); the control-character stripper is written three times with different ranges (agentdb, ruos, swarm).
- No hook file is over 500 lines individually (largest `ruflo-swarm/hooks/register.ts`, 466). A `wc` total over the console `hooks/` tree is large (28k lines including catalog data); the per-file claim was checked only for agentdb, swarm and ruos by agents.
- `scripts/native-guidance-smoke.sh` embeds inline `python3`, against the user-level "Rust only, never Python" rule (the project CLAUDE.md in this worktree has no such rule).

## 6. Fifteen highest-value improvements

| # | Change | Impact | Effort | Targets |
|---|---|---|---|---|
| 1 | Make the guard scan complete: keys with values, `key=value` pairs, overlapping windows, fail closed above caps, raise the item and depth limits | high (a real secret leak path) | S | `plugins/ruflo-agentdb/hooks/{guard,screen}.ts` first |
| 2 | One generated shared module (`screen`, `textsOf`, `splitName`, `readOptions` flag, `statusText`) vendored at release with a drift check that fails CI on any hash outside the generator output | high | M | `plugins/ruflo-plugin-creator/templates/mod/hooks/`, new `scripts/vendor-mod-kit.mjs`; use `duplicates` from the matrix script |
| 3 | Regression tests for truncation, budget, key, structured credential in every guard | high | S | `plugins/*/tests/mod.test.ts` (generate) |
| 4 | Investigate and fix the console `claude plugin test` failure; make the 4 non-mod vitest files invisible to the kit | high | S | `plugins/ruflo-console/tests/`, `ruflo-{agntcy,arena,graph-intelligence,plugin-creator}` |
| 5 | Run the 44 kit suites in CI (today only `C:` tests are in CI) | high | M | `.github/workflows/` (new job using `claude plugin test` per plugin) |
| 5b | Classify remembered actions in `console_run` (run `allows()` before `ask`), and fix the `classOf` comment or fall-through | high | S | `plugins/ruflo-console/hooks/{model-tools,runner}.ts`, `tests/model-tools.spec.ts` |
| 6 | Honour `panel: off` for the `pane` subcommand and add the test | med | S | `plugins/ruflo-swarm/hooks/register.ts:313`, `tests/register.test.ts` |
| 7 | Fleet check that each guarded tool name exists in the tool registry (ADR-446 follow-up) | med | S | generator `guardTools` + CLI tool list, new test in `scripts/__tests__/` |
| 8 | Narrow overlapping `memory_store` guards: namespace gate or one owner, so an unrelated plugin cannot refuse a write | med | M | `ruflo-{music,agentdb,rag-memory}/hooks/guard.ts` |
| 9 | Console Mods section that lists all 39 `<x>-mod/status.json` (version-checked, like agentdb's) | med | M | `plugins/ruflo-console/hooks/data/files.ts` and the settings page |
| 10 | Correct stale docs: claims 1 to 5, 8, 9, 13 above; replace the ADR-404 test table with generated counts | med | S | `plugins/ruflo-mods/README.md`, ADR-404, ADR-445, ADR-446, `ruflo-agentdb/{README.md,.claude-plugin/plugin.json}` |
| 11 | Gate `guidance.prompt` on ownership; give learning-only mode rule ids or document it | low-med | S | `plugins/ruflo-mods/hooks/route/index.ts:236`, `guidance/index.ts:46` |
| 12 | Track highest rung, not last, in the cost ladder | low | S | `plugins/ruflo-mods/hooks/cost/index.ts:166` |
| 13 | Drop dead exports and the copied header | low | S | `guidance/screen.ts`, `swarm/hooks/state.ts`, `ruos/scripts/lib/command-builder.mjs` |
| 14 | Prove the live paths the table marks "no": routing, deny, status file, `/x-mod` via `claude -p` haiku, in a private scratch dir, and record the evidence | med | M | `plugins/ruflo-mods/scripts/smoke.sh` pattern |
| 15 | Resolve who writes and reads `swarm-activity.json` and the 38 unread status files, or remove the writers | low-med | M | `v3/@claude-flow/hooks/src/statusline`, per-plugin `status.ts` |

## 7. Not done

- No live model sessions (budget), so nothing is marked live-verified.
- ADR-443, the console `/ruflo` command tests and the writers of the console's `.claude-flow` input files were not checked.
- Latency and bench figures, "10,000 comparisons" parity and git-hardening claims in `mod-sources.ts` were not re-run.
- No in-repo doc fixes applied; claims 1 to 9 are listed for the owners.
