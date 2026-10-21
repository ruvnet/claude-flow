# ADR 466: Mission autopilot

Status: Accepted

Date: 2026-10-06

Builds on: ADR-443 (mission control and its `/loop` manager), ADR-453 (Project Anatole), ADR-464 (the Workflows slot seams)

## 1. Context

A mission can run for days, but today every task hand-over asks. The request is an autopilot option: run, adapt and optimise
for days or weeks without asking permission for in-scope actions. Three facts shape the design.

**The engine's permission check is not ours to bypass.** The console's per-action confirm is its own; Claude Code's permission
dialog on a tool call is the engine's. Autopilot removes the first, inside an approved scope. It cannot and must not remove the
second: a step the person's own settings would block is parked, never performed on their behalf. Unattended running therefore
also depends on those settings, which the console can only preflight (when the host offers a check) and report.

**A session ends with its turn.** A `claude -p` session ends when its turn completes (spike: 1.9 s). A mod has no scheduler.
Weeks of liveness come from the session living and the mission's existing `/loop` re-arm (ADR-443 §2.4); autopilot adds the
per-tick checks and a `host.every` timer, never a scheduler of its own.

**Status fields lie.** Probed on this machine, 2026-10-06:

- `autopilot_status` answered `enabled: true, iterations 0, maxIterations 50, timeoutMinutes 240, tasks 0/0, percent 100,
  elapsedMs 7377364917` (85 days: a stale session record) and `autopilot_progress` answered `0/0, percent 100`. A progress of
  100% with zero tasks, a 50-iteration and 4-hour ceiling, and a clock that never reset make it unusable as the loop's
  authority. It is not called by the loop; `task_list` returned real tasks and is what the mission store already reads.
- The ruflo swarm "execution is a no-op" defect means a task marked `completed` is a claim. A step is **done and verified** only
  when the store says completed AND the envelope's own verify argvs exit 0; with none configured it is **done-unverified**, drawn
  as such, and teaches the adaptation nothing.

## 2. Decision

### 2.1 The envelope (`data/ap-envelope.ts`)

One scope contract, approved once: tool classes (`read edit test git-local git-branch network spawn mcp`), absolute folders,
`owner/name` repos, a network host allowlist, named secret env vars (names, never values), spend ceilings per hour, day and
total, a concurrency cap (1 to 8), a maximum duration (1 hour to 90 days), verify argvs, and a recorded consent to run
without Anatole. Validation lists every problem and repairs nothing; an unknown field is an error, so nothing can smuggle in a
grant. **Hard denies are a constant, not a field**: `publish release deploy force-push secret-access
delete-outside-worktree envelope-edit`. An envelope naming one is rejected, and task text that names one is parked with a
question that has no approve button (and the loop ignores an approve-once for it anyway).

It is canonicalised, hashed (SHA-256 in plain TypeScript: no console module may assume `node:crypto`), versioned with a
revision and sealed to `.claude-flow/console/autopilot/envelope.json`. On every tick the sealed hash must equal the hash the
`start` journal line recorded; a file edited outside the console stops the loop. Any change is a new Start through the confirm
card, which lists what the change **widens** (`widened(prev, next)`). The band shows `autopilot day 3 · $12/$40 · 2 parked`,
each part from the journal, the ledger probe and the parked lines; an unread spend is `$n/a`, never `$0`.

### 2.2 The loop (`data/ap-loop.ts`, `data/ap-journal.ts`, `ap-live.ts`)

A pure machine: `foldJournal(events)` is the whole state and `tick(state, facts)` returns events to journal and at most one
step to start. The order of its checks is the safety property: kill flag, then stopped/idle, then settle what is in flight
(finished, failed, timed out, or an **orphan** from before a restart with no effect found), then paused, then envelope,
duration, Anatole, spend, failure ladder, capacity, then the task. A step id is `hash(task, attempt)`; a task with a started or
done step is never started again; a replayed line changes nothing. The decision is journaled **before** the hand-over: a crash
between the two leaves a started step the next pass settles by its effect, never a step that ran unrecorded.

