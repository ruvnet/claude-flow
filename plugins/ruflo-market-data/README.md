# ruflo-market-data

Market data ingestion -- feed normalization, OHLCV vectorization, and candlestick pattern detection (read-only analysis, no order placement).

## Overview

Ingests market data from REST APIs and WebSocket feeds, normalizes to OHLCV vectors with consistent scaling, and vectorizes candlestick patterns for similarity search (use `ruflo-ruvector` for nearest-neighbour search over history; the built-in `ruvllm_hnsw_*` router holds only about 11 patterns). Detects single-candle (doji, hammer) and multi-candle (engulfing, morning star, head & shoulders) formations with reliability scoring.

## Installation

```bash
claude --plugin-dir plugins/ruflo-market-data
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `data-engineer` | sonnet | Ingest market feeds, normalize OHLCV, vectorize candlestick patterns, pattern matching |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `market-ingest` | `/market-ingest <symbol> [--source api]` | Ingest and normalize market data into OHLCV vectors stored by symbol and date |
| `market-pattern` | `/market-pattern <symbol> [--period 1D]` | Detect and classify candlestick patterns from ingested data |

## Commands (5 subcommands)

```bash
market ingest <symbol> [--period 1D]    # Ingest and normalize OHLCV data
market patterns <symbol>                 # Detect candlestick patterns
market search <pattern-name>             # Search historical pattern occurrences
market history <symbol>                  # Show ingestion history and data coverage
market compare <sym1> <sym2>             # Compare pattern profiles between symbols
```

## OHLCV Normalization

| Field | Normalization |
|-------|--------------|
| Open | Relative to previous close: `(open - prev_close) / prev_close` |
| High | Relative to open: `(high - open) / open` |
| Low | Relative to open: `(low - open) / open` |
| Close | Relative to open: `(close - open) / open` |
| Volume | Z-score: `(vol - mean_vol) / std_vol` |

## Pattern Library

| Pattern | Type | Candles | Reliability |
|---------|------|---------|-------------|
| Doji | Reversal | 1 | Medium |
| Hammer | Reversal | 1 | Medium-High |
| Engulfing | Reversal | 2 | High |
| Morning/Evening Star | Reversal | 3 | High |
| Three White Soldiers | Continuation | 3 | High |
| Head & Shoulders | Reversal | 5-7 | Very High |
| Double Top/Bottom | Reversal | Variable | High |

Each pattern is encoded as a 64-dimension padded vector.

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-market-data/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns two AgentDB namespaces (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)):

- `market-data` — normalized OHLCV vectors per symbol+date
- `market-patterns` — detected candlestick patterns with reliability scores

Both accessed via `memory_*` (namespace-routed). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

> **Routing note:** Earlier versions of these skills used `agentdb_hierarchical-*` and `agentdb_pattern-*` with namespace arguments — those tool families route by tier/ReasoningBank and ignore namespace strings. ADR-0001 fixed the skills to use `memory_*` for namespaced reads/writes.

## Verification

```bash
bash plugins/ruflo-market-data/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-market-data plugin contract (3 functional bug fixes + namespace coordination + smoke as contract)](./docs/adrs/0001-market-data-contract.md)

## Related Plugins

- `ruflo-agentdb` — namespace convention owner; defines the routing rules ADR-0001 fixes violations of
- `ruflo-neural-trader` -- Consumes market patterns as strategy signals
- `ruflo-ruvector` -- HNSW indexing engine for nearest-neighbour search over candle windows
- `ruflo-observability` -- Data feed health and ingestion latency dashboards

## License

MIT

## As a mod

This plugin ships a function-hook mod (ADR-445, `hooks/register.ts`). It makes no network call, spawns no process and makes no model call.

- **Guard** (tighten-only, on by default): Refuses writes to a `market*` namespace (`memory_store`, `agentdb_pattern-store`, `agentdb_hierarchical-store`, `ruvllm_hnsw_add`) that hold a key or token, or a feed URL with a credential in its query string or as `user:pass@host`. Other namespaces are untouched. A refusal never echoes the secret.
- **`/market-mod`**: `status`, `recent`, `tools` (which of this plugin's tools are connected) and `scan <text>` (would the guard refuse it). Answered locally.
- **Status file**: `.claude-flow/market-mod/status.json` (`{version: 1, updatedMs, guard, calls, total, blocked, recent}`, counters only, never tool input), written at session start and after every call to this plugin's tools.

Options (`userConfig`): `guard` (on).

Test it: `claude plugin validate plugins/ruflo-market-data`, `claude plugin test plugins/ruflo-market-data`, `bash plugins/ruflo-market-data/scripts/smoke.sh`.
