---
name: browser-replay
description: Replay a recorded session trajectory against the same URL or a mutated variant; uses browser-selectors embedding similarity to recover from DOM drift
argument-hint: "<session-id> [--url <new-url>] [--mutate <json>] [--tolerance <0..1>]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__browser_open mcp__plugin_ruflo-core_ruflo__browser_close mcp__plugin_ruflo-core_ruflo__browser_click mcp__plugin_ruflo-core_ruflo__browser_fill mcp__plugin_ruflo-core_ruflo__browser_type mcp__plugin_ruflo-core_ruflo__browser_press mcp__plugin_ruflo-core_ruflo__browser_select mcp__plugin_ruflo-core_ruflo__browser_check mcp__plugin_ruflo-core_ruflo__browser_uncheck mcp__plugin_ruflo-core_ruflo__browser_hover mcp__plugin_ruflo-core_ruflo__browser_wait mcp__plugin_ruflo-core_ruflo__browser_screenshot mcp__plugin_ruflo-core_ruflo__browser_snapshot mcp__plugin_ruflo-core_ruflo__browser_eval Bash Read
---

# Browser Replay

Re-drive a recorded session trajectory. Used for regression testing, deterministic re-runs, and as the verification path that `browser-record` plus `browser-selectors` actually produces something replayable.

> **This skill is the load-bearing assumption of the v0.2.0 architecture.** ADR-0001 Verification §4 requires ≥80% replay success across 10 distinct sites of varying drift profiles before the proposal moves from `Proposed` → `Accepted`. If you find replay unreliable, capture the failure modes in `findings.md` and report them up the ADR.

## When to use

- Regression-testing a UI flow after a deploy.
- Reproducing a bug captured in a prior session.
- Comparing two runs of the same flow for `browser-screenshot-diff`.
- Forking a session (`/ruflo-browser fork`) and replaying the parent before mutating.

## Steps

1. **Locate the source session**:
   ```bash
   npx -y ruvector@0.2.25 rvf status <session-id>.rvf
   ```
2. **Load the trajectory**:
   ```bash
   Read .../trajectory.ndjson
   ```
   Each line is `{ts, action, args, selector, result}`.
3. **Open a fresh browser** via `mcp__plugin_ruflo-core_ruflo__browser_open` (target URL = original or `--url` override).
4. **For each trajectory step**, dispatch the matching MCP tool (`browser_click`, `browser_fill`, `browser_eval`, etc.) with the recorded args.
5. **On selector miss**, do *not* fail immediately — query the `browser-selectors` namespace for an embedding-similar selector for the same `<host>:<intent>` and retry once:
   ```bash
   npx -y @claude-flow/cli@latest memory search --namespace browser-selectors \
     --query "<host> <intent>" --limit 5
   ```
6. **Record a new trajectory** for the replay run (allocate a fresh RVF container, lineage-tracked via `rvf derive`).
7. **Verdict**: tally matched-step / total-step ratio. Default tolerance threshold is 0.85 (configurable via `--tolerance`). Verdict goes into `findings.md`.

## Caveats

- Browserbase explicitly does not offer replay (rrweb session replay was deprecated). We're betting on selector-embedding recovery; expect noise on heavily drifted sites.
- Network nondeterminism (timing, content variation) can produce false-fail verdicts. Use `--mutate` to inject expected variation or pin to a fixture.
- For visual diff, chain into `browser-screenshot-diff` against the parent session id.
- If selector recovery requires more than one retry per step, log it. That's the signal that the site needs a re-record, not a replay.
