# Dream Cycle 2026-08-14 — Evidence Trail (DEEP=swarm)

Candidate: complexity-gated agent-count discount in
`v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (`suggestAgentsForTask` / `hooksPreTask`).

| File | What it is |
|---|---|
| `bench-agent-count-complexity-gate.mjs` | Self-contained, dependency-free, git-reproducible benchmark. Extracts literal baseline (from `git show HEAD:...`) and literal candidate logic, runs both over a 44-row corpus. `node bench-agent-count-complexity-gate.mjs` to reproduce. |
| `receipt-2026-08-14.json` | Output of the benchmark above (committed as run). |
| `darwin-explore.mjs` | Bounded 1-generation/4-candidate local Darwin exploration over the discount's own tunable parameters (never the corpus). `node darwin-explore.mjs` to reproduce. |
| `darwin-lineage-2026-08-14.json` | Output of the exploration above. |
| `adversarial-critique.md` | Independent critic's full checklist review, verdict CONFIRMED with 3 caveats. |
| `flywheel-evidence.json` | Provenance-classified evidence index (OBSERVATION/MEASUREMENT/INFERENCE/HYPOTHESIS/DECISION/REJECTION), reward-hack-check and security-review notes. |
| `issue-LOCAL.md` | Issue content — GitHub Issues are disabled on this fork (`POST /issues` -> 410, reconfirmed tonight, same as 2026-08-13). |

**Why a standalone extraction instead of the real module/test suite:** this checkout has no
installed dependencies anywhere (`node_modules` absent at root, `v3/`, and
`v3/@claude-flow/cli/`), and `hooks-tools.ts` transitively requires `@claude-flow/cli-core`
(via `validate-input.ts`'s re-export shim) which is not built here. Confirmed via
`npx tsx -e "import('./hooks-tools.ts')"` -> `Cannot find package '@claude-flow/cli-core'`.
A real regression test file was still added
(`v3/@claude-flow/cli/__tests__/hooks-tools.suggest-agents-complexity-gate.test.ts`) for the
next time `npm install && npm run build && npm test` runs in this package — it was not run
tonight, only syntax-checked (`esbuild --bundle=false`, exit 0).
