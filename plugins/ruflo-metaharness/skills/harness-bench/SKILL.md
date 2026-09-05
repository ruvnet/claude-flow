---
name: harness-bench
description: Manage `@metaharness/darwin` bench suites — `bench create <repo>` scaffolds a JSON suite from a repo's test corpus; `bench verify <suite.json>` checks suite well-formedness. Bench suites are the fixed evaluation corpora that `harness-evolve --bench <suite.json>` scores variants against, decoupling evolution from the repo's natural tests. Degrades gracefully when @metaharness/darwin is absent.
argument-hint: "--op create --repo <path> [--out <path>]  |  --op verify --suite <path>"
allowed-tools: Bash
---

Surfaces `metaharness-darwin bench <create|verify>` — the supporting verb
for `harness-evolve --bench`. Use when you want evolution scored against a
fixed corpus (independent of `npm test`) so champion fitness is comparable
across commits or across forks of the same harness.

## When to use

- Setting up a new evolution pipeline for a repo whose `npm test` is
  flaky, slow, or undersized — scaffold a deterministic bench suite once,
  then evolve against it repeatedly.
- CI: `bench verify` the checked-in suite on every PR that touches it
  (cheap; ~5s).
- Forking a harness to a new domain: copy and edit the suite to retarget
  the evaluation without losing comparability to the parent.

## Algorithm

Implementation: [`scripts/bench.mjs`](../../scripts/bench.mjs).

### `--op create`
1. Resolve `--repo` path; reject if missing.
2. Shell to `metaharness-darwin bench create <repo> [--out <suite.json>]`.
3. Default output path: `<repo>/.metaharness/bench/suite.json` (chosen by upstream).
4. Suite shape (per upstream): array of `{ input, expectedOutput, weight }` tasks
   derived from existing test cases.

### `--op verify`
1. Resolve `--suite` path; reject if missing.
2. Shell to `metaharness-darwin bench verify <suite.json>`.
3. Exit 1 if any task malformed (upstream's signal).

## Output shape

```json
{
  "success": true,
  "data": {
    "op": "verify",
    "taskCount": 42,
    "wellFormed": true,
    "durationMs": 870
  }
}
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | OK (or degraded — Darwin absent) |
| 1 | `--op verify` and suite malformed |
| 2 | Config error or upstream invocation failure |

## Graceful degradation

When `@metaharness/darwin` is absent, emits the standard `{degraded: true,
reason: 'metaharness-darwin-not-available'}` payload and exits 0.
