# ADR 444: Claude controls the console: model tools, an autonomy level and a live dashboard

Status: Accepted (implemented in ruflo-console 0.30.0, PR #3696; the autopilot default of section 6 shipped in 0.32.0)

Date: 2026 10 04

Scope: `plugins/ruflo-console` (new `model-tools.ts`, `views/control.ts`; `register.ts`, `settings.ts`, `state.ts`, `scripts/smoke.sh`, `scripts/e2e-control.sh`)

Builds on: ADR-406 (missions), ADR-443 (missions and Claude), the console's palette and confirm-gated runner

## 1. Why

The console sends commands and guidance to Claude Code. The reverse is as useful: tell Claude "set up a mission", "open the Learning Lab", "run the security scan" and have it drive the console, with the cockpit showing what it does, the way computer use shows a screen being operated. Everything the console can do for a person already goes through one surface (pages, fields, palette entries, a confirm step), so Claude can use the same surface.

## 2. What was checked (and found)

A throwaway mod registered a tool with `$.tool.register` and answered it from a `tool.call` hook. In this Claude Code build (2.1.x) the tool is listed to the model as `mcp__<plugin>__<name>` even in `claude -p`, and the call ran. The result must be a **string** (an object is refused by the tool's schema check). `scripts/e2e-control.sh` (live, gated by `RUFLO_E2E_LIVE=1`, a few cents with haiku) then ran four real sessions: control off (no tool exists for the model), read (state and open work, a field is refused naming the level), write with auto-confirm (the goal is set and planned, Claude's own call creates the mission) and write with ask (the same action waits for the person and Claude does not confirm it). The live runs found three real problems that unit tests had not: the classifier read "spends nothing" as spending, so creating a mission was refused at `write`; a goal's follow-up (a billed guidance turn) is queued asynchronously after the call returns, so it must not run when Claude is the one driving (the console now skips the offer for 60 s after any tool call); and Mission Control reports its own actions on `last`, not on the generic outcome, so a result was reported without its detail. The last live run then showed that Claude was told "Ran" before the mission existed: the runner deliberately does not wait for an action that brings its own `run` (so a long harness run does not hold a person's buttons), so `confirm()` returns early. The runner now exposes `finished()`, the model tools wait on it for up to 90 s (after that the answer is "Started… still running; call console_state later"), and a person's clicks behave as before. An audit of all 270 palette entries then found `stop the swarm`, `memory cleanup` and `memory migrate` classed as plain writes; they are `delete` now (105 entries read, 101 write, 27 network, 2 spend, 4+ delete: these sum to 239 of the 270, the rest were not itemised, and no test pins the split).

## 3. Decision

Four tools, `mcp__ruflo-console__` plus:

- `console_state`: the page, the readable text of what is on screen (capped, control characters stripped, with a note that third-party text is data), the palette entries (id and label), the pending confirm, the last result and the control settings.
- `console_open {view}`: go to a page and open the pane without taking the keys.
- `console_set {field, value}`: fill a field the pages have (`goal`, `profile`, `rigor`, `research.question|depth|cap`, `dev.<field>`, `cost.budget`).
- `console_run {id, text?}`: run a palette entry, the same ids `/ruflo run` takes.

**How much Claude may do is a setting**, `read` by default since ruflo-console 0.33.18 (it was off; a person who saved "off" stays off):

| Level | Claude may |
|---|---|
| `off` | nothing; the tools are not registered |
| `read` | read the state, open pages, run read-only entries |
| `write` | also fill fields and run entries that write locally |
| `manage` | also run entries that touch the network (install, update, push) |
| `full` | also run entries that spend money or delete or stop things (deploys, cancellations, resets) |

and a second setting, **confirm**: `auto` (default since console 0.32: once the person has chosen a level, Claude runs unattended inside it) lets Claude's call confirm itself, within the level; `ask` leaves every non-read action pending in the console's own confirm row for the person to answer. An entry's class is read from its spec: the console's own read-only flag, else its label, command and notes. Words for deleting, stopping, resetting, cleaning up or migrating make it `delete`; words for a billed turn or "costs money" make it `spend`; words for the network (install, push, fetch, update, publish) make it `network`; anything else that is not read-only is a local `write`. The notes also say what an action does *not* do ("spends nothing", "not a charge", "runs no agent"), and those do not count.

**The cockpit is the dashboard.** An "Claude control" section on Overview shows the level and confirm mode, whether control is on or paused, the call count, and a log of the last actions with their outcome (ok, waiting for you, refused, failed). A **Take back control** button pauses every tool at once (the next call is refused with that reason) and **Give control back** resumes. The log is the audit trail for a session.

