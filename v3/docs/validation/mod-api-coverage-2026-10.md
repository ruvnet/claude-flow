# Mod API coverage: what ruflo uses and what it does not (2026-10)

Date: 2026-10-04
Supports: ADR-451 (mod capability roadmap)
Build measured: Claude Code **2.1.287** (`claude --version`), the only declaration file on this machine.

## 1. Method, and what this does not show

- **API surface** is read from `types/claude-code.d.ts` (20,116 lines) in the newest bundled
  `plugin-authoring` skill folder (`bundled-skills/2.1.287/…/plugin-authoring/types/claude-code.d.ts`):
  `EngineEventOf` (43 engine events, line 3715), `ClassicHookEvent` (33 classic events), `OpEventOf`
  (line 6382) and `CoreEngineInterface` (the `$` nouns, line 2131).
- **Usage** is what `claude plugin validate <plugin>` prints under `hooks:` and `calls:` for each of
  the 44 ruflo plugins whose `hooks/hooks.json` names a module (the engine's own read of the source,
  including calls reached through a helper, `(via hostOf)`), cross-checked with a literal grep for
  `on('<event>'` and `$.<noun>.<method>` under `plugins/*/hooks`.
- **Not shown:** whether an event fires in a given process (the rollout switch can hold modules off,
  see ADR-451 section 4); behaviour differences between builds. Only the 2.1.287 declarations were
  available, so **no event list for 2.1.277-2.1.286 was diffed** and none is claimed.
- Event semantics come from the doc comment of each event in the d.ts. Rows marked "(name only)"
  were not read beyond their name and signature.

Reproduce (needs a `claude` on PATH, no network): `for d in $(grep -l modules plugins/*/hooks/hooks.json | xargs -n1 dirname | xargs -n1 dirname); do claude plugin validate "$d" | grep -E 'hooks: |calls: '; done`

## 2. Summary

| | In the d.ts | Hooked / called by a ruflo mod | UNUSED |
|---|---|---|---|
| Engine events | 43 | 18 (17, plus `tool.describe` from this change) | 25 |
| Classic events (`classic.<Event>`) | 33 | 0 | 33 |
| `$` nouns | 21 | 15 | 6 (`model`, `audio`, `state`, `telemetry`, `config`, `turn`) |
| Op events (every `$` method is also hookable) | about 60 | 1 in production (`ui.close`: console, swarm) | the rest, section 3b |

Fleet shape: the 39 generated mods (ADR-446) hook only `session.start`, `tool.call`, `command.run`.
`ruflo-mods`, `ruflo-console` and `ruflo-swarm` hook the rest.

## 3. Engine events (43)

Used-by key: **mods** = ruflo-mods, **console** = ruflo-console, **swarm** = ruflo-swarm,
**ruos** = ruflo-ruos, **agentdb** = ruflo-agentdb, **fleet** = the 39 ADR-446 mods.

