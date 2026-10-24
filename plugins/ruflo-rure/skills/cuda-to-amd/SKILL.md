---
name: cuda-to-amd
description: Port a trusted self-contained CUDA workload to HIP and validate it on NVIDIA and AMD GPUs with a bounded execution budget.
---

Read `../../docs/adrs/0007-cuda-to-amd-execution-pipeline.md` before execution. This workflow executes trusted source and tools, unlike static ruRE readers. Confirm the user's task authorizes execution, use an isolated worker, and never provision or spend beyond existing authorization.

Use `../../scripts/cuda_to_amd.py --help` for current options. Begin with the supplied SAXPY fixture on prepared GPU workers: either both runtimes on one host, or `--stage cuda` followed by `--stage hip` on separate hosts. Transfer the baseline receipt through a trusted channel and supply its independently verified SHA256; this integrity check is not producer authentication. Freeze tolerance, workload sizes, trials, candidate blocks, time budget and performance threshold before running. Give every run a new output directory. If custom source is supplied, inspect its benchmark protocol and CPU checker first; do not treat self-reported JSON as hardware attestation.

Run the pipeline once, read `report.json`, and distinguish `passed`, `rejected`, `blocked` and CUDA-only `baseline_ready`. A completed baseline alone is not cross-vendor validation. Missing GPU/toolchain execution is blocked, never successful simulation. Preserve source hashes, translated source, binaries and receipt. If the authorized task includes a PR, attach measured evidence and residual limitations; never merge or deploy from a benchmark alone.
