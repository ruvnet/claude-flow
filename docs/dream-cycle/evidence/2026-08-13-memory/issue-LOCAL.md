> **Note:** GitHub Issues are disabled on `dgdev25/ruflo` (`POST /issues` →
> `410 Issues has been disabled in this repository`). This is the STEP 18
> issue content, saved locally since it could not be published as an actual
> GitHub issue. ISSUE_NUM=LOCAL in the ledger and final report.

## 1. Tonight's Rotation

```
DATE=2026-08-13
DEEP=memory
SCAN=plugins,automation
SLOT=3
COMMIT=2462cf7870bce359115ade64cf8b1a8256dc3257
BRANCH=claude/practical-gauss-f15m07
```

No bonus deep-dive triggers tonight (`DAYINT % 25 = 13`, `DAYINT % 75 = 13`).

## 2. Ledger Check

`docs/dream-cycle/LEDGER.md` did not exist despite this fork containing several
*inherited* prior dream-cycle SOTA docs/ADRs in-tree (`docs/dream-cycle/`,
`docs/dream-cycles/`, `v3/docs/dream-cycle/`, various `v3/docs/adr/ADR-3xx-dream-cycle-*`).
Checked `dgdev25/ruflo` directly via `list_issues`/`search_issues` for the
`dream-cycle` label and for "dream"/"dream cycle" — **zero results** (before
discovering Issues are disabled entirely on this fork). This is the first
Dream Cycle run against this fork; the ledger was created fresh this run.
No prior-night fates to classify — none exist yet.

## 3. Deep Dive Findings

Two parallel vector-search implementations exist in `@claude-flow/memory`
(v3.0.0-alpha.21): `AgentDBAdapter` (pure-TS HNSW, default `MemoryService`
path) and `AgentDBBackend` (wraps external `agentdb` npm pkg, the
ADR-009-documented "hybrid" default) — near-duplicate ID-hashing/fallback
logic, and only `AgentDBBackend` has the ADR-377 prompt-injection retrieval
guard wired in. CLAUDE.md's "measured" HNSW numbers trace to
`@claude-flow/cli`'s `dist/ruvector/vector-db.js`, not to anything in this
package — `benchmark.test.ts` here has zero vector-search benchmarks.
`smart-retrieval.ts`'s RRF+recency+MMR+session pipeline (ADR-090) is real
and non-trivial, but its default `multiQuery=true` fan-out awaited each of
2-3 query variants **sequentially** — tonight's candidate.

Full SOTA report (competitor comparison, 2026 research findings): see
`docs/dream-cycle/2026-08-13-memory-sota.md` (the "Gist" — see § 13).

## 4. Hypothesis

> Given a `smartSearch()` call configured with the default `multiQuery=true`
> (2-3 generated query variants), when the sequential await-in-a-for-loop
> variant fan-out in `smart-retrieval.ts` is replaced with `Promise.all`-based
> concurrent fan-out, then end-to-end `smartSearch()` wall-clock latency
> should improve relative to the sequential baseline, subject to: (1) result
> correctness — byte-identical output set to baseline; (2) no per-query
> error-rate increase; (3) >=30% latency improvement on multi-variant
> scenarios and <15% delta on the single-variant path.

Frozen before evaluation began (STEP 3.3); not modified afterward.

## 5. Evaluation Receipt

**evaluated: accepted**

Self-contained, git-reproducible benchmark:
`docs/dream-cycle/evidence/2026-08-13-memory/bench-smart-retrieval-fanout.mjs`
— compiles the real pre-candidate baseline (git-extracted from commit
`ee3a394`) and the real candidate (working tree) via `tsc`, runs both against
identical mock search functions, 5 repeats/scenario.

| Scenario | Variants | Baseline (ms) | Candidate (ms) | Speedup | Quality identical |
|---|---|---|---|---|---|
| default, fast store | 3 | 46.6 | 15.9 | 2.94x | yes |
| default, slow store | 3 | 182.9 | 60.5 | 3.02x | yes |
| multiQuery off | 1 | 60.4 | 60.4 | 0.999x | yes |
| explicit 5 variants | 5 | 301.6 | 60.4 | 4.99x | yes |

Verdict against frozen threshold: **ACCEPT**
(`docs/dream-cycle/evidence/2026-08-13-memory/receipt-2026-08-13.json`).
Full package suite: 452/453 pass — 1 pre-existing, environment-caused
failure (`auto-memory-bridge.test.ts` chmod/read-only test; root user
bypasses chmod), confirmed unrelated via git-stash isolation of the
candidate diff.

## 6. Darwin Results

Bounded local exploration (upstream `npx metaharness darwin` / `npx ruvector
harness darwin` operate at whole-repo genome scope — wrong grain for a
single-function candidate, would violate "one conceptual change"). 1
generation, 3 of a max 4 candidates, frozen fitness
`0.35*quality + 0.20*success_rate + 0.15*latency + 0.10*cost_efficiency + 0.10*reproducibility + 0.10*safety`:

