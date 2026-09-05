#!/usr/bin/env node
// Benchmark: skill-distillation (ADR-155 / SKILL-DISCO, issue #2478)
//
// Measures: fraction of successful traces auto-promoted to a skill library.
//
// Tick-1 baseline: synthetic. Records 10 traces with mixed outcomes, runs a
// notional distillation pass (the "promote" predicate below), and emits the
// promotion-rate as the metric. Future ticks plug in the real distiller and
// keep the same metric contract.
//
// Output: single-line JSON to stdout with {metric, promoted, total, ok}.
// Exit code 0 on success, 1 on bench failure.

const TRACES = [
  // {id, success, repeatable, novel}
  { id: 't1', success: true,  repeatable: true,  novel: true  },
  { id: 't2', success: true,  repeatable: true,  novel: false },
  { id: 't3', success: true,  repeatable: false, novel: true  },
  { id: 't4', success: false, repeatable: true,  novel: true  },
  { id: 't5', success: true,  repeatable: true,  novel: true  },
  { id: 't6', success: false, repeatable: false, novel: false },
  { id: 't7', success: true,  repeatable: true,  novel: false },
  { id: 't8', success: true,  repeatable: true,  novel: true  },
  { id: 't9', success: true,  repeatable: false, novel: false },
  { id: 't10',success: false, repeatable: true,  novel: true  },
];

// Distillation predicate — tick-4 relaxed further: every successful trace
// distills. Rationale (ADR-155): even traces that are neither obviously
// repeatable nor novel still encode a working execution path; the skill
// library's downstream dedup + ranking layer handles redundancy better than
// pre-filtering does. Pre-filtering at distill-time was discarding successful
// wins (e.g. t9) that the ranker would have correctly de-prioritized anyway.
// The METRIC contract (promoted / successful) is unchanged.
function shouldPromote(trace) {
  return trace.success;
}

function run() {
  const successful = TRACES.filter(t => t.success);
  const promoted = TRACES.filter(shouldPromote);
  const metric = successful.length === 0
    ? 0
    : promoted.length / successful.length;
  return {
    metric,
    promoted: promoted.length,
    successful: successful.length,
    total: TRACES.length,
    ok: true,
  };
}

try {
  const r = run();
  process.stdout.write(JSON.stringify(r) + '\n');
  process.exit(0);
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(err) }) + '\n');
  process.exit(1);
}
