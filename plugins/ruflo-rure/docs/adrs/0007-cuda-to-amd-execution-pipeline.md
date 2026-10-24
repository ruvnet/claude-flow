# ADR 0007: bounded CUDA source to AMD execution pipeline

Status: Experimental implementation; physical GPU acceptance pending.

## Outcome and boundary

Port a trusted CUDA source workload through HIPIFY, compile both backends, check every output against a CPU reference, and select a launch configuration using repeated measurements. This is an explicit execution workflow separate from the static `rure_*` MCP tools. Those tools retain their parse-only contract. This implementation does not reconstruct source from binaries, rewrite arbitrary projects with an LLM, provision GPUs, install toolchains, publish packages, or merge changes.

## Contract

The input is one self-contained CUDA translation unit whose executable accepts `size block` and prints one JSON object: `backend` (`cuda` or `hip`), `device`, `size`, `checked`, `max_abs_error`, `milliseconds`. The supplied SAXPY fixture obtains device identity from the runtime, checks all outputs against a CPU calculation, and times the kernel using GPU events. Custom inputs and compiler executables are trusted: self-reported JSON is not independent hardware attestation. The runner cannot establish correctness of a dishonest custom checker.

Execution workers must be Linux/POSIX with Python 3. The default `--stage both` needs `nvcc`, `hipcc`, `hipify-perl` and both GPU runtimes/devices. Separate workers use `--stage cuda` on NVIDIA and `--stage hip` on AMD. The latter requires only HIP tools plus a CUDA receipt and its independently supplied SHA256. No GPU is needed for control-flow unit tests.

Receipt producers and transport are trusted. A SHA256 establishes integrity against the supplied digest, not authenticity or hardware attestation. Import requires schema 2, completed CUDA baseline status, matching source and exact policy, toolchain/binary provenance, complete finite measurements and a consistent runtime device identity; medians are recomputed. A forged receipt from an untrusted producer is outside this contract. Do not infer physical validation from JSON alone.

## State machine

New output directory → consent check → frozen source hash → toolchain preflight → CUDA build → optional RuRE inventory → HIPIFY → HIP build → baseline warmup and measurements → bounded AMD candidate measurements → correctness and slowdown gate → receipt.

Any missing tool, compile error, malformed/nonfinite measurement, partial correctness check, excessive numerical error, timeout or output cap blocks the run. A correct AMD result over the configured slowdown limit is rejected. No failed candidate is silently ignored. Selection uses the lowest worst-case AMD/NVIDIA median latency ratio across all input sizes. Each size/configuration gets one discarded warmup and at least three measured runs. The supplied fixture additionally performs 32 timed iterations per process in the same GPU context, resetting inputs and checking every output each time, and returns their median. Reports include median absolute deviation and range across process medians. These timings cover kernels only, excluding transfers/startup; they do not establish workload cost savings. Rates, energy and confidence intervals are not measured.

The default acceptance envelope allows at most 25% slowdown; users must choose a workload-appropriate threshold before running. Tolerance, sizes, trial count and block candidates are fixed before compilation. The report records exact source/HIP/binary SHA256 digests, tool commands, tool version-output digests, process exit codes and measurements. Original source is not edited. Output directories cannot be reused.

## Execution safety

`--allow-execute` authorizes execution of the trusted input and selected tools. This runner is not a sandbox. Use a disposable worker with no production secrets for third-party source. Commands use argv arrays, never a shell. Every command has a timeout, the whole run has a maximum wall-time budget, process groups are killed on timeout and after command completion, and captured output is bounded. It creates no cloud resources and makes no network calls itself; trusted compilers/workloads can still do either. Budgets govern this runner, not external cloud billing.

## Run

From the repository root, on a prepared dual-vendor worker:

```sh
python plugins/ruflo-rure/scripts/cuda_to_amd.py \
  --source plugins/ruflo-rure/examples/cuda-to-amd/saxpy.cu \
  --output /tmp/cuda-amd-run-001 --allow-execute \
  --budget 600 --timeout 120 --trials 5 --max-slowdown 1.25
```

Optionally supply `--ruflo /absolute/path/to/ruflo` to record static CUDA inventory. The report retains screening warnings from that tool; inspection is not correctness evidence. Exit zero means the configured gate passed, or a CUDA-only baseline completed with `baseline_ready`; that partial status does not validate AMD. Exit two means blocked/rejected. Inspect `report.json` for the distinction. Keep the source, translated source, binaries and receipt together for reproduction; remove only that run's directory for rollback.

For separate workers, first run the same command with `--stage cuda`, preserving `report.json` and computing its SHA256 through a trusted channel. On AMD run with identical source and policy flags, a fresh output directory, and `--stage hip --baseline /trusted/cuda-report.json --baseline-sha256 <digest>`. A CUDA-only receipt has `hardware_validated: false` because the cross-vendor gate remains incomplete.

## Validation and next gate

`python -m unittest discover -s plugins/ruflo-rure/tests -v` tests finite values, workload identity, opt-in, existing-directory refusal, missing tool receipt, process timeout, output cap simulated success/performance rejection, split-worker execution without CUDA tools on AMD, and receipt hash/source/policy/completeness rejection. The mocked test exercises orchestration only and is not hardware evidence. Local live invocation correctly reports missing `nvcc` as blocked. The available enrolled AMD desktop currently lacks an execution adapter, so no AMD execution or migration performance is claimed.

Acceptance on actual hardware requires all default workload sizes to pass the CPU reference on both vendors; every selected AMD size must satisfy the configured latency ratio; source hashes must remain unchanged; report status must be `passed`. A separate review should decide production integration after that evidence exists.
