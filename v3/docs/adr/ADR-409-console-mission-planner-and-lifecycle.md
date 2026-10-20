# ADR 409: The Mission Control planner and the one lifecycle

Status: Accepted

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/goap.ts`, `hooks/mission-control.ts`, `hooks/mission-specs.ts`, `hooks/mission-types.ts`, `hooks/mission-text.ts`, `hooks/mission-palette.ts`, `hooks/views/mission-control.ts`, `hooks/views/mission-launch.ts`.

Extends: ADR 406 (mission records, the `session-bound` executor) and ADR 407 (the cockpit). Detail of ADR 408 sections 1 to 8.

Updated by: ADR 425 (the Missions list: one line a mission, attention first, a stale record flagged). The lifecycle and the planner are unchanged.

## 1. Context

A person types a goal ("add a dark mode toggle to settings"). Ruflo already has a governed mission record (`mission_create`, `mission_plan`) and a task store (`task_create`), but nothing turns a sentence into a plan, and a mission that is only `planned` has no executor: ADR 406 defines `session-bound` tasks, which the primary Claude Code session carries out. The console needs to (a) plan without a model and without writing, (b) create the mission and tasks on one confirm, (c) hand work to Claude one task at a time, and (d) show progress without inventing it.

## 2. Decision

### 2.1 A planner, not a prompt
`goap.ts` is a goal-oriented action planner. The world is a set of facts (`specified`, `architected`, `tested`, ...). An action has preconditions, effects, a cost and an agent role. A* over fact sets finds the cheapest sequence that reaches the goal's facts; the task graph is then read off the preconditions (a step depends on the steps that produced the facts it needs), so independent steps (research beside specification, pseudocode beside architecture) share a *wave*. It is pure and deterministic: the same goal, kind and rigor give the same plan, with no model call and no I/O.

The goal's facts depend on the **kind** of work (feature, bug fix, refactor, security, research; read from the goal's words unless the person picks one) and the **rigor** (lean, standard, thorough).

### 2.2 One lifecycle for every mission
Whatever the kind, standard and thorough plans run the same lifecycle in order: **Research → Create (specification, design, ADRs and the SOP) → Build → Test → Validate → Secure → Benchmark → Learn**. Underneath, SPARC phases (S, P, A, R, C and a cross-cutting gate X) order the work. Lean is the core only; bug fixes skip the ADR and benchmark stages; research missions end in Learn (`learn-findings`). **Learn** needs the work validated first, so it is the last step: it stores the outcome and trains routing on it (the self-optimization step).

Every action carries a *stage* (`stageOf`), shown in the plan (`t4 [Create] Record the decisions as ADRs and write the SOP`) and as a lifecycle strip (`Research → Create ×4 → Build ×3 → ...`).

### 2.3 Creating a mission is one confirm
`createSpec` asks once (scope `goal`) and then runs `mission_create` → `mission_plan` (the plan body is the planner's output, accepted by the real tool) → `task_create` per node, tagged `mission:<id>`, `task:<tN>`, `phase:<P>`. The goal is captured when the ask is made: if it changed while the confirm was open, nothing is created. A failure at any step is caught and reported; if a task could not be created, the tasks already made are cancelled and the mission is reported as existing without tasks, so the ledger never holds a mission that can deadlock on a task that does not exist.

### 2.4 The ruflo task store is the authority
Execution state is read, never inferred: a task is *done* when the store says `completed`, *running* when `in_progress`, *failed* or *cancelled* as stored, *ready* when pending with its dependencies done, otherwise *waiting*. The console keeps only a **ledger** (the mission ids, the task map, ordered events `{seq, type, taskId, status, evidenceRef}`, pause and cancel flags) in the plugin store. A mission with no durable executor cannot be paused in ruflo, so pause, resume and cancel are the console's own ledger state: they stop the console handing out the next task, and they do not stop a Claude turn already running (said in the ADR consequences, not hidden).

### 2.5 Handing a task to Claude
`dispatchSpec` asks first (it starts a turn). On yes it re-checks that the mission is not paused or cancelled and that this task is still the next ready one and was not handed over in the last 15 seconds (a manual confirm and auto-run can otherwise both send it), marks the task `in_progress`, and submits one **visible** prompt naming the ruflo task id, the role, what done means, and how to record the outcome (`task_complete` with the evidence in its result, or `task_update` failed). If the prompt cannot be sent, the task goes back to `pending` so the mission does not stall on a task nobody is doing. Auto-run hands over the next ready task when Claude is idle and never survives a restart (the ledger loads with auto-run off).

## 3. Alternatives considered

- **Let Claude plan** (a model call per goal). Rejected for the plan itself: it costs, it is not reproducible, and it cannot be tested. A model is used where judgement helps (the guidance, ADR 410), after the deterministic plan exists.
- **Infer progress from the transcript.** Rejected: it is unreliable and unverifiable. The task store is authoritative and already exists.
- **A durable executor in the console.** Rejected for now: ADR 406 reserves durable executors for a different component; the console only ever delegates to the session.
- **One plan shape for all kinds.** Rejected: a lean bug fix and a thorough security change need different goals from the same action library.

## 4. Consequences

- Plans are cheap, instant and unit-testable; the lifecycle makes every mission end by recording what it learned.
- Pause and resume are advisory (they stop hand-over, not a running turn).
- A planner action added to the library changes plans; `tests/goap.spec.ts` pins the orders and the "every goal fact is given by some step" property.

## 5. Safety

Writes are confirm-gated with the exact argv; the plan is accepted by the real `mission_plan` schema; mission and task text is data (drawn as text, never interpreted); no secret is read or shown; the dispatch prompt is visible in the transcript.

## 6. Tests

`tests/goap.spec.ts` (orders, optimality, parallel waves, every profile and rigor reaches its goal, the lifecycle), `tests/mission-control.spec.ts` (derive, next task, create chain, dispatch, pause, auto-run, aside, guide, skills, band), `tests/mission-review.spec.ts` (the adversarial-review regressions: no double hand-over, stuck task rollback, auto-run reset, stale goal), `tests/missions.test.ts` (the view end to end against a fake CLI).
