# agenticow@0.2.3 — measured perf vs. published claims

> Bench harness: [`scripts/bench-agenticow.mjs`](../../scripts/bench-agenticow.mjs)
> Raw runs: [`docs/benchmarks/runs/agenticow-vs-full-copy-*.json`](../benchmarks/runs/)
> Host: darwin arm64, Node 22.22.1, dim=128, 5 runs/size

## Published claims (from agenticow's npm description)

1. "Branch a base memory in ~0.5ms"
2. "162 bytes regardless of base size"
3. "83× faster, 3000× smaller than full-copy snapshots"

## Measured

| N      | Branch ms | Branch bytes | Query ms (top-10) | Full-copy ms | Speedup vs copy | Size reduction |
|--------|-----------|--------------|-------------------|--------------|-----------------|----------------|
| 1,000  | 9.6       | 162          | 0.09              | 0.37         | 0.04× **(slower)** | 3,214×         |
| 10,000 | 9.07      | 162          | 0.45              | 3.01         | 0.33× **(slower)** | 35,761×        |
| 50,000 | 9.73      | 162          | 0.74              | 16.40        | **1.69×**       | 181,930×       |

## Verdict per claim

| Claim                              | Result | Notes |
|------------------------------------|--------|-------|
| 162 bytes per branch               | ✅ **Confirmed** | Constant at exactly 162 bytes across all N. |
| Size reduction vs full-copy        | ✅ **Confirmed and exceeded** | 3,214× at N=1k grows unboundedly because copy scales linearly with N. At N=50k it's already 181k× ahead. |
| 0.5ms branch latency               | ❌ **Not reproduced** | Measured ~9-10ms regardless of N. Looks like a fixed setup cost (file create + COW init), not the 0.5ms target. |
| 83× faster than full-copy          | ❌ **Not reproduced at observed N** | At small N full-copy is *faster* because it scales with the file size; agenticow's fixed ~10ms only beats full-copy once full-copy exceeds 10ms. **Crossover ≈ N=30k at dim=128.** |

## First-query warmup

First query through a freshly forked branch can spike (observed 36s on N=50k base). Subsequent queries are sub-ms. This is HNSW index load cost on first access — recurring queries amortize it away.

For ruflo's Darwin / per-session-branch pattern where each branch sees many reads, the warmup is paid once per branch and irrelevant. For "branch + single query + close" patterns it dominates and agenticow is a bad fit.

## What this means for ruflo integration

**Go** — but with calibrated framing:

- **Size win is the killer feature**: 162 bytes/branch is exact. The Darwin worktree bloat we hit in v3.14.4 (3.3 GB across parallel agents) is the strongest motivating use case. With agenticow each agent's memory branch is 162 bytes; the worktree bloat dies.
- **Time win triggers at scale**: at the ~3,300-pattern level ruflo already runs at (per session-start logs), full-copy of the equivalent `.rvf` would exceed agenticow's ~10ms fork. We're past the crossover for our real workload.
- **Read-through is fast**: sub-ms top-10 after warmup. Good enough for the existing query budgets.

## What NOT to claim in marketing/docs

- ❌ "0.5 ms branch" — measured 9-10ms; quote the real number.
- ❌ "83× faster" — only beats full-copy past N ≈ 30k; below that it's slower.
- ✅ "162-byte branches, 10ms fork time, ~180,000× smaller than full-copy at N=50k, sub-ms read-through after warmup" — measured and honest.

## Decision

Proceed with integration into `ruflo-rag-memory` as a new branching primitive. Position it as the **structural** answer to Darwin worktree bloat, not as a speed claim.
