---
name: market
description: Market data operations — ingest feeds, detect patterns, and search historical data
---

Market data commands:

**`market ingest <symbol> [--period 1D]`** -- Ingest and normalize market data for the given symbol.
1. Fetch OHLCV data for `<symbol>` from the configured data source
2. Normalize: open/high/low/close as relative percentages, volume as Z-score
3. Vectorize each candle to a 64-dimension padded vector
4. Store normalized data via `mcp__plugin_ruflo-core_ruflo__memory_store --namespace market-data` (the `memory_*` family is namespace-routed; `agentdb_hierarchical-*` routes by tier and ignores namespace strings — see skills/market-ingest/SKILL.md)
5. Add vectors to HNSW index via `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add`
6. Report: candles ingested, date range, min/max/avg price, volume profile

**`market patterns <symbol>`** -- Detect candlestick patterns in recent data.
1. Recall recent OHLCV data for `<symbol>` from the `market-data` namespace
2. Scan for single-candle patterns (doji, hammer) and multi-candle patterns (engulfing, morning star)
3. Classify each detection with pattern name, type (reversal/continuation), and reliability score
4. Store detected patterns via the dual-path pattern (see skills/market-pattern/SKILL.md): `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store` (typed, ReasoningBank-routed — do NOT pass `namespace`) AND `mcp__plugin_ruflo-core_ruflo__memory_store --namespace market-patterns` (namespace-routed; `agentdb_pattern-*` ignores namespace strings)
5. Display: pattern name, date, direction (bullish/bearish), reliability, candle range

**`market search <pattern-name>`** -- Search for historical occurrences of a pattern.
1. Search HNSW index via `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_route` for vectors matching the pattern
2. Recall matching entries from `market-patterns` namespace
3. Rank by similarity score and recency
4. Display: symbol, date, pattern match score, subsequent price action (if available)

**`market history <symbol>`** -- Show ingestion history and data coverage.
1. Query `market-data` namespace for all entries matching `<symbol>`
2. Compute: total candles stored, date range, gaps in coverage
3. Show data freshness (last ingestion timestamp)
4. List detected patterns count by type

**`market compare <sym1> <sym2>`** -- Compare pattern profiles between two symbols.
1. Recall pattern data for both symbols from `market-patterns` namespace
2. Compute correlation: shared pattern types, timing overlap, direction agreement
3. Display side-by-side comparison with pattern frequency and reliability differences
4. Highlight divergences that may indicate trading opportunities