| Candidate | Fitness | Note |
|---|---|---|
| variant-b-allsettled (`Promise.allSettled`) | 0.996 | Wins on fault tolerance; **not shipped** — changes error-propagation contract, out of scope for tonight's frozen hypothesis |
| variant-a-promise-all (shipped) | 0.730 | Wins on raw latency + reproducibility; preserves baseline's error semantics exactly |
| variant-c-bounded2 (cap=2 concurrency) | 0.686 | No benefit at actual default variant count (≤3); rejected, persisted as negative evidence |

Full lineage: `docs/dream-cycle/evidence/2026-08-13-memory/darwin-lineage-2026-08-13.json`.

## 7. Flywheel Evidence

`docs/dream-cycle/evidence/2026-08-13-memory/flywheel-evidence.json` —
provenance-classified (OBSERVATION/MEASUREMENT/INFERENCE/HYPOTHESIS/
DECISION/REJECTION) index of every artifact in this cycle. `@metaharness/flywheel`
(Ed25519 signed replay bundles) is available but not wired into this specific
evaluation tonight — plain JSON receipts + a checked-in, git-reproducible
benchmark script were used instead. Flagged as infra investment for a future
cycle.

## 8. Reward Hack Check

`@metaharness/weight-eft` v0.1.1 exists but is scoped to LoRA training-data
contamination filtering, not arbitrary code-diff auditing — not applicable
here. Manual STEP 10/11 checklist executed by an independent adversarial
critic instead (see `adversarial-critique.md`). **No unresolved reward-hacking
signal.**

## 9. Security Review

Low security-sensitivity change (no auth/credential/tool-authority/network
changes). Adjacent finding, not actioned tonight: `AgentDbRetrievalGuard`
(ADR-377, prompt-injection defense on retrieved memory content) is wired
only into `AgentDBBackend.search()`, not the default `AgentDBAdapter`/
`MemoryService` path most callers use — that path has **no retrieval-injection
defense regardless of configuration**. `smart-retrieval.ts` sits above both
backends and doesn't change this. OWASP ASI06 (2026) names this exact risk
class as a Top-10 agentic concern. Recommended for a future `DEEP=security`
Dream Cycle.

## 10. Scan Findings: plugins

`plugins/ruflo-rag-memory` and `plugins/ruflo-agentdb` are docs/skill-only
plugins (no executable `.mjs`, markdown contracts over MCP tools that live
elsewhere) — smoke test (`plugins/ruflo-rag-memory/scripts/smoke.sh`) passes
10/10. No code-level findings; these plugins don't touch the
`smart-retrieval.ts` pipeline this cycle's candidate improves.

## 11. Scan Findings: automation

`plugins/ruflo-loop-workers` and various `*automation*` skill directories
scanned at a surface level — no material findings distinct from what's
already covered by the memory deep-dive tonight. No further action.

## 12. Competitors Reviewed

LangGraph, AutoGen, CrewAI, OpenAI Assistants/Responses API, Qdrant,
Weaviate, Milvus, LanceDB, Vespa. Most actionable gap: no versioning/rollback
on Ruflo's memory store (LanceDB has zero-copy instant revert; Ruflo's
AgentDB+SQLite hybrid has no snapshot mechanism) — out of scope for a
same-night patch, recommended for a future cycle. Full comparison table in
`docs/dream-cycle/2026-08-13-memory-sota.md`.

## 13. Gist

**LOCAL** — no gist-creation tool was available in this session's toolset
(GitHub MCP server here exposes repo operations, not the Gist API; no `gh`
CLI binary present). Published as a committed repo file instead:
`docs/dream-cycle/2026-08-13-memory-sota.md`.

## 14. Witness

- Session commit: `2462cf7870bce359115ade64cf8b1a8256dc3257`
- Report SHA256 (pre-stamp body): `19063b387493764e662f8efea63e35b10528f53e665a2eb5d6992ce428401ab5`
- Witness stamp: `498a9cea038a562f54cf51214df1bd9fbebd885bbe3b68e8e2ff264b94547dac`
- Full verifier procedure and caveat: see `docs/dream-cycle/2026-08-13-memory-sota.md` § SOTA Proof & Witness

## 15. Recommendation

**ACCEPT** — recommend human review and merge of the linked PR (small diff:
~20 lines + 2 regression tests, zero behavior change beyond latency,
adversarially reviewed, verdict CONFIRMED). Two follow-ups recorded but not
actioned tonight: (1) add `@claude-flow/memory` to
`scripts/prepare-root-publish.mjs`'s pnpm `--filter` list — 1-line fix for
the exact "self-learning imports DISABLED" warning this session's own
SessionStart hook printed; (2) open a `DEEP=security` cycle on the
`AgentDbRetrievalGuard` default-path gap.

Human review required. This session does not self-merge or autonomously
promote Flywheel state.
