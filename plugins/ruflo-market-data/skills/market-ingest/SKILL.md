---
name: market-ingest
description: Ingest and normalize market data into OHLCV vectors with HNSW indexing
argument-hint: "<symbol> [--source api]"
allowed-tools: Bash mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_create mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add mcp__plugin_ruflo-core_ruflo__embeddings_generate
---

# Market Ingest

Fetch market data for a symbol, normalize to OHLCV vectors, and store with HNSW indexing for fast pattern search.

## When to use

When you need to ingest raw market data (price and volume) for a symbol and prepare it for pattern detection and similarity search. This is the first step before running pattern detection or comparison.

## Steps

1. **Fetch data** -- retrieve OHLCV data for the symbol from the configured data source (REST API, CSV file, or manual input)
2. **Normalize** -- convert raw prices to relative values:
   - Open: `(open - prev_close) / prev_close`
   - High: `(high - open) / open`
   - Low: `(low - open) / open`
   - Close: `(close - open) / open`
   - Volume: Z-score against rolling mean/std
3. **Vectorize** -- encode each candle as a 64-dimension padded vector (5 normalized OHLCV values + padding). For semantic embeddings of pattern descriptions, use `mcp__plugin_ruflo-core_ruflo__embeddings_generate` (NOT `embeddings_embed` — that tool name does not exist).
4. **Store** -- call `mcp__plugin_ruflo-core_ruflo__memory_store --namespace market-data` to persist normalized OHLCV data with symbol+date keys. The `memory_*` tool family routes by namespace; the `agentdb_hierarchical-*` family routes by tier (`working|episodic|semantic`) and ignores namespace strings, so use `memory_*` here.
5. **Index** -- call `mcp__plugin_ruflo-core_ruflo__ruvllm_hnsw_add` to add vectors to the HNSW index for nearest-neighbor search.
6. **Report** -- summarize: candles ingested, date range, price range, average volume

## CLI alternative

```bash
npx @claude-flow/cli@latest memory store --namespace market-data --key "symbol-SYMBOL-DATE" --value "OHLCV_JSON"
```
