---
name: trader-cloud-backtest
description: Run a heavy neural-trader job (long walk-forward, big Monte-Carlo, parameter sweep, model training) on the Anthropic Managed Agent cloud runtime instead of locally
allowed-tools: mcp__plugin_ruflo-core_ruflo__managed_agent_create mcp__plugin_ruflo-core_ruflo__managed_agent_prompt mcp__plugin_ruflo-core_ruflo__managed_agent_events mcp__plugin_ruflo-core_ruflo__managed_agent_status mcp__plugin_ruflo-core_ruflo__managed_agent_terminate mcp__plugin_ruflo-core_ruflo__memory_store mcp__plugin_ruflo-core_ruflo__memory_retrieve mcp__plugin_ruflo-core_ruflo__memory_search mcp__plugin_ruflo-core_ruflo__agentdb_pattern-store Bash Read
argument-hint: "<backtest|train|sweep> <strategy-or-model> --symbol <TICKER> [--period 2020-2024] [--mc-paths 1000]"
---

# Cloud backtest / train (neural-trader on a Managed Agent)

Dispatch a **heavy** `neural-trader` job to an Anthropic Claude Managed Agent (cloud container) instead of running it locally. See project ADR-117 (recipe + cost rules) and ADR-115 (the `managed_agent_*` runtime).

## When to use this vs `trader-backtest` (local)

| Job | Runtime |
|---|---|
| Quick sanity check; one short backtest (< ~1 min) | local — use the `trader-backtest` skill |
| Multi-year **walk-forward**, big **Monte-Carlo** count, **parameter sweep** over a grid, or **model training** (LSTM/Transformer/N-BEATS) | **cloud — this skill** |

Prereq: `ANTHROPIC_API_KEY` (or `CLAUDE_API_KEY`) + Managed Agents beta access. If `managed_agent_*` returns "needs ANTHROPIC_API_KEY", fall back to the local `trader-backtest` skill.

## Steps

1. **Estimate first.** From the job size, print an estimated cost (≈ container-minutes × rate + tokens) — a long sweep is a deliberate choice, not a default.

2. **Provision (or reuse) the container** — install neural-trader at container start so the agent doesn't reinstall mid-run:
   ```
   managed_agent_create({
     name: "nt-cloud",
     model: "claude-haiku-4-5-20251001",            // orchestration only — the compute is the Rust engine, not the LM (ADR-026)
     system: "You operate the `neural-trader` CLI in this container. Run exactly the commands asked, report the metrics, write requested artifacts, then stop.",
     networking: "unrestricted",                     // or "restricted" pinned to your data host
     packages: { npm: ["neural-trader"] },           // add apt:["build-essential"] ONLY if there's no prebuilt NAPI binary for the arch (neural-trader ships prebuilds → usually omit)
     initScript: "npm install -g --ignore-scripts neural-trader >/dev/null 2>&1 || npx -y neural-trader --version >/dev/null 2>&1 || true"
   })
   → { sessionId, agentId, environmentId }
   ```
   For a **sweep**: create the environment once, run all configs in **one** `managed_agent_prompt` (one container), not N sessions.

3. **Pre-flight cheap.** Before a 1000-path / multi-year run, do a tiny smoke first (1 MC path, ~3 months) — catches a bad strategy name / symbol in seconds:
   ```
   managed_agent_prompt({ sessionId, message: "Run `npx neural-trader --backtest --strategy <name> --symbol <TICKER> --period <last 3 months> --mc-paths 1`. Just confirm it ran and report the Sharpe. Then stop.", maxWaitMs: 60000 })
   ```
   If that fails, fix the args before the real run (and `managed_agent_terminate`).

