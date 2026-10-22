# ADR 413: The ruflo-console regression system

Status: Accepted

Date: 2026 10 03

Decision owner: Ruflo maintainers

Scope: `plugins/ruflo-console/tests/**`, `plugins/ruflo-console/scripts/{smoke,e2e,e2e-lib,e2e-smoke}.sh`, `scripts/ci-test-baseline.txt`.

Extends: ADR 407 section 12 (release gates). Detail of ADR 408 section 10.

## 1. Context

The console grew to 28 views, hundreds of buttons, a bridge into the primary Claude UI and several features that interact (the attention panel, the plugin map, the launch rows). Tests existed per feature, each naming the views it touched. A deep review found what that misses: a view added to `VIEWS` but never swept; a hotkey collision; a duplicate element key; a button whose handler did nothing; a plugin added with no place in the console; a crash only at a narrow width. rUv asked for a regression system proving every section works end to end.

## 2. Decision

Five layers, each catching what the one below cannot.

1. **Pure specs** (`tests/*.spec.ts`, vitest, no engine): planner optimality and waves, argv for every palette and lab entry, the scrubber, the screen grammar, the loop grammar, the optimizer's findings, the nav hotkeys (single digit or lowercase letter, unique, none on a reserved key, Missions is 1), `plugin-coverage` (every plugin directory has a home; no stale entry; every home is a view; a catch-only plugin says why), and a guard that **every Optimizer fix is a real palette entry** (a typo is a dead button). `smoke.sh` runs all of them.
2. **Kit tests** (`tests/*.test.ts`, `claude plugin test`, the real engine with fake CLI, fs and session): each feature end to end, and **`matrix.test.ts`**: for every view in `VIEWS`, at 80 and 150 columns, it mounts the pane, forbids `undefined`, `NaN`, `[object`, `TypeError` and `ReferenceError` in the text, requires the view to name itself, forbids two Buttons or Inputs with one key, then presses **Ask Claude** and requires the confirm first and exactly one clean prompt after yes (quoted data, no secret). `sweep.test.ts` presses every button of each lab. Kit tests cannot run under root vitest (the engine package does not resolve there), so `scripts/ci-test-baseline.txt` lists them and smoke step 12 fails when a `*.test.ts` file is missing from it.
3. **Conformance** (`conformance.spec.ts`, `RUFLO_CONFORMANCE=1`): every palette, start and lab argv is checked against the real CLI's `--help` and MCP tool names.
4. **Smoke** (`smoke.sh`, 16 steps): plugin.json and version, hooks.json names one module, no classic hooks, no secrets, every source file under 500 lines, kit tests registered, the marketplace lists the console, all pure specs, the live-smoke script exists and skips cleanly, `VIEW_ASK` covers `VIEWS`.
5. **Live no-spend smoke** (`e2e-smoke.sh`): with `RUFLO_E2E_LIVE=1` it opens every view with `/ruflo <view>` in a real Claude Code under tmux (an isolated config dir with the login copied and shredded on exit, as `e2e.sh` does), fails on a thrown render or a broken frame, and takes **no AI turn and writes nothing**. Without the flag it prints SKIP and exits 0, so CI can run it everywhere.

## 3. Alternatives considered

- **One big end-to-end test against the real CLI.** Rejected for CI: slow, network-dependent and flaky; the live smoke exists for it, off by default.
- **Snapshot tests of every view.** Rejected: the BBS look, animation and data make snapshots churn; the contract (no error text, unique keys, the bridge works) is what matters.
- **Assert a handler on every Button.** Tried in the matrix; the engine keeps `onPress` closures out of the element, so the check was always false. Dead buttons are caught by the sweeps and by specs on the entries buttons run.

## 4. Consequences and lessons

- A new view fails CI until it has a hotkey, an ask row, a plugin home if it owns a plugin, and a matrix entry (derived from `VIEWS`, so automatically).
- Timing is a real constraint: the Dev Tools sweep must finish in the engine's 5 s default test budget (it took 3.3 s; a render change that cost 1 s per sweep was caught and redesigned, ADR 412).
- A GitHub `Test Suite` check that runs network validators (marketplace clone, MetaHarness packages) fails now and then for reasons unrelated to a change; rerunning the failed job is the correct response, and the log is read first.

## 5. Safety

The live smoke never presses Enter in Claude's own prompt except to submit a `/ruflo` slash command; it takes no AI turn, writes no ruflo state, and its credential copy is 0600 and shredded.

## 6. Sources

`plugins/ruflo-console/tests/{matrix,attention,sweep}.test.ts`, `tests/{nav,plugin-coverage,ask-claude,optimizer,loops,learning}.spec.ts`, `scripts/smoke.sh`, `scripts/e2e-smoke.sh`.
