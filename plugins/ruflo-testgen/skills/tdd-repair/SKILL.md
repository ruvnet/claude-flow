---
name: tdd-repair
description: Test-Driven Repair — given a failing test, spawn a bounded headless `claude -p` (Read/Edit/Bash only) that makes the test pass without modifying it. Modeled on agent-harness-generator's ADR-175 Test-Driven Repair mode. Bounded cost via --max-budget-usd, bounded capability via --allowedTools. Closes the loop the TDD plugins didn't — we generate tests, this fixes the code to satisfy them.
argument-hint: "--repo <path> --test <path> --test-command <cmd> [--max-attempts 1] [--budget 5.00] [--model haiku] [--confirm]"
allowed-tools: Bash
---

Surfaces the **Test-Driven Repair** loop as a ruflo skill. Use when you have a failing test and want the source-under-test fixed automatically, with the test's pass/fail as the verification gate (no LLM-as-judge).

## When to use

- Failing CI test from a recent commit — point this at the test file, get a verified fix (or a clear "couldn't repair within budget" receipt).
- Local TDD workflow — write the failing test first (`tdd-workflow` skill), then run `tdd-repair` to drive the green.
- Regression triage — a previously-green test went red; before opening an issue, spend ~$1 to see if the fix is trivial.

## When NOT to use

- **No failing test exists.** Conformant mode (`--no-test-oracle`) is scoped for a follow-up ADR — needs MCTS over repro generation. For now, write a failing test first.
- **Architectural changes.** This skill is for tactical "make red green" fixes. Cross-module refactors that incidentally break tests should be done by a human or a swarm.
- **Untrusted code.** The headless `claude -p` runs with `--allowedTools Read,Edit,Bash` — no MCP, no network, no arbitrary file writes — but Bash can still touch the filesystem. Don't point this at code you wouldn't `git checkout .` after.

## Algorithm

Implementation: [`scripts/tdd-repair/tdd-repair.mjs`](../../scripts/tdd-repair/tdd-repair.mjs).

1. **Pre-flight verify** — run the test command. If it already passes, exit 2 (`test-already-passes`). Repairing a green test is either a no-op or a `--test-command` typo.
2. **Spawn `claude -p`** with a focused prompt:
   - Failing test file path (read-only intent)
   - Test command (run only)
   - Hard constraint: do NOT modify the test
   - Hard constraint: do NOT add new dependencies
3. **`--allowedTools Read,Edit,Bash`** restricts capability. **`--max-budget-usd`** caps cost per attempt. **`--permission-mode acceptEdits`** auto-accepts file edits within the allowed set.
4. **Re-run the test** to verify. The test's exit code IS the fitness function — no separate sandbox / LLM-as-judge.
5. **If green:** emit `success: true` + per-attempt usage. **If red after `--max-attempts`:** emit `success: false` + receipts. Either way, the workspace is left as `claude -p` modified it (caller can `git diff` to review).

## Output shape

```json
{
  "success": true,
  "data": {
    "repaired": true,
    "attemptsTaken": 1,
    "mode": "test-driven",
    "before": { "passed": false, "exitCode": 1 },
    "after":  { "passed": true,  "exitCode": 0, "durationMs": 4321 },
    "attempts": [
      { "attempt": 1, "claude": { "ok": true, "durationMs": 38421, "usage": { "cost_usd": 0.0234 } }, "verify": { "passed": true } }
    ],
    "totalCostUsd": 0.0234,
    "budgetUsd": 5.0,
    "budgetExhausted": false,
    "shape": { "repo": "...", "test": "...", "testCommand": "...", "maxAttempts": 1, "model": "haiku" }
  }
}
```

## Exit codes

| Code | Meaning |
|---|---|
| 0  | Test green after repair (success) |
| 1  | Test still red after `--max-attempts` |
| 2  | Config error (test file missing, test already passes, `--no-test-oracle` unsupported, etc.) |
| 3  | Claude CLI exited non-zero (infrastructure failure) |
| 99 | Reserved for safety tripwire (per ADR-153) |

## Safety posture

| Layer | Mechanism |
|---|---|
| Cost cap | `--max-budget-usd` default $5, divided across `--max-attempts`. Hard ceiling — claude exits when reached. |
| Capability cap | `--allowedTools Read,Edit,Bash` — no MCP, no network, no arbitrary writes. |
| Scope cap | Prompt forbids modifying the test or adding dependencies. |
| Confirmation gate | `--confirm` REQUIRED — without it, returns dry-run plan (mirrors `harness-evolve` / `harness-mint` convention). |
| Hard timeout | 15 min total wall-clock; per-attempt budget of `timeoutMs / maxAttempts`. |
| Pre-flight | Refuses to run if the test already passes (catches `--test-command` typos). |

## Inspiration

Modeled on the **Test-Driven Repair** mode from [agent-harness-generator/packages/darwin-mode](https://github.com/ruvnet/agent-harness-generator/tree/main/packages/darwin-mode) ADR-175. Key design difference: instead of wrapping `metaharness-darwin evolve` (population-based search), we drive a single `claude -p` invocation. Rationale:

- The test command IS the fitness function — no need for variant scoring
- `claude -p` is already in our stack — no new optional dep
- Bounded cost / capability are first-class flags
- Resumable via `--session-id` if iteration is needed

Conformant mode (no test, write own repro via MCTS) is deferred to a future ADR.

## Example

```bash
# Smoke / dry-run (no --confirm yet)
node plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs \
  --repo /path/to/myrepo \
  --test tests/auth.test.ts \
  --test-command "npx vitest run tests/auth.test.ts"

# Actually repair (Haiku tier, $5 budget, 1 attempt)
node plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs \
  --repo /path/to/myrepo \
  --test tests/auth.test.ts \
  --test-command "npx vitest run tests/auth.test.ts" \
  --confirm

# Bigger model + more attempts for harder bugs
node plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.mjs \
  --repo . --test tests/regression-2456.test.ts \
  --test-command "npm test -- tests/regression-2456.test.ts" \
  --model sonnet --max-attempts 3 --budget 15.00 \
  --confirm
```

## Cost ladder

| Tier | Model | Per-attempt typical | Use when |
|---|---|---:|---|
| 1 | Haiku | $0.02 – $0.20 | First try — most "make red green" bugs are tactical |
| 2 | Sonnet | $0.30 – $2.00 | Haiku failed, or the bug has multi-file scope |
| 3 | Opus | $1.50 – $8.00 | Sonnet failed — architectural reasoning required (rarely worth it for a single failing test) |
