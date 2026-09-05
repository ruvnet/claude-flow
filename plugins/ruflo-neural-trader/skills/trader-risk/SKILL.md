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
   # Single position
   npx neural-trader --risk assess --symbol TICKER
   npx neural-trader --var --symbol TICKER --investment 10000

   # Portfolio-wide
   npx neural-trader --risk assess --portfolio NAME
   npx neural-trader --correlation --portfolio NAME --flag-threshold 0.8
   ```
3. Calculate position sizing:
   ```bash
   npx neural-trader --risk-tolerance 0.02 --symbol TICKER
   npx neural-trader --position-sizing kelly --symbol TICKER
   ```
4. Check circuit breaker status:
   - Daily loss limit (3%), weekly loss limit (5%)
   - Correlation spike (>0.85), volatility regime (VIX > 2x)
   - Max positions, single-name concentration (>10%)
5. Present: risk metrics, position sizing recommendation, active breakers, alerts
6. Store assessment:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "risk-TICKER-DATE", value: "RISK_METRICS", namespace: "trading-risk" })`
