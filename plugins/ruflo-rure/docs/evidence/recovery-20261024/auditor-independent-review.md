# Independent evidence-gate fix verification

Outcome: all previously reported false-READY cases are closed on the reviewed final source. An additional invalid-manifest resource-budget issue was discovered during retesting and independently verified fixed. No remaining confirmed blocker in this focused completeness/consistency/resource review.

Final worker commit: `b39b26077fa4740f532e3eccecef639875e49195`.
Final auditor SHA-256: `5472322dd99dc7a66a788b8bada30b82ec1eeaea8360b423fac6a56c2706180b`.
Policy JSON SHA-256: `244c00b55cbcda23f534e9a5b19fae15bd3417f47d9f5640f0765643dfafce3c`.
Node: v24.19.0.

The independent fixture was adapted to the declared new schema, without copying the author's fixture function or weakening the attacks. It has 100 synthetic kernel metadata records, 400 environment rows, frozen per-row test/reference bindings, original/candidate/baseline receipt objects, rejection records, negative control, and memcheck metadata. It uses actual files and the production artifactReader. These are deliberately synthetic records, not actual CUDA executions or benchmark measurements.

The complete fixture returns READY_FOR_INDEPENDENT_REVIEW while authenticatedExecution:false, sotaProven:false, and promotionVerdict:INCONCLUSIVE remain asserted. The actual command-line gate was also exercised against the complete fixture and separate bindings. Twenty-two negative variants fail closed:

- Empty generated source, compiled artifact, receipt, actual output, and side reference individually.
- Every admitted artifact replaced by one empty file.
- Different baseline reference/output while its own receipt is updated to match the altered output.
- Missing candidate author and non-array unresolved baseline list.
- Missing original program, original output, or test manifest.
- A JSON-object receipt containing no required fields.
- Bare rejected/unavailable baseline without an attempt receipt.
- Rejection receipt bound to the wrong tool, and unsupported rejection reason `not-installed`.
- Memcheck prose without structured receipt evidence.
- Negative control that matches its reference.
- Original/reference and candidate/reference disagreement with receipts updated to the observed wrong output.
- Missing frozen workload manifest with dependent dataset/review/memcheck bindings updated.
- All required case categories replaced with `unclassified`, updating every dependent test, original, side, rejection, negative-control, dataset, review, and memcheck digest. This isolates the category check rather than merely causing a stale-hash failure.

The last three observed mismatch cases reject; missing/empty/inconsistent evidence remains inconclusive. Exact outputs are in `retest-final-results.jsonl` (23 lines including the complete control), and assertions enforce the expected verdict and permanent non-authentication/non-promotion flags.

## Additional resource finding, fixed

On intermediate auditor SHA `df59cef6ce5abfb283465340a6f468ce6144bbb204a20cdcd6e6019fc9c9ef46`, the matrix budget guarded the number of unique validated IDs, but the expansion iterated the original kernel array. Invalid duplicate rows whose ID matched a valid kernel were thus expanded despite already being flagged. A 344,367-byte manifest with 100 valid IDs plus 9,900 duplicate invalid objects and an 8x8 environment matrix produced 640,801 matrix tuple serializations versus a declared 100,000 observation budget. Short-label reproduction completed in about 357 ms; long-label OOM stress was intentionally not run.

The final change expands `[...ids]` rather than the raw manifest. Repeating the exact independent probe yields 7,201 tuple serializations and REJECT, around 99 ms in this run. The source diff was inspected and the full independent 23-case completeness suite rerun on the new hash. Timing is a local observation, not a worst-case claim.

Production reader protections were independently retested on the repaired reader: aggregate byte limit, failed-hash byte charging, cached-reference attempt limit, traversal rejection, and symlink rejection passed. The final delta only changes matrix expansion; the reader is unchanged.

## Reproduction

Immutable final source copy: `gate-final.mjs`.

```bash
node /workspace/scratch/16fc07be6201/rure-recovery-adversarial/gate-review/retest-final.mjs
node /workspace/scratch/16fc07be6201/rure-recovery-adversarial/gate-review/duplicate-work-budget-final.mjs
node /workspace/scratch/16fc07be6201/rure-recovery-adversarial/gate-review/bounds-fixed.mjs
```

`bounds-fixed.mjs` imports the preceding immutable source whose reader is byte-identical to the final reader. The final complete fixture is in `retest-artifacts/complete-report.json` with `complete-bindings.json`; artifact references resolve under the same directory.

No holdout corpus was read, target repository files were not edited, and no remote effects or GPU execution occurred. This review establishes schema consistency and bounded artifact processing for these probes. It does not authenticate execution, prove that stated case labels exercised those semantics, authenticate human independence or licenses, validate canonical-program equivalence, grant approval, establish SOTA, or certify all dependencies.
