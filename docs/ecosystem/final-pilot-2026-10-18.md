# Final bounded pilot evidence — October 18, 2026

This is a review handoff, not release acceptance. The new correctness change fixes scale-sensitive cosine ranking in the repository-owned memory consumer; it does not patch published RuVector. Both fixed references and prior accepted receipts remain byte-identical.

## Retained work across the pilot

| Work | Durable source | Verified boundary |
| --- | --- | --- |
| Explicit SLIM opt-in | [5a61c614](https://github.com/ruvnet/ruflo/commit/5a61c6143060a8485ed938991c39b1044e3f9b1e) | Preserves opt-in capability; avoids automatic platform archives |
| Persistent memory and native restart retrieval | [00400e56](https://github.com/ruvnet/ruflo/commit/00400e5667576ded953a1fba742c43e5aee82aac) | Actual pinned packages, separate processes |
| Proposal-to-isolated-candidate handoff | [039927ac](https://github.com/ruvnet/ruflo/commit/039927ac4c953ff61e8c61738d3d5cc63dfb0595) | Leases, identical evaluators, scoped patch, reverse-source proof; manual review required |
| Atomic snapshots | [e4f905f8](https://github.com/ruvnet/ruflo/commit/e4f905f81c93e3602a3c0c5879844d2d579e61ec) | Stale-reader and SIGKILL regressions; not power-loss durability |
| Namespace-safe update/delete | [a7c7ea5e](https://github.com/ruvnet/ruflo/commit/a7c7ea5edbd107fc1b014d9c6de875c540f49024) | Identity/version fences, ABA, duplicate and dimension checks |
| Agent task → memory → restart → second task | [cbe75332](https://github.com/ruvnet/ruflo/commit/cbe75332a0479c4216cb9df4123500c57610b8f1) | Real local harness, deterministic worker; no LLM reasoning claim |
| Fixed held-out evaluation | [da709de5](https://github.com/ruvnet/ruflo/commit/da709de5bd1b88c15399128d16fd004c1b7fc046) | Three fixed tasks/six processes and actual Weight EFT aggregation; not training improvement |
| Sparse-vector and evaluator-environment corrections | [54a8ac97](https://github.com/ruvnet/ruflo/commit/54a8ac97fcb9b546f5161bfb85c4f1fe5643a156) | Failing baseline/passing candidate regressions |
| Native Rustls update | [RuVector1230](https://github.com/ruvnet/ruvector/pull/1230) | Audit instances 13 → 9; ZIP gate still fails |

Versioned starters remain [memory v1](persistent-memory-v1.md), [lifecycle v2](persistent-memory-v2.md), [agent-memory v1](persistent-agent-memory-v1.md) and [held-out evaluation v1](heldout-agent-memory-v1.md). Their examples use real package APIs, but do not establish arbitrary combinations or production security.

## New cosine correctness fix

Finite nonzero Float32 vectors at scales 1e-30, 1e30, 1e-45 and 3.4e38 passed input validation but native cosine arithmetic returned distance 1 for both matching and orthogonal vectors. Stable double-precision normalization now applies only to disposable native index/query vectors. Stored embeddings and mutation/public contracts are unchanged.

The identical five tests against baseline 54a8ac97 produce 1 pass / 4 fail; candidate 5 pass. Independent fresh-consumer tests repeat the failure and prove restart/update retrieval, exact-match ordering, stable identity/version, unchanged database bytes and unchanged zero/underflow/overflow rejection. Approximate search and floating-point rounding remain; no semantic-quality, recall or speed percentage is claimed.

The [two-file patch](evidence/final-2026-10-18/cosine.patch) reverses exactly to baseline source hashes. This does not roll back consumer data and would reintroduce the defect.

## Final measured validation

| Check | Result |
| --- | --- |
| Node contracts, 16 files |92 pass, 0 fail, 0 skip; 12.678 s |
| Installed integrations, 8 files |45 pass, 0 fail, 0 skip; 99.219 s |
| Fresh smaller umbrella consumer memory/lifecycle |19 pass, 0 fail, 0 skip; 25.586 s |
| Python relationship collector |15 pass |
| Version-lockstep and dependency overlap |Pass;38 packages audited |
| Bounded loop |2 iterations, 10/10 registered checks pass each; 15 ledger identities |
| Prior candidate native binaries |297 pass, 3 existing live-API tests ignored; not a fresh rebuild |

Fresh consumer: Linux x64 / glibc 2.39, Node 24.19.0 / npm 11.9.0; separate empty npm caches, identical disabled lifecycle scripts. Unique cached package tarball bytes 522159201 → 412781888: **109377313 fewer bytes (20.9471%)**. Times 66.627 → 55.109 s, delta −11.518 s. One sequential pair does not establish a latency improvement; earlier pairs varied. All 1941 nonmanifest package files remain unchanged. This revalidates an earlier retained gain, not another gain. Bytes exclude metadata/protocol overhead/retransmissions. Unsigned manifest-only fixtures are not final signed release validation.

Memory workflow pins memory 3.0.5, ruvector 0.2.41, core 0.1.33 and sql.js 1.15.0. The separate qualified harness 0.2.0 fixture is not silently substituted into the umbrella payload measurement (umbrella harness 0.1.0). [Raw payload results](evidence/final-2026-10-18/payload-results.json) and [source-bound receipt](../../data/ecosystem-final-pilot.validation.json) preserve versions, hashes and limits.

Reproduction uses the existing CI commands in [.github/workflows/ecosystem-contracts.yml](../../.github/workflows/ecosystem-contracts.yml), with required resolver flags pointing to qualified installed fixtures. Full command/log evidence is archived in [final evidence](evidence/final-2026-10-18). For the defect, run the lifecycle file with --test-name-pattern='native cosine|native projection'; select old CLI only through the existing test-only RUFLO_MEMORY_CLI_TEST_PATH setting. Run the benchmark script with the archived published 3.57.0 tarball and preserved baseline manifest. Run ecosystem-loop.mjs --iterations 2 --max-duration-ms 240000 --max-checks 12 with separate --output/--ledger paths, then build-ecosystem-web.mjs against that receipt. Exit 2 means coverage incomplete, not test failure.

Base 54a8ac97 passed [hosted Node 22/24 CI](https://github.com/ruvnet/ruflo/actions/runs/39118429923). CI for this new source commit must be checked separately.

## Guidance coverage and next queue

Local Ruflo coverage stays 54 roots / 40 inventory packages. Ecosystem source documentation becomes 45/401 including draft upstream PRs; 356 pending = 4 verified mappings + 352 unknown mappings. This is not 45 released packages. New [MetaHarness417](https://github.com/ruvnet/metaharness/pull/417) covers turn-credit 0.1.0: build/lint and 20 tests per variant; fresh exported-CLI write/exit/report; packs 19606 → 20936 bytes (+1330); 33 old nonmanifest files identical. Shared policy is source-only; AGENTS is pack-verified. No downstream router/memory composition or model-training gain is claimed.

Other scoped guidance PRs: [RuVector1227](https://github.com/ruvnet/ruvector/pull/1227), [MetaHarness412](https://github.com/ruvnet/metaharness/pull/412), [415](https://github.com/ruvnet/metaharness/pull/415), [416](https://github.com/ruvnet/metaharness/pull/416). @ruvector/core is not covered by 1227.

Concrete mapped queue: @ruvector/core at npm/packages/core (native build gate); @ruvector/gnn at crates/ruvector-gnn-node; @ruvector/graph-node at npm/packages/graph-node; @ruvector/mincut-wasm at npm/packages/mincut-wasm. Verify policy, native build, source guidance and pack contents independently. Resolve exact registry/source ownership for the remaining 352 before edits.

## Unresolved gates and next action

- Runtime registry covers 11/401 packages (7 with registered integration checks), up from 10 packages / 7 checks initially; 390 remain uncovered. Graph still has 42 source-evidenced runtime links and 95 isolates. Annotations alone are not interoperability.
- RustSec audit still exits 1 with 9 ZIP finding instances. ZIP 1.1.4, 2.4.2, 7.2.0 cannot be coerced to fixed floor 9.0.0: Candle 0.8.4 requires ^1.1.1, ndarray-npy 0.9.1 requires ^2, Candle 0.9.2 requires ^7.2.0. All three precise resolver attempts exit 101 without lockfile changes. Fresh upstream Candle 0.11.0 still uses ZIP 8.6.0; ndarray-npy 0.10.0 still uses ZIP 6. Parent upgrades alone do not clear this gate. Inspected entry-reader usage does not establish full-workspace exploit exclusion.
- Next security action: upstream parent migration/backport to ZIP 9 with NPZ/PTH compatibility tests, then feature/platform validation and governed release. Do not suppress audit findings or remove supported features.
- A fresh native rebuild failed 101 during partial rebuild (missing hnsw_rs rlib), followed by disk exhaustion. Exact previously built binaries passed; hosted native builds passed earlier. These are distinct evidence, not a claimed successful fresh rebuild. Cleanup was denied and not bypassed; no caches/source were deleted. Remaining bounded tests used available temporary memory storage.
- Full platform support, signed artifacts, maintainer review and package release remain required. Namespace routing is not authorization. Seven-day compounding is a target, not evidence from one pilot; no perpetual schedule, automatic promotion or adoption claim is established.
