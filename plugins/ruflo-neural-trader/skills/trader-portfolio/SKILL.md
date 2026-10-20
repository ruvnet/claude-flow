---
name: trader-portfolio
description: Optimize portfolio allocation using npx neural-trader mean-variance engine with risk constraints and rebalancing plan
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__neural_predict mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search
argument-hint: "[--risk-target NUMBER]"
---
Optimize portfolio allocation using neural-trader's portfolio engine.

Steps:
1. Ensure neural-trader is available:
   `npm ls neural-trader 2>/dev/null || npm install --ignore-scripts neural-trader`
2. Load current portfolio:
   `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "current portfolio holdings", namespace: "trading-portfolio" })`
3. Run portfolio optimization:
   ```bash
   npx neural-trader --portfolio optimize --symbols AAPL,MSFT,GOOGL --target-return 0.10
   ```
   (`--risk-target` is accepted as an alias of `--target-return`.) In 2.8.11 this returns EQUAL weights and a risk figure for them, with a `note` saying the returns matrix is not wired; it does not optimise anything. For real mean-variance weights use `/trader-portfolio-cg`. `--portfolio current` and `--portfolio rebalance` run the same equal-weight demo and ignore the word after `--portfolio`.
4. Risk metrics: `--var` and `--correlation` are not CLI flags. Use `--risk assess --returns <series>` (see `/trader-risk`) with returns you derived from real data.
5. Use SONA for expected return prediction:
   `mcp__plugin_ruflo-core_ruflo__neural_predict({ input: "expected returns for [HOLDINGS] given current regime" })`
6. Rebalancing plan: the CLI has no rebalance computation (see step 3). Derive it yourself from the weights `/trader-portfolio-cg` returns and the user's stated holdings: trades needed, current vs target weights, estimated costs. Present it as a proposal for the user to act on; this plugin places no orders.
7. Search for similar allocations in history:
   `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-search({ query: "optimized portfolio Sharpe > 1", namespace: "trading-portfolio" })`
8. Store optimized allocation:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "portfolio-optimal-TIMESTAMP", value: "ALLOCATION_JSON", namespace: "trading-portfolio" })`
