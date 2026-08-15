# Dream Cycle evidence — 2026-08-13 (memory surface)

Durable evidence for the candidate shipped in this cycle: `smartSearch()`'s
multi-query fan-out in `v3/@claude-flow/memory/src/smart-retrieval.ts`
changed from a sequential `for (const v of variants) { await search(...) }`
loop to concurrent `Promise.all`-based fan-out.

Read `flywheel-evidence.json` first — it's the indexed summary with
OBSERVATION/MEASUREMENT/INFERENCE/HYPOTHESIS/DECISION/REJECTION
classification and links to everything below.

| File | What it is |
|---|---|
| `flywheel-evidence.json` | Indexed evidence summary, provenance-classified |
| `bench-smart-retrieval-fanout.mjs` | Self-contained baseline-vs-candidate benchmark. Run: `node bench-smart-retrieval-fanout.mjs` from anywhere in the repo. |
| `receipt-2026-08-13.json` | Saved output of the above |
| `darwin-explore.mjs` | Bounded 1-generation/3-candidate local exploration of alternative fan-out strategies. Run: `node darwin-explore.mjs` |
| `darwin-lineage-2026-08-13.json` | Saved output of the above |
| `variant-b-allsettled.ts` | Full source of the Darwin exploration's fault-tolerant variant — **not shipped**, kept as evidence for a future follow-up (see decision rationale in `flywheel-evidence.json`) |
| `adversarial-critique.md` | Independent critic's report (STEP 10/11 checklist), verdict CONFIRMED |

## Reproduce everything

```bash
cd v3/@claude-flow/memory && npm install && npm run build   # one-time
node ../../../docs/dream-cycle/evidence/2026-08-13-memory/bench-smart-retrieval-fanout.mjs
node ../../../docs/dream-cycle/evidence/2026-08-13-memory/darwin-explore.mjs
```

Both scripts extract the pre-candidate baseline from git history
(`BASELINE_COMMIT` constant at the top of each file) and the current
candidate from the working tree, so they stay reproducible as long as that
commit is reachable in history — even after `smart-retrieval.ts` changes
again later.