| Event | What it is (d.ts) | Used by |
|---|---|---|
| `tool.call` | before a tool runs; deny or answer | mods (edit recording), console, agentdb, fleet (guards) |
| `tool.check` | permission verdict; tighten-only in ruflo | mods (dangerous commands, policy, ADR-440 research guard), console |
| `tool.describe` | the description the model reads, once per tool per session, cached; may also set `isDeferred` | **mods, this change (option `toolHints`, default off)** |
| `ui.render` | every component the engine draws | console, swarm |
| `ui.resolve` | the surface's element-constructor table | UNUSED as a hook (console, swarm call `$.ui.resolve`) |
| `ui.press` / `ui.input` / `ui.scroll` | input to a plugin-drawn element | console |
| `ui.select` | a Select element raised a choice | UNUSED |
| `ui.focus` | focus moved to or from a plugin element | UNUSED as a hook (console calls `$.ui.focus`) |
| `ui.message` | a `Client` the plugin drew posted data | UNUSED |
| `agent.offer` | the engine offers an agent type to the model; `{ isOffered: false }` hides it | UNUSED |
| `agent.spawn` | a subagent is about to start | mods (cost hard stop), swarm |
| `prompt.submit` | the prompt as submitted; adds context | mods (routing), console, agentdb, ruos |
| `prompt.fill` | text about to enter the prompt box | UNUSED as a hook (console, swarm call `$.prompt.fill`) |
| `prompt.suggest` | the dim "Tab to take" suggestion | UNUSED |
| `prompt.edit` | the person edits the prompt box | UNUSED |
| `prompt.section` | one named system-prompt section, cached | UNUSED |
| `prompt.context` | context blocks of the first user message, once per conversation | UNUSED |
| `prompt.compose` | the whole system prompt as `{ sections }`; a `session`-scope section can be appended | console |
| `prompt.attachment` | each engine-injected reminder (todo, mode, mentioned file); `{ text: null }` drops it | UNUSED |
| `command.run` | a slash command ran | mods, console, swarm, agentdb, fleet (`/<x>-mod`) |
| `command.describe` | description and hint of a command in typeahead and `/help` | UNUSED |
| `config.set` / `config.describe` | `/config` rows (`set`: name only) | UNUSED |
| `telemetry.log` / `telemetry.mark` | a record about to be logged / a feature use marked; destination pinned | UNUSED |
| `skill.prompt` | the expanded prompt of a skill | UNUSED |
| `attribution.text` | commit or PR text the model is told to write | UNUSED |
| `session.start` | once, session ready; awaited before the first prompt | mods, console, swarm, ruos, agentdb, fleet |
| `session.receive` | a delivery (relay event, peer message, Remote Control prompt) reached the session; `{ consumed }` drops it | UNUSED |
| `session.append` | every row a conversation keeps, before it is stored; can rewrite content | UNUSED |
| `session.send` | a message leaves for another agent or session | UNUSED |
| `session.compact` | a compaction is about to run; rewrite `instructions` or `messages`, or `{ skip }` | UNUSED |
| `session.attach` / `session.detach` | a remote client joined / left (`detach`: name only) | UNUSED |
| `session.measure` | after each main-thread turn: context, rate limits, cost | mods (budget ladder) |
| `session.end` | once; shared short wall-clock bound, `next.budget` | mods (flush), console |
| `plugin.register` | a plugin module is admitted | mods (trust gate), console |
| `turn.start` | a model turn begins (observe only) | console, swarm |
| `turn.step` | before each model request of a turn, main or subagent; an async generator; can send another `model` or `effort`, or answer without a request | UNUSED |
| `turn.complete` | a turn ended; may add text beneath the answer | mods (flush), console, swarm |
| `engine.create` | when `$` is built; a plugin can add a noun | mods (`$.ruflo`) |

`ruflo-swarm` also hooks `*` (every event), which is how it feeds its live feed.

### 3b. Op events

`OpEventOf` types the argument of each `$` method as an event of the same name (`model.complete`,
`model.classify`, `model.fork`, `audio.play`, `mcp.call`, `session.root`, `ui.toast`, `ui.close`,
`fs.write`, `store.set`, `clock.now`, `http.fetch`, `process.run`, `settings.read`, and so on). A hook
on one answers the call, as the test world in `plugins/ruflo-mods/tests/fixtures/world.ts` does with
`on('fs.read', ...)` returning `{ value }` or `{ deny }`. In production only `ui.close` is hooked
(console, swarm). Whether a user-tier hook on `model.complete` sees *other plugins'* calls, and in
what order, is **UNVERIFIED**: the d.ts says the plugin chain nests in registration order (ADR-404
relies on that for `plugin.register`), not that every op is exposed to every plugin.

## 4. Classic events (`classic.<Event>`, 33), all UNUSED

`ConfigChange CwdChanged DirectoryAdded Elicitation ElicitationResult FileChanged InstructionsLoaded
MessageDisplay Notification PermissionDenied PermissionRequest PostCompact PostModelSwitch
PostToolBatch PostToolUse PostToolUseFailure PreCompact PreModelSwitch PreToolUse SessionEnd
SessionStart Setup Stop StopFailure SubagentStart SubagentStop TaskCompleted TaskCreated
TeammateIdle UserPromptExpansion UserPromptSubmit WorktreeCreate WorktreeRemove`

Each is hookable as a function and receives what the settings hook would get on stdin. ruflo's classic
path is `hook-handler.cjs` (ADR-404): the mod owns `route` and `post-edit` through a handshake and
leaves every other classic event to the helper. Candidates for a native twin: `PreCompact` and
`PostCompact`, `TeammateIdle` and `TaskCompleted` (the agent-teams hooks in the project guidance),
`StopFailure`. Not evaluated further.

## 5. `$` nouns and methods

