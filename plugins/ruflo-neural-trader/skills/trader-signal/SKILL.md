---
name: trader-signal
description: Generate trading signals using npx neural-trader anomaly detection engine with Z-score scoring and neural prediction
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_delete mcp__plugin_ruflo-core_ruflo__neural_predict mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search
argument-hint: "[--strategy NAME] [--symbols AAPL,MSFT]"
---
Generate trading signals using neural-trader's anomaly detection engine.

Steps:
1. Ensure neural-trader is available:
   `npm ls neural-trader 2>/dev/null || npm install --ignore-scripts neural-trader`
2. Scan for signals:
   ```bash
   npx neural-trader --signal scan --symbols <TICKERS>
   ```
   With a specific strategy:
   ```bash
   npx neural-trader --signal scan --strategy <name> --symbols <TICKERS>
   ```
3. If --strategy specified, load strategy filters:
   `mcp__plugin_ruflo-core_ruflo__memory_retrieve({ key: "strategy-NAME", namespace: "trading-strategies" })`
4. neural-trader classifies anomalies automatically:
   - **spike** (maxZ > 5): breakout — momentum entry or mean-reversion fade
   - **drift** (sustained high Z): trend forming — trend-following signal
   - **flatline** (low Z): consolidation — prepare for breakout
   - **oscillation** (alternating): range-bound — mean-reversion at extremes
   - **pattern-break** (multiple dims): regime change — close and reassess
   - **cluster-outlier** (>50% dims): multi-factor dislocation — arbitrage
5. Use SONA for regime prediction:
   `mcp__plugin_ruflo-core_ruflo__neural_predict({ input: "anomaly types: [DETECTED], scores: [SCORES]" })`
6. Search historical pattern matches:
   `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search({ query: "ANOMALY_TYPE score RANGE", namespace: "trading-signals" })`
7. Present ranked signals: instrument, direction, confidence, anomaly type, entry/stop/target
8. Store signals with a 24-hour TTL (intraday signals shouldn't pollute long-running memory; the `MemoryConsolidator.sweepExpired()` pass introduced in ADR-125 Phase 4 — shipped in `@claude-flow/memory@3.0.0-alpha.18` — sweeps them out after they expire):
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "signal-TIMESTAMP", value: "SIGNALS_JSON", namespace: "trading-signals", expiresAt: Date.now() + 24 * 60 * 60 * 1000 })`
