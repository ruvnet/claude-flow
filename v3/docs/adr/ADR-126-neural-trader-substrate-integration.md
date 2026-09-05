# ADR-126 — `ruflo-neural-trader` Substrate Integration: Persistent Memory, Graph-Intelligence Solver, Provenance Signing, and Pipeline Coordination

**Status**: Proposed (2026-05-20)
**Date**: 2026-05-20
**Authors**: claude (drafted with rUv) — dossier by `ruflo-goals:dossier-investigator`
**Related**: ADR-117 (managed-agent backtests), ADR-115 (rvagent), ADR-122 (browser substrate), ADR-123 (sublinear integration), ADR-125 (memory consolidation), ADR-103 (witness temporal history), CWE-347 plugin-registry pattern (#1922, #2060), `ruflo-neural-trader` plugin, `neural-trader` npm package
**Supersedes**: nothing — extends ADR-117 with the substrate integrations that the four ADRs landed since 2026-04 make newly possible

## Context

`ruflo-neural-trader` (4 specialized agents + 5 skills + Rust/NAPI backtest engine via the upstream `neural-trader` npm package) is the headline domain-specific plugin in the ruflo ecosystem. Between 2026-04 and today (2026-05-20), four substrate ADRs have landed that change what's possible — but the plugin doesn't yet leverage any of them:

1. **ADR-125 / `@claude-flow/memory@3.0.0-alpha.18`** (PRs #2062 + #2063) shipped the canonical `MemoryService`, real `HybridBackend` default, **persistent HNSW** (`.hnsw` sidecar snapshots that survive restart), **`MemoryConsolidator`** (`sweepExpired` / `dedup` / `compactHnsw` / auto-run timer), **graceful retrieval degradation** with FTS5 keyword fallback, and **hybrid RRF+MMR search**. Today every neural-trader process restart rebuilds the HNSW index from scratch; the four trading namespaces (`trading-{strategies,backtests,risk,analysis}`) have no expiry policy and grow unboundedly; `semanticSearch` hard-throws when the embedder is unavailable, taking down the `market-analyst` regime-comparison workflow.
2. **ADR-123 / `ruflo-graph-intelligence` + `ruflo-sublinear`** (PR #2045) shipped sublinear-time graph algorithms via `sublinear-time-solver@1.7.0` with 5 wedges. **Row 8 of the ADR-123 integration table explicitly names `ruflo-neural-trader` as the Wedge-8 target**: replace the Neumann-series mean-variance solve with Conjugate Gradient via `sublinear/solve` for `Σx = μ` — measured at **816 ns CG vs ~50 µs Neumann** (40–60x speedup), zero new deps, 0.5-day estimate. Today nothing in the plugin references CG or sublinear; the portfolio path still calls `npx neural-trader --portfolio optimize` directly.
3. **ADR-122 / Browser substrate** (PR #2043) shipped signed-trajectory RVF containers, AIDefence-attested cookie vault, GOAP preflight, Session Capsule, federated MCTS, and Workflow Compiler. Today the `market-analyst` agent fetches market data via `npx neural-trader --symbol TICKER` — a batch pull from Yahoo Finance with **zero provenance**. No way to detect if the OHLCV series was tampered with at the gateway.
4. **CWE-347 Ed25519 pattern** (PR #2060) formalized "sign with Ed25519, pin to a trusted key, fail closed" as a documented invariant via `scripts/smoke-plugin-registry-signature.mjs`. Today the paper→live promotion gate — the moment cryptographic tamper-evidence matters most for a quant team — stores backtest results as plain JSON with no hash and no signature. The `trading-predictor` sublinear agent file (`.claude/agents/sublinear/trading-predictor.md:213`) lists "signed audit trail" as a requirement but no implementation exists.

Cumulatively this puts neural-trader behind both the ruflo ecosystem (substrates it could use) and the 2025–2026 production trading SOTA (regulator-grade explainability, episodic/semantic memory separation, signed audit trails, multi-agent pipeline coordination — references in the dossier).

The investigation also surfaced **one active bug**: a three-way namespace mismatch between `README.md:198-205` (claims `trading-{strategies,backtests,risk,analysis}`), `docs/adrs/0001-neural-trader-contract.md:63` (claims `trading-signals`, `trading-models` instead), and `skills/trader-signal/SKILL.md:35` (actually writes to `trading-signals` — undeclared by the README). The smoke test (`scripts/smoke.sh:58-63`) validates the README's four names, so the smoke passes while `trader-signal` writes to a namespace no consumer of the documentation knows about. Any downstream memory search scoped to the four documented namespaces silently misses all signal data.

## What we found

| Gap | Location | Today | Substrate that fixes it |
|---|---|---|---|
| Namespace mismatch (**active bug**) | `README.md:198-205` vs `docs/adrs/0001-neural-trader-contract.md:63` vs `skills/trader-signal/SKILL.md:35` | smoke passes, signal data lost from documented surface | This ADR Phase 1 |
| Cold-start HNSW rebuild | `agents/trading-strategist.md:108` + `market-analyst.md:48` | every restart rebuilds index from scratch | ADR-125 Phase 3 — persistent HNSW |
| Unbounded memory growth | `trader-backtest/SKILL.md:26` + `trader-signal/SKILL.md:35` (no TTL anywhere) | stale entries accumulate; semantic recall degrades | ADR-125 Phase 4 — `MemoryConsolidator` |
| `semanticSearch` hard-throws when embedder absent | `v3/@claude-flow/memory/src/agentdb-adapter.ts:752-754` | `market-analyst` regime comparison goes offline | ADR-125 Phase 5 — graceful FTS5 fallback (already shipped) |
| Pure-dense retrieval for regime similarity | `market-analyst.md:48` | misses exact-match signals (ticker symbols, error codes) | ADR-125 Phase 5 — RRF+MMR hybrid (already shipped) |
| Portfolio CG solve not wired | `trader-portfolio/SKILL.md` — no `sublinear/solve` reference | ~50 µs Neumann vs 816 ns CG (40–60x) | ADR-123 Wedge 8 |
| No feature attribution / explainability | LSTM/Transformer predictions opaque | regulator-grade interpretability impossible | ADR-123 single-entry PR (forward-push) |
| No GOAP preflight before live trading | `trading-strategist.md:51-54` — direct broker call | live orders without dry-run validation | ADR-122 Phase 5 / ADR-123 Wedge 9 |
| No provenance on market data | `market-analyst.md:40` — `npx neural-trader --symbol TICKER` | tampered OHLCV undetectable | ADR-122 Phases 1+3+6 — Session Capsule + signed RVF |
| Unsigned backtest results & model weights | `trader-backtest/SKILL.md:26` — plain JSON store | paper→live promotion has no tamper evidence | ADR-103 witness + CWE-347 pattern |
| No pipeline coordination (signal → risk → executor) | 4 agents are parallel role descriptions, not a sequence | `risk-analyst` can be bypassed | SendMessage handshake pattern (CLAUDE.md) |
| SONA trajectory loop not closed | `hooks post-task --train-neural true` fires; `trajectory-start/step/end` not called | hooks log but no learning trajectory recorded | Self-learning pipeline ADR-049 wiring |

## Decision

Land **`ruflo-neural-trader@0.2.0-alpha.1`** with six coupled phases, ordered to maximize early payoff and bound late risk:

### Phase 1 — Fix the namespace mismatch (small; single PR; ships first)

The only active bug. Align README, ADR-0001, and skill source on a canonical five-namespace set:

```
trading-strategies   — strategy definitions, parameters, regime-condition mappings
trading-backtests    — historical backtest results (long-lived; signed in Phase 4)
trading-risk         — risk model state, VaR/CVaR snapshots, circuit-breaker triggers
trading-analysis     — market-analyst output (regime classifications, technical-indicator summaries)
trading-signals      — short-lived signal events (intraday; TTL applied in Phase 2)
```

Touched files: `plugins/ruflo-neural-trader/README.md` (L198-205), `plugins/ruflo-neural-trader/docs/adrs/0001-neural-trader-contract.md` (L63), `plugins/ruflo-neural-trader/scripts/smoke.sh` (L58-63 add the fifth namespace assertion). All four agents’ tool-allowlists already permit memory calls so no agent edits needed.

Commit: `fix(neural-trader): #2068 ADR-126 Phase 1 — canonical 5-namespace alignment + smoke`

### Phase 2 — Wire ADR-125 memory lifecycle (small)

`trader-signal/SKILL.md`: write entries with `expiresAt: now + 24h` so intraday signals don't pollute long-running memory. `trader-backtest/SKILL.md`: call `MemoryConsolidator.dedup('keep-newest')` before re-running a backtest on the same `strategyId × paramsHash`. Add `MemoryConsolidator` to the `allowed-tools` lists for `trader-backtest` and `trader-signal`. Document that HNSW warm-start requires `@claude-flow/memory@3.0.0-alpha.18` (already published).

No code change is required to benefit from the persistent HNSW or the FTS5 fallback — those flow through `MemoryService.search()` automatically. The plugin's `market-analyst` regime-similarity query will become hybrid (dense + sparse RRF + MMR) at zero plugin cost.

Commit: `feat(neural-trader): #2068 ADR-126 Phase 2 — ADR-125 lifecycle (TTL + dedup + warm HNSW)`

### Phase 3 — Portfolio CG solve via ADR-123 Wedge 8 (medium)

New `plugins/ruflo-neural-trader/src/sublinear-adapter.ts` exporting the `SublinearAdapter` shape (per ADR-123 §262-289). New skill `trader-portfolio-cg/SKILL.md` that:

1. Reads the current covariance matrix `Σ` and expected-return vector `μ` from neural-trader's portfolio API (`npx neural-trader --portfolio current --json`).
2. Calls `mcp__ruflo-sublinear__solve` with the CG method for `Σx = μ`, target tolerance `1e-6`.
3. Falls back to `npx neural-trader --portfolio optimize` if `sublinear/solve` returns infeasible or unavailable.
4. Writes the optimal weights vector to `trading-risk` namespace with provenance metadata (solver, iterations, residual, timestamp).

Add `mcp__ruflo-sublinear__solve` to the skill's `allowed-tools`. Acceptance: `bench/portfolio-cg.bench.ts` shows <1 ms latency on `n=256` covariance; parity test confirms CG result within `1e-4` of original Neumann.

Commit: `feat(neural-trader): #2068 ADR-126 Phase 3 — portfolio CG via sublinear-solve (40-60x)`

### Phase 4 — Ed25519 witness signing for backtest artifacts (medium)

Define `SignedBacktestArtifact` schema mirroring ADR-123's `SignedPageRankArtifact` (§311-330):

```ts
interface SignedBacktestArtifact {
  schema: 'ruflo-neural-trader-backtest/v1';
  strategyId: string;
  paramsHash: string;       // sha256 of canonicalized params JSON
  dataRange: { from: string; to: string };  // ISO dates
  metrics: { sharpe, maxDrawdown, totalReturn, ... };
  runsHash: string;          // sha256 of canonicalized runs array
  generatedAt: string;       // ISO timestamp
  witnessPublicKey: string;  // ed25519:<hex>
  witnessSignature: string;  // hex
}
```

Update `trader-backtest/SKILL.md` step 5: before storing, canonicalize the artifact (strip signature fields → `JSON.stringify` → ed25519 sign with the ADR-103 witness key). Update `trader-cloud-backtest/SKILL.md`: after retrieving an artifact from the managed agent, call `ruflo witness verify` and refuse to promote a result whose signature doesn't verify against the trusted pinned key.

Update `scripts/smoke.sh` to assert that every entry stored in `trading-backtests` contains a `witnessSignature` field. Add a regression smoke `scripts/smoke-neural-trader-backtest-signing.mjs` modeled on `scripts/smoke-plugin-registry-signature.mjs`: build a fixture, sign it, verify; tamper one byte, verify fails; verify passes only with the pinned trusted key.

Commit: `feat(neural-trader): #2068 ADR-126 Phase 4 — Ed25519 witness signing for backtest artifacts`

### Phase 5 — Pipeline coordination via SendMessage (medium)

Refactor the four agents as a typed pipeline rather than parallel role descriptions:

```
market-analyst
  ── SendMessage(regime: 'bull-volatility' | 'bear-trending' | ...) ──→
trading-strategist
  ── SendMessage(signals: SignalProposal[]) ──→
risk-analyst   ◄── BLOCKING GATE
  ── SendMessage(decision: 'approved' | 'rejected', reasons[]) ──→
execution-or-halt
```

Each agent's prompt updated with explicit `WAIT for SendMessage from <upstream>` and `SendMessage to <downstream>` directives, plus the message schemas. The live-trading branch in `trading-strategist.md:51-54` (currently calls `npx neural-trader --broker live` directly) must be gated on having received a `risk-analyst` approval event in the current session.

Update `backtest-engineer.md` to participate as an orthogonal lane: it runs in parallel with `market-analyst` during research, but its outputs are signed-artifact promotion candidates — the live pipeline never depends on it for hot-path execution.

Add an integration smoke `scripts/smoke-neural-trader-pipeline.mjs` that drives a mock pipeline through `market-analyst` → `trading-strategist` and asserts the broker call refuses to execute without a `risk-analyst` approval message in the trace.

Commit: `feat(neural-trader): #2068 ADR-126 Phase 5 — SendMessage pipeline with risk-gate enforcement`

### Phase 6 — Feature attribution via ADR-123 single-entry PageRank (medium)

New skill `trader-explain/SKILL.md`:

1. Takes a `signalId` as input.
2. Calls `npx neural-trader --predict --signal $SIGNAL_ID --explain --json` to extract the model's feature-contribution scores (attention weights for Transformers, gradient × input for LSTMs, or SHAP values when available).
3. Builds a feature-contribution graph: nodes = features, edges = co-attention weights, source = the signal output node.
4. Calls `mcp__ruflo-sublinear__page-rank-entry` with single-entry forward-push from the signal output to get a top-K ranked list of contributing features.
5. Stores the ranked attribution to `trading-analysis` as a signed `SignedAttributionArtifact` (Phase 4 schema, attribution-specific variant).

Acceptance: `trader-explain signal-<id>` returns a ranked feature list whose top-3 features match the model's attention argmax (within tolerance); ranking is reproducible across two identical runs (same seed → same ordering).

Commit: `feat(neural-trader): #2068 ADR-126 Phase 6 — feature attribution via sublinear PR entry`

## Why this is the right shape of fix

Three of the six phases (1, 2, the implicit hybrid-search benefit) are pure connect-the-existing-pieces work that requires no new design. They land first and prove the substrate alignment before committing to net-new functionality. Phases 3, 4, and 6 each pull in **exactly one** new substrate adapter (sublinear, witness, sublinear-PR) following ADR-123's documented adapter contract — no new architectural primitive is introduced. Phase 5 is the only behaviorally novel piece, and it follows the SendMessage-pipeline pattern already documented in the project CLAUDE.md, so it's a discipline change more than an architecture change.

The plugin's existing 4-agent surface (`trading-strategist`, `backtest-engineer`, `risk-analyst`, `market-analyst`) and 5 skills (`trader-backtest`, `trader-cloud-backtest`, `trader-signal`, `trader-portfolio`, `trader-runtime`) are preserved. Net file count grows by **one new adapter** + **two new skills** (`trader-portfolio-cg`, `trader-explain`) + **two new smokes**. Nothing in the existing CLI integration with `npx neural-trader` changes.

## Consequences

### Positive
- Bug fix: signal data stops getting lost in the namespace mismatch (Phase 1).
- ADR-009's hybrid-default and ADR-125's persistent HNSW finally get exercised in production by the highest-traffic plugin in the ecosystem.
- Portfolio optimization gets a measured 40–60x speedup with parity validation (Phase 3).
- The paper → live promotion gate becomes cryptographically verifiable for the first time in any open-source neural-trading project we surveyed (Phase 4).
- `risk-analyst` becomes a mandatory blocking step rather than a parallel role; bypass is structurally impossible (Phase 5).
- Regulator-grade feature attribution closes the most-cited 2025-2026 SOTA gap (Phase 6).

### Negative / trade-offs
- Phase 5 (pipeline coordination) is a discipline change that requires every team member spawning trading agents to follow the SendMessage protocol — failure mode is "live trades execute without risk approval", which is precisely the failure we're trying to eliminate. Mitigation: the integration smoke fails the build if the test mock can bypass the gate.
- Phase 3 adds `ruflo-sublinear` as a hard runtime dep for portfolio optimization (with a fallback to the legacy Neumann path). Without `ruflo-sublinear` installed, portfolio optimization degrades to the previous performance — same behavior as today.
- Phase 4 introduces a witness-key dependency. If the project's Ed25519 signing key is lost, backtest results from before the key-rotation can't be promoted to live. Mitigation: ADR-103 already handles witness-key lifecycle and rotation.
- Phase 6 requires `neural-trader --predict --explain` to expose attention/SHAP output. If that flag isn't shipped upstream yet, Phase 6 is gated on an upstream PR.

### Neutral
- The 4-agent surface is preserved; users typing `npx ruflo-neural-trader` see the same plugin description and the same CLI surface.

## Implementation Plan

| Phase | Deliverable | Files Touched | Effort | Acceptance |
|---|---|---|---|---|
| 1 | Namespace alignment | 3 docs + 1 smoke | S | smoke asserts 5 namespaces; ADR-0001 + README + skill names agree |
| 2 | ADR-125 lifecycle | 2 skills, doc | S | `trader-signal` entries expire; `trader-backtest` deduplicates; HNSW warm-start documented |
| 3 | Portfolio CG | new adapter + new skill + bench | M | `<1ms latency on n=256`; parity within 1e-4; fallback to Neumann works |
| 4 | Ed25519 backtest signing | schema + 2 skills + new smoke | M | every backtest entry signed; tampered fails; verify against pinned key only |
| 5 | SendMessage pipeline | 4 agents updated + new integration smoke | M | live broker call blocked without `risk-analyst` approval event |
| 6 | Feature attribution | new skill + signed-artifact variant | M | top-K reproducible; matches attention argmax for ≥2/3 reference signals |

Recommended landing: Phase 1 + Phase 2 in one PR (the "ship the bug fix + memory hygiene" PR). Phase 3 in its own PR (the perf win is clean and isolated). Phase 4 + Phase 5 in one PR (the "trust pipeline" PR — they reinforce each other). Phase 6 in its own PR (gated on the upstream `--explain` flag).

## Acceptance Criteria

The ADR is considered fulfilled when all of the following hold against `ruflo-neural-trader@0.2.0-alpha.1`:

1. `scripts/smoke.sh` passes with the canonical 5-namespace set (Phase 1).
2. `memory_search` in `trading-signals` returns zero entries with `expiresAt` in the past after `consolidator.sweepExpired()` runs (Phase 2).
3. `mcp__ruflo-sublinear__solve` on the live covariance matrix returns a portfolio-weights result within `1e-4` of the legacy Neumann path in `<1ms` (Phase 3).
4. Every entry in `trading-backtests` carries a `witnessSignature` field; `ruflo witness verify <entry>` succeeds; mutating a single byte fails verification (Phase 4).
5. A live-broker CLI invocation refuses to fire without a prior `risk-analyst` SendMessage approval event in the session trace (Phase 5).
6. `trader-explain <signalId>` returns a ranked feature attribution list reproducible across two identical runs (Phase 6).
7. No regression in the existing 4-agent / 5-skill surface — all current smoke checks still pass.
8. `npx ruflo-neural-trader` still works as documented (no breaking change for current consumers).

## Out of Scope (Deferred to Separate ADRs)

These each have user-value but are each non-trivial design efforts that deserve their own decision records:

- **ADR-127** Real-time feature store wiring (`ruflo-market-data` streaming integration). Gated on `ruflo-market-data` exposing a streaming adapter first.
- **ADR-128** Browser-attested market-data scraping (ADR-122 Session Capsule + AIDefence cookie vault). Gated on ADR-122 Phases 3+6 completing.
- **ADR-129** GOAP-LP trade sequencing via `sublinear/feasibility` (ADR-123 Wedge 9). Medium risk per the ADR-123 GOAP plan A10; LP feasibility is the trickiest math.
- **ADR-130** Cone-of-influence loss attribution via causal trade-dependency graph. Depends on a trade-dependency graph schema that doesn't exist yet.
- **ADR-131** Episodic ↔ semantic memory tier separation (SOTA pattern per TradingAgents / FinCon / TradingGroup). Phase 2's TTL is a stepping-stone; full tier separation is a re-architecture.
- **ADR-132** SONA trajectory closure — the agent-level `hooks post-task --train-neural true` fires but the `trajectory-start/step/end` loop is not closed. Worth a dedicated ADR alongside the broader self-learning rollout.
