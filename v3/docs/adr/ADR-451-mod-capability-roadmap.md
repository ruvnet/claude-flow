# ADR 451: Mod capability roadmap: what the Claude Code mod API can do that ruflo does not use yet

Status: Proposed; items 1-3 and 5-7 implemented (ruflo-mods 0.3.9), all default off; items 4, 8, 9, 10 not built. See section 8.

Date: 2026-10-04

Builds on: ADR-404 (ruflo as a mod), ADR-445 (AgentDB as a mod), ADR-446 (the plugin fleet as mods), ADR-447 (guidance observation loop)

Related: ADR-449 (guidance learning loop), ADR-450 (mod-system threat model; its T19 is the risk item 4 must respect), ADR-452 (overnight hardening record)

Evidence: `v3/docs/validation/mod-api-coverage-2026-10.md` (the full coverage table)

## 1. Context

ruflo ships 44 plugins with function-hook modules. The coverage table shows they use 18 of the 43
engine events and none of the 33 `classic.*` events. The unused events are not random: they are
the ones that change **what the model sees and spends** (`tool.describe`, `agent.offer`,
`turn.step`, `session.compact`, `prompt.attachment`) and the ones that **screen what reaches the
session** (`session.receive`, `session.send`, `session.append`). Of the `$` nouns, `model`,
`agent.register/spawn` and `state` are unused, and `$.store` (kept between sessions) holds only view
state. Today ruflo's mod guard covers tool permission and subagent spawns, and nothing else.

Build under test: Claude Code 2.1.287. Where this ADR says "the d.ts", it means that build's
`types/claude-code.d.ts`. Nothing here was checked against 2.1.277-2.1.286 declarations.

## 2. Decision

Adopt the roadmap in section 3 as the ordered backlog for the mod system. Every item is a new
**option, default off**, behind the existing `userConfig` pattern, tighten-only where it touches a
verdict, with a measurable acceptance test. Item 1 is prototyped in this change; the rest are not
started.

Ranking rule: expected value to a ruflo session, divided by the risk of changing the model's
behaviour or the spend, with implementation cost as a tie-break. Impact figures are estimates unless
marked measured; none of items 2-10 has been measured.

## 3. Top 10, ranked

### 1. `tool.describe` hints on ruflo's own MCP tools (PROTOTYPED, default off)

- **Design.** `ruflo-mods` option `toolHints`. For tool names `mcp__(plugin_ruflo-core_ruflo|claude-flow|ruflo)__<name>`
  where `<name>` is in a six-entry table, append `\n\nruflo: <one line>` to the description the
  engine computed (`{ ...await next(e), description }`, so `isDeferred` is kept). Each line restates
  what the project's CLAUDE.md already says (for example: `memory_search` searches AgentDB only,
  `memory_search_unified` also covers Claude memories and patterns).
- **Guard-rails.** Off by default. Static text only: the d.ts says a `tool.describe` answer is cached
  for the session and "an unstable answer spends the model's prompt cache". Lines are at most 160
  plain-ASCII characters (tested). Idempotent (a marked description is not marked twice). Other
  servers, tools outside the table, and names like `constructor` are returned byte-identical
  (tested). Appends text only; it cannot authorise or deny anything. Rollout flag: if the hooks module
  is held off, nothing changes.
- **Impact.** Unmeasured. The hint reaching the model is measured (validation doc section 7).
- **Acceptance test.** A/B over 20 fixed prompts (10 where `memory_search_unified` is right, 10
  where `memory_search` is), haiku and sonnet, option on versus off, `claude -p --output-format json`
  with the real ruflo MCP server connected: the share of first-choice tools that match the label is
  at least 15 points higher with hints on, and total input tokens rise by at most 1 percent. If not,
  delete the table.
- **Not done here.** The plugin version is not bumped and `ruflo-console`'s settings view does not
  list the new option yet (it lists mod options in `hooks/settings.ts`). Both belong to the
  integration owner.

### 2. `agent.offer`: trim the agent listing to the types a project uses

