---
name: trader-risk
description: Assess portfolio risk using npx neural-trader — VaR, CVaR, Sharpe, position sizing, circuit breaker status
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_search
argument-hint: "[--symbol TICKER] [--portfolio NAME]"
---
Assess portfolio and position risk using neural-trader's risk engine.

Steps:
1. Ensure neural-trader is available:
   `npm ls neural-trader 2>/dev/null || npm install --ignore-scripts neural-trader`
2. Run risk assessment:
   ```bash
   # VaR, CVaR and drawdown from a returns series YOU supply (daily returns as decimals)
   npx neural-trader --risk assess --returns 0.01,-0.005,0.012,-0.02 --portfolio-value 100000 --confidence-level 0.95 --method historical
   ```
   `--risk assess` computes from `--returns` only. `--symbol` and `--portfolio` are ignored, and with no `--returns` it uses a built-in 7-value sample (`inputs.returnsCount: 7`), which is a demo, not a risk read on anything. Derive the returns from real bars first (a `--backtest --live` run with `dataSource: "yahoo-finance"`, or the user's own history). `--var`, `--correlation`, `--risk-tolerance` and `--position-sizing` as standalone flags are rejected by the CLI ("Unknown command").
3. Position sizing: Kelly sizing exists only inside a backtest (`--backtest ... --position-sizing kelly`). For a standalone figure, compute it from the win rate and payoff in the backtest output and state the assumptions; do not present it as an instruction to trade.
4. Check circuit breaker status:
   - Daily loss limit (3%), weekly loss limit (5%)
   - Correlation spike (>0.85), volatility regime (VIX > 2x)
   - Max positions, single-name concentration (>10%)
5. Present: risk metrics, position sizing recommendation, active breakers, alerts
6. Store assessment:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "risk-TICKER-DATE", value: "RISK_METRICS", namespace: "trading-risk" })`
