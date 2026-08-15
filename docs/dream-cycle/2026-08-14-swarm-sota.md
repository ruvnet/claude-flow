# Swarm/Multi-Agent Coordination SOTA Report — 2026-08-14

**TL;DR:** In 2026, published multi-agent research increasingly says architecture-task
*alignment* — not raw task complexity — predicts whether spawning multiple agents helps or
hurts (arXiv 2512.08296, 260 configs, 87% predictive accuracy on held-out configs;
misaligned coordination costs up to -70% vs single-agent). Ruflo's own CLAUDE.md-documented
"Auto-Start Swarm Protocol" spawns a fixed 5-agent pipeline for any task matching a prose
checklist, with zero code enforcing agent count from task complexity — a gap a prior Dream
Cycle already measured costs ~7.4x more tokens than a 2-call baseline (ADR-333, prose-only,
never shipped as code). Tonight's dive found the concrete, previously-undocumented reason:
`hooksPreTask` (`hooks-tools.ts`) computes a `complexity` bucket and then discards it —
`suggestAgentsForTask`'s recommended agent count comes only from a flat keyword table.
Tonight's candidate wires `complexity` through, discounting low-complexity, non-security
recommendations to a single agent: measured mean agent count on a 44-row corpus dropped
2.90→1.48 on the low bucket (n=21), medium/high unchanged, 0 regressions, 0 safety-invariant
violations, independently reproduced by an adversarial critic and cross-checked by bounded
Darwin exploration.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Architecture-task alignment (not raw complexity) predicts multi-agent performance with 87% accuracy; misalignment costs up to -70% | arXiv 2512.08296, "Towards a Science of Scaling Agent Systems" | A |
| E3 framework: estimate-then-execute task-difficulty sizing gives 85% cost / 91% token reduction at equal success vs max-context baseline | arXiv 2607.13034, MSE-Bench, real-model (gpt-4o) validation | A |
| Confidence-aware state-dependent agent/model-scale routing gives +12.88% accuracy, -79.78% cost vs a fixed multi-agent baseline | arXiv 2601.04861 (OI-MAS, research prototype) | B |
| LangGraph/AutoGen/CrewAI/OpenAI Agents SDK: agent count is a design-time or handoff-driven decision in all four; none publish an automatic complexity-based agent-count gate | Multiple 2026 vendor/blog comparisons, cross-checked across 3 sources | C |

## Ruflo Current Capability

`hooks-tools.ts:653-723` (`KEYWORD_PATTERNS`, `suggestAgentsForTask`) returns 2-3 agents for
essentially every matched keyword regardless of whether the task is trivial or genuinely
complex; the fallback path (no keyword match) always returns 3. `hooksPreTask` separately
computes a `complexity` bucket (`'low'|'medium'|'high'`) from description length and a few
keywords, but — pre-patch — that value was read only by the human-facing recommendation
*text*, never by the agent-count logic itself. Elsewhere, Ruflo *does* have real,
complexity-aware routing — but only for model tier: `enhanced-model-router.ts` implements a
genuine lexical+embedding complexity score feeding a 3-tier Sonnet/Haiku/codemod router
(ADR-026/143). `pheromone-adaptive.ts` (ADR-330, shipped, zero-import, directly `tsx`-runnable)
can suspend underperforming already-spawned agents post-hoc, down to a fixed floor — it never
sizes the *initial* count from task features. Ten prior swarm-surface Dream Cycles (ADR-330,
345, 348, 350, 355, 359, 362, 366, 369, 374) produced architecture proposals; only ADR-330 and
tonight's candidate shipped as real code.

## Competitor Comparison

| System | Agent-count mechanism | Complexity-aware? |
|---|---|---|
| LangGraph v1.2.10 | Developer-authored graph, fixed at design time | No |
| AutoGen v0.4+ (actor model) | Dynamic spawning supported, no published complexity gate | Partial |
| CrewAI | Static crew size per flow | No |
| OpenAI Agents SDK | Sequential handoff, one specialist at a time | No |
| Ruflo (pre-patch) | Flat keyword table, 2-3 agents regardless of task size | No |
| Ruflo (tonight) | Keyword table x complexity bucket, 1 agent for low/non-security | **Yes** |

## Hypothesis (frozen before evaluation)

Given a corpus of task descriptions spanning low/medium/high complexity, when
`suggestAgentsForTask`'s recommendation is discounted to its top agent for `complexity:'low'`
matches — except when the match includes `security-architect`/`security-auditor` — then mean
recommended-agent-count for low-complexity tasks should drop toward 1 while medium/high are
unchanged, subject to: no safety-relevant role ever silently dropped; function stays pure/
deterministic; agent count for `medium`/`high` never decreases vs. baseline.

## Benchmarks & Evaluation

The v3 TypeScript workspace has no installed dependencies in this checkout (confirmed: no
`node_modules` at root, `v3/`, or `v3/@claude-flow/cli/`; direct `tsx` import of the patched
module fails on an unbuilt `@claude-flow/cli-core` transitive dependency). Evaluation used a
self-contained, git-reproducible benchmark
(`docs/dream-cycle/evidence/2026-08-14-swarm/bench-agent-count-complexity-gate.mjs`) that
extracts the literal baseline (from `git show HEAD:...`, byte-verified against the pre-patch
file by an independent critic) and literal candidate logic, run over a 44-row corpus (all 17
`KEYWORD_PATTERNS` entries at low- and high-complexity phrasing, 5 medium controls, 4
fallback/safety probes):

