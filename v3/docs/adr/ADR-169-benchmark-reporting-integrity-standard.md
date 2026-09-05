# ADR-169: Benchmark Reporting Integrity Standard — Strict-EM Headlines, View-Labeled Scaling, Disclosed Gaps

**ID**: ADR-169
**Status**: Accepted — the FRAMES ablation (metaharness, n=50, seed 42, 2026-06-28) already complies; this ADR makes the discipline binding for every benchmark number ruflo publishes
**Date**: 2026-07-03
**Authors**: rUv (drafted with Claude Code)
**Related ADRs**:
- ADR-167 (GAIA submission integrity — audits a *submission* against exploit vectors)
- ADR-168 (GAIA harness evidence recording — makes the evidence *exist*)
- ADR-133/135/136 (GAIA harness, tracks, hardness routing)
**Source evidence**: FRAMES/GAIA ablation integrity self-audit vs the Berkeley RDI
vectors (`runs/summary.json`, scored by `score-gaia.mjs`) — every verdict below
was measured from committed artifacts, not asserted.

---

## 1. Context

ADR-167 and ADR-168 cover *earning* integrity: was the score obtained by
solving tasks, and is the evidence recorded. This ADR covers the third leg —
**reporting** integrity: given honestly-earned numbers, are they *presented*
in a way that survives the Berkeley RDI lens?

RDI's April 2026 study broke eight major benchmarks not only through harness
exploits but through **reporting artifacts that inflate scores without any
cheating in the run itself**: relaxed/substring metrics presented as accuracy
(normalization collisions), undisclosed best-of-N presented as single-attempt
scores, no-work passes hidden in aggregates, and unreproducible cherry-picked
runs.

The metaharness FRAMES ablation self-audit demonstrated that these vectors are
cheap to close *by construction* — and that the same discipline was already
implicitly present in the ablation's artifacts. What is missing is a binding
standard so future numbers (GAIA, FRAMES, terminal-bench, whatever comes next)
can't regress.

## 2. Decision

Every benchmark number ruflo publishes — README, release notes, leaderboard
submission, gist, blog — MUST satisfy five rules. `summary.json`-style scored
artifacts are the enforcement point.

### R1 — Strict exact-match is the only headline

The reported number is strict (gaia-style normalized) exact-match, tagged
`view: "primary"` in the artifact. Relaxed metrics (gold-tokens ⊆ prediction
or any substring-containment variant) MAY be computed as diagnostics but are
**never the reported number**, and if shown must carry the literal label
*"relaxed (substring-contained) — diagnostic, not the score."* Rationale:
substring containment is the normalization-collision vector RDI used to
inflate GAIA; `score-gaia.mjs` computes `acc_relaxed` for diagnosis and the
FRAMES audit confirms it never leaks into a headline.

### R2 — Test-time scaling is view-labeled, always

Any best-of-N, self-consistency, majority-vote, or verifier-reranked arm
carries an explicit `view` label (`majority`, `verifier-bon`, `ps-bon`,
`sc-curve`, …) in the artifact, and the label travels with the number into
prose. A scaled score quoted without its label is a reporting violation even
when the underlying run was honest. (FRAMES example: deepseek base 0.50 is
quotable as base; 0.56 exists only as `view: "majority"` and must say so.)

### R3 — No-work signatures are disclosed, not hidden

Artifacts report `mean_steps` (with min > 0 for any correct answer) and
`empty_rate` per arm. A correct-with-zero-work record anywhere in the run
fails the artifact (this is AUD-2's reporting-side mirror).

### R4 — Reproducibility block is mandatory

Seed, n, and confidence intervals (Wilson) in the artifact header; the
dataset revision/split named. A number without its reproducibility block is
not publishable.

### R5 — Retrieval-grounded benchmarks state what they cannot prove

Where the benchmark is retrieval-grounded (FRAMES: Wikipedia; GAIA: open web),
retrieving the answer text can be *legitimate* — the integrity question is
whether the artifact can distinguish reasoning-over-retrieval from verbatim
surfacing. Until the ADR-168 evidence contract (serialized tool outputs,
secret-redacted, size-bounded) reaches the benchmark's harness, its reports
MUST carry the honest gap statement rather than an implied clean bill
("answer-leakage: not provable from the artifact"). Turning that ⚠️ into ✅
happens by recording evidence (ADR-168), never by softening the statement.

## 3. Enforcement

1. **Scorer contract**: `score-gaia.mjs` (and successor scorers) keep emitting
   `view`, `mean_steps`, `empty_rate`, seed/n/CI — these fields are the
   machine-checkable surface of R1–R4.
2. **Audit hook**: a reporting-integrity check family in `gaia-audit.mjs`
   (ADR-167's registry) validates a scored artifact against R1–R4 before
   `/gaia submit` packages it: headline view is `primary`; every non-primary
   view labeled; no zero-step corrects; reproducibility block present.
   Fail-closed, same posture as the existing checks.
3. **Prose discipline**: release notes / gists quoting benchmark numbers link
   the artifact and preserve view labels. (Process rule — CLAUDE.md already
   carries the measured-vs-unverified discipline for perf claims; this extends
   it to benchmark accuracy claims.)

## 4. Consequences

- Headline numbers get smaller and honester: strict EM under-reads vs relaxed
  metrics, and scaled arms can't masquerade as base capability. That is the
  point — RDI made the inflated alternative worthless.
- The FRAMES ablation needs zero rework (audited compliant on every vector it
  can currently check); its answer-leakage ⚠️ resolves via ADR-168's contract
  applied to the FRAMES harness (upstream issue ruvnet/ruflo#2544 / #2548).
- One more check family in the ADR-167 audit; a few fields the scorers
  already emit become load-bearing contract.
