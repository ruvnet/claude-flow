---
name: trader-train
description: Train neural models (LSTM, Transformer, N-BEATS) on market data using npx neural-trader with confidence intervals
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__neural_train
argument-hint: "<lstm|transformer|nbeats> --symbol <TICKER>"
---
Train neural prediction models using neural-trader's ML engine.

Steps:
1. Ensure neural-trader is available:
   `npm ls neural-trader 2>/dev/null || npm install --ignore-scripts neural-trader`
2. Train the specified model:
   ```bash
   npx neural-trader --train --model lstm --symbol TICKER --epochs 50
   ```
   `--train` is required; `--model X --symbol T` alone is rejected ("Unknown command"), and `--confidence` and `--decompose` do not exist. In 2.8.11 the result carries `upstreamStub: true` ("neuralTrain returns a placeholder shape (no real LSTM/Transformer fit yet)"). Report that no model was fitted; never describe the output as a trained model or quote its numbers as accuracy.
3. Review training output: loss curves, validation metrics, prediction accuracy
4. Generate predictions with confidence intervals:
   ```bash
   npx neural-trader --predict --model MODEL --symbol TICKER [--gpu]
   ```
   `--horizon` is not supported, and `neuralPredict` is also a placeholder (`upstreamStub: true`) in 2.8.11.
5. Model comparison (`--model-compare`) does not exist in the CLI. Without a real fit there is nothing to compare; say so rather than fabricating a ranking.
6. Store model results (canonical `trading-analysis` namespace per ADR-126 Phase 1 — was previously stored to undeclared `trading-models`):
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "model-MODEL-TICKER-DATE", value: "TRAINING_RESULTS", namespace: "trading-analysis" })`
7. Train SONA on model outcomes:
   `mcp__plugin_ruflo-core_ruflo__neural_train({ modelType: "moe", epochs: 10 })` (`modelType` is required; there is no `patternType`). Skip this step when step 2 returned a stub, so placeholder runs do not train SONA.
