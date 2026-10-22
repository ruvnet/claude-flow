# ADR 462: Workflows page: cost, failure triage and alert guards

Status: Accepted

Date: 2026-10-05

Builds on: ADR-458 (the page's data), ADR-464 (wiring and slot seams), ADR-437 (the cost ledger), ADR-453 (confirm-gated verbs)

## 1. Context

The Workflows page shows what a run is doing but not what it costs, which of its agents came to nothing, or when something
needs a person. `WfAgent.tokens` cannot answer the first: it is the context size of an agent's latest request, and a price needs
the tokens of every request in each billing bucket (input, cache read, cache write 5m and 1h, output). Claude Code writes those
per request in the agent's transcript; the ruflo-cost-tracker already prices them from a dated `data/prices.json`.

## 2. Decision

All of it plugs in through the slot seams of `views/wf-slots.ts`; no shared file is edited.

**Cost** (`data/wf-cost.ts`, pure). Transcript usage is summed per model, each request counted once by `message.id|requestId` with each
bucket at its largest (a streamed request repeats its line while the output count grows; the ledger keeps the first line, so on a
streamed transcript this reads output slightly higher than the ledger and is the nearer to the bill). Prices come from the tracker's book,
found through the validated install record, byte-capped (300 KB), Claude and USD entries only, looked up as the ledger does (a `re`
wins, else the longest `match` in the id). A model with no entry is tokens and **"no price"**, never $0; a cache rate the book does not
publish is billed at the input rate and the figure is marked `≈`; a transcript read only from its end, an unread agent, or unpriced
company marks the figure a floor `≥`. Cost is shown per run, per phase and per agent, beside "billed tokens" (all buckets of all
requests), which is a different figure from the page's context tokens and is labelled so.

**Reading** (`wf-cost-live.ts`, outside render and the controller). `refreshWfGuards(state, host, force?, nowMs?)` runs after
`refreshWorkflows` under the same gate (page in front, pane shown, one read at a time). Per agent: stat, then one bounded read of the
transcript at `transcriptPath` (checked to be under `<configDir>/projects/`, no `..`); over 3 MB it is tail-read where the host can
(a floor), else left. At most 24 MB of not-yet-parsed transcript per refresh; a parsed file is remembered by size and mtime, so a
finished run is parsed once and the rest wait for the next refresh (shown: "N of M read, K wait"). Nothing is written.

**Triage** (`data/wf-triage.ts`, pure). Each agent is `ok`, `empty`, `error`, `timeout`, `stale` (or `pending` while it runs), from the
run record's state, the journal's result event (the full text, from the text the reader already cached), the tool-call count and the
reader's staleness. A finished agent is an error only if its result *begins* with one ("Error handling is missing" is not). There is no
timeout event in the files, so `timeout` is a text match and the page says so. The board strip reads `N failed · M empty · K stale · …`
and each failing row carries the first error line (masked, control characters stripped). The "re-run just the failed items" text is the
documented `Workflow({ scriptPath, resumeFromRunId })` (ruflo-workflows: workflow-run: unchanged `agent()` calls return cached), split
into agents that run again (no result recorded) and agents whose error *is* their recorded result and so stay cached. It is text for the
person to run: the console never runs it, and says to stop a running run first (amended by ADR-465 and 0.34.1: the Control tab's Stop asks first and calls TaskStop, which is unverified for a workflow run's own id, so the Workflows panel is named as the sure way).
A ruflo swarm has no resume verb and is told so.

**Guards** (`data/wf-alerts.ts`, pure). Options `wfBudgetRunUsd`, `wfBudgetDayUsd` (0 off, else 0.01 to 10000) and `wfAlertRules`
(`stuck>20m tokens>2M dirty`, words not understood are listed on the page). `evaluateGuards` is a pure function over the runs, the cost
figures, progress marks and worktree readings; the notice slot `wf-guard` raises each alert once while it stays true (edge trigger) on
top of the notice ring's 60 second dedupe. Like the page's own notices the first cost read announces nothing: what is already true then is listed on the Cost board ("now: …") and only a later crossing raises a notice. Alert keys are a short hash of the run and agent ids, because the ring cuts a key to 40 characters and two 17-character ids joined would collide. It only says: nothing is stopped, paused or messaged. `stuck` is measured from when the console
first saw the agent unchanged (it cannot know how long it was quiet before), and a stale agent (no file activity for 15 minutes) counts at
once. The 24h ceiling counts the workflow runs read on this page, not all Claude spend. `dirty` is a read-only
`git --no-optional-locks -c core.fsmonitor=false -C <path> status --porcelain=v1 --untracked-files=no` of at most 12 ended agents'
worktrees, fixed argv, only for paths inside the project (a repository's own config cannot run a program through it).

## 3. Consequences

Good: figures are from real files; every absence is said (no tracker, no price, unread, floor); no new write path.
Costs: one more bounded read pass per refresh (benchmarked below); `stuck` and the notices lag one refresh tick behind the cost read
because a notice slot has no host. Gaps: the day ceiling is not the account's day; no host-side "fill prompt" from a slot, so the re-run
text is drawn for the person to copy.

## 4. Test and benchmark plan

`tests/wf-cost.spec.ts` (usage parse, book, lookup, per-bucket arithmetic, floors, option and rule limits, every guard at its boundary)
and `tests/wf-triage.spec.ts` (classes, re-run text, the whole path on an in-memory disk: book, transcripts, byte budget, tail floor,
dirty argv and path checks, notices once, masking). Mutation checks flip a boundary or a guard and must fail a test. Benchmark: the
first refresh parses each finished transcript once (cost grows with transcript bytes, capped 24 MB per refresh); later refreshes of a
finished run are a stat per agent. Measure a frame with the store warm: the slots do arithmetic over at most 60 agents.

## 5. Rollback

Remove the one import line from `views/wf-register.ts` and the one `refreshWfGuards` call: the page is the board again. The options
are inert without them.

## 6. For the merge owner

`views/wf-register.ts`: `import './wf-triage'`. After `refreshWorkflows(...)` in the refresh tick and in `view-open.ts`: `void refreshWfGuards(state, host)`
(from `wf-cost-live.ts`). `state.ts` `Options`/`optionsOf`: add `wfBudgetRunUsd`, `wfBudgetDayUsd`, `wfAlertRules` from
`guardOptionsOf(raw)` (`data/wf-alerts.ts`). `plugin.json` `userConfig`:

```json
"wfBudgetRunUsd": { "type": "number", "title": "Workflow run ceiling (USD)", "description": "A notice when one workflow run's spend reaches this (0 off, else 0.01 to 10000). The console only says so: it cannot stop a run.", "default": 0 },
"wfBudgetDayUsd": { "type": "number", "title": "Workflow day ceiling (USD)", "description": "A notice when the workflow runs started in the last 24 hours reach this (0 off, else 0.01 to 10000).", "default": 0 },
"wfAlertRules": { "type": "string", "title": "Workflow alert rules", "description": "Words separated by spaces: stuck>20m (no progress), tokens>2M (a run's tokens as the board header shows them: the agents' latest-request context sizes, not the Cost section's billed tokens), dirty (an ended agent left an uncommitted worktree).", "default": "" }
```
