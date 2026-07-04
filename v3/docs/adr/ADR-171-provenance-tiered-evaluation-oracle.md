# ADR-171: Provenance-Tiered Evaluation Oracle for Distillation Gold-Labeling

**ID**: ADR-171
**Status**: Proposed — implemented on `feat/agenticow-integration` (ships in 3.21.0)
**Date**: 2026-07-04
**Authors**: rUv (drafted with Claude Code)
**Related ADRs**:
- ADR-169 (Benchmark reporting integrity — never present a proxy as ground truth; this ADR is that principle applied to training-data labels)
- ADR-170 (agenticow substrate — supplies the branches whose promotion this oracle gates)
- ADR-172 (Fable advisor harness — the Tier-2 judge mechanism)
- ADR-173 (Remote GPU distillation — consumes the labels this oracle produces)

---

## 1. Context

The weight-eft distillation slice (ADR-173) needs a gold `resolved: boolean` per trajectory to build SFT data. **ruflo has no SWE-bench oracle** — historically `resolved` was derived from `output-verifier` structural confidence: a *proxy*. A tune on proxy-labeled data distills plausible-but-wrong completions, and a single blended "resolved" number is exactly the benchmark theater ADR-169 forbids.

Two facts changed the calculus:
- A real GPU/compute host (`ruvultra`, tailscale) can execute actual task evaluations (FAIL_TO_PASS), giving true ground truth for trajectories that carry a test spec.
- A headless Fable judge (ADR-172) is cost-viable (~$0.02/item batched) as a smarter-than-structural labeler for the residue.

## 2. Decision

Label `resolved` through a **tiered trust hierarchy**, and **tag every label with its provenance**. Never blend tiers into one opaque score.

```
Tier 1  oracle:test-exec   real evaluation (FAIL_TO_PASS via darwin bench/eval,
                           executed on a remote GPU host over SSH) — GROUND TRUTH
Tier 2  judge:fable        headless Fable LLM-as-judge (ADR-172) — smarter proxy
Tier 3  proxy:structural   output-verifier structural confidence — WEAKEST, triage only
```

Interface:
```ts
labelResolved(trajectories, opts): Promise<Array<{
  ...trajectory,
  resolved: boolean,
  resolvedBy: 'oracle:test-exec' | 'judge:fable' | 'proxy:structural',
  resolvedConfidence?: number,
  resolvedReason?: string,
}>>
```
Tiers are tried in order per trajectory; the first that can decide wins, and its tag is recorded. **Default (no opts) = Tier-3 proxy + a Tier-1 dry-run preflight, ZERO spend, no SSH exec, no Fable call.** Tier 1 requires `--execute`; Tier 2 requires `--fable-judge` + a budget cap.

### 2.1 Promotion gate (the load-bearing rule)
A speculative branch (ADR-170 §2.3) is **promote-ineligible** unless its winning trajectory is cleared by `oracle:test-exec`, or by `judge:fable` **explicitly accepted** by the caller. `proxy:structural` **can never** clear a promote — it is triage-only. This is what keeps the flywheel from graduating plausible-but-wrong work into shared memory.

### 2.2 Causal failure receipts
On discard/rollback, emit a single receipt bundling `{checkpoint, diff, failing command, oracle provenance, promotion decision}`. A rollback that restores state but loses *why* is half-useful; the receipt is the forensic trail.

## 3. Consequences

- Training data and benchmark results stay auditable: every label says how it was earned. A reviewer can filter to `oracle:test-exec`-only before trusting an adapter.
- The honest residual is explicit: trajectories with no test spec and no accepted judge stay `proxy:structural` — usable for triage, never for gold claims. The set of un-ground-truthable tasks is *reported*, not hidden.
- $0 by default; every spend/exec path is an explicit opt-in with a cap.

## 4. Alternatives rejected

- **Single structural "resolved"**: the proxy-contamination failure mode. Rejected.
- **Fable-judge everything**: cost, and an LLM judge is still a proxy — must not outrank real execution. Rejected as the primary.
- **Blend tiers into a confidence scalar**: destroys provenance; ADR-169 violation. Rejected.
