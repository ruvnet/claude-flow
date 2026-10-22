# Mod hook surface: what exists, what ruflo uses, eight unused surfaces worth building (2026-10)

Date: 2026-10-05
Builds on: `mod-api-coverage-2026-10.md` (2026-10-04) and ADR-451. This note re-measures usage on the
current tree, settles one question those documents left open (section 5), and ranks eight unused
surfaces afresh.
Build measured: Claude Code **2.1.287** (`claude --version`).

Labels: **[verified-repo]** read in this repo; **[verified-dts]** read in the 2.1.287 declaration file;
**[verified-live]** observed by running `claude` here; **[inferred]** reasoned from the above, not run.

## 1. Sources and limits

- **API authority** is `types/claude-code.d.ts` inside the bundled `plugin-authoring` skill that
  Claude Code unpacks under `~/.cache/claude-code/tmp/claude-1000/bundled-skills/2.1.287/<hash>/`.
  Three unpacked copies exist, two distinct (20,116 lines twice, 20,046 once). Their engine-event and op-event names are identical;
  they differ only in the Artifact tool's documentation. The shorter copy is not read further.
  `reference.md` beside it says the API "is early access and moves between releases: the declaration
  file is the authority" **[verified-dts]**.
- **Shipped CLI surface**: `claude plugin --help` lists `configure details disable enable eval help
  list marketplace tag test update validate`. `test` runs `*.test.ts` against the real engine (with a
  `classic` noun for settings-hook events); `eval` runs prompt/grader cases against a plugin
  **[verified-live]** (help text only; `eval` was not run).
- **Usage** is the union of `claude plugin validate <plugin>` "hooks:" lines over the 44 plugins whose
  `hooks/hooks.json` names a module **[verified-repo]**.
- **Not read**: any build other than 2.1.287; the Claude Code web docs (`/docs/en/plugins/mods/reference`);
  event behaviour on a managed-settings (`sec-default`) org.
