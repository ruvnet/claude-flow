# Performance SOTA Report — 2026-08-15

**TL;DR:** Tonight's performance deep dive found a real, silent-NaN correctness bug — not a
speed-tuning opportunity — inside `@claude-flow/neural`'s `FlashAttention.cpuOptimizedAttention()`,
a production-wired path called from 3 MCP tool handlers. Its `expBuffer` is sized off the
wrong predicate, so any call with 33–128 keys returns fully-NaN output, silently. Fixed,
independently reproduced twice, and bounded-Darwin-confirmed as the fitness-maximizing fix
among 3 explored variants. Also: this repo has ≥3 unrelated implementations named "Flash
Attention" across 3 packages — very likely why this bug went unnoticed by the 2026-05-29 audit
(it measured a *different* implementation).

*Dream Cycle nightly research session — DEEP=performance, SCAN=security,hive-mind. 2026-08-15,
slot 0 of 5.*

---

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| FlashInfer has an open feature request for *deterministic* top-K sparse-attention kernels — current implementations rely on atomic ops for tie-breaking, flagged as a reproducibility risk | flashinfer-ai/flashinfer#2584, 2026 | B |
| OX Security (Apr 2026) disclosed a command-injection flaw in Anthropic's official MCP SDKs (Python/TS/Java/Rust) — STDIO transport passes config to the host shell unsanitized; ~200k vulnerable instances, 150M+ downloads in the affected supply chain | OX Security, cross-ref'd by CSA Research Note 2026-05-04 | A |
| MCPTox benchmark: 45 live MCP servers, 353 real tools, poisoned tool descriptions — attack success rate up to 72% | MCPTox, cited across multiple 2026 vendor writeups | B |
| Multi-agent collective-intelligence framing continues as the dominant academic lens for swarm coordination, but no fresh **2026**-dated arXiv paper on queen-led/BFT hive-mind consensus specifically was found tonight | arXiv 2503.05473, 2410.17517 (both pre-2026) | C (background only) |

---

## Ruflo Current Capability

| Capability | Status | Notes |
|---|---|---|
| `@claude-flow/neural` FlashAttention | **Had a silent NaN bug**, 33≤numK≤128, fixed tonight | Wired into 3 MCP handlers: `neural-tools.ts`, `hooks-tools.ts`, `system-tools.ts` |
| Quality visibility | **Was zero** — `benchmark()` reported speedup with no accuracy check | Added `rmse` field tonight; this is what caught the bug |
| Implementation count | **≥3 unrelated "Flash Attention" implementations** (`@claude-flow/neural`, `@claude-flow/integration`, `@claude-flow/performance`) | Fragmentation likely why the 2026-05-29 audit (measured a different file) never caught this |
| Test coverage | **Was zero** for this implementation before tonight | No `*flash*test*` file existed under the package |
| "2.49x-7.47x" claim (CLAUDE.md) | Still correctly "Not measured" | Tonight fixes a correctness bug, doesn't benchmark the headline claim — left as next step, out of scope for the frozen hypothesis |

---

## Competitor Comparison

