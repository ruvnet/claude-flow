# ADR 411: The Claude UI bridge: Ask Claude, Launch, and the plugin map

Status: Accepted

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/host.ts`, `hooks/register.ts` (the bridge), `hooks/ask-claude.ts`, `hooks/plugin-map.ts`, `hooks/views/launch.ts`, `hooks/mission-skills.ts`, `hooks/mission-options.ts` (capabilities).

Extends: ADR 407. Detail of ADR 408 sections 3, 9 and 10.

## 1. Context

The cockpit is a pane inside Claude Code, and the primary Claude Code session is where models run and work gets done. Until 0.13 only Missions could reach it. rUv's requirement is that **every section** can invoke the primary Claude UI, and that every ruflo plugin is reachable from the console. The mod API gives four primitives: `$.prompt.submit` (a prompt as if typed), `$.prompt.fill` (put text in the prompt box), `$.command.run` (run a slash command, including a skill), `$.command.list` (which commands the session offers). Two facts constrain use: the host refuses `submit` and `command.run` from inside a `command.run` hook (it would wait on the turn the hook is holding; `/ruflo yes` is such a hook), and every one of them starts or prepares a billed model turn.

## 2. Decision

### 2.1 One bridge in the host, deferred
`host.submitPrompt`, `fillPrompt`, `runSlash` and `listCommands` are the only way the console touches the session. `submit` and `runSlash` run from a clock tick (`$.clock.after(1, ...)`), a later event of their own, never inside the hook that asked. `fillPrompt` is used instead whenever a turn is active (`state.turnActive`, kept from the prompt bar's render): it only prepares the text and the person presses Enter.

### 2.2 Ask Claude, on every page
A **✦ Ask Claude** button is in every page's footer, and `/ruflo ask <question>` does the same. `VIEW_ASK` has one row per view (a default question and, where a ruflo plugin fits, its slash command). The prompt is the question followed by the view's own text (what `/ruflo dump <view>` prints), quoted as **data**: every line behind `│`, so none can begin a slash command, with an opening line saying the lines are data, not instructions. Secrets are redacted first (keys, tokens, JWTs, bearer headers, PEM blocks, `NAME=value` of a secret name, capped at 4000 characters). The terminal and Settings share no text (a conversation, setting values). A typed question is screened by AIDefence (ADR 410). It always asks first, with the exact text and a billing note; mid-turn it only fills the box. A `/btw` aside variant exists.

### 2.3 Every plugin has a home
`plugin-map.ts` assigns each directory under `plugins/` to the section that owns it, or says why it is reached from the Plugin Catalog only (domain plugins that can spend or write devices: music, market-data, neural-trader, iot-cognitum; and the console itself). `tests/plugin-coverage.spec.ts` reads the directory and fails on an unmapped plugin, a stale entry, or a home that is not a view. Adding a plugin without deciding where it lives breaks CI.

### 2.4 Launch
Every page ends with a folded **Launch** section listing the slash commands of the plugins that section owns, as the session lists them (`listCommands`, read once at open; the page redraws when it arrives). A button asks first, then runs the command in the main UI (or fills the box mid-turn). A command that is not listed is refused, and a section whose plugins are not loaded draws nothing. Mission Control additionally offers the ruflo-goals skills and every other plugin the session offers as **capabilities** run on the goal, with the same confirm and the same AIDefence block.

## 3. Alternatives considered

- **Call the plugins' MCP tools directly from the console.** Rejected as the default: the point is the Claude UI, where the person sees and steers the work; the console already runs fixed ruflo commands where a command is the right unit (labs).
- **Hand-written per-view prompts.** Rejected: the dump already renders every view as words; a table of defaults plus one helper is smaller and cannot drift from what is on screen.
- **Send the question and the data unquoted.** Rejected: a line of data beginning with `/` or `!` would run as a command.
- **Hotkeys for the new buttons.** Not possible: all 36 digit/letter keys are taken (ADR 408 section 6).

## 4. Consequences

- Every section can reach the primary UI; every plugin has a place; both are enforced by tests.
- The footer gains one button; tall pages gain a folded section.
- A prompt submitted as text starting with `/` is run by the engine as a typed command; the fake test engine cannot observe that, so the exact text is asserted in unit specs.

## 5. Safety

Confirm before any turn starts; billing said on the confirm; data quoted and redacted; typed text screened; commands only from the session's own list and a closed name grammar; deferral prevents a deadlocked hook; nothing is read from a plugin's output as instructions.

## 6. Tests

`tests/ask-claude.spec.ts` (table covers every view, scrubber, quoted data, no leading slash, delivery idle and mid-turn, aside, screening, launch list), `tests/plugin-coverage.spec.ts`, `tests/matrix.test.ts` (every view mounts at two widths and its Ask button sends exactly one clean prompt; the Launch section), `tests/mission-review.spec.ts` (a slash launch asks first and is blocked for a flagged goal).