- **Design.** Hook `agent.offer`; return `{ isOffered: false }` for agent types outside an
  allow-list built from `$.store` usage counts plus a pinned core set (`coder`, `reviewer`, `tester`,
  `planner`, `researcher`, anything the user names). The engine offers every type "in the agent
  listing and again at dispatch" (d.ts), so a hidden type is also refused at dispatch.
- **Why it matters.** This session's Agent tool lists about 100 agent types; each costs tokens on
  every request that carries the listing. The size in tokens is UNMEASURED.
- **Guard-rails.** Option `agentTrim` default off, shows a one-time toast naming the count hidden,
  `/ruflo-mods agents` lists and restores them, never hides a type used in the last 30 days or one the
  prompt names. Fail open: any error offers the type.
- **Acceptance test.** `claude -p --output-format json "reply ok"` input tokens, option on versus off,
  in this repo: at least 3,000 fewer input tokens; zero failed `Agent` dispatches over a 20-task replay.

### 3. `session.receive` and `session.send` screens for federation and peer messages

- **Design.** `session.receive` fires "when a delivery reaches the session (a relay's event, a peer's
  message, a Remote Control prompt), before it is queued" and accepts `{ consumed: reason }`. Run the
  existing in-process pattern screen (`guidance/screen.ts` style, no model call) and, for a hit,
  consume the delivery and toast the reason. `session.send` gets the same screen for outbound text
  (secrets, PII) before it leaves for another agent.
- **Guard-rails.** Tighten-only (consume or pass; never rewrite into trusted text). Option
  `deliveryScreen`, default off; the matched rule id is shown, never the matched text. No network, no
  model.
- **Acceptance test.** A fixture corpus of 50 injection strings and 50 benign peer messages: at least
  90 percent of the first consumed, at most 2 percent of the second, and a consumed delivery never
  reaches `session.append`.

### 4. Call-time capability governor via op events (feasibility UNVERIFIED)

- **Design.** The trust gate (ADR-404) judges a module at load. Op events (`model.complete`,
  `http.fetch`, `process.run`) are hookable; if a user-tier hook sees other plugins' calls, a
  governor can count and cap them per plugin (calls and dollars), turning "can do" into "did".
- **Guard-rails.** Observe first (count and report in `/ruflo-mods`), enforce only behind
  `modTrust: refuse-risky`, deny with a reason, never allow.
- **Blocking unknown.** Whether another plugin's op calls pass through ruflo-mods' hooks is not
  established (coverage doc 3b). First step is a two-plugin test, 1 hour, no product code.
- **Acceptance test.** Plugin A calls `$.http.fetch` three times; the governor, with a cap of two,
  denies the third and reports `A: 3 calls, 1 denied`.

### 5. Capability probe and churn watchdog

- **Design.** At `session.start` record `$.session.version()` (UNUSED today), the events the module
  registered, and, per event, whether it fired this session, into the existing heartbeat file. `ruflo
  mods doctor` flags "registered but never fired" and a version that changed since the last session.
- **Guard-rails.** Read and write only the existing `.claude-flow/mods/session.json`; no new
  permission. Always on is acceptable here because it spends nothing, but ship it as an option first.
- **Acceptance test.** With the rollout switch off (or a build that does not load modules) doctor
  reports `module not loaded` within one command; with it on, every registered event that fired shows
  a count.

### 6. `$.store` cross-session ledger plus a `session.end` rollup

- **Design.** At `session.end` (budget from `next.budget`) append one record: routed prompts, edits,
  tightened calls, final cost, route accuracy signals ADR-447 already collects. Keep a 200-entry ring
  in `$.store` (4 MiB cap per the d.ts, so about 1 KiB per record is far under it). `/ruflo mods`
  shows the trend; ruflo-intelligence can read it.