| Framework/Library | Sparse-attention correctness stance | 2026 notable change |
|---|---|---|
| FlashInfer | Open issue tracking top-K tie-break non-determinism as a known risk | Adding deterministic-kernel tests (#2584) |
| LangGraph 1.0 GA | No attention-kernel surface (orchestration-only) | Node caching, DeltaChannel state (per 2026-06-15 report) |
| AutoGen / CrewAI / OpenAI Agents SDK | No user-facing attention-kernel surface | Not a relevant comparison for tonight's finding |
| Ruflo `@claude-flow/neural` (pre-patch) | **No accuracy metric, no tests, silent NaN for a documented range** | — |
| Ruflo `@claude-flow/neural` (tonight) | RMSE-checked, regression-tested, NaN eliminated | — |

*(Thinner than a coordination-night table — the usual comparison set ships no attention
kernel; FlashInfer is the more relevant reference.)*

---

## Hypothesis (frozen before evaluation)

> Given calls to `cpuOptimizedAttention()` with `32 < numK <= 128` (where `useTopK` is true
> but the two-stage path's `numK > 128` gate isn't met, falling through to the "simple"
> full-softmax branch), `expBuffer` is undersized to `topK` instead of `numK`, so
> `exps[ki]` reads for `ki >= topK` return `undefined` and propagate as `NaN` through every
> output element — when the sizing predicate is corrected to mirror the branch predicate
> (`useTopK && numK > 128`), output should become finite and closely match exact attention,
> subject to: (1) byte-identical output for numK≤32 and numK>128; (2) zero NaN/Infinity
> anywhere across the swept range; (3) no material speed regression (within wall-clock noise).

Frozen before evaluation began; not modified afterward. All three invariants held.

---

## Benchmarks & Evaluation

Self-contained, dependency-free, git-reproducible (`.../bench-flash-attention-topk-quality.mjs`).
Baseline extracted live via `git show HEAD:...`; candidate imported directly from the working
tree via Node 22's `--experimental-strip-types` — a real execution of the actual code, no npm
install, unlike the syntax-only checks the last two Dream Cycles were forced into.

| numK | baseline RMSE | candidate RMSE | baseline finite? | candidate finite? | max|Δ| outside range |
|---|---|---|---|---|---|
| 24 | 9.9e-10 | 9.9e-10 | yes | yes | 0 |
| 33 | **NaN** | 9.5e-10 | **no** | yes | n/a |
| 96 | **NaN** | 9.9e-10 | **no** | yes | n/a |
| 128 | **NaN** | 9.5e-10 | **no** | yes | n/a |
| 129 | 1.18e-2 | 1.18e-2 | yes | yes | 0 |
| 512 | 6.0e-3 | 6.0e-3 | yes | yes | 0 |
| 2048 | 5.1e-3 | 5.1e-3 | yes | yes | 0 |

**Verdict: ACCEPT.** Bug reproduced in baseline for exactly the predicted 33–128 range, fixed
(RMSE ~1e-9 — numerically exact, since the "simple path" is a full softmax) in the candidate;
zero behavior change outside that range across 3 independent runs, and re-confirmed via a
second, hand-written repro sharing no code with the benchmark script (`independent-repro.md`).
Receipt: `.../receipt-2026-08-15.json`.

**Caveat:** the real `vitest` suite could not run tonight (this checkout has zero installed
dependencies anywhere — same gap as 2026-08-13/14). The new regression test's assertions were
hand-validated against the public API instead (all 4 pass) — not a CI substitute. **A human
reviewer or CI should run `npm install && npm run build && npm test` in `v3/@claude-flow/neural`
before merge.**

---

## Darwin Results

Bounded 1-generation/3-candidate exploration of alternative fixes — `.../darwin-lineage-2026-08-15.json`.
Frozen fitness (same weights as 2026-08-13/14): `0.35*quality + 0.20*success_rate +
0.15*latency + 0.10*cost_efficiency + 0.10*reproducibility + 0.10*safety`; zero-NaN and
byte-identical-outside-range are **hard disqualifying constraints**, not tradeable (same
precedent as 2026-08-14).

| Variant | In scope? | Fitness | Notes |
|---|---|---|---|
| **shipped-branch-matched** | yes | **0.9006 (winner)** | Buffer matches the branch actually taken; lowest peak memory of the 3 |
| variant-always-numK | yes | 0.8065 | Correct, but wastes memory on the unrelated numK>128 path (8192B vs shipped's 512B @ numK=2048) |
| variant-widen-twostage-gate | **disqualified** | 0.7414 | Changes 33≤numK≤128 from exact to approximate — outside tonight's hypothesis |

Notable: the first `cost_efficiency` pass only sampled the buggy range, where the shipped fix
and `variant-always-numK` allocate identically (looked fitness-tied). Re-deriving it from each
variant's sizing rule across the *full* sweep (to numK=2048) revealed the shipped fix's real
advantage. Recorded as a known Darwin fitness-function limitation, not corrected away silently.

---

## SOTA Proof & Witness

Full evidence trail in `docs/dream-cycle/evidence/2026-08-15-performance/`.

- Session commit: `2462cf7870bce359115ade64cf8b1a8256dc3257`
- Report SHA256 (pre-stamp body): `9e72d3a31ab1bd48e4f5683933cc6e25d4e03b1b9eddfcb1dadb1f53fa29a128`
- Witness stamp: `b271917b5401aee5f24768112a21fb409c1b2df32b6320744d2c02a4ef9030d5`
- Receipt / Flywheel / Darwin lineage / adversarial critique / independent repro: all in the
  evidence directory above (see filenames throughout this report)

**Verifier procedure:** Report SHA256 was computed over this file with this section still
reading its pre-stamp placeholders — an external verifier cannot re-derive that exact
byte sequence from the published copy alone. Witness stamp = SHA256(Report SHA256 + session
commit). The authoritative reproduction path is the checked-in evidence trail, independently
re-runnable via:
`node --experimental-strip-types docs/dream-cycle/evidence/2026-08-15-performance/bench-flash-attention-topk-quality.mjs`
and the `darwin-explore.mjs` in the same directory — both dependency-free.

---

## Scan Findings — Security

**Finding:** OX Security's April 2026 disclosure (cross-ref'd by CSA's 2026-05-04 note) found
a command-injection flaw in Anthropic's *official* MCP SDKs (Python/TS/Java/Rust) — the STDIO
transport passes config to the host shell unsanitized, ~200k vulnerable instances across a
150M+-download supply chain. Upstream-SDK-level, not Ruflo-specific, but Ruflo's MCP surface
sits directly on that transport — **recommend confirming which MCP SDK version/transport mode
this repo's MCP server uses**, a passive supply-chain exposure requiring no Ruflo code change
of its own to have inherited. Separately, MCPTox (72% attack success on poisoned tool
descriptions) reinforces the 2026-06-21 cycle's VIPER-MCP finding — not re-verified tonight,
flagged as still-relevant background.

## Scan Findings — Hive-Mind

**Finding:** No fresh **2026**-dated arXiv paper on queen-led/BFT hive-mind consensus was
found tonight — same gap the 2026-06-15 report already noted. The two most relevant papers
(`arXiv 2503.05473`, `2410.17517`) predate 2026, cited as background only, graded **C**. No
new Ruflo-specific hive-mind finding tonight — this scan surface came up dry.

---

## Recommended Next Steps

1. **Audit the other 2 "Flash Attention" implementations for the same bug class.**
   `@claude-flow/integration`'s `attention-coordinator.ts` (what the 2026-05-29 audit measured)
   and `@claude-flow/performance`'s native `@ruvector/attention` wrapper are both untouched by
   tonight's fix. "3 implementations, one shared name" is itself the priority finding — worth
   an ADR-track discussion on consolidation, not just per-file re-audits.
2. **Fix `npm install`/`pnpm install` bootstrap for this checkout.** Third consecutive Dream
   Cycle blocked from the real test suite by a `node_modules`-absent workspace (2026-08-13,
   2026-08-14, tonight). Tonight's workaround relied on this file having zero external
   imports — future candidates won't be so lucky.
3. **Confirm MCP SDK/transport version against the April 2026 OX Security disclosure.** A
   one-command dependency check would confirm or rule out passive exposure to a
   supply-chain vulnerability with a 200k-instance blast radius — cheap to check now.
