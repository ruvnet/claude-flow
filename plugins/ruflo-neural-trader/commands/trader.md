---
name: trader
description: Neural trading via npx neural-trader — strategies, backtesting, signals, risk, portfolio optimization
---
$ARGUMENTS
Manage neural trading strategies via the `neural-trader` npm package. Parse subcommand from $ARGUMENTS.

Usage: /trader <subcommand> [options]

Subcommands:
- `strategy create <name> --type <momentum|mean-reversion|pairs|adaptive>` -- Create a strategy
- `backtest <strategy> --symbol <TICKER> --period <range>` -- Run backtest (Rust/NAPI, 8-19x faster)
- `train <model> --symbol <TICKER>` -- Train neural model (lstm, transformer, nbeats)
- `signal scan [--strategy <name>]` -- Scan for trading signals via anomaly detection
- `risk assess [--symbol <TICKER>]` -- Calculate risk metrics (VaR, Sharpe, drawdown)
- `portfolio optimize [--risk-target <number>]` -- Optimize allocation via mean-variance
- `live --broker <name> [--swarm enabled]` -- NOT AVAILABLE with the pinned neural-trader 2.8.11 (see Steps); this plugin places no orders
- `history` -- View trade history and performance summary
- `cloud <backtest|train|sweep> <strategy-or-model> --symbol <TICKER> [--period 2020-2024] [--mc-paths 1000]` -- Run a HEAVY job (long walk-forward, big Monte-Carlo, parameter sweep, model training) on an Anthropic Managed Agent cloud container instead of locally. Needs `ANTHROPIC_API_KEY`. See the `trader-cloud-backtest` skill + ADR-117. (Cost: a cloud session bills container time + tokens until terminated — the skill installs neural-trader once, reuses the env, pre-flights cheap, terminates eagerly.)

Steps by subcommand:

**strategy create**:
1. Run: `npx neural-trader --strategy-create --name <NAME> --type <type> --symbol <TICKER>` (`--strategy <type> --create` is not a recognised form)
2. Store strategy config in memory:
   `npx @claude-flow/cli@latest memory store --key "strategy-NAME" --value "CONFIG" --namespace trading-strategies`

**backtest**:
1. Run: `npx neural-trader --backtest --strategy <name> --symbol <TICKER> --period <range> --walk-forward --live`
2. Check `dataSource` in the output: only `yahoo-finance` is real data; `synthetic` (the default without `--live`, and the silent fallback when the live fetch fails) is a demo. Capture Sharpe ratio, max drawdown, win rate, profit factor from output
3. Store results:
   `npx @claude-flow/cli@latest memory store --key "backtest-ID" --value "RESULTS" --namespace trading-backtests`
4. If Sharpe > 1.5, train SONA:
   `npx @claude-flow/cli@latest neural train --pattern prediction --epochs 10`

**train**:
1. Run: `npx neural-trader --train --model <lstm|transformer|nbeats> --symbol <TICKER> --epochs 50`
2. In 2.8.11 the result carries `upstreamStub: true` (placeholder, no model is fitted). Say so; do not report predictions or confidence intervals from it

**signal scan**:
1. Run: `npx neural-trader --signal scan --symbols <TICKERS> --live` (without `--live` the scan uses synthetic bars; check `dataSource`)
2. If --strategy specified, add `--strategy <name>`
3. Store signals:
   `npx @claude-flow/cli@latest memory store --key "signal-TIMESTAMP" --value "SIGNALS" --namespace trading-signals`

**risk assess**:
1. Run: `npx neural-trader --risk assess --returns <r1,r2,...> --portfolio-value <amount>` with returns derived from real data. `--symbol` is ignored, and with no `--returns` a built-in 7-value sample is used (a demo). `--var` and `--risk-tolerance` are not recognised
2. Position sizing: compute from a backtest's win rate and payoff (Kelly exists only inside `--backtest --position-sizing kelly`) and state the assumptions
3. Store assessment:
   `npx @claude-flow/cli@latest memory store --key "risk-ID" --value "METRICS" --namespace trading-risk`

**portfolio optimize**:
1. Run: `npx neural-trader --portfolio optimize --symbols <TICKERS>` (2.8.11 returns equal weights plus their risk and a `note` that optimisation is not wired; use `/trader-portfolio-cg` for real weights)
   (`--risk-target` aliases `--target-return`)
2. `--portfolio rebalance` runs the same equal-weight demo; derive the trade plan yourself from the CG weights and the user's holdings, as a proposal
3. Store allocation:
   `npx @claude-flow/cli@latest memory store --key "portfolio-TIMESTAMP" --value "ALLOCATION" --namespace trading-portfolio`

**live**:
1. Do not run `npx neural-trader --broker ...`: neural-trader 2.8.11 answers "Unknown command: --broker" (checked), so there is no broker execution path here. Tell the user live trading is not available through this plugin and offer a backtest or signal scan instead
2. Nothing in this plugin enforces circuit breakers; the daily 3% / weekly 5% figures are thresholds the risk-analyst applies when it reviews a proposal, not an automatic halt
3. If an execution path is ever added, keep the ADR-126 Phase 5 gate: no broker call without an `approved` RiskDecision for that signal, and an explicit user confirmation

**history**:
1. Search memory: `npx @claude-flow/cli@latest memory search --query "trade history" --namespace trading-history`
2. Show recent trades with PnL, strategy attribution, and aggregate metrics
