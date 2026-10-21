# ADR 470: Autopilot completion, and the first live run

Status: Accepted

Date: 2026-10-06

Builds on: ADR-466 (mission autopilot), ADR-467 (security audit), ADR-443 (mission control), ADR-437 (cost ledger)

## 1. Context

ADR-466 shipped the loop with five things outstanding (an in-console editor for the envelope's lists, hand-over of more than one task at
a time, a spend reading that is not the whole project at list price, a band segment that was computed but never drawn, and a decision on
ruflo's own `autopilot_*` tools) and with one gap that mattered more than any of them: it had never run in a live interactive session.
All of its tests were pure. This ADR closes the five and records the first live run, which found seven defects the tests could not.

## 2. Decision

### 2.1 Envelope list editor (`data/ap-edit.ts`, `views/ap-editor.ts`, `views/ap-draft.ts`)

Folders, repos, network hosts, secret variable names and verify commands are each a list of rows with a remove button and one field to
add an entry, on the draft the panel's buttons already change. There is **no validator of its own**: an edit is accepted only if the
result raises no error the draft did not already have under `validateEnvelope`, the function the sealed file is opened with. So the verify
argv rules (`verifyProblem`), host, repo and variable regexes, the protected folders, the path rules and every limit apply to an edit
exactly as to a load, and a rule added to the validator later reaches the editor with no change. A refused edit changes nothing and shows
the validator's reason. Removing the last folder is refused for the same reason (the draft would stop validating). A verify entry is split
on spaces; quotes and backslashes are refused rather than half-interpreted (there is no shell). Below the lists the draft is shown as a
diff against the approved envelope (`+` widens, from `widened`; `-` narrows, from the new `narrowed`; `same`), and the verify commands in
full. Start is unchanged: it asks, and its card lists the exact argv, repos, hosts and variable names and what the change WIDENS. The
fields are `kit.Input` with `onSubmit`, as `startField` is (the palette's `field()` routes through confirm-gated writes; a draft edit is
not a write). Every figure the editor draws comes from the draft; nothing is granted until a confirmed Start seals it.

### 2.2 Parallel hand-over (`hooks/ap-pick.ts`, `startable` in `mission-control.ts`)

`tick` stays pure and still starts at most one step per call. `apTick` now goes round up to the cap: decide, journal, re-check, hand over,
and again while there is room. The cap is `min(envelope.concurrency, tunables.parallelism)`, so adaptation still starts at one and may
only raise it (aggressive change, with a trial) up to the envelope. After a park the loop goes on to the next task in the same pass, so a
parked task no longer holds the others back for a minute. Every round repeats the safety checks (kill flag, phase, exactly one `start`
line in the journal for the step) before its hand-over.

The mission's rules are kept, not copied: the one exported addition is `startable(mission, tasks, task, cap)`, which is `nextTask`'s
rule (not paused or cancelled, **nothing failed**, the task ready because its dependencies are done and it is in the task store) with the
running limit raised from one to `cap`. Tasks the store shows running AND tasks handed over seconds ago (the store has not refreshed) count
against it. `dispatchSpec` gains an optional last parameter, a readiness predicate defaulting to the mission's own `nextTask` check, so
`Run next` and auto-run are byte-for-byte as before (`startable(…, 1)` is proven equal to `nextTask` over a table of states). The old
"shadow mission with the picked task first" is gone. **Two prompts into one interactive session are queued turns, not parallel work**
unless the step spawns agents itself; the cap bounds what is handed over and in flight, not wall-clock speed-up.

### 2.3 Spend (`data/ap-spend.ts`)

The ledger (`ledger.mjs`) filters by time window and project; it has **no per-session or per-process filter**, so a precise
"this loop's spend" is not readable, and the tracker is not ours to change. What is made exact:

- A window never reaches back past the Start (`hour = max(now - 1h, start)`, same for the day): a loop started ten minutes ago no longer
  counts the fifty minutes before it.
- The reading is `--provider claude` only. Autopilot hands prompts to this Claude Code session, so Codex rows are irrelevant to it and only slow the ledger down. (A manual probe without `--from` read all history of both providers and overflowed the ledger's stack on this machine's Codex history; the loop always passes `--from`, so it was never exposed to that.)
- A model with no list price makes the reading unknown (it would under-count a ceiling), as does an unparsed or erroring window.
- The tracker must be new enough for the window filters (0.27.1). The old code asked a 0.27.0 tracker for `--from`, which exits 2; this
  machine's installed tracker IS 0.27.0, so on it the loop would have waited on an unread spend forever, silently.

Still estimated, and now said so wherever it is drawn: "estimate at list price: every Claude Code turn in this project since Start, yours
too (the ledger has no per-session reading)". It is the figure the ceilings are enforced on, and it over-counts. When it cannot be read the
loop keeps waiting (never guessing) and says why: `waiting: spend not read: the ruflo-cost-tracker plugin is not installed`, in the
status line and the panel.

### 2.4 Band segment (`views/ap-band.ts`, `registerBarSource` in `views/bar.ts`)

`bar.ts` gets ONE exported function, `registerBarSource`, and one call site in `barParts` (a source that throws is skipped; nothing else in
the file changed). `autopilot day 3 · $12/$40 · 2 parked` is drawn on the band's first row after the mission part, from the journal, the
sealed envelope and the spend reading; `$n/a` until the spend is read, nothing while autopilot has never started, `paused` in the text and
the attention colour when paused or when something is parked. A click opens Workflows. The band only draws in a ruflo project unless
`/ruflo band on`.

### 2.5 ruflo's `autopilot_*` tools: not used, with evidence

Probed on this machine, 2026-10-06 18:12 local, through the registered MCP tools:

```
autopilot_status   -> {"enabled": true, "sessionId": "05d83b08-…", "iterations": 0, "maxIterations": 50, "timeoutMinutes": 240,
                       "elapsedMs": 7443277535, "tasks": {"completed": 0, "total": 0, "percent": 100}, "taskSources": [...]}
autopilot_progress -> {"overall": {"completed": 0, "total": 0, "percent": 100}, "bySource": {}}
autopilot_log      -> [{"ts": 1783881469131, "event": "enabled", "sessionId": "05d83b08-…"}]      (one entry, July)
```

`elapsedMs` is 86 days: a stale session record, the same finding as ADR-466 §1, unchanged. 0 of 0 reads as 100%. And `autopilot_log` takes
only `last`; none of the four tools accepts a step outcome, so "log the loop's outcomes through them" is not even possible. What they offer
beyond reading is `autopilot_enable`, which re-engages agents when tasks remain incomplete: a **second authority that acts outside the
envelope**. Decision: the loop neither reads nor writes them. Its own journal (append-only, masked, pinned) is the audit log.

## 3. The live run

Method: a throwaway repo `/tmp/ap-live`, an interactive `claude --model haiku --plugin-dir …/ruflo-console` in a private tmux server with an
isolated config (credentials copied 0600, shredded at the end), the ruflo MCP server passed with `--mcp-config` so the session could call
`task_complete`, permissions `acceptEdits` plus `Bash(node --test:*)` and `mcp__ruflo__*` (nothing else allowed), a mission of four seeded
tasks (implement `add`, a notes file at `/tmp/other/notes.txt`, a test, run the tests), and an envelope of read/edit/test, folder
`/tmp/ap-live`, no network, no secrets, $1 a run, one at a time, accept-running-without-Anatole, verify `node --test` (added through the
pane's own editor field). The duration is one hour, not 30 minutes: 1 h is the validator's minimum. Everything outside `/tmp/ap-live` and
the isolated config stayed untouched; `/tmp/other` was never created.

What was observed, in three runs (journals kept in the scratchpad):

| Step | Observed |
|---|---|
| Editor | `sh -c ls` refused with the validator's reason, `node --test` accepted; "Start will run … node --test" drawn. |
| Start | A confirm card listed the envelope hash, classes, folder, network none, `$1/h $1/day $1 total`, one at once, the verify command, Anatole accepted. Nothing started before Yes. |
| Hand-over | The step was journaled (`step.started`) before the prompt reached the session; haiku wrote the files, ran `node --test`, called `task_complete` through the MCP server. |
| Verify | The next tick ran `node --test` through the console: `step.done verified:true`. |
| Parking | The task naming `/tmp/other/notes.txt` was `parked` with a question (outside the envelope), the loop went on to the next task in the same pass, and the file was never created. |
| Stop | The Stop button mid-step: `stop` in the journal and the `KILL` file within 0.2 s, no further prompt for 100 s while the in-flight turn finished. |
| KILL flag | `touch KILL` with a running loop: `stop: kill switch` journaled 49 s later (one 60 s tick). |
| Resume | Closed and reopened the session: the loop read `running` from the journal and the pin, settled the in-flight step by its effect (`done verified:true`) and did not run it twice. |
| Kill -9 mid-step | Killed the `claude` process one second after the hand-over of the third task; after relaunch the step was settled `lost on restart`, its task **parked with a question**, and no prompt was sent. After the task was set back to pending and approved once, the retry ran and verified. |
| Spend | Read live ($0/$1, then $0.03/$1), and equal to the ledger run over the isolated config's own logs. |
| Band | `autopilot day 1 · $0.03/$1 · 2 parked` on the band (after `/ruflo band on`). |

Real spend, from the ledger over the isolated config at list price: run 1 $0.075, run 2 $0.173, run 3 $0.108, **$0.356 in total** (cap
$1.50), all `claude-haiku-4-5`.

### Defects the run found, each fixed with a regression test (`tests/ap-complete.spec.ts`, `tests/ap-parallel.spec.ts`)

1. **The Start key `8` and Stop key `9` never worked.** Every digit and letter is a view's key (8 is MetaHarness, 9 is Memory) and a slot
   hotkey that equals one loses to it: pressing 9 opened Memory and wrote no KILL file. The registry only checks slot against slot. Both
   hotkeys are gone; Stop is a button and `/ruflo autopilot stop`. (A test now fails if an autopilot slot takes a view key.)
2. **Start was unreachable in a project with no workflow run.** The page draws its action row only when a run is selected. Start is now a
   button on the autopilot board itself.
3. **The permission probe asked the engine with no input, which answers `ask` for everything**: with `acceptEdits` and the test command
   allowed, Read, Edit and Bash all said ask and every task was parked. The probe now carries a call the envelope allows (a file in its
   first folder, its first verify command, a host from its list; with no verify command or host to use, a class is asked with no input, as before).
4. **A step that finished after a Stop was recorded failed on the next Start.** A stopped loop still computed effects; its verify commands
   were skipped as "stopped" and counted as failures, and the failure was cached for the process. A stopped or killed loop now verifies
   nothing and remembers nothing; a stop pressed mid-list ends it without a result.
5. **A step in flight when the console died, whose task the store still showed in progress, was waited out to its 30 minute deadline and
   then retried without a question** (the lost-step rule only covered "no effect found"). It is now settled at once and its task parked with
   a question that says what to do (found by reading the run's restart; the live relaunch then confirmed the new behaviour).
6. **The panel said "your settings allow every class" before the first check had run.** It now says "not checked yet".
7. Smaller: a one-hour envelope read "0 d"; a refused edit repeated the field name; the spend reading could fail for good on this machine
   (§2.3).

### Found in other lanes, not touched

`views/wf-page.ts` draws the action row only when a run is selected, so every action slot (worktree clean, template launch, Stop) is absent
in a project with no run. The worktree key `w` and template key `t`, and the action hotkeys `c` and `g`, are also view keys (x.ruv.io,
Self-Evolution, Cost, Timeline), so they have the same defect as 1. `tests/wf-merge.spec.ts` needed a one-line change (a second slot without
a hotkey collapsed a `Set`); nothing else there.

## 4. Unverified

- **Parallel hand-over was not run live**: the live envelope was one at a time, as specified. It is covered by the specs (cap, running
  and in-flight counts, dependencies, a failed task, pause, kill) but two concurrent turns in one interactive session were never watched,
  and they are queued turns anyway (§2.2).
- The spend figure was checked against the ledger over the isolated config's logs, but only for a session that was the whole project.
  "Yours too" is by construction, not observed.
- Only one model (haiku) and one engine permission set were exercised; the real settings of a person with deny rules were not.
- The `/ruflo autopilot stop|pause|resume` command and the notice slot (toasts) were not driven; the band and the buttons were.
- `tsc --noEmit -p plugins/ruflo-console` (16 GB heap; Claude Code wrote the type declarations on load): every error in the files this change touches or adds is fixed; 12 remain, all in code this change did not write (`snapshot.ts`, `mission-control.ts` line 260 (MissionActions), `mission-list.ts`, `model-tools.ts`, `register.ts`, `spinner.ts`, `bar.ts` line 45, and test files `anatole`, `band`, `memmap`, `ap-review` line 120).
- Spend ceilings (80% pause, 100% stop, the hour and day holds) were never approached: $0.36 against a $1 envelope. The Anatole pause gate was never exercised (the envelope accepted running without it). When a workflow run is selected, Start appears twice (the action row and the board); both are confirm-gated, so no double run, but this was not observed.
  Claude Code 2.1.289 and `claude plugin validate` passes.
- Adaptation ran no live proposal (it needs 6 to 12 verified steps).

## 5. Test plan

`tests/ap-complete.spec.ts` (editor and the live findings) and `tests/ap-parallel.spec.ts` (parallel, spend, band): 29 tests. Mutation checks, each
turned its test red: the editor's validator call, `startable`'s failed-task rule, the cap in `startable` and in the pass, the window
clamp, the stop guards in the verifier (both together), the lost-step rule, the permission probe's input, a hotkey on the Start slot, the
"not checked yet" text, the unpriced-model rule, the band's empty case. Existing autopilot, security and mission specs are unchanged except
three lines in `ap-live.spec.ts` / `ap-review.spec.ts` that asserted the old hotkeys and that a park used a whole tick, and one in
`wf-merge.spec.ts`. Console suite: 1912 passed, 3 skipped; smoke 16/16.

## 6. Rollback

Revert the commit. The new modules are inert without their imports (`views/ap-band.ts` registers one bar source; `views/ap-editor.ts` is
drawn by the panel). `dispatchSpec`'s new parameter is optional and `startable` is only called by autopilot.
