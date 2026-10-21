# ADR 410: Claude's guidance on a mission, and the AIDefence screen

Status: Accepted

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console`: `hooks/mission-guidance.ts`, `hooks/mission-options.ts`, the NEXT STEP to-do in `hooks/views/mission-launch.ts`, the `Mission guidance` setting.

Extends: ADR 409 (the planner). Detail of ADR 408 sections 4 and 9.

## 1. Context

The deterministic plan (ADR 409) says what stages a mission has. It cannot say which of the dozens of ruflo capabilities (plugins, agents, skills, MCP tools) fit this goal, what is risky, or what the plan leaves out. A model can, but a model turn costs money, sees whatever it is given, and may be given hostile text (a goal pasted from an issue). Two decisions follow: how guidance is produced, and how what the person types is screened first.

## 2. Decision

### 2.1 Guidance is one read-only `claude -p` turn
After a goal is planned, `startGuidance` runs `claude -p --output-format stream-json --verbose --include-partial-messages --permission-mode plan --max-budget-usd <Settings budget> [--model <Settings model>]` with a fresh session and the prompt on **stdin** (never an argument). The prompt carries: the goal, the kind and rigor, the plan and lifecycle, **this installation** (the ruflo plugins and slash commands the session lists, the AI settings) and the request: guidance **by lifecycle stage** (what to do for this goal, the acceptance evidence, which exact agents, plugins, skills, MCP tools or ruflo commands to bring in, preferring what is installed and saying plainly what is not), then *Suggestions* (capabilities the plan does not use) and *Risks*, under 700 words. The answer streams into a collapsible section, stripped of escape and control characters, capped at 400 lines and five minutes, with a Stop button.

### 2.2 It asks first, and the setting decides how
It spends, so it asks first, under the goal, with the exact command (scope `goal`); **Always accept AI turns** runs it at once; **Mission guidance** in Settings turns it off. The ask is bound to the goal it was made for: if the goal changed, or its screen verdict became blocking, nothing is sent. Re-asking stops a guidance turn still running rather than orphaning it.

### 2.3 AIDefence screens what the person typed
`screenText` runs `aidefence_is_safe` and `aidefence_has_pii` through `ruflo mcp exec` (local, $0; the detector may install itself once). Verdicts: **unsafe** blocks guidance, creating the mission and slash launches; **PII** blocks guidance (a model would see it) but not creating; **unavailable** (either detector silent, or the tool missing) warns and blocks nothing, because a gate that fails closed on a missing optional dependency would make the console unusable offline. Both detectors must answer for "safe". The text itself is never put in the verdict. A toggle turns the screen off. It screens the **goal** and the **guide** text (and, later, the Ask Claude question and a hand-typed loop task, ADR 411 and 414); text the console wrote itself (presets, the view dump) is not screened.

### 2.4 The NEXT STEP to-do
Everything the person does next sits directly under the goal, in order: goal planned, AIDefence screen, Claude guidance, create the mission, hand tasks to Claude. The first open step is marked and carries a primary button; the confirm each step raises is drawn inside the box. The to-do replaced a layout in which the guidance ask was at the top, the plan in the middle and the create button at the bottom.

## 3. Alternatives considered

- **Guidance on every goal keystroke / automatically.** Rejected: it spends without asking.
- **Resume the user's main session for guidance.** Rejected: it would pollute the transcript and the context window; a separate read-only session costs one bounded turn.
- **Fail closed when AIDefence is unavailable.** Rejected (above): warn, show it in the to-do, let the person decide.
- **Screen everything, including console-written text.** Rejected: it adds two subprocess calls to every action for text that is not the person's input.

## 4. Consequences

- A mission costs nothing until the person agrees to the guidance turn or hand-over.
- The screen adds two local calls per typed goal or guide (cached by nothing; they are quick and local).
- A flagged goal cannot be created from the palette either (the palette routes through the same actions).

## 5. Safety

Plan mode, read-only, budget cap, five-minute cap; text on stdin; escape and bidi characters stripped from the answer; the verdict never echoes the text; the detector's absence is shown, not hidden.

## 6. Tests

`tests/mission-guidance.spec.ts` (argv, prompt contents, asks first, always accept, off, streaming, failure, control characters), `tests/mission-review.spec.ts` (stale ask, half a screen is not a screen), `tests/missions.test.ts` (the to-do under the goal; an injection goal blocks guidance and create; turning the screen off lets it through).
