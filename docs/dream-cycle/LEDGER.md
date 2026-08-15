# Dream Cycle Ledger

Durable memory across nightly Dream Cycle sessions on `dgdev25/ruflo`. Created 2026-08-14
(did not exist before — the very first commit in this fork's git history to actually use
the `dream(...)` commit-message convention pairs with PR #1 on 2026-08-13, which never
appended a ledger row; that gap is backfilled below from PR #1's own body/evidence trail
rather than left blank, since a durable ledger with a missing first row would misinform
every future cycle's STEP 1 check).

| Date | Deep | Finding | Issue | PR | Evaluated? | Verdict | Effect | Witness | Prior-night fates |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-13 | memory | `smartSearch()` multi-query fan-out was sequential; `Promise.all` concurrency fix | LOCAL (Issues disabled, 410) | #1 (open, draft) | yes | ACCEPT | 2.9x-5x latency reduction, byte-identical output | `498a9cea...` | n/a (first tracked night) |
| 2026-08-14 | swarm | `hooksPreTask`'s computed `complexity` bucket was dead for agent-count purposes; wired it into `suggestAgentsForTask`'s recommendation with a security-role safety exemption | LOCAL (Issues disabled, 410) | #2 (open, draft) | yes | ACCEPT | Low-bucket mean agent count 2.90→1.48 (n=21), medium/high unchanged, 0 regressions, 0 safety violations | `c3ed8320...` | 2026-08-13 PR #1: OPEN, draft, <24h old, pending human review — not stale (>14d threshold), no action needed yet |
| 2026-08-15 | performance | `FlashAttention.cpuOptimizedAttention()`'s `expBuffer` sized off `useTopK` alone but branch taken is gated by `useTopK && numK>128`; for 32<numK<=128 this silently produced NaN output (undersized buffer, reads past `.length` return `undefined`). Fixed sizing predicate to match branch predicate; added `rmse` quality metric that caught the bug | LOCAL (Issues disabled, 410, reconfirmed) | #3 (open, draft) | yes | ACCEPT | NaN→finite (RMSE~1e-9) for 33-128 keys; byte-identical outside that range; independently re-confirmed with a 2nd, code-sharing-free repro | `b271917b...` | PR #1 (2026-08-13): OPEN, draft, 2d old, not stale. PR #2 (2026-08-14): OPEN, draft, 1d old, not stale. 0/14 (2 total) prior candidate PRs merged — biased tonight toward a small single-file candidate |
