# ruflo-mods

ruflo as a Claude Code mod (function hooks): on by default in Claude Code >= 2.1.287; from 2.1.277 with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Design and evidence: [ADR-404](../../v3/docs/adr/ADR-404-claude-code-mods-function-hooks.md), including Amendment 1 (default-on in `ruflo init`).

```bash
ruflo init                          # new projects: mods on by default, in the committed .claude/settings.json
ruflo init upgrade --mods           # existing projects: merge the same keys (never overwrites yours) and install
ruflo mods install                  # just this checkout (.claude/settings.local.json); --scope project for the team
ruflo mods install --source local   # dogfooding: load the mods live from this ruflo checkout (no clone)
ruflo mods doctor                   # marketplace source and freshness, plugins loadable, function hooks, what it owns
ruflo mods uninstall                # claude plugin uninstall what ruflo installed; remove exactly the keys it added
```

These enable `ruflo-mods@ruflo`, `ruflo-swarm@ruflo` and `ruflo-console@ruflo`, the `ruflo` marketplace and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. A key you already set is left as it is: a plugin you set to `false` stays off and is never installed. `ruflo init --no-mods` writes none of it.

## What loads

- **ruflo-mods and ruflo-console** run only where function hooks are on. With them off, or with Claude Code's rollout switch off, they do nothing, and the classic hooks keep every event.
- **ruflo-swarm** loads its commands, skills and agents even without function hooks. With them on, it is also a mod that can run host commands (pane actions you start).
- **The ruflo marketplace is cloned on first use.** Each teammate's first trusted, interactive Claude Code start clones `github.com/ruvnet/ruflo`. A headless `claude -p` on a fresh config loads nothing. Once the marketplace is cloned, which `ruflo init` does, `claude -p` loads the mods too.
- **Optional hardening:** set `pluginConfigs["ruflo-mods@ruflo"].options.modTrust = "refuse-risky"` with `modTrustAllow` in user or managed settings (e.g. `"ruflo-swarm@ruflo,ruflo-console@ruflo"`: both run host commands, so `refuse-risky` refuses them otherwise). Project settings cannot set it. The default is `observe`, which names what each later mod can do and blocks nothing. `ruflo-protector@ruflo` (Project Anatole, ADR-453) is an expected `modTrustAllow` entry: it hooks `tool.check` to deny rule-marked-block calls in `enforce` mode, so `refuse-risky` refuses it otherwise. When its status file exists, `/ruflo-mods` shows one `protector:` row (mode, open alerts, blocked).

## Install and repair

When a `claude` binary is on PATH, init and install also do what you would do by hand, in the project directory:

```bash
claude plugin marketplace update ruflo                     # or, first time: claude plugin marketplace add ruvnet/ruflo --scope <scope>
claude plugin install ruflo-mods@ruflo --scope <scope>
claude plugin install ruflo-swarm@ruflo --scope <scope>
```

Settings alone are not always enough. Claude Code loads these plugins from its local clone of the `ruflo` marketplace (`~/.claude/plugins/marketplaces/ruflo`, or under `$CLAUDE_CONFIG_DIR`), with or without an install record.

- **No clone yet.** An interactive, trusted session clones it on start. A headless `claude -p` run does not.
- **A stale clone.** A clone from before ruflo-mods shipped has no `plugins/ruflo-mods`, so Claude Code skips the enabled plugin without a word, and `/ruflo-mods` is an unknown command. It does not refresh the clone on start. `ruflo mods doctor` and `ruflo doctor` report this as a failure, with the exact commands above.
- **Why `claude plugin install` too.** It keeps a cached copy that still loads if the clone goes stale later.

`ruflo mods uninstall` runs `claude plugin uninstall <id> --scope <scope>` only for the plugins ruflo itself installed: ones that were not installed before and that ruflo enabled. It then removes exactly the settings keys ruflo added. Both are recorded in `.claude-flow/mods/install.json`.

## Dogfooding: `--source local`

