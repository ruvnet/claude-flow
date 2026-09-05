# ruflo-neural-trader

Neural trading strategies powered by [`neural-trader`](https://www.npmjs.com/package/neural-trader) (v2.7+) — self-learning LSTM/Transformer/N-BEATS models, Rust/NAPI backtesting (8-19x faster), 112+ MCP tools, swarm coordination, and portfolio optimization.

## Overview

Wraps the `neural-trader` npm package as a Ruflo plugin with 4 specialized agents, 9 skills, and comprehensive CLI commands. Adds AgentDB memory persistence, SONA trajectory learning, and swarm-coordinated execution on top of neural-trader's Rust/NAPI engine.

Heavy jobs — multi-year walk-forward backtests, large Monte-Carlo runs, parameter sweeps, LSTM/Transformer/N-BEATS training — can be dispatched to an Anthropic Managed Agent **cloud container** instead of running locally: see the `trader-cloud-backtest` skill, the `/trader cloud <backtest|train|sweep>` command, and [ADR-117](../../v3/docs/adr/ADR-117-neural-trader-managed-agent-backtests.md) (built on the `managed_agent_*` runtime from the `ruflo-agent` plugin / [ADR-115](../../v3/docs/adr/ADR-115-managed-agents-rvagent-backend.md); needs `ANTHROPIC_API_KEY` + Managed Agents beta — degrades to the local `trader-backtest` skill without it).

## Prerequisites

> ✅ **`neural-trader@^2.8.11`** (shipped 2026-05-14; see [post-mortem gist](https://gist.github.com/ruvnet/a1aca90a5c299d89fa92e905dab11041) and [announcement #1981](https://github.com/ruvnet/ruflo/issues/1981)).
> Resolves four compounding bugs that made the package unusable since v2.5.0:
> 1. Install-hook fork-bomb (#1974 — 120 GB RAM on Apple Silicon) — fixed in 2.7.2 ([neural-trader#109](https://github.com/ruvnet/neural-trader/pull/109)).
> 2. `require('neural-trader')` always threw `Cannot find module './src/cli/lib/napi-loader-shared'` — missing files restored in 2.7.5 ([neural-trader#111](https://github.com/ruvnet/neural-trader/pull/111)).
> 3. `cargo build` aborted on `aarch64-apple-darwin` (`fasthash-sys` x86-only SIMD) — placeholder hash replaced with stdlib `DefaultHasher` in 2.7.5.
> 4. npm tarball claimed 5 platform binaries, shipped 1 — `darwin-arm64` + `darwin-x64` added in 2.7.6.
>
> The 2.8.x line additionally adds a flag-style CLI dispatcher (`--backtest`, `--signal scan`, `--risk assess`, `--portfolio optimize`, `--regime`, `--train`, `--predict`, `--strategy-create`) running real math (SMA crossover / RSI mean-reversion / pairs z-score / adaptive regime-switching / multi-indicator RSI+MACD+Bollinger) against real Yahoo Finance data via `--live`. Supports `--walk-forward`, `--monte-carlo`, `--symbols A,B,C`, `--benchmark SPY`, `--optimize --param "name:min:max:step"`. The runtime smoke ([scripts/runtime-smoke.sh](scripts/runtime-smoke.sh)) covers 20 documented entry points end-to-end (basic commands + Kelly + walk-forward + Monte Carlo + optimize + multi-symbol + pairs + adaptive + multi-indicator).

```bash
# Recommended — keeps --ignore-scripts as defense in depth. The install
# hook is safe in 2.7.2+, but --ignore-scripts protects against any
# future install-script regression on this or transitive packages.
npm install --ignore-scripts neural-trader@^2.8.11
```

| Platform | Native binding in 2.8.11 |
|----------|--------------------------|
| `linux-x64-gnu` | ✅ |
| `darwin-arm64` (Apple Silicon) | ✅ first shipped in 2.7.5 |
| `darwin-x64` (Intel Macs) | ✅ first shipped in 2.7.6 |
| `linux-arm64-gnu` | ⏳ JS surface works, native calls throw at runtime |
| `win32-x64-msvc` | ⏳ JS surface works, native calls throw at runtime |

> 🚨 **If you must use an older version** (`neural-trader@2.7.1` or below — same fork-bomb risk on every non-linux-x64 host) always pass `--ignore-scripts` to skip the malicious install hook. The `linux-x64` binary is hardcoded inline in the tarball, so on `linux-x64` the package still works after `--ignore-scripts`. On other platforms `--ignore-scripts` at least won't fork-bomb your machine.
>
> ```bash
> # Only needed for neural-trader <= 2.7.1 — DO NOT run plain `npm install
> # neural-trader@<=2.7.1` on macOS / Windows / linux-arm64.
> npm install --ignore-scripts neural-trader@<=2.7.1
> ```

The `audit-neural-trader-safety.mjs` CI guard in this repo still enforces `--ignore-scripts` on every documented invocation — defense in depth in case anyone pins to an older version in a lockfile.

## Installation

```bash
claude --plugin-dir plugins/ruflo-neural-trader
```

## MCP Integration (112+ Tools)

neural-trader exposes 112+ MCP tools for direct Claude Desktop access:

```bash
claude mcp add neural-trader -- npx neural-trader mcp start
```

## Agents

| Agent | Model | Role |
|-------|-------|------|
| `trading-strategist` | opus | Strategy design, LSTM/Transformer training, Z-score anomaly detection, backtest orchestration |
| `risk-analyst` | sonnet | VaR/CVaR assessment, Kelly criterion sizing, circuit breakers, correlation monitoring |
| `market-analyst` | sonnet | Regime detection, technical indicators (RSI/MACD/Bollinger), sector analysis, correlation |
| `backtest-engineer` | sonnet | Walk-forward validation, Monte Carlo simulation, parameter optimization, benchmark comparison |

## Skills

| Skill | Usage | Description |
|-------|-------|-------------|
| `trader-backtest` | `/trader-backtest <strategy> --symbol SPY` | Rust/NAPI backtest with walk-forward validation |
| `trader-signal` | `/trader-signal [--strategy NAME]` | Z-score anomaly detection signal generation |
| `trader-portfolio` | `/trader-portfolio [--risk-target 0.15]` | Mean-variance portfolio optimization |
| `trader-regime` | `/trader-regime [--symbol SPY]` | Market regime detection and classification |
| `trader-train` | `/trader-train lstm --symbol TSLA` | Train neural prediction models |
| `trader-risk` | `/trader-risk [--symbol AAPL]` | VaR, position sizing, circuit breaker status |
| `trader-cloud-backtest` | `/trader cloud backtest <strategy> --symbol SPY` | Dispatch a heavy backtest / training / sweep to an Anthropic Managed Agent cloud container ([ADR-117](../../v3/docs/adr/ADR-117-neural-trader-managed-agent-backtests.md)) |
| `trader-explain` | `/trader-explain --signal <id>` | Regulator-grade feature attribution for LSTM/Transformer signals via single-entry PageRank (ADR-126 Phase 6 / ADR-123) |
| `trader-portfolio-cg` | `/trader-portfolio-cg [--risk-target 0.15]` | Mean-variance portfolio optimization via Conjugate Gradient — 40-60× faster than the legacy Neumann path (ADR-126 Phase 3 / ADR-123 Wedge 8) |
| `trader-portfolio-cg` | `/trader-portfolio-cg [--portfolio-id ID]` | Conjugate-Gradient mean-variance solve via `mcp__ruflo-sublinear__solve` — 40-60× faster than the legacy Neumann path ([ADR-126 Phase 3](../../v3/docs/adr/ADR-126-neural-trader-substrate-integration.md), [ADR-123 Wedge 8](../../v3/docs/adr/ADR-123-sublinear-integration.md)) |
| `trader-explain` | `/trader-explain <signalId> [--top-k 10] [--seed 42]` | Regulator-grade feature attribution via single-entry PageRank — ranks the top-K features that drove an LSTM/Transformer signal; reproducible across runs ([ADR-126 Phase 6](../../v3/docs/adr/ADR-126-neural-trader-substrate-integration.md)) |

## Commands

```bash
# Strategy management
trader strategy create <name> --type <momentum|mean-reversion|pairs|adaptive>
trader backtest <strategy> --symbol <TICKER> --period <range>

# Neural model training
trader train <lstm|transformer|nbeats> --symbol <TICKER>

# Signal generation
trader signal scan [--strategy <name>] [--symbols <TICKERS>]

# Market analysis
trader regime --symbol <TICKER>
trader indicators --symbol <TICKER> --indicators rsi,macd,bollinger
trader correlation --symbols <TICKERS> --window 30d

# Risk & portfolio
trader risk assess [--symbol <TICKER>]
trader portfolio optimize [--risk-target <number>]

# Live trading
trader live --broker <name> [--swarm enabled]

# History
trader history
```

## Neural Models (via neural-trader)

| Model | Type | Use Case |
|-------|------|----------|
| LSTM | Recurrent | Sequence prediction, price forecasting |
| Transformer | Attention | Multi-variate pattern recognition |
| N-BEATS | Decomposition | Trend/seasonality decomposition |

```bash
npx neural-trader --model lstm --symbol TSLA --confidence 0.95
npx neural-trader --model transformer --symbol BTC-USD --predict
npx neural-trader --model nbeats --symbol SPY --decompose
```

## Strategy Types

| Strategy | CLI Flag | Entry Logic |
|----------|----------|-------------|
| Momentum | `--strategy momentum` | RSI + MACD confirmation |
| Mean-reversion | `--strategy mean-reversion` | Z-score > 2.0, Bollinger extremes |
| Pairs trading | `--strategy pairs` | Cointegration spread divergence |
| Multi-indicator | `--strategy multi-indicator` | RSI + MACD + Bollinger combined |
| Adaptive | `--strategy adaptive` | Auto-switches by regime |

## Market Regime Detection

| Regime | Indicators | Recommended Strategy |
|--------|-----------|---------------------|
| Bull trending | ADX > 25, price > 200 SMA | Momentum, trend-following |
| Bear trending | ADX > 25, price < 200 SMA | Short momentum, hedging |
| Ranging | ADX < 20, Bollinger squeeze | Mean-reversion |
| High volatility | VIX > 25, ATR expanding | Reduce size, widen stops |
| Transitioning | Divergences forming | Wait for confirmation |

## Anomaly Detection

neural-trader Z-score composite scoring on OHLCV: `anomalyScore = min(1, meanZ / 3)`

| Type | Detection | Market Interpretation |
|------|-----------|----------------------|
| spike | maxZ > 5 | Breakout / gap |
| drift | 1-2 dims sustained | Sustained trend |
| flatline | all near zero | Consolidation |
| oscillation | alternating | Range-bound |
| pattern-break | moderate Z, multi-dim | Regime change |
| cluster-outlier | >50% dims high | Multi-factor dislocation |

## Circuit Breakers

| Breaker | Trigger | Action |
|---------|---------|--------|
| Daily loss | Drawdown > 3%/day | Halt new entries |
| Weekly loss | Drawdown > 5%/week | Reduce sizes 50% |
| Correlation spike | Portfolio corr > 0.85 | Reduce correlated positions |
| Volatility regime | VIX > 2x historical | Minimum position sizes |
| Max positions | Open > limit | Block new entries |
| Concentration | Any position > 10% | Force trim |

## Backtesting Features

| Feature | Command |
|---------|---------|
| Walk-forward | `--walk-forward --train-window 6M --test-window 1M` |
| Monte Carlo | `--monte-carlo --simulations 1000` |
| Parameter optimization | `--optimize --param "entry_z:1.5:3.0:0.25"` |
| Multi-symbol | `--symbols "AAPL,MSFT,GOOGL"` |
| Benchmark comparison | `--benchmark SPY` |

## Performance

neural-trader uses Rust/NAPI bindings for zero-overhead performance:
- **8-19x faster** than Python equivalents
- **Sub-200ms** order execution and risk checks
- **WASM/SIMD** acceleration available
- **52,000+ inserts/sec** for market data

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Runtime:** `npx neural-trader` (Rust/NAPI bindings — 112+ MCP tools).
- **Verification:** `bash plugins/ruflo-neural-trader/scripts/smoke.sh` is the contract.

## Namespace coordination

This plugin owns five AgentDB namespaces (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). The canonical five-namespace set is defined by [ADR-126](../../v3/docs/adr/ADR-126-neural-trader-substrate-integration.md) Phase 1:

| Namespace | Purpose |
|-----------|---------|
| `trading-strategies` | Strategy definitions, parameters, regime-condition mappings (loaded by `trader-backtest`, `trader-signal`) |
| `trading-backtests` | Historical backtest results indexed by strategy + timestamp (long-lived; signed in ADR-126 Phase 4) |
| `trading-risk` | Risk model state, VaR/CVaR snapshots, circuit-breaker triggers |
| `trading-analysis` | Market-analyst output — regime classifications, technical-indicator summaries, model-training results |
| `trading-signals` | Short-lived signal events (intraday; TTL applied in ADR-126 Phase 2) |

Note: the namespace prefix is `trading-` (the actual intent) rather than `neural-trader-` (the plugin stem). This is a deliberate ergonomic choice — `trading` is the load-bearing concern downstream consumers reason about. Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

All access via `memory_*` (namespace-routed). No `agentdb_hierarchical-*` or `agentdb_pattern-store` with namespace arguments — the plugin uses the correct routing throughout.

### Memory lifecycle (ADR-125 integration)

This plugin relies on `@claude-flow/memory@3.0.0-alpha.18` for the lifecycle guarantees defined in [ADR-125](../../v3/docs/adr/ADR-125-memory-consolidation.md) and wired by [ADR-126 Phase 2](../../v3/docs/adr/ADR-126-neural-trader-substrate-integration.md):

- **Warm HNSW restart** — `@claude-flow/memory@3.0.0-alpha.18` (ADR-125 Phase 3) snapshots the HNSW index to a `.hnsw` sidecar file, so neural-trader process restarts no longer rebuild the strategy / regime similarity index from scratch. No plugin-side change is required to benefit; routing is automatic through `MemoryService.search()`.
- **Hybrid retrieval (RRF + MMR)** — `market-analyst` regime-similarity queries automatically become hybrid (dense ANN + sparse FTS5 keyword, reciprocal-rank-fused and MMR-diversified) via the same `MemoryService.search()` path (ADR-125 Phase 5). When the embedding generator is unavailable, retrieval gracefully degrades to keyword-only rather than throwing.
- **Signal TTL (24h)** — `trader-signal` writes to `trading-signals` with `expiresAt: now + 24h`. The `MemoryConsolidator.sweepExpired()` pass (ADR-125 Phase 4) removes them from all indexes — including HNSW — when they expire. Long-running ruflo sessions no longer accumulate stale intraday signals.
- **Backtest dedup** — `trader-backtest` proactively deletes prior entries for the same `(strategyId, paramsHash)` before storing a fresh one. The same outcome is also produced asynchronously by the `MemoryConsolidator.dedup('keep-newest')` background pass that runs every 6 hours.
- **Consolidator schedule** — the consolidator runs every 6 hours by default (`sweepExpired` + `dedup` + `compactHnsw`), and also on `MemoryService.close()`. No plugin-side wiring is required.

### Portfolio CG path (ADR-126 Phase 3 / ADR-123 Wedge 8)

The new `trader-portfolio-cg` skill solves the mean-variance problem `Σ · x = μ` via Conjugate Gradient instead of the legacy Neumann series. CG is provably optimal for symmetric positive-definite inputs (covariance matrices are SPD by construction), and the upstream `sublinear-time-solver@1.7.0` benchmark shows **~816 ns CG vs ~50 µs Neumann at n=256 — a measured 40-60× speedup** ([ADR-123 §162 Row 8](../../v3/docs/adr/ADR-123-sublinear-integration.md)).

**When it's used**: any time the team wants optimal portfolio weights — call `/trader-portfolio-cg` instead of `/trader-portfolio`. The skill reads the current covariance and expected-return vector from `npx neural-trader --portfolio current --json`, dispatches to `mcp__ruflo-sublinear__solve` (when the `ruflo-sublinear` plugin is registered), and writes weights with provenance metadata (`method: 'cg-sublinear' | 'cg-local' | 'neumann-fallback'`) to the `trading-risk` namespace.

**How to disable**: set `RUFLO_NEURAL_TRADER_DISABLE_CG=1` to skip the CG path entirely and fall back to the legacy `npx neural-trader --portfolio optimize` route. Useful for A/B validation or when an upstream covariance regression breaks SPD.

**Parity guarantee**: `||cg_solution − neumann_solution||_∞ < 1e-4` on every benchmark seed — verified by `benchmarks/portfolio-cg.bench.mjs` and asserted by `scripts/smoke-neural-trader-portfolio-cg.mjs`.

**Local fallback**: the adapter (`src/sublinear-adapter.ts` + `.mjs` mirror) ships a self-contained ~50-LOC CG kernel so the skill works even before the `ruflo-sublinear` plugin lands on the IPFS registry. The same call site picks up the full native-WASM speedup automatically once `mcp__ruflo-sublinear__solve` is registered in the runtime.

```bash
# Run the bench yourself:
node plugins/ruflo-neural-trader/benchmarks/portfolio-cg.bench.mjs

# Run the contract smoke:
node scripts/smoke-neural-trader-portfolio-cg.mjs
```

### Feature attribution (ADR-126 Phase 6 / ADR-123 single-entry PR)

The new `trader-explain` skill closes the regulator-grade interpretability gap that LSTM / Transformer trading signals leave by default. Given a `signalId`, it builds a feature-contribution graph (nodes = features, edges = co-attention weights, source = signal output) and runs **single-entry forward-push PageRank** to produce a top-K ranked list of the features that most influenced the model's prediction.

**When to use it**: any time a trading signal needs an audit trail — pre-trade risk review, regulator filings under the EU AI Act (Article 13 — transparency for high-risk AI) or SEC Reg-AI interpretability guidance, post-mortem of a stop-loss event, or input to the `risk-analyst` before a paper→live promotion. Call `/trader-explain <signalId>` (or pass `--top-k 10 --seed 42` to control ranking depth + reproducibility).

**Output**: a `SignedAttributionArtifact` written to the canonical `trading-analysis` namespace, plus a markdown summary surfaced to the agent. The artifact is Ed25519-signed using the same scheme as Phase 4 backtest artifacts — the verifier pins to a trusted public key (CWE-347 / #1922), so downstream consumers can refuse any tampered or unsigned artifact.

```ts
// Schema — plugins/ruflo-neural-trader/src/signed-attribution.ts
interface SignedAttributionArtifact {
  schema: 'ruflo-neural-trader-attribution/v1';
  signalId: string;
  modelId: string;                         // e.g. 'lstm-v3', 'transformer-attn8h-v2'
  features: Array<{
    name: string;                          // e.g. 'rsi_14', 'attention_head_3', 'price_close_t-7'
    score: number;                         // PageRank score in [0, 1]
    rank: number;                          // 1-indexed
  }>;
  graphMetadata: {
    nodeCount: number;
    edgeCount: number;
    pageRankIterations: number;
    seed: number;                          // load-bearing — same seed → same ordering
  };
  generatedAt: string;
  witnessPublicKey: string;
  witnessSignature: string;
}
```

Example markdown surfaced to the agent:

```
## Feature attribution for signal `sig-momentum-spy-20260519-001` (model: transformer-attn8h-v2)

| Rank | Feature              | Score |
|------|----------------------|-------|
| 1    | rsi_14               | 0.42  |
| 2    | attention_head_3     | 0.21  |
| 3    | price_close_t-7      | 0.13  |
| 4    | macd_signal          | 0.09  |

- PageRank iterations: 18
- Graph: 17 nodes, 42 edges
- Seed: 42 (reproducible — same seed → same ordering)
- Path: local | mcp
- Signature: ed25519:abcd…
```

**Reproducibility guarantee**: two runs with the same `signalId` + same `--seed` produce byte-identical rank ordering. Asserted by `scripts/smoke-neural-trader-feature-attribution.mjs` (the smoke runs the local seeded PageRank twice and compares scores element-wise).

**Local fallback**: when `mcp__ruflo-sublinear__page-rank-entry` is not registered in the runtime, the skill falls through to a ~30-LOC seeded power-iteration kernel that ships in `src/signed-attribution.mjs`. Same math, same ordering for the same seed. The native-WASM path picks up automatically once `ruflo-sublinear` lands on the IPFS registry.

**`--explain` fallback**: if the installed `neural-trader` build doesn't yet expose `--predict --explain --json`, the skill degrades to a z-score-magnitude heuristic over the signal's input vector and tags the artifact `attribution_method: "input-zscore-fallback"` so downstream consumers can filter it out for regulator-facing reports.

```bash
# Run the smoke yourself:
node scripts/smoke-neural-trader-feature-attribution.mjs
```

## Verification

```bash
bash plugins/ruflo-neural-trader/scripts/smoke.sh
# Expected: "11 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-neural-trader plugin contract (already-compliant namespaces, 4-namespace claim, smoke as contract)](./docs/adrs/0001-neural-trader-contract.md)
- [`ADR-117`](../../v3/docs/adr/ADR-117-neural-trader-managed-agent-backtests.md) — run heavy jobs (walk-forward / Monte-Carlo / sweep / training) on the Managed Agent cloud runtime (the `trader-cloud-backtest` skill + `/trader cloud` command), with cost-optimization rules
- [`ADR-115`](../../v3/docs/adr/ADR-115-managed-agents-rvagent-backend.md) — the `managed_agent_*` cloud runtime that ADR-117 builds on (lives in the `ruflo-agent` plugin)

## Related Plugins

- `ruflo-agent` — the `managed_agent_*` cloud agent runtime used by the `trader-cloud-backtest` skill (ADR-115 / ADR-117)
- `ruflo-agentdb` — namespace convention owner; backing store
- `ruflo-market-data` — OHLCV data ingestion and candlestick pattern detection (feeds `trading-strategies`)
- `ruflo-ruvector` — HNSW indexing for strategy pattern similarity search
- `ruflo-cost-tracker` — PnL tracking and cost attribution
- `ruflo-observability` — Strategy performance dashboards

## License

MIT
