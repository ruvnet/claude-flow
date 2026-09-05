---
name: trader-backtest
description: Run a historical backtest using npx neural-trader with Rust/NAPI engine (8-19x faster) and walk-forward validation; Ed25519-sign the result for paper→live tamper evidence (ADR-126 Phase 4)
allowed-tools: Bash Read mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__memory_delete mcp__plugin_ruflo-core_ruflo__neural_train mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store
argument-hint: "<strategy-name> --symbol <TICKER> [--period 2020-2024]"
---
Run a historical backtest using the `neural-trader` Rust/NAPI engine, then Ed25519-sign the result so the paper→live promotion gate has cryptographic tamper evidence (ADR-126 Phase 4 + CWE-347 pattern).

Steps:
1. Ensure neural-trader is available:
   `npm ls neural-trader 2>/dev/null || npm install --ignore-scripts neural-trader`
2. Check for saved strategy config:
   `mcp__plugin_ruflo-core_ruflo__memory_retrieve({ key: "strategy-STRATEGY_NAME", namespace: "trading-strategies" })`
   If not found, list available: `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "strategy", namespace: "trading-strategies", limit: 10 })`
3. Run backtest via neural-trader CLI:
   ```bash
   npx neural-trader --backtest --strategy <name> --symbol <TICKER> --period <range> --walk-forward
   ```
   For multi-indicator strategies:
   ```bash
   npx neural-trader --backtest --strategy multi-indicator --position-sizing kelly --symbol SPY --period 2020-2024
   ```
4. Capture performance metrics from output: total return, annualized return, Sharpe ratio, Sortino ratio, max drawdown, win rate, profit factor, number of trades.
5. Dedup prior backtests for the same `(strategyId, paramsHash)` before storing the fresh one (ADR-125 lifecycle / ADR-126 Phase 2 — `keep-newest` semantics):
   - Search: `mcp__plugin_ruflo-core_ruflo__memory_search({ query: "backtest STRATEGY paramsHash:PARAMS_HASH", namespace: "trading-backtests", limit: 10 })`
   - For each hit whose key matches `backtest-STRATEGY-*` AND whose stored `paramsHash` equals the current run's hash, delete it: `mcp__plugin_ruflo-core_ruflo__memory_delete({ key: "OLD_KEY", namespace: "trading-backtests" })`
   - (Note: even without this proactive step, the `MemoryConsolidator.dedup('keep-newest')` background pass introduced in `@claude-flow/memory@3.0.0-alpha.18` runs every 6h and will eventually converge. Doing it inline keeps `memory_search` results deterministic immediately after a re-run.)
6. **Sign the artifact (ADR-126 Phase 4):**
   - Build the `SignedBacktestArtifact` body — `{ strategyId, paramsHash, dataRange: {from,to}, metrics, runsHash, generatedAt }` — where `paramsHash = sha256(canonical params JSON)`, `runsHash = sha256(canonical runs array JSON)`, and `generatedAt = new Date().toISOString()`.
   - Resolve the witness signing key. The skill reads the key path in this order; the FIRST that resolves wins:
     1. `RUFLO_WITNESS_KEY_PATH` env var — points to a JSON file with `{ "privateKey": "<hex>" }`.
     2. `verification/witness-key.json` (the ADR-103 default path, if present).
   - If the key resolves: call `signBacktestArtifact(body, privateKeyHex)` from `plugins/ruflo-neural-trader/src/signed-artifact.mjs`. The returned value is a `SignedBacktestArtifact` with `schema`, `witnessPublicKey: "ed25519:<hex>"`, and `witnessSignature: "<hex>"` populated.
   - If NEITHER path resolves: log a loud warning — `"[WARN] ruflo-neural-trader: no witness signing key found (RUFLO_WITNESS_KEY_PATH unset, verification/witness-key.json missing) — storing backtest artifact in UNSIGNED degraded mode. paper→live promotion will be refused by trader-cloud-backtest until a signed artifact replaces this one."` — and store the body unsigned. NEVER silently fall back.
7. **Store the (possibly signed) artifact** to the canonical `trading-backtests` namespace:
   `mcp__plugin_ruflo-core_ruflo__memory_store({ key: "backtest-STRATEGY-TIMESTAMP", value: JSON.stringify(signedArtifact), namespace: "trading-backtests" })`
   The stored value contains `witnessSignature` + `witnessPublicKey` when signed; downstream consumers (`trader-cloud-backtest`) MUST call `verifyBacktestArtifact(artifact, trustedPublicKey)` before promoting any artifact to live.
8. If Sharpe > 1.5, store as successful pattern:
   `mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store({ pattern: "profitable-STRATEGY_TYPE", data: "PARAMS_AND_RESULTS" })`
9. Train SONA on the outcome:
   `mcp__plugin_ruflo-core_ruflo__neural_train({ patternType: "trading-strategy", epochs: 10 })`

### Key sourcing & key rotation (ADR-103)

- The witness key is a 32-byte Ed25519 private key, stored as `{ "privateKey": "<64-hex-chars>" }` in a JSON file referenced by `RUFLO_WITNESS_KEY_PATH`. Keep it OUT of the repo. For local development, generate one once with `node -e "import('@noble/ed25519').then(async ed=>{const sk=crypto.getRandomValues(new Uint8Array(32));console.log(Buffer.from(sk).toString('hex'))})"` and write it to `~/.ruflo/witness-key.json`.
- Production deployments pin the corresponding PUBLIC key in project config and supply it as `trustedPublicKey` to `verifyBacktestArtifact(...)` — never trust the `witnessPublicKey` field on the artifact itself (CWE-347 / #1922).
- Key rotation: re-sign existing backtest entries with the new key OR explicitly mark pre-rotation artifacts as non-promotable. Same pattern as ADR-103.
