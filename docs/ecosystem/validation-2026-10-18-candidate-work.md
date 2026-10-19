# Candidate work validation — October 18, 2026 UTC

Baseline: `00400e5667576ded953a1fba742c43e5aee82aac`, draft [Ruflo PR 4264](https://github.com/ruvnet/ruflo/pull/4264). The new result is a bounded proposal-to-worktree-to-review implementation, not another payload reduction. Independent review's hidden-index and staged-addition reproducers fail before the fixes and pass after them; owner release also works after rejected source movement. Existing promotion authority is unchanged.

## Verified

- 84 Node contract tests, zero failures or skips, using the exact contract test-file list in `.github/workflows/ecosystem-contracts.yml`. This includes 17 candidate-work tests independently rerun by a separate reviewer.
- `python3 scripts/tests/runtime-relationships.test.py`: 15 passed.
- With `RUFLO_MEMORY_REQUIRED=1`, `RUFLO_RUVECTOR_REQUIRED=1`, `RUFLO_WEIGHT_EFT_REQUIRED=1` and each corresponding `RESOLVE_FROM` set to the existing measured consumer's `package.json`: `node --test scripts/tests/ecosystem-memory-installed.test.mjs scripts/tests/ecosystem-loop-installed.test.mjs scripts/tests/ecosystem-analysis-installed.test.mjs scripts/tests/weight-eft-installed.test.mjs`: five passed, zero skips. Node 24.19.0, Linux x64.
- `node scripts/audit-umbrella-version-lockstep.mjs`: all three public packages remain 3.57.0. `node scripts/audit-package-dep-overlap.mjs`: 38 packages, no overlaps.
- With required memory and RuVector resolvers: `node scripts/ecosystem-loop.mjs --iterations 2`, followed by `node scripts/build-ecosystem-web.mjs`: eight checks pass per cycle; explorer receipt has eight passed capabilities. Exit 2 denotes the remaining 391 uncovered packages, not a test failure. The default two-cycle budget is now 60 seconds to accommodate candidate fixtures; the maximum remains 300 seconds.
- The real queued payload proposal produced a detached documentation candidate, paired eight-check passes, source-bound receipt and exact reverse-patch rollback. [Receipt](../../data/ecosystem-candidate.validation.json), [reconstructable patch JSON](proposals/slim-acceptance-doc.patch.json), whose `patch` field contains the exact unified diff. First attempt was correctly rejected after the evaluator source changed during independent review; only the stable retry produced accepted review evidence.

The exact check source identities are recorded in `data/ecosystem-rsi.latest.json` and its retained ledger. Contract coverage remains 10/401, integration-registered packages 5, source-evidenced runtime links 42, remaining isolates 95. This change adds test depth, not new package coverage or adoption evidence.

## Retained, not new gains

Root/CLI/wrapper manifests, lockfile, persistent-memory workflow source and all three historical measurement files are byte-identical to the baseline commit. Fixed reference: `data/npm-download-benchmark.latest.json`. Last accepted fresh paired consumer result: `data/ecosystem-memory-restart.validation.json`.

That retained comparison measured 522,159,201→412,781,888 unique cached registry tarball bytes: 109,377,313 bytes saved (20.947%). Prior paired installation observations were 50.225→47.178 seconds; the −3.047 second difference is not an attributable latency claim. No new transfer benchmark was run in this cycle because dependency inputs were unchanged. These byte counts exclude metadata, protocol overhead, retransmissions and the local unsigned fixture itself.

The actual installed memory 3.0.5 / RuVector 0.2.41 / native core 0.1.33 / sql.js 1.15.0 workflow passed again: write 134.768 ms, restart/retrieve 119.861 ms, repeat retrieval 98.806 ms, SQLite 36,864 bytes. Single-run timings are observations, not optimization evidence. Clean process restart is verified; crash durability, semantic embedding quality and signed release acceptance remain unverified.

## Guidance progress and remaining gate

Local guidance remains 54 Ruflo package roots representing 40 inventory names. 361 inventory packages remain pending upstream source guidance; 359 still need source mapping. The other two are now proposed and pack-inspected, not committed upstream.

The [RuVector proposal](proposals/ruvector-guidance.patch) adds package-specific AGENTS.md for `@ruvector/core` and `ruvector`, shared checked-in policy and explicit packaging allowlists. [Pack/build evidence](../../data/ecosystem-guidance-ruvector.validation.json) binds source 46d816ddc4c2a8a06cd3613534a79b1d557d858b. Actual unsigned packs include guidance at +821 and +954 compressed bytes; all 32 existing nonmanifest files are unchanged. This is not an npm release or proof of a buildable 0.3.3 artifact.

Upstream policy requires a successful build before commit. `npm run build` fails because `tsc` is absent; `npm run build:napi` fails because `napi` is absent. RuVector source also lacks 15 generated dist files. No upstream commit or PR was created. Next: use a provisioned upstream build environment, satisfy its tests/build gate, then open the grouped draft PR and update the rollout inventory. No new dependencies or traffic were added to inflate downloads.

## Rollback and risk

The isolated candidate receipt proves exact source rollback to tree `f31dcbfd93cb55d6487d0f599841686428cfc8f9`; it does not reverse runtime state. Reverting this tooling-only commit restores the previous proposal observer while retaining the earlier payload and memory implementation. Review artifacts remain evidence, not authority.

Largest remaining execution risk: candidate tests retain OS file/network access. Environment filtering and worktrees are not a hostile-code sandbox. Use a credential-free isolated executor for untrusted changes, inspect crash-left leases rather than stealing them, and keep release gates and independent evaluation intact.