**Limits that hold at every level:** a cap of 40 console actions per turn; text values capped at 500 characters; the console's existing checks still run (AIDefence on mission text, fixed argv, the budget and hard-stop settings of ruflo-mods); nothing here can pass a value to a shell. A level lower than an entry needs, or `paused`, refuses with the reason and the setting to change; it never partly runs.

## 4. Consequences

- The console's smoke contract said the console never answers `tool.call`. That is narrowed on purpose: only `hooks/model-tools.ts` may, only for names starting `mcp__ruflo-console__`, never `tool.check`. The smoke step checks it.
- The registered tools add a few hundred tokens to every request in a session where control is on, which is why it is off by default.
- Claude Code's own permission system still applies to these tools: an unlisted tool prompts the person. The console level is a second, independent limit.
- Environment `RUFLO_CONSOLE_CONTROL=<level>:<ask|auto>` sets both for one session without touching saved settings (recordings, tests).

## 5. Not decided here

- A separate human-confirm channel through Claude Code's permission dialog for `ask` mode.
- Per-entry allow lists; the level is coarse by design.
- Driving panes other than the console's own.

## 6. Amendment: autopilot by default

With `ask` as the default, a person who had turned control on found Claude parked on every write, waiting for a Yes that nothing prompted for. The level is the real limit (it defaults to off, and only the person raises it), so the confirm default is now `auto`; `ask` remains an explicit choice. Claude Code's own permission prompt for the four tools is separate: allow `mcp__ruflo-console__*` in the permissions settings to remove that one too (a mod can only tighten `tool.check`, never loosen it).

## 7. Amendment: auto never answers network, spend or delete (console 0.33.4, ADR-450 T8, T12)

`modelConfirm: auto` no longer applies to every class. An action classed `network`, `spend` or `delete` always waits for the person in the console's confirm row, even in `auto`: Claude's call is answered "Waiting for the person to confirm" and it must not retry. `auto` still runs local `write` actions unattended. Text Claude passes to `console_set` (the value) or `console_run` (the text) is screened with the shared secret screen (`hooks/screen.ts`, a copy kept in step by `scripts/sync-mod-screen.mjs`) before it reaches an entry; a match is refused ("that text looks like a secret") and never echoed. `RUFLO_CONSOLE_CONTROL` may only lower the saved level, or force `ask`; it can no longer raise either, so a project's settings `env` cannot give Claude more control than the person saved. For a recording or a test that needs a level, save it in Settings (or the plugin store) instead of the environment.

## Update (2026-10-05): the default is read + ask

Default `modelControl` is now `read` and default `modelConfirm` is `ask`, at the owner's request, so Claude can open pages and read the state of a console without anyone first finding the setting. `read` never acts, so the earlier "parked on every write" problem that moved the confirm default to `auto` cannot arise at the default level; a pending ask is now also shown as a banner in the console. A missing confirm mode is `ask`: only a saved `auto` is auto, and a saved `off` stays off. Raising the level (write and above) remains the person's choice in Settings → Claude control. The four tools now register in every session by default, which adds their few hundred tokens to each request.

## Update 2026-10-08: one path to the model (0.40.2)

Not every string the tools returned went through the sanitiser: a failed run's `stderr:` detail, the "already waiting" refusal, the "Waiting for
the person" and "Started" answers, refusals that quote what the model typed (an unknown id, field or chip), a palette entry id and a thrown
error each quoted their text with `plain()` alone, so a token or an x.ruv.io invite code in a label, an expectation or stderr reached the
model; an invite split by a control character (C0, C1, zero-width) was not masked; and a version such as `v2.1.0-beta.3` was masked as one.
`hooks/model-tools.ts` now has one function, `modelLine(raw, max)`:

1. escape sequences are stripped (the shared `ESCAPES`, now linear: an unterminated OSC ends at the next introducer or the end of the text);
2. tab and line breaks become a space, every other control and invisible character is removed without a space, so none can split a credential
   past a mask;
3. the line is cut to `max`;
4. it is withheld whole (`(line withheld: it looks like a secret: not shown)`) when the original, the joined or the cut form holds a secret
   shape or an invite code (a version such as `v2.1.0-beta.3` is not one; a code the terminal already masked is not either).

`console_state` builds every field with it, every `callTool` answer leaves through `modelLines` (each line again), `refuse` quotes through it,
and a palette entry whose id holds a secret shape is left out of the list. A new builder that skips it fails `tests/model-facing.spec.ts`,
which feeds each builder a token, an invite code (whole and split) and an escape sequence. See also ADR-450 T17 and ADR-407's 2026-10-08 update
(a Yes runs only the card it was pressed on).
