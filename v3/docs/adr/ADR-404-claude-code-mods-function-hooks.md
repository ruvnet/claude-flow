# ADR 404: Ruflo as a Claude Code Mod (Function Hooks)

Status: Accepted (implemented in plugins/ruflo-mods, PR #3608; the follow-ups listed below remain open)

Date: 2026 10 01

Related: #3555 (helpers in `"type":"module"` projects), #3565 (signed helper manifest), #3567 (no-match routing confidence), #3572 (honest swarm progress), #3602 (ledger anchor deletion), #3557 (plugin trust policy), #3607 (ruflo-swarm mod), #3605 / ADR 405 (ruOS desktops as swarm hosts), ADR 150 (removable augmentation), ADR 174 (failures as learning signal), ADR 324 (policy engine)

## Context

Ruflo plugs into Claude Code through classic settings hooks. Every `UserPromptSubmit`, `PreToolUse` (Bash) and `PostToolUse` (edit) starts `node .claude/helpers/hook-handler.cjs <event>`. Measured on the reference host below, that costs 16 to 19 ms per event at the median, p95 up to 39 ms. The `ruflo-core` plugin's own `PreToolUse` hook shells out to the CLI and, in a live session, finished a median 337 ms after `hook-handler`'s on every Bash call.

The 3.49.0 release fixed a class of bugs that comes from the same model:

- copied helpers broke in `"type":"module"` projects (#3555);
- they could be tampered with, which needed a signed manifest (#3565);
- an older CLI refreshing helpers mid-session overwrote them;
- some fallbacks were silent ("Router not available").

Claude Code now offers mods: a plugin whose `hooks/hooks.json` names a hooks module, `register(on, options)`, hooking engine events as in-process middleware `($, e, next)`. Since the launch, Claude Code can also write a mod, install it and hot-reload it mid-session, and its built-ins (`/diff` and others) ship as swappable mods.

### Verified facts the design rests on

Each fact was checked on Claude Code 2.1.282 and 2.1.287 (`claude plugin validate`, `claude plugin test`, debug logs of live `claude -p` sessions) or read from the upstream `mods/` sources, the generated declarations and Anthropic's `code-modernization` plugin.

- **Sandbox.** A hooks module runs in its own environment: no Node, no fs, no network, no process. Everything goes through `$`.
- **Imports and `$` scanning.** `claude plugin validate` refuses:
  - an import outside the plugin folder;
  - `$` passed to anything but a top-level function of the same file;
  - `$` calls deeper than `$.noun.method(input)`;
  - computed `$[noun]` access.

  The engine reads a module's `$` uses off its source and reports them (events hooked, calls made, environment variables read and written).
- **Which Claude Code loads mods, and when.**
  - **2.1.287** loads mods by default.
  - **2.1.282** loads them only with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Live, without it: "not turned on for installed plugins in this process"; with it: loaded.
  - **On either version**, a server-side rollout switch (`tengu_plugin_hooks_modules`, cached in `~/.claude.json`) can hold them off, the variable notwithstanding. While it served off, `claude plugin test` refused to run and live sessions logged "the rollout switch served off". It flipped between on and off several times in one afternoon, and between two accounts on this machine.
  - **A stale binary can decide.** This machine had a 2.1.107 npm-global `claude` beside the 2.1.287 native one. Whichever comes first on PATH runs.
- **`sec-default`**, seated outermost for managed or Team/Enterprise organizations:
  - continues past the user tier on `prompt.context`, `prompt.section`, `prompt.compose`, `settings.read` and `classic.*`;
  - leaves a person's plugins `prompt.submit` and its additive `context`;
  - on `tool.check`, re-runs the chain without the user tier when a user-tier plugin loosened a verdict that a settings deny rule decided;
  - with `allowManagedModsOnly`, refuses user-tier modules at `plugin.register`.

  Admins can also withhold any `$` affordance from the plugins below them.
- **`plugin.register` judging.** A user-tier hook on `plugin.register` judges every module admitted after it, including each hot reload. It reads the host's scan of that module (`uses.events`, `uses.calls`, `uses.env`) and may answer `{ refuse }`. Verified live in the kit: a refused module is reported as "refused by ruflo-mods" and never joins.
- **`$` behaviour.**
  - `$.env.set` sets a variable on the Claude Code process and on every hook it starts afterwards.
  - `$.fs.read` rejects files over 4 MiB.
  - `$.fs.stat` rejects a missing path with ENOENT.
- **Types.** Claude Code 2.1.287 writes its authoritative declarations and a base `tsconfig.json` into `.claude-plugin/types/` (gitignored there) when it loads a plugin.

## Decision

### A separate, opt-in plugin: `plugins/ruflo-mods`

The mod is its own plugin rather than a module added to `ruflo-core`, for three reasons:

- **Opt-in.** Every `ruflo-core` install would otherwise start loading mod code wherever function hooks are on.
- **Removable.** Uninstalling the plugin leaves ruflo exactly as it was. This is the ADR 150 rule.
- **Separation.** `ruflo-core`'s classic `hooks.json` and the module never share a manifest.

`ruflo mods install` (or `ruflo init --mods`) enables it. Amendment 1 (below) makes this the `ruflo init` default:

- **Where it writes.** It sets `enabledPlugins["ruflo-mods@ruflo"]`, the `ruflo` marketplace and `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` (for 2.1.277 to 2.1.286) in `.claude/settings.local.json` by default, so the choice is one person's, not the repository's.
- **What it records.** It notes what it added in `.claude-flow/mods/install.json`, and `ruflo mods uninstall` removes only that.

The module is shipped as `.ts` and loads directly (`"modules": ["./register.ts"]`). There is no build step, and the validator and the kit read the same source.

The upstream reference pattern is a hybrid `hooks.json` holding classic command hooks beside `modules`. Ruflo's classic hooks already live elsewhere: the project settings `ruflo init` writes, and `ruflo-core`'s own `hooks.json`. So `ruflo-mods` carries only the module and hands events over at runtime (below). The scaffold template for other mods uses the hybrid form.

### What the mod does

| Event | Classic equivalent | Mod behaviour |
|---|---|---|
| `prompt.submit` | `route` | Routes in-process. The routing block, and the ranked-memory block from `ranked-context.json`, ride the prompt as `context`. The text is byte-identical to `hook-handler.cjs route`'s output (tested; live, the model quoted it). No-match results carry the #3567 fields (`matched: false`, `reason: "no-match-default"`, confidence 0.3). |
| `tool.check` | `pre-bash` | Tightens only: `stricter(chain, ruflo)` over `deny > ask > allow`. Applies the `pre-bash` dangerous-command list and the Claude Code rules of ruflo policy. |
| `tool.call` (Write/Edit/MultiEdit) | `post-edit` | Records each finished edit, with `success: false` on error (ADR 174) and nothing for a denied call. Lines use `recordEdit`'s format and are written once per turn. |
| `turn.complete`, `session.end` | none | Write pending edit records. |
| `session.start` | none (handshake) | Decides ownership, sets `RUFLO_MODS_OWNS`, registers `/ruflo-mods`, writes a heartbeat for `ruflo mods doctor`. |
| `session.measure`, `agent.spawn` | `ruflo-cost-tracker` budget ladder | With `costBudgetUsd`, applies `budget.mjs`'s 50/75/90/100% ladder to live session cost, once per rung. With `costHardStop`, denies new subagent spawns at 100%. |
| `plugin.register` | none | The mod trust gate (below). |
| `engine.create` | none | Adds the `$.ruflo` noun, and takes the status-line drawer from the `$` beneath. |
| `ui.status` (op) | statusline | One line: ruflo's own parts (skipped where the ruflo `statusline.cjs` runs) followed by other mods' segments. Only measured facts: an unmatched route says "no route (30%)", and nothing is estimated (#3567/#3572). |

The table above is the original behaviour. Later work added three things it does not list: a research guard (`hooks/guard/research.ts`), `command.run` events (the `/ruflo-mods` command and the `/…-mod` commands of the plugin mods), and the guidance observation loop (ADR 447, off by default). See ADR 447.

`/ruflo-mods` is namespaced. The mod never registers a built-in's name such as `/diff`, or another plugin's (`/ruos*`, `ruflo-swarm-*`), so it composes with Claude Code's built-in mods instead of shadowing them.

### The `$.ruflo` noun (contract: `plugins/ruflo-mods/types/index.d.ts`)

The noun is flat, `$.ruflo.<method>(input)`, the only shape the validator accepts. It is declared on `EngineInterface` the way the telemetry mod declares `$.telemetry`, and `plugin.json` names it as `types`.

- **`segment({ id, text })`.** Another mod contributes a status segment instead of drawing a second bar; `text: null` clears it. Segments are untrusted:
  - the id must match `^[A-Za-z0-9_-]{1,32}$`;
  - control and bidi-override characters are stripped and whitespace collapsed;
  - text is cut to 48 characters;
  - at most 8 segments, sorted by id;
  - a bad id, or a new id past the cap, rejects.
- **`lastRoute()`** returns the last route made.
- **`snapshot()`** returns a copy of the measured state: owned events, routes, policy mode, tightened and observed counts, edits, budget and segments.

Consumers are the ruOS mod (`ruos-desktop`, segment id `ruos`) and `ruflo-ruos` (ADR 405). Both feature-detect by calling and catching. ruflo-swarm (#3607) reads swarm state from disk and does not depend on the noun. Each side vendors the other's contract file with a parity test. The contract only grows; renaming is a breaking change.

### One owner per event: the handshake

The classic hooks stay the default and the fallback; nothing removes them. The two paths agree at runtime:

1. **Ownable events.** Only `route` and `post-edit` can be owned. They are side-effect events, where firing twice is the bug. `pre-bash` is a guard: a second refusal changes nothing, and no handshake can switch a guard off. Session restore and end stay classic, because PageRank consolidation and intelligence init need Node.
2. **The decision.** At `session.start` the mod takes an event only if no classic hook in the merged settings runs it, or if every `hook-handler.cjs` a classic hook could run (the project's and `$HOME`'s) carries the handshake. One copy predating it is enough to stand down. Unreadable settings mean the mod owns nothing.
3. **The signal.** The mod sets `RUFLO_MODS_OWNS=route,post-edit` with `$.env.set`. `hook-handler.cjs` (both shipped copies and the generator's fallback) returns before any work for `route`/`post-edit` named there. `ruflo-core`'s `ruflo-hook.cjs` does the same for its `post-edit`, which otherwise races `hook-handler.cjs` for the same edit.
4. **Fallback.** If the mod is not loaded (an old Claude Code, the rollout switch off, `allowManagedModsOnly`, a failed start), the variable is never set and every classic hook runs. The variable dies with the process.

Tests run the real `hook-handler.cjs` and `ruflo-hook.cjs` with the environment the mod set. They count exactly one routing block per prompt and one edit record per edit, with a handshake-aware helper and with an older one. Live on 2.1.287, the mod owned `route`, the user-level classic `route` hook ran a handshake-aware helper beneath and exited, and the model quoted the routing line the mod injected.

### The mod trust gate

Self-modding means a Claude-written mod can be installed and run with Claude Code's access mid-session. The gate hooks `plugin.register`, first in registration order so it wraps everything else of ruflo's. It judges user-tier modules admitted after it, from the host's scan, never from the module's own claims. The allow-list matches the loader-keyed provenance (`name@marketplace`, e.g. `ruflo-swarm@ruflo`), never the self-declared `name`, which a rename walks past. There is no self-exemption: a module only judges modules admitted after it, so ruflo-mods never meets its own registration, and a later mod calling itself `ruflo-mods` is judged like any other.

- **What counts as risky.**
  - Calls: `process.run` (host commands), `http.fetch` (network), `env.set`, `fs.write` (any path, so settings, hooks and helpers included: a persistence route).
  - Hooks: `tool.check`, `tool.call`, `*`, `classic.*`, `plugin.register`, `prompt.compose`.
- **Policy (`userConfig.modTrust`).**
  - `observe` (default) names what the module can do in the transcript, or the debug log for a module with nothing risky.
  - `refuse-risky` refuses a module with any risky call or hook unless it is named in `modTrustAllow`. Here the gate guards something, so a gate failure refuses too.
  - `off` turns the gate off.
- **What it cannot do.**
  - It cannot judge modules admitted before it.
  - It never judges prepend, append or builtin modules: the organization's and Claude Code's own, out of a person's reach by design.

The ruflo CLI's plugin trust policy (#3557) is Node code and cannot run inside the sandbox, so the gate applies its own scan-based rule rather than that policy.

Sibling mods are risky by this rule: ruflo-swarm hooks `tool.call`, `agent.spawn` and an opt-in `*`; the ruOS mod hooks `tool.check`; the scaffold template calls `env.set`. Under the default `observe` they load unchanged. Under `refuse-risky` they must be allow-listed by provenance (`ruflo-swarm@ruflo`, and the ruOS mod's own id). Their lanes have been told.

### Tiers and `sec-default`

Ruflo loads in the user tier. Under `sec-default`:

- `prompt.submit` context still reaches the model.
- `settings.read` answers what the organization's tiers say.
- Ruflo's `tool.check` never loosens, so the held-verdict recheck is never triggered by ruflo.
- Under `allowManagedModsOnly` the module is refused whole, and the classic hooks keep every event.

Middleware order is nesting, the first registered wrapping the rest. Every ruflo `$` call tolerates refusal. Status, log and toast calls are wrapped, the status line goes through one drawer from `engine.create`, and session start, route and trust degrade to "classic keeps everything" rather than failing the turn.

### Security model

- **Tighten only.** `tool.check` merges by rank; a tie returns the chain's own object, so the `rule` `sec-default` reads is never rewritten. A property test covers every chain verdict, five policy states and seven inputs. A kit test covers two tighten-only mods side by side (ruflo plus a ruOS-style guard): a deny from either holds.
- **Fail closed, by one step, where ruflo guards something.** An unreadable or invalid policy projection, or a failure in the chain beneath, turns `allow` into `ask`. "Missing" means ENOENT only.
- **Input validation.** Every event field the mod reads is type-checked before use. Segments are sanitized as above. The projection is schema-validated rule by rule.
- **No network, process, model or MCP calls; no secrets.** The smoke contract enforces this statically (step 8 is a regex for a literal `key = "…"` assignment: it catches a hard-coded key, not every way a secret could reach a hook; `ruflo-mods` has no runtime secret guard). The only environment variable written is `RUFLO_MODS_OWNS`; the only one read is `HOME`. No command is ever built from event input.
- **Policy projection.**
  - **Why it exists.** A module cannot read `state.json`, whose receipt ledger is 43 MB here and over the 4 MiB limit. So `policy-runtime.ts` writes `.claude-flow/policy/claude-code.json` after each successful state write, owner-only and atomically.
  - **What it holds.** The mode and only the rules whose `actions` name `claude-code.` explicitly. Rules with no actions or `*` keep their MCP-only meaning, and the engine's default-deny never applies to Claude Code tools.
  - **How it matches.** Matching copies `evaluator.ts ruleMatches`, held to over 10,000 comparisons against the real evaluator.
- **#3602.** The mod never reads or writes `state.json`, receipts or the anchor. Deleting the projection only returns to the no-mod baseline.

### What the mod does not carry

- **Confidence boost.** The classic route writes `lastMatchedPatterns` and boosts the previous match's confidence on each prompt. The mod scores ranked memory read-only.
- **Rate-limit nudge.** The sponsored-capacity nudge (ADR 312/313) is not ported.
- **Capability envelopes.** Workers' `CLAUDE_FLOW_CAPABILITY_ENVELOPE` is not applied to Claude Code tools.
- **Lost lines.** `$.fs` has no append, so edit records are written by read-modify-write once per turn, and a classic writer appending in the same instant can lose a line.
- **Hot reload.** Reload rebuilds the in-memory state. Pending edits are written every turn, so a reload loses at most one turn's records. `$.state` would carry them across; deferred.

### Scaffolding: governed mods for ruflo users

`ruflo-plugin-creator` 0.3.0 (0.4.0 on 2026 10 05) adds a `create-mod` skill and `templates/mod/`. The template is a working mod:

- a hybrid `hooks.json` whose classic fallback exits while the module runs (`MY_MOD_ACTIVE`);
- a host adapter over literal `$` calls, refusal-tolerant;
- a namespaced command and `userConfig`;
- engine-kit tests and a tsconfig extending the generated types.

It is validated, kit-tested and live-loaded on 2.1.287. The skill carries the rules above, so "Claude, mod yourself" has a governed path.

## Testing

| Suite | Where | Result |
|---|---|---|
| Engine kit (`claude plugin test`), Claude Code 2.1.287 | `plugins/ruflo-mods/tests` | 15/15 when written; 39 in 8 files on 2026 10 05 |
| Engine kit, mod template | `plugins/ruflo-plugin-creator/templates/mod/tests` | 1/1 |
| Declaration-faithful harness (vitest, what CI runs) | `v3/@claude-flow/cli/__tests__/mods` | 99/99 when written; about 147 `it(` calls in 12 files on 2026 10 05 |
| Typecheck against the 2.1.287 generated types | `plugins/ruflo-mods`, the template | clean |
| `claude plugin validate` (2.1.287) | plugin, template, marketplace | pass |
| Smoke contracts | ruflo-mods 10/10, ruflo-plugin-creator 11/11 when written; 11/11 and 14/14 on 2026 10 05 | pass |
| Existing CLI suite | `v3/@claude-flow/cli` | Same 4 memory failures as `origin/main` in the same environment, plus `helper-signing` until the manifest is re-signed |

The engine-kit files import `claude-code/testing`, which the root vitest cannot resolve, so they are listed in `scripts/ci-test-baseline.txt` as #3605 and #3607 do.

### Live runs (`claude -p`)

1. **2.1.287 with a handshake-aware helper.** The mod owned `route` and `post-edit`. The user-level classic route hook stood down, and the model quoted `Agent: tester` / `Confidence: 60.0%` from the injected context. `prompt.submit` settled in 57.8 ms, worker hop and the classic hook beneath included.
2. **2.1.287, ten Bash calls.** Ruflo's `tool.check` settled in 1.6 to 4.0 ms (median about 1.9 ms, n=10), worker hop and the engine's own verdict included.
3. **Enforce-mode projection denying `echo forbidden*`.** Logged `tool.check Bash: allow -> deny by plugin ruflo-mods: ruflo policy: denied-by:no-forbidden-echo`.
4. **2.1.282.** Loaded with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; "not turned on" without it.
5. **Rollout switch off** (twice). The module was not loaded and the sessions finished on the classic path.
6. **Installed from a local marketplace** into an isolated config. It loaded and owned `route, post-edit`.

## Benchmarks

`npx tsx scripts/bench-mods-latency.ts`: Node 22.23.2, Ryzen 9 9950X. Spawn n=40 after 3 warm-up runs, in-process n=2000. Median / p95 in milliseconds, same inputs and project, third of three consistent runs.

| Event | Classic spawn | Classic, handed over | Mod handler (no engine hop) |
|---|---|---|---|
| route (`prompt.submit`) | 18.2 / 20.0 | 13.8 / 16.1 | 0.045 / 0.089 |
| pre-bash (`tool.check`) | 17.1 / 20.5 | n/a (guards never hand over) | 0.005 / 0.007 |
| post-edit (`tool.call`) | 19.0 / 32.4 | 13.8 / 23.2 | 0.001 / 0.003 |
| edit plus per-turn write | | | 0.20 / 0.41 |

How to read it:

- **The honest per-event comparison is the live engine figure.** `tool.check` settled at a median of about 1.9 ms (n=10, 2.1.287) against a 16 to 19 ms classic spawn. In the same session `ruflo-core`'s CLI-invoking `PreToolUse` hook ran a further median 337 ms per Bash call.
- **While a classic hook stays configured, its spawn still runs and returns early,** at about 13 to 14 ms. The mod then saves 4 to 5 ms plus the duplicated work per owned event.
- **The full saving needs the classic entries removed.** That is deferred (`mods install --exclusive`).
- **Optimization.** Ranked-memory trigrams are computed once per file change, which took the route handler from 0.159 to 0.045 ms.

## Follow-ups (not built here)

Ruflo plugins:

1. **ruflo-aidefence:** scan tool results on `tool.call` (`context` warning) and Write content (`tool.check` ask). Needs the AIMDS patterns as a data file in the plugin.
2. **ruflo-observability:** spans from `turn.*` and `tool.call`.
3. **ruflo-security-audit:** `tool.check` ask on dependency-changing commands.
4. **Memory recall on Read** ("x-ray reads"): attach bounded, non-blocking pattern recall as context when Claude reads a file. Needs a cache the module can read without spawning.
5. **3-tier model selection on `agent.spawn`.** This rewrites the model, which is not tightening, so it needs its own ADR. ruflo-swarm owns the swarm side (#3607).
6. **`session.receive` filtering** for federation peers.
7. **`ruflo mods install --exclusive`,** with the doctor restoring classic entries when the mod is refused.
8. **The status line as an `AbovePrompt` `ui.render` row** instead of `ui.status`. `prompt.fill` for suggested ruflo commands, never auto-run.

Built-in mods ruflo could offer replacements for: a policy-aware `/diff` pane (risk-scored hunks from `analyze_diff-risk`), and an agents listing filtered by ruflo routing (`agent.offer`). Both would be namespaced and never shadow the built-in.

The remaining ruflo plugins (skills, agents, MCP-only) gain nothing from function hooks.

## Consequences

- **Releases.**
  - Ships with `@claude-flow/cli`: the `mods` command, doctor checks, `init --mods`, policy projection and generator handshake.
  - Reaches users through the marketplace `git pull`, not npm: `plugins/ruflo-mods`, `plugins/ruflo-plugin-creator` (0.3.0) and `plugins/ruflo-core` (`ruflo-hook.cjs`).
  - `hook-handler.cjs` changed in both copies, so the helpers manifest must be re-signed at release.
- **API churn.** The API is early access. `claude plugin validate` and the kit tests are the gate, and the classic path is unaffected either way.

## Amendment 1 (2026 10 01): mods default-on in `ruflo init`

Status: Proposed. This amends "A separate, opt-in plugin" above. The plugin stays separate and removable; what changes is who turns it on.

### Decision

- **`ruflo init` enables the mods by default.** `--no-mods` opts out. It writes the committed `.claude/settings.json`, so the choice is the project's and teammates inherit it:
  - `enabledPlugins` for every entry in `MOD_PLUGINS` (`v3/@claude-flow/cli/src/mods/install.ts`): `ruflo-mods@ruflo`, `ruflo-swarm@ruflo` and `ruflo-console@ruflo`;
  - `extraKnownMarketplaces.ruflo` (github `ruvnet/ruflo`);
  - `env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1"`.

  A key that is already present is never changed. A plugin someone set to `false` stays `false`, and an existing env value stays as it is.
- **The plugins are installed too.** After writing settings, init runs `claude plugin marketplace update ruflo`, or `claude plugin marketplace add ruvnet/ruflo --scope project` when the marketplace is unknown. Then it runs `claude plugin install <id> --scope project` for each plugin the clone carries.
  - The commands go through execFile with fixed argv: no shell, no `-y`, and bounded timeouts.
  - `--no-plugin-install` skips this step. On a failure, init prints the exact manual commands.
  - The step is skipped when `VITEST` or `CI` is set, so a test or CI init never clones from GitHub.
- **Existing projects.** `ruflo init upgrade --mods` applies the same merge and install. `--add-missing` and `--settings` imply it, and `--no-mods` overrides them. Each key added is reported under "Settings Updated".
- **Standalone.** `ruflo mods install` enables the same plugins in `.claude/settings.local.json` unless `--scope project` is given.
- **Install record v2.** `.claude-flow/mods/install.json` now records, per settings file, what was added (`files: { <path>: { plugins, marketplace, env, claudeInstalled } }`). A v1 record from 3.50.0 is read as v2.
  - `claudeInstalled` lists the plugins ruflo installed with `claude plugin install`: ones absent from Claude Code's install record before, and enabled by ruflo.
  - `ruflo mods uninstall` runs `claude plugin uninstall <id> --scope <scope>` for exactly those, then removes exactly the recorded keys. A plugin someone installed before is never uninstalled.
- **Dogfooding: `ruflo mods install --source local`.** Optionally with `--marketplace-path <dir>`, it declares `extraKnownMarketplaces.ruflo` as a `directory` source pointing at a ruflo checkout.
  - The repair runs `claude plugin marketplace add <dir> --scope <scope>` and no `plugin install`: an install would pin a cached snapshot instead of the live tree.
  - The directory must hold the `ruflo` `.claude-plugin/marketplace.json`.
  - Doctor reports the source type, and warns when a project declares one source while Claude Code knows `ruflo` by another.
  - Claude Code keeps one `ruflo` marketplace per config dir, so the switch applies machine-wide. Install says so and prints how to switch back.
- **Adding a plugin.** `MOD_PLUGINS` is the one list to edit. `required: false` marks a plugin that is not yet released on main (none today; ruflo-console was until it shipped in 3.51.0). If such a plugin is missing from the marketplace, it is reported as "pending" and never fails a check.

### Why default-on is safe, and where that argument stops

- **For ruflo-mods and ruflo-console, nothing runs unless function hooks are on.** If the Claude Code binary predates mods, or is 2.1.277 to 2.1.286 without the variable, they stay off. So does a server-side rollout switch serving off (see "Which Claude Code loads mods, and when" above). In all those cases the plugin loads nothing and the classic `hook-handler.cjs` hooks keep every event, exactly as before. When they do load, the handshake gives the mod only the events the classic helper hands over.
- **ruflo-swarm is not gated the same way.** Its commands, skills and agents load whether or not function hooks are on (its own `hooks/hooks.json` says so). Only its live pane is a mod. Default-on therefore adds ruflo-swarm's commands, skills and agents to every initialized project.
- **The mods admitted are risky by the trust gate's own rule.** A live session printed "ruflo-swarm (ruflo-swarm@ruflo) loaded; process.run (runs host commands); on tool.call (can rewrite or answer tool calls); on * (sees every event)". Under the default `modTrust: observe` it loads and is named in the transcript.
  - `refuse-risky` with `modTrustAllow` would gate it.
  - `pluginConfigs` options are read only from user, `--settings` or managed settings, so init cannot set that per project.
  - **Decision (for now):** keep `observe`. Init writes no user or managed settings. Init output, the plugin README and this ADR name `refuse-risky` + `modTrustAllow` (in user or managed settings) as the opt-in hardening.
  - **Open question:** whether default-on should eventually ship with `refuse-risky`.
- **What a teammate sees.** With function hooks on, ruflo-swarm is also a mod that can run host commands (pane actions the user starts). Each teammate's first trusted interactive start clones `github.com/ruvnet/ruflo`. A headless `claude -p` on a fresh config loads nothing. Init prints all of this.
- **Network and trust surface.** A project-level `extraKnownMarketplaces.ruflo` makes each teammate's Claude Code clone `github.com/ruvnet/ruflo` on its first trusted interactive start.

### Verified live (Claude Code 2.1.287, isolated `CLAUDE_CONFIG_DIR`)

- **An interactive, trusted session loads plugins from the marketplace clone.** It clones the marketplace a project declares and loads an enabled plugin straight from that clone. No `installed_plugins.json` entry is needed. The mod's heartbeat was written and `/ruflo-mods` reported. A headless `claude -p` run on a fresh config clones and loads nothing.
- **A stale clone is the failure.** A clone from before `plugins/ruflo-mods` existed (`6cfd88654`) gives "Unknown command: /ruflo-mods". No heartbeat is written, and Claude Code does not refresh the clone on start. This is the 3.50.0 field report, and the reason `ruflo mods doctor` and `ruflo doctor` now fail on it with the exact commands. A missing install record alone is not a failure. `claude plugin install` stays in the repair because its cached copy survives a later stale clone, and because `claude plugin list` shows it.
- **Claude Code reformats the committed file.** `claude plugin marketplace add --scope project` and `claude plugin install --scope project` re-serialize `.claude/settings.json`: key order and formatting change, content does not. ruflo reports it ("reformatted, content unchanged") and does not rewrite it back.
- **`claude plugin install` flips a disabled plugin on.** A plugin set to `false` becomes `true`. So the repair installs only plugins that are `true` in the settings file.
- **`claude plugin uninstall --scope project` edits settings too.** It removes the plugin's `enabledPlugins` entry itself.
- **Headless runs load once the marketplace is known.** After `ruflo init` has added the marketplace to the config dir, `claude -p "/ruflo-mods"` loads the mod and prints its report. This is the e2e live check. It authenticates with `CLAUDE_CODE_OAUTH_TOKEN`; no credential file is copied.
- **A directory marketplace works, live.** A `directory` source loaded `ruflo-mods` in `claude -p` with no install record. An edit to the directory showed on the next run with no update or install in between. It was verified with a marker string changed between two runs.

## Addendum 2026-10-11: the doctor names each broken state; install is one operation; the mod says when it is not fully loaded

- **A switched-off plugin is not repaired by `ruflo mods install`.** Install never flips a `false` (section above). `doctor` used to answer a `false` with "not enabled", fix `ruflo mods install`, which changes nothing. It now says the plugin is disabled in that file and prints `claude plugin enable ruflo-mods@ruflo --scope <scope>`. A plugin installed for this project but enabled nowhere gets the same repair.
- **`partial install` finding.** Some of the three mod plugins enabled and not the others, a plugin enabled with no `ruflo` marketplace declared anywhere, or keys the install record says ruflo added that the settings no longer carry. Repair: `ruflo mods install`, which is idempotent and adds exactly what is missing.
- **Every warning or failure carries a one-line `fix`.** The exceptions are facts only the engine can change (Claude Code serving function hooks off for the account). A fresh config where nothing is cloned says that a headless `claude -p` run clones nothing, so the mod is absent there.
- **`ruflo mods doctor --strict`** exits 1 on a warning as well as on a failure, for CI. Without it the exit code is as before (1 only on a failure).
- **Install is one operation.** The settings file and the install record are written together; if the record cannot be written the settings go back as they were (or the file ruflo created is removed), so nothing is left that `uninstall` cannot find. A second run changes nothing and writes no second backup.
- **Startup self-check (mod option `selfCheck`, default on).** At `session.start`, when `ruflo-console` or `ruflo-swarm` is enabled in settings but missing from the marketplace clone with no cached install, the mod says so once in a toast: a fixed line naming the plugin(s) and `claude plugin marketplace update ruflo`. Read-only, fail-open, no repository text in the line, nothing for the model. A fresh config with no clone yet says nothing (Claude Code clones at the next interactive start). It cannot know a plugin failed to load for another reason; it checks the cause the doctor already knows is silent.
- **Not done:** the self-check does not read which plugins the engine actually loaded (the `engine.create` input lists them; not used here), and `/ruflo-mods` stays an alias of `/ruflo mods` (ADR-406), now held by a smoke step.
