---
name: browser-screenshot-diff
description: Visual + DOM diff between two recorded sessions at matching trajectory step ids; used for visual regression and replay verification
argument-hint: "<session-id-a> <session-id-b> [--threshold <0..1>] [--mode pixel|dom|both]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__browser_eval Bash Read Write
---

# Browser Screenshot Diff

Compare two recorded sessions step-by-step. Pairs each step in session A to the same `step-id` in session B, diffs the captured screenshot and accessibility snapshot, reports the first divergence and an aggregate similarity score.

## When to use

- Visual regression after a UI change (record before, record after, diff).
- Verifying a `browser-replay` run matches the parent session within tolerance.
- Comparing two A/B variants of the same form flow.

## Steps

1. **Locate both RVF containers**:
   ```bash
   npx -y ruvector@0.2.25 rvf status <session-id-a>.rvf
   npx -y ruvector@0.2.25 rvf status <session-id-b>.rvf
   ```
2. **Load both trajectories** from `trajectory.ndjson`. Build a `step-id → (screenshot_path, snapshot_path)` map for each.
3. **Pair steps** by `step-id`. Steps that exist on only one side are flagged as `unmatched` and contribute to the divergence score.
4. **Pixel diff** (`--mode pixel|both`): compare the two PNGs at each step. Report `mse`, `psnr`, and the bounding box of the largest diff cluster. Threshold default `0.02` (2% of pixels).
5. **DOM diff** (`--mode dom|both`): compare the accessibility snapshots node-by-node. Report added / removed / changed nodes with their accessible names.
6. **Aggregate similarity**: weighted average across matched steps, weighted by step duration. Verdict goes into a new `findings.md` under a fresh RVF container so the diff itself is replayable.
7. **Persist** the diff verdict in `browser-sessions` under both source ids' tags so future searches surface "ran a diff against session X".

## Caveats

- Pixel diff is sensitive to font hinting, antialiasing, and scrollbar position. Keep viewport pinned across both sessions.
- DOM diff over Playwright's accessibility tree is more stable than HTML diff. Prefer it.
- This skill does not handle dynamic content (clocks, ads); add ignore regions to the field map or pre-process snapshots before diffing.
- The `browser_screenshot_diff` MCP tool is **not** planned (ADR-0001 §7); the skill operates against locally-saved RVF artifacts and uses `browser_eval` only for live verification.
