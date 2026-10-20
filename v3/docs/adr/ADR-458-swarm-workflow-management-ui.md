# ADR 458: Swarm and workflow management page (`workflows`)

Status: Accepted

Date: 2026-10-05

Builds on: ADR-404 (ruflo as a mod), ADR-444 (Claude controls the console); related ADR-453 (confirm-gated verbs)

## 1. Context

The console has a Swarm page (ruflo's agents) and nothing for the other swarm a person runs most: Claude Code's own
`Workflow` runs. Claude Code shows those in a `/workflows` panel (phases down the left with done/total and a marker on the
current one, that phase's agents on the right with status, label, model, `worktree`, tokens, elapsed). That panel is only
visible while the run is in the foreground. The console can show the same thing from the files Claude Code writes, next to
the ruflo swarm, so one page manages both.

Schemas were read from real runs (Claude Code 2.1.287), not assumed:

| File | Shape |
|---|---|
| `<session>/subagents/workflows/<runId>/journal.jsonl` | `{type:'launched'}`, `{type:'started',key,agentId,label,phase}`, `{type:'result',key,agentId,result}` |
| `.../agent-<id>.meta.json` | `description`, `workflowPhase`, `agentType`, and `spawnedWithWorktree` + `worktreePath` only for worktree agents |
| `.../agent-<id>.jsonl` | transcript; every line has `timestamp`; `assistant` lines carry `message.{id,model,usage}`; one message id repeats across streamed lines |
| `<session>/workflows/<runId>.json` | written when the run ends: `status`, `phases[]`, `durationMs`, `startTime`, `totalTokens`, `workflowProgress[]` (per agent: `state`, `model`, `tokens`, `durationMs`, `startedAt`, `toolCalls`) |
| `<session>/workflows/scripts/<name>-<runId>.js` | the script; `meta.phases` names the phases (a live run has no `.json` yet) |

## 2. Decision

Add a read-only view `workflows`, built from pure parts:

- `hooks/data/workflows.ts`: parsers (journal, meta, transcript, run record, script meta), `buildRun`, `swarmRun`, formatters.
- `hooks/data/workflows-read.ts`: the only disk code. Finds the newest 6 runs of this project (`<configDir>/projects/<slug>/...`),
  at most 60 agents each.
- `hooks/data/workflows-nav.ts`: cursor state and the key reducer. `j/k` move in the focused column, `h/l` switch column,
  `Enter` inspects, `Esc` closes, `[` `]` switch run.
- `hooks/views/workflows.ts`: the page.

Source precedence per agent: the run record where it exists (a finished run), else journal + meta + transcript. A run with a
record never has its transcripts read. A started agent with no result and no activity for 15 minutes is shown as stale
(`◌`), because a crashed run leaves the same files as a live one; it is not shown as running and not as failed. "Failed" is
only ever what the run record says.

The ruflo swarm is a second run in the same layout (`swarmRun`): phases are the agent types (the only grouping the store has),
a stopped agent counts as done, an idle one as ready. ruflo records no model, tokens or worktree per agent, so those read n/a.

Tokens: the run record's own figure where present, else the context tokens of the agent's latest request (input + cache
read + cache write + output, each streamed message counted once). Measured against the record on a real run it is within
about 1% (180,391 to 181,549 against 181,212), so it is a derivation, labelled as one in the page footer.

Bounds: a transcript over `TRANSCRIPT_CAP` (3 MB; the engine refuses 4 MiB) is tail-read (`TAIL_BYTES`, 400 KB) where the host
supplies `fs.readTail`, giving tokens as a floor (`>=`) and no start time; otherwise it is left unread and its tokens read
n/a. The cap and the number of unread transcripts are printed in the page.

Actions: ruflo agents get `Stop agent` and `Spawn another <type>`, which are `stopAgent` and `spawnAgent` from `ops.ts` (fixed
argv) handed to the existing confirm card through `hooks.ask`. A workflow agent gets `Open transcript`, which names its path
(`hooks.show`). The console cannot stop a Claude Code workflow and the page says so. (Amended by ADR-465: the control tab calls the engine's own TaskStop and SendMessage behind the confirm card and the engine's permission check, where that tab is switched on; the page says which.)

No file in the console's existing registries is edited by this change; the wiring is in section 5.

## 3. Consequences

- One page for both swarms, from files already on disk; no new probe, no network, no secrets. A result is shown only as the
  first 160 characters of the string the journal already holds (a structured result as a field count), in the inspect panel, with credential-shaped text (`sk-…`, `token=…`, `Bearer …`, 32+ character tokens) masked and control characters stripped from every file-supplied string. Lists longer than 14 rows scroll with the cursor.
- A live run's figures are derived and say so; a finished run's are Claude Code's own.
- `stale` is a heuristic with a stated threshold, not a fact. The page never reports a failure it cannot read.
- Reading cost: measured 72 ms for 6 real runs including one live run (this one), on the 2026-10-05 host. A finished run costs
  its record plus up to 60 tiny meta files.

## 4. Test and benchmark plan

`plugins/ruflo-console/tests/workflows.spec.ts` (32 tests) with fixtures that copy the shape of a real run and none of its
content: parsers (unknown events, a half-written line, a cut tail), streamed-message dedupe, live vs finished vs stale vs
tail-read runs, the ruflo swarm run, key movement and clamping, the reader against an in-memory disk (oversize, tail,
limits, empty), and the page through a recording kit (columns, narrow width, inspect, buttons and their argv, empty states).
Benchmark: `readWorkflowRuns` over the real `~/.claude/projects/-home-ruvultra-projects-ruflo` tree (72 ms, 6 runs, 0 skipped).
Re-run it if `MAX_RUNS` or the transcript cap changes.

## 5. Integrator wiring

- `state.ts`: `ViewId` `'workflows'`; `VIEWS` entry `{ id: 'workflows', key: <free key>, label: 'Workflows', short: 'Wfl', icon: '🧬', blurb: 'swarm and workflow runs: phases, agents, models, tokens, time', rows: 30 }`; menu: SWARM group, observe, next to `swarm`.
- State: `workflows: { model: WorkflowsModel | null; ui: WfUi }` (`newWfUi()`), the model refreshed only while the view is open.
- Refresh: `readWorkflowRuns(fs, cache, { configDir, cwd, nowMs })`, then `{ runs: allRuns(found.runs, snap.swarm, snap.agents, now), root, capBytes, skipped: found.skipped.length, more }`; pass `fs.readTail` if the host has one.
- Keys while the view is in front: `j k h l [ ]` and Enter/Esc map to `walk(ui, runs, key)`; after a run switch or a first open call `startOn`.
- Render: `workflowsView(ctx, model, ui, { ask: spec => <existing confirm path>, show: path => toast/result row })`.

## 6. Rollback

Delete the four files and remove the registry entries; nothing else reads them. The page is read-only apart from the two
ruflo verbs, which are the ones the Swarm page already offers.
