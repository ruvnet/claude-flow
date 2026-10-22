# ADR 418: Tool rows name the mission task they belong to

Status: Accepted (ships in ruflo-console 0.20.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/tool-owner.ts`, the `ToolUse` render hook in `hooks/register.ts`, `tests/tool-owner.spec.ts`, `tests/missions.test.ts`.

Extends: ADR 407, ADR 409 (the mission lifecycle). Companion to ADR 412.

## 1. Context

Mission Control hands one task at a time to the primary session. The transcript then fills with tool rows (Bash, Read, Edit, ruflo MCP calls) and nothing ties a row to the task that caused it. Reading back a mission, or checking evidence for a task, meant counting rows by hand.

## 2. Decision

A `ui.render` hook on the `ToolUse` component adds one dim line under the engine's own row: `↳ mission task: <title> (<phase>)`.

- **Attribution is made once, at first sight, while the call runs.** If the active mission is neither paused nor cancelled and **exactly one** of its tasks is running (derived from the ruflo task store, as everywhere else in Mission Control), that task owns the call. The answer is remembered by tool-use id, so the line stays on the row after the task completes.
- **Nothing is guessed.** A call first seen already finished (history drawn after a reload), a call with no task running, two tasks running, or a paused or cancelled mission all leave the row exactly as the engine drew it.
- The engine's row is never replaced: the hook draws it with `next(e)` and puts the line beneath it. If the hook declines, the engine row is drawn unchanged.
- The memory is bounded (500 calls, oldest dropped).

## 3. Alternatives considered

- **Matching by tool name or arguments.** Rejected: a model can use any tool for any task, so a match would be a guess presented as a fact.
- **Attributing by time window from `dispatchedAtMs`.** Rejected: row draw time is not call start time, and a reload redraws old rows.
- **Writing the owner into the ledger.** Deferred: the ledger records task events and evidence; per-call ownership is a display aid and is derivable only while the task runs.

## 4. Consequences

- A mission read back in the transcript shows which task each step served.
- Two concurrent tasks (not produced by Mission Control today) would show no line rather than a wrong one.

## 5. Safety

No tool input or output is read or copied; the line carries only the task's own title and phase. No spend, no network.

## 6. Tests

- `tests/tool-owner.spec.ts`: the single running task owns a call and keeps it after finishing; finished-first-seen and no-running-task calls have no owner; two running tasks, a paused mission, a cancelled one and no mission attribute nothing; the line text.
- `tests/missions.test.ts` (kit): a row drawn with no task running, before a mission and after one is created, is the engine's own. The positive case (a row carrying the line, drawn through the host) is not covered by a kit test: the kit runner was switched off server-side while this shipped, so a test that could not be run was not added.
