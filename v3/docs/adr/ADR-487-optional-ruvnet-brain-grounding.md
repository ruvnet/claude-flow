# ADR 487: Optional ruvnet-brain grounding in the console and mods

Status: Accepted

Date: 2026-10-09

Builds on: ADR-404 (ruflo as a mod), ADR-443 (missions Claude knows about), ADR-444 (Claude controls the console), ADR-481 (text is never silently truncated, the model-facing sanitiser), ADR-450 (mod trust)

Numbering: ADR-484 is held by an open change (external marketplace plugins), ADR-485 by the x-gateway GitHub query tools and ADR-486 by the session workspace; this is 487.

## 1. Context

`ruvnet-brain` (github.com/stuinfla/ruvnet-brain, by Stuart Kerr) is a third-party Claude Code plugin that grounds answers about the ruvnet ecosystem. It ships one MCP search tool, `search_ruvnet` (surfaced in a session as `mcp__plugin_ruvnet-brain_ruvnet-brain__search_ruvnet`), and its own grounding hook and write gate. The owner asked for ruflo-console and ruflo-mods to make use of it **when it is there**, and to work exactly as today when it is not.

Facts that shape the design:

- Claude Code plugins cannot declare dependencies on other plugins. "Depends on" can only mean "detects".
- Its licence is ambiguous (GitHub reports "Other", the README says MIT). We cannot assume a right to copy, bundle or redistribute its code, corpus or prompts.
- It has its own write gate. A second gate on top would duplicate it and could fight it.
- Installed plugins are recorded in `~/.claude/plugins/installed_plugins.json` (key `name@marketplace`, here `ruvnet-brain@ruvnet-brain`) and switched on or off by `enabledPlugins` in the merged settings. The console already reads both (`data/snapshot.ts`), and a mod can read both (`$.fs`, `$.settings.read()`).

## 2. Decision

**Detect the brain by its exact plugin id, report a status word, and add at most one fixed line to the hand-off. Never call, install, gate or copy it.**

### 2.1 Constraints (each is tested or smoke-checked)

- **(a) Not a dependency.** ruflo works identically with the brain absent: every path takes the plugin facts the snapshot already holds and returns a status, a boolean or a constant; an unreadable fact is `unknown`, never an absence. This mirrors the MetaHarness rule in the root CLAUDE.md (removable, graceful degradation). `plugins/ruflo-console/scripts/smoke.sh` step 20 and `plugins/ruflo-mods/scripts/smoke.sh` step 15 prove it statically (no tool call, shell, network, write, prompt or brain tool id from the grounding code; nothing named for the brain is shipped), and `tests/grounding.spec.ts` runs the brain-absent paths and asserts the context text is byte-identical to the pre-change text.
- **(b) Nothing of the brain is vendored.** The code names the plugin and links its repository. No content, corpus, code, prompt or schema of it is copied or redistributed.
- **(c) Read-only.** Nothing blocks, writes or gates on the brain's behalf; it is never auto-installed; its tool is never called from a hook or the console.
- **(d) The install hint is off by default**, dismissible (persisted), and shown at most once per session.
- **(e) Factual status only.** The text says on / not installed / installed, disabled / unknown, and makes no claim about answer quality.

### 2.2 Detection

`brainStatus` (console) and `detectBrain` (mods) answer:

| Status | When |
|---|---|
| on | `ruvnet-brain@ruvnet-brain` is in `installed_plugins.json` and `enabledPlugins[id] === true` |
| installed, disabled | installed, and not `true` in `enabledPlugins` |
| not installed | the plugin list was read and has no entry for that exact id |
| unknown | the list or `enabledPlugins` could not be read or is malformed |

Only the exact id counts. A plugin that is merely *named* `ruvnet-brain` from another marketplace is "not installed" (the spoofed-name case). The two implementations are separate small copies, because plugins may not import each other.

What was **not** done: calling `$.tool.check` or listing tools to see whether `search_ruvnet` exists. The console host has `toolCheck`/`listCommands`, but whether either reports another plugin's MCP tool from inside a running mod was not spiked in an interactive session; the file-based check is deterministic and testable. See section 6.

### 2.3 Console (0.42.0)

