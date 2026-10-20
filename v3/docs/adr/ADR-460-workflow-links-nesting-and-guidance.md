# ADR 460: Mission links, run events, mission-as-workflow and guidance on the Workflows page

Status: Accepted

Date: 2026-10-05

Builds on: ADR-458 (the page), ADR-464 (slot seams), ADR-453 (confirm-gated verbs), ADR-406 (mission observation)

Reserved and untouched: ADR-459, ADR-461 to ADR-463

## 1. Context

The Workflows page shows runs and agents, and Mission Control shows missions and tasks, but nothing relates them: a mission
task does not say which agent works on it, an agent does not say which mission task it serves, a run that fails or goes quiet
is only visible if the page is open, the swarm's nesting (swarm, hive, queen, worker, claim, task) is spread over three
views, and the only way to say something to a swarm is to leave the page. Two facts shape what is honest here. First,
ruflo's verbs write records: `hive-mind broadcast` appends to the hive's shared memory (the last 100), `task_update`
and `claims_handoff` edit store files, a consensus proposal binds no one. None of them interrupts a running agent; an agent
sees a record only when it reads that store. Second, a Claude Code workflow agent has no ruflo record at all, and the
console has no verb of its own that stops or messages a running workflow. (Amended by ADR-465: it can call the engine's TaskStop and SendMessage through the host, labelled by how far each path is proven.)

## 2. Decision

All of it plugs into the page through the slot registry (`views/wf-slots.ts`); no shared file is edited.

**Links (`data/wf-links.ts`).** Only links the data carries are made. A ruflo agent links through a ruflo task whose
`assignedTo` holds it and whose tags are `mission:<id>` and `task:<id>` (what `mission-specs.ts` writes), or whose id is a
ledger task's `rufloTaskId`. A workflow agent links through a label that begins `[mission:<id> task:<id>]`, which a script
drafted here puts there. Anything else is `unlinked`, with the reason on screen. There is no fuzzy match: a label that
merely contains a task's word is unlinked. A tag whose ids the console does not hold is still shown, marked as not in its ledger.

**Events (`data/wf-events.ts`).** Between two reads: an agent newly failed, an agent newly stale, a run newly stalled, and a
finished agent only when a mission tagged it. A run finishing or failing stays with `wf-live.ts`, which already raises those
(raising them again would show twice under a different key). The first read announces nothing. The same change is also
returned as a mission event; `applyMissionEvents` records it once (its key is the event's `evidenceRef`) in the ledger.
The notice slot has no `state`, so recording is a separate export the merge owner calls (section 5). The ruflo swarm is folded
into the run list after the read, so it never reaches a notice slot; only workflow runs do.

**Mission as a workflow (`data/wf-mission-script.ts`, board "Run a mission as a workflow").** `draftScript` turns the active
mission's tasks into a `.claude/workflows/mission-<id>.js` script: `meta` a pure literal, the tasks as JSON data (no mission
text is ever code), levels of tasks run with `parallel` inside a level, each agent labelled with the tag above, a role passed as
`agentType` only if it is one a session is known to resolve (the rest ride in the prompt). Credentials are masked, a circle,
a duplicate id, no tasks or more than 30 tasks refuse a draft. The dry run counts agents, levels and the widest level from the
plan; tokens, time and cost are n/a. The script is shown for review (the first 80 lines, with the total) and launched only by
a confirm card whose action prepares the text in the main session's prompt box: nothing starts until Enter there.

**Nesting (`data/wf-guide.ts` `nestingOf`, board "Swarm nesting").** swarm > hive > queen > worker > claim > task, each
level read from its store; a missing level is a note ("no hive-mind", "no claim", "no task record"), never drawn.

**Guidance (`data/wf-guide.ts`, tab `guide`).** One typed sentence (bounded to 300, no leading dash, refused if a credential
mask would change it), then actions, each a fixed argv through the confirm card, each showing what is sent and whether anything acts:

| action | argv | acts? |
|---|---|---|
| broadcast to the hive | `mcp exec -t hive-mind_broadcast` | record only: no worker is interrupted |
| propose to the hive | `mcp exec -t hive-mind_consensus` (`propose`, type `guidance`) | needs votes; a pass binds no agent; refused while raft has a proposal open this term |
| hand its claim on | `mcp exec -t claims_handoff` | pending until the target accepts |
| note it on its task | `mcp exec -t task_update` (`result`) | record only; refused if the task already has a result (it would be replaced) |
| leave a note in shared memory | `memory store --namespace guidance` | found by a memory search; nothing is pushed |
| prepare a redirect (workflow runs only) | none: prepares text in the prompt box | text for the main session; resume applies to a stopped run |

The page says wherever it matters that a running Claude Code workflow cannot be stopped or messaged from here.

## 3. Consequences

- A mission task shows its agent and an agent its mission task, wherever the data links them, and says "unlinked" otherwise.
  Workflow agents link only when their script was drafted here (or hand-tagged); that is the price of not guessing.
- No action makes a running agent do anything; the cards say so. The memory note is "found by a memory search", not
  "surfaced on later recalls": the intelligence hook's recall was not verified to search the `guidance` namespace.
- The launch hands the script to Claude through the prompt box, so running it bills as a Claude turn plus its subagents
  and cannot be stopped from the console.
- Three new data modules and one view module, each under 500 lines; `controller.ts` is untouched.

## 4. Test and benchmark plan

Specs: `wf-links.spec.ts` (links, events, ledger recording), `wf-mission-script.spec.ts` (the script runs against stub hooks,
levels respect dependencies, hostile text stays data, secrets masked, estimate counts), `wf-guide.spec.ts` (nesting, each action's
argv, refusals, the slots on the real page). Mutation checks flip the stale window, the already-stalled guard, the malformed-tag
rule, open-first ordering, the run-path check, the credential guard, the task-result guard, the widest-level count, level depth,
the secret mask, the agent cap, the ledger dedupe and the not-wired report; each fails a test. Benchmark: the link index and
script draft are linear in agents and tasks (at most 30 tasks drafted); they run once per frame while the page is open, never while it is closed.

## 5. Merge owner wiring

1. `views/wf-register.ts`: add `import './wf-guide'` (registers two boards, a nesting board, two tabs and a notice slot, no hotkeys).
2. `wf-live.ts`, in `refreshWorkflows` after the notice-slot loop: `recordRunEvents(state, host, before, runs, nowMs)` (exported
   from `views/wf-guide.ts`; it records into the mission ledger and saves it). Omit it and the notices still work; only the ledger events are lost.

## 6. Rollback

Remove the `import './wf-guide'` line (and the `recordRunEvents` call): the page returns to the board, tabs and slots it had.
The new modules are inert without the import. Ledger events already recorded are `type: 'workflow'` rows that the mission views
list and nothing derives from.
