# Adversarial critique — smartSearch() concurrent fan-out candidate (2026-08-13)

Independent review, performed by a second agent with no authorship stake in
the candidate or its benchmark, per STEP 10/11 of the Dream Cycle spec. The
critic re-ran the benchmark independently, read the actual diff and compiled
output rather than trusting the author's description, and stashed/restored
the working tree to isolate a pre-existing test failure.

## Overall verdict: CONFIRMED

The benchmark and tests are honest, reproducible, and correctly scoped to
what they claim. Baseline is genuinely unmodified HEAD; the candidate change
is exactly and only the described concurrency swap; quality (result
identity, order via `Promise.all` + RRF's order-independent fusion) is both
empirically verified and independently traced through the actual code
logic; the pre-existing test failure is confirmed unrelated via
stash-and-isolate. No evidence of benchmark weakening, cherry-picking,
evaluator gaming, threshold tuning, or hidden cost.

## Answers to the STEP 10/11 checklist

1. **Weakened benchmark?** No. Plain `setTimeout`-based mock latency is an
   unbiased proxy for round-trip I/O; thresholds (30%/15%) are declared
   before results and cleared with 2x+ headroom (66-80% vs 30% floor;
   0-9.8% vs 15% ceiling).
2. **Altered gold answers?** No. `qualityIdentical` is a literal
   `JSON.stringify` comparison of real baseline vs. candidate output ids,
   true across all 4 scenarios x 5 repeats, reproduced 3x independently.
3. **Cherry-picked tasks?** No — corpus covers the realistic default
   (2-3 variants), the `multiQuery=false` boundary, and a 5-variant stress
   case. Gap: no scenario with a rejecting `search()` (see #14).
4. **Exploited the evaluator?** No. Compiled `.js` diff confirmed the
   change is confined exactly to the fan-out loop; baseline `.ts` confirmed
   byte-identical to `git show HEAD:...`.
5. **Increased cost materially?** No — no LLM/API calls anywhere in the
   diff or benchmark, no new dependencies.
6. **Latency regression anywhere?** No — single-variant path stays within
   0-9.8% across 3 independent re-runs, never negative.
7. **Quality regression?** No — traced the actual mechanism:
   `Promise.all(...).map()` is ES-spec-guaranteed to preserve input order
   regardless of completion order; RRF fusion accumulates per-item scores
   into a `Map` independent of list order; the one order-sensitive detail
   (stable-sort tie-breaking) is covered by a purpose-built test that makes
   the *first* variant resolve *slowest*.
8. **Merely moved work elsewhere?** Real caveat, not gaming: the mock
   `search()` has no connection-pool/contention model, so the 3-5x figure
   is a latency-hiding upper bound against a pure-I/O-wait model, not a
   guaranteed production number against a real HNSW/AgentDB backend.
9. **Undocumented cache?** None.
10. **Threshold tuning?** No sign of post-hoc tuning — thresholds have
    large headroom versus observed effect sizes.
11. **Leaked expected answers?** No meaningful gold data; new tests use
    deliberately adversarial timing, not trivially-satisfied fixtures.
12. **Is baseline fair?** Yes — confirmed byte-identical to `git show
    HEAD:...`, compiled via the same `tsc` toolchain as candidate.
13. **Statistically meaningful at n=5?** Yes for this effect size (2.9-5x,
    190-400% relative change against low-variance timer noise) — 3
    independent full re-runs landed within 66.0-80% and 0-9.8% respectively.
    For a *production* sizing decision, more repeats (n=20-30) and
    p95/p99 (not just mean) would be warranted — the harness only reports
    mean, a legitimate documentation gap.
14. **Survives a different workload?** Partially. Covered: variantCount=1
    (no regression) and variantCount=5 (scales as expected). **Real gap**:
    a rejecting `search()` is untested. Sequential-loop semantics
    short-circuit (later variants never called); `Promise.all` semantics
    still fire *all* underlying calls before the rejection surfaces —
    meaning on partial failure the candidate makes more backend calls than
    baseline before failing the same way. Not a correctness bug (both
    versions still fail the overall call), but an untested behavioral
    difference in backend load under partial failure.

## Verification the critic performed independently

- Read the real `git diff` of both source files.
- Diffed compiled `.js` output of baseline vs. candidate to confirm no
  hidden scope creep.
- Confirmed baseline `.ts` byte-identical to `git show HEAD:...`.
- Re-ran the benchmark 3 independent times — results stable.
- Ran the full package suite (452 passed, 1 pre-existing unrelated
  failure).
- Confirmed `whoami` → `root`, explaining the pre-existing failure
  (`auto-memory-bridge.test.ts` uses `chmod` to force a read-only file;
  root bypasses that).
- Stashed the candidate diff, re-ran the one failing test in isolation —
  fails identically with the candidate absent, confirming it predates and
  is unrelated to this change. Restored the working tree afterward.

## Notable independent corroboration

The critic's finding #14 (partial-failure call-count difference) was
reached independently of, and matches, this same Dream Cycle's bounded
Darwin exploration (`darwin-lineage-2026-08-13.json`), which separately
identified fault-tolerance as the one dimension where an alternative
fan-out strategy (`Promise.allSettled`) outperforms the shipped candidate.
Two independent evaluation methods converging on the same residual gap is
stronger evidence that it's real and worth a dedicated follow-up, not
noise.
