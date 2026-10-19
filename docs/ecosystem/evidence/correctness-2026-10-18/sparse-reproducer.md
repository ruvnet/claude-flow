# Sparse-vector correctness evidence: captured reruns

These logs are fresh reruns on 2026-10-18, not reconstructed logs from the earlier streamed executions. No product source was modified for these reruns.

Baseline commit: `da709de5bd1b88c15399128d16fd004c1b7fc046` (clean checkout `/workspace/scratch/1511111b1812/ruflo-cycle7`). Baseline workflow SHA256: `8f8fa87a461842fdbd3348da1a5e15a1da6578226e0a4970a8e66659edc921fc`.

Candidate workflow SHA256: `2e5fe5055d8e0c0f7d7ab6e02bb371cd1a8f2224d8245584973b73d4e099eac1`. Candidate lifecycle test SHA256: `89c54c281d4756cab8e2b9ad796d28f6a7c7744770790056c197e8182ef8a73f`.

The baseline test file is an exact copy of the candidate lifecycle test except its memoryWorkflow import points to the baseline checkout. Both commands run from `/workspace/scratch/1511111b1812/ruflo-review-cycle8`. This preserves identical assertions; only the workflow under test changes. The CLI seeds dense valid records identically. Runtime: Linux x64, Node 24.19.0. Actual dependencies: memory 3.0.5, RuVector 0.2.41, core 0.1.33, sql.js 1.15.0.

Baseline command (expected exit 1, three failures):

```sh
env -u NODE_TEST_CONTEXT RUFLO_MEMORY_REQUIRED=1 RUFLO_MEMORY_RESOLVE_FROM=/workspace/scratch/1511111b1812/cycle6-consumer/package.json node --test --test-name-pattern='direct API rejects sparse' /workspace/scratch/1511111b1812/review-cycle8-evidence/sparse-baseline.test.mjs > /workspace/scratch/1511111b1812/review-cycle8-evidence/baseline-rerun.log 2>&1
```

Candidate command (expected exit 0, three passes):

```sh
env -u NODE_TEST_CONTEXT RUFLO_MEMORY_REQUIRED=1 RUFLO_MEMORY_RESOLVE_FROM=/workspace/scratch/1511111b1812/cycle6-consumer/package.json node --test --test-name-pattern='direct API rejects sparse' scripts/tests/ecosystem-memory-lifecycle-installed.test.mjs > /workspace/scratch/1511111b1812/review-cycle8-evidence/candidate-rerun.log 2>&1
```

Scope: direct exported API sparse JavaScript arrays. CLI JSON converts array holes to null and was not the defective path. Candidate rejects write, update and retrieve inputs before opening state, leaves database bytes unchanged and preserves prior records across separate-process retrieval. This is correctness evidence, not a performance, security-severity, signed-release or general ecosystem claim.