- **Guard-rails.** Counters only, no prompt text (so nothing to screen); fail silent; honours the
  1.5 s SessionEnd budget the Claude Code hooks page documents (https://code.claude.com/docs/en/hooks).
- **Acceptance test.** Three scripted sessions leave three records; kill -9 during the third leaves the
  first two intact.

### 7. `session.compact`: carry swarm and claims state through compaction

- **Design.** Append (never replace) a short `instructions` block naming the live swarm id, topology,
  open claims and last route, so the summary keeps them. Skip nothing.
- **Guard-rails.** Append-only, 600 characters, option `compactKeep` default off; if the block would
  exceed the cap, send nothing.
- **Acceptance test.** Seed a canary swarm id, force `/compact`, ask for it: present with the option
  on, absent (control) with it off.

### 8. `turn.step` downshift at the budget rungs

- **Design.** An async-generator hook; when the ladder (`ruflo-mods` cost) is at WARNING or higher,
  `next({ ...e, effort: 'low' })`; at CRITICAL also a cheaper `model`. Never upshift.
- **Guard-rails.** Option `costDownshift` default off; one toast per rung; the d.ts notes a streaming
  hook's budget counts its own code only, and that a model change spends the prompt cache, so downshift
  once per rung, not per step.
- **Acceptance test.** A replay that crosses 75 percent shows the next request at the lower effort and
  total cost for the remaining turns at least 20 percent lower than control; no step is ever raised.

### 9. `$.model.classify` as a spend-gated route fallback

- **Design.** When the lexical router's confidence is under 0.5, ask `$.model.classify(text, labels)`
  (default: the engine's small fast model) to pick among the route labels.
- **Guard-rails.** Option `classifyFallback` default off; at most N calls per session (default 20);
  skipped at WARNING or higher; `classify` rejects on a failed request, so wrap and fall back to the
  lexical route; prompt text is data only. It spends on the person's own session client.
- **Acceptance test.** On a labelled set of 100 prompts, route accuracy rises by at least 10 points
  with the fallback and the added cost is at most $0.02 per 100 prompts.

### 10. `$.agent.register` swarm lanes and hash-pinned mod trust

- **Design.** Two small items, ranked last because each needs a feasibility answer first.
  (a) Register `ruflo:<role>` agent types from an `AgentSpec` with least-privilege `tools` and a
  model tier per ADR-026, in place of 100 markdown agents. (b) Pin the trust gate to a hash of each
  mod's source so a changed module is re-reviewed, as Codex does for hooks (section 5). The mod
  environment has no Node, so hashing needs a host command (`$.process.run`), which the trust gate
  itself flags; feasibility UNVERIFIED.
- **Acceptance test.** (a) a spawn of `ruflo:coder` has no `Bash` when the spec omits it; (b) editing a
  trusted mod changes its status to `needs review` at next load.

## 4. Risks of API churn and the compatibility strategy

Facts, with where they come from:

| Fact | Source |
|---|---|
| 2.1.287 loads mods by default; 2.1.282 only with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` | ADR-404 |
| A server-side switch `tengu_plugin_hooks_modules`, cached in `~/.claude.json`, can hold modules off whatever the variable says; it "flipped between on and off several times in one afternoon, and between two accounts on this machine" | ADR-404 |
| 2.1.277-2.1.286 stay off without the variable | plugins/ruflo-mods/README.md |
| 2.1.283 ignores the testing kit's per-test `options`; a disposable copy that enables the feature at registration is the workaround | `plugins/ruflo-mods/scripts/native-guidance-smoke.sh` header |
| A stale `claude` earlier on PATH (2.1.107 beside 2.1.287) decides which build runs | ADR-404 |
| Managed or Team/Enterprise orgs seat `sec-default` outermost; it continues past the user tier on `prompt.context`, `prompt.section`, `prompt.compose`, `settings.read`, `classic.*` | ADR-404 |
| The API is "early access and moves between releases: the declaration file is the authority" | bundled `reference.md` |

Strategy:

1. **Everything new is an option, default off, and removable.** The classic hook path stays the
   default (ADR-404); a mod that is not loaded costs nothing and breaks nothing.
2. **No feature depends on an event in `sec-default`'s pass-through list.** `tool.describe`,
   `agent.offer`, `session.receive`, `session.compact` and `turn.step` are not on it, but whether a
   managed org can still hold them off is UNVERIFIED; the doctor (item 5) is how a person finds out.
3. **Probe, do not assume.** Item 5 records the engine version and which events fired. The d.ts is
   regenerated by each build when `plugin-authoring` loads: add a CI job that extracts the event
   and op names from it and diffs them against a checked-in manifest of the names ruflo hooks, so a
   removed or renamed event fails a build before it fails a user.
4. **Test against more than one build.** `claude plugin test` on the pinned build and on latest; for
   behaviour that depends on options, use the disposable-copy approach (because of the 2.1.283
   behaviour above). Run `echo hi | claude -p "say ok" --model haiku` once in a scratch dir first if
   the test says the rollout switch is off.
5. **Fail open.** A hook that fails is skipped and the chain continues (the bundled reference says so),
   and `register` must not throw: new registrations sit behind `if (opts.<flag>)` as in this change.
6. **Not verified here:** whether `on('<unknown event>')` throws on an older build. Item 5's CI diff
   makes it moot; until then keep new events behind their flag.

## 5. What comparable systems do better (with sources)

Sources were fetched by a research pass on 2026-10-04; "summary-grade" means the page was read
through a summarising fetch, not line by line.

- **Typed, declarative hook decisions and per-handler budgets: Claude Code's own hooks.** Five
  handler types (command, http, mcp_tool, prompt, agent), typed outputs (`permissionDecision` allow,
  deny, ask, defer; `updatedInput`; `additionalContext`), a declarative `if` filter in permission-rule
  syntax, per-type timeouts, fail-closed only for a PreToolUse timeout, a 1.5 s shared SessionEnd
  budget. https://code.claude.com/docs/en/hooks (summary-grade). Lesson for ruflo: declare each
  feature's failure mode and time budget explicitly (this ADR's guard-rails do).
- **Hash-pinned trust and a review surface: OpenAI Codex hooks.** Non-managed hooks need explicit
  trust recorded against the hook's content hash, so a changed hook is skipped until re-trusted;
  `/hooks` lets a person inspect and disable; SessionEnd gets about 1 second.
  https://learn.chatgpt.com/docs/hooks (summary-grade). Lesson: roadmap item 10(b).
- **Model-level events: Gemini CLI hooks.** BeforeModel, AfterModel and BeforeToolSelection (filter
  the tools offered), AfterAgent can force a retry. https://geminicli.com/docs/hooks/ (summary-grade).
  ruflo already has the equivalents in the mod API (`turn.step`, `tool.describe`, `agent.offer`) and
  does not use them: that is the gap this roadmap closes.
- **In-process plugins that register tools: opencode.** TS/JS plugins with `tool.execute.before/after`
  and a `tool()` helper that registers custom tools. https://opencode.ai/docs/plugins/ (summary-grade).
  The mod API has `$.tool.register`; only ruflo-console uses it.
- **Declared capabilities plus consent: VS Code.** `capabilities.untrustedWorkspaces` as `true`,
  `false` or `'limited'` with a mandatory reason; no declaration defaults to disabled.
  https://code.visualstudio.com/api/extension-guides/workspace-trust (summary-grade). Claude Code's
  plugin manifest has typed `userConfig` and `sensitive` values but, in the page read, no capability
  declaration (https://code.claude.com/docs/en/plugins-reference): ruflo's trust gate fills that gap
  by reading the module source; item 4 extends it to call time.
- **Guards that run beside the model: OpenAI Agents SDK guardrails.** Input guardrails run in
  parallel with the agent by default, or blocking first to prevent spend and side effects; a tripwire
  halts the run. https://openai.github.io/openai-agents-python/guardrails/ (summary-grade). Lesson:
  each ruflo guard should state parallel versus blocking; `session.receive` screens (item 3) are
  blocking by construction.
- **Tool metadata and tool-list caching: MCP.** Tools carry `title`, `outputSchema`,
  `structuredContent`, annotations (clients must treat them as untrusted unless the server is), a
  `listChanged` notification and `ttlMs` caching with deterministic ordering "to protect prompt-cache
  hits". https://modelcontextprotocol.io/specification/latest/server/tools (summary-grade). Supports
  item 1's static-text rule.
- **Elicitation: MCP.** A tool can ask the person through a form or URL mode, with accept, decline,
  cancel. https://modelcontextprotocol.io/specification/latest/client/elicitation (summary-grade).
  Hooks have no equivalent of a server asking the host; `$.ui.ask` is the nearest mod call.
- **Capability negotiation: LSP.** `initialize` exchanges client and server capabilities.
  https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#initialize
  (cited by the research pass, not independently opened by me). Lesson: item 5.
- **Tracing: OpenTelemetry GenAI conventions.** `invoke_agent` and `execute_tool` spans.
  https://github.com/open-telemetry/semantic-conventions-genai . I saw no stability label, so whether
  they are stable is UNVERIFIED; not on the roadmap for that reason.

Thin or missing, said plainly: Cursor, Cline, Roo, Pi (pi-mono) and LangGraph middleware were not
researched. Chrome MV3 permissions were not fetched (UNVERIFIED). MCP sampling, roots and tasks, and the
Claude Code skills, subagents and changelog pages were not opened. Every source above is summary-grade,
a fetch that returned a model summary rather than raw text. The Claude Code docs also carry a mods
reference (`/docs/en/plugins/mods/reference`, named on the plugins-reference page); it was not read.

## 6. The prototype in this change

Files (all under `plugins/ruflo-mods/`): `hooks/describe/hints.ts` (table, matcher, `withHint`),
`hooks/describe/index.ts` (the hook), `hooks/register.ts` (registers it only when the option is on),
`hooks/options.ts`, `hooks/state.ts` (a `/ruflo-mods` line: `tool hints:  off` or `N tool(s)
described`), `.claude-plugin/plugin.json` (option `toolHints`, default false), `scripts/smoke.sh` (the
documented-events list gains `tool.describe`), `tests/describe.test.ts` (5 tests).

Verified: `claude plugin test` 33 pass, 0 fail (28 before, 5 new); `claude plugin validate` passes and
lists `tool.describe{tool=/^mcp__(?:plugin_ruflo-core_ruflo|claude-flow|ruflo)__/}`; `scripts/smoke.sh`
11 of 11; one live `claude -p` check, validation doc section 7.

## 7. Consequences

- Positive: a measured path to change what the model sees at ruflo's tools, at near-zero spend, with
  a stop rule (delete the table if the A/B fails).
- Cost: another option (a ninth) on `ruflo-mods`; a table of hints that can go stale when a tool is
  renamed, like the string-matched guards ADR-446 notes. Mitigation: item 5's doctor, and a test that
  every hint key exists in the CLI's tool registry (not written).
- This ADR changes no default and enables nothing.

## 8. Implementation status (checked 2026-10-05 against `origin/main`)

This section records what shipped; sections 1-7 are left as written on 2026-10-04 (so "item 1 is prototyped in this change; the rest are not started" in section 2 describes that day, not today). No decision above changed. Every PR below was confirmed MERGED with `gh pr view`; versions are `plugins/ruflo-mods/.claude-plugin/plugin.json` on `origin/main` (now 0.3.9) and the commit that first set each option.

| # | Item | Option | Shipped | PR | First in | Default | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | `tool.describe` hints | `toolHints` | yes | #3716 | 0.3.0 | off | Live: `ruflo-mods-live-2026-10.md` section 1 (hint seen under the 2 asked-about tools, none under an untabled tool; status `6 tool(s) described`). The section 3 A/B (15-point gain in correct first choice, at most 1% more input tokens) was **not run**, so the item is shipped but its stop rule is unevaluated. |
| 2 | `agent.offer` trim | `agentTrim` (+ `agentTrimKeep`) | yes | #3729; live fixes #3733, text #3761 | 0.3.1 (wording 0.3.2, 0.3.6) | off | Live: `ruflo-mods-live-2026-10.md` section 2; measured saving: `ruflo-mods-trim-measure-2026-10.md` (#3760). |
| 3 | `session.receive` / `session.send` screens | `deliveryScreen` | yes | #3741 | 0.3.3 | off | Unit tests (`tests/delivery.test.ts`) and the plugin smoke. No live headless run is recorded on `main`, and the 50 + 50 fixture corpus with its 90% / 2% thresholds in section 3 is not recorded here either (not verified). |
| 4 | Call-time capability governor | none | **no** | none | none | n/a | The two-plugin feasibility test was run for ADR-450 T19 (#3737, #3740): a user-tier hook saw another plugin's `http.fetch` calls. No governor code exists. T19 constrains it: act only on `origin.tier === "user"`, never deny a built-in origin, log host and count only. |
| 5 | Capability probe | `capabilityProbe` | yes | #3763 | 0.3.7 (0.3.6 went to the #3761 wording fix) | off | Unit tests (`tests/probe.test.ts`) and the plugin smoke, which asserts the probe hook never denies or rewrites. **Live run recorded** in `v3/docs/validation/ruflo-mods-options-live-2026-10.md` (#3770): the report line and heartbeat fields appear with the option on and not off, a Bash call still ran, `engine.create` fired and `plugin.register` never did (cause unknown). That run also found a doubled `probe:` label, fixed in #3771. The CI diff of event names against a manifest (section 4, point 3) is **not** built. |
| 6 | `session.end` rollup ledger | `sessionRollup` | yes | #3766 | 0.3.8 | off | Unit tests (`tests/rollup.test.ts`) and a **live run** in `v3/docs/validation/ruflo-mods-options-live-2026-10.md` (#3770: exactly one whitelisted record per session, a second session appends, a runtime-built fake secret appears nowhere). As built: counters only, last 50 sessions, under 32 KB, user-global (the design said a 200-entry ring in `$.store`); the kill -9 test in section 3 is not recorded (not verified). |
| 7 | `session.compact` carry | `compactCarry` (design name `compactKeep`) | yes | #3768 | 0.3.9 | off | Unit tests (`tests/compact.test.ts`) plus a live canary run ([ruflo-mods-compact-live-2026-10.md](../validation/ruflo-mods-compact-live-2026-10.md)): the acceptance test passes (ON: id in the answer 10/14, in the summary 9/9 measured; OFF: 0/7; malformed state fails open 6/6); subagent compaction not tested live. |
| 8 | `turn.step` downshift | none | **no** | none | none | n/a | Not started. |
| 9 | `$.model.classify` route fallback | none | **no** | none | none | n/a | Not started. |
| 10 | `$.agent.register` lanes, hash-pinned trust | none | **no** | none | none | n/a | Not started; the feasibility question (no Node in the mod environment) is still open. |

### What the measurements say

- **`agentTrim` saving (measured, `ruflo-mods-trim-measure-2026-10.md`):** 4,236 prompt tokens per request, about 18% of that session's prompt, with 59 of 69 agent types hidden (about 72 tokens per hidden type; haiku, one catalogue, 3 repetitions, spread 139 tokens off and 44 on). That clears the 3,000-token bar in section 3 item 2. The 20-task replay with zero failed `Agent` dispatches was **not** run.
- **Corrected dispatch behaviour (same doc):** an unused type the prompt does not name is **refused at dispatch**, as the design in item 2 says. The earlier live note (`ruflo-mods-live-2026-10.md`, claim 1) that "a hidden type still spawns by name" is right only when the spawn prompt names the type (the `isKept` prompt-name rule keeps it at dispatch). In a headless session a prompt-named type is not added back to the listing, so `agentTrimKeep` is the reliable way to keep one. The option text was corrected in 0.3.2 and 0.3.6; behaviour never changed.
- **Latency:** `mod-hook-latency-2026-10.md` (measured before items 3-7 existed) found about 18-21 microseconds per unrelated `tool.call` across the 40 plugins that register one. It does not cover the later options.
- **Other validation docs on `main`:** `ruflo-mods-live-paths-2026-10.md` (routing, the deny list, the `session.json` heartbeat and `/ruflo-mods`, all proven live) covers the base mod, not the options above; `ruflo-mods-options-live-2026-10.md` (#3770) covers `capabilityProbe` and `sessionRollup`. `compactCarry` has a live run (`ruflo-mods-compact-live-2026-10.md`); `deliveryScreen` has none.

### Still open from sections 4 and 7

The event-name CI diff, the check that every hint key exists in the CLI tool registry, and the A/B for item 1 are not built or run.