| Noun.method | Used by | Note |
|---|---|---|
| `$.plugin` | validator only | name, dir |
| `$.ui.toast / status / log / open / close / panes / invalidate / blit / focus / scroll / ask / resolve` | mods (`status`, `log`, `toast`), console (all), swarm (`toast`, `log`, `open`, `close`, `invalidate`, `resolve`) | |
| `$.ui.notice`, `$.ui.copy` | UNUSED | a notice row; clipboard |
| `$.model.complete` | **UNUSED** | one tool-less completion on the session's own client; a result, never a rejection unless the request is refused |
| `$.model.classify` | **UNUSED** | picks one of N labels on the engine's small fast model; resolves `undefined` if none named |
| `$.model.fork` | **UNUSED** | tool-less completion over the session's own transcript; the prefix comes from the prompt cache |
| `$.audio.play / speak` | UNUSED | no player on a Linux terminal |
| `$.mcp.call` | agentdb, goals, graph-intelligence, intelligence, iot-cognitum | |
| `$.mcp.connect` | UNUSED | |
| `$.session.root` | mods, agentdb, fleet | async |
| `$.session.usage` | console, swarm | the figures `session.measure` pushes |
| `$.session.cwd / model / turns / id / messages / repo / surface / surfaces / version` | UNUSED | `version()` answers the engine's `base` and `builtAt` |
| `$.session.authorize` | UNUSED | an opaque credential handle, spent only on first-party hosts |
| `$.session.append / send` | UNUSED | real appends of meta rows or notices; messages to agents |
| `$.turn.abort` | UNUSED | |
| `$.prompt.submit / fill` | console (both), swarm (`fill`) | |
| `$.prompt.suggest / read` | UNUSED | |
| `$.tool.list` | console, agentdb, 23 fleet mods | |
| `$.tool.register` | console | model-callable tools, listed `mcp__<plugin>__<name>` |
| `$.tool.call / check` | UNUSED as host calls | |
| `$.command.register / list / run` | register: mods, console, swarm, agentdb, fleet; list, run: console | a plugin's markdown command cannot be re-registered |
| `$.config.list` | UNUSED | |
| `$.telemetry.log / mark` | UNUSED | |
| `$.agent.list` | swarm | |
| `$.agent.register / spawn` | **UNUSED** | `<plugin>:<name>` agent types from an `AgentSpec`; `spawn` answers with its `turn.complete` |
| `$.fs.read / write / list / exists / stat` | mods, console, swarm, agentdb, fleet | |
| `$.fs.ancestors` | UNUSED | walks `.md` files up a tree (AGENTS.md style) |
| `$.store.get / set` | console, swarm | per-plugin JSON file in the user config dir, **kept between sessions and hot reloads**, 4 MiB cap, JSON values only |
| `$.store.delete / keys` | UNUSED | |
| `$.state.get / set` | **UNUSED** | host-held named values with versions, for drawings; `plugin` and `key` must be literals |
| `$.clock.now / every / after / sleep` | now: nearly all; every: console, ruos, swarm; after: console, swarm; sleep: agentdb | `now` is async |
| `$.http.fetch` | console | |
| `$.process.run / spawn` | console, swarm | host commands; the trust gate watches these |
| `$.settings.read` | mods, console | |
| `$.env.get / set` | mods (`set` writes only `RUFLO_MODS_OWNS`) | |

## 6. What this table implies

1. `tool.describe`, `agent.offer` and `turn.step`, and the `$` nouns `model`, `agent.register/spawn`
   and `state`, are all UNUSED. They are where a mod changes what the model *sees and spends* rather
   than what the person sees.
2. `$.store` is used only by the two UI mods, for view state. Nothing cross-session about ruflo's own
   learning (route outcomes, cost, edits) is kept natively; the classic helper's files are the only
   record.
3. Seven events a mod can use to *protect* a session (`session.receive`, `session.send`,
   `session.append`, `session.compact`, `prompt.attachment`, `agent.offer`, `turn.step`) are
   unhooked, so ruflo's guard covers tool permission (`tool.check`) and subagent spawns
   (`agent.spawn`, at the cost hard stop) and nothing else.
4. Op events are a second, unused surface (section 3b): if a hook on `model.complete`, `http.fetch`
   or `process.run` does see other plugins' calls, the load-time trust gate could become a call-time
   one. That depends on the UNVERIFIED point above.

## 7. Evidence for the prototype in this change

`plugins/ruflo-mods` option `toolHints` (default `false`) hooks `tool.describe` for ruflo MCP tool
names only. Live, with a throwaway stdio MCP server named `ruflo` (private scratch dir, haiku,
`claude -p` 2.1.287, `--strict-mcp-config`, `--plugin-dir plugins/ruflo-mods`,
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`):

- option on: the model quoted `mcp__ruflo__memory_search` as `Search memory.`, a blank line, then
  `ruflo: Searches AgentDB only; memory_search_unified also covers Claude memories and patterns.`;
  `mcp__ruflo__memory_delete` (no hint in the table) as `Delete memory.`;
- option off: both quoted exactly as the server sent them.

Measured: the hint reaches the model's tool listing. **Not measured:** whether it changes which tool
the model picks. That is the acceptance test of roadmap item 1 in ADR-451.
