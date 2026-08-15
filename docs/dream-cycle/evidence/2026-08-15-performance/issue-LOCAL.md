# [Dream Cycle 2026-08-15] performance: silent NaN bug in FlashAttention.cpuOptimizedAttention() (fixed) + security,hive-mind scan

**LOCAL** — GitHub Issues are disabled on this fork (`POST /issues` → 410, reconfirmed
tonight via `mcp__github__issue_write`; same result as 2026-08-13 and 2026-08-14's cycles).

Labels (would be): `dream-cycle`, `research`, `performance`, `security`, `hive-mind`

## 1. Tonight's Rotation

DATE=2026-08-15, DAYINT=20260815, SLOT=0 (DAYINT % 5). DEEP=performance,
SCAN=security,hive-mind. No bonus deep dives (DAYINT % 25 = 15, DAYINT % 75 = 15). Session
commit `2462cf7870bce359115ade64cf8b1a8256dc3257`, branch `claude/practical-gauss-wqc2ke`
(this session's designated working branch, used in place of a fresh `dream/2026-08-15-performance`
branch per this session's operating instructions, same as the prior 2 cycles).

## 2. Ledger Check

`docs/dream-cycle/LEDGER.md` did not exist on this branch (only on the unmerged PR #1/#2
branches) — brought forward tonight from `origin/claude/practical-gauss-bg5qih` (2026-08-14's
branch, which already carries both prior rows) rather than recreated from scratch, since that
branch is the durable source of truth pending human merge. 2 prior Dream Cycle PRs exist: #1
(memory, ACCEPT, 2.9x-5x speedup) and #2 (swarm, ACCEPT, agent-count discount). Both still
open/draft, unmerged — 0 of the last 14 (2 total) candidate PRs merged, so tonight biased
toward a small, single-file, easily-reviewable candidate per STEP 1.1. Prior gist
(2026-08-14-swarm-sota.md) scored **10/10** on the rubric (A/B benchmark evidence, 6
competitor rows, 3 specific recommendations, valid witness, 1364 words, novel shipped fix).

## 3. Deep Dive Findings

While adding an RMSE quality metric to `FlashAttention.benchmark()` (previously reported a
speedup number with zero accuracy visibility), discovered `cpuOptimizedAttention()`'s
`expBuffer` is sized off `useTopK` alone but the branch actually taken is gated by
`useTopK && numK > 128` — for 32<numK≤128 this undersizes the buffer to `topK`, and
`exps[ki]` reads past the buffer's length return `undefined`, propagating as `NaN` through
every output element. Live-wired into 3 MCP tool handlers. See full SOTA report for detail,
including the ≥3-unrelated-"Flash Attention"-implementations finding.

## 4. Hypothesis

Frozen: fixing the buffer-sizing predicate to mirror the branch-selection predicate should
make output finite and near-exact for 32<numK≤128, with byte-identical behavior outside that
range and no material speed regression. See SOTA report § Hypothesis for full text.

## 5. Evaluation Receipt

`docs/dream-cycle/evidence/2026-08-15-performance/receipt-2026-08-15.json`. Bug reproduced
in baseline (git HEAD) for exactly 33–128 keys (NaN), fixed in candidate (RMSE ~1e-9), byte-
identical outside that range. **Verdict: ACCEPT.** Independently re-confirmed with a second,
hand-written repro sharing no code with the benchmark script
(`independent-repro.md`). Real `vitest` suite could not run tonight — this checkout has zero
installed dependencies anywhere (same gap as 2026-08-13/14); worked around by running the
actual candidate `.ts` file directly via Node 22's `--experimental-strip-types` (a real
execution, not a syntax-only check). New regression test's assertions hand-validated against
the public API (4/4 pass) but not run via the real `vitest` harness — **a human reviewer or
CI should run `npm install && npm run build && npm test` in `v3/@claude-flow/neural` before
merge.**

## 6. Darwin Results

`docs/dream-cycle/evidence/2026-08-15-performance/darwin-lineage-2026-08-15.json` — bounded
1-generation/3-candidate exploration of alternative fixes. Shipped fix wins on corrected
fitness (0.9006) after an initial cost_efficiency measurement gap (only sampled the buggy
range) was caught and fixed mid-exploration — see adversarial critique caveat #2. One variant
(`variant-widen-twostage-gate`) scored competitively but was disqualified as out-of-scope
(changes exact→approximate behavior beyond the frozen hypothesis).

## 7. Flywheel Evidence

`docs/dream-cycle/evidence/2026-08-15-performance/flywheel-evidence.json` — provenance-
classified evidence index (OBSERVATION/MEASUREMENT/INFERENCE/HYPOTHESIS/DECISION/REJECTION).

## 8. Reward Hack Check

No dedicated reward-hack-detection subcommand surfaced during STEP 0.5 control-plane
discovery. Manual checklist executed by an independent adversarial pass instead (full
checklist in `adversarial-critique.md`) — no unresolved signal.

## 9. Security Review

Low sensitivity — pure computational fix inside a CPU-bound kernel, no filesystem/network/
credential/MCP-authority surface touched. Net effect reduces exposure (was silently returning
NaN into downstream logic; now returns valid numeric output). Full notes in
`flywheel-evidence.json.securityReview`.

## 10. Scan Findings: security

OX Security's April 2026 disclosure: command-injection flaw in Anthropic's official MCP SDKs
(STDIO transport → unsanitized shell), ~200k vulnerable instances. Upstream, not
Ruflo-specific, but Ruflo's MCP surface sits on that transport — recommend confirming this
repo's MCP SDK/transport version. MCPTox (72% attack success on poisoned tool descriptions)
reinforces a prior cycle's VIPER-MCP finding, not re-verified tonight.

## 11. Scan Findings: hive-mind

Came up dry — no fresh 2026-dated arXiv paper on queen-led/BFT hive-mind consensus found
tonight, consistent with the 2026-06-15 report's same observation. Two relevant papers found
both predate 2026, cited as background only (grade C).

## 12. Competitors Reviewed

FlashInfer (open top-K determinism issue, most relevant reference for tonight's finding),
LangGraph 1.0, AutoGen, CrewAI, OpenAI Agents SDK (latter 4 ship no comparable attention
kernel — noted as a thinner-than-usual comparison for a performance-kernel-bug night).

## 13. Gist

Published as a committed repo file (no gist-creation tool available this session):
`docs/dream-cycle/2026-08-15-performance-sota.md`.

## 14. Witness

- Session commit: `2462cf7870bce359115ade64cf8b1a8256dc3257`
- Report SHA256 (pre-stamp body): `9e72d3a31ab1bd48e4f5683933cc6e25d4e03b1b9eddfcb1dadb1f53fa29a128`
- Witness stamp: `b271917b5401aee5f24768112a21fb409c1b2df32b6320744d2c02a4ef9030d5`

## 15. Recommendation

Human review required before merge (real `vitest` suite has not been run — see §5). If green,
this is a small, low-risk, high-value correctness fix suitable for merge as-is. Follow-up
Dream Cycle candidates flagged: audit the other 2 Flash Attention implementations for the
same bug class; fix `npm install`/`pnpm install` bootstrap for this checkout (3rd consecutive
night blocked from the real test suite); confirm MCP SDK version against the OX Security
disclosure.
