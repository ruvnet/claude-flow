---
name: harness-gepa
description: Inspect and audit GEPA genomes via the `@metaharness/darwin/gepa` library entry (darwin 0.8.0) — load/validate a genome (default: the shipped cand-6 promotion), render the system prompt a genome compiles to, or classify failure modes in a run transcript. The `gepaOptimize` loop itself is library-only (bring your own evaluator) and not surfaced here — use `harness-evolve` for sandbox-scored evolution. Degrades gracefully when @metaharness/darwin is absent.
argument-hint: "--op genome|validate|render|analyze [--path <genome.json>] [--transcript <t.json>] [--alert-on-invalid]"
allowed-tools: Bash
---

Surfaces the GEPA (genetic-evolution prompt-adaptation) *library* exports
from `@metaharness/darwin/gepa`. Unlike the other skills in this plugin
there is no CLI binary behind this — the script dynamic-imports the library
(local resolution first, versioned cache install as fallback) and calls the
subprocess-safe subset.

## When to use

- **Adopting an evolved policy**: `--op render` shows the actual system
  prompt a genome compiles to — read THAT, not the raw JSON, before
  wiring a genome into a harness.
- **Auditing a promotion**: `--op genome` loads + validates the shipped
  cand-6 genome (first holdout-confirmed cheap-tier promotion; provenance
  ships in the package) or any genome file you point at.
- **CI gate on genome edits**: `--op validate --alert-on-invalid` exits 1
  on structural errors.
- **Debugging a bad run**: `--op analyze --transcript run.json` classifies
  failure modes (GEPA's failure-class taxonomy) from a transcript array.

## What is deliberately NOT here

`gepaOptimize` — the optimization loop takes an in-process
`evaluate(candidate)` callback ("bring your own evaluator") that cannot
cross a subprocess boundary. Two supported paths instead:

1. **Library consumers**: `import { gepaOptimize, loadCand6Genome } from '@metaharness/darwin/gepa'`
2. **Sandbox-scored evolution**: `harness-evolve` (darwin CLI `evolve`),
   which pairs GEPA with its own sandbox evaluators.

## Algorithm

Implementation: [`scripts/gepa.mjs`](../../scripts/gepa.mjs).

1. `import('@metaharness/darwin/gepa')`; on MODULE_NOT_FOUND fall back to a
   one-time `npm install --prefix ~/.ruflo/darwin-cache-0.8.0` and import
   the cached `dist/gepa/index.js` (versioned dir → pin bumps invalidate).
2. Dispatch `--op`:
   - `genome`  → `loadGenome(fs, path)` or `loadCand6Genome()` + `validateGenome`
   - `validate` → `validateGenome(rawJson)` (raw parse so broken files reach
     the validator instead of throwing in the loader)
   - `render`  → `buildSystemFromGenome(genome, ext?, glob?)`
   - `analyze` → `analyzeTranscript(entries)`
3. Emit one JSON object; exit 0 (or 1 under `--alert-on-invalid`, 2 on bad input).

## Examples

```bash
node scripts/gepa.mjs --op genome                          # cand-6 + validation
node scripts/gepa.mjs --op render | jq -r .system         # what does cand-6 SAY?
node scripts/gepa.mjs --op validate --path my-genome.json --alert-on-invalid
node scripts/gepa.mjs --op analyze --transcript run.json
```

## Exit codes

- `0` — op completed (or degraded — darwin not installable)
- `1` — `--alert-on-invalid` and validation found errors
- `2` — config error (unknown op, missing/broken input file)
