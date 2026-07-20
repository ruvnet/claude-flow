---
name: neural
description: Neural pattern training, prediction, compression, and pipeline optimization
---

Neural system commands — dispatch by subcommand parsed from the user's input:

1. **train** — `mcp__plugin_ruflo-core_ruflo__neural_train` with `--pattern-type` (`coordination|edit|task`) and `--epochs N`.
2. **status** — `mcp__plugin_ruflo-core_ruflo__neural_status` (SONA + MoE state, active patterns, training in flight).
3. **patterns** — `mcp__plugin_ruflo-core_ruflo__neural_patterns` to list learned patterns; supports `--list` and `--filter`.
4. **predict** — `mcp__plugin_ruflo-core_ruflo__neural_predict` with `--input "<task description>"` to get a predicted outcome.
5. **optimize** — `mcp__plugin_ruflo-core_ruflo__neural_optimize` to retune the pipeline based on recent outcomes.
6. **compress** — `mcp__plugin_ruflo-core_ruflo__neural_compress` to compact stored patterns (storage efficiency, runs after consolidation).

Present results clearly. For `train`, surface the loss curve summary; for `predict`, show the predicted agent + confidence; for `optimize`/`compress`, show before/after counts.
