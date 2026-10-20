# ruflo-mods `agentTrim`: measured token saving and dispatch behaviour (2026-10-05)

Closes the "size in tokens is UNMEASURED" gap in ADR-451 item 2 (`agent.offer`). Reproduce with
`scripts/live-ruflo-mods-trim.sh [tokens enum spawn named | all]` (haiku, private `mktemp` scratch project, one headless
`claude -p --input-format stream-json` process per case, about $1 for the runs below). Nothing under `plugins/` was changed.

## Setup

- `--plugin-dir` for `ruflo-mods` plus all 37 other `plugins/*` dirs that define agents (64 agent files). The init message
  reported 69 agents (those plus the engine's built-ins). `--strict-mcp-config` with an empty config, so no MCP tool
  descriptions differ between arms and none are loaded.
- Arms: `agentTrim` off (default) and on (`pluginConfigs` in a per-run `--settings` file, `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`).
  The `$.store` usage ledger is user-global, so each session starts from an empty ledger and the files are restored afterwards.
- Trim engaged in every "on" run: `/ruflo-mods` answered `59 type(s) hidden` (off: `agent trim: off`).

## 1. Size of the agent listing, off vs on

**Method.** The listing lives inside the `Agent` tool description, which no stream-json message exposes. Two proxies:

1. Total prompt tokens of one trivial turn (`Reply with the single word ok.`), from the result message's `usage`
   (`input + cache_creation + cache_read`), 3 repetitions per arm, alternating arms. Everything except the listing is identical
   between arms, so the difference is the listing's size.
2. Ask the model to enumerate the `subagent_type` values it accepts and count them.

| run | off (prompt tokens) | on (prompt tokens) |
|---|---|---|
| 1 | 23,510 | 19,337 |
| 2 | 23,626 | 19,359 |
| 3 | 23,649 | 19,381 |
| mean | **23,595** | **19,359** |

**Measured saving: 4,236 tokens per request (about 18% of this session's prompt)** with 59 of 69 types hidden, about 72 tokens
per hidden type. A separate 1-repetition run gave 4,174. The split between `cache_creation` and `cache_read` varies run to run
(cache warmth); only the sum is stable (spread across the 3 repetitions: 139 tokens off, 44 tokens on).

Enumeration: off, the model listed 67 types (2,105 characters of bare names; lossy, init says 69). On, it listed 9 (148 characters):
`claude, Explore, general-purpose, Plan, ruflo-ai-team:researcher, ruflo-core:coder, ruflo-core:researcher, ruflo-core:reviewer,
ruflo-testgen:tester`. Bare names understate the real listing, which carries each description and tool list.
A crude local estimate from the 64 frontmatters (`- plugin:name: description (Tools: ...)`) is 12,559 characters, about 3,100 tokens
at 4 characters per token. That undercounts (multi-line descriptions are cut), which is why it sits below the measured 4,236.

**Against the ADR's claim.** ADR-451 expects "at least 3,000 fewer input tokens". On this catalogue the measured saving is 4,236,
so the threshold is met. The ADR's figure was written for "about 100 agent types"; this run has 69 and still clears it, so a session
with a larger catalogue should save more (extrapolating at about 72 tokens per hidden type is an estimate, not a measurement).
The ADR's acceptance test also asks for the comparison "in this repo" with `claude -p --output-format json`; this run used
stream-json with the plugin set above, not that exact command.

## 2. Can an unused type the prompt does not name be spawned with trim on?

The spawn prompt built the type name from parts (`ruflo`, hyphen, `docs`, colon, `docs`, hyphen, `writer`), so neither
`ruflo-docs:docs-writer` nor `docs-writer` appears in it (checked by the script).

| arm | prompt contains the type name | result |
|---|---|---|
| trim off | no | ACCEPTED |
| trim on | no | **REFUSED**: `Agent type 'ruflo-docs:docs-writer' not found. Available agents: claude, Explore, general-purpose, Plan, ruflo-ai-team:researcher, ruflo-core:coder, ...` |
| trim on | **yes**, written plainly | ACCEPTED; ledger afterwards `{ "agentUse": { "ruflo-docs:docs-writer": <ms> } }` |

**This does not confirm the previous live run.** An unused, unnamed type is refused at dispatch, so trim is a dispatch block in that
case, as ADR-451's design says ("a hidden type is also refused at dispatch"). The earlier observation that "a hidden type still
spawns by name" matches the third row: its spawn prompt named the type, and the prompt-name rule (`isKept`) keeps it at dispatch.
The comment in `plugins/ruflo-mods/hooks/agents/index.ts` ("not a dispatch block: live, a hidden type still spawns by name") is
therefore too broad and should say "unless the current prompt names it". Not edited here (outside this item's scope).

Consequence to weigh: with trim on, the model cannot discover a hidden type, and a user who wants one must name it in the prompt,
list it in `agentTrimKeep`, or have used it in the last 30 days.

## 3. Does a type the prompt names stay offered in a headless session?

No. With trim on, a prompt asking whether `ruflo-docs:docs-writer` is available and to list the accepted types answered "No" and
listed 9 types without it (the script's count of 10 includes the leading "No"), both as the first prompt and as the second turn of the same process (after a first `ok` turn).
The listing is fixed before the first prompt is processed and does not refresh on later turns, so "named in the prompt" keeps a
type only at dispatch (section 2, third row), not in the offered listing. This matches the previous run.

## What this could not measure

- **The listing itself.** No stream-json message carries the tool description, so the saving is a difference of totals, not a
  tokenisation of the listing. Cache state moves tokens between fields; the sum was stable to within 139 tokens.
- **Other catalogues and models.** One model (haiku), one plugin set (69 types). The per-type figure of about 72 tokens depends on
  description length.
- **The 20-task replay.** The ADR's "zero failed `Agent` dispatches over a 20-task replay" was not run. This run shows that a
  first-time, unnamed use of a hidden type fails (1 of 1 trials), which is the cost such a replay would count.
- **Interactive sessions.** Only headless stream-json was driven; whether an interactive session rebuilds the listing between
  prompts was not tested.
- **Run-to-run variance in the refusal text.** The model copies the error's "Available agents" list and dropped
  `ruflo-core:reviewer` in one of two refused runs; the refusal itself was identical.
- **Engine output.** The init message was reduced to a count of agent names; nothing else from it was stored or printed. The script
  drops any printed line that looks auth, account or telemetry-like. No such content appeared in the probes; one agent name
  (`...:telemetry-analyzer`) tripped the first version of that filter, which now works per token.