The journal is an append-only JSONL file written through a fixed argv (`dd of=<path> oflag=append conv=notrunc`, one element
for the path, after `checkNoLinks`), every free-text field washed and credential-masked before it is encoded. It is also the
audit log. Past 80% of its 1.5 MB read cap it is archived beside itself and restarted from `snapshotEvents` (events that fold to
the same live state). Failure budget 5 in a row pauses and notifies; one failure backs off 1 min, doubling to 1 hour; each step
has a 30-minute timeout. A beat is journaled every 5 minutes while idle.

Spend: unread waits (never runs on a guess); 80% of the total ceiling pauses (never cutting a step in flight: it is settled
first); 100% stops; an hour or day ceiling holds the next step back until the window rolls. The reading is the cost ledger's
list-price estimate for the whole project over the hour, day and run windows, so it over-counts rather than under-counts.

The hand-over is the existing mission `dispatchSpec(...).run()` and `host.submitPrompt`: no executor of our own. To work past a
parked task, the live module passes it a shadow record with the picked task first (same events, same task objects); the
mission's own rule of one task at a time and not past a failed one is kept, so autopilot idles with a said reason rather than
pretend otherwise.

### 2.3 Adapting (`data/ap-adapt.ts`)

It may tune step size, parallelism (never above the envelope's cap), the model tier per step class, the retry count and the
ordering, each with a hard range, and nothing else (a path allowlist; `__proto__` or `concurrency` reach nothing). A change goes
propose, then evaluate (a replay over the verified journal steps), then promote: the gate re-checks the result against the
envelope and ranges and returns an **immutable receipt** whose hash chains to the one before (`verifyReceipts` finds an edited
link). The current tunables are the fold of the receipts over the defaults, so they survive a restart and each is reversible
from its own receipt. A **conservative** change (lower parallelism, higher tier, one more retry) needs evidence that the
setting being left is failing. An **aggressive** one (higher parallelism, lower tier) needs a clean history on the setting being
left and enters a **trial**: `reviewTrials` reverts it once the new setting does worse over 6 steps. Proposers exist for tier,
parallelism and retries; step size and ordering are tunable and validated but have no proposer in this release (a said gap).
Adaptation cannot widen the envelope, spend, tools, network, concurrency or release authority: the envelope is only read.

### 2.4 Parking (`views/ap-parked.ts`)

A task the envelope does not allow, that names a hard deny, that cannot be classified (`cls: null`: the classifier never
defaults), that names a path outside the folders, a URL host not on the network list or a GitHub repository not on the repo
list, or that the permission preflight says would ask or deny, is **parked** with a question and a notice; the loop carries on
with other work. The person answers approve once (that task, one step, then the envelope applies again) or deny (final). A
class the person's own settings **deny** has no approve button and an old approval is ignored for it: the console does not lift
a deny. A class the settings only *ask* about can be approved once (the engine still asks). Retries past the policy also park.

### 2.5 Safety

- **Anatole**: the loop pauses when Anatole is off or absent unless the sealed envelope records `acceptWithoutAnatole`, and
  Start refuses the same way, recording which it was in the `start` line.
- **Kill**: `Stop` (key `9`), `/ruflo autopilot stop`, or the file `.claude-flow/console/autopilot/KILL`. The file is checked
  first on every tick (one iteration), journals a stop and is sticky: only a confirmed Start removes it. Stop and Pause need no
  confirm because they only narrow authority; Resume re-checks every gate on its next tick.
- **Cost guard**, **digest** (once per UTC day, as a notice and a toast), **masked audit log**: as above.
- **Permission preflight**: an optional injected `toolCheck` (the engine's `$.tool.check`) maps each class to a representative
  tool; deny or ask parks the class. Absent, the panel says `preflight not wired` and the engine still decides per call.

### 2.6 UI

Slots only (`views/wf-slots.ts`): a board section "Mission autopilot" (band line, state, gates, sealed envelope, draft editor
with live validation, Start / Pause / Resume / Stop / Check now, adaptation history with receipts and chain status), a board
section for the parked queue, a key slot (`9`, stop), an action slot (`8`, start through the confirm card) and a notice slot.
The editor has buttons for classes, ceilings, concurrency, duration and the Anatole consent; the list fields (folders, repos,
network, verify) are loaded from `.claude-flow/console/autopilot/envelope.draft.json` and validated before use.

## 3. Consequences

- Inside an approved envelope the console no longer asks, for as long as the session lives. The person's exposure is the
  envelope, the hard denies, the engine's own permission dialog, and the kill switch.
- Autopilot is only as unattended as the person's permission settings are permissive, and only as long-lived as the session.
- Every step that reached `done` without a verify command is flagged unverified; with none configured nothing is learned.
- Parallelism above 1 is bounded in practice by the mission's own one-task-at-a-time dispatch.

### Honest limits (found in the adversarial review, 2026-10-06)

- **The envelope gates what a task SAYS, not what a session does.** Class, paths, URL hosts and GitHub repositories are read from
  the task text by keyword and pattern (`data/ap-guard.ts`); a relative path, a `~` path or a task that does not name its target is
  not caught. Spend, concurrency, duration and the verify commands are enforced; **secret names are a record only** (nothing reads
  them). The real boundary is the engine's permission check on every tool call, which autopilot never bypasses. The panel says so.
- **Verify commands run through this console**, not the engine, so they are shown in full on the Start confirm card and are not run
  where the person's settings deny the `test` class (the step is then done-unverified).
- **A sleeping machine** is credited to steps in flight (a gap of three ticks or more between passes), so a step is not failed as
  timed out for time nobody could have worked. **A clock set back** does not hold a backoff for the size of the jump. Day counts and
  the digest use UTC, so DST changes nothing. The maximum duration is wall-clock: sleep counts toward it.
- **A full disk**: a pass whose journal write fails starts nothing and says so; a Stop that reaches neither the journal nor the KILL
  file is held in memory (and said to be "this session only") so a re-read cannot resume the loop, and is written when the disk answers.
- **Stop wins a race**: a pass re-checks the flag and the phase just before it journals a step, because gathering facts (a verify
  command, up to 10 minutes) happens after the first check.
- **Adaptation** does not learn from a hand-over the mission refused, and does not re-propose a setting a trial was reverted away
  from (without that, a clean old history re-proposed it every ten minutes).
- Fixed: the Stop key `9` existed as a key slot and again as a board button (two buttons on one key ran it twice); the board button now carries no hotkey.

## 4. Test and benchmark plan

`tests/ap-core.spec.ts` (30), `tests/ap-adapt.spec.ts` (10), `tests/ap-live.spec.ts` (17) and, from the review, `tests/ap-review.spec.ts` (16, each a defect the review found), pure and fast: SHA-256 vectors; envelope validation, sealing,
tamper, widening; journal round trip, washing and the fixed argv; every ordering rule of the machine; **kill-switch property**
(60 seeded random walks: once the flag is seen no tick ever acts and nothing restarts the loop); **no double start** (60 walks:
no task has two live steps, no id repeats); **crash-resume** (30 walks, a fresh fold at every third prefix, each orphan
re-verified and never restarted in the same pass); compaction folds back; the adaptation gate, the chain, the trial revert, and
a hostile-proposal sweep proving no tunable passes the envelope. Mutation checks run on the kill check, the Anatole gate, the
hard-deny rule, the 100% stop, the envelope re-check and the hash pin: each turned its test red. Benchmark: `tick` is a pure
function over at most 400 steps; an 80-tick walk (fold + tick each step) ran in about 1.5 ms here (60 walks in 88 ms).

## 5. Rollback

Remove the import line in `views/wf-register.ts` and the `wireAutopilot` call: the new modules are inert without them. The
files under `.claude-flow/console/autopilot/` are the loop's own and can be deleted (the journal archive stays beside it).
`/ruflo autopilot stop` or the KILL file halts a running loop first.
