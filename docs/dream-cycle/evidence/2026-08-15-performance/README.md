# Dream Cycle 2026-08-15 — Evidence Trail (DEEP=performance)

Candidate: fix a silent-NaN buffer-sizing bug in
`v3/@claude-flow/neural/src/flash-attention.ts` (`FlashAttention.cpuOptimizedAttention`),
found while adding an RMSE quality metric to `benchmark()` (previously it reported a
"speedup" number with zero visibility into output correctness).

| File | What it is |
|---|---|
| `bench-flash-attention-topk-quality.mjs` | Self-contained, dependency-free, git-reproducible benchmark. Extracts baseline live from `git show HEAD:...` and imports the working-tree candidate directly via Node's `--experimental-strip-types` (no transpile step, no npm deps). Sweeps 7 `numK` scenarios spanning all 3 internal code paths plus both boundaries of the buggy range. `node --experimental-strip-types bench-flash-attention-topk-quality.mjs` to reproduce. |
| `receipt-2026-08-15.json` | Output of the benchmark above (committed as run). |
| `darwin-explore.mjs` | Bounded 1-generation/3-candidate exploration of alternative fixes for the same bug (never touches `naiveAttention` — the ground truth — or the test vectors). `node --experimental-strip-types darwin-explore.mjs` to reproduce. |
| `darwin-lineage-2026-08-15.json` | Output of the exploration above. |
| `independent-repro.md` | A second, hand-written, non-random minimal repro used by the adversarial critic — deliberately shares no code with `bench-flash-attention-topk-quality.mjs`, to guard against a shared bug in the verification tooling itself. |
| `adversarial-critique.md` | Independent critic's full checklist review. |
| `flywheel-evidence.json` | Provenance-classified evidence index (OBSERVATION/MEASUREMENT/INFERENCE/HYPOTHESIS/DECISION/REJECTION), reward-hack-check and security-review notes. |
| `issue-LOCAL.md` | Issue content — GitHub Issues are disabled on this fork (`POST /issues` → 410, reconfirmed tonight, same as 2026-08-13 and 2026-08-14). |

**Why direct Node execution instead of `vitest`:** same environment gap as the previous two
Dream Cycles — this checkout has no installed dependencies anywhere (`node_modules` absent
at root, `v3/`, and `v3/@claude-flow/cli/` — reconfirmed tonight). Unlike those two nights,
tonight's candidate file (`v3/@claude-flow/neural/src/flash-attention.ts`) has **zero
external imports** — it is pure TypeScript using only type annotations, no `@ruvector/*`
native bindings, no cross-package imports. Node 22.22.2's built-in
`--experimental-strip-types` flag runs it directly with **no transpile step and no npm
install at all**, so tonight's benchmark is a real, full execution of the actual candidate
code (not a syntax-only check like 2026-08-13/14 had to fall back to). The regression risk
this leaves open: `v3/@claude-flow/cli/__tests__/` may have existing tests over the
`@claude-flow/neural` package's public surface that could not be run tonight for the same
`node_modules`-absent reason — **a human reviewer or CI should still run
`npm install && npm run build && npm test` in `v3/@claude-flow/neural` before merge.**
