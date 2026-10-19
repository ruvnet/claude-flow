# Persistent local agent task starter v1

Run a real `@metaharness/harness@0.2.0` HarnessKernel task, save its result with
`@claude-flow/memory@3.0.5`, exit, retrieve it through native `ruvector@0.2.41`
and `@ruvector/core@0.1.33`, then execute and save a second task using that
result. `sql.js@1.15.0` provides the authoritative SQLite/WASM persistence.
This is a useful bounded composition of actual packages, not an added npm
dependency edge or an LLM-intelligence benchmark.

## Reproduce

Use Node 22 or 24 on Linux x64 from this checkout:

```bash
consumer=$(mktemp -d)
npm install --prefix "$consumer" --ignore-scripts --no-audit --no-fund --save-exact \
  @metaharness/harness@0.2.0 @claude-flow/memory@3.0.5 \
  ruvector@0.2.41 @ruvector/core@0.1.33 sql.js@1.15.0
export RUFLO_HARNESS_RESOLVE_FROM="$consumer/package.json"
export RUFLO_MEMORY_RESOLVE_FROM="$consumer/package.json"
export RUFLO_REQUIRE_HARNESS=1
node scripts/examples/persistent-agent-memory-v1.mjs
node --test scripts/tests/ecosystem-agent-memory.installed.test.mjs
```

The first process sums three bounded integers and persists a verified result
plus a distractor. A different process retrieves the saved result using a
fixture vector and subtracts a discount. The parent independently checks the
persisted second result. Reports include process IDs, exact dependency versions,
elapsed operation times, task success, input digests and the package receipts.
The example cleans only its disposable database directory. Preserve its lockfile
for dependency integrity evidence; direct pins do not freeze all transitive
resolution. Existing umbrella installations may resolve harness 0.1.0 and are
not silently upgraded: this starter explicitly installs the qualified 0.2.0.

## Acceptance and limits

The tests exercise restart/native retrieval, a policy-denied worker, a failed
fixed-result oracle, duplicate write rejection, missing/wrong-namespace state,
bounded input, version mismatch before mutation, wrong saved-input digest and
the runnable starter. Failed or denied tasks do not publish database changes.
The installed kernel calls its memory-update hook even for failed results;
this adapter therefore requires both success and a valid receipt chain before
writing. No retry, network model, GPU training or paid service is involved.

Policy gates **worker execution**, not memory access: the actual kernel retrieves
memory before checking its tool policy. A denied second task can read the
namespace but cannot run the worker or write. Namespace selection is routing,
not authentication. Inputs, local dependency files, worker and fixed oracle are
trusted. The worker supports only two fixed single-step arithmetic operations;
general DAG failure propagation, hostile arbitrary code, semantic embedding
quality and adversarial model evaluation are not established.

Package-version preflight checks compatibility before mutation, not code
integrity. Receipt hashes are unsigned and recomputable; upstream `inputHash`
does not cover goal/context. The separate `consumerInputDigest` binds the
consumer input for this evidence only, not authorization or tamper resistance.

The [memory v2 snapshot and mutation limits](persistent-memory-v2.md) still
apply: trusted local POSIX storage, cooperating writers, explicit stale-lock
recovery, no physical power-loss guarantee and no secure erasure. Source rollback
removes this adapter, registry check and starter; it does not undo saved task
records. Stop writers and preserve important state before any rollback.

The ninth registry check raises registered package coverage from 10 to 11 of
401 and integration-registered packages from five to six. This proves this
combination only. No automatic promotion, merge, npm publish, adoption gain or
new payload saving is claimed. See [source-bound evidence](../../data/ecosystem-agent-memory.validation.json).
