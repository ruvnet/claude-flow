# Bounded PTX decompilation validation — 2026-10-24

`rure_decompile_ptx` adds instruction evidence, basic blocks and annotated
pseudocode for standalone PTX. The scoped verdict is **ACCEPT** for the frozen
structural and instruction-IR checks. This is a draft implementation, not a
release or a general CUDA/SASS equivalence claim.

| Gate | Observed result |
| --- | --- |
| ruRE regression suite | 183 passed, 7 optional live-tool tests skipped |
| TypeScript build | CLI and swarm pass after reviewed runtime staging |
| Static plugin smoke | 72 checks pass |
| Independent CPU oracle | 18 cases, 3,576 exact comparisons |
| Real GPU oracle | RTX 3060 / CUDA 12.8.93; 18 cases, 7,152 exact comparisons |
| Negative control | Changed affine addend rejected, expected 13 versus actual 14 |
| Built and clean-installed MCP | Initialization, discovery and actual tool call pass |
| Controlled alias ablation | Exact output equality; local median 39.114 to 5.643 ms |
| Dedicated ruOS reproduction | CPU checks pass; alias median 63.952 to 9.340 ms |
| GPU cleanup | Task instance independently verified absent |

Alias timings use five samples per variant on a deliberately adversarial
4,096-label input. The comparison restores two prior array-copy loops in an
otherwise identical candidate. It is neither a published-release comparison
nor a GPU speedup claim. The 20,000-label case is separately rejected by the
new cap. Raw timings, hashes and exact-output checks are retained.

Independent review found and verified fixes for quadratic label accumulation,
descriptor reads that could grow past the input cap, attacker-controlled object
keys, screening collisions, BOM-sensitive source hashing, and a FIFO open that
could block before the regular-file check. A bounded subprocess regression
checks FIFO rejection; independent verification completed in 0.107 seconds.
The test author
specified the integer oracle independently from the parser implementation.

The first real MCP test caught a registry-bootstrap security API mismatch that
direct handler tests missed. The same 26 type errors occur on the unchanged
base. Running the repository's existing internal-runtime staging workflow
resolved the build and actual MCP call. No policy was disabled. Build commands
are in [the reproduction guide](../../scripts/ptx-e2e.md).

Two release limitations remain explicit. Optional AIDefence was absent in the
clean test installation, so the tool reports `screened: false`; screening mocks
do not establish runtime screening. The installed dependency audit reports six
affected package nodes tracing to the existing
[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), with Zod
3.25.76 installed. This patch adds no dependency or lock changes and its parser
has no third-party imports, but broader CLI reachability has not been certified
safe. Dependency remediation or a reviewed reachability disposition is needed
before release; no unrelated major-version upgrade is bundled here.

The GPU ran for 61.09 seconds. Its quoted compute/storage estimate is $0.001499;
attributed actual billing and total research cost remain unknown. Only public
fixtures crossed to the GPU; account credentials stayed on their owning host.

Receipts:

- [Integration, versions, artifact integrity and review scope](ptx-integration-20261024.json)
- [GPU environment, exact checks and cleanup](ptx-gpu-20261024.json)
- [Sanitized GPU stdout and hashes](ptx-gpu-raw-20261024.json)
- [Authenticated ruOS completion and reproduction](ptx-ruos-20261024.json)
- [Frozen controlled-ablation measurements](ptx-alias-benchmark-20261024.json)

Run the dependency-free acceptance test from the repository root on Node 24:

```sh
node plugins/ruflo-rure/scripts/ptx-e2e.mjs
```

Pseudocode is not compilable CUDA C++. Floating-point, tensor, barrier,
concurrency, arbitrary SASS and cross-GPU equivalence remain outside this
validation. Rollback is closing the draft or reverting its commit; the existing
CUDA inventory tool remains available.
