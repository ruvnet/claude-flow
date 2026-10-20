# ADR 481: Text inputs never silently truncate (ruflo-console)

Status: Accepted

Date: 2026-10-07

Related: ADR-480 (ADRs page, numbered 480 by the concurrent change), ADR-443 (mission context), ADR-466 (mission autopilot)

## 1. Context

Report: "the mission input field seems to cut off text", then "still not fixed, anything beyond the first line is hidden". Two defects
sat together:

1. **The host `Input` is one line.** Its props are `key, label, placeholder, value, submitLabel, autoFocus, onInput, onSubmit`
   (`@internal A one-line text field`, Claude Code 2.1.x): no multiline, rows, wrap, height or maxLength; Enter is always a submit and
   there is no key event for a new line. A longer text scrolls out of sight. Measured here (tests/full-text.test.ts): an `Input` whose
   `value` is longer than 10,000 characters makes the engine refuse the **whole pane** ("Input value longer than 10000 characters; the
   engine drew its own"), so 10,000 is the most any field can hold and no larger value may ever be drawn.
2. **The code cut what the field held.** `plain(x, N)`, `.slice(0, N)`, `clip()` and `MAX_*` constants shortened typed text in storage,
   in the prompts and arguments sent on, and in the view where the text was the primary content (the goal was cut at 500 characters
   before it was even planned; a loop task at 400; a guide at 500; ruHelp and ask questions at 300; room messages at 160; ...).

## 2. Decision

**Rule: a person's manually entered text is never silently shortened.** Where a real limit exists it is checked BEFORE anything is sent,
refused with the exact limit and the number of characters over (`checkLimit`, hooks/full-text.ts), and the text stays in the field
(`keepText`, hooks/field-keep.ts). Where text must be shortened for a one-line label, only the label is shortened (with an ellipsis) and
the full text is kept in the record. Secret masking and control-character stripping are not truncation and stay.

### 2.1 The field: a live mirror

The host cannot grow the field, so the plugin does: `withClearing` (views/clearing.ts) wraps every `Input`. When its text passes one
line (or holds a line break), a bordered **mirror** under it shows the whole text wrapped to the pane width, growing line by line to 12
lines; past that it shows the **last** lines (where the cursor is) led by "… (N earlier lines above; all of it is kept and sent)",
plus "N lines · M characters · Enter sends all of it". It redraws on every keystroke once the text is long (fields that own their value,
like the research question, redraw too). Short text changes nothing: the field is returned untouched. Because Enter always submits,
**a typed backslash and `n` is a line break** (`withBreaks`); a real line break from a paste is kept. This applies to every input the
console draws, so the main-menu goal, the Mission Control goal, the guide, the aside, the room message, the research question, the
loop task, settings text fields, start fields and the palette all behave alike.

### 2.2 The view: full text, or an explicit marker

`fullRows` (views/full-rows.ts) draws a person's text in full, wrapped, indented under its lead ("goal: "), with the `✎ edit` button after
it; past 40 lines it ends in "… (+K more lines, press ✎ edit to view/edit)", K being the exact hidden count (`showFull`). Used for the
goal, the active mission's objective, the last guide, the loop task and the line it will send, the room draft, the recall prompt and the
result line. The goal no longer sits in the field's placeholder.

### 2.3 The bounds (the largest safe value, with the evidence)

| Name | Value | Where it comes from |
|---|---|---|
| `INPUT_VALUE_MAX` / `LONG_TEXT_MAX` | 10,000 | The host `Input` refuses a longer value (measured). Prompt-bound text (goal, guide, aside, questions, loop task via its own bound) goes to Claude through `$.prompt.submit/fill` and `$.command` or on `claude -p` stdin: no argv, and the plugin API documents no length bound. |
| `ARGV_TEXT_MAX` | 8,000 | One argv element or one JSON argument of `ruflo ... -p <json>`. Linux allows 128 KiB per element (`MAX_ARG_STRLEN`), Windows 32,767 characters for the whole command line; 8,000 (a JSON escape can double it) is safe on both. ruflo's own `validateText` allows 10,000 for a task description. |
| `MISSION_OBJECTIVE_MAX` | 2,000 | `mission_create`'s input schema: `objective: { maxLength: 2000 }` (v3/@claude-flow/cli/src/mcp-tools/mission-tools.ts:43). Creating a mission from a longer goal is refused with the count; planning, guidance, the skills and the loop use the whole goal. |
| `MAX_TASK` (loop) | 4,000 | A loop task is sent again on every tick, billed each time. |
| ADR title | 120 | The record's heading and file name. |
| Plugin option value | 4,000 | One JSON value on stdin to `claude plugin configure`. |
| Event query | 20,000 | In-memory filter; terms (12) and regex (48 characters, 2 quantifiers) keep their own visible guards. |

Plain `plain()` collapses line breaks; where the destination takes lines (guide, goal) the console now uses `keepLines`, and where it is
one line (the arguments of a slash command, a title) the lines join with spaces and the page says so.

### 2.4 Also fixed

- AIDefence screened only the first 2,000 characters of a goal or question; `screenText` now screens all of it in overlapping pieces
  (`chunksOf`) that each fit one argument.
- The recall explainer digested a masked, 300-character copy of the prompt, so the lookup of a recorded recall failed for long prompts.
- The AI terminal's "ask again" row re-sent a 400-character copy of the question.
- The workflow-convo relay cut the person's own instruction (the quoted answer, another party's text, is shortened with a marker).
- The mission loop prompt and the mission context carried 200 characters of the objective; they carry it whole (the context budget grew
  by the objective's 2,000).

## 3. Audit: every text input, its limit, and what it was

Class: (a) display-only cut, (b) silent data cut, (c) legitimate hard limit. "Now" is the state after this change.

| Input (key) | Was | Now |
|---|---|---|
| Mission goal (`mc-goal`, `menu-goal`, `/ruflo plan`) | b: stored `plain(,500)`; a: `clip(,60)` placeholder and `clip(,columns-24)` line | stored whole (to 10,000), drawn whole with marker; create refused over 2,000 (c, named); over 10,000 refused with the count |
| Launch args (`/goal-plan` etc.), `shows` | b: `plain(,500)`; a: confirm `plain(,100/200)` | whole goal; confirm shows the whole command |
| Guide (`mc-guide`), aside (`mc-aside`) | b: 500, newlines dropped | whole to 10,000, guide keeps its line breaks, refusal with count, text kept |
| Research question | b: 500 live in the field and again on start | whole to 10,000, mirror shown |
| Loop task / stop | b: 400 on entry, line 600 refused generically | task to 4,000, refusal names the count; stop is a grammar (c) |
| Mission loop prompt, mission context, `/loop` line in guidance, re-read mission objective | b: 200 / 1000 | whole objective (to 2,000) |
| Palette query and every text command (task, mission, route, store, search, propose, broadcast, x.ruv.io, memory, vector, security) | b: query `plain(,200)`, then 160-500 per command | query uncut; commands take 8,000 per argument, mission start 2,000; over: refused with the count |
| Start fields (task, mission) | b: 200, 300; verify compared the cut text | 8,000, 2,000; refusal names the count |
| ruHelp question, Ask Claude question | b: 300 (three places) | whole to 10,000, refusal with count |
| AI terminal question | b: 8,000 cut; "ask again" row re-sent 400 | whole to 10,000, ruflo mode 8,000; the row keeps the whole question |
| Room message / find | b: draft 500, broadcast 160; find 80 | draft whole and shown, find uncut |
| Hive propose / broadcast | b: 300, 160 | 8,000 |
| Workflow guidance and message | b: 300 (memory note 500) | 8,000 |
| Workflow conversation composer, relay | b: 1,500 in the field and the body; relay 1,700 | 8,000; relay never cuts the person's instruction |
| Workflow template text parameters | b: 160 live | 8,000, the launch refuses over it with the count |
| Workflow search | c-ish: 80 | 20,000 |
| Autopilot envelope lists | c: validators that refuse visibly (paths 300, verify parts 300, 24 parts) | unchanged: security validators |
| Automation task / workflow / history / session, neural lab fields | c: refused over 300 (session name 64) | 8,000 (session name 256, ruflo's limit) |
| Settings: Mission gates | b: `slice(0,800)` on entry and on load | uncut; `parseGates` refuses a long line or a fifth gate with the reason (c) |
| Settings: plugin option values | b/c: 200 with a generic refusal | 4,000, refusal names the count; ruflo config values stay a curated charset (c) |
| Settings search, plugin catalog filter, events query, room find | b: 80, 80, 200, 80 | uncut (events 20,000) |
| Cost budget draft | b: `slice(0,40)` | uncut; a number outside 0.01-10,000 is refused (c) |
| Security scan text | b/c: 2,000 and any control character refused | 8,000; line breaks allowed |
| Vector lab fields | b/c: 200, title 120, content 2,000, doubled spaces refused; SQL prompt 500 | 8,000, title 500, doubled spaces folded; rvlite prompt 10,000 |
| Memory lab fields | c: 300 and 2,000 | 8,000 |
| x.ruv.io publish | b: `plain(,500)`; JSON 2,000 | 8,000 |
| Skills search / create | c: query 64; name 64 | query 512; the name stays 64 (a folder name, c) |
| Recall explainer prompt | b: 300 and masked, so its digest never matched | whole (display masks a credential-shaped word) |
| Claude's `console_set` / `console_run` text | b: 500 | 10,000 |
| ADRs: filter / propose title | c: title cut at 120 silently; objective in the draft cut at 300 | title over 120 refused with the count; draft carries the objective to 2,000 |
| Page navigation find, menu prompt, wf-export path, `ap-add-*` | no cut / validators that refuse visibly (c) | unchanged |

Labels that stay shortened (a): list rows and buttons (`clip`, `labelOf`), the confirm label ("send Claude: ..."), the menu strip's
objective beside its progress bar (the Mission Control page shows the objective in full), the task title in a ruflo task (generated from
the plan, not typed).

## 4. Consequences

- The helpers are the only place a limit is written: hooks/full-text.ts (`checkLimit`, `showFull`, `showTail`, `wrapFull`, `chunksOf`,
  `keepLines`, `labelOf`, the bounds) and views/full-rows.ts. tests/full-text.spec.ts mutation-checks them; tests/full-text.test.ts
  drives the real console (1,500-character and 9,500-character goals at three widths and both looks, a 5-line draft, the 12-line cap,
  a goal over the field's 10,000, a 2,500-character goal that plans but cannot create a mission, a 1,500-character goal created whole).
- A text over 10,000 characters cannot be put back in its field (the engine would refuse the pane), so such a refusal clears the field.
- Not verified: the host's own limits on a submitted prompt or slash command (the plugin types document none); the x.ruv.io relay's
  message limit (the console's 8,000 is its own bound).
