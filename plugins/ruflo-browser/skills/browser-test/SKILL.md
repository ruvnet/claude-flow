---
name: browser-test
description: UI test recipe -- composes browser-record (capture) + browser-replay (verify) so every test produces a replayable RVF artifact, not an ephemeral run
argument-hint: "<url> [--screenshot] [--against <prior-session-id>]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__browser_open mcp__plugin_ruflo-core_ruflo__browser_click mcp__plugin_ruflo-core_ruflo__browser_fill mcp__plugin_ruflo-core_ruflo__browser_type mcp__plugin_ruflo-core_ruflo__browser_press mcp__plugin_ruflo-core_ruflo__browser_check mcp__plugin_ruflo-core_ruflo__browser_uncheck mcp__plugin_ruflo-core_ruflo__browser_select mcp__plugin_ruflo-core_ruflo__browser_hover mcp__plugin_ruflo-core_ruflo__browser_wait mcp__plugin_ruflo-core_ruflo__browser_screenshot mcp__plugin_ruflo-core_ruflo__browser_snapshot mcp__plugin_ruflo-core_ruflo__browser_get-text mcp__plugin_ruflo-core_ruflo__browser_get-title mcp__plugin_ruflo-core_ruflo__browser_get-url mcp__plugin_ruflo-core_ruflo__browser_get-value mcp__plugin_ruflo-core_ruflo__browser_eval mcp__plugin_ruflo-core_ruflo__browser_close mcp__plugin_ruflo-core_ruflo__browser_session-list mcp__plugin_ruflo-core_ruflo__aidefence_is_safe Bash Read Write
---

# Browser Test

Automated UI testing. **Now backed by a recorded RVF session container** instead of an ephemeral run, so every test produces a replayable artifact.

## When to use

- Verifying UI functionality, user flows, or that frontend changes work in a real browser.
- Producing a baseline session that future regressions can diff against.
- Re-running a stored test session when CI fails (no need to re-author the test).

## Steps

1. **Record the test run** by composing `browser-record`:
   - Allocates an RVF container with `--kind browser-session`.
   - Begins a ruvector trajectory.
2. **Drive interactions** — `browser_open`, `browser_click`, `browser_fill`, `browser_type`, `browser_select`. Each action emits a `trajectory-step`.
3. **Wait** for elements / network idle via `browser_wait` before assertions.
4. **Validate** with `browser_get-text` / `browser_get-value` / `browser_get-title` / `browser_get-url`. Validation outcomes go into `findings.md` inside the RVF container.
5. **Screenshot** before / after key interactions for visual regression. Filenames follow `<step-id>.png`.
6. **Snapshot** the accessibility tree at navigation boundaries.
7. **End** the session: `trajectory-end --verdict pass|fail`, `rvf compact`, AgentDB index in `browser-sessions`.
8. **(Optional) Diff against `--against <prior-session-id>`**: invoke `browser-screenshot-diff` to compare the new run with a baseline.

## Navigation

- `browser_back` / `browser_forward` for history navigation
- `browser_reload` to refresh the page
- `browser_scroll` to scroll to elements or coordinates

## What changed from v0.1.0

- The skill no longer ends with `browser_close` alone — it ends with the session-end protocol.
- Selectors discovered during the test land in `browser-selectors` (host:intent), so the next test can find them by embedding similarity.
- Validation outputs pass `aidefence_is_safe` before any LLM-facing summary; injection-flagged content is quarantined to `findings.md`.
- The same skill, used in CI, now produces an artifact that `/ruflo-browser replay` can re-drive.

## Tips

- Use `browser_wait` before assertions to handle async rendering.
- For visual regression, save the parent session id and pass `--against <id>` on the next run.
- Use `browser_eval` for custom JavaScript assertions — but redact any returned strings via the `aidefence_is_safe` gate before logging.