- **Overview** gains a `Grounding` line (status, plus "optional third-party plugin; ruflo works the same without it").
- **Settings** gains two rows. `RuvNet Brain nudge` (default **on**): the line below. `RuvNet Brain install hint` (default **off**): the hint.
- **The nudge.** When the brain is `on`, the nudge setting is on, and the mission's objective, active task title or requirement, or attached ADR block names the ruvnet stack, the mission-context section Claude's prompt carries gains one line: `Ground ruvnet-stack decisions with search_ruvnet before writing code.` The line is a **constant**; no mission text is interpolated into it. It goes out through `modelLine` (the single model-facing sanitiser, ADR-481) and is dropped, not sent raw, if the sanitiser withholds it. The context key changes only when the line appears or disappears, so the prompt cache holds otherwise.
- **The matcher** (`mentionsStack`) takes untrusted text and returns only a boolean. It is one linear pass over at most 8,000 characters, with a curated whole-token list (`ruvector`, `rvf`, `agentdb`, `ruflo`, `rulake`, `ruqu`, `rvdna`, `ruview`, `rvlite`, `agenticow`, `safla`, `qudag`, `synthlang`, `metaharness`, `ruvllm`, `ruvnet`, and the pairs `claude flow`, `agentic flow`, `ruv fann`). Words that are common outside the stack (`sparc`, `hnsw`, `fact`, `flow`, `vector`) are deliberately absent: the console's own plans say SPARC in every mission.
- **The hint.** With the setting on, the brain `not installed`, and not dismissed: one toast per session and an Overview line with the repository link and a **Dismiss** button. Dismissal is stored with the AI preferences and survives restarts; turning the setting off then on re-arms it.

### 2.4 Mods (0.5.0)

A read-only option `grounding` (default **false**). On: at `session.start` the mod reads `installed_plugins.json` (under `$CLAUDE_CONFIG_DIR`, else `$HOME/.claude`, size-capped) and the merged settings it already reads, and `/ruflo-mods` gains a `grounding:` row with the same four words. It registers no event, answers no verdict, writes nothing, and the capability-probe event list is unchanged. Off, the row says `off (set the grounding option)` and nothing is read.

## 3. Threat model

- **Prompt injection through brain output** is out of scope by construction: nothing here ever calls the brain or reads its output.
- **Injection through the text we match.** The matcher consumes mission text but emits a boolean; the only model-facing text is the constant. A hostile objective cannot change the line (tested with escape sequences, a token-shaped string and an instruction).
- **Spoofed plugin name.** Only `ruvnet-brain@ruvnet-brain` counts; a look-alike id from another marketplace reads "not installed". This is not a trust decision about the real plugin: a status of "on" means "installed and enabled", not "vetted". A malicious plugin that took over that marketplace id would earn only the fixed nudge line.
- **ReDoS / cost.** No regular expression touches user text in the matcher; megabyte inputs of hostile shapes are scanned in bounded time (tested).
- **Hint nagging.** Default off; at most one toast per session; one click to dismiss for good; the Overview line disappears once dismissed.
- **A wrong "not installed".** Unreadable plugin data is `unknown`, and the hint is only due on a positive "not installed".

## 4. Alternatives rejected

- **A hard dependency** (require the plugin, fail without it): impossible to declare, and it would break the removability rule.
- **Vendoring** the brain's corpus, prompts or code into ruflo so it always works: licence ambiguity (GitHub "Other" against README MIT) gives no safe right to redistribute; it would also freeze a copy of someone else's moving data. Reference by name and link only.
- **Calling `search_ruvnet` from a hook** or pre-fetching: ingests third-party output into our prompts (the injection path we rule out), costs tokens on every prompt, and second-guesses the brain's own grounding hook.
- **Gating or blocking** when the brain is present but unused: duplicates its write gate.
- **The x.ruv.io gateway GitHub tools** as a fallback grounding source: a separate feature, not in this change.

## 5. Consequences

- Console 0.42.0 and mods 0.5.0. No lockfile, npm package, or marketplace change; the console ships via the git marketplace.
- `PluginsFacts` gains an optional `enabledKnown` so a missing `enabledPlugins` is `unknown`, not "disabled".

## 6. Verification and what is not verified

`plugins/ruflo-console/tests/grounding.spec.ts` (detection matrix incl. malformed and spoofed data, matcher positives, negatives and adversarial inputs, nudge byte-identity with the brain absent, the sanitiser path, hint default-off and once per session, dismissal persistence, both pages) and `plugins/ruflo-mods/tests/grounding.test.ts` (the same matrix, the option, the report row end to end through the mod).

Not verified: that detection works from inside a running mod through the engine's tool list (only the file-based path was exercised, including against the real `~/.claude/plugins` data, read-only); whether `enabledPlugins` in the merged settings reflects a plugin enabled only at project scope in every Claude Code build.
