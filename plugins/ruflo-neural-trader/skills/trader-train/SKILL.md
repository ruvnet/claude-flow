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
   npx neural-trader --model lstm --symbol TICKER --confidence 0.95
   npx neural-trader --model transformer --symbol TICKER --predict
   npx neural-trader --model nbeats --symbol TICKER --decompose
   ```
3. Review training output: loss curves, validation metrics, prediction accuracy
4. Generate predictions with confidence intervals:
   ```bash
   npx neural-trader --model MODEL --symbol TICKER --predict --horizon 5d
   ```
5. Compare model performance across types:
   ```bash
   npx neural-trader --model-compare --symbol TICKER --models "lstm,transformer,nbeats"
   ```
6. Store model results (canonical `trading-analysis` namespace per ADR-126 Phase 1 — was previously stored to undeclared `trading-models`):
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "model-MODEL-TICKER-DATE", value: "TRAINING_RESULTS", namespace: "trading-analysis" })`
7. Train SONA on model outcomes:
   `mcp__plugin_ruflo-core_ruflo__neural_train({ patternType: "trading-model", epochs: 10 })`
