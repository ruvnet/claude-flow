# Independent SASS recovery replay — 2026-10-24

This bundle replays eight development export pairs and 45 conservative rejection probes, then generates four CPU-shim programs. It does not read confirmation inputs or invoke a GPU. The checked results contain 21,600 CPU comparisons with UBSan enabled. Repeated replay is verification of the same tests, not additional independent coverage.

The candidate TypeScript source and standalone ESM module must match the hashes in `review-receipt.json`. No implementation, executable, upstream lifter code, input archive, or private host metadata is bundled. The repository already contains the four SM86 development exports and the retained SM89 archive.

From the repository root, build the reviewed standalone module with the installed esbuild 0.28.2 transform (without bundling):

```sh
v3/node_modules/.bin/esbuild v3/@claude-flow/cli/src/rure/sass-recover.ts --platform=node --format=esm --target=node20 --outfile=/tmp/sass-reviewed.mjs
python3 plugins/ruflo-rure/scripts/sass-recovery-prepare-native.py --retained-development plugins/ruflo-rure/docs/evidence/recovery-20261024/gpu-attempt3/baseline-inputs.tar.gz --output /tmp/sass-dev-native
```

Set `REPLAY_DIR` to this bundle's location. All input and output paths are explicit, and output directories must be new:

```sh
node "$REPLAY_DIR/replay.mjs" --module /tmp/sass-reviewed.mjs --source v3/@claude-flow/cli/src/rure/sass-recover.ts --sm86-dir plugins/ruflo-rure/scripts/baselines/culifter/crosspath-inputs --sm89-dir /tmp/sass-dev-native --output /tmp/sass-review-replay
```

Inspect the four generated `.cpp` files before compiling. The runner verifies their hashes, builds with C++17 and UBSan, runs them with a timeout, and removes its temporary executables:

```sh
python3 "$REPLAY_DIR/run-cpu.py" --input /tmp/sass-review-replay --output /tmp/sass-cpu-results.json --compiler g++
```

Expected results: eight emitted development exports with the recorded code hashes; 45 mutations returning no code; four programs each reporting 5,400 comparisons. Input directories may contain flat `name.sass`/`name.elf` exports or the preparer's `name/original.sass` and `name/original.elf` layout.

The synthetic rejection tests deliberately retain encoding comments while altering textual instructions or metadata. They test parser and emitter admission; they do not claim authentic binary decoding. The lifter requires authentic matching cuobjdump exports and explicit CUDA ABI/runtime assumptions. CPU-shim success does not establish GPU equivalence, performance, or state of the art.

The execution review in `review-receipt.json` approved one bounded run of the exact listed controller/worker/evaluator revisions. It records review clearance, not a completed GPU result, provider deletion guarantee, billing receipt, or execution attestation. Partial confirmation must retain its complete frozen denominator and exclusions. Future source changes require a new review.