| Bucket | n | Baseline mean agents | Candidate mean agents |
|---|---|---|---|
| low | 21 | 2.90 | 1.48 |
| medium | 5 | 3.00 | 3.00 |
| high | 18 | 2.89 | 2.89 |

0 regressions, 0 safety-invariant violations, reproduced byte-identical across independent
re-runs (including the critic's own). **Verdict: ACCEPT** against the frozen threshold.

An independent adversarial critic (separate subagent) verified baseline fidelity against git
HEAD, reproduced the benchmark, and hand-traced 7 rows — verdict **CONFIRMED**, with 3 honest
caveats: (1) the corpus's original low-bucket template had a substring collision undercounting
true keyword coverage — found by the critic, fixed same night, receipt regenerated; (2) the
pre-existing (unchanged) complexity heuristic is naive and this patch makes its
misclassifications consequential for the first time — bounded because the tool is
advisory-only and security/auth tasks are exempted; (3) the fix covers only 1 of
`suggestAgentsForTask`'s 3 call sites (`hooksPreTask`) — `hooksExplain` and a routing
fallback path are unaffected, flagged as a follow-up. **The real `vitest` regression suite
could not be run tonight** (same dependency gap as above) — a syntax-only transpile check
(`esbuild --bundle=false`, exit 0) passed, and a new regression test file was added for the
next time a build is available, but this gap should be verified by CI or a human reviewer
before merge, not assumed green.

## Darwin Results

Bounded 1-generation, 4-candidate local exploration (frozen fitness: `0.35*quality +
0.20*success_rate + 0.15*latency + 0.10*cost_efficiency + 0.10*reproducibility +
0.10*safety`) over the discount's own tunable parameters (cap size, which buckets it applies
to, whether the safety exemption holds) — never the corpus itself. Notable finding: by raw
fitness alone, a variant that *drops* the safety exemption scored marginally higher (0.9542 vs
0.9492) than the shipped candidate, because the fitness function's 0.10 safety weight
under-prices a protected-role removal relative to the cost_efficiency it buys. Selection was
corrected to treat zero safety violations and zero out-of-scope discounts as hard disqualifying
constraints, not fitness components to trade off — the unsafe variant was excluded on that
basis. The shipped candidate is the fitness-maximizing choice among constraint-respecting
variants. A cap=2 (less aggressive) variant and a scope-expanding (medium-bucket) variant were
both explored and rejected, persisted as negative evidence.

## SOTA Proof & Witness

Full evidence trail (evaluation receipt, Darwin lineage, adversarial critique, and both
self-contained scripts) is in `docs/dream-cycle/evidence/2026-08-14-swarm/`.

- Session commit: `2462cf7870bce359115ade64cf8b1a8256dc3257`
- Report SHA256 (of the pre-stamp report body, see verifier procedure): `6e24e74154920904f53655130a9eaf02298bad797fb339b8592eefba3ebe248e`
- Witness stamp: `c3ed8320297debcf675b00de7641379ed5eb00d16483565a85d90ddaa95b3f80`
- Evaluation receipt: `docs/dream-cycle/evidence/2026-08-14-swarm/receipt-2026-08-14.json`
- Flywheel evidence: `docs/dream-cycle/evidence/2026-08-14-swarm/flywheel-evidence.json`
- Darwin lineage: `docs/dream-cycle/evidence/2026-08-14-swarm/darwin-lineage-2026-08-14.json`
- Adversarial critique: `docs/dream-cycle/evidence/2026-08-14-swarm/adversarial-critique.md`

**Verifier procedure:** the Report SHA256 above was computed over this same file with the
"SOTA Proof & Witness" section still reading its pre-stamp placeholder text ("See Witness
section below, computed from this file's final content.") rather than the filled-in bullets
you're reading now — an external verifier cannot re-derive that exact pre-stamp byte
sequence from the published copy alone. Witness stamp = SHA256(Report SHA256 + session
commit). The authoritative reproduction path is the checked-in evidence trail above, which
every number in this report traces back to and which anyone can independently re-run
(`node docs/dream-cycle/evidence/2026-08-14-swarm/bench-agent-count-complexity-gate.mjs` and
`node docs/dream-cycle/evidence/2026-08-14-swarm/darwin-explore.mjs`, both dependency-free).

## Recommended Next Steps

1. **Wire the complexity-aware discount into the remaining 2 of 3 `suggestAgentsForTask` call
   sites** (`hooksExplain`, the routing-tool keyword-fallback path) — both already compute an
   equivalent local complexity value; this is a small, mechanical follow-up flagged by
   tonight's critic.
2. **Fix the underlying `npm install`/`pnpm install` workspace-bootstrap gap** so a fresh
   checkout of this repo can run its own `vitest` suite — this is now the second consecutive
   Dream Cycle blocked from running the real test suite by missing dependencies (2026-08-13
   flagged an adjacent build-config gap; tonight the workspace has zero installed deps at all).
   Without this, every future swarm/CLI-surface candidate is stuck validating via standalone
   extraction instead of the real evaluator.
3. **Open a follow-up cycle on candidate #3 from tonight's scored pool** (`hooks route --mode
   moa`'s fixed `--parallel` fanout width, `hooks.ts:750-900`) — same root cause as tonight's
   fix, one level removed, already shipped code (not another prose ADR), scored 3.80/5.