`ruflo mods install --source local` declares the `ruflo` marketplace as a directory source pointing at a ruflo checkout: `--marketplace-path <dir>`, or by default the project root, which must hold the `ruflo` `.claude-plugin/marketplace.json`.

- **Live from the working tree.** Claude Code loads the plugins straight from that directory: no clone, nothing to go stale, and edits show on the next session. Verified on 2.1.287.
- **No `claude plugin install`.** Installing would pin a cached snapshot instead of the live tree.
- **One marketplace per config dir.** Claude Code keeps one `ruflo` marketplace per config dir, so switching it to a directory applies to every project on that machine. Switch back with `claude plugin marketplace add ruvnet/ruflo`.
- **Doctor** reports the source type, and warns when a project declares one source but Claude Code knows `ruflo` by another.

## Flags

- `--no-plugin-install` writes settings only and runs no `claude` command.
- `--dry-run` (`mods install`, `mods uninstall`) prints the settings and the `claude` commands without running either.
- If `claude` is missing or a step fails, the manual commands are printed and the exit code is 0. Pass `--strict` (`mods install`) to exit 1 instead.
- Under `VITEST` or `CI`, init skips the `claude` step and prints the commands.
- Claude Code reformats `.claude/settings.json` (key order) when it installs at project scope. ruflo says so and leaves it: the content is unchanged.

