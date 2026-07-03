---
name: harness-learn
description: Run a GEPA learning cycle via `metaharness learn` (upstream ADR-235, metaharness@0.3.0) — optimizes a harness genome against a SWE-bench-style slice manifest. $0 dry-run by default; `--run` is the explicit spend opt-in. Requires a metaharness repo checkout (`--repo` or $METAHARNESS_REPO) — without one it reports `checkout-required` with clone instructions. Degrades gracefully when metaharness is absent.
argument-hint: "--host <h> --model <m> --slice <manifest> [--repo <checkout>] [--run] [--alert-on-fail]"
allowed-tools: Bash
---

Surfaces `metaharness learn` — the upstream GEPA learning harness that
evolves harness policy genomes against a scored task corpus instead of
hand-editing prompts. Candidates are scored on held-out slices and only
measured winners promote (the shipped cand-6 genome is the first such
promotion: holdout gold 2/12 → 3/12, zero regressions).

## When to use

- A harness's policy prompt underperforms on a task family and you want a
  measured improvement loop rather than manual prompt iteration.
- Pricing a learning run before committing spend — the default dry-run
  resolves the slice manifest and reports cost without any model calls.
- After a learn run promotes a genome: pair with `harness-gepa --op render`
  to inspect what the promoted policy actually says.

## Preconditions (upstream design)

The learning harness (GEPA + SWE-bench + Docker) is too heavy for the npm
package, so `learn` needs a local clone:

```bash
git clone https://github.com/ruvnet/metaharness.git
node scripts/learn.mjs --repo ./metaharness --host claude-code --model haiku --slice slices/lite.json
```

Without a checkout the script emits `{status: "checkout-required"}` and
exits 0 — a precondition report, not an error (distinct from
`degraded: true`, which means the npm package itself is absent). The
managed-service path (gateway-side learn jobs, no checkout) is upstream's
ADR-235 follow-up and not available yet.

## Algorithm

Implementation: [`scripts/learn.mjs`](../../scripts/learn.mjs).

1. Validate `--repo` exists when given; export it as `$METAHARNESS_REPO`.
2. Invoke the pinned `metaharness` binary (`metaharness@~0.3.0`, local install
   or one-time versioned cache — never `@latest`): `metaharness learn --host <h>
   --model <m> --slice <s> [--run]` via `_harness.mjs` (graceful degradation,
   hard timeout).
3. Default timeouts: 120s dry-run, 600s with `--run` — real runs on larger
   slices need an explicit `--timeout-ms` matched to slice size × model cost.
4. Detect the checkout-required message → structured payload, exit 0.
5. Parse the trailing JSON report when upstream emits one; otherwise return
   the raw report text under `rawReport`.

## Cost note

`--run` is the ONLY path that spends. Everything else — dry-run, checkout
probe, degraded path — is $0. The MCP tool (`metaharness_learn`) has a 120s
subprocess budget; run real learning cycles from a terminal via
`ruflo metaharness learn ... --run --timeout-ms <big>`.

## Exit codes

- `0` — report produced (or dry-run, checkout-required, degraded)
- `1` — `--alert-on-fail` and the learn run reported failure
- `2` — config error (bad `--repo` path)
