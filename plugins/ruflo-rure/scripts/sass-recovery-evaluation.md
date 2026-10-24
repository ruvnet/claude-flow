# Independent SASS recovery evaluation

This evaluator measures a bounded integer recovery capability. Four exposed
development regressions and six freshly authored synthetic kernels are separate
datasets. Neither establishes SOTA superiority. Unsupported recovery is a coverage
gap; a compiled incorrect result is a failure. No script allocates a GPU.

The translator receives only SASS and ELF exports. CUDA sources and independent
BigInt oracles remain in the evaluator context. The source/oracle confirmation
plan was frozen before candidate output; native artifacts must also be frozen
before invoking the frozen candidate. Context separation is not filesystem
isolation. Use the reviewed namespace sandbox for actual isolated translation.

## Development and local checks

From the repository root:

```sh
node --test plugins/ruflo-rure/scripts/sass-recovery-e2e.test.mjs
node plugins/ruflo-rure/scripts/sass-recovery-e2e.mjs --mode prepare-development --output /tmp/new-sass-dev-inputs
```

`prepare-development` produces the same four SM86 SASS/ELF inputs used by the
CuLifter comparison. The old SM86 run did not retain original cubin bytes. For
exact-cubin GPU regressions, extract the four retained SM89 artifacts instead:

```sh
python3 plugins/ruflo-rure/scripts/sass-recovery-prepare-native.py \
  --retained-development plugins/ruflo-rure/docs/evidence/recovery-20261024/gpu-attempt3/baseline-inputs.tar.gz \
  --output /tmp/new-sass-dev-native
```

This verifies the pinned archive and per-file hashes. It does not imply that its
auxiliary ptxas cubins were executed by the old PTX-JIT evaluation.

## Input-only translation

Freeze the standalone reviewed Node 20 compatible backend module and its SHA-256.
Mount only that module, the adapter, and `translation-input/` read-only into the
reviewed sandbox. Mount an empty writable output parent. Do not mount sources,
oracles, credentials, home directories, or network access.

```sh
node sass-recovery-translate.mjs \
  --module /candidate/recover.mjs --module-sha256 "$FROZEN_MODULE_SHA" \
  --input /input --manifest-sha256 "$FROZEN_INPUT_MANIFEST_SHA" \
  --output /output/result
```

Every candidate invocation is `recoverSass(sassText, elfText)`. The adapter records
unsupported/invalid results without calling them correct. Output contains a
`translation-result.json`, and one `recovery.json` and optional `recovered.cu` per
kernel. The output directory must not already exist.

## Confirmation preparation

On the authorized isolated CUDA compiler host, before candidate invocation:

```sh
python3 sass-recovery-prepare-native.py --spec-dir frozen-specs \
  --output new-native-artifacts --arch sm_89
```

Bind the native manifest hash externally before translation. The preparer records
compiler tool paths, executable hashes, versions, commands, and each exact cubin,
SASS and ELF digest. Its input-only projection excludes original CUDA and oracle
data. Six sources produce six native kernels, not dozens of independent kernels
from launch-size variants. Native compilation does not expose confirmation to
the recovery candidate.

After independent review and the final candidate freeze, invoke the same isolated
translator once on this native input projection. Persist that first exposure and
its timestamp. Later fixes require a new-holdout statement; replay is not a fresh
untouched confirmation.

## Independent CPU and exact-cubin GPU execution

Run the oracle-owning evaluator separately from the translator:

```sh
node plugins/ruflo-rure/scripts/sass-recovery-e2e.mjs --mode cpu \
  --split confirmation --inputs native/translation-input --native native \
  --translations translated --output new-cpu-evidence
node plugins/ruflo-rure/scripts/sass-recovery-e2e.mjs --mode package-gpu \
  --split confirmation --inputs native/translation-input --native native \
  --translations translated --cpu new-cpu-evidence --output new-gpu-bundle
```

Development uses `--split development`. CPU compilation uses g++ C++17 with UBSan;
finite per-thread simulation does not prove GPU execution or general memory safety.
The evaluator compares every output and eight sentinel tail elements, and verifies
that inputs remain unchanged. Four regressions contain 28 cases and 780 element
comparisons per variant. Six confirmation kernels contain 36 cases and 1,008
comparisons per variant. Full coverage is required by default. With an explicit
`--allow-subset true`, a coverage-incomplete CPU receipt may export only kernels
whose compilation, numerical comparison, and negative controls all passed. Any
CPU failure blocks export. The GPU manifest retains the complete frozen
denominator, all excluded IDs/statuses, and the admitted counts; its status stays
`partial-incomplete`. Passing an admitted subset does not imply complete recovery
or promotion eligibility. Candidate code, original oracles and thresholds are
unchanged by this observational subset export.

Development includes a separately compiled arithmetic mutation changing the sole
emitted constant seven to eight. It must fail the original oracle. Per-kernel
output-corruption controls are recorded separately and do not replace this code
mutation. GPU bundle development includes `add7_wrap32/mutated.cu`.

The authorized GPU worker verifies the bundle manifest, compiles each recovered
CUDA file with `nvcc -std=c++17 -cubin -arch=<frozen-arch>`, preserves both original
and recovered cubin bytes, and hashes them before and after execution. Compile the
driver with `nvcc -std=c++17 sass-recovery-gpu.cu -lcuda -o sass-recovery-gpu`.

```sh
./sass-recovery-gpu /absolute/new-gpu-bundle
# Development only; compile mutated.cu to mutated.cubin first. Must exit 1:
./sass-recovery-gpu /absolute/development-gpu-bundle --mutation
```

Both driver module inputs must be ELF cubins; renamed PTX is refused. The driver
loads these exact artifact bytes via CUDA Driver API. This binds inputs, not the
driver's internal relocations or an independently authenticated execution receipt.
Retain original/recovered/mutated cubins, exports, source hashes, and raw results.

Timing is separate: the final frozen case, 10 warmups and 100 alternating paired
samples per variant, measuring host launch plus synchronization. Allocation,
transfers, compiler setup, rental provisioning and evaluator cost are excluded
from these samples and must be reported separately. Preserve the existing gate:
at least 10% geometric mean median improvement and no per-kernel regression above
2%. Unlocked clocks and small synthetic workloads limit performance conclusions.

Unknown actual billing remains unknown. Hashes are integrity bindings, not
execution authentication, authorization, merge approval or proof of superiority.

## Replay the observed exact-cubin receipt audit

The post-execution checker is pinned to the observed development and confirmation
receipts. It verifies the preserved member bytes, original development receipt
supplement, vectors, original/recovered/mutated cubins, CPU/GPU lineage, full
denominator, and raw timing arithmetic. It does not rerun confirmation or claim
that a receipt hash authenticates execution.

```sh
python3 plugins/ruflo-rure/scripts/sass-recovery-receipt-audit.py \
  /path/to/public-evidence \
  --archive /path/to/public-evidence.tar.xz \
  --development-supplement /path/to/development-supplement
```

The retained xz archive preserves the members of the original per-split gzip
archives; those gzip packaging bytes are not duplicated. Per-member binary
digests remain verified. The original development CPU/translation receipts in
the supplement match the GPU manifest exactly; they are not replacement reruns.
