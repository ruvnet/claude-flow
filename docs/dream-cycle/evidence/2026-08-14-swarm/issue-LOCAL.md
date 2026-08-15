# [Dream Cycle 2026-08-14] swarm: agent-count recommendation now scales with task complexity + ruview/ruvector-integration scan

**LOCAL** — GitHub Issues are disabled on this fork (`POST /issues` → 410, reconfirmed
tonight via `mcp__github__issue_write`; same result as 2026-08-13's cycle).

Labels (would be): `dream-cycle`, `research`, `swarm`, `ruview-integration`, `ruvector-integration`

## 1. Tonight's Rotation

DATE=2026-08-14, DAYINT=20260814, SLOT=4 (DAYINT % 5). DEEP=swarm,
SCAN=ruview-integration,ruvector-integration. No bonus deep dives (DAYINT % 25 = 14,
DAYINT % 75 = 14). Session commit `2462cf7870bce359115ade64cf8b1a8256dc3257`, branch
`claude/practical-gauss-bg5qih` (this session's designated working branch — used in place
of a fresh `dream/2026-08-14-swarm` branch per this session's operating instructions).

## 2. Ledger Check

`docs/dream-cycle/LEDGER.md` did not exist before tonight (created tonight, backfilled
with 2026-08-13's row from PR #1). Only 1 prior Dream Cycle PR exists on this fork: #1
(`dream(memory): concurrent smartSearch() fan-out — 2.9x-5x speedup`, DEEP=memory,
evaluated=yes, verdict=ACCEPT), open/draft, not merged, not stale (<24h old at time of
tonight's check — pending human review, not abandoned). 10 prior swarm-surface Dream
Cycles produced ADR proposals (ADR-330/345/348/350/355/359/362/366/369/374) with no
shipped evaluated code except ADR-330. Prior gist (2026-08-13-memory-sota.md) scored 10/10
on the rubric (grade-A/B benchmark evidence, 5 competitor rows, 3 specific recommendations,
valid witness, <1500 words, novel finding).

## 3. Deep Dive Findings

See the SOTA report for full detail. Summary: `hooksPreTask` (`hooks-tools.ts`) computes a
`complexity` bucket and discards it for agent-count purposes — every `KEYWORD_PATTERNS`
entry and the fallback path return 2-3 agents regardless of task size. This is the
concrete, line-numbered mechanism behind a prior Dream Cycle's prose-only finding
(ADR-333, "Two Calls Beat Five Agents," ~7.4x token gap, never shipped as code).

## 4. Hypothesis

Given a corpus of task descriptions spanning low/medium/high complexity, when
`suggestAgentsForTask`'s recommendation is discounted to its top agent for
`complexity:'low'` matches (except when the match includes `security-architect`/
`security-auditor`), then mean recommended-agent-count for low-complexity tasks should
drop toward 1 while medium/high are unchanged, subject to: no safety-relevant role ever
silently dropped; function stays pure/deterministic; medium/high agent count never
decreases vs. baseline. Frozen before evaluation; not modified afterward.

## 5. Evaluation Receipt

`docs/dream-cycle/evidence/2026-08-14-swarm/receipt-2026-08-14.json`. Low bucket (n=21):
mean agent count 2.90→1.48. Medium (n=5) and high (n=18): unchanged. 0 regressions, 0
safety-invariant violations. Reproduced byte-identical across independent re-runs.
**Verdict: ACCEPT** against the frozen threshold. Real `vitest` suite could not run
tonight (no installed dependencies anywhere in this checkout — see README.md in the
evidence directory); syntax-only check (`esbuild --bundle=false`) passed.

## 6. Darwin Results

`docs/dream-cycle/evidence/2026-08-14-swarm/darwin-lineage-2026-08-14.json`. Bounded
1-generation/4-candidate exploration. Notable: a variant dropping the safety exemption
scored marginally higher on raw fitness (0.9542 vs shipped 0.9492) because the frozen
fitness function's 0.10 safety weight under-prices a protected-role removal — corrected by
treating zero safety violations as a hard disqualifying constraint, not a fitness
component to trade off. Shipped candidate wins among constraint-respecting variants.

## 7. Flywheel Evidence

`docs/dream-cycle/evidence/2026-08-14-swarm/flywheel-evidence.json` — provenance-classified
evidence index.

## 8. Reward Hack Check

`@metaharness/weight-eft` not applicable to auditing a hand-written diff (library, not a
CLI; `--help` produced no output). Manual checklist executed by an independent adversarial
critic instead — no unresolved signal.

## 9. Security Review

Low sensitivity — change is advisory-metadata-only (`hooksPreTask` returns a
recommendation object; does not spawn agents, gate execution, or touch
filesystem/network/credentials beyond the pre-existing handler). Safety-relevant property
(never silently drop security-architect/security-auditor) hand-verified and cross-checked
by both the critic and Darwin's hard-constraint gate.

## 10. Scan Findings: ruview-integration

No dedicated ruview *swarm* integration plugin exists — matches two prior scan nights'
conclusion (repeat finding, not new). The real "RuView" code in this repo
(`@claude-flow/security/src/policy/product-plane.ts`) is edge-device claim-federation
policy, unrelated to swarm orchestration, already ADR-governed (ADR-325/326/327), not
stale. No safe testable-tonight fix identified; this is a net-new-feature-sized gap.

## 11. Scan Findings: ruvector-integration

`npx ruvector harness status/doctor --json` both work; 14/15 primitives available.
`@ruvector/router` unavailable — confirmed this is correct, designed graceful degradation
via `optionalDependencies` + a `.catch(() => null)` fallback in `vector-db.ts`, not a
defect. No fix needed or attempted.

## 12. Competitors Reviewed

LangGraph v1.2.10, AutoGen v0.4+, CrewAI, OpenAI Agents SDK (agent-count mechanisms);
Qdrant/Weaviate/Milvus/LanceDB not directly relevant to tonight's surface (covered by
2026-08-13's memory-surface cycle instead).

## 12b. Pull Request

https://github.com/dgdev25/ruflo/pull/2 (draft, open, human review required)

## 13. Gist

Published as a committed repo file (no gist-creation MCP tool available this session, same
as 2026-08-13): `docs/dream-cycle/2026-08-14-swarm-sota.md`.

## 14. Witness

- Session commit: `2462cf7870bce359115ade64cf8b1a8256dc3257`
- Report SHA256 (pre-stamp body): `6e24e74154920904f53655130a9eaf02298bad797fb339b8592eefba3ebe248e`
- Witness stamp: `c3ed8320297debcf675b00de7641379ed5eb00d16483565a85d90ddaa95b3f80`

## 15. Recommendation

Human review requested for the small (~50 line, 1 file) diff in
`v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts`. Two systemic follow-ups flagged: (a)
wire the same discount into `hooksExplain`'s and the routing-tool fallback's identical
call sites (both independently compute complexity already), (b) fix the workspace
`npm install`/`pnpm install` bootstrap gap so future cycles can run the real test suite
instead of a standalone extraction — this is now 2 consecutive nights blocked on a
dependency-installation gap of one kind or another.

---
_Generated by [Claude Code](https://claude.ai/code)_
