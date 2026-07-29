---
name: performance-analysis
description: >
  Performance profiling, benchmarking, and optimization.
  Use when: slow operations, regressions, memory pressure, release validation.
  Skip when: early prototyping, documentation, configuration-only changes.
---

# Performance Analysis Skill

## Purpose
Measure before optimizing and preserve reproducible benchmark evidence.

## Commands

### Run Benchmark Suite

```bash
npx @claude-flow/cli performance benchmark --suite all
```

### Profile Code

```bash
npx @claude-flow/cli performance profile --target ./src
```

## Best Practices
1. Capture a baseline before changing code
2. Use identical inputs and environments
3. Report variance, not only the fastest result
4. Re-run correctness tests after optimization
