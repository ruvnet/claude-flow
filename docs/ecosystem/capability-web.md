# Package capability web and bounded RSI loop

The explorer maps all 401 captured packages, including isolated packages, and distinguishes npm declarations from 42 source evidenced runtime relationships. The loop observes that graph, prioritizes gaps, runs registered checks, records results and repeats within a finite budget. It does not rewrite code, install packages, merge changes or publish releases.

## Open the explorer

From the repository root:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/docs/ecosystem/explorer/`. Search a package, select its neighborhood or filter the 95 remaining isolates. Relationship evidence links explain what each runtime edge means. Capability results appear only when the prepared receipt matches the graph, runtime overlay and registry hashes. Availability remains **Not probed** because this page cannot inspect the visitor's environment.

## Run the improvement loop

Install the pinned analysis dependency into a separate tooling directory. This does not change consumer manifests:

```bash
npm install --prefix /tmp/ruflo-ruvector-proof --ignore-scripts --omit=optional --no-audit --no-fund --save-exact ruvector@0.2.41
npm install --prefix /tmp/ruflo-memory-proof --ignore-scripts --no-audit --no-fund --save-exact @claude-flow/memory@3.0.5 ruvector@0.2.41 @ruvector/core@0.1.33 sql.js@1.15.0
RUFLO_MEMORY_REQUIRED=1 \
RUFLO_MEMORY_RESOLVE_FROM=/tmp/ruflo-memory-proof/package.json \
RUFLO_RUVECTOR_REQUIRED=1 \
RUFLO_RUVECTOR_RESOLVE_FROM=/tmp/ruflo-ruvector-proof/package.json \
node scripts/ecosystem-loop.mjs --iterations 2 --max-duration-ms 60000
node scripts/build-ecosystem-web.mjs
```

Exit 0 means selected checks and affected package coverage are complete. Exit 2 means checks passed with incomplete coverage. Exit 1 means evaluation failed. Run the receipt builder after exit 2 as well; the coverage gap belongs in the explorer. Use `--changed PACKAGE` to select affected packages, `--max-checks` to bound check count, and `--output` and `--ledger` for separate experiment artifacts. Iterations are bounded to 1 through 5 and total execution time to 300 seconds. There is no background scheduler.

The ledger deduplicates equivalent source identities. Checks still execute every cycle. Hashes identify local source content; they do not authenticate a publisher. Execute untrusted checkouts in an isolated environment because repository tests run with the caller's permissions.

## Initial capability matrix

| Capability | Evidence type |
| --- | --- |
| Dependency ownership | Contract |
| Vector mutations | Contract |
| Weight EFT API | Contract |
| Signed publication preparation | Contract, not a release signature |
| Runtime relationship provenance | Contract |
| Graph impact selection | Contract |
| Installed RuVector workflow | Integration |
| Persistent scoped memory and native retrieval after process restart | Integration |

The current registry has eight checks covering 10 packages; 391 of 401 remain without registered coverage. Five inventory packages have a registered integration check, up from three; this does not establish all combinations. [Persistent memory starter v1](persistent-memory-v1.md) documents the real package composition and its limits. Passing contracts alone do not establish runtime interoperability.

The graph artifact measurement explains 43 previously isolated nodes, from 138 to 95, a 31.2 percent reduction. Its three required graph and runtime evidence checks pass. This makes the captured annotations ready for review; it does not create new runtime integrations or measure adoption. Global runtime promotion remains rejected.

The ranked queue includes the measured umbrella payload increase of 111,971,638 bytes, floating runtime selectors and remaining isolates. These are proposed work, not completed fixes. No npm download totals, dependency declarations or consumer versions are modified by the loop.

An explicit executor can now turn one current proposal into an isolated, leased candidate worktree with a narrow file allowlist, paired baseline/candidate checks, an exact source patch and a reverse-patch rollback proof. [Candidate work and review](candidate-work.md) explains the separate CLI. It emits a manual PR handoff; the observation loop still never edits or promotes candidates automatically.

## Validation and next work

Regression tests cover traversal and symbolic link rejection, stale evidence, fabricated success, skipped tests, execution timeout, excessive output, deduplication, failure prioritization and bounded iteration. The installed integration test runs two actual cycles and verifies that captured downloads and manifests remain unchanged. CI runs contracts on Node 22 and 24 and requires installed RuVector integration.

Prior browser validation covered 401 rendered nodes, the original seven capabilities, 95 isolates, package search and neighborhood selection, stale receipt rejection and a 390 pixel mobile viewport without horizontal overflow. It used Chromium 153 through Playwright; the new eighth capability has source/receipt tests but awaits a fresh visual browser pass.

Next, register and execute one real cross package workflow at a time. Expand coverage based on successful tasks and compatibility evidence. No adoption telemetry is collected, and no increase in user adoption is claimed. Existing signing and release gates remain mandatory.

[ADR 493](../../v3/docs/adr/ADR-493-ecosystem-capability-web-and-rsi.md) records the architecture and trust boundaries.
