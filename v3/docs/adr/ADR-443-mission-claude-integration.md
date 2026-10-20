# ADR 443: Missions that Claude knows about, verified evidence, mission spend and a loop manager

Status: Accepted (ships in ruflo-console 0.29.0 with ruflo-cost-tracker 0.27.1)

Date: 2026 10 04

Scope: `plugins/ruflo-console` (new `mission-context.ts`, `mission-verify.ts`, `mission-loop.ts`, `data/mission-cost.ts` and their views; wiring in `register.ts`, `mission-control.ts`, `settings.ts`), `plugins/ruflo-cost-tracker` (`ledger.mjs` window and project filters)

Builds on: ADR-406 (missions), ADR-437 (cost ledger), ADR-441 (loop-centric missions)

## 1. Why

A mission today is text handed to Claude one task at a time. Claude does not know the mission between hand-offs, "done" is whatever gets recorded, spend is not tied to a mission, and the loop settings of ADR-441 are guidance, not behaviour. Long missions also need something to start, watch and re-arm their loop: a recurring `/loop` task expires after 7 days and lives only in its session.

## 2. Decision

Four capabilities, built as pure modules with their own tests; the integrator wires them into the existing files.

1. **Mission context in Claude's prompt** (`mission-context.ts`). A `prompt.compose` hook adds one `session`-scope section (id `ruflo-console:mission`): the objective, the active task, its acceptance checks, the evidence rule, the stop rule. It changes only when the mission, the active task, its status, paused/cancelled or the loop on/off changes, never per turn: a changed system prompt makes Claude re-read the whole conversation at cache-write price, so churn costs money. At most 1200 characters; a Settings row `missionContext` (default on) turns it off. A `turn.complete` hook notes the turn in the ledger; completion still comes from the ruflo task store, which stays the authority.
2. **Verify** (`mission-verify.ts`). A task is "done" with evidence. Gates are the person's own commands (Settings row `loopGates`: up to 4 lines, each 1 to 200 characters, split on spaces into a fixed argv, never a shell, no `;`, `|`, `&`, `>`, `<`, `` ` ``, `$(`, newline or leading `-`). Running a gate asks first with the exact argv; its exit code and a short output summary are recorded as an evidence event. With no gates configured the page says so; nothing is invented.
3. **Mission spend** (`data/mission-cost.ts` and the ledger filters). The cost ledger gains `--from`, `--to` (ISO times) and `--project` (a path prefix) so the console can ask for the spend inside a mission's time window in its project. The mission shows spend, an optional cap (USD) and the ADR-437 ladder (50, 75, 90, 100 percent); auto-run pauses at the cap. Numbers are list-price estimates and say so; unpriced models are listed, not counted as $0.
4. **Loop manager** (`mission-loop.ts`). For a long-running mission it prepares, tracks and re-arms the `/loop`:
   - **Start:** prepares `/loop <interval> <prompt>` in the main UI (asks first). The prompt carries a marker `[mission:<id> loop]` so a tick is recognised when it arrives.
   - **State:** `{ missionId, interval, startedAtMs, expiresAtMs (start + 7 days), ticks, lastTickMs, status: 'idle'|'armed'|'stopped'|'expired'|'done' }`, serialised with the mission so it survives a restart. Ticks are counted from submitted prompts that carry the marker.
   - **Watch:** next-tick estimate, tick count, last tick, time to expiry, a warning inside the last 24 hours, and "overdue" when no tick arrived for three intervals.
   - **Stop and re-arm:** Stop prepares the request to cancel the recurring task (Claude owns `CronDelete`); Re-arm prepares a fresh `/loop` with the same prompt. The console never schedules anything itself.
   - **Tick plan:** a pure function turns state, settings, spend and the mission into what the tick should do (run the next ready task, run the gates, wait, or stop with the reason). Finish and stop rules come from ADR-441; push and publish stay off unless the setting says otherwise.

## 3. Safety

- No capability sends anything over the network. Gate commands and the loop hand-off always ask first and show the exact text.
- The context section contains only the mission's own fields, each capped, with control characters stripped; it never includes file contents, secrets or fetched text.
- A gate is never run silently by auto-run unless the person turned on a setting for it; the default is off.

## 4. Not decided here

- Parallel task hand-out in worktrees (plan data exists; the runner stays one task at a time).
- Starting a mission from an issue or PR URL, templates, Markdown export.
- Whether Claude Code's `prompt.compose` section is shown in the cache accounting as expected: UNVERIFIED, to be measured in a live session.