In a session, `/ruflo mods` (through ruflo-console's `/ruflo`) reports what the mod owns, routed, recorded and tightened. `/ruflo-mods` stays as an alias of it (ADR-406: no command is removed or renamed).

## What it does

- **Routing:** in an initialized Ruflo project (an existing `.claude-flow/` directory), `prompt.submit` routes each prompt in-process and hands the route, plus ranked memory, to the model as context. The text is the same as the classic `route` hook produces.
- **Edit learning:** `tool.call` records finished edits for the intelligence consolidator, once per turn.
- **Tool checks:** `tool.check` only tightens. It applies the dangerous-command list and ruflo policy rules that name `claude-code.*` actions (written by the CLI to `.claude-flow/policy/claude-code.json`). It never loosens a verdict. A projection whose mode is `legacy` (or anything but `observe`/`enforce`) is rejected as unreadable, because the CLI never writes one (it deletes the file), so the call is put to you; `/ruflo-mods` shows `policy: <mode> (projection read)` or `policy: unreadable` (ADR-450 T10).
- **Trust gate:** `plugin.register` names what a later-installed mod can do (host commands, network, environment, tool verdicts, agent spawns, prompt changes) and, under `modTrust: refuse-risky`, refuses it unless allow-listed.
- **`$.ruflo`:** other mods add a status segment with `$.ruflo.segment({ id, text })` instead of drawing a second bar; `lastRoute()` and `snapshot()` read what the mod measured. Contract: `types/index.d.ts`.
- **Budget:** `session.measure` applies the cost-tracker budget ladder to live session cost (`costBudgetUsd`); Each rung is announced once per session, even if cost falls and rises again. `costHardStop` halts new subagents at 100%.

The classic `hook-handler.cjs` hooks stay installed and remain the fallback. The mod takes an event only where the classic helper hands it over (`RUFLO_MODS_OWNS`), so nothing fires twice. When the mod is not loaded, every classic hook runs as before.

At user scope, an unrelated project receives no routing context, edit-learning writes or `.claude-flow/mods/session.json` heartbeat. The mod does not initialize projects itself. Tool guards, trust checks and explicitly configured budgets remain active there.

## Toasts (ADR-477)

ruflo-mods draws its toasts through the shared toast policy (one copy of `hooks/toast-policy.ts`, kept identical across the ruflo mods by `scripts/sync-toast-policy.mjs`): a level prefix (`›` info, `✓` ok, `⚠` warn, `✗` error), one clean line of at most 120 characters with secrets masked, an identical toast not repeated for a minute, and at most four a minute per source (errors are held and counted, never dropped). The budget ladder is `info`, `warn`, `error`, `error` (INFO, WARNING, CRITICAL, HARD_STOP); a dropped or held-back delivery is an `error`; `agentTrim`'s one-time note is `info`.

The person's choice is the console's **Settings → Interface and updates → Toasts**: `all`, `important` (warnings and errors) or `off`, and a mute chip per source. Every toast, drawn or not, is kept as a digest the console shows on its Events page, flagged with what became of it; without the console nothing is written and the defaults apply.

## Options

Claude Code reads a plugin's options from `pluginConfigs["ruflo-mods@ruflo"].options` in user settings, `--settings` or managed settings. Project settings are not read for this. Every option has a default:

| Option | Default | Effect and evidence |
|---|---|---|
| `routeContext` | `true` | Include ranked memory with each prompt's route. Evidence: [live paths](../../v3/docs/validation/ruflo-mods-live-paths-2026-10.md) |
| `statusLine` | `true` | One-line ruflo status under the prompt; skipped where the ruflo statusLine helper is configured. Evidence: [live paths](../../v3/docs/validation/ruflo-mods-live-paths-2026-10.md) |
| `costBudgetUsd` | `0` (off) | Session budget for the 50/75/90/100% ladder; each rung is announced once. Evidence: [capability review](../../v3/docs/validation/mod-capability-review-2026-10.md) |
| `costHardStop` | `false` | Refuse new subagents at 100% of the budget. Live canary run: [evidence](../../v3/docs/validation/ruflo-mods-compact-live-2026-10.md) (10/14 recalled with it on, 0/7 off); design in [ADR-404](../../v3/docs/adr/ADR-404-claude-code-mods-function-hooks.md) |
| `toolHints` | `false` | Add one short static hint, restating the project's own CLAUDE.md, to a few ruflo MCP tool descriptions. Live: hints appear on exactly the hinted tools, none when off. Evidence: [live validation](../../v3/docs/validation/ruflo-mods-live-2026-10.md) |
| `agentTrim` | `false` | Keep agent types the project does not use out of the agent listing. Measured saving about 4,000 tokens per request (4,236 on a 69-type catalogue, one model); a hidden type the prompt does not name is refused at dispatch, one the prompt names can still be dispatched. Evidence: [trim measurement](../../v3/docs/validation/ruflo-mods-trim-measure-2026-10.md) |
| `agentTrimKeep` | empty | Comma-separated agent type names `agentTrim` must keep offered. Evidence: [live validation](../../v3/docs/validation/ruflo-mods-live-2026-10.md) |
| `deliveryScreen` | `false` | ADR-451 screen: drops peer, relay or webhook deliveries that carry injection phrasing and refuses outgoing messages that carry a secret shape; never screens your own Remote Control prompts; names the rule, never the text. Caught 76% of its own 50-injection test set before the rules were tuned on it (figure from the PR #3741 description, not a repo doc); the real-world rate is unknown. No live evidence doc yet; design in [ADR-451](../../v3/docs/adr/ADR-451-mod-capability-roadmap.md) item 3 |
| `compactCarry` | `false` | `session.compact` (ADR-451 item 7): appends at most 600 characters to what the compaction summary keeps: swarm id, topology word, agent count, open claim ids and status, last route agent, budget and policy words. Fixed words and identifiers only, screened, fails open, skipped when no swarm or claim is open. No live evidence doc yet; design in [ADR-451](../../v3/docs/adr/ADR-451-mod-capability-roadmap.md) |
| `capabilityProbe` | `false` | Observability only (ADR-451 item 5): `/ruflo-mods` gains `probe: engine <version> · events fired n/m · never fired: ...`; reads no payload and never denies, rewrites or delays. Live run: [ruflo-mods-options-live-2026-10.md](../../v3/docs/validation/ruflo-mods-options-live-2026-10.md); design in [ADR-451](../../v3/docs/adr/ADR-451-mod-capability-roadmap.md) |
| `sessionRollup` | `false` | Observability only (ADR-451 item 6): at session end one counter record (no prompt text, inputs or paths) goes to a user-global ledger capped at 50 sessions and 32 KB; `/ruflo-mods` shows the last few. Live run: [ruflo-mods-options-live-2026-10.md](../../v3/docs/validation/ruflo-mods-options-live-2026-10.md); design in [ADR-451](../../v3/docs/adr/ADR-451-mod-capability-roadmap.md) |
| `sessionAttention` | `false` | Observability only (ADR-486): one `attention:` row in `/ruflo-mods` with ruflo-console's four counts (to approve, questions, failed, finished unread), read from `.claude-flow/console/attention.json`. Counts only; nothing gates, denies or delays. |
| `grounding` | `false` | Status only (ADR-487): `/ruflo-mods` gains `grounding: RuvNet Brain: on / not installed / installed, disabled / unknown`, read from `installed_plugins.json` and your settings. It detects Stuart Kerr's optional third-party [ruvnet-brain](https://github.com/stuinfla/ruvnet-brain) plugin by name only; it never calls, installs, blocks or rewrites anything, and ruflo works the same without it |
| `modTrust` | `observe` | `observe` / `refuse-risky` / `off`: the mod trust gate. Evidence: [capability review](../../v3/docs/validation/mod-capability-review-2026-10.md) |
| `modTrustAllow` | empty | Comma-separated plugin ids (`name@marketplace`, e.g. `ruflo-swarm@ruflo,ruflo-console@ruflo`) the gate never refuses. Evidence: [capability review](../../v3/docs/validation/mod-capability-review-2026-10.md) |
| `guidanceContext` | `false` | Screened lexical excerpts (at most five, 4096 characters) from a compiler-exported guidance projection; advisory, cannot authorize tool calls. Design in [ADR-447](../../v3/docs/adr/ADR-447-native-mod-guidance-observation-loop.md); evidence: [native guidance](../../v3/docs/validation/ADR-447-native-guidance-evidence.md) |
| `guidanceLearning` | `false` | Unverified activity observations for independent review; no training or promotion. Evidence: [native guidance](../../v3/docs/validation/ADR-447-native-guidance-evidence.md) |

## Task guidance and observation review (ADR-447)

Export reviewed guidance with a CLI built from this revision. Supply the full
40 or 64 character commit ID containing the reviewed source. The exporter checks
that root and every explicitly supplied local overlay are regular tracked files
whose raw bytes match that commit. It compiles those checked snapshots and binds
their full SHA256 digests into the projection. JSON output also reports each
source's relative path, blob ID and byte length.

```bash
ruflo guidance compile --mod-projection --revision "$(git rev-parse HEAD)" --root ./CLAUDE.md
ruflo guidance compile --mod-projection --revision "$(git rev-parse HEAD)" --root ./CLAUDE.md --local ./CLAUDE.local.md --json
```

Changed source bytes, missing or untracked explicit overlays, symlinks, sources
in another repository, abbreviated IDs and missing local objects reject before
replacing an existing projection. Each source is limited to 1 MiB of valid UTF8.
An empty committed overlay is supported. Unrelated workspace edits are allowed;
the exporter verifies source snapshots, not the Git index or the entire worktree.
Use a full or ordinary shallow checkout. Partial clones and promisor repositories
are refused so older Git cannot fetch missing objects during export. Git overrides
and replacement refs cannot substitute another repository or commit. These checks
run only in the explicit CLI export, never in native prompt or tool hooks.

The checked export is provenance, not a signed acceptance receipt. Project writable
projections remain untrusted advisory data; an independent evaluator must still
bind and verify source, task and artifact evidence before accepting learning.

This reuses the Guidance Control Plane compiler. The default destination is
`.claude-flow/mods/guidance/projection.json`. `--output` overrides its directory;
the native mod reads only the default project path. No embeddings, optimizer or
model calls are used. Retrieval is lexical, at most five excerpts and 4096
characters. Missing, oversized, symlinked or corrupt advisory data adds no context.
Screening reduces exposure to credentials and injection; it does not grant trust.

Enable the two independent options through Claude Code user settings:

```json
{
  "pluginConfigs": {
    "ruflo-mods@ruflo": {
      "options": { "guidanceContext": true, "guidanceLearning": true }
    }
  }
}
```

`guidanceLearning` records observations, despite its compatibility-oriented name. A project that does not own `route` records none (it still gets `guidanceContext`). Tool ids past 256 per task are not counted; `/ruflo-mods` reports how many.
Each registration lifetime owns a separate queue under
`.claude-flow/mods/guidance/observations/`. Records contain generated task IDs,
bundle digest, source revision, displayed rule IDs, permission counters, tool
execution counters and completion class. They contain no prompt, answer, command,
tool output or file path. A successful tool call and a completed turn stay
`verified: false` and `learningEligible: false`. With guidanceContext disabled,
observations correctly contain no displayed rule IDs.

```bash
ruflo guidance mod-candidates --json
ruflo guidance mod-candidates --bundle-id <64-character-bundle-digest> --json
```

The report groups observations into review priorities, rejecting forged verified
flags, unknown fields, replayed records and mismatched queue namespaces. It writes
no accepted guidance ledger, memory, policy or source file. Task-bound independent
acceptance evidence, a held out baseline comparison and authorized promotion are
required before these observations can support trusted learning. Keep candidates
outside CLAUDE.md and CLAUDE.local.md until that review completes.

Review reasons identify observed tool errors, denied checks or calls, and aborted
or interrupted turns. Each rule reports exposure counts, affected observations,
completed turns and rates with explicit denominators: errors divided by executed
tools (ok + error), and denials divided by permission checks (allow + ask + deny).
An empty denominator produces null. Global totals count each observation once,
even when it displayed several rules, and include turns without guidance. Ties
use the full version identity for deterministic reports. These are correlations:
completion is not accepted success and a displayed rule is not a proven cause.

Queues retain at most 128 observations per registration lifetime and 256 KiB.
Flushes serialize in the process and retry refused writes without overwriting
unreadable or corrupt existing bytes. Native filesystem writes cannot guarantee
atomic persistence through a crash; a hot reload can lose an unfinished turn.
The review command accepts at most 128 queue files per batch. Archive reviewed
queues explicitly outside the active directory. `/ruflo mods` reports saved,
pending and dropped observations. These counts are activity, not correctness.

## Tests

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/ruflo-mods   # real engine; needs the rollout switch on
cd v3/@claude-flow/cli && npx vitest run __tests__/mods/                      # declaration-faithful harness, parity tests
bash plugins/ruflo-mods/scripts/smoke.sh                                       # static security contract
bash plugins/ruflo-mods/scripts/native-guidance-smoke.sh                       # three configured native guidance contracts
```

To typecheck, load the plugin once (Claude Code >= 2.1.287 writes its declarations into `.claude-plugin/types/`), then run `npx tsc -p plugins/ruflo-mods`.

The separate CLI adapter check is `tsc -p v3/@claude-flow/cli/tsconfig.mod-guidance.json`.
The `Native mod guidance source contracts` workflow runs the adapter types,
security smoke and source mod suites on every PR to main and every main push,
using locked dependencies without lifecycle scripts. It uses the CLI workspace
compiler aliases. The new native kit file stays outside ordinary root Vitest;
the source E2E suite runs in this dedicated workflow. Native engine declarations,
the complete native suite and built CLI tests remain separate provisioned gates.

The focused native guidance smoke uses a disposable plugin copy with explicit
feature options because the 2.1.283 test kit ignores per-test option overrides.
It runs the three feature contracts against unchanged production hooks. The
default settings contract belongs to the standard suite. A rollout gate still
applies, and the focused result must not be reported as the complete native suite.