4. **Run the real job:**
   ```
   managed_agent_prompt({
     sessionId,
     message: "Run `npx neural-trader --backtest --strategy <name> --symbol <TICKER> --period <range> --walk-forward --mc-paths <N>` (for training: `npx neural-trader --train --model <lstm|transformer|nbeats> --symbol <TICKER> --period <range>`; for a sweep: loop the configs and run each). Report: total return, annualized return, Sharpe, Sortino, max drawdown, win rate, profit factor, # trades, 95% CVaR. Write the equity curve to /tmp/equity.csv and the trade log to /tmp/trades.csv. Then stop.",
     maxWaitMs: <generous — minutes>
   })
   → { finished, status, stopReason, assistantText (the metrics), toolUses }
   ```
   If `finished:false`, follow up with `managed_agent_events({ sessionId })` until idle.

5. **Pull artifacts (if needed):** `managed_agent_prompt({ sessionId, message: "cat /tmp/equity.csv" })` or `managed_agent_events` and read the tool_result.

6. **Ingest locally + Ed25519 verify (ADR-126 Phase 4 fail-closed gate):**
   - Build the `SignedBacktestArtifact` body from the cloud-returned metrics + params hash + runs hash. Sign it locally with `signBacktestArtifact(body, privateKeyHex)` from `plugins/ruflo-neural-trader/src/signed-artifact.mjs` (key resolution same as `trader-backtest`: `RUFLO_WITNESS_KEY_PATH` → `verification/witness-key.json` → degraded-unsigned warning).
   - **Before storing OR promoting the artifact to a live strategy**: call `await verifyBacktestArtifact(artifact, trustedPublicKey)` where `trustedPublicKey` is the pinned project-config Ed25519 public key (NOT the `artifact.witnessPublicKey` field — that's attacker-controllable; see CWE-347 / #1922). If verification returns `false`: **REFUSE to promote** — emit a loud error `"[ERROR] ruflo-neural-trader: SignedBacktestArtifact signature INVALID against trusted key — refusing to promote to live strategy"` and return early. This is the fail-closed gate per ADR-126.
   - On verify success: `memory_store({ key: "backtest-<strategy>-<ts>", value: JSON.stringify(signedArtifact), namespace: "trading-backtests" })`. The stored value carries `witnessSignature` + `witnessPublicKey`.
   - If Sharpe > 1.5: `agentdb_pattern-store({ pattern: "profitable-<strategy-type>", data: "<params + results>" })`.
   - Record the run's container time + token cost to the `cost-tracking` namespace (per ADR-117 — cloud sessions bill until terminated).

7. **Terminate immediately** — results in hand:
   ```
   managed_agent_terminate({ sessionId, environmentId })   → { sessionDeleted: true, environmentDeleted: true }
   ```
   Never leave an idle billing container. (`ruflo doctor` / GC catches orphans — #1931.)

## Cost rules (don't skip)

- Install once (`initScript`), reuse the environment, batch sweeps into one prompt, pre-flight cheap, terminate eagerly, use Haiku/Sonnet for the agent loop, estimate before kicking off. (ADR-117 §"Cost optimization".)
- A cloud backtest that runs for an hour costs an hour of container time + the agent-loop tokens. Be deliberate.

## Quick example

```
managed_agent_create  { "name":"nt-cloud", "model":"claude-haiku-4-5-20251001", "packages":{"npm":["neural-trader"]}, "initScript":"npm install -g --ignore-scripts neural-trader >/dev/null 2>&1 || true" }
  → { sessionId:"sesn_…", environmentId:"env_…" }
managed_agent_prompt   { "sessionId":"sesn_…", "message":"Run `npx neural-trader --backtest --strategy multi-indicator --symbol SPY --period 2020-2024 --walk-forward --mc-paths 1000`. Report Sharpe/Sortino/max-DD/win-rate/CVaR; write /tmp/equity.csv. Then stop.", "maxWaitMs":600000 }
  → { finished:true, status:"idle", assistantText:"<metrics>", toolUses:[{bash:"npx neural-trader --backtest …"}] }
# … memory_store the metrics, agentdb_pattern-store if Sharpe>1.5, record cost …
managed_agent_terminate { "sessionId":"sesn_…", "environmentId":"env_…" }
```
