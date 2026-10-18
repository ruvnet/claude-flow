# Held-out agent memory starter v1

This repository-owned consumer connects real `@metaharness/harness@0.2.0`,
`@claude-flow/memory@3.0.5`, `sql.js@1.15.0`, `ruvector@0.2.41`,
`@ruvector/core@0.1.33` and `@metaharness/weight-eft@0.1.2`.
It evaluates three fixed local arithmetic cases with literal expected answers.
Each case runs a first task, saves its verified result, exits, then starts a
second task that retrieves that result through the native vector projection.
The evaluator reads the saved second result and passes measured outcomes to
Weight EFT's actual `summarizeCascade` API.

## Reproduce

Use Node 22 or 24 on a supported native-core platform. The locally measured
environment is Linux x64. Create a disposable consumer outside this checkout:

```bash
consumer_dir=$(mktemp -d)
npm install --prefix "$consumer_dir" --ignore-scripts --no-audit --no-fund --save-exact \
  @metaharness/harness@0.2.0 @claude-flow/memory@3.0.5 sql.js@1.15.0 \
  ruvector@0.2.41 @ruvector/core@0.1.33 @metaharness/weight-eft@0.1.2
export RUFLO_MEMORY_RESOLVE_FROM="$consumer_dir/package.json"
export RUFLO_HARNESS_RESOLVE_FROM="$consumer_dir/package.json"
export RUFLO_WEIGHT_EFT_RESOLVE_FROM="$consumer_dir/package.json"
export RUFLO_WEIGHT_EFT_REQUIRED=1
node scripts/examples/heldout-agent-memory-v1.mjs
node --test scripts/tests/ecosystem-heldout-evaluation.installed.test.mjs
```

The starter removes only its own temporary databases, not the installed consumer.
It requires exact qualified versions and a working native vector implementation.
Missing dependencies fail the required check; an exit code without real nonzero
test counts and zero skips is not acceptance evidence.

## What this proves—and does not

- Three exact case IDs prevent dropping difficult cases or substituting easier
  ones. Fixed answer checks do not trust a worker's quality or confidence score.
  Weight EFT's real contamination guard rejects overlapping supplied training IDs
  before agent execution. Unique training IDs are also required.
- These are public integration holdouts, not hidden benchmarks. No fitting,
  training-data export, model training, generated semantic embeddings or LLM call
  occurs. A caller's claimed training-ID list cannot prove an external model was
  never exposed to these cases. No model-quality or cost improvement is claimed.
- Weight EFT calls one metric `cheapResolveRate`; here it describes deterministic
  local workers, not a cheap language model or an evaluated escalation cascade.
  Provider cost is zero; infrastructure cost is not measured.
- Evidence hashes identify bytes but do not authenticate them. The offline
  evaluator checks evidence consistency, not the provenance of arbitrary supplied
  objects. `accepted` means the fixed integration cases passed, never promotion
  authority; `promotionAllowed` remains false. Existing independent evaluation,
  security, signing and release gates remain unchanged.
- All [agent-memory](persistent-agent-memory-v1.md) and
  [persistence](persistent-memory-v2.md) limitations still apply:
  trusted cooperating local writers, namespace routing rather than authorization,
  no arbitrary-worker sandbox and no power-loss or cross-platform durability claim.

Rollback removes this starter, evaluator, installed test and registry entry and
restores the previous CI/default check count. It does not change npm dependencies,
published packages or consumer data. Earlier payload and memory receipts remain
the fixed and last accepted references; repeated passes are retained evidence,
not additional gains. See `data/ecosystem-heldout-evaluation.validation.json`.
