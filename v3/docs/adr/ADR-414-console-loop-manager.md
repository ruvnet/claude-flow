# ADR 414: The Loop Manager

Status: Accepted (ships in ruflo-console 0.15.0)

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/loops.ts`, `hooks/views/loops.ts` (a folded section of the Automation page).

Extends: ADR 411 (the Claude UI bridge). Detail of ADR 408 section 12.

## 1. Context

Claude Code's `/loop` repeats a prompt on a schedule or self-paces it. Ruflo ships workers (`ruflo-loop-workers`), a scheduler and an autopilot that are meant to run that way. A person had to remember the command, the interval syntax, the worker names and a stop condition; a forgotten stop condition means a billed turn on every tick for up to seven days. rUv asked for a loop manager with a configurator, presets from practical to exotic, and a launcher into the Claude UI.

## 2. Decision

- **Where:** a folded section at the top of Automation, which already owns `ruflo-loop-workers` and `ruflo-autopilot` (ADR 411 plugin map). It is not a new view: every hotkey is taken.
- **Presets (16, three tiers).** *Practical*: watch CI on this branch, keep the tests green, babysit open PRs, the audit and test-gap workers. *Steady*: optimize and consolidation workers, autopilot, a nightly schedule, docs kept in step. *Exotic*: MetaHarness drift watch, the dream cycle (the flywheel evaluates candidates into receipts and **never promotes**), a hive-consensus loop, the long-horizon tracker, ultralearn, swarm self-heal. Each preset states what a tick does and costs.
- **Configurator:** interval (self-paced, 1m, 5m, 10m, 30m, 1h, 4h, 1d), task (a preset's, or typed), stop condition. The stop grammar is closed: `until HH:MM`, `after N runs` (1 to 999), `when done`, or empty. The exact `/loop ...` is shown before anything runs, or the reason it cannot be built.
- **Launcher:** asks first, with the exact text and a note that every tick is a billed Claude Code turn, that a loop expires after seven days, and (when no stop condition is set) that none is set. On yes it submits one visible `/loop ...` prompt to the main UI (mid-turn: fills the box), which the engine runs as a typed command. **List / stop my loops** asks Claude to list `CronList` and pending wake-ups and to ask before stopping any.
- **Input rules.** A task that starts with `/` must be one plugin command the session lists, with at most a few plain words after it (a worker preset needs its plugin: otherwise it says so and asks nothing). Control and bidirectional characters are removed; a task is cut to 400 characters and the whole input is at most 600. A hand-typed task is screened by AIDefence (ADR 410); a preset is the console's own text and is not.

## 3. Alternatives considered

- **Create the cron job directly (`CronCreate`).** Rejected: `/loop` is the user's own mechanism and may self-pace with a Monitor; going through it keeps the transcript the single place the loop is visible and stoppable.
- **Run loops inside the console.** Rejected: the console has no turn of its own and must not hold a session open; the loop belongs to the Claude session that pays for it.
- **Free-form stop text.** Rejected: an unparseable stop condition is a loop that never stops; a closed grammar can be tested.

## 4. Consequences

- A person can start a bounded, understood loop in three clicks; the cost note is on the confirm.
- The fake test engine cannot observe a submitted slash-prefixed prompt; the exact text is asserted in `tests/loops.spec.ts`, and the kit test asserts the confirm sits under the Start button and nothing failed.

## 5. Safety

Confirm first with the cost; no auto-start; a closed stop grammar; plugin commands only from the session's list; typed text screened; list/stop never stops without asking.

## 6. Tests

`tests/loops.spec.ts` (grammar, builder, every preset builds, launch asks first and screens, mid-turn fill), `tests/loops.test.ts` (the folded section in Automation, picking a preset, the exact `/loop`, the confirm under Start, a worker without its plugin asks nothing).
