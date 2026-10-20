# ruflo-mods options, live verification (2026-10-05)

`capabilityProbe` (PR #3763, 0.3.7) and `sessionRollup` (PR #3766, 0.3.8) were default-off options covered only by kit tests.
This run drives both through REAL headless Claude Code sessions (engine 2.1.287, model haiku) with
`--plugin-dir plugins/ruflo-mods`, options set through `pluginConfigs` the way `scripts/live-ruflo-mods.sh` does.
Script: `scripts/live-ruflo-mods-options.sh [probe|rollup|all]`. Plugin code was not changed. Total spend: about $0.13 (two runs, `probe` $0.058, `rollup` $0.068).

Method notes: private `mktemp` scratch projects with `.claude-flow/` (the opt-in boundary); the user-global `$.store` files of `ruflo-mods`
are snapshotted and restored (new ones removed) around the rollup phase; output lines that look like auth/account/telemetry are dropped and counted
(0 were). The secret-shaped token is built at runtime from fragments and appears only as `<canary>` here.

## 1. capabilityProbe

| session | `/ruflo-mods` probe line |
|---|---|
| off (default) | `probe:       off (set the capabilityProbe option)` |
| on, before any prompt | `probe:       probe: engine 2.1.287 · events fired 3/11 · never fired: agent.spawn, plugin.register, prompt.submit, session.end, session.measure, tool.call, tool.check, turn.complete` |
| on, after one model prompt and one Bash call | `probe:       probe: engine 2.1.287 · events fired 8/11 · never fired: agent.spawn, plugin.register, session.end` |

`.claude-flow/mods/session.json`:

- off: `{ "startedAt": "...", "owned": ["route","post-edit"], "statusLine": true }` (no `engine`, no `events`).
- on: the same plus `"engine": "2.1.287"` and `"events": ["agent.spawn","command.run","engine.create","plugin.register","prompt.submit","session.end","session.measure","session.start","tool.call","tool.check","turn.complete"]`.

Proven: off says `probe: off`; on reports the real engine version; `events fired n/m` moves 3 -> 8 after a prompt and a tool call
(prompt.submit, session.measure, tool.call, tool.check, turn.complete joined); the heartbeat gains `engine` and `events`; the Bash call still ran (`ran.txt` existed), so the probe changed nothing.

Observations:

- `engine.create` DID fire (it is in the 3 at start, with `session.start` and `command.run`). `plugin.register` never fired, in either report. Whether it is a build that does not emit it or an event that fires before the module's hooks are attached is not decidable from this run.
- `session.end` shows "never fired" in every report because a report is produced before the session ends. It is not evidence about the event; the rollup phase proves `session.end` fires (below).
- `agent.spawn` was not provoked here (no agent call), so "never fired" for it is expected, not a finding.
- Cosmetic: the report renders `probe:       probe: engine ...` (the label is doubled; `probeLine()` already prefixes `probe:` and the report row adds the label). Not changed here (no plugin changes in this item).
- "engine version not exposed" was not provoked: this build exposes `$.session.version()`.

## 2. sessionRollup

Store key `sessionRollup` in the user-global `$.store` of the inline plugin; baseline 0 records.

- Off (a session with a Bash call, a canary-bearing prompt and two reports): report `sessions:    off (set the sessionRollup option)`; records after: 0 (before 0); canary in store: false.
- On, session 1 (`/ruflo-mods`, a Bash call, a prompt containing the canary, `/ruflo-mods`): mid-session report `sessions:    none yet`. After the session ended exactly one record:
  `{"at":1791189372268,"tools":1,"routed":2,"tightened":0,"denied":0,"spawns":0,"cost":"OK"}`
- On (plus `capabilityProbe`), session 2 (`/ruflo-mods` only): its start report read the first record back: `sessions:    1 kept; last 1: 1 tools, 2 routed, 0 tightened, 0 denied, 0 agents` / `newest: 1 tools, 2 routed, 0 agents, cost OK`. After it ended the ledger held 2 records, the new one:
  `{"at":1791189374838,"tools":0,"routed":0,"tightened":0,"denied":0,"spawns":0,"cost":"OK","probe":"4/11"}`
- Keys across the new records: `at,cost,denied,probe,routed,spawns,tightened,tools`, all in the whitelist. The canary appeared in no store file and no `/ruflo-mods` report; the model also did not echo it in any reply.
- The user-global store files of `ruflo-mods` were restored to their pre-run state (none existed before; none left).

Proven: off writes nothing; on appends exactly one whitelisted-counters record per ended session, a second session appends a second, the next session's report reads the ledger back, and a secret-shaped prompt token never reaches the record or the report. `session.end` fires in headless stream-json mode when stdin closes.

Could not be provoked: a nonzero `denied` or `spawns` count (no deny or Agent call in these sessions; both are covered by kit tests), a cost rung above `OK` (no budget set), ledger pruning at 50 records / 32 KB, and a corrupt or hostile ledger file (covered by the existing `readLedger` tests and the `scripts/live-ruflo-mods.sh ledger` method for `agentUse`). `routed: 2` for a session whose three user turns were `/ruflo-mods`, a Bash prompt and a plain prompt was recorded as observed; what counts as "routed" was not cross-checked against the first report's `routed:` row.

Side note: other workers' sessions create `ruflo-console_*`, `ruflo-swarm_*` and `ruos_*` store files in the same directory; this harness only touches names matching `ruflo-mods_inline-*.json`.
