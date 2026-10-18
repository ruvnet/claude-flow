# RuVector ecosystem analysis

The ecosystem is mappable, but it is not one connected runtime. On October 18, 2026, the 401 captured packages formed 146 groups using npm declarations. Published source reveals 42 additional runtime relationships. Including those relationships leaves 104 groups and 95 isolated packages requiring further review.

| Measure | npm declarations | Declarations plus runtime evidence |
| --- | ---: | ---: |
| Packages | 401 | 401 |
| Unique undirected links | 443 | 485 |
| Connected groups | 146 | 104 |
| Largest group | 248 | 285 |
| Isolated packages | 138 | 95 |
| Packages whose removal splits a group | 43 | 44 |
| Links whose removal splits a group | 129 | 171 |

A foundation with no dependencies is a valid endpoint. A product with no consumers is also valid. An isolate means that this inventory contains no observed internal relationship; it does not prove that the package is broken or intentionally standalone. External npm packages are excluded from these counts.

## What changed

The impact planner now includes 37 MetaHarness wrappers that invoke `metaharness@latest`. Their published manifests omit that runtime relationship. A separate group contains KGE and its five native fallback packages. KGE already bundles native binaries, so the fallback links do not justify new installation dependencies.

The original [npm graph](../../data/npm-dependencies.latest.json) remains unchanged. The [runtime evidence overlay](../../data/npm-runtime-relationships.latest.json) identifies each source version, registry tarball, integrity, source file, line, excerpt and source hash. The collector verifies tarball integrity, reads bounded archive contents, and never executes downloaded code. This collector deliberately recognizes only isolated MetaHarness scaffold patterns and the KGE loader; it is not a complete JavaScript call graph.

| Changed package | Previously selected | Now selected | Added consumers |
| --- | ---: | ---: | ---: |
| `metaharness` | 71 | 108 | 37 |
| `@ruvector/core` | 71 | 71 | 0 |
| `@claude-flow/memory` | 21 | 21 | 0 |

Selections include the changed package and transitive consumers. They reduce candidate regression scope from all 401 packages, while fixing missed consumers. They do not establish test coverage, successful package integration, or execution speedup. No package test command is invented or executed from registry metadata.

The planner caches forward and reverse adjacency, separates required dependencies from capability relationships, groups declaration cycles, and emits dependency ordered batches. These three example capability plans contain cycles, so `graphPlanAvailable` remains false. The grouped batches are diagnostic candidates, not approved release orders. `releaseAuthorized` is always false.

## Actual RuVector execution

[Complete analysis](../../data/npm-connectivity.latest.json) records RuVector 0.2.41, engine and analysis source hashes, input hashes, all components, isolates, structural cuts and candidate batches. Its public `buildGraph`, `findArticulationPoints` and `findBridges` APIs ran against required declarations, all declarations, and the enriched graph.

These are JavaScript graph algorithms. Native vector acceleration is not involved. Native addon warnings from the optional free installation do not affect these graph APIs.

Every node and edge cut agrees with an independent removal and breadth first search oracle. All 802 required and capability impact queries agree with the original snapshot. Each graph benchmark uses one warmup and 21 measured cut analyses, excluding imports, projection and the oracle. Timings are recorded for reproducibility; the oracle is a correctness check, not a production performance baseline.

The enriched graph makes MetaHarness the largest structural cut: removing it adds 38 components. This identifies where wrapper integration tests deserve attention. A structural cut does not prove an actual runtime outage, especially when platform packages or optional capabilities are involved.

## Reproduce and validate

```bash
npm install --prefix /tmp/ruflo-ruvector-proof --ignore-scripts --omit=optional \
  --no-audit --no-fund --save-exact ruvector@0.2.41

python3 scripts/collect-runtime-relationships.py \
  --input data/npm-dependencies.latest.json \
  --output data/npm-runtime-relationships.latest.json

node scripts/analyze-ecosystem.mjs \
  --ruvector-from /tmp/ruflo-ruvector-proof/package.json

RUFLO_RUVECTOR_REQUIRED=1 \
RUFLO_RUVECTOR_RESOLVE_FROM=/tmp/ruflo-ruvector-proof/package.json \
node --test scripts/tests/ecosystem-analysis-installed.test.mjs
```

Use repeated `--changed PACKAGE` options for other impact plans. Use `--runtime none` for declarations only. The default source snapshot is intentionally pinned; refreshing the inventory requires reviewing the evidence and updating the snapshot acceptance assertions.

Local validation passed 46 Node contract tests, 15 Python collector tests and one real RuVector CLI integration test, with no skips. The Node tests include 600 generated graph cases. CI runs the contracts and real RuVector integration on Node 22 and 24. Registry collection is reproducible separately and is not required during every CI run.

## Remaining work

The 95 remaining isolates are listed in the analysis JSON. Four inspected MetaHarness packages had no recognized delegation: `agntcy`, `aws-finops`, `field-memory` and `projects`. Other isolates remain outside the narrow source inspection scope.

Six packages declare an optional peer on `@claude-flow/ruvector-upstream`, which returned HTTP 404 during collection. The evidence records the consumers and check time. This is an unresolved optional capability, not a default installation failure.

The 37 delegations use floating `latest` selectors. Follow up in their source repository to pin supported runtime versions and test upgrades. Several scaffold command strings also interpolate project names; replace those shell commands with argument based execution and add hostile input regressions before publishing updated wrappers.

Acceptance for this change is exact graph parity, source bound runtime evidence, unchanged required dependency topology and a passing real RuVector command. Acceptance for ecosystem runtime compatibility still requires package specific integration tests and the existing signed release gates.
