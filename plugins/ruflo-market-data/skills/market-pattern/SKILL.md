---
name: market-pattern
description: Detect and classify candlestick patterns from ingested OHLCV data
argument-hint: "<symbol> [--period 1D]"
allowed-tools: mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_list mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_route Bash
---

# Market Pattern

Scan ingested OHLCV data for known candlestick patterns, classify them by type and reliability, and store for future reference.

## When to use

When you need to identify candlestick patterns (doji, hammer, engulfing, head-shoulders, etc.) in market data. Requires data to be ingested first via `market-ingest`.

## Steps

1. **Load candles** -- call `mcp__plugin_ruflo-core_ruflo__memory_search` (or `memory_list`) on the `market-data` namespace to retrieve normalized OHLCV data for the symbol and period. The `memory_*` tool family routes by namespace; the `agentdb_hierarchical-*` family does NOT (it routes by tier), so use `memory_*` for namespaced reads.
2. **Scan for patterns** -- iterate through candle sequences looking for:
   - Single-candle: doji (open ~= close), hammer (long lower wick), inverted hammer
   - Two-candle: bullish/bearish engulfing
   - Three-candle: morning star, evening star, three white soldiers, three black crows
   - Multi-candle: head & shoulders, double top/bottom, cup & handle
3. **Classify** -- for each detection, assign: pattern name, type (reversal/continuation), direction (bullish/bearish), reliability score (0.0-1.0)
4. **Rank** -- sort by reliability score descending
5. **Store** -- two paths (per ruflo-cost-tracker ADR-0001 dual-path pattern):
   - **Pattern-store (typed, recommended)**: `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store` with `type: 'market-pattern'`. Don't pass a `namespace` arg — ReasoningBank routes it; on bridge unavailability the fallback writes to the reserved `pattern` namespace with `controller: 'memory-store-fallback'` (see ruflo-agentdb ADR-0001).
   - **Plain store (namespace-routable)**: `mcp__plugin_ruflo-core_ruflo__memory_store --namespace market-patterns` — this DOES respect the `market-patterns` namespace because `memory_*` is namespace-routed.
6. **Report** -- display: pattern name, date range, direction, reliability, suggested action

## CLI alternative

```bash
npx @claude-flow/cli@latest memory search --query "bullish reversal patterns" --namespace market-patterns
npx @claude-flow/cli@latest memory store --key "pattern-AAPL-2026-05-04-doji" --value '{...}' --namespace market-patterns
```