- `register` must be a **named export** `register`; a default export fails to load ("no export named
  register") **[verified-live]**.

## 2. The surface that exists

| Surface | Count | Notes |
|---|---|---|
| Engine events (`EngineEventOf`, d.ts line 3715) | 43 | `tool.call tool.check tool.describe ui.render ui.resolve ui.press ui.input ui.select ui.message ui.scroll ui.focus agent.offer agent.spawn prompt.submit prompt.fill prompt.suggest prompt.edit prompt.section prompt.context prompt.compose prompt.attachment command.run command.describe config.set config.describe telemetry.log telemetry.mark skill.prompt attribution.text session.start session.receive session.append session.send session.compact session.attach session.detach session.measure session.end plugin.register turn.start turn.step turn.complete engine.create` **[verified-dts]** |
| Classic events, `classic.<Event>` | 33 | the settings-hook events as functions (`PreToolUse`, `Stop`, `PreCompact`, `TeammateIdle`, `TaskCompleted`, ...); `e` is what the hook receives on stdin **[verified-dts]** |
| Op events (`OpEventOf`, line 6382) | about 60 | every `$` method is also an event of the same name, hookable by name or `on("*")`: `model.complete model.classify model.fork http.fetch process.run mcp.call fs.* store.* state.* clock.* session.* ui.* agent.register ...` **[verified-dts]** |
| `$` nouns | 21 | `plugin ui model audio mcp session turn prompt tool command config telemetry agent fs store state clock http process settings env` plus nouns a plugin adds in `engine.create` (ruflo adds `$.ruflo`) **[verified-dts]** |

Per-event facts that matter below (all **[verified-dts]**): `session.compact` triggers are `manual |
auto | plugin | precompute`; `attribution.text` kinds are `commit | pr | exemption | remedy`;
`telemetry.log` carries a pinned `to` (a hook rewrites content, never destination); `agent.offer
{ isOffered: false }` also refuses dispatch; `session.receive` and `session.send` are duals and
accept `{ consumed }` / `{ isDelivered: false, reason }`; `turn.step` streams and its hook budget
counts its own code only; a hook that fails passes through (fail open).

## 3. What ruflo already uses [verified-repo]

Engine events hooked by at least one ruflo plugin (19 of 43): `command.run session.start tool.call
tool.check tool.describe ui.render ui.press ui.input ui.scroll prompt.submit prompt.compose
agent.spawn agent.offer turn.start turn.complete session.measure session.end plugin.register
engine.create`. Op event hooked: `ui.close` (console, swarm). `ruflo-swarm` also hooks `*`, so it
observes every event but acts on few.

Who: the 39 ADR-446 mods hook only `session.start`, `tool.call`, `command.run`. `ruflo-mods` hooks
13 events including the two added since 2026-10-04 (`tool.describe` behind `toolHints`, `agent.offer`
behind `agentTrim`; commits a6486f371, 33a60c715). `ruflo-console` carries the UI events. `ruflo-ruos`
hooks `session.start` and `prompt.submit`. Classic events: none by function hook; the classic path
is `hook-handler.cjs` (ADR-404).

Unused engine events (24): `ui.resolve ui.select ui.message ui.focus prompt.fill prompt.suggest
prompt.edit prompt.section prompt.context prompt.attachment command.describe config.set
config.describe telemetry.log telemetry.mark skill.prompt attribution.text session.receive
session.append session.send session.compact session.attach session.detach turn.step`. (`ui.resolve`,
`ui.focus` and `prompt.fill` are called as `$` methods by console/swarm but not hooked.)
Unused `$` nouns: `model audio state telemetry config turn`; unused methods include `$.agent.register`,
`$.session.version`, `$.store.keys/delete`.

## 4. Eight unused surfaces, ranked

Ranking rule (same as ADR-451): value to a ruflo session divided by risk to behaviour or spend, size as
tie-break. Every proposal is an option, default off, tighten-only where it touches a verdict. Sizes are
[inferred] estimates of production code plus tests.

### 1. Call-time capability governor on op events (`http.fetch`, `process.run`, `model.complete`)
- **Surface**: op events + `next.origin`. **Status**: ADR-451 item 4, "feasibility UNVERIFIED" until now.
  Section 5 verifies it live for `http.fetch`: a user-tier hook sees other plugins' calls. The d.ts says
  `next.origin` carries the calling plugin's name and tier, "set by the host ... nothing a plugin writes"
  **[verified-dts]**, and section 5 reads it live: `plug-a` with tier `user` for a plugin's call.
- **Does**: turns the load-time trust gate (`hooks/trust.ts` flags `http.fetch` as "makes network
  requests", `process.run` as "runs host commands" **[verified-repo]**) into a call-time one: per-plugin
  call and host counts shown in `/ruflo-mods`; with `modTrust: refuse-risky`, a per-plugin cap that denies.
- **Risk**: medium. The hook also sees the engine's own calls (section 5) so it must filter on
  `origin.tier === 'user'` (the engine's telemetry arrives as plugin `cc-plugin-telemetry`, tier `builtin`, section 5) and never deny a non-user origin. It sees request headers and bodies: log host and
  count only, never bodies or headers. A deny breaks a plugin's feature, which is the point.
- **Live test**: the section 5 two-plugin harness plus a cap of 2 and 3 calls: third denied, report reads
  `plug-a: 3 calls, 1 denied`. Repeat for `process.run` and `model.complete` (not yet shown [inferred]).
- **Size**: about 150 lines plus tests; one new file under `plugins/ruflo-mods/hooks/governor/`.

### 2. `session.receive` and `session.send` screens (federation and peer messages)
- **Surface**: `session.receive` (relay event, peer message, Remote Control prompt, before queueing; `{ consumed }`)
  and `session.send` (outbound text to another agent; rewrite or refuse) **[verified-dts]**.
- **Does**: the existing in-process pattern screen (no model call) consumes an injection-shaped delivery
  and redacts secrets or PII on the way out. Covers the federation plugins' (`ruflo-federation`,
  `ruflo-bbs-federation`, `ruflo-x-gateway`) real inbound path.
- **Risk**: low to medium. A false positive silently drops a peer message, so show the rule id (never the
  text) in a toast and keep an option-gated audit counter. Tighten-only: consume or pass.
- **Live test**: a fixture of 50 injection strings and 50 benign messages through the test kit's `$.session`
  plus one live `claude -p` with a `plugin-a` that calls `$.session.send`; measure consume rate and
  false-positive rate. The origin values for `session.receive` (`peer`, ...) are in the d.ts
  `SessionReceiveOrigin`; I did not read the full set.
- **Size**: about 120 lines reusing `guidance/screen.ts`-style rules.

### 3. `session.compact`: keep swarm, claims and last-route state across compaction
- **Surface**: `session.compact` (`instructions`, `messages`, `{ skip }`; triggers `manual auto plugin
  precompute`) **[verified-dts]**.
- **Does**: append a short block (swarm id, topology, open claim ids, last route from `$.ruflo.snapshot()`)
  to `instructions` so the summary keeps what a long swarm run depends on. Append only; never skip.
- **Risk**: low. Cost is a few hundred input tokens per compaction. Guard: cap 600 characters, send nothing
  past the cap, and do not act on `precompute` (the name suggests a speculative run [inferred]; the d.ts
  example only shows it as a trigger name).
- **Live test**: seed a canary swarm id in state, run `/compact`, ask the model for the id. Present with the
  option on; absent in the control. `claude -p` may not expose `/compact`; use a tmux interactive session,
  or the test kit raising `session.compact` directly for the unit half.
- **Size**: about 60 lines.

### 4. `turn.step` budget downshift
- **Surface**: `turn.step` (before each model request, main or subagent; `next({ ...e, model, effort })`)
  **[verified-dts]**; the ladder already exists in `ruflo-mods` cost code, fed by `session.measure`
  **[verified-repo]**.
- **Does**: at WARNING or above, send `effort: 'low'`; at CRITICAL a cheaper `model`. Never upshift.
- **Risk**: medium. A model change spends the prompt cache (d.ts), so change once per rung. Quality drops
  when downshifted, which is the intent, but a person must see why: one toast per rung.
- **Live test**: set a tiny budget in a scratch project, run a 6-turn scripted `claude -p` conversation,
  compare per-turn `usage` before and after the rung with `--output-format json`; control with the option off.
- **Size**: about 100 lines.

### 5. `session.append`: scrub secrets from tool results before they are stored
- **Surface**: `session.append` (every row a conversation keeps, rewrite `content`; example matcher
  `{ door: "tool-result" }`) **[verified-dts]**. The d.ts notes the screen or an SDK stream may show the row
  just before the rewrite; the model and the transcript never read the unscrubbed form.
- **Does**: redact known secret shapes (private-key blocks, `sk-`/`ghp_`-style tokens) from tool results
  before they reach the model's context and the transcript file; reuses the aidefence/PII patterns.
- **Risk**: medium. A false positive corrupts a result the model needs; limit to a short, high-precision
  pattern list and mark the replacement visibly (`[redacted: private-key]`).
- **Live test**: a `Bash` result that prints a fake key; ask the model to repeat the last output; with the
  option on it quotes the marker, off it quotes the key. Then grep the session JSONL under `~/.claude/projects`.
- **Size**: about 90 lines.

### 6. `prompt.attachment`: measure, then optionally drop, engine reminders
- **Surface**: `prompt.attachment` (each engine-injected reminder; `{ text: null }` leaves it out; answer is
  held per attachment for the process; example type `todo_reminder`) **[verified-dts]**. The attachment type
  list is `PromptAttachmentDetailOf` in the d.ts; only `todo_reminder` was read here.
- **Does**: phase 1 is observe-only: count attachments per type and characters per session into the
  `$.store` ledger and `/ruflo-mods`, so the cost of reminders is a number instead of a guess. Phase 2 (only
  if phase 1 shows a type is large and rarely useful) drops chosen types.
- **Risk**: phase 1 none. Phase 2 can remove a safety nudge: drop-list is explicit, user-named, empty by default.
- **Live test**: `claude -p` over a 10-turn scripted task, option on, read the ledger; the A/B for phase 2 is
  input tokens with and without the drop, same prompt.
- **Size**: about 70 lines for phase 1.

### 7. `attribution.text`: one place for the RuFlo commit and PR trailer
- **Surface**: `attribution.text` (`commit | pr | exemption | remedy`; return `{ text }`) **[verified-dts]**.
- **Does**: this repo's workers are told, per session, to end commits with `Co-Authored-By: RuFlo
  <ruv@ruv.net>` and PR bodies with a RuFlo footer. A mod sets exactly that text for `commit` and `pr`,
  so attribution no longer depends on each session's reminder and stays uniform across worktrees.
- **Risk**: low, but it changes authorship text on someone's commits: option `attribution` default off,
  value taken from `userConfig`, never from the prompt. Does not touch `exemption` or `remedy`.
- **Live test**: in a scratch git repo ask haiku to "commit with a message"; read `git log -1 --format=%B`
  with the option on and off.
- **Size**: about 40 lines.

### 8. `$.model.classify` as a spend-gated route fallback
- **Surface**: `$.model.classify(text, labels, { model })`, default the engine's small fast model;
  resolves `undefined` if no label is named, rejects on a failed request **[verified-dts]**. Unused today.
- **Does**: when the lexical router's confidence is low (a keyword match is 0.6, none is 0.3 per
  `types/index.d.ts` **[verified-repo]**), pick among the route labels. ADR-451 item 9.
- **Risk**: spends on the person's own session client. Cap calls per session, skip at WARNING or above,
  wrap in try/catch and fall back to the lexical route.
- **Live test**: 100 labelled prompts through `claude -p`, route accuracy with and without, plus the cost
  from `usage`; ADR-451 sets the bar at +10 points and at most $0.02 per 100 prompts.
- **Size**: about 80 lines.

## 5. New evidence: a plugin's op hook sees other plugins' calls and the engine's own

ADR-451 item 4 and the coverage doc (section 3b) left this **UNVERIFIED**. Method: two throwaway plugins in a
private `mktemp -d` outside the repo. `plug-a` calls `$.http.fetch('http://127.0.0.1:9/from-plugin-a')` in its
`session.start` hook; `plug-b` hooks `http.fetch` and writes the URL it sees to a numbered file.
`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p "say ok" --model haiku --plugin-dir ../plugA --plugin-dir ../plugB`
(2.1.287) **[verified-live]**. Result, from the files `plug-b` wrote:

```
seen-0: http://127.0.0.1:9/from-plugin-a
seen-1: https://api.anthropic.com/api/event_logging/v2/batch
```

Also **[verified-live]** in the test kit: `claude plugin test` with a test-local plugin calling `$.http.fetch`
and the plugin under test hooking `http.fetch` saw the call.

A second run logged `next.origin` in `plug-b`'s hook **[verified-live]**:

```
seen-0: {"plugin":"plug-a","tier":"user"} http://127.0.0.1:9/from-plugin-a
seen-1: {"plugin":"cc-plugin-telemetry","tier":"builtin"} https://api.anthropic.com/api/event_logging/v2/batch
```

So the caller is identified, host-set, and the engine's telemetry is a built-in plugin, not `engine`.

What follows:

1. A governor (surface 1) is feasible. `process.run` and `model.complete` should behave the same
   **[inferred]**, since they are op events dispatched the same way; not run.
2. **Security note for the threat model (ADR-450).** Any enabled mod can read the engine's own analytics POST
   (the body I saw held account and organisation identifiers and a device id, and the call carried an `auth`
   field; I did not copy any of it here) and the URL, headers and body of any other plugin's request. A
   plugin that calls an authenticated API through `$.http.fetch` exposes its credentials to every other
   loaded mod. The trust gate flags network use at load but not this read path. Whether `telemetry.log` and
   the op chain are equally visible to a user-tier hook on a managed org is **UNVERIFIED** (`sec-default`
   sits outermost there, ADR-404).
3. A hook can also deny: `http.fetch` returns `{ deny }` or `{ value }` per the d.ts, so a mod can block the
   engine's telemetry. That is a privacy tool and a way to break the engine; surface 1 must never touch calls
   whose `origin.tier` is not `user`.

Reproduce: the plugin files are two `register.ts` of under ten lines each plus a `plugin.json` and a
`hooks.json` with `"modules": ["./register.ts"]`; the scratch directory was deleted after this note was written.

## 6. Considered and not ranked

| Surface | Why not in the top 8 |
|---|---|
| `$.agent.register` (ADR-451 item 10a) | `ruflo:<role>` agent types with least-privilege `tools`; real, but markdown agent definitions already exist and `agent.offer` trimming (shipped) removes the listing cost first. Revisit after `agentTrim` measurements. |
| `telemetry.log` / `telemetry.mark` | Useful as an observe-only feed for the guidance loop (ADR-447), but section 5 shows the payload is account-bearing; recording it creates exactly the risk surface 1 is meant to limit. The destination is pinned, so it cannot leak by redirect. Not proposed until a privacy review says what may be kept. |
| `config.set` / `config.describe` | A mod can deny or clamp a `/config` row. I did not enumerate the row keys, so I cannot name a safety-relevant row to protect; a trusted-source row is "core's to refuse". Needs the key list first. |
| `skill.prompt` | Rewrites a skill's expanded text. Powerful and easy to abuse (changes what the model is told a skill says); no ruflo need identified. |
| `prompt.context` / `prompt.section` | Overlaps `prompt.compose` (used by console) and `prompt.submit` context. Cached for the session, so a wrong answer is expensive. |
| `$.state` | Host-held values for drawing; ruflo's UI mods use `$.store`. Only useful with a new reactive view. |
| Classic events as functions | The classic helper owns them (ADR-404). A native twin for `PreCompact`/`TeammateIdle` is possible, but `session.compact` (3) covers the compaction half with a typed result. |
| `ui.select`, `ui.message`, `session.attach/detach`, `command.describe`, `prompt.suggest/edit/fill`, `$.audio` | UI or surface plumbing with no identified ruflo need. |
| `$.session.version()` capability probe (ADR-451 item 5) | Worth doing; it is a doctor feature, not a hook surface, so it sits outside this ranking. |

## 7. What I did not verify

- Any build other than 2.1.287; whether the event set differs on 2.1.277-2.1.286.
- That any ranked surface behaves as its doc comment says when run: only `http.fetch` visibility was run.
  Surfaces 2-8 rest on the d.ts text.
- `process.run` and `model.complete` visibility to another plugin's hook; managed-org behaviour.
- The full `SessionReceiveOrigin` and `PromptAttachmentDetailOf` sets.
- Estimated sizes and every impact figure are guesses; none has been measured.
- Whether `next.origin` is set the same way for `process.run` and `model.complete` calls; only `http.fetch` was read.
